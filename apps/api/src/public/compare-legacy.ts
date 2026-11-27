/**
 * 기존 사이트 데이터 대조 스냅샷 시험(M6 완료 기준 "기존 사이트 화면별 데이터 대조"):
 * 공개 API 읽기 모델(packages/domain/src/public)을 DB 에서 만들고, 기존 시스템 빌드 산출물(future-rail-db/data/build/*.json —
 * 기존 사이트가 화면을 그리던 데이터)과 핵심 필드를 비교해 docs/legacy/public-compare-<날짜>.md 를 쓴다.
 *
 *   pnpm -F @k-raildex/api public:compare [-- --out <파일>]
 *   환경 변수: DATABASE_URL(기본 개발 DB), LEGACY_BUILD_DIR(기본 ../future-rail-db/data/build)
 *
 * DB 는 읽기 전용 연결(default_transaction_read_only)로만 연다. 기존 저장소는 읽기만 한다.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicLine, publicLines, publicPlan, publicPlans, publicStations, type Queryable } from '@k-raildex/domain';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const LIMIT = 40;
const repoRoot = resolve(here, '../../../..');

interface Fuzzy {
  value: string | null;
  precision: string;
}
interface LegacyLine {
  id: string;
  name: { ko: string };
  status: string;
  category: string;
  rail_class: string;
  areas: string[];
  opened_at?: Fuzzy;
  closed_at?: Fuzzy;
  color?: string;
  length_km?: number;
  start_station_id?: string;
  end_station_id?: string;
  is_wide_area?: boolean;
}
interface LegacyLineStation {
  line_id: string;
  station_id: string;
  order: number;
  station_code?: string;
}
interface LegacyStation {
  id: string;
  name: { ko: string };
  status: string;
  opened_at?: Fuzzy;
  closed_at?: Fuzzy;
  line_ids?: string[];
  areas?: string[];
  line_classes?: string[];
  service_kinds?: string[];
  lat?: number;
  kind?: string;
}
interface LegacyPlan {
  id: string;
  name: { ko: string };
  stage: string;
  target_open?: Fuzzy;
  areas: string[];
  line_ids?: string[];
  station_ids?: string[];
  plan_refs: { program: string }[];
  stage_history: unknown[];
}
interface LegacyEvent {
  id: string;
}

/** 필드별 차이 모음 */
class Diffs {
  readonly byField = new Map<
    string,
    { checked: number; diffs: { id: string; legacy: string; current: string; note: string }[] }
  >();

  check(field: string, id: string, legacy: unknown, current: unknown, note?: () => string | undefined): void {
    const f = this.byField.get(field) ?? { checked: 0, diffs: [] };
    this.byField.set(field, f);
    f.checked++;
    const a = show(legacy);
    const b = show(current);
    if (a !== b) f.diffs.push({ id, legacy: a, current: b, note: note?.() ?? '' });
  }
}

function show(v: unknown): string {
  if (v === undefined || v === null || v === '') return '∅';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '∅';
  return String(v);
}

const fuzzy = (f: Fuzzy | null | undefined): string | null =>
  f ? (f.precision === 'unknown' ? '(미상)' : `${f.value}`) : null;
const sorted = (a: readonly string[] | null | undefined): string[] => [...(a ?? [])].sort();

