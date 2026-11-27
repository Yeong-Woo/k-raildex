/**
 * osm-rail 통합 시험(Testcontainers PostGIS): 작은 추출 파일 → osm 스키마 교체·실행 기록·파생(mv_map_line·근사 좌표 역 스냅·
 * v_plan_shape osm_construction), 멱등, 실패 시 이전 데이터 유지, Overpass 실시간 경로(가짜 응답).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freshDb, type FreshDb } from '@k-raildex/db/testing';
import { applyChangeset, ensureServiceUser, fixtureOps, type Queryable } from '@k-raildex/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildOsmDataset,
  fetchOsmLive,
  isConstructionTags,
  OSM_QUERIES,
  runImporter,
  runOsmRail,
  type OsmWaysFile,
  type OverpassPost,
} from '../src';

const way = (id: number, props: Record<string, string>, coords: [number, number][]) => ({
  type: 'Feature' as const,
  id,
  properties: { osm_id: id, ...props },
  geometry: { type: 'LineString' as const, coordinates: coords },
});

const WAYS: OsmWaysFile = {
  extracted_at: '2026-10-13T22:43:03.084Z',
  features: [
    way(101, { railway: 'subway', name: '시험 1호선', ref: '1' }, [
      [127.0, 37.5],
      [127.05, 37.48],
      [127.1, 37.45],
    ]),
    // 운영 중인데 construction 태그만 남은 way → 공사 중 아님
    way(103, { railway: 'rail', name: '다른선', construction: 'rail' }, [
      [126.9, 37.4],
      [126.95, 37.41],
    ]),
    // 좌표 1개(중복 제거 뒤) → 건너뜀
    way(104, { railway: 'rail' }, [
      [126.0, 37.0],
      [126.0, 37.0],
    ]),
  ],
};
const CONSTRUCTION: OsmWaysFile = {
  extracted_at: '2026-10-13T22:44:18.570Z',
  osm_base_timestamp: '2026-10-13T22:43:24Z',
  query: 'way["railway"="construction"]; out geom;',
  features: [
    way(102, { railway: 'construction', construction: 'subway', name: '시험 1호선' }, [
      [127.1, 37.45],
      [127.152, 37.425],
    ]),
    // rail-ways 와 겹치는 way 는 먼저 읽은 것을 쓴다
    way(101, { railway: 'construction', name: '겹침' }, [
      [0, 0],
      [1, 1],
    ]),
  ],
};
const ROUTES = {
  extracted_at: '2026-10-13T22:43:03.084Z',
  routes: [
    {
      osm_id: 9001,
      tags: { type: 'route', route: 'subway', name: '시험 1호선' },
      way_ids: [101, 102, 999],
      relation_ids: [],
    },
    { osm_id: 9002, tags: { type: 'route', route: 'tracks', name: '다른선' }, way_ids: [103], relation_ids: [9001] },
  ],
};
const MANIFEST = {
  extracted_at: '2026-10-13T22:43:03.084Z',
  osm_base_timestamp: '2026-10-13T22:41:23Z',
  queries: { ways_capital: 'Q-ways', ways_highspeed: 'Q-hs', routes_capital: 'Q-routes', routes_tracks_kr: 'Q-tracks' },
};

function writeDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'osm-'));
  for (const [k, v] of Object.entries(files)) writeFileSync(join(dir, k), JSON.stringify(v));
  return dir;
}

describe('buildOsmDataset', () => {
  it('way·relation·member 정규화', () => {
    const part = <T>(name: string, data: T) => ({ name, data, sha256: name });
    const ds = buildOsmDataset({
      ways: part('rail-ways.geojson', WAYS),
      construction: part('rail-construction-kr.geojson', CONSTRUCTION),
      routes: part('rail-routes.json', ROUTES),
      manifest: MANIFEST,
      origin: 'raw',
    });
    expect(ds.ways.map((w) => [w.id, w.extract, w.is_construction])).toEqual([
      [101, 'ways', false],
      [102, 'construction', true],
      [103, 'ways', false],
    ]);
    expect(ds.ways[0]!.tags).toEqual({ railway: 'subway', name: '시험 1호선', ref: '1' });
    expect(ds.members.filter((m) => m.relation_id === 9001).map((m) => [m.way_id, m.seq])).toEqual([
      [101, 1],
      [102, 2],
      [999, 3],
    ]);
    expect(ds.stats).toMatchObject({
      ways: 3,
      ways_construction: 1,
      ways_from_construction_file: 1,
      ways_skipped: 1,
      relations: 2,
      members_missing_way: 1,
      sub_relation_members_skipped: 1,
    });
    expect(ds.extracts.map((e) => [e.kind, e.overpass_query])).toEqual([
      ['ways', 'Q-ways\n\nQ-hs'],
      ['construction', 'way["railway"="construction"]; out geom;'],
      ['routes', 'Q-routes\n\nQ-tracks'],
    ]);
    expect(ds.extracts[0]!.bbox).toEqual([126.9, 37.4, 127.1, 37.5]);
    expect(isConstructionTags({ railway: 'rail', construction: 'rail' })).toBe(false);
  });
});

describe('osm-rail 수집기(DB)', () => {
  let fx: FreshDb;
  let dir: string;
  const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    (await fx.client.query(sql, p)).rows as T[];

  beforeAll(async () => {
    fx = await freshDb();
    const author = await ensureServiceUser(fx.client, 'system', 'test');
    await applyChangeset(fx.client, {
      title: '픽스처',
      origin: 'legacy_migration',
      author_id: author,
      ops: [
        ...fixtureOps(),
        { op: 'update', entity_type: 'line', id: 'line-fx-one', data: { osm_map: { relation_ids: [9001] } } },
        // 같은 relation 을 bbox 로 나눔: way 가운데 꼭짓점이 bbox 안인 way(101)만, 우선순위가 앞서므로 먼저 차지
        {
          op: 'update',
          entity_type: 'line',
          id: 'line-fx-two',
          data: { osm_map: { relation_ids: [9001], bbox: [127.04, 37.47, 127.06, 37.49], priority: -1 } },
        },
      ],
    });
    dir = writeDir({
      'rail-ways.geojson': WAYS,
      'rail-construction-kr.geojson': CONSTRUCTION,
      'rail-routes.json': ROUTES,
      'manifest.json': MANIFEST,
    });
  });
  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    await fx?.close();
  });

  it('dry-run 은 쓰지 않는다', async () => {
    const r = await runImporter(fx.client, 'osm-rail', { fromRaw: dir, dryRun: true });
    expect(r.runId).toBeNull();
    expect(r.stats.ways).toBe(3);
    expect((await q(`SELECT 1 FROM osm.way`)).length).toBe(0);
  });

  it('교체·실행 기록·파생 갱신(선형·근사 좌표 역 스냅·계획 osm_construction)', async () => {
    const r = await runImporter(fx.client, 'osm-rail', { fromRaw: dir });
    expect(r.runId).toBeGreaterThan(0);
    expect(r.stats).toMatchObject({
      inserted_ways: 3,
      inserted_relations: 2,
      inserted_members: 4,
      lines_with_geometry: 2,
      ways_assigned: 2,
      map_line_rows: 2,
      stations_snapped: 1,
      plans_osm_construction: 1,
    });
    const ex = await q<{ kind: string; sha256: string; fetched_at: Date }>(
      `SELECT kind, sha256, fetched_at FROM osm.extract ORDER BY id`,
    );
    expect(ex.map((e) => e.kind)).toEqual(['ways', 'construction', 'routes']);
    expect(ex[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    const w = await q<{ id: string; is_construction: boolean; n: number; tags: Record<string, string> }>(
      `SELECT id, is_construction, ST_NPoints(geom) AS n, tags FROM osm.way ORDER BY id`,
    );
    expect(w.map((x) => [Number(x.id), x.is_construction, x.n])).toEqual([
      [101, false, 3],
      [102, true, 2],
      [103, false, 2],
    ]);
    const run = await q<{ status: string; task: string; log: string }>(
      `SELECT status, task, log FROM ingest.run WHERE id = $1`,
      [r.runId],
    );
    expect(run[0]).toMatchObject({ status: 'done', task: 'osm-rail' });
    expect(run[0]!.log).toContain('relation 2');
    const snap = await q<{ snapped: boolean }>(`SELECT snapped FROM mv_map_station WHERE station_id = 'stn-fx-d'`);
    expect(snap[0]!.snapped).toBe(true);
    // 자체 테이블의 좌표는 그대로(C-6)
    const own = await q<{ x: number }>(`SELECT ST_X(geom::geometry) AS x FROM station WHERE id = 'stn-fx-d'`);
    expect(own[0]!.x).toBeCloseTo(127.15, 6);
    const assigned = await q<{ line_id: string; way_id: string }>(
      `SELECT line_id, way_id FROM osm.v_line_way ORDER BY way_id`,
    );
    expect(assigned.map((a) => [a.line_id, Number(a.way_id)])).toEqual([
      ['line-fx-two', 101],
      ['line-fx-one', 102],
    ]);
    const shape = await q<{ quality: string; odbl: boolean; t: string }>(
      `SELECT quality, odbl, ST_GeometryType(geom) AS t FROM v_plan_shape WHERE plan_id = 'plan-fx-ext'`,
    );
    expect(shape[0]).toEqual({ quality: 'osm_construction', odbl: true, t: 'ST_MultiLineString' });
  });

  it('다시 돌리면 같은 결과(전체 교체)', async () => {
    const r = await runOsmRail(fx.client, { fromRaw: dir });
    expect(r.stats).toMatchObject({ deleted_ways: 3, inserted_ways: 3, deleted_extracts: 3 });
    expect((await q(`SELECT 1 FROM osm.extract`)).length).toBe(3);
    expect((await q(`SELECT 1 FROM osm.relation_member`)).length).toBe(4);
  });

  it('공용 구간(share_with)·개별 way(way_ids): 먼저 차지한 노선이 있어도 함께 배정', async () => {
    const author = await ensureServiceUser(fx.client, 'system', 'test');
    await applyChangeset(fx.client, {
      title: '공용 구간',
      origin: 'admin_edit',
      author_id: author,
      ops: [
        {
          op: 'update',
          entity_type: 'line',
          id: 'line-fx-one',
          data: { osm_map: { relation_ids: [9001], share_with: ['line-fx-two'], way_ids: [103] } },
        },
      ],
    });
    const assigned = await q<{ line_id: string; way_id: string }>(
      `SELECT line_id, way_id FROM osm.v_line_way ORDER BY way_id, line_id`,
    );
    expect(assigned.map((a) => [a.line_id, Number(a.way_id)])).toEqual([
      ['line-fx-one', 101],
      ['line-fx-two', 101],
      ['line-fx-one', 102],
      ['line-fx-one', 103],
    ]);
    // 되돌림(뒤 시험은 원래 배정을 기대)
    await applyChangeset(fx.client, {
      title: '되돌림',
      origin: 'admin_edit',
      author_id: author,
      ops: [{ op: 'update', entity_type: 'line', id: 'line-fx-one', data: { osm_map: { relation_ids: [9001] } } }],
    });
  });

  it('쓰기 도중 실패하면 ROLLBACK — 이전 데이터 유지, 실행 기록 failed', async () => {
    const failing: Queryable = {
      query: ((sql: string, p?: unknown[]) => {
        if (typeof sql === 'string' && sql.includes('INSERT INTO osm.relation_member'))
          return Promise.reject(new Error('boom'));
        return fx.client.query(sql, p);
      }) as Queryable['query'],
    };
    await expect(runOsmRail(failing, { fromRaw: dir })).rejects.toThrow('boom');
    expect((await q(`SELECT 1 FROM osm.way`)).length).toBe(3);
    expect((await q(`SELECT 1 FROM osm.relation_member`)).length).toBe(4);
    const last = await q<{ status: string }>(
      `SELECT status FROM ingest.run WHERE task = 'osm-rail' ORDER BY id DESC LIMIT 1`,
    );
    expect(last[0]!.status).toBe('failed');
  });

  it('추출 파일이 없으면 실패', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'osm-empty-'));
    await expect(runOsmRail(fx.client, { fromRaw: empty })).rejects.toThrow(/OSM 추출 파일 없음/);
    rmSync(empty, { recursive: true, force: true });
  });

  it('실시간(Overpass, 가짜 응답): 429 재시도 뒤 같은 형식으로 적재', async () => {
    const calls: string[] = [];
    let first = true;
    const el = (id: number, tags: Record<string, string>, pts: [number, number][]) => ({
      type: 'way',
      id,
      tags,
      geometry: pts.map(([lon, lat]) => ({ lon, lat })),
    });
    const post: OverpassPost = async (_endpoint, query) => {
      calls.push(query);
      if (first) {
        first = false;
        return { status: 429, text: 'busy' };
      }
      const base = { osm3s: { timestamp_osm_base: '2026-11-20T00:00:00Z' } };
      if (query === OSM_QUERIES.ways_capital)
        return {
          status: 200,
          text: JSON.stringify({
            ...base,
            elements: [
              el(101, { railway: 'subway', name: '시험 1호선' }, [
                [127.0, 37.5],
                [127.1, 37.45],
              ]),
            ],
          }),
        };
      if (query === OSM_QUERIES.ways_tracks_members_kr)
        return {
          status: 200,
          text: JSON.stringify({
            ...base,
            elements: [
              el(103, { railway: 'rail', service: 'yard', name: '시험기지선' }, [
                [127.1, 37.45],
                [127.12, 37.46],
              ]),
            ],
          }),
        };
      if (query === OSM_QUERIES.ways_yards_kr)
        return {
          status: 200,
          text: JSON.stringify({
            ...base,
            elements: [
              el(104, { railway: 'rail', service: 'yard' }, [
                [127.2, 37.3],
                [127.21, 37.31],
              ]),
            ],
          }),
        };
      if (query === OSM_QUERIES.ways_construction_kr)
        return {
          status: 200,
          text: JSON.stringify({
            ...base,
            elements: [
              el(102, { railway: 'construction', name: '시험 1호선' }, [
                [127.1, 37.45],
                [127.152, 37.425],
              ]),
            ],
          }),
        };
      if (query === OSM_QUERIES.routes_capital)
        return {
          status: 200,
          text: JSON.stringify({
            ...base,
            elements: [
              {
                type: 'relation',
                id: 9001,
                tags: { type: 'route', route: 'subway', name: '시험 1호선', extra: 'x' },
                members: [
                  { type: 'way', ref: 101, role: '' },
                  { type: 'way', ref: 102, role: '' },
                  { type: 'node', ref: 5, role: 'stop' },
                ],
              },
            ],
          }),
        };
      return { status: 200, text: JSON.stringify({ ...base, elements: [] }) };
    };
    // 재시도 대기(기본 15초×n)를 줄여 부른다
    const input = await fetchOsmLive({ post, pauseMs: 0, retry: { attempts: 3, waitMs: 1 } });
    expect(calls.length).toBe(8);
    const ds = buildOsmDataset(input);
    expect(ds.ways.map((w) => [w.id, w.is_construction])).toEqual([
      [101, false],
      [102, true],
      [103, false],
      [104, false],
    ]);
    expect(ds.relations[0]!.tags).toEqual({ type: 'route', route: 'subway', name: '시험 1호선' });
    expect(ds.extracts.map((e) => e.overpass_query?.includes('area["ISO3166-1"="KR"]'))).toEqual([true, true, true]);
    expect(ds.extracts[0]!.note).toContain('2026-11-20T00:00:00Z');
  });
});
