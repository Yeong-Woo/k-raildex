/** pnpm db:migrate | db:reset — DATABASE_URL 필요 */
import pg from 'pg';
import { migrate } from './migrate';
import { seedReference } from './seed';

const cmd = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL 이 필요합니다(.env.example 참고)');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  if (cmd === 'reset') {
    if (process.env.NODE_ENV === 'production') throw new Error('운영 환경에서는 reset 금지');
    await client.query(
      'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS osm CASCADE; DROP SCHEMA IF EXISTS ingest CASCADE; CREATE SCHEMA public;',
    );
    console.log('스키마를 지웠습니다');
  }
  if (cmd === 'migrate' || cmd === 'reset') {
    const done = await migrate(client, { log: console.log });
    console.log(done.length ? `${done.length}개 적용` : '적용할 마이그레이션 없음');
    await seedReference(client);
    console.log('참조 시드 완료');
  } else {
    throw new Error(`알 수 없는 명령: ${cmd}`);
  }
} finally {
  await client.end();
}
