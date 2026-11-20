/** API 진입점. 127.0.0.1 에만 바인딩(docs/04-api.md FR-API-004) */
import pg from 'pg';
import { createApp } from './app';
import { loadConfig } from './config';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  const app = await createApp({ config, pool });
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onClose', async () => {
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
