/** M4: 문서·첨부·품질·지도·되돌리기·일부 승인 API */
import { renderPageImages } from '@k-raildex/domain';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makePdf } from '../../../packages/domain/test/pdf';
import { startApp, type TestApp } from './helpers';

let t: TestApp;
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const req = (method: Method, url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  t.app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}), headers });

function multipart(fields: Record<string, string>, file?: { name: string; type: string; data: Buffer }) {
  const boundary = '----krdxtest';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields))
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (file)
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const upload = (fields: Record<string, string>, file?: { name: string; type: string; data: Buffer }) => {
  const m = multipart(fields, file);
  return t.app.inject({ method: 'POST', url: '/v1/admin/documents', payload: m.payload, headers: m.headers });
};

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => t?.close());

describe('문서 API', () => {
  let id: string;
  const pdf = makePdf(['First', 'Second page']);

  it('업로드(multipart)·중복·검증', async () => {
    const r = await upload(
      { license_class: 'kogl_1', source_id: 'src-fixture-notice', title: '계획 고시' },
      { name: '고시.pdf', type: 'application/pdf', data: pdf },
    );
    expect(r.statusCode).toBe(201);
    id = r.json().id;
    expect(r.json()).toMatchObject({
      kind: 'upload',
      mime: 'application/pdf',
      license_class: 'kogl_1',
      deduplicated: false,
    });
    expect(r.json().source_ids).toEqual(['src-fixture-notice']);
    const again = await upload({ license_class: 'kogl_1' }, { name: 'x.pdf', type: 'application/pdf', data: pdf });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ id, deduplicated: true });
    expect(
      (await upload({ license_class: 'nope' }, { name: 'y.pdf', type: 'application/pdf', data: Buffer.from('%PDF-x') }))
        .statusCode,
    ).toBe(400);
    expect((await upload({ license_class: 'kogl_1' })).statusCode).toBe(400);
    expect((await req('POST', '/v1/admin/documents', { a: 1 })).statusCode).toBe(415);
  });

  it('목록·상세·내려받기·수정', async () => {
    const list = (await req('GET', '/v1/admin/documents?q=고시&parent=none')).json();
    expect(list.total).toBe(1);
    expect((await req('GET', '/v1/admin/documents?kind=page_image')).json().total).toBe(0);
    expect((await req('GET', `/v1/admin/documents/${id}`)).json()).toMatchObject({ id, title: '계획 고시' });
    expect((await req('GET', '/v1/admin/documents/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    const dl = await req('GET', `/v1/admin/documents/${id}/download`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('고시.pdf')}`);
    expect(dl.rawPayload.equals(pdf)).toBe(true);
    const bad = await req('PATCH', `/v1/admin/documents/${id}`, { license_class: 'restricted', publishable: true });
    expect(bad.statusCode).toBe(422);
    const ok = await req('PATCH', `/v1/admin/documents/${id}`, { publishable: true });
    expect(ok.json()).toMatchObject({ publishable: true });
    expect((await req('PATCH', `/v1/admin/documents/${id}`, { kind: 'x' })).statusCode).toBe(400);
  });

  it('작업 보내기·쪽 이미지·잘라 내기', async () => {
    expect((await req('POST', `/v1/admin/documents/${id}/extract-text`)).statusCode).toBe(202);
    const pg = await req('POST', `/v1/admin/documents/${id}/pages`, {});
    expect(pg.statusCode).toBe(202);
    expect(t.jobs.sent.map((j) => j.name)).toEqual(['doc.text-extract', 'doc.page-images']);
    expect(t.jobs.sent[1]!.data).toEqual({ document_id: id, force: false });
    expect((await req('GET', `/v1/admin/documents/${id}/pages/1/image`)).statusCode).toBe(404);

    // worker 대신 같은 도메인 함수로 쪽 이미지 생성
    await renderPageImages(t.pool, t.store, id, { pages: [1] });
    const pages = (await req('GET', `/v1/admin/documents/${id}/pages`)).json();
    expect(pages).toMatchObject({ pages: 2, total: 1 });
    const img = await req('GET', `/v1/admin/documents/${id}/pages/1/image`);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    const meta = await sharp(img.rawPayload).metadata();
    expect(meta.width).toBe(Math.round((612 / 72) * 110));

    // 2쪽은 아직 없음 → crop 이 그 쪽만 만들고 잘라 낸다
    const crop = await req('POST', `/v1/admin/documents/${id}/crop`, {
      page: 2,
      bbox: [0.25, 0.25, 0.75, 0.75],
      title: '도면',
    });
    expect(crop.statusCode).toBe(201);
    expect(crop.json()).toMatchObject({
      kind: 'figure_crop',
      page: 2,
      parent_document_id: id,
      title: '도면',
      license_class: 'kogl_1',
    });
    const c = await sharp(t.store.objects.get(crop.json().storage_key)!.body).metadata();
    expect(c.width).toBeGreaterThan(400);
    expect(c.width).toBeLessThan(500);
    expect((await req('POST', `/v1/admin/documents/${id}/crop`, { page: 1, bbox: [0.9, 0, 0.1, 1] })).statusCode).toBe(
      422,
    );
    expect((await req('GET', `/v1/admin/documents?parent=${id}`)).json().total).toBe(3);
  });

  it('PDF 가 아니면 422', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    const up = (
      await upload({ license_class: 'open', kind: 'original' }, { name: 'a.png', type: 'image/png', data: png })
    ).json();
    expect(up.kind).toBe('original');
    expect((await req('POST', `/v1/admin/documents/${up.id}/pages`)).statusCode).toBe(422);
  });
});

