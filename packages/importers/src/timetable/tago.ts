/**
 * tago-timetable 수집기(docs/08 3-1): TAGO 지하철정보 GetSubwaySttnAcctoSchdulList → 역·노선코드·요일·방향별 timetable_set 교체.
 * 규칙은 기존 build-timetables.ts 1~131행(docs/legacy/design/timetable-model.md "계획 시간표")과 같고, 이관 도구도 이 구현을 쓴다.
 * - 입력: raw 파일(<tago_id>.json.gz, 기존 fetch-tago-timetable.ts 형식) 또는 실시간 API(역마다 요일 01/02/03 × 방향 U/D, 페이지 500행).
 * - day: 01 weekday · 02 saturday · 03 holiday. direction: U up · D down(설정 route_services 의 direction 으로 노선별 재정의, 2호선 U=inner).
 * - 같은 (시각, 종착) 행은 하나만. 시각은 출발, 없으면 도착(04시 이전은 24~27시).
 * - 방면 라벨: 종착역명 빈도순 최대 3개 "A·B 방면", 종착 없는 행이 있으면 fallback_label 을 덧붙인다.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { TimetableSet } from '@k-raildex/contracts';
import type { Queryable } from '@k-raildex/domain';
import { requireConfig } from '../core/config';
import {
  ApiClient,
  ensureEndpoint,
  FatalApiError,
  LimitReached,
  RetryableApiError,
  type EndpointDef,
} from '../core/http';
import type { ApiClientOptions } from '../core/http';
import { IssueLog } from '../core/issues';
import type { RunTrigger } from '../core/run';
import { withRun } from '../core/run';
import { emptySnapshotStats, upsertSnapshot } from '../core/snapshot';
import { lineStationResolver, loadNetworkContext } from './network';
import { tagoMinute, todayKst } from './time';
import { replaceTimetableSets, type ScopeKey } from './writer';

export const TAGO_TASK = 'tago-timetable';
export const TAGO_SOURCE = 'src-tago-subway';

export interface TagoRouteConfig {
  route_id: string;
  name?: string;
  service_id?: string | null;
  direction?: Record<string, string>;
  fallback_label?: Record<string, string>;
  note?: string;
}

export interface TagoRawRow {
  subwayStationId?: string;
  subwayStationNm?: string;
  subwayRouteId: string;
  endSubwayStationId?: string;
  endSubwayStationNm?: string;
  depTime: string;
  arrTime: string;
  dailyTypeCode: string;
  upDownTypeCode: string;
}

export interface TagoRawFile {
  subwayStationId: string;
  station_id?: string;
  retrieved_at: string;
  empty_combos?: string[];
  items: TagoRawRow[];
}

export interface TagoBuildContext {
  tagoToStation: Map<string, string>;
  hasStation: (id: string) => boolean;
  hasService: (id: string) => boolean;
  lineStationOf: (stationId: string, serviceId: string | null) => string | null;
}

export interface TagoBuildResult {
  sets: TimetableSet[];
  issues: IssueLog;
  /** 처리한 raw 파일별 (TAGO ID, 역, 노선코드들) — 교체 범위 계산용 */
  files: { tago_id: string; station_id: string; routes: string[] }[];
  stats: { files: number; rows: number; rows_dropped: number; unmatched_tago: number; line_station_resolved: number };
}

const DAY: Record<string, TimetableSet['day_type']> = { '01': 'weekday', '02': 'saturday', '03': 'holiday' };
const DIR_DEFAULT: Record<string, TimetableSet['direction']> = { U: 'up', D: 'down' };
const DIRECTIONS = new Set(['up', 'down', 'inner', 'outer', 'unknown']);

/** 가장 긴 접두 일치 */
export function tagoRouteMatcher(routes: TagoRouteConfig[]): (routeId: string) => TagoRouteConfig | undefined {
  const sorted = [...routes].sort((a, b) => b.route_id.length - a.route_id.length);
  return (id) => sorted.find((r) => id.startsWith(r.route_id));
}

export function directionLabel(
  rows: { to: string | null }[],
  fallback: string | undefined,
  stripParens: boolean,
): string | null {
  const toCount = new Map<string, number>();
  for (const r of rows) if (r.to) toCount.set(r.to, (toCount.get(r.to) ?? 0) + 1);
  const tops = [...toCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([k]) => (stripParens ? k.replace(/\(.*?\)/g, '').trim() : k));
  let label = tops.length ? `${tops.join('·')} 방면` : null;
  const noTo = rows.some((r) => !r.to);
  if (noTo && fallback) label = tops.length ? `${tops.join('·')}·${fallback.replace(/\s*방면$/, '')} 방면` : fallback;
  return label;
}

