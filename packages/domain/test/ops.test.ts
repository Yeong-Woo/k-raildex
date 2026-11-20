/** 운영 기능: 작업 목록(실행 기록)·운영 상태·전체 검증·에이전트 예산·원본 재다운로드 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { freshDb, type FreshDb } from '@k-raildex/db/testing';
import {
  applyChangeset,
  DomainError,
  ensureServiceUser,
  fixtureOps,
  getAgentBudget,
  getJob,
  lastValidation,
  listJobs,
  listSettings,
  MemoryObjectStore,
  opsStatus,
  refetchDocument,
  setAgentBudget,
  uploadDocument,
  validateAll,
} from '../src';

let fx: FreshDb;
let db: pg.Client;
let author: string;
const store = new MemoryObjectStore();

beforeAll(async () => {
  fx = await freshDb();
  db = fx.client;
  author = await ensureServiceUser(db, 'system', 'test');
  await applyChangeset(db, { title: '픽스처', origin: 'legacy_migration', author_id: author, ops: fixtureOps() });
});
afterAll(async () => fx?.close());

describe('작업 목록·운영 상태', () => {
  it('pg-boss 스키마가 없으면 실행 기록만', async () => {
    await db.query(
      `INSERT INTO ingest.run (task, trigger, status, started_at, finished_at, error, stats) VALUES
         ('tago-timetable', 'manual', 'done', now() - interval '2 hours', now() - interval '1 hour', NULL, '{"sets": 3}'),
         ('kric-train-ops', 'event', 'failed', now() - interval '30 minutes', now() - interval '29 minutes', '응답 오류', NULL),
         ('kric-train-ops', 'event', 'failed', now() - interval '3 days', now() - interval '3 days', '옛 오류', NULL)`,
    );
    const r = await listJobs(db, {});
    expect(r.pgboss).toBe(false);
    expect(r.items.map((x) => [x.name, x.state])).toEqual([
      ['kric-train-ops', 'failed'],
      ['tago-timetable', 'completed'],
      ['kric-train-ops', 'failed'],
    ]);
    expect(r.items[0]).toMatchObject({ kind: 'run', error: '응답 오류', trigger: 'event' });
    expect((await listJobs(db, { state: 'failed', name: 'kric-train-ops' })).items).toHaveLength(2);
    expect((await listJobs(db, { kind: 'job' })).items).toHaveLength(0);
    await expect(listJobs(db, { state: 'nope' })).rejects.toThrow();
    const one = await getJob(db, r.items[1]!.id);
    expect(one).toMatchObject({ name: 'tago-timetable', output: { sets: 3 }, log: null });
    await expect(getJob(db, 'run-999999')).rejects.toBeInstanceOf(DomainError);
    await expect(getJob(db, '00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(DomainError);

    const s = await opsStatus(db);
    expect(s).toMatchObject({ failed_jobs_24h: 0, failed_runs_24h: 1, last_backup_at: null, queue_depth: 0 });
    expect(s.recent_failures).toEqual([expect.objectContaining({ kind: 'run', error: '응답 오류' })]);
  });
});

describe('에이전트 예산', () => {
  it('기본 30달러, 이번 달 agent:* 비용 합', async () => {
    await db.query(
      `INSERT INTO ingest.run (task, trigger, status, started_at, cost_usd) VALUES
         ('agent:plan-watch', 'manual', 'done', now(), 1.25),
         ('agent:plan-watch', 'manual', 'done', now(), 0.5),
         ('agent:plan-watch', 'manual', 'done', now() - interval '45 days', 9),
         ('tago-timetable', 'manual', 'done', now(), 100)`,
    );
    const b = await getAgentBudget(db);
    expect(b).toMatchObject({ monthly_usd: 30, is_default: true, spent_usd: 1.75, runs: 2, exceeded: false });
    expect(b.remaining_usd).toBeCloseTo(28.25);
    const u = await setAgentBudget(db, { monthly_usd: 1.5 });
    expect(u).toMatchObject({ monthly_usd: 1.5, is_default: false, exceeded: true, remaining_usd: 0 });
    await expect(setAgentBudget(db, { monthly_usd: -1 })).rejects.toBeInstanceOf(DomainError);
    await expect(setAgentBudget(db, { monthly_usd: 3, x: 1 })).rejects.toBeInstanceOf(DomainError);
    const list = await listSettings(db);
    expect(list.items.find((s) => s.key === 'agent.budget')).toMatchObject({
      value: { monthly_usd: 1.5 },
      is_default: false,
      editable: true,
    });
  });
});

describe('전체 검증', () => {
  it('픽스처는 Hard 위반 0 → 규칙 위반을 직접 넣으면 잡고 app_setting 에 남긴다', async () => {
    const clean = await validateAll(db);
    expect(clean.hard_count).toBe(0);
    expect(clean.entity_count).toBeGreaterThan(10);
    expect(clean.soft_counts.length).toBeGreaterThan(5);
    // 적용기를 우회한 잘못된 행(V-H06: 종점 역이 노선 역 목록에 없음)
    await db.query(`UPDATE line SET end_station_id = 'stn-fx-e' WHERE id = 'line-fx-one'`);
    try {
      const r = await validateAll(db);
      expect(r.hard).toContainEqual(
        expect.objectContaining({ rule: 'V-H06', entity_id: 'line-fx-one', entity_type: 'line' }),
      );
      const last = await lastValidation(db);
      expect(last?.at).toBe(r.at);
      expect(last?.hard_count).toBe(r.hard_count);
      const s = (await listSettings(db)).items.find((x) => x.key === 'validation.last');
      expect(s?.value).toEqual({ at: r.at, hard_count: r.hard_count, soft_total: r.soft_total });
    } finally {
      await db.query(`UPDATE line SET end_station_id = 'stn-fx-c' WHERE id = 'line-fx-one'`);
    }
  });
});

describe('원본 재다운로드', () => {
  let server: Server;
  let base: string;
  let body = Buffer.from('%PDF-1.4 first version');
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/doc.pdf') {
        res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': body.length });
        res.end(body);
      } else if (req.url === '/moved') {
        res.writeHead(302, { location: '/doc.pdf' });
        res.end();
      } else if (req.url === '/ftp') {
        res.writeHead(301, { location: 'ftp://example.com/x.pdf' });
        res.end();
      } else if (req.url === '/slow') {
        setTimeout(() => res.end('late'), 2000);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const make = async (origin: string, content: Buffer) =>
    (
      await uploadDocument(db, store, {
        buffer: content,
        filename: '고시.pdf',
        kind: 'original',
        license_class: 'kogl_1',
        source_id: 'src-fixture-notice',
        origin_url: origin,
        title: '고시',
        author_id: author,
      })
    ).document;

  it('같으면 changed false, 바뀌면 새 판(이전 판 유지·출처 복사)', async () => {
    const doc = await make(`${base}/moved`, body);
    const same = await refetchDocument(db, store, doc.id, { author_id: author });
    expect(same.changed).toBe(false);
    expect(same.document.id).toBe(doc.id);
    body = Buffer.from('%PDF-1.4 second version, longer');
    const next = await refetchDocument(db, store, doc.id, { author_id: author });
    expect(next.changed).toBe(true);
    expect(next.document.id).not.toBe(doc.id);
    expect(next.document).toMatchObject({
      kind: 'original',
      mime: 'application/pdf',
      license_class: 'kogl_1',
      publishable: false,
      title: '고시',
      source_ids: ['src-fixture-notice'],
      origin_url: `${base}/moved`,
      size_bytes: body.length,
    });
    expect(next.document.meta.previous_document_id).toBe(doc.id);
    expect(next.previous_document_id).toBe(doc.id);
    expect((await store.getBuffer(next.document.storage_key)).equals(body)).toBe(true);
    const { rows } = await db.query(`SELECT deleted_at, meta FROM document WHERE id = $1`, [doc.id]);
    expect(rows[0].deleted_at).toBeNull();
    expect(rows[0].meta.last_refetch.next_document_id).toBe(next.document.id);
  });

  it('scheme·상태·크기·시간 제한', async () => {
    const err = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (e) {
        return (e as DomainError).details.violations?.[0]?.rule;
      }
      return 'no error';
    };
    const a = await make(`${base}/ftp`, Buffer.from('a1'));
    expect(await err(refetchDocument(db, store, a.id, { author_id: author }))).toBe('refetch.scheme');
    const b = await make(`${base}/missing`, Buffer.from('b1'));
    expect(await err(refetchDocument(db, store, b.id, { author_id: author }))).toBe('refetch.http');
    const c = await make(`${base}/doc.pdf`, Buffer.from('c1'));
    expect(await err(refetchDocument(db, store, c.id, { author_id: author, limits: { maxBytes: 5 } }))).toBe(
      'refetch.size',
    );
    const d = await make(`${base}/slow`, Buffer.from('d1'));
    expect(await err(refetchDocument(db, store, d.id, { author_id: author, limits: { timeoutMs: 200 } }))).toBe(
      'refetch.timeout',
    );
    const e = await make('file:///etc/passwd', Buffer.from('e1'));
    expect(await err(refetchDocument(db, store, e.id, { author_id: author }))).toBe('refetch.scheme');
  });
});
