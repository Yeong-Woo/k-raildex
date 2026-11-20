import pg from 'pg';
import { inject } from 'vitest';
import { randomBytes } from 'node:crypto';

/** 템플릿을 복제한 새 DB 에 연결된 클라이언트. 끝나면 close() */
export async function freshDb(): Promise<{ client: pg.Client; close: () => Promise<void> }> {
  const adminUrl = inject('adminDbUrl');
  const name = `t_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} TEMPLATE raildex_template`);
  await admin.end();
  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: u.toString() });
  await client.connect();
  return {
    client,
    close: async () => {
      await client.end();
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
