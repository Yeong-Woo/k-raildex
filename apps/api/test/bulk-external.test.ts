/** 여러 건 입력·외부 API 탐색기 API — 외부 호출은 가짜 fetch(실제 네트워크·키 없음) */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers';

let t: TestApp;
const KEY = 'fake-key+1/2==';
const seen: string[] = [];

const req = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  headers?: Record<string, string>,
) =>
  t.app.inject({
    method,
    url,
    ...(payload !== undefined ? { payload: payload as object } : {}),
    ...(headers ? { headers } : {}),
  });

const XML_OK = `<?xml version="1.0" encoding="UTF-8"?>
<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
<body><items><item><subwayStationId>MTR-A</subwayStationId><subwayStationName>가</subwayStationName></item>
<item><subwayStationId>MTR-Z</subwayStationId><subwayStationName>없는역</subwayStationName></item></items>
<numOfRows>10</numOfRows><pageNo>1</pageNo><totalCount>2</totalCount></body></response>`;

const XML_KEY_ERR = `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg>
<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;

beforeAll(async () => {
  t = await startApp({
    external: {
      env: { DATA_GO_KR_KEY: KEY },
      fetchImpl: async (url) => {
        seen.push(url);
        const u = new URL(url);
        if (u.searchParams.get('subwayStationName') === 'keyerr')
          return new Response(XML_KEY_ERR, { headers: { 'content-type': 'text/xml' } });
        return new Response(XML_OK, { headers: { 'content-type': 'application/xml;charset=UTF-8' } });
      },
    },
  });
});
afterAll(async () => t?.close());

describe('여러 건 입력', () => {
  it('대상 목록 → 파싱(열 추정) → 제출(422/201) → 변경 묶음 draft', async () => {
    const targets = (await req('GET', '/v1/admin/bulk/targets')).json();
    expect(targets.items.map((x: { target: string }) => x.target)).toEqual([
      'station',
      'line_station',
      'train_number_range',
      'rolling_stock_range',
      'event',
      'plan_refs',
      'plan_milestones',
    ]);
    const text = '노선,역,순서,상태\nline-fx-two,나,3,계획\nline-fx-two,없음,4,계획';
    const parsed = await req('POST', '/v1/admin/bulk/parse', { entity_type: 'line_station', text });
    expect(parsed.statusCode).toBe(200);
    const body = parsed.json();
    expect(body.delimiter).toBe('comma');
    expect(body.columns.map((c: { field: string | null }) => c.field)).toEqual([
      'line_id',
      'station_id',
      'seq',
      'status',
    ]);
    expect(body.rows[0]).toMatchObject({
      errors: [],
      data: { station_id: 'stn-fx-b', id: 'ls-fx-two--fx-b', status: 'planned' },
    });
    expect(body.summary).toEqual({ total: 2, ok: 1, error: 1 });

    expect((await req('POST', '/v1/admin/bulk/parse', { entity_type: 'line', text })).statusCode).toBe(400);
    expect((await req('POST', '/v1/admin/bulk/parse', { text })).statusCode).toBe(400);

    const bad = await req('POST', '/v1/admin/bulk/submit', { entity_type: 'line_station', text });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.details[0]).toMatchObject({ path: 'rows.2.station_id', rule: 'bulk' });

    const ok = await req('POST', '/v1/admin/bulk/submit', {
      entity_type: 'line_station',
      text,
      exclude: [2],
      title: '시험 2호선 역 추가',
    });
    expect(ok.statusCode).toBe(201);
    const cs = (await req('GET', `/v1/admin/changesets/${ok.json().changeset_id}`)).json();
    expect(cs).toMatchObject({ origin: 'bulk_import', status: 'draft', title: '시험 2호선 역 추가' });
    expect(cs.ops[0]).toMatchObject({ op: 'create', entity_id: 'ls-fx-two--fx-b' });
  });

  it('열 대응 수동 지정·rows 로 제출(기대 일정 모드)', async () => {
    const rows = [
      ['a', 'b', 'c', 'd', 'e'],
      ['plan-fx-replace', 'opened', '2034', 'official', 'src-fixture-notice'],
    ];
    const r = await req('POST', '/v1/admin/bulk/submit', {
      mode: 'plan_milestones',
      rows,
      mapping: ['plan_id', 'stage', 'expected', 'basis', 'source_id'],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ op_count: 1, row_count: 1 });
    const approve = await req('POST', `/v1/admin/changesets/${r.json().changeset_id}/approve`, {});
    expect(approve.statusCode).toBe(200);
    const plan = (await req('GET', '/v1/admin/plan/plan-fx-replace')).json();
    expect(plan.data.milestones).toHaveLength(2);
    const bad = await req('POST', '/v1/admin/bulk/parse', { mode: 'plan_milestones', text: 'x\n1', mapping: ['nope'] });
    expect(bad.statusCode).toBe(422);
  });
});

describe('외부 API 탐색기', () => {
  const ep = {
    id: 'stub-tago',
    provider: 'tago',
    name_ko: '시험 TAGO(XML)',
    base_url: 'http://stub.example.test/SubwayInfo/List',
    params: [
      { name: 'subwayStationName', label: '역 이름' },
      { name: 'numOfRows', kind: 'int', default: '10' },
      { name: 'pageNo', kind: 'int', default: '1' },
    ],
    key_param: 'serviceKey',
    key_env: 'DATA_GO_KR_KEY_STUB',
    response_format: 'xml',
    paging: { page_param: 'pageNo', size_param: 'numOfRows' },
    compare: { code_field: 'subwayStationId', name_field: 'subwayStationName' },
    daily_limit: 3,
    external_system: 'tago_subway',
  };

  it('카탈로그 CRUD·시드·제공처·키 상태(값 없음)', async () => {
    const c = await req('POST', '/v1/admin/external/endpoints', ep);
    expect(c.statusCode).toBe(201);
    expect(c.json()).toMatchObject({ id: 'stub-tago', version: 1, key_configured: true, today_calls: 0 });
    expect((await req('POST', '/v1/admin/external/endpoints', ep)).statusCode).toBe(409);
    expect(
      (await req('POST', '/v1/admin/external/endpoints', { ...ep, id: 'x-y', key_env: 'S3_SECRET_KEY' })).statusCode,
    ).toBe(422);
    const p = await req('PATCH', '/v1/admin/external/endpoints/stub-tago', { note: '메모' }, { 'if-match': '1' });
    expect(p.json()).toMatchObject({ note: '메모', version: 2 });
    expect(
      (await req('PATCH', '/v1/admin/external/endpoints/stub-tago', { note: 'x' }, { 'if-match': '1' })).statusCode,
    ).toBe(409);
    const seed = await req('POST', '/v1/admin/external/catalog/seed');
    expect(seed.json().created).toContain('tago-subway-station-list');
    const list = (await req('GET', '/v1/admin/external/endpoints')).json();
    expect(list.items.length).toBeGreaterThan(10);
    expect((await req('GET', '/v1/admin/external/providers')).json().items[0]).toMatchObject({ code: 'data_go_kr' });
    const keys = await req('GET', '/v1/admin/external/keys');
    expect(keys.body).not.toContain(KEY);
    expect(keys.json().items.find((k: { key_env: string }) => k.key_env === 'DATA_GO_KR_KEY_STUB')).toMatchObject({
      configured: true,
      using_env: 'DATA_GO_KR_KEY',
    });
    expect(keys.json().items.find((k: { key_env: string }) => k.key_env === 'KRIC_KEY')).toMatchObject({
      configured: false,
    });
  });

  it('호출(XML → JSON·행·결과 코드·키 가림) → 기록 → 비교 → 스냅샷', async () => {
    // 비교용 외부 코드
    const ls = (await req('GET', '/v1/admin/line-station/ls-fx-one--fx-a')).json();
    expect(
      (
        await req(
          'PATCH',
          '/v1/admin/line-station/ls-fx-one--fx-a',
          { external_refs: [{ system: 'tago_subway', code: 'MTR-A' }] },
          { 'if-match': String(ls.version) },
        )
      ).statusCode,
    ).toBe(200);
    const r = await req('POST', '/v1/admin/external/endpoints/stub-tago/call', { subwayStationName: '가' });
    expect(r.statusCode).toBe(200);
    const res = r.json();
    expect(res).toMatchObject({
      ok: true,
      status: 200,
      result_code: '00',
      row_count: 2,
      today_calls: 1,
      daily_limit: 3,
    });
    expect(res.rows[0]).toEqual({ subwayStationId: 'MTR-A', subwayStationName: '가' });
    expect(res.page_info).toMatchObject({ total: 2, has_next: false });
    expect(r.body).not.toContain(KEY);
    expect(new URL(seen.at(-1)!).searchParams.get('serviceKey')).toBe(KEY);

    const calls = (await req('GET', '/v1/admin/external/calls?endpoint_id=stub-tago')).json();
    expect(calls.items[0]).toMatchObject({ id: res.call_id, result_code: '00', has_body: true });
    expect((await req('GET', `/v1/admin/external/calls/${res.call_id}`)).json().rows).toHaveLength(2);

    const cmp = (await req('POST', `/v1/admin/external/calls/${res.call_id}/compare`)).json();
    expect(cmp.summary).toMatchObject({ rows: 2, matched: 1, same: 1, missing: 1 });

    const snap = await req('POST', `/v1/admin/external/calls/${res.call_id}/snapshot`);
    expect(snap.statusCode).toBe(201);
    expect(snap.json()).toMatchObject({ kind: 'snapshot', mime: 'application/xml', existing: false });
    expect((await req('POST', `/v1/admin/external/calls/${res.call_id}/snapshot`)).json().existing).toBe(true);
    expect((await req('GET', `/v1/admin/documents/${snap.json().id}`)).json().meta.endpoint_id).toBe('stub-tago');
  });

  it('키 오류 해석·한도 429·매개변수 422·즐겨찾기·삭제', async () => {
    const e = (
      await req('POST', '/v1/admin/external/endpoints/stub-tago/call', { subwayStationName: 'keyerr' })
    ).json();
    expect(e).toMatchObject({ ok: false, result_code: '30' });
    expect(e.result_message).toMatch(/등록되지 않은 서비스 키/);
    expect((await req('POST', '/v1/admin/external/endpoints/stub-tago/call', { serviceKey: 'x' })).statusCode).toBe(
      422,
    );
    const all = await req('POST', '/v1/admin/external/endpoints/stub-tago/call-all-pages?max_pages=5', {});
    expect(all.json()).toMatchObject({ pages: 1, row_count: 2, stopped: 'done' });
    const limited = await req('POST', '/v1/admin/external/endpoints/stub-tago/call', {});
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('rate_limited');

    const pr = await req('POST', '/v1/admin/external/endpoints/stub-tago/presets', {
      name: '가',
      params: { subwayStationName: '가' },
    });
    expect(pr.statusCode).toBe(201);
    expect((await req('GET', '/v1/admin/external/endpoints/stub-tago/presets')).json().items).toHaveLength(1);
    expect((await req('PATCH', `/v1/admin/external/presets/${pr.json().id}`, { name: '가역' })).json().name).toBe(
      '가역',
    );
    expect((await req('DELETE', `/v1/admin/external/presets/${pr.json().id}`)).statusCode).toBe(204);

    expect(
      (await req('GET', '/v1/admin/external/ref-codes?entity_id=stn-fx-a&system=tago_subway')).json().items[0].code,
    ).toBe('MTR-A');
    expect((await req('DELETE', '/v1/admin/external/endpoints/stub-tago')).statusCode).toBe(204);
    expect((await req('POST', '/v1/admin/external/endpoints/stub-tago/call', {})).statusCode).toBe(404);
  });
});
