/**
 * 이관 CLI (WP 3.11). DATABASE_URL·LEGACY_ROOT 환경 변수.
 *   pnpm migrate:run [--reset] [--no-timetables]   빈 DB(또는 --reset)에 전량 적재
 *   pnpm migrate:verify                            역변환·대조 → docs/legacy/migration-report-<날짜>.md + .json
 *   pnpm migrate:check                             변환만 하고 계약(zod) 검사(DB 없음)
 *   pnpm migrate:config                            수집기 설정(ingest.config)만 기존 보정 파일에서 다시 넣는다(이미 이관한 DB 용)
 *   pnpm migrate:headers                           YAML 파일 머리 주석 → docs/legacy/own-file-headers.md(DB 없음, FR-MIG-005)
 */
import pg from 'pg';
import { checkContracts } from './check';
import { writeHeaders } from './headers';
import { legacyIngestConfig, writeIngestConfig } from './ingest-config';
import { loadLegacy } from './read/legacy';
import { resetDatabase, runLoad } from './load';
import { transformAll } from './transform';
import { runVerify } from './verify';
import { writeReport } from './report';

const [cmd, ...args] = process.argv.slice(2);
const log = (m: string) => console.log(m);

async function withDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL 이 필요합니다');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  if (cmd === 'check') {
    const tr = transformAll(loadLegacy(), { timetables: !args.includes('--no-timetables') });
    const issues = checkContracts(tr);
    console.log(JSON.stringify(tr.counts));
    for (const i of issues.slice(0, 50)) console.log(`${i.entity_type} ${i.id} ${i.path}: ${i.message}`);
    console.log(`계약 위반 ${issues.length}건`);
    if (issues.length) process.exitCode = 1;
    return;
  }
  if (cmd === 'run') {
    const legacy = loadLegacy();
    log(`기존 저장소: ${legacy.root}`);
    const tr = transformAll(legacy, { timetables: !args.includes('--no-timetables') });
    const issues = checkContracts(tr);
    if (issues.length) {
      for (const i of issues.slice(0, 50)) console.error(`${i.entity_type} ${i.id} ${i.path}: ${i.message}`);
      throw new Error(`계약 위반 ${issues.length}건 — 적재하지 않음`);
    }
    await withDb(async (db) => {
      if (args.includes('--reset')) await resetDatabase(db, log);
      const r = await runLoad(db, legacy, tr, { log, timetables: !args.includes('--no-timetables') });
      log(`완료 ${(r.totalMs / 1000).toFixed(1)}s — ${JSON.stringify(tr.counts)}`);
    });
    return;
  }
  if (cmd === 'headers') {
    const legacy = loadLegacy();
    const path = writeHeaders(legacy.headers);
    log(`파일 머리 주석 ${legacy.headers.size}개 → ${path}`);
    return;
  }
  if (cmd === 'config') {
    const legacy = loadLegacy();
    const rows = legacyIngestConfig(legacy.root);
    await withDb((db) => writeIngestConfig(db, rows));
    for (const r of rows) log(`ingest.config (${r.task}, ${r.key}) 갱신`);
    return;
  }
  if (cmd === 'verify') {
    const legacy = loadLegacy();
    await withDb(async (db) => {
      const tr = transformAll(legacy);
      const result = await runVerify(db, legacy, tr);
      const paths = writeReport(result);
      log(`리포트: ${paths.md}`);
      log(result.summaryLine);
      if (!result.ok) process.exitCode = 1;
    });
    return;
  }
  console.error('사용법: cli.ts run [--reset] [--no-timetables] | verify | check | config | headers');
  process.exitCode = 2;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