/** raw 묶음 → 세트(순수 함수) */
export function buildTagoSets(
  files: Iterable<TagoRawFile>,
  routes: TagoRouteConfig[],
  ctx: TagoBuildContext,
  opts: { sourceId?: string } = {},
): TagoBuildResult {
  const routeOf = tagoRouteMatcher(routes);
  const issues = new IssueLog();
  const byId = new Map<string, TimetableSet & { _tago: string }>();
  const out: TagoBuildResult['files'] = [];
  const stats = { files: 0, rows: 0, rows_dropped: 0, unmatched_tago: 0, line_station_resolved: 0 };
  const unmapped = new Map<string, number>();
  for (const raw of files) {
    stats.files++;
    const tago = raw.subwayStationId;
    const stationId = ctx.tagoToStation.get(tago);
    if (!stationId) {
      stats.unmatched_tago++;
      issues.add('TAGO 역 id 미매칭(시간표 raw)', `${tago} ${raw.items[0]?.subwayStationNm ?? ''}`.trim());
      continue;
    }
    if (!ctx.hasStation(stationId)) {
      issues.add('시간표 역 없음(세트 제외)', `${tago} → ${stationId}`);
      continue;
    }
    const groups = new Map<
      string,
      { route: string; day: string; dir: string; rows: { minute: number; to: string | null }[] }
    >();
    for (const it of raw.items) {
      stats.rows++;
      const minute = tagoMinute(it.depTime) ?? tagoMinute(it.arrTime);
      if (minute == null) {
        stats.rows_dropped++;
        continue;
      }
      const key = `${it.subwayRouteId}|${it.dailyTypeCode}|${it.upDownTypeCode}`;
      const g = groups.get(key) ?? { route: it.subwayRouteId, day: it.dailyTypeCode, dir: it.upDownTypeCode, rows: [] };
      groups.set(key, g);
      g.rows.push({ minute, to: it.endSubwayStationNm?.trim() || null });
    }
    const routesSeen = new Set<string>();
    const sortedGroups = [...groups.values()].sort(
      (a, b) => a.route.localeCompare(b.route) || a.day.localeCompare(b.day) || a.dir.localeCompare(b.dir),
    );
    for (const g of sortedGroups) {
      routesSeen.add(g.route);
      const map = routeOf(g.route);
      if (!map) unmapped.set(g.route, (unmapped.get(g.route) ?? 0) + 1);
      const day = DAY[g.day];
      if (!day) {
        issues.add('알 수 없는 dailyTypeCode', `${tago} ${g.day}`);
        continue;
      }
      const mapped = map?.direction?.[g.dir];
      const direction = (
        mapped && DIRECTIONS.has(mapped) ? mapped : (DIR_DEFAULT[g.dir] ?? 'unknown')
      ) as TimetableSet['direction'];
      const seen = new Set<string>();
      const rows = g.rows
        .filter((r) => {
          const k = `${r.minute}|${r.to ?? ''}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .sort((a, b) => a.minute - b.minute || (a.to ?? '').localeCompare(b.to ?? ''));
      if (!rows.length) continue;
      const id = `tt-${stationId.replace(/^stn-/, '')}-${g.route.toLowerCase()}-${day}-${direction}`;
      const entries: TimetableSet['entries'] = rows.map((r) => ({
        minute: r.minute,
        dest_name: r.to,
        dest_station_id: null,
        train_no: '',
        note: null,
      }));
      const prev = byId.get(id);
      if (prev) {
        // 같은 역에 같은 노선코드가 두 TAGO ID 에서 나오면(환승역) 행을 합친다(기존 상세 파일 규칙)
        issues.add('같은 세트가 두 TAGO ID 에서 생성(행 합침)', `${id} (${prev._tago}, ${tago})`);
        prev.entries = [...prev.entries, ...entries].sort(
          (a, b) => a.minute - b.minute || (a.dest_name ?? '').localeCompare(b.dest_name ?? ''),
        );
        continue;
      }
      let serviceId = map?.service_id ?? null;
      if (serviceId && !ctx.hasService(serviceId)) {
        issues.add('시간표 운행 계통 없음(service_id 비움)', `${id}: ${serviceId}`);
        serviceId = null;
      }
      const lsId = ctx.lineStationOf(stationId, serviceId);
      if (lsId) stats.line_station_resolved++;
      else issues.add('시간표 노선역 미해석', `${id} (${serviceId ?? '운행 계통 없음'})`);
      byId.set(id, {
        _tago: tago,
        id,
        station_id: stationId,
        line_station_id: lsId,
        service_id: serviceId,
        route_code: g.route,
        day_type: day,
        direction,
        direction_label: directionLabel(rows, map?.fallback_label?.[g.dir], true),
        day_note: null,
        data_as_of: raw.retrieved_at ?? null,
        source_id: opts.sourceId ?? TAGO_SOURCE,
        import_run_id: null,
        entries,
      });
    }
    out.push({ tago_id: tago, station_id: stationId, routes: [...routesSeen].sort() });
  }
  for (const [r, n] of unmapped)
    issues.add('subwayRouteId 에 대응하는 운행 계통 매핑 없음(route_services)', `${r} (${n}묶음)`);
  const sets = [...byId.values()]
    .map(({ _tago, ...s }) => {
      void _tago;
      return s;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return { sets, issues, files: out, stats };
}

/** 교체 범위: 처리한 TAGO 역마다 (역, 응답에 나온 노선코드) + (역, TAGO ID 의 접두 노선코드) */
export function tagoScopeKeys(files: TagoBuildResult['files']): ScopeKey[] {
  const keys: ScopeKey[] = [];
  for (const f of files) {
    keys.push({ station_id: f.station_id, route_prefix_of: f.tago_id });
    for (const r of f.routes) keys.push({ station_id: f.station_id, route_code: r });
  }
  return keys;
}

// ---------------------------------------------------------------- raw 파일

export function listTagoRawFiles(dir: string): string[] {
  if (!existsSync(dir)) throw new Error(`TAGO raw 디렉터리 없음: ${dir}`);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json.gz'))
    .sort();
}

export function* readTagoRawDir(dir: string, files = listTagoRawFiles(dir)): Generator<TagoRawFile> {
  for (const f of files) yield JSON.parse(gunzipSync(readFileSync(join(dir, f))).toString('utf8')) as TagoRawFile;
}

// ---------------------------------------------------------------- 실시간 API

export const TAGO_ENDPOINT: EndpointDef = {
  id: 'tago-subway-timetable',
  provider: 'data_go_kr',
  name_ko: 'TAGO 지하철정보 역별 시간표(GetSubwaySttnAcctoSchdulList)',
  base_url: 'http://apis.data.go.kr/1613000/SubwayInfo',
  key_param: 'serviceKey',
  key_env: 'DATA_GO_KR_KEY_TAGO_SUBWAY',
  response_format: 'json',
  daily_limit: 10000,
  source_id: TAGO_SOURCE,
  doc_url: 'https://www.data.go.kr/data/15098554/openapi.do',
  note: 'tago-timetable 수집기가 없으면 만든다(일일 한도 10,000)',
};

interface TagoJson {
  OpenAPI_ServiceResponse?: { cmmMsgHeader?: { returnReasonCode?: string | number; returnAuthMsg?: string } };
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { totalCount?: number | string; items?: { item?: TagoRawRow | TagoRawRow[] } | '' };
  };
}

/** TAGO JSON 응답 해석. 22 = 일일 트래픽 초과, 20·30·31 = 키 오류(재시도 무의미) */
export function parseTagoResponse(text: string): {
  value: { total: number; items: TagoRawRow[] };
  resultCode?: string;
  resultMessage?: string;
} {
  let json: TagoJson;
  try {
    json = JSON.parse(text) as TagoJson;
  } catch {
    throw new RetryableApiError(`JSON 아님: ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
  }
  if (json.OpenAPI_ServiceResponse) {
    const h = json.OpenAPI_ServiceResponse.cmmMsgHeader ?? {};
    const code = String(h.returnReasonCode ?? '');
    if (code === '22') throw new LimitReached(`TAGO 일일 트래픽 초과(${h.returnAuthMsg ?? ''})`);
    if (['20', '30', '31', '12'].includes(code)) throw new FatalApiError(`${code} ${h.returnAuthMsg ?? ''}`);
    throw new RetryableApiError(`${code} ${h.returnAuthMsg ?? ''}`);
  }
  const header = json.response?.header;
  const body = json.response?.body;
  if (header && header.resultCode !== '00' && header.resultCode !== '03')
    throw new RetryableApiError(`resultCode ${header.resultCode} ${header.resultMsg ?? ''}`);
  const raw = body && typeof body.items === 'object' ? body.items.item : undefined;
  const items: TagoRawRow[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return {
    value: { total: Number(body?.totalCount ?? items.length), items },
    resultCode: header?.resultCode,
    resultMessage: header?.resultMsg,
  };
}

const rowKey = (r: TagoRawRow) =>
  [r.dailyTypeCode, r.upDownTypeCode, r.subwayRouteId, r.endSubwayStationId, r.depTime, r.arrTime].join('|');
const timeKey = (r: TagoRawRow) => (r.depTime !== '0' ? r.depTime : r.arrTime).padStart(6, '0');

/** 역 하나: 요일 3 × 방향 2 조합을 페이지까지 순차 호출 → raw 파일과 같은 모양(중복 제거·결정적 정렬) */
export async function fetchTagoStation(
  client: ApiClient,
  tagoId: string,
  opts: { gapMs?: number; sleep?: (ms: number) => Promise<void>; today?: string } = {},
): Promise<TagoRawFile> {
  const seen = new Map<string, TagoRawRow>();
  const empty: string[] = [];
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (const dailyTypeCode of ['01', '02', '03'])
    for (const upDownTypeCode of ['U', 'D']) {
      let page = 1;
      let got = 0;
      let total: number;
      do {
        const r = await client.request(
          'GetSubwaySttnAcctoSchdulList',
          {
            _type: 'json',
            subwayStationId: tagoId,
            dailyTypeCode,
            upDownTypeCode,
            numOfRows: '500',
            pageNo: String(page),
          },
          (res) => parseTagoResponse(res.text),
        );
        total = r.total;
        for (const it of r.items) {
          got++;
          const k = rowKey(it);
          if (!seen.has(k)) seen.set(k, it);
        }
        if (r.items.length === 0) break;
        page++;
        if (opts.gapMs) await sleep(opts.gapMs);
      } while (got < total && page <= 10);
      if (total === 0) empty.push(`${dailyTypeCode}${upDownTypeCode}`);
    }
  const items = [...seen.values()].sort(
    (a, b) =>
      a.dailyTypeCode.localeCompare(b.dailyTypeCode) ||
      a.upDownTypeCode.localeCompare(b.upDownTypeCode) ||
      timeKey(a).localeCompare(timeKey(b)) ||
      (a.endSubwayStationId ?? '').localeCompare(b.endSubwayStationId ?? '') ||
      a.subwayRouteId.localeCompare(b.subwayRouteId),
  );
  return { subwayStationId: tagoId, retrieved_at: opts.today ?? todayKst(), empty_combos: empty, items };
}

// ---------------------------------------------------------------- 실행

export interface TagoRunOptions {
  /** raw 디렉터리(<tago_id>.json.gz). 없으면 실시간 API */
  fromRaw?: string;
  dryRun?: boolean;
  trigger?: RunTrigger;
  /** 대상 TAGO 역 ID 만(실시간·raw 둘 다) */
  tagoIds?: string[];
  /** 실시간: 수도권(capital) 역만(기본) 또는 all */
  area?: 'capital' | 'all';
  /** 실시간: 이번 실행 최대 역 수 */
  limit?: number;
  /** 실시간: 호출 상한(기본 9,000 — 일일 한도 10,000 안) */
  maxCalls?: number;
  gapMs?: number;
  api?: ApiClientOptions;
  log?: (m: string) => void;
}

export interface ImportResult {
  runId: number | null;
  stats: Record<string, unknown>;
  log: string[];
}

export async function runTagoTimetable(db: Queryable, opts: TagoRunOptions = {}): Promise<ImportResult> {
  const log = opts.log ?? (() => {});
  const params = {
    from_raw: opts.fromRaw ?? null,
    dry_run: !!opts.dryRun,
    tago_ids: opts.tagoIds ?? null,
    area: opts.area ?? 'capital',
    limit: opts.limit ?? null,
  };
  return withRun(db, TAGO_TASK, { trigger: opts.trigger, params, dryRun: opts.dryRun }, async (run) => {
    const routes = await requireConfig<TagoRouteConfig[]>(db, TAGO_TASK, 'route_services');
    const net = await loadNetworkContext(db);
    const lsOf = lineStationResolver(net.lineStations, (id) => net.services.get(id)?.line_ids);
    const ctx: TagoBuildContext = {
      tagoToStation: net.tagoToStation,
      hasStation: (id) => net.stations.has(id),
      hasService: (id) => net.services.has(id),
      lineStationOf: lsOf,
    };
    const raws: TagoRawFile[] = [];
    let calls = 0;
    let stoppedBy: string | null = null;
    const only = opts.tagoIds ? new Set(opts.tagoIds) : null;
    if (opts.fromRaw) {
      const names = listTagoRawFiles(opts.fromRaw).filter((f) => !only || only.has(f.replace(/\.json\.gz$/, '')));
      for (const r of readTagoRawDir(opts.fromRaw, names)) raws.push(r);
      log(`raw ${names.length}건 읽음(${opts.fromRaw})`);
    } else {
      const endpoint = await ensureEndpoint(db, TAGO_ENDPOINT);
      const client = new ApiClient(db, endpoint, { maxCalls: opts.maxCalls ?? 9000, ...opts.api });
      const area = opts.area ?? 'capital';
      const tr = await db.query<{ code: string; capital: boolean }>(
        `SELECT DISTINCT e.code, coalesce('capital' = ANY(a.areas), false) AS capital
           FROM external_ref e LEFT JOIN line_station ls ON ls.id = e.entity_id
           LEFT JOIN v_station_area a ON a.station_id = coalesce(ls.station_id, e.entity_id)
          WHERE e.system = 'tago_subway' ORDER BY 2 DESC, 1`,
      );
      let targets = tr.rows
        .filter((t) => (area === 'all' || t.capital) && (!only || only.has(t.code)))
        .map((t) => t.code);
      if (opts.limit) targets = targets.slice(0, opts.limit);
      log(`실시간 대상 TAGO ID ${targets.length}`);
      for (const t of targets) {
        try {
          raws.push(await fetchTagoStation(client, t, { gapMs: opts.gapMs ?? 250, sleep: opts.api?.sleep }));
        } catch (e) {
          if (e instanceof LimitReached || e instanceof FatalApiError) {
            stoppedBy = `${e.name}: ${e.message}`;
            log(`중단: ${stoppedBy} (받은 역 ${raws.length})`);
            break;
          }
          run.log.push(`- 실패 ${t}: ${(e as Error).message}`);
        }
      }
      calls = client.calls;
    }
    // 스냅샷(역별 정규화 행) — 바뀐 역 수 집계
    const snap = emptySnapshotStats();
    for (const r of raws) {
      const ch = await upsertSnapshot(
        db,
        TAGO_TASK,
        r.subwayStationId,
        r.items,
        { rows: r.items.length, retrieved_at: r.retrieved_at, empty_combos: r.empty_combos ?? [] },
        opts.dryRun ? null : run.id,
      );
      snap[ch]++;
    }
    const built = buildTagoSets(raws, routes, ctx);
    let write = { deleted_sets: 0, inserted_sets: 0, inserted_entries: 0 };
    if (!opts.dryRun && built.sets.length + built.files.length > 0) {
      write = await replaceTimetableSets(
        db,
        { source_id: TAGO_SOURCE, keys: tagoScopeKeys(built.files) },
        built.sets,
        run.id,
      );
    }
    const entries = built.sets.reduce((a, s) => a + s.entries.length, 0);
    const stats = {
      ...built.stats,
      sets: built.sets.length,
      entries,
      api_calls: calls,
      stopped_by: stoppedBy,
      snapshot: snap,
      write,
      issues: built.issues.counts(),
      issue_samples: built.issues.toJSON(50),
    };
    run.log.push(
      `# ${TAGO_TASK} ${opts.dryRun ? '(dry-run)' : `run ${run.id}`}`,
      '',
      `- 입력 ${raws.length}역(행 ${built.stats.rows}, 시각 없음 ${built.stats.rows_dropped}) → 세트 ${built.sets.length}, 행 ${entries}`,
      `- 교체: 지움 ${write.deleted_sets}, 넣음 ${write.inserted_sets}세트·${write.inserted_entries}행. 스냅샷 new ${snap.new}·changed ${snap.changed}·same ${snap.same}`,
      '',
      ...built.issues.toMarkdown(),
    );
    return { stats };
  });
}
