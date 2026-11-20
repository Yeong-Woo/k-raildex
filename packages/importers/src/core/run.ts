/**
 * 수집 실행 기록(ingest.run, docs/08-ingestion-closed-loop.md 3-3절). 시간표 같은 기계적 데이터는 도메인 적용기를 거치지 않고
 * 수집 실행 단위로 기록한다(Q98 A). 실행 기록은 쓰기 트랜잭션 밖에서 남겨 실패해도 failed 로 보존된다.
 */
import type { Queryable } from '@k-raildex/domain';

export type RunTrigger = 'schedule' | 'manual' | 'event';

export interface RunHandle {
  id: number;
  task: string;
  /** 사람이 읽는 실행 로그(리포트). finish 때 ingest.run.log 로 저장 */
  log: string[];
}

export async function startRun(
  db: Queryable,
  task: string,
  trigger: RunTrigger,
  params: Record<string, unknown>,
): Promise<RunHandle> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO ingest.run (task, trigger, status, started_at, params)
     VALUES ($1, $2, 'running', now(), $3) RETURNING id`,
    [task, trigger, JSON.stringify(params)],
  );
  return { id: Number(r.rows[0]!.id), task, log: [] };
}

export async function finishRun(db: Queryable, run: RunHandle, stats: Record<string, unknown>): Promise<void> {
  await db.query(`UPDATE ingest.run SET status = 'done', finished_at = now(), stats = $2, log = $3 WHERE id = $1`, [
    run.id,
    JSON.stringify(stats),
    run.log.join('\n') || null,
  ]);
}

export async function failRun(
  db: Queryable,
  run: RunHandle,
  error: unknown,
  stats?: Record<string, unknown>,
): Promise<void> {
  const msg = error instanceof Error ? (error.stack ?? error.message) : String(error);
  await db.query(
    `UPDATE ingest.run SET status = 'failed', finished_at = now(), error = $2, stats = $3, log = $4 WHERE id = $1`,
    [run.id, msg.slice(0, 8000), stats ? JSON.stringify(stats) : null, run.log.join('\n') || null],
  );
}

/**
 * 실행 기록으로 감싼다. dryRun 이면 기록하지 않고 id 0 핸들을 준다(DB 에 아무것도 쓰지 않음).
 * fn 이 돌려준 stats 를 기록하고, 던지면 failed 로 남긴 뒤 다시 던진다.
 */
export async function withRun<T extends { stats: Record<string, unknown> }>(
  db: Queryable,
  task: string,
  opts: { trigger?: RunTrigger; params?: Record<string, unknown>; dryRun?: boolean },
  fn: (run: RunHandle) => Promise<T>,
): Promise<T & { runId: number | null; log: string[] }> {
  if (opts.dryRun) {
    const run: RunHandle = { id: 0, task, log: [] };
    const out = await fn(run);
    return { ...out, runId: null, log: run.log };
  }
  const run = await startRun(db, task, opts.trigger ?? 'manual', opts.params ?? {});
  try {
    const out = await fn(run);
    await finishRun(db, run, out.stats);
    return { ...out, runId: run.id, log: run.log };
  } catch (e) {
    await failRun(db, run, e).catch(() => {});
    throw e;
  }
}