describe('첨부 API', () => {
  it('목록·추가·수정(If-Match)·삭제, 변경 이력·되돌리기', async () => {
    const add = await req('POST', '/v1/admin/entities/plan-fx-ext/attachments', {
      kind: 'link',
      url: 'https://example.com/a',
      title: '보도',
    });
    expect(add.statusCode).toBe(201);
    const a = add.json();
    expect(a).toMatchObject({
      kind: 'link',
      version: 1,
      is_public: false,
      origin: 'manual',
      changeset_id: expect.any(String),
    });
    expect((await req('POST', '/v1/admin/entities/plan-fx-ext/attachments', { kind: 'quote' })).statusCode).toBe(422);
    expect((await req('POST', '/v1/admin/entities/plan-none/attachments', { kind: 'link', url: 'x' })).statusCode).toBe(
      404,
    );

    const list = (await req('GET', '/v1/admin/entities/plan-fx-ext/attachments')).json();
    expect(list.items).toHaveLength(1);
    expect(Object.keys(list.items[0]).sort()).toEqual(
      [
        'created_at',
        'document_id',
        'id',
        'is_public',
        'kind',
        'ord',
        'origin',
        'page',
        'quote',
        'source_id',
        'title',
        'updated_at',
        'url',
        'version',
      ].sort(),
    );

    expect((await req('PATCH', `/v1/admin/attachments/${a.id}`, { title: 'x' })).statusCode).toBe(428);
    expect((await req('PATCH', `/v1/admin/attachments/${a.id}`, { title: 'x' }, { 'if-match': '5' })).statusCode).toBe(
      409,
    );
    const up = await req('PATCH', `/v1/admin/attachments/${a.id}`, { title: '보도 기사' }, { 'if-match': 'W/"1"' });
    expect(up.statusCode).toBe(200);
    expect(up.json()).toMatchObject({ title: '보도 기사', version: 2 });

    const hist = (await req('GET', '/v1/admin/plan/plan-fx-ext/history')).json();
    expect(hist.items[0]).toMatchObject({ op: 'update', changeset_id: up.json().changeset_id });

    const rv = await req('POST', `/v1/admin/plan/plan-fx-ext/revert`, { changeset_id: up.json().changeset_id, seq: 1 });
    expect(rv.statusCode).toBe(200);
    expect((await req('GET', '/v1/admin/entities/plan-fx-ext/attachments')).json().items[0].title).toBe('보도');

    const del = await req('DELETE', `/v1/admin/attachments/${a.id}`);
    expect(del.statusCode).toBe(200);
    expect((await req('GET', '/v1/admin/entities/plan-fx-ext/attachments')).json().total).toBe(0);
    expect((await req('DELETE', `/v1/admin/attachments/${a.id}`)).statusCode).toBe(404);
  });
});

