/** 여러 건 입력(bulk.ts)·외부 API 탐색기(external-api.ts) — 외부 호출은 가짜 fetch 만 쓴다(실제 네트워크·키 없음) */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { freshDb, type FreshDb } from '@k-raildex/db/testing';
import {
  API_CATALOG_SEED,
  applyChangeset,
  approveDraft,
  bulkFields,
  callAllPages,
  callEndpoint,
  compareApiCall,
  createApiEndpoint,
  createApiPreset,
  deleteApiEndpoint,
  DomainError,
  ensureServiceUser,
  externalCodesFor,
  fixtureOps,
  getApiCall,
  getApiEndpoint,
  guessMapping,
  interpretResult,
  keyStatuses,
  listApiCalls,
  listApiPresets,
  maskKey,
  MemoryObjectStore,
  parseBulk,
  parseFuzzyCell,
  parseTable,
  readEntity,
  seedApiCatalog,
  snapshotApiCall,
  submitBulk,
  updateApiEndpoint,
  type FetchLike,
} from '../src';

let fx: FreshDb;
let db: pg.Client;
let author: string;

async function domainError(p: Promise<unknown>, code: string): Promise<DomainError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe(code);
    return e as DomainError;
  }
  throw new Error(`DomainError(${code}) 를 기대했으나 성공함`);
}

beforeAll(async () => {
  fx = await freshDb();
  db = fx.client;
  author = await ensureServiceUser(db, 'system', 'test');
  await applyChangeset(db, { title: '픽스처', origin: 'legacy_migration', author_id: author, ops: fixtureOps() });
});
afterAll(async () => fx?.close());