/** 차이 종류 해설(실행 결과를 보고 적은 것 — 같은 분류가 다시 나오면 그대로 쓴다) */
const EXPLAIN: Record<string, string> = {
  'line.status':
    '노선 상태는 이관 때 그대로 옮겼다. 차이가 있으면 이관 뒤 관리 앱 수정(변경 묶음)이나 보정 키 반영이다.',
  'line.opened': '노선 개통일 보정(이관 뒤 수정)·퍼지 날짜 정밀도 정리.',
  'line.areas':
    '권역은 새 시스템에서 v_line_area 로 계산(line_region → ref_region.area_code, 3개 권역 이상이면 national). 기존 build.ts 규칙 이식이라 차이는 시·도(line_region) 데이터 차이다.',
  'line.station_order':
    '역 순서 = 노선역(line_station.seq). 기존 line-stations order 와 다르면 이관 뒤 순서 수정이거나 역 병합(역 = 환승 그룹, Q70 A)으로 노선역의 station_id 가 바뀐 경우.',
  'line.station_codes': '역번호는 노선역으로 옮겼다(Q71 A). 차이는 이관 뒤 역번호 보강·수정.',
  'line.color': '노선 색은 출처가 있는 공식 색만 둔다(색 출처 record_source field color).',
  'station.status':
    '역 상태는 새 시스템에서 노선역 상태로 계산(v_station_status: 운영 > 휴업 > 공사 중 > 계획 > 폐지, Q71 A). 기존은 역 레코드에 직접 적었다 — 다중 노선 역에서 한 노선만 공사 중이거나, 기존 상태가 노선별 상태와 어긋났던 경우.',
  'station.opened':
    '역 개통일은 노선역 개통일 중 가장 이른 것(v_station_status, Q95 A). 기존은 163개 역에만 역 단위로 있었다 — 새 값이 더 많이 채워지는 것은 노선역 개통일(노선 개통일 상속 포함)에서 온 것.',
  'station.closed': '폐지일은 모든 노선역이 폐지일 때만 역 폐지일(v_station_status).',
  'station.line_ids':
    '역 ↔ 노선 = 노선역(v_station_line). 기존 Station.line_ids 와 다르면 노선역 추가·삭제(이관 뒤 수정).',
  'station.areas':
    '역 권역: 시·도가 있으면 그 권역 하나, 없으면 소속 노선 권역(v_station_area). 기존은 일부 역(32)에 areas 가 없었다.',
  'station.line_classes': '소속 노선 rail_class 합집합(없으면 conventional) — 노선역 차이를 따라간다.',
  'station.service_kinds':
    '정차 계통 = 정차 패턴의 노선역, 패턴이 없으면 소속 노선 모든 역(v_station_service). 기존은 정차 패턴의 역 id 로 계산해 운행 계통 노선에 없는 역도 정차로 셌다. 새 정차 패턴은 노선역을 가리키므로, 운행 계통 노선(service_line)에 그 역의 노선역이 없으면 이관 때 정차역에서 뺐다(extra.dropped_stops, reason not_on_service_lines — Soft 목록 X-service-dropped-stops 로 관리 앱에서 보정 대상). 운행 계통 노선을 보태거나 정차역을 다시 넣으면 사라지는 차이(데이터 보정 과제, 코드 차이 아님).',
  'plan.stage':
    '현재 단계 = stage_override ?? 단계 이력 규칙(plan_current_stage). 기존 build-plans.ts 규칙을 이식했고 같은 날 폐기·휴면 정렬(0018)을 고쳤다.',
  'plan.target_open':
    '개통 예정 = 가장 최근에 발표된 opened 기대 일정(plan_milestone, Q88·Q94 A: 공식·보도 근거만). 기존 target_open 에 근거 없는 값이 있었으면 이관 때 빠졌다(목표 미정).',
  'plan.areas': '계획 권역 = plan_region 권역 + 전국 사업(is_national·고속 철도 반영)이면 national(v_plan_area).',
  'plan.line_ids': '계획 ↔ 노선 = plan_line(역할 포함). 역할 판정 때 대상에서 빠진 노선이 있으면 차이.',
  'plan.station_ids': '계획 ↔ 역 = plan_station(역할 포함).',
  'plan.programs': '상위 계획 id 는 pp- 접두사로 바뀌었다(Q69 A) — id_redirect 로 옛 id 를 새 id 로 바꿔 비교한다.',
  'plan.stage_history_count': '단계 이력 행 수(plan_stage_event). 이관 뒤 이력 보강·정리.',
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outArg = args.indexOf('--out');
  const today = new Date().toISOString().slice(0, 10);
  const out = outArg >= 0 ? resolve(args[outArg + 1]!) : resolve(repoRoot, `docs/legacy/public-compare-${today}.md`);
  const legacyDir = resolve(process.env.LEGACY_BUILD_DIR ?? resolve(repoRoot, '../future-rail-db/data/build'));
  const read = <T>(name: string): T => JSON.parse(readFileSync(resolve(legacyDir, name), 'utf8')) as T;
  const legacy = {
    lines: read<LegacyLine[]>('lines.json'),
    lineStations: read<LegacyLineStation[]>('line-stations.json'),
    stations: read<LegacyStation[]>('stations.json'),
    plans: read<LegacyPlan[]>('plans.json'),
    events: read<LegacyEvent[]>('events.json'),
  };

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://raildex:raildex-dev@127.0.0.1:5440/raildex',
    options: '-c default_transaction_read_only=on',
    max: 4,
  });
  const db: Queryable = pool;
  const started = performance.now();
  const dv = (await db.query<{ v: number }>(`SELECT coalesce(max(version), 0)::int AS v FROM data_version`)).rows[0]!.v;
  const redirects = new Map(
    (await db.query<{ old_id: string; new_id: string }>(`SELECT old_id, new_id FROM id_redirect`)).rows.map((r) => [
      r.old_id,
      r.new_id,
    ]),
  );
  const ALL = { limit: 100_000, offset: 0 };
  const d = new Diffs();
  const counts: [string, number, number][] = [];
  const missing: { kind: string; id: string; side: 'legacy_only' | 'current_only' }[] = [];

  // ---------------------------------------------------------------- 노선(/lines/, /lines/[id]/)
  const lines = (await publicLines(db, ALL)).items;
  counts.push(['노선', legacy.lines.length, lines.length]);
  const lineById = new Map(lines.map((l) => [l.id, l]));
  for (const l of legacy.lines) if (!lineById.has(l.id)) missing.push({ kind: 'line', id: l.id, side: 'legacy_only' });
  for (const l of lines)
    if (!legacy.lines.some((x) => x.id === l.id)) missing.push({ kind: 'line', id: l.id, side: 'current_only' });
  const lsByLine = new Map<string, LegacyLineStation[]>();
  for (const x of legacy.lineStations) lsByLine.set(x.line_id, [...(lsByLine.get(x.line_id) ?? []), x]);
  let lineStationTotal = 0;
  for (const old of legacy.lines) {
    if (!lineById.has(old.id)) continue;
    const cur = (await publicLine(db, old.id))!;
    lineStationTotal += cur.stations.length;
    d.check('line.name_ko', old.id, old.name.ko, cur.name_ko);
    d.check('line.status', old.id, old.status, cur.status);
    d.check('line.category', old.id, old.category, cur.category);
    d.check('line.rail_class', old.id, old.rail_class, cur.rail_class);
    d.check('line.is_wide_area', old.id, old.is_wide_area ?? false, cur.is_wide_area ?? false);
    d.check('line.opened', old.id, fuzzy(old.opened_at), fuzzy(cur.opened));
    d.check('line.closed', old.id, fuzzy(old.closed_at), fuzzy(cur.closed));
    d.check('line.areas', old.id, sorted(old.areas), sorted(cur.areas));
    d.check('line.color', old.id, old.color?.toUpperCase(), cur.color?.toUpperCase());
    d.check('line.length_km', old.id, old.length_km, cur.length_km);
    d.check('line.start_station', old.id, old.start_station_id, cur.start_station?.id);
    d.check('line.end_station', old.id, old.end_station_id, cur.end_station?.id);
    const oldOrder = (lsByLine.get(old.id) ?? []).sort((a, b) => a.order - b.order);
    d.check(
      'line.station_order',
      old.id,
      oldOrder.map((x) => x.station_id),
      cur.stations.map((x) => x.station_id),
    );
    d.check('line.station_count', old.id, oldOrder.length, cur.stations.length);
    d.check(
      'line.station_codes',
      old.id,
      oldOrder.map((x) => x.station_code ?? '-'),
      cur.stations.map((x) => x.station_code ?? '-'),
    );
  }
  counts.push(['노선역', legacy.lineStations.length, lineStationTotal]);

  // 이관 때 뺀 정차역(service.extra.dropped_stops) — 정차 계통 차이의 원인 표시
  const dropped = new Map<string, string[]>();
  for (const r of (
    await db.query<{ station_id: string; service: string }>(
      `SELECT x->>'station_id' AS station_id, s.id || '(' || s.kind || ', ' || coalesce(x->>'reason', '') || ')' AS service
         FROM service s, jsonb_array_elements(s.extra->'dropped_stops') x WHERE s.deleted_at IS NULL ORDER BY s.id`,
    )
  ).rows)
    dropped.set(r.station_id, [...(dropped.get(r.station_id) ?? []), r.service]);

  // ---------------------------------------------------------------- 역(/stations/)
  const stations = (await publicStations(db, { ...ALL, include_facilities: true })).items;
  counts.push(['역(시설 포함)', legacy.stations.length, stations.length]);
  const stnById = new Map(stations.map((s) => [s.id, s]));
  for (const s of legacy.stations)
    if (!stnById.has(s.id)) missing.push({ kind: 'station', id: s.id, side: 'legacy_only' });
  for (const s of stations)
    if (!legacy.stations.some((x) => x.id === s.id)) missing.push({ kind: 'station', id: s.id, side: 'current_only' });
  for (const old of legacy.stations) {
    const cur = stnById.get(old.id);
    if (!cur) continue;
    d.check('station.name_ko', old.id, old.name.ko, cur.name_ko);
    d.check('station.kind', old.id, old.kind ?? 'station', cur.kind);
    d.check('station.status', old.id, old.status, cur.status);
    d.check('station.opened', old.id, fuzzy(old.opened_at), fuzzy(cur.opened));
    d.check('station.closed', old.id, fuzzy(old.closed_at), fuzzy(cur.closed));
    d.check('station.line_ids', old.id, sorted(old.line_ids), sorted(cur.line_ids));
    d.check('station.areas', old.id, sorted(old.areas), sorted(cur.areas));
    d.check('station.line_classes', old.id, sorted(old.line_classes), sorted(cur.line_classes));
    d.check('station.service_kinds', old.id, sorted(old.service_kinds), sorted(cur.service_kinds), () =>
      dropped.has(old.id) ? `이관 때 뺀 정차역: ${dropped.get(old.id)!.join(', ')}` : undefined,
    );
    d.check('station.has_coord', old.id, old.lat !== undefined, cur.coord !== null);
  }

  // ---------------------------------------------------------------- 계획(/plans/, /plans/[id]/)
  const plans = (await publicPlans(db, ALL)).items;
  counts.push(['계획', legacy.plans.length, plans.length]);
  const planById = new Map(plans.map((p) => [p.id, p]));
  for (const p of legacy.plans) if (!planById.has(p.id)) missing.push({ kind: 'plan', id: p.id, side: 'legacy_only' });
  for (const p of plans)
    if (!legacy.plans.some((x) => x.id === p.id)) missing.push({ kind: 'plan', id: p.id, side: 'current_only' });
  for (const old of legacy.plans) {
    if (!planById.has(old.id)) continue;
    const cur = (await publicPlan(db, old.id))!;
    d.check('plan.name_ko', old.id, old.name.ko, cur.name_ko);
    d.check('plan.stage', old.id, old.stage, cur.stage);
    d.check('plan.target_open', old.id, fuzzy(old.target_open), cur.target_open ? fuzzy(cur.target_open) : null);
    d.check('plan.areas', old.id, sorted(old.areas), sorted(cur.areas));
    d.check('plan.line_ids', old.id, sorted(old.line_ids), sorted(cur.lines.map((l) => l.line_id)));
    d.check('plan.station_ids', old.id, sorted(old.station_ids), sorted(cur.stations.map((s) => s.station_id)));
    d.check(
      'plan.programs',
      old.id,
      sorted(old.plan_refs.map((r) => redirects.get(r.program) ?? r.program)),
      sorted(cur.refs.map((r) => r.program_id)),
    );
    d.check('plan.stage_history_count', old.id, old.stage_history.length, cur.stage_events.length);
  }

  // ---------------------------------------------------------------- 연표(/timeline/)
  const events = (await db.query<{ id: string }>(`SELECT id FROM v_event_all`)).rows.map((r) => r.id);
  counts.push(['연표 항목', legacy.events.length, events.length]);
  const evSet = new Set(events);
  const legacyEv = new Set(legacy.events.map((e) => e.id));
  const evLegacyOnly = [...legacyEv].filter((id) => !evSet.has(id));
  const evCurrentOnly = events.filter((id) => !legacyEv.has(id));
  const elapsed = ((performance.now() - started) / 1000).toFixed(1);
  await pool.end();

  // ---------------------------------------------------------------- 보고서
  const L: string[] = [];
  L.push(`# 공개 API ↔ 기존 사이트 데이터 대조 (${today})`, '');
  L.push(
    `> \`pnpm -F @k-raildex/api public:compare\` 가 만든 파일(손으로 고치지 말 것). 데이터 판 ${dv}, 기존 빌드 \`${relative(repoRoot, legacyDir)}\`, ${elapsed}초.`,
    '> 새 값 = 공개 API 읽기 모델(packages/domain/src/public), 기존 값 = 기존 사이트 빌드 산출물(data/build/*.json).',
    '',
  );
  L.push('## 1. 건수', '', '| 대상 | 기존 | 새 | 차이 |', '| --- | ---: | ---: | ---: |');
  for (const [k, a, b] of counts) L.push(`| ${k} | ${a} | ${b} | ${b - a} |`);
  L.push('', '연표: 기존에만 ' + evLegacyOnly.length + '건, 새 쪽에만 ' + evCurrentOnly.length + '건.', '');
  if (missing.length) {
    L.push('### 한쪽에만 있는 개체', '', '| 종류 | id | 쪽 |', '| --- | --- | --- |');
    for (const m of missing)
      L.push(`| ${m.kind} | \`${m.id}\` | ${m.side === 'legacy_only' ? '기존에만' : '새 쪽에만'} |`);
    L.push('');
  }
  L.push('## 2. 필드별 요약', '', '| 필드 | 비교 | 차이 | 일치율 |', '| --- | ---: | ---: | ---: |');
  for (const [field, f] of d.byField)
    L.push(
      `| ${field} | ${f.checked} | ${f.diffs.length} | ${(((f.checked - f.diffs.length) / Math.max(f.checked, 1)) * 100).toFixed(1)}% |`,
    );
  L.push('', `## 3. 차이 상세(필드마다 최대 ${LIMIT}건)`, '');
  for (const [field, f] of d.byField) {
    if (!f.diffs.length) continue;
    L.push(`### ${field} — ${f.diffs.length}건`, '');
    if (EXPLAIN[field]) L.push(`해설: ${EXPLAIN[field]}`, '');
    const noted = f.diffs.filter((x) => x.note).length;
    if (noted) L.push(`원인 표시: ${noted}/${f.diffs.length}건`, '');
    L.push('| id | 기존 | 새 | 원인 |', '| --- | --- | --- | --- |');
    for (const x of f.diffs.slice(0, LIMIT))
      L.push(`| \`${x.id}\` | ${cell(x.legacy)} | ${cell(x.current)} | ${cell(x.note)} |`);
    if (f.diffs.length > LIMIT) L.push(`| … | (${f.diffs.length - LIMIT}건 더) | | |`);
    L.push('');
  }
  if (evLegacyOnly.length || evCurrentOnly.length) {
    L.push('## 4. 연표 id 차이(최대 30건씩)', '');
    L.push(
      '파생 이벤트 id 규칙은 기존 build-plans.ts 와 같다(evt-<type>-<대상>-<날짜>). 차이는 개체 날짜·상태 차이(위 필드)에서 온다.',
      '',
    );
    L.push(
      '- 기존에만: ' +
        (evLegacyOnly
          .slice(0, 30)
          .map((x) => `\`${x}\``)
          .join(', ') || '없음'),
    );
    L.push(
      '- 새 쪽에만: ' +
        (evCurrentOnly
          .slice(0, 30)
          .map((x) => `\`${x}\``)
          .join(', ') || '없음'),
      '',
    );
  }
  writeFileSync(out, L.join('\n'));
  try {
    // 저장소 서식(prettier — 루트 개발 의존성)에 맞춘다. 없으면 그대로 둔다
    execFileSync('pnpm', ['exec', 'prettier', '--write', out], { cwd: repoRoot, stdio: 'ignore' });
  } catch {
    console.warn('prettier 를 실행하지 못함 — 보고서 서식은 그대로');
  }
  console.log(`대조 보고서: ${out}`);
  for (const [field, f] of d.byField) if (f.diffs.length) console.log(`  ${field}: ${f.diffs.length}/${f.checked}`);
}

function cell(s: string): string {
  const t = s.replace(/\|/g, '\\|');
  return t.length > 160 ? `${t.slice(0, 160)}…` : t;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
