/**
 * 작업 처리 함수(pg-boss 와 분리해 시험할 수 있게). 문서 처리는 도메인 documents.ts 를 부른다.
 */
import {
  API_CALL_BODY_RETENTION_DAYS,
  cropFigure,
  extractDocumentText,
  renderPageImages,
  type JobPayloads,
  type ObjectStore,
} from '@k-raildex/domain';
import { runImporter, type ImporterJob } from '@k-raildex/importers';
import type pg from 'pg';
import { sharpCropper } from './cropper';

export interface WorkerDeps {
  pool: pg.Pool;
  store: ObjectStore;
}

/** 물리화 뷰 갱신(mv_search·mv_map_station·mv_map_line) */
export async function refreshDerived(deps: WorkerDeps): Promise<{ ms: number }> {
  const t = Date.now();
  await deps.pool.query('SELECT refresh_derived()');
  return { ms: Date.now() - t };
}

/** 외부 API 호출 기록의 응답 본문을 보관 기간 뒤 비운다(스냅샷 문서는 영구) */
export async function cleanupApiCalls(deps: WorkerDeps, data: JobPayloads['cleanup-api-calls'] = {}) {
  const days = data.days ?? API_CALL_BODY_RETENTION_DAYS;
  const r = await deps.pool.query(
    `UPDATE ingest.api_call SET response_body = NULL
      WHERE response_body IS NOT NULL AND called_at < now() - make_interval(days => $1)`,
    [days],
  );
  return { cleared: r.rowCount ?? 0, days };
}

async function withClient<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

export function docTextExtract(deps: WorkerDeps, data: JobPayloads['doc.text-extract']) {
  return withClient(deps.pool, (c) => extractDocumentText(c, deps.store, data.document_id));
}

export function docPageImages(deps: WorkerDeps, data: JobPayloads['doc.page-images']) {
  return withClient(deps.pool, (c) => renderPageImages(c, deps.store, data.document_id, { force: data.force }));
}

export async function docCrop(deps: WorkerDeps, data: JobPayloads['doc.crop']) {
  const r = await withClient(deps.pool, (c) =>
    cropFigure(c, deps.store, sharpCropper, {
      document_id: data.document_id,
      page: data.page,
      bbox: data.bbox,
      title: data.title,
      author_id: data.author_id ?? null,
    }),
  );
  return { document_id: r.document.id, created: r.created };
}

/** 수집기 실행(docs/08 3-1). 시간표 쓰기는 한 트랜잭션이라 풀에서 연결 하나를 빌린다 */
export async function importerRun(deps: WorkerDeps, data: ImporterJob) {
  const r = await withClient(deps.pool, (c) =>
    runImporter(c, data.task, { trigger: 'event', ...data.options }, (m) => console.log(`[importer] ${m}`)),
  );
  return { run_id: r.runId, sets: r.stats.sets ?? null, entries: r.stats.entries ?? null, issues: r.stats.issues };
}
