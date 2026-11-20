/** 외부 API 초기 카탈로그 적재(FR-ADM-106): DATABASE_URL 의 DB 에 seedApiCatalog 를 돌린다(id 기준 upsert) */
import pg from 'pg';
import { seedApiCatalog } from './external-catalog';
import { ensureServiceUser } from './users';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL 이 필요합니다');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const author = await ensureServiceUser(client, 'system', 'api-catalog');
  const r = await seedApiCatalog(client, author);
  console.log(
    `외부 API 카탈로그: 새로 ${r.created.length} · 갱신 ${r.updated.length} · 건너뜀(삭제됨) ${r.skipped.length}`,
  );
} finally {
  await client.end();
}
