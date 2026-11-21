/**
 * 수집기 CLI. DATABASE_URL 환경 변수.
 *   pnpm -F @k-raildex/importers run tago-timetable [--from-raw <dir>] [--dry-run] [--ids MTRS14409,…] [--area capital|all] [--limit N] [--max-calls N]
 *   pnpm -F @k-raildex/importers run kric-train-ops (--from-raw <json.gz dir> | --from-xlsx <xlsx|dir> [--download]) [--dry-run] [--line-nos S1102,…]
 *   pnpm -F @k-raildex/importers run osm-rail [--from-raw <dir>(기본 LEGACY_ROOT/data/osm)] [--live [--endpoint <overpass>]] [--dry-run]
 * 실행 기록은 ingest.run(dry-run 은 기록하지 않음), 리포트(마크다운)는 표준 출력과 ingest.run.log.
 */
import pg from 'pg';
import { IMPORTER_TASKS, runImporter, type ImporterOptions } from './tasks';

function parseArgs(argv: string[]): { task: string | undefined; options: ImporterOptions; quiet: boolean } {
  const [task, ...rest] = argv;
  const opt: ImporterOptions = {};
  let quiet = false;
  const val = (i: number) => {
    const v = rest[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${rest[i]} 값이 없음`);
    return v;
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    switch (a) {
      case '--from-raw':
        opt.fromRaw = val(i++);
        break;
      case '--from-xlsx':
        opt.fromXlsx = val(i++);
        break;
      case '--download':
        opt.download = true;
        break;
      case '--dry-run':
        opt.dryRun = true;
        break;
      case '--ids':
        opt.tagoIds = val(i++).split(',').filter(Boolean);
        break;
      case '--line-nos':
        opt.lineNos = val(i++).split(',').filter(Boolean);
        break;
      case '--area':
        opt.area = val(i++) as ImporterOptions['area'];
        break;
      case '--limit':
        opt.limit = Number(val(i++));
        break;
      case '--max-calls':
        opt.maxCalls = Number(val(i++));
        break;
      case '--live':
        opt.live = true;
        break;
      case '--endpoint':
        opt.endpoint = val(i++);
        break;
      case '--quiet':
        quiet = true;
        break;
      case '--':
        break;
      default:
        throw new Error(`알 수 없는 인자: ${a}`);
    }
  }
  return { task, options: opt, quiet };
}

async function main(): Promise<void> {
  const { task, options, quiet } = parseArgs(process.argv.slice(2));
  if (!task || !(IMPORTER_TASKS as readonly string[]).includes(task)) {
    console.error(`사용법: cli.ts <${IMPORTER_TASKS.join('|')}> [--from-raw <dir>] [--dry-run] …`);
    process.exitCode = 2;
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL 이 필요합니다');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const r = await runImporter(client, task, { trigger: 'manual', ...options }, (m) => console.log(m));
    if (!quiet) console.log(r.log.join('\n'));
    console.log(
      `run ${r.runId ?? '(dry-run, 기록 없음)'}: ${JSON.stringify({ ...r.stats, jobs: undefined, issue_samples: undefined })}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
