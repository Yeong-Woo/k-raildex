/** 서비스 계정(system·agent·web) — 변경 묶음 작성자 */
import type { Code } from '@k-raildex/contracts';
import type { Queryable } from './db';

export async function ensureServiceUser(
  db: Queryable,
  kind: Exclude<Code<'appUserKind'>, 'admin'>,
  displayName: string,
): Promise<string> {
  const found = await db.query<{ id: string }>(
    `SELECT id FROM app_user WHERE kind = $1 AND display_name = $2 LIMIT 1`,
    [kind, displayName],
  );
  if (found.rows[0]) return found.rows[0].id;
  const r = await db.query<{ id: string }>(`INSERT INTO app_user (kind, display_name) VALUES ($1, $2) RETURNING id`, [
    kind,
    displayName,
  ]);
  return r.rows[0]!.id;
}

/** 관리자(Cloudflare Access 이메일). 없으면 만든다 */
export async function ensureAdmin(db: Queryable, email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO app_user (kind, email, display_name) VALUES ('admin', $1, $1)
     ON CONFLICT (email) DO UPDATE SET last_seen_at = now() RETURNING id`,
    [email],
  );
  return r.rows[0]!.id;
}
