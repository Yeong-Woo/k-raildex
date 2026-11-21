/**
 * kric-train-ops 수집기(docs/08 3-1, round-4 Q82·Q84·Q104): 레일포털 표준데이터 운행정보(열차별 역 운행시각)로
 * TAGO 에 없는 (역, 운행 계통, 요일, 방향) 조합의 시간표 세트를 만든다(토요일 다이아, 2호선 공휴일·내선/외선, TAGO 가 비운 역).
 * 규칙은 기존 build-timetables.ts 134~292행(docs/legacy/design/timetable-model.md "운행정보 보강")과 같다.
 *
 * - 입력: 노선번호별 정규화 json.gz(`all-<노선번호>.json.gz`, 열차 `{ no, day, kind, from, to, stops: [[역명, 도착, 출발]] }`).
 *   또는 원본 xlsx(`--from-xlsx`, `--download` 로 레일포털에서 내려받기 — kric-xlsx.ts, 기존 fetch-kric-train-ops.ts 이식, Q108 A).
 * - 설정: ingest.config (kric-train-ops, routes) = 기존 kric-train-ops-routes.yaml(routes·day_types·kinds·names),
 *   (kric-train-ops, rafis_abbr) = RAFIS 역약어명 → 역명 목록.
 * - 노선번호 → 운행 계통(routes), 한 파일에 섞인 다른 계통 열차는 splits(약호·번호 범위)로 나눈다.
 * - 역명 해석: names(수기) → 운행 계통 노선·정차 패턴 역의 이름·별칭 → RAFIS 역약어명(→ 역명 → 후보 역 / external_ref rafis)
 *   → 앞 글자(숫자·"지하"·"신" 제거) 접두 일치 → 전역 유일 이름. 못 푼 것은 실행 통계·리포트에 남긴다.
 * - 방향: direction_rule loop(2호선) = 정차 순서에서 역번호 증가 = inner, 감소 = outer. 그 밖은 종착역의 TAGO 방향 투표
 *   → 정차 패턴 순서(앞 → 뒤 = down) → unknown.
 * - 수도권(capital) 권역 운행 계통만 시간표를 만든다(Q85 A). 나머지는 열차 수 통계만.
 * - 행: 기점 출발·종점 도착·중간역 출발(없으면 도착), 열차번호(train_no)·운행유형(note: 급행·직통)·종착역(dest_station_id).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { TimetableSet } from '@k-raildex/contracts';
import type { Queryable } from '@k-raildex/domain';
import { getConfig, requireConfig } from '../core/config';
import { IssueLog } from '../core/issues';
import type { RunTrigger } from '../core/run';
import { withRun } from '../core/run';
import { emptySnapshotStats, upsertSnapshot } from '../core/snapshot';
import { downloadKricXlsx, normalizeKricXlsx, resolveKricXlsx } from './kric-xlsx';
import { baseKey } from './names';
import { lineStationResolver, loadNetworkContext, UNOPENED, type NetworkContext } from './network';
import { opsMinute } from './time';
import { TAGO_SOURCE, type ImportResult } from './tago';
import { replaceTimetableSets } from './writer';

export const KRIC_TASK = 'kric-train-ops';
export const KRIC_SOURCE = 'src-kric-file-train-ops';

type DayType = TimetableSet['day_type'];
type Direction = TimetableSet['direction'];

export interface KricSplit {
  prefix?: string;
  from: number;
  to: number;
  service_id: string;
}

export interface KricRoute {
  line_no: string;
  name?: string;
  service_id?: string | null;
  direction_rule?: 'terminal' | 'loop';
  loop_line_id?: string;
  note?: string;
  splits?: KricSplit[];
}

export interface KricConfig {
  routes: KricRoute[];
  day_types: Record<string, string[]>;
  kinds: Record<string, string>;
  /** 노선번호 → { 원문 역명 → 역 id | null(무시) } */
  names: Record<string, Record<string, string | null> | string | null>;
}

export interface KricTrain {
  no: string;
  day: string;
  kind: string;
  from: string;
  to: string;
  stops: [string, string, string][];
}

export interface KricFile {
  source_id?: string;
  file_id?: number;
  label?: string;
  line_no: string;
  line_name?: string;
  data_as_of?: string;
  retrieved_at?: string;
  rows?: number;
  trains: KricTrain[];
}