describe('품질·지도 API', () => {
  it('품질', async () => {
    const s = (await req('GET', '/v1/admin/quality')).json();
    expect(s.rules.map((r: { id: string }) => r.id)).toContain('V-S14');
    expect(s.rules.find((r: { id: string }) => r.id === 'V-S10').count).toBe(2);
    const items = (await req('GET', '/v1/admin/quality/V-S10?limit=1')).json();
    expect(items).toMatchObject({ total: 2, limit: 1 });
    expect(items.items[0]).toMatchObject({
      entity_type: 'line',
      entity_id: 'line-fx-one',
      label: '시험 1호선',
      detail: '#0052A4',
    });
    expect((await req('GET', '/v1/admin/quality/nope')).statusCode).toBe(404);
  });

  it('지도', async () => {
    const lines = (await req('GET', '/v1/admin/map/lines?at=future')).json();
    expect(lines.type).toBe('FeatureCollection');
    expect(lines.features.map((f: { id: string }) => f.id).sort()).toEqual([
      'line:line-fx-one',
      'plan:plan-fx-ext',
      'plan:plan-fx-replace',
    ]);
    const rep = lines.features.find((f: { id: string }) => f.id === 'plan:plan-fx-replace');
    expect(rep.properties).toMatchObject({
      plan_id: 'plan-fx-replace',
      color: '#123456',
      color_basis: 'official',
      quality: 'traced',
      line_style: 'dashed_bold',
      target_value: '2032',
      delayed: false,
      odbl: false,
    });
    const cur = (await req('GET', '/v1/admin/map/lines')).json();
    expect(cur.at).toBe(new Date().getFullYear());
    expect((await req('GET', '/v1/admin/map/lines?at=abc')).statusCode).toBe(422);
    expect((await req('GET', '/v1/admin/map/lines?stage_min=nope')).statusCode).toBe(422);
    const st = (await req('GET', '/v1/admin/map/stations?at=2030')).json();
    expect(st.features.find((f: { id: string }) => f.id === 'stn-fx-d').properties).toMatchObject({
      future: true,
      approximate: true,
    });
    await t.pool.query('SELECT refresh_derived()');
    const cs = (await req('GET', '/v1/admin/map/current-stations')).json();
    expect(cs.features).toHaveLength(5);
    expect(cs.features.find((f: { id: string }) => f.id === 'stn-fx-a').properties).toMatchObject({
      line_ids: ['line-fx-one', 'line-fx-two'],
      snapped: false,
    });
    expect((await req('GET', '/v1/admin/map/current-lines')).json()).toEqual({
      type: 'FeatureCollection',
      attribution: '© OpenStreetMap contributors, ODbL',
      features: [],
    });
    expect((await req('GET', '/v1/admin/map/timeline?stage_min=concept')).json()).toMatchObject({
      years: [
        { year: 2029, count: 1 },
        { year: 2032, count: 1 },
      ],
      undated: 1,
    });
  });
});

