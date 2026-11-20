import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers';

let t: TestApp;
const SRC = [{ source_id: 'src-fixture-notice' }];

const req = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  t.app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });

const draft = (id: string, extra: Record<string, unknown> = {}) => ({
  title: `제안 ${id}`,
  rationale: '시험',
  ops: [
    {
      op: 'create',
      entity_type: 'station',
      data: { id, name_ko: id, checked_at: '2026-11-20', sources: SRC, ...extra },
    },
  ],
});

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => t?.close());

describe('변경 묶음', () => {
  it('제출 → 목록 → 상세 → 미리 보기 → 승인', async () => {
    const sub = await req('POST', '/v1/admin/changesets', draft('stn-fx-draft'));
    expect(sub.statusCode).toBe(201);
    const id = sub.json().id as string;
    expect(sub.json()).toMatchObject({ status: 'draft', op_count: 1 });

    const list = (await req('GET', '/v1/admin/changesets?status=draft')).json();
    expect(list.items.map((c: { id: string }) => c.id)).toContain(id);
    expect(list.items.find((c: { id: string }) => c.id === id)).toMatchObject({ op_count: 1, origin: 'admin_edit' });
    expect((await req('GET', '/v1/admin/changesets?origin=legacy_migration')).json().total).toBe(1);
    expect((await req('GET', '/v1/admin/changesets?status=nope')).statusCode).toBe(400);

    const detail = (await req('GET', `/v1/admin/changesets/${id}`)).json();
    expect(detail.ops).toHaveLength(1);
    expect(detail.ops[0]).toMatchObject({ seq: 1, op: 'create', entity_id: 'stn-fx-draft' });

    const prev = await req('POST', `/v1/admin/changesets/${id}/preview`);
    expect(prev.statusCode).toBe(200);
    expect(prev.json()).toMatchObject({ ok: true, results: [expect.objectContaining({ entity_id: 'stn-fx-draft' })] });
    expect((await req('GET', '/v1/admin/station/stn-fx-draft')).statusCode).toBe(404);

    const ok = await req('POST', `/v1/admin/changesets/${id}/approve`, { comment: '확인' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'applied', results: [expect.objectContaining({ version: 1 })] });
    expect(ok.json().data_version).toBeGreaterThan(0);
    expect((await req('GET', '/v1/admin/station/stn-fx-draft')).statusCode).toBe(200);
    expect((await req('GET', `/v1/admin/changesets/${id}`)).json()).toMatchObject({
      status: 'applied',
      review_comment: '확인',
    });

    // 다시 승인·미리 보기 → 409
    expect((await req('POST', `/v1/admin/changesets/${id}/approve`)).statusCode).toBe(409);
    expect((await req('POST', `/v1/admin/changesets/${id}/preview`)).statusCode).toBe(409);
  });

  it('반려', async () => {
    const id = (await req('POST', '/v1/admin/changesets', draft('stn-fx-rej'))).json().id;
    expect((await req('POST', `/v1/admin/changesets/${id}/reject`, {})).statusCode).toBe(400);
    const r = await req('POST', `/v1/admin/changesets/${id}/reject`, { comment: '근거 부족' });
    expect(r.statusCode).toBe(200);
    expect((await req('POST', `/v1/admin/changesets/${id}/approve`)).statusCode).toBe(409);
    expect((await req('GET', `/v1/admin/changesets/${id}`)).json().status).toBe('rejected');
  });

  it('미리 보기 실패는 결과로, 승인 실패는 422 + failed', async () => {
    // 형식은 맞지만 적용하면 실패(없는 역 수정)
    const id = (
      await req('POST', '/v1/admin/changesets', {
        title: '실패',
        ops: [{ op: 'update', entity_type: 'station', id: 'stn-fx-none', data: { address: 'x' } }],
      })
    ).json().id;
    const prev = (await req('POST', `/v1/admin/changesets/${id}/preview`)).json();
    expect(prev).toMatchObject({ ok: false, error: { code: 'not_found' } });
    const ap = await req('POST', `/v1/admin/changesets/${id}/approve`);
    expect(ap.statusCode).toBe(404);
    expect((await req('GET', `/v1/admin/changesets/${id}`)).json().status).toBe('failed');
  });

  it('형식 오류: op 모양 400, 계약 위반 422', async () => {
    const shape = await req('POST', '/v1/admin/changesets', { title: 'x', ops: [{ op: 'explode' }] });
    expect(shape.statusCode).toBe(400);
    expect(shape.json().error.code).toBe('bad_request');
    const contract = await req('POST', '/v1/admin/changesets', draft('stn-fx-bad', { kind: 'spaceport' }));
    expect(contract.statusCode).toBe(422);
    expect(contract.json().error.details[0]).toMatchObject({ rule: 'schema', path: 'ops.0.data.kind' });
    expect((await req('GET', '/v1/admin/changesets/cs-2026-01-01-none')).statusCode).toBe(404);
  });
});
