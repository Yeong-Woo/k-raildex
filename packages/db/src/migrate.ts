/**
 * SQL 마이그레이션 러너. packages/db/sql/*.sql 을 이름 순으로 각각 한 트랜잭션에서 적용한다.
 * 적용 기록은 schema_migration(name, sha256). 이미 적용된 파일의 내용이 바뀌면 오류(새 파일로 고칠 것).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Client, Pool, PoolClient } from 'pg';

export const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql');

export interface MigrationFile {
  name: string;
  sql: string;
  sha256: string;
}

export function listMigrations(dir = SQL_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name), 'utf8');
      return { name, sql, sha256: createHash('sha256').update(sql).digest('hex') };
    });
}

type Queryable = Pick<Client | PoolClient, 'query'>;

export async function migrate(db: Queryable | Pool, opts: { log?: (msg: string) => void } = {}): Promise<string[]> {
  const log = opts.log ?? (() => {});
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migration (
    name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await db.query<{ name: string; sha256: string }>('SELECT name, sha256 FROM schema_migration');
  const applied = new Map(rows.map((r) => [r.name, r.sha256]));
  const done: string[] = [];
  for (const m of listMigrations()) {
    const prev = applied.get(m.name);
    if (prev) {
      if (prev !== m.sha256) throw new Error(`이미 적용된 마이그레이션 ${m.name} 의 내용이 바뀜 — 새 파일로 고칠 것`);
      continue;
    }
    log(`apply ${m.name}`);
    await db.query('BEGIN');
    try {
      await db.query(m.sql);
      await db.query('INSERT INTO schema_migration (name, sha256) VALUES ($1, $2)', [m.name, m.sha256]);
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw new Error(`${m.name}: ${(e as Error).message}`, { cause: e });
    }
    done.push(m.name);
  }
  return done;
}
