/** API 진입점. 127.0.0.1 에만 바인딩(docs/04-api.md FR-API-004) */
import pg from 'pg';
import { createApp } from './app';
import { loadConfig } from './config';
import { PgBossJobQueue } from './jobs/job-queue';
import { S3ObjectStore } from './storage/s3-store';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  const store = config.s3 ? new S3ObjectStore(config.s3) : undefined;
  if (!store) console.warn('S3_ENDPOINT·S3_ACCESS_KEY·S3_SECRET_KEY 가 없음 — 문서 기능은 503');
  const jobs = new PgBossJobQueue(config.databaseUrl);
  const app = await createApp({ config, pool, store, jobs });
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onClose', async () => {
      await jobs.stop();
      await pool.end();
    });
  await app.listen({ port: config.port, host: config.host });
  if (config.devBypass) console.warn('AUTH_DEV_BYPASS=1 — Access 검증 없이 관리자로 처리(개발 전용)');
  console.log(`K-Raildex API: http://${config.host}:${config.port}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
