/** worker 진입점. 환경 변수: DATABASE_URL, S3_ENDPOINT·S3_REGION·S3_BUCKET·S3_ACCESS_KEY·S3_SECRET_KEY(.env.example) */
import { UnconfiguredObjectStore, type ObjectStore } from '@k-raildex/domain';
import { S3ObjectStore } from './s3-store';
import { startWorker } from './worker';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL 이 필요함');
  const e = process.env;
  let store: ObjectStore;
  if (e.S3_ENDPOINT && e.S3_ACCESS_KEY && e.S3_SECRET_KEY) {
    store = new S3ObjectStore({
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION ?? 'us-east-1',
      bucket: e.S3_BUCKET ?? 'raildex-docs',
      accessKeyId: e.S3_ACCESS_KEY,
      secretAccessKey: e.S3_SECRET_KEY,
    });
  } else {
    console.warn('[worker] S3 설정 없음 — 문서 작업은 실패한다');
    store = new UnconfiguredObjectStore();
  }
  const w = await startWorker({ databaseUrl, store });
  console.log('[worker] 시작');
  let closing = false;
  const shutdown = async (sig: string) => {
    if (closing) return;
    closing = true;
    console.log(`[worker] ${sig} — 종료`);
    await w.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
