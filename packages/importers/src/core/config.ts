/** 수집기 설정(ingest.config) 읽기·쓰기. 기존 보정 파일(tago-route-services.yaml 등)은 이관 때 여기로 옮겨진다 */
import type { Queryable } from '@k-raildex/domain';

export async function getConfig<T>(db: Queryable, task: string, key: string): Promise<T | null> {
  const r = await db.query<{ value: T }>(`SELECT value FROM ingest.config WHERE task = $1 AND key = $2`, [task, key]);
  return r.rows[0]?.value ?? null;
}

export async function requireConfig<T>(db: Queryable, task: string, key: string): Promise<T> {
  const v = await getConfig<T>(db, task, key);
  if (v === null)
    throw new Error(
      `수집기 설정 없음: ingest.config (${task}, ${key}) — 이관 도구(pnpm -F @k-raildex/migrate-legacy migrate:config)로 넣는다`,
    );
  return v;
}

export async function setConfig(db: Queryable, task: string, key: string, value: unknown, note?: string | null) {
  await db.query(
    `INSERT INTO ingest.config (task, key, value, note) VALUES ($1, $2, $3, $4)
     ON CONFLICT (task, key) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note`,
    [task, key, JSON.stringify(value), note ?? null],
  );
}
