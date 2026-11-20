/**
 * E2E 전역 준비(NFR-ADM-004):
 * 1) PostGIS — TEST_DATABASE_URL(관리자 접속 URL)이 있으면 그 서버에 새 DB, 없으면 Testcontainers 로 컨테이너를 띄운다
 * 2) 마이그레이션·참조 시드(@k-raildex/db cli) + 개발 픽스처(@k-raildex/domain fixtureOps → applyChangeset) + 지도 MV 갱신
 * 3) API(tsx src/main.ts, AUTH_DEV_BYPASS=1)와 Vite 개발 서버(ADMIN_API_PROXY)를 빈 포트에 띄운다
 * 결과 주소는 process.env.E2E_BASE_URL 로 작업자에게 넘긴다.
 *
 * 관리 앱은 서버 패키지에 의존하지 않으므로 pg·testcontainers 는 @k-raildex/db 의 의존성에서 불러오고,
 * 마이그레이션·픽스처는 각 패키지의 CLI 를 하위 프로세스로 돌린다.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const requireFromDb = createRequire(path.join(ROOT, 'packages/db/package.json'));

type PgClient = {
  connect(): Promise<void>;
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
};
const pg = requireFromDb('pg') as { Client: new (o: { connectionString: string }) => PgClient };

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      s.close(() => resolve(typeof a === 'object' && a ? a.port : 0));
    });
  });
}

async function waitFor(url: string, timeoutMs: number, proc: ChildProcess, name: string): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (proc.exitCode !== null) throw new Error(`${name} 가 종료됨(code ${proc.exitCode})`);
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* 아직 */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${name} 준비 시간 초과: ${url}`);
}

function startProcess(name: string, args: string[], env: Record<string, string>): ChildProcess {
  const p = spawn('pnpm', args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    detached: true,
    stdio: process.env.E2E_VERBOSE ? 'inherit' : ['ignore', 'ignore', 'pipe'],
  });
  let err = '';
  p.stderr?.on('data', (d: Buffer) => {
    err = (err + d.toString()).slice(-4000);
  });
  p.on('exit', (code) => {
    if (code && code !== 0 && !stopping) console.error(`[e2e] ${name} 종료(code ${code})\n${err}`);
  });
  return p;
}

function kill(p: ChildProcess | undefined) {
  if (!p?.pid) return;
  try {
    process.kill(-p.pid, 'SIGTERM');
  } catch {
    /* 이미 끝남 */
  }
}

let stopping = false;

export default async function globalSetup(): Promise<() => Promise<void>> {
  // 1) DB
  let adminUrl = process.env.TEST_DATABASE_URL;
  let stopContainer: (() => Promise<unknown>) | undefined;
  if (!adminUrl) {
    const { PostgreSqlContainer } = requireFromDb('@testcontainers/postgresql') as {
      PostgreSqlContainer: new (image: string) => {
        start(): Promise<{ getConnectionUri(): string; stop(): Promise<unknown> }>;
      };
    };
    const c = await new PostgreSqlContainer('postgis/postgis:17-3.5').start();
    adminUrl = c.getConnectionUri();
    stopContainer = () => c.stop();
  }
  const dbName = `raildex_e2e_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const dbUrl = withDb(adminUrl, dbName);

  // 2) 마이그레이션·시드·픽스처
  const env = { ...process.env, DATABASE_URL: dbUrl };
  execFileSync('pnpm', ['-F', '@k-raildex/db', 'exec', 'tsx', 'src/cli.ts', 'migrate'], {
    cwd: ROOT,
    env,
    stdio: 'pipe',
  });
  execFileSync('pnpm', ['-F', '@k-raildex/domain', 'exec', 'tsx', 'src/cli-fixtures.ts'], {
    cwd: ROOT,
    env,
    stdio: 'pipe',
  });
  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();
  // 지도·검색 MV(운영에서는 worker 가 갱신)
  const mvs = await db.query(`SELECT schemaname, matviewname FROM pg_matviews`);
  for (const r of mvs.rows)
    await db.query(`REFRESH MATERIALIZED VIEW "${String(r.schemaname)}"."${String(r.matviewname)}"`);
  await db.end();

  // 3) API · Vite
  const apiPort = await freePort();
  const webPort = await freePort();
  const api = startProcess('api', ['-F', '@k-raildex/api', 'exec', 'tsx', 'src/main.ts'], {
    DATABASE_URL: dbUrl,
    PORT: String(apiPort),
    HOST: '127.0.0.1',
    AUTH_DEV_BYPASS: '1',
    NODE_ENV: 'development',
  });
  await waitFor(`http://127.0.0.1:${apiPort}/health`, 60_000, api, 'API');
  const web = startProcess('vite', ['-F', '@k-raildex/admin', 'exec', 'vite', '--clearScreen', 'false'], {
    ADMIN_API_PROXY: `http://127.0.0.1:${apiPort}`,
    ADMIN_PORT: String(webPort),
  });
  await waitFor(`http://127.0.0.1:${webPort}/`, 60_000, web, 'Vite');

  process.env.E2E_BASE_URL = `http://127.0.0.1:${webPort}`;
  process.env.E2E_API_URL = `http://127.0.0.1:${apiPort}`;

  return async () => {
    stopping = true;
    kill(web);
    kill(api);
    await new Promise((r) => setTimeout(r, 500));
    try {
      const a = new pg.Client({ connectionString: adminUrl! });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await a.end();
    } catch {
      /* 컨테이너째 지운다 */
    }
    await stopContainer?.();
  };
}
