/**
 * PostGIS 컨테이너를 한 번 띄우고 템플릿 DB(raildex_template)에 마이그레이션·시드를 적용한다.
 * 각 시험 파일은 test/db.ts 의 freshDb() 로 템플릿을 복제한 새 DB 를 쓴다.
 * TEST_DATABASE_URL 이 있으면 컨테이너 대신 그 서버를 쓴다(템플릿을 그 서버에 만든다).
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { migrate } from '../src/migrate';
import { seedReference } from '../src/seed';

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(project: TestProject) {
  let adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) {
    container = await new PostgreSqlContainer('postgis/postgis:17-3.5').start();
    adminUrl = container.getConnectionUri();
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS raildex_template WITH (FORCE)');
  await admin.query('CREATE DATABASE raildex_template');
  await admin.end();

  const tplUrl = withDb(adminUrl, 'raildex_template');
  const tpl = new pg.Client({ connectionString: tplUrl });
  await tpl.connect();
  await migrate(tpl);
  await seedReference(tpl);
  await tpl.end();

  project.provide('adminDbUrl', adminUrl);
  return async () => {
    await container?.stop();
  };
}

export function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

declare module 'vitest' {
  export interface ProvidedContext {
    adminDbUrl: string;
  }
}
