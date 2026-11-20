import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { codes, fuzzyFrom, fuzzyTo, isValidFuzzy, type FuzzyDate } from '@k-raildex/contracts';
import { freshDb } from './db';

let client: pg.Client;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ client, close } = await freshDb());
});
afterAll(async () => close());

/** 코드값 도메인이 아닌 고정 목록 CHECK(시험 대상에서 제외) */
const NON_CODE_CHECKS = new Set([
  'event_target_role_check',
  'run_trigger_check',
  'run_status_check',
  'match_rule_kind_check',
  'api_endpoint_method_check',
  'document_publishable_chk', // licenseClass 의 부분 집합(공개 가능 라이선스)
]);

describe('codes ↔ DB CHECK 동기화', () => {
  it('모든 IN 목록 CHECK 가 contracts 코드값 도메인 하나와 정확히 같다', async () => {
    const { rows } = await client.query<{ conname: string; def: string }>(
      `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.contype = 'c' AND n.nspname IN ('public', 'ingest', 'osm')`,
    );
    const domainSets = Object.entries(codes).map(([k, v]) => [k, [...v.values].sort().join('|')] as const);
    const mismatches: string[] = [];
    let checked = 0;
    for (const r of rows) {
      if (NON_CODE_CHECKS.has(r.conname)) continue;
      const m = /= ANY \(\(?ARRAY\[(.+?)\]\)?/.exec(r.def) ?? /<@ ARRAY\[(.+?)\]/.exec(r.def);
      if (!m || !m[1]) continue;
      const values = [...m[1].matchAll(/'([^']+)'::text/g)]
        .map((x) => x[1]!)
        .sort()
        .join('|');
      checked++;
      if (!domainSets.some(([, s]) => s === values)) mismatches.push(`${r.conname}: ${values}`);
    }
    expect(checked).toBeGreaterThan(60);
    expect(mismatches).toEqual([]);
  });
});

describe('퍼지 날짜 SQL = TS', () => {
  const cases: [string | null, FuzzyDate['precision'] | null][] = [
    ['2024-02-29', 'day'],
    ['2023-02-29', 'day'],
    ['2027-03', 'month'],
    ['2024-02', 'month'],
    ['2027-13', 'month'],
    ['2028-H1', 'half'],
    ['2028-H2', 'half'],
    ['2030', 'year'],
    [null, 'unknown'],
    ['2030', 'unknown'],
    [null, null],
  ];
  it.each(cases)('%s / %s', async (value, precision) => {
    const { rows } = await client.query(
      `SELECT fuzzy_valid($1, $2) AS valid, fuzzy_from($1, $2)::text AS f, fuzzy_to($1, $2)::text AS t`,
      [value, precision],
    );
    const valid = isValidFuzzy(value, precision);
    expect(rows[0].valid).toBe(valid);
    if (valid && precision) {
      expect(rows[0].f).toBe(fuzzyFrom({ value, precision }));
      expect(rows[0].t).toBe(fuzzyTo({ value, precision }));
    }
  });

  it('초성', async () => {
    const { rows } = await client.query(`SELECT hangul_chosung('서울역 KTX-1') AS c`);
    expect(rows[0].c).toBe('ㅅㅇㅇ KTX-1');
  });
});

describe('핵심 제약', () => {
  async function entity(id: string, type: string) {
    await client.query('INSERT INTO entity (id, type) VALUES ($1, $2)', [id, type]);
  }

  it('역 id 형식·좌표 범위·자기 병합 금지', async () => {
    await entity('stn-test-a', 'station');
    await client.query(
      `INSERT INTO station (id, name_ko, geom, coord_source, checked_at)
       VALUES ('stn-test-a', '테스트', ST_GeogFromText('POINT(127.0 37.5)'), 'manual', '2026-11-20')`,
    );
    await entity('stn-Bad', 'station');
    await expect(
      client.query(`INSERT INTO station (id, name_ko, checked_at) VALUES ('stn-Bad', 'x', '2026-11-20')`),
    ).rejects.toThrow(/station_id_chk/);
    await expect(
      client.query(`UPDATE station SET geom = ST_GeogFromText('POINT(140 37)') WHERE id = 'stn-test-a'`),
    ).rejects.toThrow(/station_geom_bbox_chk/);
    await expect(client.query(`UPDATE station SET merge_into_id = id WHERE id = 'stn-test-a'`)).rejects.toThrow(
      /station_merge_self_chk/,
    );
  });

  it('기대 일정은 추정 금지·출처 필수(Q94 A)', async () => {
    await entity('src-test', 'source');
    await client.query(
      `INSERT INTO source (id, title, publisher, type, license, license_class, retrieved_at, checked_at)
       VALUES ('src-test', '시험', '시험', 'news', '-', 'restricted', '2026-11-20', '2026-11-20')`,
    );
    await entity('plan-test', 'plan');
    await client.query(`INSERT INTO plan (id, name_ko, checked_at) VALUES ('plan-test', '시험 사업', '2026-11-20')`);
    const ins = (basis: string, src: string | null) =>
      client.query(
        `INSERT INTO plan_milestone (plan_id, stage, expected_value, expected_precision, basis, source_id)
         VALUES ('plan-test', 'opened', '2030', 'year', $1, $2)`,
        [basis, src],
      );
    await expect(ins('estimate', 'src-test')).rejects.toThrow(/plan_milestone_basis_source_chk/);
    await expect(ins('press', null)).rejects.toThrow(/plan_milestone_basis_source_chk/);
    await ins('press', 'src-test');
    const { rows } = await client.query(`SELECT expected_from::text f FROM plan_milestone WHERE plan_id = 'plan-test'`);
    expect(rows[0].f).toBe('2030-01-01');
  });

  it('id 변경은 참조로 전파된다(ON UPDATE CASCADE)', async () => {
    await entity('line-test', 'line');
    await client.query(
      `INSERT INTO line (id, name_ko, category, rail_class, status, checked_at)
       VALUES ('line-test', '시험선', 'conventional', 'conventional', 'operating', '2026-11-20')`,
    );
    await entity('ls-test--test-a', 'line_station');
    await client.query(
      `INSERT INTO line_station (id, line_id, station_id, seq, status) VALUES ('ls-test--test-a', 'line-test', 'stn-test-a', 1, 'operating')`,
    );
    await client.query(`UPDATE entity SET id = 'stn-test-b' WHERE id = 'stn-test-a'`);
    const { rows } = await client.query(`SELECT station_id FROM line_station WHERE id = 'ls-test--test-a'`);
    expect(rows[0].station_id).toBe('stn-test-b');
  });
});
