/** 관리 지도 도구 API(FR-ADM-073·074): OSM way · 노선 선형 · 계획 선형 */
import { applyChangeset, ensureServiceUser, osmWays } from '@k-raildex/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers';

let t: TestApp;
const get = (url: string) => t.app.inject({ method: 'GET', url });

beforeAll(async () => {
  t = await startApp();
  const c = t.fx.client;
  const ex = await c.query<{ id: string }>(
    `INSERT INTO osm.extract (kind, fetched_at) VALUES ('ways', now()) RETURNING id`,
  );
  const way = (id: number, tags: Record<string, string>, coords: [number, number][], construction = false) =>
    c.query(
      `INSERT INTO osm.way (id, extract_id, tags, is_construction, geom)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326))`,
      [
        id,
        ex.rows[0]!.id,
        JSON.stringify(tags),
        construction,
        JSON.stringify({ type: 'LineString', coordinates: coords }),
      ],
    );
  await way(11, { railway: 'subway', name: '시험 1호선', ref: '1' }, [
    [127.0, 37.5],
    [127.1, 37.45],
  ]);
  await way(
    12,
    { railway: 'construction', name: '시험 1호선' },
    [
      [127.1, 37.45],
      [127.152, 37.425],
    ],
    true,
  );
  await way(13, { railway: 'rail', name: '먼 선' }, [
    [129.0, 35.1],
    [129.1, 35.2],
  ]);
  await c.query(
    `INSERT INTO osm.relation (id, extract_id, tags) VALUES (501, $1, '{"name":"시험 relation","route":"subway"}')`,
    [ex.rows[0]!.id],
  );
  await c.query(`INSERT INTO osm.relation_member (relation_id, way_id, seq) VALUES (501, 11, 1), (501, 12, 2)`);
  await applyChangeset(c, {
    title: 'OSM 배정',
    origin: 'legacy_migration',
    author_id: await ensureServiceUser(c, 'system', 'test'),
    ops: [{ op: 'update', entity_type: 'line', id: 'line-fx-one', data: { osm_map: { relation_ids: [501] } } }],
  });
});
afterAll(async () => t?.close());

describe('GET /v1/admin/map/osm-ways', () => {
  it('bbox 안 way, 배정 노선·relation, ODbL 표기', async () => {
    const r = await get('/v1/admin/map/osm-ways?bbox=126.9,37.3,127.3,37.6');
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.attribution).toContain('OpenStreetMap');
    expect(b.truncated).toBe(false);
    expect(b.features.map((f: { id: string }) => f.id)).toEqual(['11', '12']);
    expect(b.features[0].properties).toMatchObject({
      way_id: 11,
      name: '시험 1호선',
      ref: '1',
      railway: 'subway',
      is_construction: false,
      assigned_line_id: 'line-fx-one',
      relation_ids: [501],
    });
    expect(b.relations).toEqual([{ id: 501, name: '시험 relation', ref: null, route: 'subway' }]);
  });

  it('미배정만 · 노선별', async () => {
    const un = (await get('/v1/admin/map/osm-ways?unassigned=true')).json();
    expect(un.features.map((f: { id: string }) => f.id)).toEqual(['13']);
    const byLine = (await get('/v1/admin/map/osm-ways?line_id=line-fx-one')).json();
    expect(byLine.features).toHaveLength(2);
  });

  it('상한을 넘으면 truncated', async () => {
    const r = await osmWays(t.fx.client, { bbox: null, line_id: null, unassigned: false, limit: 2 });
    expect(r.features).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });

  it('bbox 형식 오류는 422', async () => {
    expect((await get('/v1/admin/map/osm-ways?bbox=1,2,3')).statusCode).toBe(422);
    expect((await get('/v1/admin/map/osm-ways?bbox=127,38,126,37')).statusCode).toBe(422);
  });
});

describe('GET /v1/admin/map/line-geometry/:line_id', () => {
  it('배정 way + 노선별 역 점 + osm_map', async () => {
    const r = await get('/v1/admin/map/line-geometry/line-fx-one');
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.attribution).toContain('ODbL');
    expect(b.osm_map).toMatchObject({ relation_ids: [501], include_construction: true });
    const kinds = b.features.map((f: { properties: { kind: string } }) => f.properties.kind);
    expect(kinds.filter((k: string) => k === 'osm_way')).toHaveLength(2);
    expect(kinds.filter((k: string) => k === 'station')).toHaveLength(4);
    expect(b.osm_length_km.operating).toBeGreaterThan(5);
    expect(b.osm_length_km.construction).toBeGreaterThan(3);
    // 역 점은 자체 좌표(근사 좌표 역 라 = 127.15, 37.42)
    const d = b.features.find((f: { properties: { station_id?: string } }) => f.properties.station_id === 'stn-fx-d');
    expect(d.geometry.coordinates).toEqual([127.15, 37.42]);
  });

  it('없는 노선은 404', async () => {
    expect((await get('/v1/admin/map/line-geometry/line-nope')).statusCode).toBe(404);
  });
});

describe('GET /v1/admin/map/plan-geometry/:plan_id', () => {
  it('계획 선형·경유역·표시 선형(OSM 공사 선형 우선)', async () => {
    const r = await get('/v1/admin/map/plan-geometry/plan-fx-ext');
    expect(r.statusCode).toBe(200);
    const b = r.json();
    const g = b.features.filter((f: { properties: { kind: string } }) => f.properties.kind !== 'station');
    expect(g).toHaveLength(1);
    expect(g[0].properties).toMatchObject({ kind: 'schematic', index: 0, via_station_ids: ['stn-fx-c', 'stn-fx-d'] });
    expect(g[0].properties.length_km).toBeGreaterThan(5);
    expect(b.features.filter((f: { properties: { kind: string } }) => f.properties.kind === 'station')).toHaveLength(2);
    expect(b.shape.properties).toMatchObject({ quality: 'osm_construction', odbl: true });
    expect(b.shape.geometry.type).toBe('MultiLineString');
    expect(b.attribution).toContain('ODbL');
    expect(b.refs).toEqual([{ program_id: 'pp-fx-national-rail-4', section: '다~라', length_km: null }]);
  });

  it('없는 계획은 404', async () => {
    expect((await get('/v1/admin/map/plan-geometry/plan-nope')).statusCode).toBe(404);
  });
});

describe('GET /v1/admin/map/current-stations', () => {
  it('선형에 스냅한 근사 좌표 역은 자체 좌표(own_coord)도 준다', async () => {
    await t.fx.client.query('SELECT refresh_derived()');
    const b = (await get('/v1/admin/map/current-stations')).json();
    const d = b.features.find((f: { id: string }) => f.id === 'stn-fx-d');
    expect(d.properties.snapped).toBe(true);
    expect(d.properties.own_coord).toEqual([127.15, 37.42]);
    expect(d.geometry.coordinates).not.toEqual([127.15, 37.42]);
    const a = b.features.find((f: { id: string }) => f.id === 'stn-fx-a');
    expect(a.properties.own_coord).toBeNull();
  });
});
