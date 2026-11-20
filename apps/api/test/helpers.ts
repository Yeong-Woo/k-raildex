import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { freshDb, type FreshDb } from '@k-raildex/db/testing';
import { applyChangeset, ensureServiceUser, fixtureOps, MemoryObjectStore } from '@k-raildex/domain';
import type { JWTVerifyGetKey } from 'jose';
import pg from 'pg';
import type { AppModuleOptions } from '../src/app.module';
import { createApp } from '../src/app';
import { envSchema, type AppConfig } from '../src/config';
import { RecordingJobQueue } from '../src/jobs/job-queue';

export interface TestApp {
  app: NestFastifyApplication;
  fx: FreshDb;
  pool: pg.Pool;
  store: MemoryObjectStore;
  jobs: RecordingJobQueue;
  close: () => Promise<void>;
}

export function testConfig(url: string, env: Record<string, string> = {}): AppConfig {
  return envSchema.parse({
    DATABASE_URL: url,
    NODE_ENV: 'test',
    AUTH_DEV_BYPASS: '1',
    ADMIN_EMAIL: 'admin@example.com',
    ...env,
  });
}

/** 새 DB + 픽스처 + Nest 앱(Fastify inject 용) */
export async function startApp(
  opts: {
    env?: Record<string, string>;
    accessKeys?: JWTVerifyGetKey | null;
    fixtures?: boolean;
    external?: AppModuleOptions['external'];
  } = {},
): Promise<TestApp> {
  const fx = await freshDb();
  if (opts.fixtures !== false) {
    const author = await ensureServiceUser(fx.client, 'system', 'test');
    await applyChangeset(fx.client, {
      title: '픽스처',
      origin: 'legacy_migration',
      author_id: author,
      ops: fixtureOps(),
    });
  }
  const pool = new pg.Pool({ connectionString: fx.url, max: 4 });
  const store = new MemoryObjectStore();
  const jobs = new RecordingJobQueue();
  const app = await createApp(
    { config: testConfig(fx.url, opts.env), pool, accessKeys: opts.accessKeys, store, jobs, external: opts.external },
    { logger: false },
  );
  return {
    app,
    fx,
    pool,
    store,
    jobs,
    close: async () => {
      await app.close();
      await pool.end();
      await fx.close();
    },
  };
}
