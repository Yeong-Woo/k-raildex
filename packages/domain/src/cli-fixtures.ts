/** 개발용 픽스처 적재: DATABASE_URL 의 (마이그레이션된) DB 에 fixtureOps() 를 적용기로 넣는다 */
import pg from 'pg';
import { applyChangeset } from './applier';
import { fixtureOps } from './fixtures';
import { ensureServiceUser } from './users';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL 이 필요합니다');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('운영 환경에서는 픽스처를 넣지 않습니다');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const author = await ensureServiceUser(client, 'system', 'fixtures');
  const r = await applyChangeset(client, {
    title: '개발용 픽스처',
    origin: 'legacy_migration',
    author_id: author,
    ops: fixtureOps(),
  });
  console.log(`픽스처 ${r.results.length}개 op 적용 (${r.changeset_id})`);
} finally {
  await client.end();
}
