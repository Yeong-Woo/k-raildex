import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers';

let t: TestApp;
const SRC = [{ source_id: 'src-fixture-notice' }];
const stationBody = (id: string, name: string) => ({ id, name_ko: name, checked_at: '2026-11-20', sources: SRC });

const req = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown, headers = {}) =>
  t.app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}), headers });

beforeAll(async () => {
  t = await startApp(); // AUTH_DEV_BYPASS=1
});
afterAll(async () => t?.close());

describe('개발 우회(AUTH_DEV_BYPASS)', () => {
  it('Cloudflare 를 거친 요청(Cf-Connecting-Ip·Cf-Ray)에는 우회하지 않는다', async () => {
    expect((await req('GET', '/v1/admin/station?limit=1')).statusCode).toBe(200);
    for (const h of [{ 'cf-connecting-ip': '203.0.113.5' }, { 'cf-ray': '8abc-ICN' }]) {
      const r = await req('GET', '/v1/admin/station?limit=1', undefined, h);
      expect(r.statusCode).toBe(401);
    }
  });
});

describe('목록·상세', () => {
  it('목록: 필터·정렬·쪽', async () => {
    const r = await req('GET', '/v1/admin/station?limit=2&offset=1&sort=-name_ko');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ total: 6, limit: 2, offset: 1 });
    expect(r.json().items.map((i: { name_ko: string }) => i.name_ko)).toEqual(['마', '라']);
    const ls = await req('GET', '/v1/admin/line-station?line_id=line-fx-two&sort=seq');
    expect(ls.json().items.map((i: { id: string }) => i.id)).toEqual(['ls-fx-two--fx-a', 'ls-fx-two--fx-e']);
    expect((await req('GET', '/v1/admin/plan?status=construction')).json().total).toBe(1);
  });

  it('잘못된 쿼리 → 400/422, 모르는 종류 → 404', async () => {
    const bad = await req('GET', '/v1/admin/station?limit=1000');
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatchObject({
      code: 'bad_request',
      details: [expect.objectContaining({ path: 'limit' })],
    });
    const sort = await req('GET', '/v1/admin/station?sort=geom');
    expect(sort.statusCode).toBe(422);
    expect(sort.json().error.code).toBe('validation');
    const unk = await req('GET', '/v1/admin/spaceship');
    expect(unk.statusCode).toBe(404);
    expect(unk.json().error.code).toBe('not_found');
    const noRoute = await req('GET', '/v1/nothing/here/at/all');
    expect(noRoute.statusCode).toBe(404);
    expect(noRoute.json().error.code).toBe('not_found');
  });

  it('상세: ETag·derived·referenced_by', async () => {
    const r = await req('GET', '/v1/admin/station/stn-fx-a');
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(r.headers.etag).toBe(`W/"${b.data.version}"`);
    expect(b.version).toBe(b.data.version);
    expect(b.data.names).toEqual([expect.objectContaining({ name: '가역' })]);
    expect(b.derived).toMatchObject({
      status: 'operating',
      areas: ['capital'],
      line_count: 2,
      review_status: 'unverified',
      opened: { value: '1990-01-01', precision: 'day' },
    });
    expect(b.referenced_by.total).toBeGreaterThan(0);
    expect(b.referenced_by.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ table: 'line_station', owner_type: 'line_station' })]),
    );
    const plan = (await req('GET', '/v1/admin/plan/plan-fx-ext')).json();
    expect(plan.derived).toMatchObject({
      stage: 'construction',
      target_open: { value: '2029-H2', precision: 'half', basis: 'press' },
      areas: ['capital'],
    });
    const line = (await req('GET', '/v1/admin/line/line-fx-one')).json();
    expect(line.derived).toEqual({ areas: ['capital'], branch_of_line_id: null, branch_line_ids: [] });
    expect((await req('GET', '/v1/admin/station/stn-fx-none')).statusCode).toBe(404);
  });

  it('lookup·reference·references', async () => {
    const l = (await req('GET', '/v1/admin/lookup?type=station&q=%EA%B0%80')).json();
    expect(l.items[0]).toMatchObject({ id: 'stn-fx-a', label: '가' });
    const ref = (await req('GET', '/v1/admin/reference')).json();
    expect(ref.codes.status).toEqual(expect.arrayContaining([{ value: 'operating', label: '운영 중' }]));
    expect(ref.regions.length).toBe(17);
    expect(ref.areas.map((a: { code: string }) => a.code)).toContain('capital');
    expect(Array.isArray(ref.external_systems)).toBe(true);
    const refs = (await req('GET', '/v1/admin/entities/line-fx-one/references')).json();
    expect(refs.type).toBe('line');
    expect(refs.items.map((r: { table: string }) => r.table)).toEqual(
      expect.arrayContaining(['service_line', 'plan_line']),
    );
  });

  it('openapi.json', async () => {
    const r = await req('GET', '/v1/openapi.json');
    expect(r.statusCode).toBe(200);
    const doc = r.json();
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining(['StationCreate', 'StationUpdate', 'StationRead', 'PlanRead', 'LineStationCreate']),
    );
    expect(doc.components.schemas.StationCreate.properties.name_ko).toBeDefined();
    expect(doc.paths['/v1/admin/line-station/{id}'].patch).toBeDefined();
  });
});