/** TAGO 세트에서 얻는 것: 이미 있는 (역|계통|요일|방향), (계통, 종착역명, 방향) 행 수 */
export interface TagoCoverage {
  covered: Set<string>;
  destVotes: { service_id: string; direction: string; dest_name: string; n: number }[];
}

export interface KricJobStats {
  key: string;
  line_no: string;
  service_id: string | null;
  trains: number;
  stops: number;
  days: string[];
  scope: 'capital' | 'out_of_area' | 'no_service' | 'unknown_service';
  emitted: Record<string, number>;
  skipped_covered: number;
  unresolved: Record<string, number>;
}

export interface KricBuildResult {
  sets: TimetableSet[];
  jobs: KricJobStats[];
  issues: IssueLog;
  line_nos: string[];
}

const DIRS = new Set(['up', 'down', 'inner', 'outer', 'unknown']);
const numericCollator = new Intl.Collator(undefined, { numeric: true });

function addIdx(m: Map<string, Set<string>>, k: string, id: string) {
  if (!k) return;
  const s = m.get(k) ?? new Set<string>();
  m.set(k, s);
  s.add(id);
}

/** 열차번호 → split(약호·번호 범위) */
export function splitOf(no: string, splits: KricSplit[] | undefined): KricSplit | undefined {
  const m = /^([A-Za-z]*)(\d+)$/.exec(no);
  if (!m) return undefined;
  return (splits ?? []).find(
    (s) =>
      (!s.prefix || s.prefix.toUpperCase() === m[1]!.toUpperCase()) && Number(m[2]) >= s.from && Number(m[2]) <= s.to,
  );
}

/** 2호선 순환: 정차 순서의 역번호(200번대) 증감 투표. 결정 못 하면 null */
export function loopDirection(codes: number[]): 'inner' | 'outer' | null {
  if (codes.length < 2) return null;
  let inc = 0;
  let dec = 0;
  for (let i = 1; i < codes.length; i++) {
    const d = codes[i]! - codes[i - 1]!;
    if (d === 1 || d < -30) inc++;
    else if (d === -1 || d > 30) dec++;
  }
  if (inc > dec) return 'inner';
  if (dec > inc) return 'outer';
  return null;
}

/** 역명 해석기(노선번호·운행 계통 하나에 대해). 못 풀면 null, unresolved 에 센다 */
export function makeNameResolver(args: {
  net: Pick<NetworkContext, 'stations' | 'rafisRefs'>;
  candIds: Iterable<string>;
  manual: Record<string, string | null>;
  rafisAbbr: Map<string, string[]>;
  globalIdx: Map<string, Set<string>>;
  onUnresolved: (raw: string) => void;
  onBadManual?: (raw: string, id: string) => void;
}): (raw: string) => string | null {
  const { net, manual, rafisAbbr, globalIdx } = args;
  const candSet = new Set<string>();
  const candIdx = new Map<string, Set<string>>();
  for (const id of args.candIds) {
    const s = net.stations.get(id);
    if (!s || UNOPENED.has(String(s.status))) continue;
    candSet.add(id);
    addIdx(candIdx, baseKey(s.name_ko), id);
    for (const a of s.aliases) addIdx(candIdx, baseKey(a), id);
  }
  const cache = new Map<string, string | null>();
  const tryKey = (k: string): string | undefined => {
    const c = [...(candIdx.get(k) ?? [])];
    return c.length === 1 ? c[0] : undefined;
  };
  return (raw: string) => {
    if (cache.has(raw)) return cache.get(raw)!;
    const put = (v: string | null) => {
      cache.set(raw, v);
      return v;
    };
    if (Object.prototype.hasOwnProperty.call(manual, raw)) {
      const v = manual[raw];
      if (v === null || v === undefined) return put(null);
      if (net.stations.has(v)) return put(v);
      args.onBadManual?.(raw, v);
      return put(null);
    }
    const bk = baseKey(raw);
    let id = tryKey(bk);
    if (!id)
      for (const full of rafisAbbr.get(raw) ?? []) {
        id = tryKey(baseKey(full));
        if (id) break;
        const viaRef = (net.rafisRefs.get(full) ?? []).filter((x) => candSet.has(x));
        if (viaRef.length === 1) {
          id = viaRef[0];
          break;
        }
      }
    if (!id) {
      const stripped = raw.replace(/^[1-9]|^지하|^신/, '');
      const sk = baseKey(stripped);
      const pref = [...candIdx.entries()]
        .filter(([k]) => k.startsWith(sk) || k.startsWith(bk))
        .flatMap(([, v]) => [...v]);
      const u = [...new Set(pref)];
      if (stripped && u.length === 1) id = u[0];
    }
    if (!id) {
      const g = [...(globalIdx.get(bk) ?? [])];
      if (g.length === 1) id = g[0];
    }
    if (!id) {
      args.onUnresolved(raw);
      return put(null);
    }
    return put(id);
  };
}