describe('여러 건 입력: 표 읽기·값 변환', () => {
  it('TSV·CSV(따옴표·줄바꿈) 읽기', () => {
    expect(parseTable('a\tb\n1\t2\n\n').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    const csv = parseTable('이름,메모\n"가, 나","줄\n바꿈"\n');
    expect(csv.delimiter).toBe('comma');
    expect(csv.rows[1]).toEqual(['가, 나', '줄\n바꿈']);
  });

  it('퍼지 날짜', () => {
    expect(parseFuzzyCell('2028')).toEqual({ value: '2028', precision: 'year' });
    expect(parseFuzzyCell('2028-03')).toEqual({ value: '2028-03', precision: 'month' });
    expect(parseFuzzyCell('2028-H2')).toEqual({ value: '2028-H2', precision: 'half' });
    expect(parseFuzzyCell('2028년 하반기')).toEqual({ value: '2028-H2', precision: 'half' });
    expect(parseFuzzyCell('2028.3.1')).toEqual({ value: '2028-03-01', precision: 'day' });
    expect(parseFuzzyCell('미정')).toEqual({ value: null, precision: 'unknown' });
    expect(parseFuzzyCell('?')).toEqual({ value: null, precision: 'unknown' });
    expect(parseFuzzyCell('')).toBeNull();
    expect(parseFuzzyCell('2028-13')).toBeUndefined();
  });

  it('머리글 추정: 필드 이름·라벨·별칭', () => {
    expect(guessMapping('line_station', ['노선', '역명', '순서', '역번호', '상태', '아무거나'])).toEqual([
      'line_id',
      'station_id',
      'seq',
      'station_code',
      'status',
      null,
    ]);
    expect(guessMapping('station', ['id', '이름', '위도', '경도', '확인일'])).toEqual([
      'id',
      'name_ko',
      'geom.lat',
      'geom.lng',
      'checked_at',
    ]);
    expect(bulkFields('plan_milestones').map((f) => f.name)).toContain('expected');
  });
});

describe('여러 건 입력: 파싱·제출', () => {
  it('노선역: 역 이름 해석(별칭 포함)·코드 라벨·id 자동·모호한 이름은 후보와 함께 오류', async () => {
    // 같은 이름 역 둘 → 모호
    await applyChangeset(db, {
      title: '동명 역',
      origin: 'admin_edit',
      author_id: author,
      ops: [
        {
          op: 'create',
          entity_type: 'station',
          data: {
            id: 'stn-fx-dup',
            name_ko: '나',
            checked_at: '2026-11-20',
            sources: [{ source_id: 'src-fixture-notice' }],
          },
        },
      ],
    });
    const text = [
      '노선\t역\t순서\t상태\t개통일',
      '시험 2호선\t가역\t3\t운영 중\t2028-H2',
      'line-fx-two\t나\t4\t계획\t미정',
      'line-fx-two\t없는역\t5\tplanned\t',
    ].join('\n');
    const r = await parseBulk(db, 'line_station', text);
    expect(r.columns.map((c) => c.field)).toEqual(['line_id', 'station_id', 'seq', 'status', 'opened']);
    expect(r.rows[0]!.errors).toEqual([]);
    expect(r.rows[0]!.data).toMatchObject({
      line_id: 'line-fx-two',
      station_id: 'stn-fx-a',
      seq: 3,
      status: 'operating',
      opened: { value: '2028-H2', precision: 'half' },
    });
    // ls-fx-two--fx-a 는 이미 있다 → -2
    expect(r.rows[0]!.data.id).toBe('ls-fx-two--fx-a-2');
    expect(r.rows[1]!.errors[0]).toMatchObject({ field: 'station_id' });
    expect(r.rows[1]!.errors[0]!.message).toMatch(/stn-fx-b.*stn-fx-dup|stn-fx-dup.*stn-fx-b/);
    expect(r.rows[2]!.errors[0]!.message).toMatch(/없음/);
    expect(r.summary).toEqual({ total: 3, ok: 1, error: 2 });

    // 오류 행이 있으면 422(rows.<행>.<필드>)
    const e = await domainError(submitBulk(db, { target: 'line_station', text, author_id: author }), 'validation');
    expect(e.details.violations?.map((v) => v.path)).toContain('rows.2.station_id');
    // 오류 행 제외 → draft 1개
    const ok = await submitBulk(db, { target: 'line_station', text, exclude: [2, 3], author_id: author });
    expect(ok.op_count).toBe(1);
    const cs = await db.query(`SELECT origin, status FROM changeset WHERE id = $1`, [ok.changeset_id]);
    expect(cs.rows[0]).toEqual({ origin: 'bulk_import', status: 'draft' });
    await approveDraft(db, ok.changeset_id, author);
    expect(await readEntity(db, 'line_station', 'ls-fx-two--fx-a-2')).toMatchObject({ seq: 3 });
  });

  it('역: 공통 출처·확인일 기본값, 위도·경도 열, 참/거짓, 중복 id', async () => {
    const text = [
      'ID\t이름\t위도\t경도\t시·도',
      'stn-bulk-x\t벌크역\t37.1\t127.1\t경기',
      'stn-bulk-x\t중복\t\t\t서울',
      'stn-fx-a\t기존\t\t\t',
    ].join('\n');
    const r = await parseBulk(db, 'station', {
      text,
      defaults: { source_id: 'src-fixture-notice', checked_at: '2026-11-21' },
    });
    expect(r.rows[0]!.errors).toEqual([]);
    expect(r.rows[0]!.data).toMatchObject({
      id: 'stn-bulk-x',
      name_ko: '벌크역',
      geom: { lat: 37.1, lng: 127.1 },
      coord_source: 'manual',
      region_code: '41',
      sources: [{ source_id: 'src-fixture-notice' }],
      checked_at: '2026-11-21',
    });
    expect(r.rows[1]!.errors.map((e) => e.field)).toContain('id');
    expect(r.rows[2]!.errors[0]!.message).toMatch(/이미 쓰인 id/);
    // 출처 없으면 필수 오류
    const r2 = await parseBulk(db, 'station', 'id\tname_ko\tchecked_at\nstn-bulk-y\t와이\t2026-11-21');
    expect(r2.rows[0]!.errors).toEqual([{ field: 'source_id', message: '필수 값이 없음' }]);
  });

  it('기대 일정 모드: 계획마다 update op 하나, 기존 목록 뒤에 붙인다', async () => {
    const text = [
      '계획\t단계\t기대 시점\t근거\t출처',
      'plan-fx-ext\t착공·시공\t2027\t보도\tsrc-fixture-notice',
      '시험 1호선 연장\topened\t2031-H1\tofficial\tsrc-fixture-notice',
      'plan-fx-replace\topened\t2033\testimate\tsrc-fixture-notice',
    ].join('\n');
    const r = await parseBulk(db, 'plan_milestones', text);
    expect(r.rows[0]!.errors).toEqual([]);
    expect(r.rows[0]!.data).toMatchObject({ plan_id: 'plan-fx-ext', stage: 'construction', basis: 'press' });
    expect(r.rows[1]!.data.plan_id).toBe('plan-fx-ext');
    expect(r.rows[2]!.errors.map((e) => e.field)).toContain('basis'); // Q94: estimate 금지
    const s = await submitBulk(db, { target: 'plan_milestones', text, exclude: [3], author_id: author });
    expect(s).toMatchObject({ op_count: 1, row_count: 2 });
    await approveDraft(db, s.changeset_id, author);
    const plan = await readEntity(db, 'plan', 'plan-fx-ext');
    expect((plan!.milestones as unknown[]).length).toBe(3);
  });

  it('반영 내역 모드: 상위 계획 짧은 이름·코드 라벨', async () => {
    const pp = await db.query<{ short: string | null }>(
      `SELECT short FROM plan_program WHERE id = 'pp-fx-national-rail-4'`,
    );
    const text = `plan_id\tprogram_id\tclass\tsource_id\nplan-fx-replace\t${pp.rows[0]?.short ?? 'pp-fx-national-rail-4'}\t추가검토\tsrc-fixture-notice`;
    const r = await parseBulk(db, 'plan_refs', text);
    expect(r.rows[0]!.errors).toEqual([]);
    expect(r.rows[0]!.data).toMatchObject({ program_id: 'pp-fx-national-rail-4', class: 'review' });
  });
});

// ---------------------------------------------------------------------------
// 외부 API
// ---------------------------------------------------------------------------

const KEY = 'test+key/ABC==';
const env = { DATA_GO_KR_KEY: KEY };

interface Seen {
  url: string;
  init: RequestInit;
}

function mockFetch(handler: (url: URL) => Response | Promise<Response>): { fetchImpl: FetchLike; seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    seen,
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return handler(new URL(url));
    },
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function tagoPage(page: number, size: number, total: number, ids: string[]) {
  return {
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
      body: {
        items: {
          item: ids.map((id) => ({ subwayStationId: id, subwayStationName: id === 'MTR-A' ? '가' : '다른이름' })),
        },
        numOfRows: size,
        pageNo: page,
        totalCount: total,
      },
    },
  };
}