describe('쓰기', () => {
  it('생성 201·중복 409·형식 422·JSON 오류 400·dry_run', async () => {
    const dry = await req('POST', '/v1/admin/station?dry_run=true', stationBody('stn-fx-dry', '시험'));
    expect(dry.statusCode).toBe(200);
    expect(dry.json()).toMatchObject({ dry_run: true, data_version: null, id: 'stn-fx-dry' });
    expect((await req('GET', '/v1/admin/station/stn-fx-dry')).statusCode).toBe(404);

    const r = await req('POST', '/v1/admin/station?changeset_title=새 역', stationBody('stn-fx-new', '새역'));
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ id: 'stn-fx-new', version: 1, dry_run: false, warnings: [] });
    expect(r.json().changeset_id).toMatch(/^cs-/);
    expect(r.json().data_version).toBeGreaterThan(0);
    expect(r.headers.etag).toBe('W/"1"');

    const dup = await req('POST', '/v1/admin/station', stationBody('stn-fx-new', '새역'));
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('id_taken');

    const bad = await req('POST', '/v1/admin/station', { id: 'stn-fx-bad', name_ko: '' });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe('validation');
    expect(bad.json().error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'schema', path: expect.stringContaining('name_ko') })]),
    );

    const json = await t.app.inject({
      method: 'POST',
      url: '/v1/admin/station',
      headers: { 'content-type': 'application/json' },
      payload: '{nope',
    });
    expect(json.statusCode).toBe(400);
    expect(json.json().error.code).toBe('bad_request');
  });

  it('PATCH: If-Match 없음 428, 오래된 version 409, 성공 시 version+1', async () => {
    const none = await req('PATCH', '/v1/admin/station/stn-fx-new', { address: 'a' });
    expect(none.statusCode).toBe(428);
    expect(none.json().error.code).toBe('precondition_required');
    const ok = await req('PATCH', '/v1/admin/station/stn-fx-new', { address: 'a' }, { 'if-match': 'W/"1"' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ version: 2, data: { address: 'a' } });
    expect(ok.headers.etag).toBe('W/"2"');
    const stale = await req('PATCH', '/v1/admin/station/stn-fx-new', { address: 'b' }, { 'if-match': '1' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: 'version_conflict', current_version: 2 });
    const garbage = await req('PATCH', '/v1/admin/station/stn-fx-new', { address: 'b' }, { 'if-match': 'abc' });
    expect(garbage.statusCode).toBe(400);
  });

  it('검증(dry run)', async () => {
    const good = await req('POST', '/v1/admin/station/validate', stationBody('stn-fx-val', '검증'));
    expect(good.statusCode).toBe(200);
    expect(good.json().valid).toBe(true);
    const bad = await req('POST', '/v1/admin/station/validate?id=stn-fx-new', { geom: { lat: 37.5, lng: 127 } });
    expect(bad.json()).toMatchObject({ valid: false, error: { code: 'validation' } });
    expect((await req('GET', '/v1/admin/station/stn-fx-val')).statusCode).toBe(404);
  });

  it('참조가 있으면 삭제 409 + 참조 목록', async () => {
    const r = await req('DELETE', '/v1/admin/station/stn-fx-a');
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('referenced');
    expect(r.json().error.references.length).toBeGreaterThan(0);
  });

  it('삭제·휴지통·복구·영구 삭제', async () => {
    const del = await req('DELETE', '/v1/admin/station/stn-fx-new', { reason: '시험 삭제' });
    expect(del.statusCode).toBe(200);
    expect(del.json().data.deleted_at).not.toBeNull();
    expect((await req('GET', '/v1/admin/station/stn-fx-new')).statusCode).toBe(404);
    expect((await req('GET', '/v1/admin/station/stn-fx-new?include_deleted=true')).statusCode).toBe(200);
    const trash = (await req('GET', '/v1/admin/trash')).json();
    expect(trash.items.map((i: { id: string }) => i.id)).toEqual(['stn-fx-new']);
    expect((await req('GET', '/v1/admin/trash?type=line')).json().total).toBe(0);

    const restore = await req('POST', '/v1/admin/station/stn-fx-new/restore');
    expect(restore.statusCode).toBe(200);
    expect(restore.json().data.deleted_at).toBeNull();
    const again = await req('POST', '/v1/admin/station/stn-fx-new/restore');
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('invalid_state');

    // 휴지통에 없으면 영구 삭제 불가
    expect((await req('DELETE', '/v1/admin/station/stn-fx-new?purge=true')).statusCode).toBe(409);
    await req('DELETE', '/v1/admin/station/stn-fx-new?reason=again');
    const purge = await req('DELETE', '/v1/admin/station/stn-fx-new?purge=true');
    expect(purge.statusCode).toBe(200);
    expect(purge.json()).toMatchObject({ id: 'stn-fx-new', data: null });
    expect((await req('GET', '/v1/admin/station/stn-fx-new?include_deleted=true')).statusCode).toBe(404);
    // id 영구 예약
    expect((await req('POST', '/v1/admin/station', stationBody('stn-fx-new', '재사용'))).statusCode).toBe(409);
  });

  it('이력', async () => {
    await req('POST', '/v1/admin/station', stationBody('stn-fx-hist', '이력'));
    await req('PATCH', '/v1/admin/station/stn-fx-hist', { address: 'x' }, { 'if-match': '1' });
    const h = (await req('GET', '/v1/admin/station/stn-fx-hist/history')).json();
    expect(h.total).toBe(2);
    expect(h.items.map((i: { op: string }) => i.op)).toEqual(['update', 'create']);
    expect(h.items[0]).toMatchObject({ origin: 'admin_edit', entity_id: 'stn-fx-hist' });
  });

  it('ID 변경(옛 id 이력 포함)', async () => {
    const r = await req('POST', '/v1/admin/entities/stn-fx-hist/rename', { new_id: 'stn-fx-renamed', reason: '표기' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: 'stn-fx-renamed', old_id: 'stn-fx-hist' });
    expect((await req('GET', '/v1/admin/station/stn-fx-renamed')).statusCode).toBe(200);
    expect((await req('GET', '/v1/admin/station/stn-fx-hist')).statusCode).toBe(404);
    const h = (await req('GET', '/v1/admin/station/stn-fx-renamed/history')).json();
    expect(h.items.map((i: { op: string }) => i.op)).toEqual(['rename_id', 'update', 'create']);
    const bad = await req('POST', '/v1/admin/entities/stn-fx-renamed/rename', { new_id: 'line-wrong' });
    expect(bad.statusCode).toBe(422);
    expect((await req('POST', '/v1/admin/entities/stn-none/rename', { new_id: 'stn-x' })).statusCode).toBe(404);
  });
});

