import { freshDb, type FreshDb } from '@k-raildex/db/testing';
import {
  applyChangeset,
  ensureServiceUser,
  fixtureOps,
  getJob,
  IMPORTER_TASK_LIST,
  JOB,
  JOB_SCHEDULES,
  lastValidation,
  listJobs,
  listPageImages,
  opsStatus,
  MemoryObjectStore,
  uploadDocument,
} from '@k-raildex/domain';
import { IMPORTER_JOB, IMPORTER_TASKS } from '@k-raildex/importers';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { makePdf } from '../../../packages/domain/test/pdf';
import { Debouncer } from '../src/debounce';
import { cleanupApiCalls } from '../src/handlers';
import { startWorker, type RunningWorker } from '../src/worker';

describe('Debouncer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it('마지막 호출 뒤 한 번, maxWait 넘으면 강제', () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const d = new Debouncer(
      (n) => void calls.push(n),
      2000,
      5000,
      () => Date.now(),
    );
    d.trigger();
    vi.advanceTimersByTime(1500);
    d.trigger();
    vi.advanceTimersByTime(1500);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(600);
    expect(calls).toEqual([2]);
    for (let i = 0; i < 10; i++) {
      d.trigger();
      vi.advanceTimersByTime(900);
    }
    expect(calls.length).toBe(2); // 5초 상한으로 중간에 한 번 더
    vi.advanceTimersByTime(2000);
    expect(calls.length).toBe(3);
    vi.useRealTimers();
  });
});

describe('수집기 과제 목록', () => {
  it('api 정적 목록(IMPORTER_TASK_LIST)에 importers 의 과제가 모두 있다', () => {
    expect(IMPORTER_JOB).toBe(JOB.importerRun);
    const listed = IMPORTER_TASK_LIST.map((t) => t.task);
    for (const t of IMPORTER_TASKS) expect(listed).toContain(t);
  });
  it('수집기(시간표 등)는 예약하지 않는다 — 수동 실행만(round-04 Q110 C)', () => {
    expect(JOB_SCHEDULES.map((s) => s.name)).not.toContain(JOB.importerRun);
  });
});

describe('worker(pg-boss)', () => {
  let fx: FreshDb;
  let w: RunningWorker;
  const store = new MemoryObjectStore();
  let author: string;

  beforeAll(async () => {
    fx = await freshDb();
    author = await ensureServiceUser(fx.client, 'system', 'test');
    w = await startWorker({
      databaseUrl: fx.url,
      store,
      debounceMs: 300,
      refreshOnStart: false,
      pollingIntervalSeconds: 0.5,
      log: () => {},
    });
  });
  afterAll(async () => {
    await w?.stop();
    await fx?.close();
  });

  const waitFor = async (pred: () => boolean | Promise<boolean>, ms = 20_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await pred()) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('시간 초과');
  };

  it('data_changed → 디바운스 → refresh-derived → 물리화 뷰 갱신', async () => {
    const before = await fx.client.query(`SELECT count(*)::int AS n FROM mv_map_station`);
    expect(before.rows[0].n).toBe(0);
    await applyChangeset(fx.client, {
      title: '픽스처',
      origin: 'legacy_migration',
      author_id: author,
      ops: fixtureOps(),
    });
    await waitFor(() => w.completed.some((c) => c.name === JOB.refreshDerived));
    expect(w.completed.filter((c) => c.name === JOB.refreshDerived)).toHaveLength(1);
    const after = await fx.client.query(`SELECT count(*)::int AS n FROM mv_map_station`);
    expect(after.rows[0].n).toBe(5);
  });

  it('doc.page-images·doc.text-extract·doc.crop', async () => {
    const c = await w.pool.connect();
    const up = await uploadDocument(c, store, {
      buffer: makePdf(['one', 'two', 'three']),
      filename: 'w.pdf',
      license_class: 'public_work',
      author_id: author,
    }).finally(() => c.release());
    const id = up.document.id;
    await w.boss.send(JOB.docPageImages, { document_id: id });
    await w.boss.send(JOB.docTextExtract, { document_id: id });
    await w.boss.send(JOB.docCrop, { document_id: id, page: 3, bbox: [0, 0, 0.5, 0.5] });
    await waitFor(() =>
      [JOB.docPageImages, JOB.docTextExtract, JOB.docCrop].every((n) => w.completed.some((x) => x.name === n)),
    );
    expect((await listPageImages(w.pool, id)).map((p) => p.page)).toEqual([1, 2, 3]);
    const t = await w.pool.query(`SELECT pages, text_content FROM document WHERE id = $1`, [id]);
    expect(t.rows[0].pages).toBe(3);
    expect(t.rows[0].text_content).toContain('three');
    const crops = await w.pool.query(
      `SELECT count(*)::int AS n FROM document WHERE parent_document_id = $1 AND kind = 'figure_crop'`,
      [id],
    );
    expect(crops.rows[0].n).toBe(1);
  });

  it('cleanup-api-calls: 7일 지난 응답 본문 비우기', async () => {
    await w.pool.query(
      `INSERT INTO ingest.api_endpoint (id, provider, name_ko, base_url, response_format)
       SELECT 'ep-test', 'other', '시험', 'https://example.com', 'json'
        WHERE NOT EXISTS (SELECT 1 FROM ingest.api_endpoint WHERE id = 'ep-test')`,
    );
    await w.pool.query(
      `INSERT INTO ingest.api_call (endpoint_id, params, called_at, origin, response_body) VALUES
         ('ep-test', '{}', now() - interval '8 days', 'admin', 'old'), ('ep-test', '{}', now(), 'admin', 'new')`,
    );
    const r = await cleanupApiCalls({ pool: w.pool, store });
    expect(r.cleared).toBe(1);
    const left = await w.pool.query(`SELECT count(*)::int AS n FROM ingest.api_call WHERE response_body IS NOT NULL`);
    expect(left.rows[0].n).toBe(1);
  });

  it('validate-all 작업 → validation.last, 작업 목록·상태에 pg-boss 작업이 보인다', async () => {
    const id = await w.boss.send(JOB.validateAll, { reason: 'test' });
    await waitFor(() => w.completed.some((c) => c.name === JOB.validateAll));
    const last = await lastValidation(w.pool);
    expect(last?.hard_count).toBe(0);
    const list = await listJobs(w.pool, { name: JOB.validateAll });
    expect(list.pgboss).toBe(true);
    await waitFor(async () => (await getJob(w.pool, id!)).state === 'completed');
    const job = await getJob(w.pool, id!);
    expect(job).toMatchObject({ kind: 'job', name: 'validate-all', data: { reason: 'test' } });
    expect(job.output).toMatchObject({ hard_count: 0 });
    const s = await opsStatus(w.pool);
    expect(s.failed_jobs_24h).toBe(0);
  });

  it('importer.run 모르는 과제 → 실패 작업(배너 집계)', async () => {
    const id = await w.boss.send(JOB.importerRun, { task: 'no-such-task' });
    await waitFor(async () => (await getJob(w.pool, id!)).state === 'failed');
    const job = await getJob(w.pool, id!);
    expect(job.error).toBeTruthy();
    const s = await opsStatus(w.pool);
    expect(s.failed_jobs_24h).toBe(1);
    expect(s.recent_failures[0]).toMatchObject({ id, kind: 'job', name: 'importer.run' });
  });
});