describe('외부 API: 카탈로그', () => {
  it('시드 upsert·키 변수 규칙·삭제', async () => {
    const r1 = await seedApiCatalog(db, author);
    expect(r1.created.length).toBe(API_CATALOG_SEED.length);
    const r2 = await seedApiCatalog(db, author);
    expect(r2.updated.length).toBe(API_CATALOG_SEED.length);
    const tago = await getApiEndpoint(db, 'tago-subway-station-list', { env });
    expect(tago.compare).toEqual({ code_field: 'subwayStationId', name_field: 'subwayStationName' });
    expect(tago.paging).toMatchObject({ page_param: 'pageNo' });
    expect(tago.key_configured).toBe(true); // 공통 변수 DATA_GO_KR_KEY 로
    // 키 변수는 외부 API 키 이름만
    await domainError(
      createApiEndpoint(
        db,
        {
          id: 'bad-env',
          provider: 'other',
          name_ko: 'x',
          base_url: 'https://example.com/a',
          response_format: 'json',
          key_param: 'k',
          key_env: 'DATABASE_URL',
        },
        author,
      ),
      'validation',
    );
    await domainError(
      createApiEndpoint(
        db,
        {
          id: 'tago-subway-station-list',
          provider: 'tago',
          name_ko: 'x',
          base_url: 'https://e.com/',
          response_format: 'json',
        },
        author,
      ),
      'id_taken',
    );
    const u = await updateApiEndpoint(db, 'law-drf-admrul-service', { daily_limit: 100 }, author, 2);
    expect(u).toMatchObject({ daily_limit: 100, version: 3 });
    await domainError(updateApiEndpoint(db, 'law-drf-admrul-service', { note: 'x' }, author, 1), 'version_conflict');
    await deleteApiEndpoint(db, 'law-drf-admrul-service', author);
    await domainError(getApiEndpoint(db, 'law-drf-admrul-service'), 'not_found');
    const r3 = await seedApiCatalog(db, author);
    expect(r3.skipped).toEqual(['law-drf-admrul-service']);
  });
});

