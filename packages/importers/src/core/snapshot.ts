/**
 * 외부 데이터셋 정규화 스냅샷(ingest.snapshot) — 외부 키마다 정규화 결과의 sha256 을 남겨 다음 실행에서 바뀐 것만 셀 수 있게 한다.
 * payload 에는 작은 요약만 둔다(행 전체는 원본 파일·api_call 에 있다).
 */
import { createHash } from 'node:crypto';
import type { Queryable } from '@k-raildex/domain';

/** 키 순서를 고정한 JSON(같은 내용 = 같은 해시) */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`;
}

export function sha256Of(v: unknown): string {
  return createHash('sha256').update(canonicalJson(v)).digest('hex');
}

export type SnapshotChange = 'new' | 'changed' | 'same';

export interface SnapshotStats {
  new: number;
  changed: number;
  same: number;
}

export const emptySnapshotStats = (): SnapshotStats => ({ new: 0, changed: 0, same: 0 });

/** 스냅샷 갱신. runId 가 null(dry-run)이면 읽기만 한다 */
export async function upsertSnapshot(
  db: Queryable,
  task: string,
  externalKey: string,
  rows: unknown,
  summary: Record<string, unknown>,
  runId: number | null,
): Promise<SnapshotChange> {
  const sha = sha256Of(rows);
  const prev = await db.query<{ sha256: string }>(
    `SELECT sha256 FROM ingest.snapshot WHERE task = $1 AND external_key = $2`,
    [task, externalKey],
  );
  const change: SnapshotChange = !prev.rows[0] ? 'new' : prev.rows[0].sha256 === sha ? 'same' : 'changed';
  if (runId !== null) {
    await db.query(
      `INSERT INTO ingest.snapshot (task, external_key, payload, sha256, first_seen_run, last_seen_run)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (task, external_key) DO UPDATE
         SET payload = EXCLUDED.payload, sha256 = EXCLUDED.sha256, last_seen_run = EXCLUDED.last_seen_run`,
      [task, externalKey, JSON.stringify(summary), sha, runId],
    );
  }
  return change;
}