describe('변경 묶음: 일부 승인·충돌·되돌리기', () => {
  const SRC = [{ source_id: 'src-fixture-notice' }];
  const st = (id: string) => ({
    op: 'create',
    entity_type: 'station',
    data: { id, name_ko: id, checked_at: '2026-11-20', sources: SRC },
  });

  it('op_seqs 승인 → 나머지 draft, 충돌 409·force', async () => {
    const id = (
      await req('POST', '/v1/admin/changesets', {
        title: '셋',
        ops: [st('stn-api-1'), st('stn-api-2'), st('stn-api-3')],
      })
    ).json().id;
    const ap = await req('POST', `/v1/admin/changesets/${id}/approve`, { op_seqs: [1, 3] });
    expect(ap.statusCode).toBe(200);
    const rest = ap.json().remainder_changeset_id;
    expect(ap.json().results.map((r: { entity_id: string }) => r.entity_id)).toEqual(['stn-api-1', 'stn-api-3']);
    const restDetail = (await req('GET', `/v1/admin/changesets/${rest}`)).json();
    expect(restDetail).toMatchObject({ status: 'draft', meta: { split_from: id } });
    expect(restDetail.ops).toEqual([expect.objectContaining({ seq: 1, entity_id: 'stn-api-2' })]);

    const d2 = (
      await req('POST', '/v1/admin/changesets', {
        title: '수정',
        ops: [{ op: 'update', entity_type: 'station', id: 'stn-api-1', data: { address: '제안' } }],
      })
    ).json().id;
    const cur = (await req('GET', '/v1/admin/station/stn-api-1')).json().version;
    await req('PATCH', '/v1/admin/station/stn-api-1', { address: '직접' }, { 'if-match': String(cur) });
    const conflict = await req('POST', `/v1/admin/changesets/${d2}/approve`, {});
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.details[0]).toMatchObject({ rule: 'base_data_version', entity_id: 'stn-api-1' });
    expect((await req('POST', `/v1/admin/changesets/${d2}/approve`, { force: true })).statusCode).toBe(200);
  });

  it('되돌리기: 묶음·op 하나·불가', async () => {
    const c = await req('POST', '/v1/admin/station', st('stn-api-rv').data);
    const csId = c.json().changeset_id;
    const dry = await req('POST', `/v1/admin/changesets/${csId}/revert?dry_run=true`);
    expect(dry.json()).toMatchObject({ dry_run: true, results: [expect.objectContaining({ op: 'delete' })] });
    expect((await req('GET', '/v1/admin/station/stn-api-rv')).statusCode).toBe(200);
    const rv = await req('POST', `/v1/admin/changesets/${csId}/revert`);
    expect(rv.statusCode).toBe(200);
    expect(rv.json()).toMatchObject({ reverts_changeset_id: csId, dry_run: false });
    expect((await req('GET', '/v1/admin/station/stn-api-rv')).statusCode).toBe(404);
    expect((await req('POST', `/v1/admin/changesets/${csId}/revert`)).statusCode).toBe(409);
    const detail = (await req('GET', `/v1/admin/changesets/${rv.json().changeset_id}`)).json();
    expect(detail).toMatchObject({ origin: 'revert', reverts_changeset_id: csId });
    // 다른 개체의 op 를 지정하면 422
    const v = (await req('GET', '/v1/admin/station/stn-fx-b')).json().version;
    const u = (
      await req('PATCH', '/v1/admin/station/stn-fx-b', { address: '나주소' }, { 'if-match': String(v) })
    ).json();
    expect(
      (await req('POST', '/v1/admin/station/stn-fx-a/revert', { changeset_id: u.changeset_id, seq: 1 })).statusCode,
    ).toBe(422);
    const one = await req('POST', '/v1/admin/station/stn-fx-b/revert', { changeset_id: u.changeset_id, seq: 1 });
    expect(one.statusCode).toBe(200);
    expect((await req('GET', '/v1/admin/station/stn-fx-b')).json().data.address).toBeNull();
    // 병합은 되돌릴 수 없음
    await req('POST', '/v1/admin/station', st('stn-api-m').data);
    const m = (await req('POST', '/v1/admin/stations/stn-api-m/merge', { into_id: 'stn-fx-e' })).json();
    expect((await req('POST', `/v1/admin/changesets/${m.changeset_id}/revert`)).statusCode).toBe(409);
  });
});
