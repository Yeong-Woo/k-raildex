/** 운영 API: 작업·운영 상태·전체 검증·원본 재다운로드·설정 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { uploadDocument } from '@k-raildex/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './helpers';

let t: TestApp;
type Method = 'GET' | 'POST' | 'PUT';
const req = (method: Method, url: string, payload?: unknown) =>
  t.app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => t?.close());

describe('작업 API', () => {
  it('목록(pg-boss 스키마 없음 → 실행 기록만)·상세·운영 상태', async () => {
    await t.pool.query(
      `INSERT INTO ingest.run (task, trigger, status, started_at, finished_at, error, log) VALUES
         ('tago-timetable', 'manual', 'failed', now() - interval '1 minute', now(), '키 없음', '로그 줄')`,
    );
    const r = await req('GET', '/v1/admin/jobs');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ pgboss: false, total: 1 });
    const run = r.json().items[0];
    expect(run).toMatchObject({ kind: 'run', name: 'tago-timetable', state: 'failed', error: '키 없음' });
    expect((await req('GET', `/v1/admin/jobs/${run.id}`)).json()).toMatchObject({ log: '로그 줄' });
    expect((await req('GET', '/v1/admin/jobs/run-424242')).statusCode).toBe(404);
    expect((await req('GET', '/v1/admin/jobs?state=bogus')).statusCode).toBe(400);
    expect((await req('GET', '/v1/admin/jobs?state=pending')).json().total).toBe(0);
    const s = await req('GET', '/v1/admin/ops/status');
    expect(s.json()).toMatchObject({ failed_jobs_24h: 0, failed_runs_24h: 1, last_backup_at: null, queue_depth: 0 });
  });

  it('과제 목록·작업 보내기(허용 작업만)', async () => {
    const tasks = (await req('GET', '/v1/admin/jobs/importer-tasks')).json();
    expect(tasks.items.map((x: { task: string }) => x.task)).toEqual(
      expect.arrayContaining(['tago-timetable', 'kric-train-ops']),
    );
    expect(tasks.jobs.map((x: { name: string }) => x.name)).toContain('validate-all');
    t.jobs.sent.length = 0;
    const a = await req('POST', '/v1/admin/jobs', { name: 'importer.run', data: { task: 'kric-train-ops' } });
    expect(a.statusCode).toBe(202);
    expect(a.json()).toMatchObject({ name: 'importer.run', deduplicated: false });
    expect(t.jobs.sent[0]).toEqual({
      name: 'importer.run',
      data: { task: 'kric-train-ops', options: { trigger: 'manual' } },
    });
    expect((await req('POST', '/v1/admin/jobs', { name: 'validate-all' })).statusCode).toBe(202);
    expect((await req('POST', '/v1/admin/jobs', { name: 'cleanup-api-calls', data: { days: 3 } })).statusCode).toBe(
      202,
    );
    expect(t.jobs.sent.map((s) => s.name)).toEqual(['importer.run', 'validate-all', 'cleanup-api-calls']);
    expect((await req('POST', '/v1/admin/jobs', { name: 'doc.crop', data: {} })).statusCode).toBe(400);
    expect((await req('POST', '/v1/admin/jobs', { name: 'importer.run', data: { task: 'rm -rf' } })).statusCode).toBe(
      400,
    );
    expect(
      (
        await req('POST', '/v1/admin/jobs', {
          name: 'doc.text-extract',
          data: { document_id: '00000000-0000-4000-8000-000000000000' },
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('전체 검증 API', () => {
  it('없으면 404 → sync 결과 200 → last · 작업 모드 202', async () => {
    expect((await req('GET', '/v1/admin/validate-all/last')).statusCode).toBe(404);
    const r = await req('POST', '/v1/admin/validate-all?sync=true');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ hard_count: 0, hard: [] });
    expect(r.json().soft_counts.length).toBeGreaterThan(0);
    expect((await req('GET', '/v1/admin/validate-all/last')).json().at).toBe(r.json().at);
    t.jobs.sent.length = 0;
    const j = await req('POST', '/v1/admin/validate-all');
    expect(j.statusCode).toBe(202);
    expect(t.jobs.sent).toEqual([{ name: 'validate-all', data: { reason: 'admin' } }]);
  });
});

describe('설정 API', () => {
  it('에이전트 예산 기본 30 → 변경 → 목록', async () => {
    const g = await req('GET', '/v1/admin/settings/agent-budget');
    expect(g.json()).toMatchObject({ monthly_usd: 30, is_default: true, spent_usd: 0 });
    const p = await req('PUT', '/v1/admin/settings/agent-budget', { monthly_usd: 12.5 });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ monthly_usd: 12.5, is_default: false });
    expect((await req('PUT', '/v1/admin/settings/agent-budget', { monthly_usd: 'x' })).statusCode).toBe(422);
    const list = (await req('GET', '/v1/admin/settings')).json();
    expect(list.items.map((s: { key: string }) => s.key)).toEqual(['agent.budget', 'validation.last', 'backup.last']);
  });
});

describe('원본 재다운로드 API', () => {
  let server: Server;
  let base: string;
  let body = Buffer.from('%PDF-1.4 v1');
  beforeAll(async () => {
    server = createServer((rq, res) => {
      if (rq.url === '/a.pdf') {
        res.writeHead(200, { 'content-type': 'application/pdf' });
        res.end(body);
      } else {
        res.writeHead(500);
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('같음 → 바뀜(새 판 + 텍스트 추출 작업) · 원본 서버 오류 502', async () => {
    const c = await t.pool.connect();
    const mk = (url: string, buf: Buffer) =>
      uploadDocument(c, t.store, {
        buffer: buf,
        filename: 'a.pdf',
        kind: 'original',
        license_class: 'kogl_1',
        origin_url: url,
        author_id: null,
      });
    const doc = (await mk(`${base}/a.pdf`, body)).document;
    const broken = (await mk(`${base}/err`, Buffer.from('%PDF-1.4 other'))).document;
    c.release();
    const same = await req('POST', `/v1/admin/documents/${doc.id}/refetch`);
    expect(same.statusCode).toBe(200);
    expect(same.json()).toMatchObject({ changed: false, document: { id: doc.id } });
    body = Buffer.from('%PDF-1.4 v2 changed');
    t.jobs.sent.length = 0;
    const next = await req('POST', `/v1/admin/documents/${doc.id}/refetch`);
    expect(next.json()).toMatchObject({ changed: true, previous_document_id: doc.id });
    expect(next.json().document.id).not.toBe(doc.id);
    expect(t.jobs.sent).toEqual([{ name: 'doc.text-extract', data: { document_id: next.json().document.id } }]);
    expect((await req('GET', `/v1/admin/documents/${doc.id}`)).statusCode).toBe(200);
    const bad = await req('POST', `/v1/admin/documents/${broken.id}/refetch`);
    expect(bad.statusCode).toBe(502);
    expect(bad.json().error.code).toBe('bad_gateway');
  });
});