describe('외부 API: 호출', () => {
  beforeAll(async () => {
    await createApiEndpoint(
      db,
      {
        id: 'test-tago',
        provider: 'tago',
        name_ko: '시험 TAGO',
        base_url: 'http://apis.example.test/SubwayInfo/List',
        params: [
          { name: 'subwayStationName', label: '역 이름' },
          { name: 'numOfRows', kind: 'int', default: '2' },
          { name: 'pageNo', kind: 'int', default: '1' },
          { name: '_type', default: 'json', fixed: true },
        ],
        key_param: 'serviceKey',
        key_env: 'DATA_GO_KR_KEY_TEST',
        response_format: 'json',
        paging: { page_param: 'pageNo', size_param: 'numOfRows', total_path: 'response.body.totalCount' },
        compare: { code_field: 'subwayStationId', name_field: 'subwayStationName' },
        daily_limit: 5,
        external_system: 'tago_subway',
      },
      author,
    );
    // 비교용 외부 코드: 노선역 ls-fx-one--fx-a ↔ MTR-A, ls-fx-one--fx-b ↔ MTR-B
    for (const [id, code] of [
      ['ls-fx-one--fx-a', 'MTR-A'],
      ['ls-fx-one--fx-b', 'MTR-B'],
    ] as const) {
      await applyChangeset(db, {
        title: '외부 코드',
        origin: 'admin_edit',
        author_id: author,
        ops: [
          { op: 'update', entity_type: 'line_station', id, data: { external_refs: [{ system: 'tago_subway', code }] } },
        ],
      });
    }
  });

  it('키 주입·가림, 결과 코드, 행 자동 감지, 다음 쪽', async () => {
    const { fetchImpl, seen } = mockFetch((u) => {
      // 응답 본문에 키가 그대로 메아리치는 경우도 가려야 한다
      return json({
        ...tagoPage(Number(u.searchParams.get('pageNo')), 2, 3, ['MTR-A', 'MTR-B']),
        echo: u.searchParams.get('serviceKey'),
      });
    });
    const r = await callEndpoint(db, 'test-tago', { subwayStationName: '가', _type: 'xml' }, { fetchImpl, env });
    expect(seen).toHaveLength(1);
    const sent = new URL(seen[0]!.url);
    expect(sent.searchParams.get('serviceKey')).toBe(KEY);
    expect(sent.searchParams.get('_type')).toBe('json'); // fixed
    expect(seen[0]!.init.redirect).toBe('manual');
    expect(r).toMatchObject({
      status: 200,
      ok: true,
      result_code: '00',
      row_count: 2,
      rows_path: 'response.body.items.item',
    });
    expect(r.result_message).toMatch(/정상/);
    expect(r.url).not.toContain('ABC');
    expect(r.url).toContain('serviceKey=***');
    expect(r.raw).not.toContain(KEY);
    expect(r.raw).toContain('"echo":"***"');
    expect(r.params).toEqual({ subwayStationName: '가', numOfRows: '2', pageNo: '1', _type: 'json' });
    expect(r.page_info).toMatchObject({ page: 1, size: 2, total: 3, has_next: true, next_params: { pageNo: '2' } });
    const stored = await db.query(`SELECT params, response_body FROM ingest.api_call WHERE id = $1`, [r.call_id]);
    expect(JSON.stringify(stored.rows[0].params)).not.toContain(KEY);
    expect((stored.rows[0].response_body as Buffer).toString()).not.toContain(KEY);
    const again = await getApiCall(db, r.call_id);
    expect(again.rows).toHaveLength(2);
  });

  it('매개변수 검증·키 매개변수 거부·키 없음', async () => {
    const { fetchImpl } = mockFetch(() => json({}));
    await domainError(callEndpoint(db, 'test-tago', { nope: '1' }, { fetchImpl, env }), 'validation');
    await domainError(callEndpoint(db, 'test-tago', { serviceKey: 'x' }, { fetchImpl, env }), 'validation');
    await domainError(callEndpoint(db, 'test-tago', { numOfRows: 'abc' }, { fetchImpl, env }), 'validation');
    const e = await domainError(callEndpoint(db, 'test-tago', {}, { fetchImpl, env: {} }), 'validation');
    expect(e.message).toMatch(/DATA_GO_KR_KEY_TEST 또는 DATA_GO_KR_KEY/);
  });

  it('공공데이터포털 게이트웨이 오류 코드 해석', () => {
    const r = interpretResult(
      'data_go_kr',
      {
        OpenAPI_ServiceResponse: {
          cmmMsgHeader: {
            errMsg: 'SERVICE ERROR',
            returnAuthMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR',
            returnReasonCode: '30',
          },
        },
      },
      200,
    );
    expect(r).toMatchObject({ code: '30', ok: false });
    expect(r.message).toMatch(/등록되지 않은 서비스 키/);
    expect(interpretResult('kric', { header: { resultCode: '41', resultMsg: 'x' }, body: [] }, 200)).toMatchObject({
      code: '41',
      ok: false,
    });
    expect(
      interpretResult(
        'vworld',
        { response: { status: 'ERROR', error: { code: 'INVALID_KEY', text: '키 오류' } } },
        200,
      ),
    ).toMatchObject({
      code: 'ERROR:INVALID_KEY',
      ok: false,
    });
    expect(maskKey('a=x%2By&b=x+y', 'x+y')).toBe('a=***&b=***');
  });

  it('다른 호스트 리다이렉트 차단·시간 초과·크기 상한', async () => {
    const redir = mockFetch(() => new Response(null, { status: 302, headers: { location: 'http://evil.example/x' } }));
    const r1 = await callEndpoint(db, 'test-tago', {}, { fetchImpl: redir.fetchImpl, env });
    expect(r1).toMatchObject({ ok: false, result_code: 'REDIRECT_BLOCKED' });
    expect(redir.seen).toHaveLength(1);
    const slow: FetchLike = (_u, init) =>
      new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(init.signal!.reason)));
    const r2 = await callEndpoint(db, 'test-tago', {}, { fetchImpl: slow, env, timeoutMs: 50 });
    expect(r2).toMatchObject({ ok: false, result_code: 'TIMEOUT' });
    const big = mockFetch(() => new Response('x'.repeat(2000)));
    const r3 = await callEndpoint(db, 'test-tago', {}, { fetchImpl: big.fetchImpl, env, maxBytes: 1000 });
    expect(r3).toMatchObject({ ok: false, result_code: 'TOO_LARGE' });
  });

  it('일일 한도: 오늘 호출 수가 한도면 거부(429)', async () => {
    const n = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ingest.api_call WHERE endpoint_id = 'test-tago'`,
    );
    expect(n.rows[0]!.n).toBe(4);
    const { fetchImpl } = mockFetch((u) => json(tagoPage(Number(u.searchParams.get('pageNo')), 2, 3, ['MTR-A'])));
    await callEndpoint(db, 'test-tago', {}, { fetchImpl, env });
    await domainError(callEndpoint(db, 'test-tago', {}, { fetchImpl, env }), 'rate_limited');
    expect((await getApiEndpoint(db, 'test-tago')).today_calls).toBe(5);
    await db.query(`UPDATE ingest.api_endpoint SET daily_limit = NULL WHERE id = 'test-tago'`);
  });

  it('전체 쪽 받기: 쪽 수 상한·끝', async () => {
    const { fetchImpl, seen } = mockFetch((u) => {
      const page = Number(u.searchParams.get('pageNo'));
      return json(tagoPage(page, 2, 5, page < 3 ? [`P${page}-1`, `P${page}-2`] : [`P${page}-1`]));
    });
    const all = await callAllPages(db, 'test-tago', {}, { fetchImpl, env });
    expect(all).toMatchObject({ pages: 3, row_count: 5, stopped: 'done', total: 5 });
    expect(seen.map((s) => new URL(s.url).searchParams.get('pageNo'))).toEqual(['1', '2', '3']);
    const capped = await callAllPages(db, 'test-tago', {}, { fetchImpl, env, maxPages: 2 });
    expect(capped).toMatchObject({ pages: 2, stopped: 'page_cap' });
  });

  it('DB 비교: external_ref 로 짝짓고 이름 차이 표시', async () => {
    const { fetchImpl } = mockFetch(() => json(tagoPage(1, 10, 3, ['MTR-A', 'MTR-B', 'MTR-Z'])));
    const r = await callEndpoint(db, 'test-tago', { numOfRows: '10' }, { fetchImpl, env });
    const c = await compareApiCall(db, r.call_id);
    expect(c.entity_type).toBe('line_station');
    expect(c.summary).toEqual({ rows: 3, matched: 2, same: 1, diff: 1, missing: 1 });
    const b = c.pairs.find((p) => p.external.code === 'MTR-B')!;
    expect(b).toMatchObject({
      entity_id: 'ls-fx-one--fx-b',
      link_type: 'station',
      link_id: 'stn-fx-b',
      status: 'diff',
    });
    expect(b.diffs[0]).toMatchObject({ field: 'name', external: '다른이름', db: '나' });
    expect(await externalCodesFor(db, 'stn-fx-a', 'tago_subway')).toEqual([
      { code: 'MTR-A', entity_id: 'ls-fx-one--fx-a', label: '시험 1호선' },
    ]);
  });

  it('스냅샷: document(kind snapshot)·호출에 연결·두 번째는 같은 문서', async () => {
    const store = new MemoryObjectStore();
    const { fetchImpl } = mockFetch(() => json(tagoPage(1, 2, 1, ['MTR-A'])));
    const r = await callEndpoint(db, 'test-tago', {}, { fetchImpl, env });
    const s1 = await snapshotApiCall(db, store, r.call_id, author);
    expect(s1.created).toBe(true);
    expect(s1.document).toMatchObject({ kind: 'snapshot', license_class: 'unknown', mime: 'application/json' });
    expect(s1.document.meta).toMatchObject({ endpoint_id: 'test-tago', api_call_id: r.call_id });
    expect(store.objects.size).toBe(1);
    expect([...store.objects.values()][0]!.body.toString()).not.toContain(KEY);
    const s2 = await snapshotApiCall(db, store, r.call_id, author);
    expect(s2).toMatchObject({ created: false, document: { id: s1.document.id } });
    expect((await getApiCall(db, r.call_id)).snapshot_document_id).toBe(s1.document.id);
  });

  it('호출 기록·즐겨찾기·키 상태', async () => {
    const list = await listApiCalls(db, { endpoint_id: 'test-tago', limit: 5, offset: 0 });
    expect(list.items).toHaveLength(5);
    expect(list.items[0]!.url).toContain('***');
    const p = await createApiPreset(db, 'test-tago', { name: '가 검색', params: { subwayStationName: '가' } });
    expect(await listApiPresets(db, 'test-tago')).toEqual([p]);
    await domainError(createApiPreset(db, 'test-tago', { name: 'x', params: { bad: '1' } }), 'validation');
    const keys = await keyStatuses(db, env);
    const k = keys.find((x) => x.key_env === 'DATA_GO_KR_KEY_TEST')!;
    expect(k).toMatchObject({ configured: true, using_env: 'DATA_GO_KR_KEY', fallback_env: 'DATA_GO_KR_KEY' });
    expect(k.last_success_at).not.toBeNull();
    expect(JSON.stringify(keys)).not.toContain(KEY);
  });
});
