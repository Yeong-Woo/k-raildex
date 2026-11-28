/**
 * 트리거·파생 뷰·시점별 지도 시험 (docs/03-data-model.md 6·8·9절).
 * 작은 망을 SQL 로 직접 넣는다(도메인 적용기 시험은 packages/domain 에서).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { freshDb } from './db';

let db: pg.Client;
let close: () => Promise<void>;

const ENTITY_TABLES: Record<string, string> = {
  source: 'source',
  operator: 'operator',
  station: 'station',
  line_station: 'line_station',
  line: 'line',
  service: 'service',
  plan_program: 'plan_program',
  plan: 'plan',
  event: 'event',
};
const CURATED = new Set(['operator', 'station', 'line', 'service', 'plan_program', 'plan', 'event']);
const SRC = 'src-test-notice';
const D = '2026-11-20';

/** 개체 행 + entity 레지스트리 + (큐레이션이면) 레코드 출처를 한 번에 넣는다 */
async function put(table: string, row: Record<string, unknown>) {
  const type = ENTITY_TABLES[table];
  if (type) await db.query('INSERT INTO entity (id, type) VALUES ($1, $2)', [row.id, type]);
  const cols = Object.keys(row);
  const vals = cols.map((c) => row[c]);
  const ph = cols.map((c, i) => (c === 'geom' ? `ST_GeogFromText($${i + 1})` : `$${i + 1}`));
  await db.query(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${ph.join(', ')})`, vals);
  if (type && CURATED.has(type)) {
    await db.query('INSERT INTO record_source (entity_id, source_id) VALUES ($1, $2)', [row.id, SRC]);
  }
}

const pt = (lng: number, lat: number) => `SRID=4326;POINT(${lng} ${lat})`;

beforeAll(async () => {
  ({ client: db, close } = await freshDb());
  await db.query('BEGIN');
  await put('source', {
    id: SRC,
    title: '시험 고시',
    publisher: '국토교통부',
    type: 'notice',
    license: '공공저작물',
    license_class: 'public_work',
    retrieved_at: D,
    checked_at: D,
  });
  // 역: 환승역 A(노선 2개), B, C(공사 중), D(노선 없음, 폐역)
  await put('station', {
    id: 'stn-a',
    name_ko: '가역',
    region_code: '11',
    geom: pt(127.0, 37.5),
    coord_source: 'official',
    checked_at: D,
  });
  await put('station', {
    id: 'stn-b',
    name_ko: '나역',
    region_code: '41',
    geom: pt(127.1, 37.4),
    coord_source: 'official',
    checked_at: D,
  });
  await put('station', {
    id: 'stn-c',
    name_ko: '다역',
    region_code: '41',
    geom: pt(127.2, 37.3),
    coord_source: 'derived',
    coord_basis: 'district',
    checked_at: D,
  });
  await put('station', {
    id: 'stn-d',
    name_ko: '라역',
    region_code: '26',
    own_status: 'closed',
    own_closed_value: '2001',
    own_closed_precision: 'year',
    checked_at: D,
  });
  await put('line', {
    id: 'line-one',
    name_ko: '일호선',
    category: 'metro',
    rail_class: 'urban',
    status: 'operating',
    opened_value: '1990-01-01',
    opened_precision: 'day',
    color: '#0052A4',
    checked_at: D,
    review_status: 'verified',
  });
  await put('line', {
    id: 'line-two',
    name_ko: '이호선',
    category: 'conventional',
    rail_class: 'conventional',
    status: 'operating',
    opened_value: '2005',
    opened_precision: 'year',
    checked_at: D,
  });
  await db.query(
    `INSERT INTO line_region VALUES ('line-one','11'),('line-one','41'),('line-two','11'),('line-two','26'),('line-two','47')`,
  );
  await put('line_station', {
    id: 'ls-one--a',
    line_id: 'line-one',
    station_id: 'stn-a',
    seq: 1,
    status: 'operating',
    opened_value: '1990-01-01',
    opened_precision: 'day',
    station_code: '101',
  });
  await put('line_station', {
    id: 'ls-one--b',
    line_id: 'line-one',
    station_id: 'stn-b',
    seq: 2,
    status: 'operating',
    opened_value: '1990-01-01',
    opened_precision: 'day',
    station_code: '102',
  });
  // 연장 공사 구간(Q22 A: 같은 노선 안 노선별 상태)
  await put('line_station', {
    id: 'ls-one--c',
    line_id: 'line-one',
    station_id: 'stn-c',
    seq: 3,
    status: 'under_construction',
  });
  await put('line_station', {
    id: 'ls-two--a',
    line_id: 'line-two',
    station_id: 'stn-a',
    seq: 1,
    status: 'operating',
    opened_value: '2005-06',
    opened_precision: 'month',
    name_ko: '가역(이호선)',
  });
  // 운행 계통: 정차 패턴 없음 → 노선의 모든 역 정차로 가정
  await put('service', {
    id: 'svc-one',
    name_ko: '일호선 전철',
    kind: 'metro',
    status: 'operating',
    opened_value: '1990-01-01',
    opened_precision: 'day',
    checked_at: D,
  });
  await db.query(`INSERT INTO service_line VALUES ('svc-one', 'line-one', 1)`);
  // 계획: 연장(extends line-one), 단계 이력·기대 일정
  await put('plan_program', {
    id: 'pp-national-rail-4',
    kind: 'national_rail',
    name_ko: '제4차 국가철도망 구축계획',
    short: '4차',
    status: 'current',
    ord: 1,
    checked_at: D,
  });
  await put('plan', { id: 'plan-ext', name_ko: '일호선 연장', checked_at: D });
  await db.query(
    `INSERT INTO plan_ref (plan_id, program_id, class, section, source_id, seq) VALUES ('plan-ext','pp-national-rail-4','new','나~다',$1,1)`,
    [SRC],
  );
  await db.query(
    `INSERT INTO plan_stage_event (plan_id, stage, kind, date_value, date_precision, source_id) VALUES
       ('plan-ext','plan_listed','reached','2021-07-05','day',$1),
       ('plan-ext','basic_plan','reached','2023-03','month',$1),
       ('plan-ext','construction','reached','2024','year',$1)`,
    [SRC],
  );
  await db.query(
    `INSERT INTO plan_milestone (plan_id, stage, expected_value, expected_precision, basis, as_of_value, as_of_precision, source_id) VALUES
       ('plan-ext','opened','2028','year','official','2023-03','month',$1),
       ('plan-ext','opened','2029-H2','half','press','2025-10','month',$1)`,
    [SRC],
  );
  await db.query(`INSERT INTO plan_line (plan_id, line_id, role) VALUES ('plan-ext','line-one','extends')`);
  await db.query(`INSERT INTO plan_station (plan_id, station_id, role) VALUES ('plan-ext','stn-c','new')`);
  await db.query(
    `INSERT INTO plan_geometry (plan_id, kind, via_station_ids, source_id) VALUES ('plan-ext','schematic',ARRAY['stn-b','stn-c'],$1)`,
    [SRC],
  );
  // 계획: 예타 철회로 되돌아간 사업, 휴면 사업, 노선 대체(이호선 대체)
  await put('plan', { id: 'plan-withdrawn', name_ko: '철회 사업', checked_at: D });
  await db.query(
    `INSERT INTO plan_ref (plan_id, program_id, class, source_id, seq) VALUES ('plan-withdrawn','pp-national-rail-4','review',$1,1)`,
    [SRC],
  );
  await db.query(
    `INSERT INTO plan_stage_event (plan_id, stage, kind, date_value, date_precision, source_id) VALUES
       ('plan-withdrawn','plan_listed','reached','2016','year',$1),
       ('plan-withdrawn','feasibility','reached','2019','year',$1),
       ('plan-withdrawn','feasibility','withdrawn','2021','year',$1)`,
    [SRC],
  );
  await put('plan', { id: 'plan-dormant', name_ko: '휴면 사업', checked_at: D });
  await db.query(
    `INSERT INTO plan_ref (plan_id, program_id, class, source_id, seq) VALUES ('plan-dormant','pp-national-rail-4','new',$1,1)`,
    [SRC],
  );
  await db.query(
    `INSERT INTO plan_stage_event (plan_id, stage, kind, date_value, date_precision, source_id) VALUES
       ('plan-dormant','plan_listed','reached','2006','year',$1), ('plan-dormant','dormant','dormant','2016','year',$1)`,
    [SRC],
  );
  await put('plan', { id: 'plan-replace', name_ko: '이호선 대체 신선', checked_at: D, color: '#123456' });
  await db.query(
    `INSERT INTO plan_ref (plan_id, program_id, class, source_id, seq) VALUES ('plan-replace','pp-national-rail-4','new',$1,1)`,
    [SRC],
  );
  await db.query(
    `INSERT INTO plan_stage_event (plan_id, stage, kind, date_value, date_precision, source_id) VALUES ('plan-replace','detail_design','reached','2025','year',$1)`,
    [SRC],
  );
  await db.query(
    `INSERT INTO plan_milestone (plan_id, stage, expected_value, expected_precision, basis, source_id) VALUES ('plan-replace','opened','2032','year','official',$1)`,
    [SRC],
  );
  await db.query(`INSERT INTO plan_line (plan_id, line_id, role) VALUES ('plan-replace','line-two','replaces')`);
  await db.query(
    `INSERT INTO plan_geometry (plan_id, kind, geom, source_id) VALUES ('plan-replace','traced', ST_GeomFromText('MULTILINESTRING((127 37.5, 127.3 37.2))', 4326), $1)`,
    [SRC],
  );
  await db.query('COMMIT');
});
afterAll(async () => close());

describe('트리거', () => {
  it('큐레이션 개체는 출처 없이 커밋할 수 없다(V-H01)', async () => {
    await db.query('BEGIN');
    await db.query(`INSERT INTO entity (id, type) VALUES ('stn-nosrc', 'station')`);
    await db.query(`INSERT INTO station (id, name_ko, checked_at) VALUES ('stn-nosrc', '출처없음', '${D}')`);
    await expect(db.query('COMMIT')).rejects.toThrow(/V-H01/);
  });

  it('개체 유형이 다르면 거부', async () => {
    await db.query('BEGIN');
    await db.query(`INSERT INTO entity (id, type) VALUES ('stn-wrongtype', 'line')`);
    await expect(
      db.query(`INSERT INTO station (id, name_ko, checked_at) VALUES ('stn-wrongtype', 'x', '${D}')`),
    ).rejects.toThrow(/entity_type_guard/);
    await db.query('ROLLBACK');
  });

  it('수정하면 version 이 오르고, 소프트 삭제는 레지스트리·정거장으로 전파·복구된다', async () => {
    await db.query(`UPDATE line SET description = '설명' WHERE id = 'line-two'`);
    const v = await db.query(`SELECT version FROM line WHERE id = 'line-two'`);
    expect(v.rows[0].version).toBe(2);
    await db.query('BEGIN');
    await db.query(`UPDATE line SET deleted_at = now() WHERE id = 'line-two'`);
    const e = await db.query(
      `SELECT deleted_at IS NOT NULL AS d FROM entity WHERE id IN ('line-two', 'ls-two--a') ORDER BY id`,
    );
    expect(e.rows.map((r) => r.d)).toEqual([true, true]);
    await db.query(`UPDATE line SET deleted_at = NULL WHERE id = 'line-two'`);
    const r = await db.query(`SELECT deleted_at FROM line_station WHERE id = 'ls-two--a'`);
    expect(r.rows[0].deleted_at).toBeNull();
    await db.query('COMMIT');
  });

  it('schematic 선형은 경유역 직선으로 채워진다', async () => {
    const { rows } = await db.query(
      `SELECT ST_NumPoints(ST_GeometryN(geom, 1)) AS n FROM plan_geometry WHERE plan_id = 'plan-ext'`,
    );
    expect(rows[0].n).toBe(2);
  });
});

describe('역 파생 값', () => {
  it('역 상태·개통일은 정거장에서 계산(가장 이른 개통), 노선 없는 역은 단독 값', async () => {
    const { rows } = await db.query(
      `SELECT station_id, status, opened_value, closed_value, line_count FROM v_station_status ORDER BY station_id`,
    );
    expect(rows).toEqual([
      { station_id: 'stn-a', status: 'operating', opened_value: '1990-01-01', closed_value: null, line_count: 2 },
      { station_id: 'stn-b', status: 'operating', opened_value: '1990-01-01', closed_value: null, line_count: 1 },
      { station_id: 'stn-c', status: 'under_construction', opened_value: null, closed_value: null, line_count: 1 },
      { station_id: 'stn-d', status: 'closed', opened_value: null, closed_value: '2001', line_count: 0 },
    ]);
  });

  it('노선별 이름·법적 분류·정차 계통(가정)·권역·검수 상속', async () => {
    const names = await db.query(
      `SELECT line_id, name_ko FROM v_station_line WHERE station_id = 'stn-a' ORDER BY line_id`,
    );
    expect(names.rows).toEqual([
      { line_id: 'line-one', name_ko: '가역' },
      { line_id: 'line-two', name_ko: '가역(이호선)' },
    ]);
    const cls = await db.query(`SELECT line_classes FROM v_station_line_class WHERE station_id = 'stn-a'`);
    expect(cls.rows[0].line_classes).toEqual(['conventional', 'urban']);
    const svc = await db.query(
      `SELECT station_id, assumed FROM v_station_service WHERE service_id = 'svc-one' ORDER BY 1`,
    );
    expect(svc.rows).toEqual([
      { station_id: 'stn-a', assumed: true },
      { station_id: 'stn-b', assumed: true },
      { station_id: 'stn-c', assumed: true },
    ]);
    const la = await db.query(`SELECT line_id, areas FROM v_line_area ORDER BY 1`);
    expect(la.rows).toEqual([
      { line_id: 'line-one', areas: ['capital'] },
      { line_id: 'line-two', areas: ['capital', 'southeast', 'daegyeong', 'national'] },
    ]);
    const rv = await db.query(
      `SELECT station_id, review_status FROM v_station_review WHERE station_id IN ('stn-a','stn-d') ORDER BY 1`,
    );
    expect(rv.rows).toEqual([
      { station_id: 'stn-a', review_status: 'verified' },
      { station_id: 'stn-d', review_status: 'unverified' },
    ]);
  });
});

describe('계획 파생 값', () => {
  it('현재 단계: 최고 도달 / 철회 시 직전 단계 / 휴면', async () => {
    const { rows } = await db.query(`SELECT plan_id, stage FROM v_plan_stage ORDER BY plan_id`);
    expect(rows).toEqual([
      { plan_id: 'plan-dormant', stage: 'dormant' },
      { plan_id: 'plan-ext', stage: 'construction' },
      { plan_id: 'plan-replace', stage: 'detail_design' },
      { plan_id: 'plan-withdrawn', stage: 'prefeasibility' },
    ]);
  });

  it('개통 목표 = 가장 최근에 발표된 기대 일정', async () => {
    const { rows } = await db.query(
      `SELECT value, precision, basis FROM v_plan_target_open WHERE plan_id = 'plan-ext'`,
    );
    expect(rows[0]).toEqual({ value: '2029-H2', precision: 'half', basis: 'press' });
    const u = await db.query(`SELECT entity_id, value FROM v_unopened_target WHERE entity_type = 'station'`);
    expect(u.rows).toEqual([{ entity_id: 'stn-c', value: '2029-H2' }]);
  });

  it('파생 연표 id 는 기존 규칙(evt-<type>-<대상>-<날짜>)', async () => {
    const { rows } = await db.query(`SELECT id FROM v_event_all WHERE derived ORDER BY id`);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('evt-opened-one-1990-01-01');
    expect(ids).toContain('evt-opened-a-1990-01-01');
    expect(ids).toContain('evt-service_started-one-1990-01-01'.replace('_', '-'));
    expect(ids).toContain('evt-plan-listed-ext-2021-07-05');
    expect(ids).toContain('evt-closed-d-2001');
  });
});

describe('시점별 지도(미래 지도)', () => {
  const lineIds = async (y: number | null) =>
    (await db.query(`SELECT feature_id, color, color_basis, line_style FROM map_at_lines($1) ORDER BY feature_id`, [y]))
      .rows;

  it('현재: 운영 노선만, 계획 없음', async () => {
    const now = new Date().getFullYear();
    expect((await lineIds(now)).map((r) => r.feature_id)).toEqual(['line:line-one', 'line:line-two']);
  });

  it('2030: 연장(시공, 기존 노선색 실선)이 더해진다', async () => {
    const rows = await lineIds(2030);
    expect(rows.map((r) => r.feature_id)).toEqual(['line:line-one', 'line:line-two', 'plan:plan-ext']);
    expect(rows[2]).toMatchObject({ color: '#0052A4', color_basis: 'extends_line', line_style: 'solid' });
  });

  it('신설·연장 노선이 있는 계획 선형은 노선 이름으로(현재 ↔ 시점 전환에 이름이 바뀌지 않게)', async () => {
    const { rows } = await db.query(`SELECT name_ko FROM map_at_lines(2030) WHERE feature_id = 'plan:plan-ext'`);
    expect(rows).toEqual([{ name_ko: '일호선' }]);
  });

  it('2032: 대체 계획 반영 → 이호선 숨김, 공식색 굵은 점선', async () => {
    const rows = await lineIds(2032);
    expect(rows.map((r) => r.feature_id)).toEqual(['line:line-one', 'plan:plan-ext', 'plan:plan-replace']);
    expect(rows[2]).toMatchObject({ color: '#123456', color_basis: 'official', line_style: 'dashed_bold' });
  });

  it('단계 필터: 시공 이상만', async () => {
    const rows = (await db.query(`SELECT feature_id FROM map_at_lines(NULL, 'construction')`)).rows.map(
      (r) => r.feature_id,
    );
    expect(rows).toContain('plan:plan-ext');
    expect(rows).not.toContain('plan:plan-replace');
  });

  it('역: 공사 중 신설역 다역은 개통 목표 전(현재)에도 보인다', async () => {
    const now = new Date().getFullYear();
    const st = async (y: number) =>
      (await db.query(`SELECT station_id FROM map_at_stations($1) ORDER BY 1`, [y])).rows.map((r) => r.station_id);
    expect(await st(now)).toEqual(['stn-a', 'stn-b', 'stn-c']);
    expect(await st(2030)).toEqual(['stn-a', 'stn-b', 'stn-c']);
  });

  it('계획 하나가 노선 둘을 지으면 노선마다 따로, 목표 전에는 공사 중으로 그려진다', async () => {
    await db.query('BEGIN');
    try {
      await db.query(
        `INSERT INTO osm.way (id, tags, is_construction, geom) VALUES
           (9001, '{}', true, ST_GeomFromText('LINESTRING(127 37, 127.01 37.01)', 4326)),
           (9002, '{}', true, ST_GeomFromText('LINESTRING(127.02 37, 127.03 37.01)', 4326))`,
      );
      await db.query(
        `INSERT INTO line_osm_map (line_id, way_ids, include_construction) VALUES ('line-one', '{9001}', true), ('line-two', '{9002}', true)`,
      );
      await db.query(`INSERT INTO plan_line (plan_id, line_id, role) VALUES ('plan-ext', 'line-two', 'new')`);
      const { rows } = await db.query(
        `SELECT feature_id, name_ko, color_basis FROM map_at_lines(2030) WHERE plan_id = 'plan-ext' ORDER BY feature_id`,
      );
      expect(rows).toEqual([
        { feature_id: 'plan:plan-ext', name_ko: '일호선', color_basis: 'extends_line' },
        { feature_id: 'plan:plan-ext:line-two', name_ko: '이호선', color_basis: expect.any(String) },
      ]);
      // 개통 목표(2029-H2) 전 시점에도 공사 중 구간은 '공사 중'으로 보인다
      const before = await db.query(
        `SELECT feature_id, status FROM map_at_lines($1) WHERE feature_id LIKE '%:construction' ORDER BY feature_id`,
        [new Date().getFullYear()],
      );
      expect(before.rows).toEqual([
        { feature_id: 'line:line-one:construction', status: 'under_construction' },
        { feature_id: 'line:line-two:construction', status: 'under_construction' },
      ]);
    } finally {
      await db.query('ROLLBACK');
    }
  });

  it('OSM 공사 선형이 없는 공사 중 노선은 공사 단계 계획의 계획 선형으로 목표 전에도 보인다(0027)', async () => {
    await db.query('BEGIN');
    try {
      await db.query(`UPDATE line SET status = 'under_construction' WHERE id = 'line-two'`);
      await db.query(`UPDATE plan_line SET line_id = 'line-two', role = 'new' WHERE plan_id = 'plan-ext'`);
      const at = async (y: number) =>
        (
          await db.query(
            `SELECT feature_id, status, quality FROM map_at_lines($1) WHERE line_id = 'line-two' ORDER BY feature_id`,
            [y],
          )
        ).rows;
      expect(await at(new Date().getFullYear())).toEqual([
        { feature_id: 'line:line-two:construction', status: 'under_construction', quality: 'schematic' },
      ]);
      // 개통 목표(2029-H2) 이후에는 계획 선 하나만
      expect(await at(2030)).toEqual([{ feature_id: 'plan:plan-ext', status: 'planned', quality: 'schematic' }]);
    } finally {
      await db.query('ROLLBACK');
    }
  });

  it('역 위치: 현재 지도(mv_map_station, 근사 좌표 스냅)와 같은 점', async () => {
    await db.query('SELECT refresh_derived()');
    const { rows } = await db.query(
      `SELECT a.station_id FROM map_at_stations(2030) a JOIN mv_map_station m USING (station_id)
        WHERE NOT ST_Equals(a.geom, m.geom)`,
    );
    expect(rows).toEqual([]);
  });
});

describe('물리화 뷰', () => {
  it('검색: 이름·노선별 이름·초성·역번호', async () => {
    await db.query('SELECT refresh_derived()');
    const { rows } = await db.query(
      `SELECT DISTINCT entity_id FROM mv_search WHERE name = '가역(이호선)' OR chosung LIKE 'ㄱㅇ%' OR code LIKE '%102%' ORDER BY 1`,
    );
    expect(rows.map((r) => r.entity_id)).toEqual(['stn-a', 'stn-b']);
  });
});