/** 노선번호 파일들 → 세트(순수 함수). files 는 노선번호 순으로 처리(같은 조합은 먼저 나온 노선번호가 갖는다) */
export function buildKricSets(
  files: KricFile[],
  cfg: KricConfig,
  rafisAbbr: Map<string, string[]>,
  net: NetworkContext,
  tago: TagoCoverage,
): KricBuildResult {
  const issues = new IssueLog();
  const stName = (id: string) => net.stations.get(id)?.name_ko ?? id;
  const lsOf = lineStationResolver(net.lineStations, (id) => net.services.get(id)?.line_ids);
  const stationsOfLine = new Map<string, string[]>();
  const codeOfLineStation = new Map<string, string>();
  for (const ls of [...net.lineStations].sort((a, b) => a.line_id.localeCompare(b.line_id) || a.seq - b.seq)) {
    const l = stationsOfLine.get(ls.line_id) ?? [];
    stationsOfLine.set(ls.line_id, l);
    l.push(ls.station_id);
    if (ls.station_code) codeOfLineStation.set(`${ls.line_id}|${ls.station_id}`, ls.station_code);
  }
  const globalIdx = new Map<string, Set<string>>();
  for (const s of net.stations.values()) {
    if (UNOPENED.has(String(s.status))) continue;
    addIdx(globalIdx, baseKey(s.name_ko), s.id);
    for (const a of s.aliases) addIdx(globalIdx, baseKey(a), s.id);
  }
  // TAGO 종착역 → (계통, 역) 방향 투표
  const globalUnique = (name: string) => {
    const c = [...(globalIdx.get(baseKey(name)) ?? [])];
    return c.length === 1 ? c[0] : undefined;
  };
  const dirVotes = new Map<string, Record<string, number>>();
  for (const v of tago.destVotes) {
    const id = globalUnique(v.dest_name);
    if (!id) continue;
    const k = `${v.service_id}|${id}`;
    const rec = dirVotes.get(k) ?? {};
    dirVotes.set(k, rec);
    rec[v.direction] = (rec[v.direction] ?? 0) + v.n;
  }
  const covered = new Set(tago.covered);

  type Job = { key: string; file: KricFile; route: KricRoute; serviceId: string | null; trains: KricTrain[] };
  const jobs: Job[] = [];
  const sortedFiles = [...files].sort((a, b) => a.line_no.localeCompare(b.line_no));
  for (const f of sortedFiles) {
    const route = cfg.routes.find((r) => r.line_no === f.line_no) ?? { line_no: f.line_no };
    const bySvc = new Map<string, KricTrain[]>();
    for (const t of f.trains) {
      const sp = splitOf(t.no, route.splits);
      const k = sp ? `${f.line_no}/${sp.service_id}` : f.line_no;
      const l = bySvc.get(k) ?? [];
      bySvc.set(k, l);
      l.push(t);
    }
    for (const [key, trains] of [...bySvc.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))
      jobs.push({
        key,
        file: f,
        route,
        serviceId: key.includes('/') ? key.split('/')[1]! : (route.service_id ?? null),
        trains,
      });
  }

  const out: TimetableSet[] = [];
  const emittedIds = new Set<string>();
  const jobStats: KricJobStats[] = [];
  for (const job of jobs) {
    const lineNo = job.file.line_no;
    const st: KricJobStats = {
      key: job.key,
      line_no: lineNo,
      service_id: job.serviceId,
      trains: job.trains.length,
      stops: 0,
      days: [...new Set(job.trains.map((t) => t.day))].sort(),
      scope: 'capital',
      emitted: {},
      skipped_covered: 0,
      unresolved: {},
    };
    jobStats.push(st);
    if (!job.serviceId) {
      st.scope = 'no_service';
      issues.add(
        '운행정보 노선번호에 운행 계통 매핑 없음(routes)',
        `${lineNo} ${job.file.line_name ?? ''} (열차 ${job.trains.length})`,
      );
      continue;
    }
    const svc = net.services.get(job.serviceId);
    if (!svc) {
      st.scope = 'unknown_service';
      issues.add('routes 의 service_id 가 DB 에 없음', `${lineNo} → ${job.serviceId}`);
      continue;
    }
    // Q85 A: 수도권 권역이 아닌 운행 계통은 시간표를 만들지 않는다
    if (!svc.areas.includes('capital')) {
      st.scope = 'out_of_area';
      continue;
    }
    const serviceId = svc.id;
    const candIds = [
      ...svc.line_ids.flatMap((l) => stationsOfLine.get(l) ?? []),
      ...svc.stop_patterns.flatMap((p) => p),
    ];
    const manualRaw = cfg.names[lineNo];
    const manual = manualRaw && typeof manualRaw === 'object' ? manualRaw : {};
    const resolveName = makeNameResolver({
      net,
      candIds,
      manual,
      rafisAbbr,
      globalIdx,
      onUnresolved: (raw) => {
        st.unresolved[raw] = (st.unresolved[raw] ?? 0) + 1;
      },
      onBadManual: (raw, id) => issues.add('names 의 역 id 가 DB 에 없음', `${lineNo} ${raw} → ${id}`),
    });
    const loopCode = (id: string): number | undefined => {
      if (!job.route.loop_line_id) return undefined;
      const c = codeOfLineStation.get(`${job.route.loop_line_id}|${id}`);
      const n = c ? Number(c) : NaN;
      return Number.isFinite(n) && n >= 200 && n < 300 ? n : undefined;
    };
    const directionOf = (ids: (string | null)[], fromId: string | null, toId: string | null): Direction => {
      if (job.route.direction_rule === 'loop') {
        const codes = ids.map((id) => (id ? loopCode(id) : undefined)).filter((c): c is number => c !== undefined);
        const d = loopDirection(codes);
        if (d) return d;
      }
      if (toId) {
        const v = dirVotes.get(`${serviceId}|${toId}`);
        if (v) {
          const best = Object.entries(v).sort((a, b) => b[1] - a[1])[0];
          if (best && DIRS.has(best[0])) return best[0] as Direction;
        }
      }
      if (fromId && toId)
        for (const p of svc.stop_patterns) {
          const a = p.indexOf(fromId);
          const b = p.indexOf(toId);
          if (a >= 0 && b >= 0 && a !== b) return b > a ? 'down' : 'up';
        }
      // 기점·종점이 정차 패턴에 없으면(이관 때 패턴에서 빠진 역 등) 정차역 중 패턴에 있는 첫·끝 역으로 판정
      for (const p of svc.stop_patterns) {
        const idx = ids.map((id) => (id ? p.indexOf(id) : -1)).filter((i) => i >= 0);
        if (idx.length >= 2 && idx[0] !== idx[idx.length - 1]) return idx[idx.length - 1]! > idx[0]! ? 'down' : 'up';
      }
      return 'unknown';
    };
    type Row = { minute: number; to: string | null; toId: string | null; no: string; note: string | null };
    const groups = new Map<string, { day: DayType; dir: Direction; stationId: string; rows: Row[] }>();
    for (const t of job.trains) {
      const days = cfg.day_types[t.day] as DayType[] | undefined;
      if (!days) {
        issues.add('운행정보 요일구분을 해석할 수 없음(day_types)', `${lineNo} "${t.day}"`);
        continue;
      }
      const ids = t.stops.map((s) => resolveName(s[0]));
      const fromId = resolveName(t.from);
      const toId = resolveName(t.to);
      const dir = directionOf(ids, fromId, toId);
      const toLabel = toId ? stName(toId) : t.to || null;
      const note = cfg.kinds[t.kind] || null;
      t.stops.forEach((s, i) => {
        st.stops++;
        const id = ids[i];
        if (!id) return;
        const isLast = i === t.stops.length - 1;
        const minute = isLast ? (opsMinute(s[1]) ?? opsMinute(s[2])) : (opsMinute(s[2]) ?? opsMinute(s[1]));
        if (minute == null) return;
        for (const day of days) {
          const k = `${id}|${day}|${dir}`;
          const g = groups.get(k) ?? { day, dir, stationId: id, rows: [] };
          groups.set(k, g);
          g.rows.push({ minute, to: toLabel, toId, no: t.no, note });
        }
      });
    }
    for (const [, g] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
      const seen = new Set<string>();
      const rows = g.rows
        .filter((r) => {
          const k = `${r.minute}|${r.to ?? ''}|${r.no}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .sort((a, b) => a.minute - b.minute || numericCollator.compare(a.no, b.no));
      if (!rows.length) continue;
      const ck = `${g.stationId}|${serviceId}|${g.day}|${g.dir}`;
      if (covered.has(ck)) {
        st.skipped_covered++;
        continue;
      }
      const id = `tt-${g.stationId.replace(/^stn-/, '')}-${lineNo.toLowerCase()}-${g.day}-${g.dir}`;
      if (emittedIds.has(id)) {
        issues.add('세트 id 중복(첫 것만 유지)', `${id} (${job.key})`);
        continue;
      }
      covered.add(ck);
      emittedIds.add(id);
      const toCount = new Map<string, number>();
      for (const r of rows) if (r.to) toCount.set(r.to, (toCount.get(r.to) ?? 0) + 1);
      const tops = [...toCount.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([k]) => k);
      const dayNote = [
        ...new Set(job.trains.filter((t) => (cfg.day_types[t.day] ?? []).includes(g.day)).map((t) => t.day)),
      ].join('/');
      const notes = [`운행정보 요일구분 "${dayNote}"`];
      if (g.day === 'saturday' && /\+/.test(dayNote)) notes.push('토요일·공휴일 공통 다이아');
      if (job.route.direction_rule === 'loop') notes.push('내선/외선은 정차 순서(역번호 증가 = 내선)로 판정');
      out.push({
        id,
        station_id: g.stationId,
        line_station_id: lsOf(g.stationId, serviceId),
        service_id: serviceId,
        route_code: lineNo,
        day_type: g.day,
        direction: g.dir,
        direction_label: tops.length ? `${tops.join('·')} 방면` : null,
        day_note: notes.join(' — '),
        data_as_of: job.file.data_as_of ?? null,
        source_id: KRIC_SOURCE,
        import_run_id: null,
        entries: rows.map((r) => ({
          minute: r.minute,
          dest_name: r.to,
          dest_station_id: r.toId,
          train_no: r.no,
          note: r.note,
        })),
      });
      st.emitted[g.day] = (st.emitted[g.day] ?? 0) + 1;
    }
    const unres = Object.entries(st.unresolved).sort((a, b) => b[1] - a[1]);
    if (unres.length)
      issues.add(
        '운행정보 역명을 해석하지 못함(routes.names 로 지정 가능)',
        `${lineNo} ${job.file.line_name ?? ''}: ${unres.map(([n, c]) => `${n}(${c})`).join(', ')}`,
      );
  }
  return {
    sets: out.sort((a, b) => a.id.localeCompare(b.id)),
    jobs: jobStats,
    issues,
    line_nos: sortedFiles.map((f) => f.line_no),
  };
}

// ---------------------------------------------------------------- 입력·DB

export function listKricFiles(dir: string): string[] {
  if (!existsSync(dir)) throw new Error(`운행정보 정규화 디렉터리 없음: ${dir}`);
  return readdirSync(dir)
    .filter((f) => /^all-.+\.json\.gz$/.test(f))
    .sort();
}

export function readKricFile(dir: string, file: string): KricFile {
  return JSON.parse(gunzipSync(readFileSync(join(dir, file))).toString('utf8')) as KricFile;
}

/** DB 의 TAGO 세트에서 이미 있는 조합과 종착역 방향 투표 */
export async function loadTagoCoverage(db: Queryable): Promise<TagoCoverage> {
  const c = await db.query<{ k: string }>(
    `SELECT DISTINCT station_id || '|' || service_id || '|' || day_type || '|' || direction AS k
       FROM timetable_set WHERE source_id = $1 AND service_id IS NOT NULL`,
    [TAGO_SOURCE],
  );
  const v = await db.query<{ service_id: string; direction: string; dest_name: string; n: string }>(
    `SELECT s.service_id, s.direction, e.dest_name, count(*) AS n
       FROM timetable_set s JOIN timetable_entry e ON e.set_id = s.id
      WHERE s.source_id = $1 AND s.service_id IS NOT NULL AND e.dest_name IS NOT NULL
      GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
    [TAGO_SOURCE],
  );
  return {
    covered: new Set(c.rows.map((r) => r.k)),
    destVotes: v.rows.map((r) => ({ ...r, n: Number(r.n) })),
  };
}

export function rafisAbbrMap(v: Record<string, string[]> | null): Map<string, string[]> {
  return new Map(Object.entries(v ?? {}));
}

export interface KricRunOptions {
  /** 노선번호별 정규화 json.gz 디렉터리(기존 저장소 형식) */
  fromRaw?: string;
  /** 원본 xlsx 파일 또는 디렉터리(Q108 A). download 와 함께면 이 디렉터리에 내려받는다 */
  fromXlsx?: string;
  /** 레일포털 원본 xlsx(id 900)를 내려받아 fromXlsx 디렉터리에 저장한 뒤 읽는다(키 불필요) */
  download?: boolean;
  dryRun?: boolean;
  trigger?: RunTrigger;
  /** 대상 노선번호만 */
  lineNos?: string[];
  log?: (m: string) => void;
}

export async function runKricTrainOps(db: Queryable, opts: KricRunOptions = {}): Promise<ImportResult> {
  if (!opts.fromRaw && !opts.fromXlsx)
    throw new Error(
      'kric-train-ops: --from-raw <정규화 json.gz 디렉터리> 또는 --from-xlsx <원본 xlsx|디렉터리> 가 필요하다',
    );
  if (opts.fromRaw && opts.fromXlsx) throw new Error('kric-train-ops: --from-raw 와 --from-xlsx 는 하나만');
  if (opts.download && !opts.fromXlsx)
    throw new Error('kric-train-ops: --download 는 --from-xlsx <저장 디렉터리> 와 함께');
  const log = opts.log ?? (() => {});
  const params = {
    from_raw: opts.fromRaw ?? null,
    from_xlsx: opts.fromXlsx ?? null,
    download: !!opts.download,
    dry_run: !!opts.dryRun,
    line_nos: opts.lineNos ?? null,
  };
  return withRun(db, KRIC_TASK, { trigger: opts.trigger, params, dryRun: opts.dryRun }, async (run) => {
    let xlsxInfo: Record<string, unknown> | null = null;
    const cfg = await requireConfig<KricConfig>(db, KRIC_TASK, 'routes');
    const abbr = rafisAbbrMap(await getConfig<Record<string, string[]>>(db, KRIC_TASK, 'rafis_abbr'));
    if (!abbr.size) run.log.push('- 주의: ingest.config (kric-train-ops, rafis_abbr) 없음 — RAFIS 약어 해석 생략');
    const net = await loadNetworkContext(db);
    const tago = await loadTagoCoverage(db);
    const only = opts.lineNos ? new Set(opts.lineNos) : null;
    let files: KricFile[];
    if (opts.fromXlsx) {
      let xlsxPath: string;
      if (opts.download) {
        const d = await downloadKricXlsx(opts.fromXlsx);
        run.log.push(`- 원본 내려받음: ${d.url} → ${d.path} (${d.bytes} bytes, sha256 ${d.sha256})`);
        xlsxPath = d.path;
      } else xlsxPath = resolveKricXlsx(opts.fromXlsx);
      const x = await normalizeKricXlsx(xlsxPath);
      files = x.files.filter((f) => !only || only.has(f.line_no));
      run.log.push(
        `- 원본 xlsx ${xlsxPath}: 시트 "${x.sheet}", 머리글 ${x.header_row}행, 데이터 ${x.rows}행, 기준일 ${x.data_as_of}, sha256 ${x.sha256}` +
          (Object.keys(x.skipped).length ? `, 행이 적어 건너뛴 노선번호 ${Object.keys(x.skipped).length}개` : ''),
      );
      xlsxInfo = {
        path: xlsxPath,
        sha256: x.sha256,
        bytes: x.bytes,
        rows: x.rows,
        data_as_of: x.data_as_of,
        skipped: x.skipped,
      };
      log(`운행정보 원본 xlsx ${files.length}개 노선번호 정규화(${xlsxPath})`);
    } else {
      const dir = opts.fromRaw!;
      const names = listKricFiles(dir).filter((f) => !only || only.has(f.replace(/^all-|\.json\.gz$/g, '')));
      files = names.map((f) => readKricFile(dir, f));
      log(`운행정보 ${files.length}개 노선번호 읽음(${dir})`);
    }
    const snap = emptySnapshotStats();
    for (const f of files) {
      const ch = await upsertSnapshot(
        db,
        KRIC_TASK,
        f.line_no,
        f.trains,
        { trains: f.trains.length, data_as_of: f.data_as_of ?? null, file_id: f.file_id ?? null },
        opts.dryRun ? null : run.id,
      );
      snap[ch]++;
    }
    const built = buildKricSets(files, cfg, abbr, net, tago);
    let write = { deleted_sets: 0, inserted_sets: 0, inserted_entries: 0 };
    if (!opts.dryRun)
      write = await replaceTimetableSets(
        db,
        { source_id: KRIC_SOURCE, keys: built.line_nos.map((l) => ({ route_code: l })) },
        built.sets,
        run.id,
      );
    const entries = built.sets.reduce((a, s) => a + s.entries.length, 0);
    const unresolvedKinds = built.jobs.reduce((a, j) => a + Object.keys(j.unresolved).length, 0);
    const unresolvedRows = built.jobs.reduce((a, j) => a + Object.values(j.unresolved).reduce((x, y) => x + y, 0), 0);
    const byDay: Record<string, number> = {};
    for (const s of built.sets) byDay[s.day_type] = (byDay[s.day_type] ?? 0) + 1;
    const stats = {
      files: files.length,
      xlsx: xlsxInfo,
      trains: files.reduce((a, f) => a + f.trains.length, 0),
      sets: built.sets.length,
      entries,
      sets_by_day: byDay,
      unresolved_names: unresolvedKinds,
      unresolved_stop_rows: unresolvedRows,
      snapshot: snap,
      write,
      jobs: built.jobs,
      issues: built.issues.counts(),
      issue_samples: built.issues.toJSON(50),
    };
    run.log.push(
      `# ${KRIC_TASK} ${opts.dryRun ? '(dry-run)' : `run ${run.id}`}`,
      '',
      `- 입력 노선번호 ${files.length}(열차 ${stats.trains}) → 세트 ${built.sets.length}, 행 ${entries} (${Object.entries(
        byDay,
      )
        .sort()
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')})`,
      `- 교체: 지움 ${write.deleted_sets}, 넣음 ${write.inserted_sets}세트·${write.inserted_entries}행. 스냅샷 new ${snap.new}·changed ${snap.changed}·same ${snap.same}`,
      `- 미해석 역명 ${unresolvedKinds}종 ${unresolvedRows}행`,
      '',
      '| 노선번호 | 운행 계통 | 범위 | 열차 | 요일구분 | 정차 행 | 미해석 역명 | 추가 세트(요일별) | TAGO 중복으로 생략 |',
      '|---|---|---|---:|---|---:|---|---|---:|',
      ...built.jobs.map(
        (j) =>
          `| ${j.key} | ${j.service_id ?? '-'} | ${j.scope} | ${j.trains} | ${j.days.join(', ')} | ${j.stops} | ${
            Object.entries(j.unresolved)
              .map(([n, c]) => `${n}(${c})`)
              .join(', ') || '-'
          } | ${
            Object.entries(j.emitted)
              .sort()
              .map(([k, v]) => `${k} ${v}`)
              .join(', ') || '-'
          } | ${j.skipped_covered} |`,
      ),
      '',
      ...built.issues.toMarkdown(),
    );
    return { stats };
  });
}