describe('노선역 목록', () => {
  const url = '/v1/admin/lines/line-fx-one/stations';
  type Ls = { id: string; seq: number; version: number; station_id: string; station_name_ko: string };

  it('GET: 순서대로', async () => {
    const r = (await req('GET', url)).json();
    expect(r.items.map((i: Ls) => i.id)).toEqual([
      'ls-fx-one--fx-a',
      'ls-fx-one--fx-b',
      'ls-fx-one--fx-c',
      'ls-fx-one--fx-d',
    ]);
    expect(r.items[0].station_name_ko).toBe('가');
    // 역 쪽 종류·좌표(지도 편집기가 화물역·신호장 좌표도 찾게)
    expect(r.items[0].station_kind).toBe('station');
    expect(r.items[0].station_geom).toEqual({ lng: expect.any(Number), lat: expect.any(Number) });
  });

  it('PUT: 순서 뒤집기(seq 맞바꿈은 지연 유일 제약이 받아 준다)', async () => {
    const cur = (await req('GET', url)).json().items as Ls[];
    const items = [...cur].reverse().map((i) => ({ id: i.id, version: i.version }));
    const r = await req('PUT', url, { items });
    expect(r.statusCode).toBe(200);
    expect(r.json().items.map((i: Ls) => i.id)).toEqual(cur.map((i) => i.id).reverse());
    expect(r.json().items.map((i: Ls) => i.seq)).toEqual([1, 2, 3, 4]);
    expect(r.json().ops.every((o: { op: string }) => o.op === 'update')).toBe(true);
    // 같은 목록 다시 → 바뀐 것 없음
    const same = await req('PUT', url, { items: r.json().items.map((i: Ls) => ({ id: i.id })) });
    expect(same.json()).toMatchObject({ changeset_id: null, ops: [] });
  });

  it('PUT: 오래된 version → 409, 다른 노선의 id → 422', async () => {
    const cur = (await req('GET', url)).json().items as Ls[];
    const stale = await req('PUT', url, { items: [...cur].reverse().map((i) => ({ id: i.id, version: 1 })) });
    expect(stale.statusCode).toBe(409);
    const other = await req('PUT', url, { items: [{ id: 'ls-fx-two--fx-a' }] });
    expect(other.statusCode).toBe(422);
  });

  it('PUT: 원래 순서로 + 행 하나 빼고 새 역 추가(삭제된 행의 seq 는 건너뛴다)', async () => {
    const items = [
      { id: 'ls-fx-one--fx-a' },
      { id: 'ls-fx-one--fx-b' },
      { id: 'ls-fx-one--fx-c' },
      { station_id: 'stn-fx-e', status: 'planned', station_code: '105' },
    ];
    const r = await req('PUT', url, { items });
    expect(r.statusCode).toBe(200);
    const after = r.json().items as (Ls & { status: string })[];
    expect(after.map((i) => i.id)).toEqual([
      'ls-fx-one--fx-a',
      'ls-fx-one--fx-b',
      'ls-fx-one--fx-c',
      'ls-fx-one--fx-e',
    ]);
    // 삭제된 d 는 seq 1(뒤집힌 상태) 을 차지하므로 새 seq 는 2부터
    expect(after.map((i) => i.seq)).toEqual([2, 3, 4, 5]);
    expect(after[3]!.status).toBe('planned');
    expect(r.json().ops.map((o: { op: string }) => o.op)).toContain('delete');
    // 휴지통의 d 를 복구해도 seq 충돌이 없다
    const restore = await req('POST', '/v1/admin/line-station/ls-fx-one--fx-d/restore');
    expect(restore.statusCode).toBe(200);
  });

  it('PUT: 정차 패턴이 가리키는 행을 빼면 409', async () => {
    const cur = (await req('GET', url)).json().items as Ls[];
    const r = await req('PUT', url, {
      items: cur.filter((i) => i.id !== 'ls-fx-one--fx-b').map((i) => ({ id: i.id })),
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('referenced');
  });
});

describe('역 병합', () => {
  it('stn-fx-e → stn-fx-b', async () => {
    const pv = await req('GET', '/v1/admin/stations/stn-fx-e/merge-preview?into_id=stn-fx-b');
    expect(pv.statusCode).toBe(200);
    expect(pv.json()).toMatchObject({
      from: { id: 'stn-fx-e' },
      into: { id: 'stn-fx-b' },
      line_stations: expect.arrayContaining([
        expect.objectContaining({ id: 'ls-fx-two--fx-e', action: 'move' }),
        expect.objectContaining({ id: 'ls-fx-one--fx-e', action: 'combine', twin_id: 'ls-fx-one--fx-b' }),
      ]),
      adds_former_name: true,
    });
    expect((await req('GET', '/v1/admin/stations/stn-fx-e/merge-preview')).statusCode).toBe(400);
    const dry = await req('POST', '/v1/admin/stations/stn-fx-e/merge?dry_run=true', { into_id: 'stn-fx-b' });
    expect(dry.statusCode).toBe(200);
    expect((await req('GET', '/v1/admin/station/stn-fx-e')).statusCode).toBe(200);
    const r = await req('POST', '/v1/admin/stations/stn-fx-e/merge', { into_id: 'stn-fx-b', reason: '같은 역' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: 'stn-fx-b', merged_id: 'stn-fx-e' });
    expect((await req('GET', '/v1/admin/station/stn-fx-e')).statusCode).toBe(404);
    const b = (await req('GET', '/v1/admin/station/stn-fx-b')).json();
    expect(b.data.names.map((n: { name: string }) => n.name)).toContain('마');
    const bad = await req('POST', '/v1/admin/stations/stn-fx-b/merge', { into_id: 'stn-fx-b' });
    expect(bad.statusCode).toBe(422);
  });
});
