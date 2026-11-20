/**
 * worker 조립: pg-boss 큐·처리기 등록, data_changed LISTEN → 디바운스(2초) → refresh-derived 작업.
 * (docs/04-api.md 7절 8단계, docs/02-architecture.md)
 */
import { JOB, JOB_QUEUES, JOB_SCHEDULES, type JobName, type JobPayloads, type ObjectStore } from '@k-raildex/domain';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { Debouncer } from './debounce';
import * as h from './handlers';

export interface WorkerOptions {
  databaseUrl: string;
  store: ObjectStore;
  /** data_changed 디바운스(기본 2000ms) */
  debounceMs?: number;
  /** 시작할 때 파생 갱신을 한 번 보낸다(꺼져 있던 동안의 변경 반영). 기본 true */
  refreshOnStart?: boolean;
  /** pg-boss 폴링 간격(초, 기본 2) */
  pollingIntervalSeconds?: number;
  log?: (msg: string) => void;
}

export interface RunningWorker {
  boss: PgBoss;
  pool: pg.Pool;
  /** 처리 완료 기록(시험·로그용) */
  completed: { name: JobName; result: unknown }[];
  stop(): Promise<void>;
}

export async function startWorker(opts: WorkerOptions): Promise<RunningWorker> {
  const log = opts.log ?? ((m: string) => console.log(`[worker] ${m}`));
  const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 4 });
  const deps: h.WorkerDeps = { pool, store: opts.store };
  const boss = new PgBoss({ connectionString: opts.databaseUrl, max: 4 });
  boss.on('error', (e: unknown) => console.error('[pg-boss]', e));
  await boss.start();
  for (const [name, q] of Object.entries(JOB_QUEUES)) await boss.createQueue(name, q);
  for (const s of JOB_SCHEDULES) await boss.schedule(s.name, s.cron, {}, { tz: s.tz });

  const completed: RunningWorker['completed'] = [];
  const pollingIntervalSeconds = opts.pollingIntervalSeconds ?? 2;
  const register = async <N extends JobName>(name: N, fn: (data: JobPayloads[N]) => Promise<unknown>) => {
    await boss.work<JobPayloads[N]>(name, { pollingIntervalSeconds }, async (jobs) => {
      for (const job of jobs) {
        const t = Date.now();
        const result = await fn(job.data ?? ({} as JobPayloads[N]));
        completed.push({ name, result });
        log(`${name} ${job.id} 완료 ${Date.now() - t}ms ${JSON.stringify(result)}`);
      }
    });
  };
  await register(JOB.refreshDerived, () => h.refreshDerived(deps));
  await register(JOB.cleanupApiCalls, (d) => h.cleanupApiCalls(deps, d));
  await register(JOB.docTextExtract, (d) => h.docTextExtract(deps, d));
  await register(JOB.docPageImages, (d) => h.docPageImages(deps, d));
  await register(JOB.docCrop, (d) => h.docCrop(deps, d));

  // data_changed 수신: 전용 연결. 끊기면 다시 붙고, 그 사이 놓친 변경을 위해 갱신 한 번
  let lastVersion: number | undefined;
  const debouncer = new Debouncer(async (n) => {
    const id = await boss.send(JOB.refreshDerived, { reason: `data_changed ×${n}`, data_version: lastVersion });
    log(`refresh-derived 보냄(${n}건 묶음, data_version ${String(lastVersion)}) ${id ?? '(이미 대기 중)'}`);
  }, opts.debounceMs ?? 2000);
  let listener: pg.Client | null = null;
  let stopping = false;
  const listen = async (): Promise<void> => {
    const c = new pg.Client({ connectionString: opts.databaseUrl });
    c.on('notification', (msg) => {
      if (msg.channel !== 'data_changed') return;
      const v = Number(msg.payload);
      if (Number.isFinite(v)) lastVersion = v;
      debouncer.trigger();
    });
    c.on('error', (e) => {
      console.error('[listen]', e.message);
      if (stopping) return;
      listener = null;
      void c.end().catch(() => {});
      setTimeout(() => {
        if (!stopping)
          void listen().then(
            () => debouncer.trigger(),
            (err: unknown) => console.error('[listen]', err),
          );
      }, 1000);
    });
    await c.connect();
    await c.query('LISTEN data_changed');
    listener = c;
  };
  await listen();
  log('LISTEN data_changed');
  if (opts.refreshOnStart ?? true) await boss.send(JOB.refreshDerived, { reason: 'worker start' });

  return {
    boss,
    pool,
    completed,
    stop: async () => {
      stopping = true;
      debouncer.cancel();
      await listener?.end().catch(() => {});
      await boss.stop({ graceful: true, timeout: 10_000 });
      await pool.end();
    },
  };
}
