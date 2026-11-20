/**
 * 통합 시험 공용 도구(다른 패키지의 vitest 에서도 쓴다).
 * - setupTestDatabase: vitest globalSetup. PostGIS 컨테이너(또는 TEST_DATABASE_URL)에 템플릿 DB 를 만들고 마이그레이션·시드 적용
 * - freshDb: 템플릿을 복제한 새 DB 에 연결된 클라이언트
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import type { TestProject } from 'vitest/node';
import { migrate } from './migrate';
import { seedReference } from './seed';

const TEMPLATE = 'raildex_template';

export function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

export async function setupTestDatabase(project: TestProject): Promise<() => Promise<void>> {
  let adminUrl = process.env.TEST_DATABASE_URL;
  let stop: (() => Promise<unknown>) | undefined;
  if (!adminUrl) {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const container = await new PostgreSqlContainer('postgis/postgis:17-3.5').start();
    adminUrl = container.getConnectionUri();
    stop = () => container.stop();
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEMPLATE}`);
  await admin.end();

  const tpl = new pg.Client({ connectionString: withDb(adminUrl, TEMPLATE) });
  await tpl.connect();
  await migrate(tpl);
  await seedReference(tpl);
  await tpl.end();

  project.provide('adminDbUrl', adminUrl);
  return async () => {
    await stop?.();
  };
}

export interface FreshDb {
  client: pg.Client;
  url: string;
  close: () => Promise<void>;
}

/** 템플릿을 복제한 새 DB. 끝나면 close() */
export async function freshDb(): Promise<FreshDb> {
  const adminUrl = inject('adminDbUrl');
  const name = `t_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE}`);
  await admin.end();
  const url = withDb(adminUrl, name);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return {
    client,
    url,
    close: async () => {
      await client.end();
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    adminDbUrl: string;
  }
}
