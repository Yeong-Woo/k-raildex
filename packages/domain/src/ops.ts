/**
 * 운영 기능(docs/04-api.md 4-3절): 작업(pg-boss job + 수집기·에이전트 실행 기록 ingest.run) 조회, 운영 상태(대시보드 배너),
 * 전체 검증(validate-all), 설정(app_setting — 에이전트 월 예산).
 *
 * - pg-boss 12 는 스키마 `pgboss` 의 `job` 테이블(큐 이름으로 LIST 분할)에 작업을 두고, 끝난 작업도 보관 기간 동안 남긴다.
 *   worker·api 가 한 번도 뜨지 않았으면 스키마가 없다 — 그때는 빈 목록이다.
 * - app_setting 은 개체가 아니라 운영 설정이라 변경 묶음을 거치지 않는다(토큰과 같다).
 */
import { z } from 'zod';
import type { Queryable } from './db';
import { DomainError, type Violation } from './errors';
import { entityLabels } from './list';
import { qualitySummary } from './quality';
import { HARD_RULES, runHardRules } from './validation';

type AnyObject = Record<string, unknown>;

/** pg-boss 스키마 이름(PgBoss 기본값) */
export const PGBOSS_SCHEMA = 'pgboss';

export const JOB_STATES = ['created', 'retry', 'active', 'completed', 'cancelled', 'failed'] as const;
export type JobState = (typeof JOB_STATES)[number];
/** 아직 끝나지 않은 상태(관리 앱 자동 새로 고침 기준) */
export const PENDING_JOB_STATES: readonly JobState[] = ['created', 'retry', 'active'];

/** 작업 목록 한 줄. kind job = pg-boss 작업(id uuid), run = ingest.run 실행 기록(id `run-<번호>`) */
export interface OpsJob {
  id: string;
  kind: 'job' | 'run';
  name: string;
  state: JobState;
  data: unknown;
  output: unknown;
  error: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  retry_count: number | null;
  singleton_key: string | null;
  /** run 만: 실행 계기·비용·모델 */
  trigger?: string | null;
  cost_usd?: number | null;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  changeset_ids?: string[];
  /** 상세에서만 */
  log?: string | null;
}

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const num = (v: unknown): number | null => (v == null ? null : Number(v));

/** ingest.run status → 작업 상태 */
const RUN_STATE: Record<string, JobState> = {
  running: 'active',
  done: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};
const runStatusesOf = (states: readonly JobState[]) =>
  Object.entries(RUN_STATE)
    .filter(([, s]) => states.includes(s))
    .map(([k]) => k);

export async function pgBossInstalled(db: Queryable): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, [
    `${PGBOSS_SCHEMA}.job`,
  ]);
  return Boolean(rows[0]?.ok);
}

/** pg-boss output 의 오류 문구(실패 시 { message, stack } 또는 임의 값) */
function errorOf(state: string, output: unknown): string | null {
  if (state !== 'failed' && state !== 'retry') return null;
  if (output && typeof output === 'object' && 'message' in output) return String((output as AnyObject).message);
  if (output == null) return null;
  return typeof output === 'string' ? output : JSON.stringify(output);
}

const JOB_COLS = `id::text AS id, name, state::text AS state, data, output, created_on, started_on, completed_on,
  retry_count, singleton_key`;

function shapeJob(r: AnyObject): OpsJob {
  const state = String(r.state) as JobState;
  return {
    id: String(r.id),
    kind: 'job',
    name: String(r.name),
    state,
    data: r.data ?? null,
    output: r.output ?? null,
    error: errorOf(state, r.output),
    created_at: iso(r.created_on),
    started_at: iso(r.started_on),
    completed_at: iso(r.completed_on),
    retry_count: num(r.retry_count),
    singleton_key: (r.singleton_key as string | null) ?? null,
  };
}

const RUN_COLS = `id, task, trigger, status, started_at, finished_at, params, stats, model, input_tokens, output_tokens,
  cost_usd, error, changeset_ids`;

function shapeRun(r: AnyObject, withLog = false): OpsJob {
  const out: OpsJob = {
    id: `run-${String(r.id)}`,
    kind: 'run',
    name: String(r.task),
    state: RUN_STATE[String(r.status)] ?? 'failed',
    data: r.params ?? null,
    output: r.stats ?? null,
    error: (r.error as string | null) ?? null,
    created_at: iso(r.started_at),
    started_at: iso(r.started_at),
    completed_at: iso(r.finished_at),
    retry_count: null,
    singleton_key: null,
    trigger: (r.trigger as string | null) ?? null,
    cost_usd: num(r.cost_usd),
    model: (r.model as string | null) ?? null,
    input_tokens: num(r.input_tokens),
    output_tokens: num(r.output_tokens),
    changeset_ids: (r.changeset_ids as string[] | null) ?? [],
  };
  if (withLog) out.log = (r.log as string | null) ?? null;
  return out;
}

export const JobListQuerySchema = z.object({
  /** 쉼표로 여럿. `pending` = created·retry·active */
  state: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      const out = new Set<JobState>();
      for (const s of v.split(',').map((x) => x.trim())) {
        if (s === 'pending') PENDING_JOB_STATES.forEach((x) => out.add(x));
        else if ((JOB_STATES as readonly string[]).includes(s)) out.add(s as JobState);
        else {
          ctx.addIssue({ code: 'custom', message: `state: ${[...JOB_STATES, 'pending'].join('|')}` });
          return z.NEVER;
        }
      }
      return [...out];
    }),
  name: z.string().min(1).optional(),
  kind: z.enum(['job', 'run']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type JobListQuery = z.input<typeof JobListQuerySchema>;

/** 작업 + 실행 기록을 만든 시각 역순으로 합친 목록 */
export async function listJobs(
  db: Queryable,
  query: JobListQuery = {},
): Promise<{ items: OpsJob[]; total: number; limit: number; pgboss: boolean }> {
  const q = JobListQuerySchema.parse(query);
  const installed = await pgBossInstalled(db);
  const items: OpsJob[] = [];
  if (installed && q.kind !== 'run') {
    const params: unknown[] = [];
    const where: string[] = [];
    const p = (v: unknown) => `$${params.push(v)}`;
    if (q.state) where.push(`state::text = ANY(${p(q.state)})`);
    if (q.name) where.push(`name = ${p(q.name)}`);
    const { rows } = await db.query(
      `SELECT ${JOB_COLS} FROM ${PGBOSS_SCHEMA}.job ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY created_on DESC LIMIT ${p(q.limit)}`,
      params,
    );
    items.push(...rows.map((r) => shapeJob(r as AnyObject)));
  }
  if (q.kind !== 'job') {
    const params: unknown[] = [];
    const where: string[] = [];
    const p = (v: unknown) => `$${params.push(v)}`;
    if (q.state) where.push(`status = ANY(${p(runStatusesOf(q.state))})`);
    if (q.name) where.push(`task = ${p(q.name)}`);
    const { rows } = await db.query(
      `SELECT ${RUN_COLS} FROM ingest.run ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY started_at DESC NULLS LAST, id DESC LIMIT ${p(q.limit)}`,
      params,
    );
    items.push(...rows.map((r) => shapeRun(r as AnyObject)));
  }
  items.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  const out = items.slice(0, q.limit);
  return { items: out, total: out.length, limit: q.limit, pgboss: installed };
}

/** 작업 하나: uuid = pg-boss 작업, `run-<번호>` = 실행 기록(log 포함) */
export async function getJob(db: Queryable, id: string): Promise<OpsJob> {
  const run = /^run-(\d+)$/.exec(id);
  if (run) {
    const { rows } = await db.query(`SELECT ${RUN_COLS}, log FROM ingest.run WHERE id = $1`, [run[1]]);
    if (rows[0]) return shapeRun(rows[0] as AnyObject, true);
  } else if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) &&
    (await pgBossInstalled(db))
  ) {
    const { rows } = await db.query(`SELECT ${JOB_COLS} FROM ${PGBOSS_SCHEMA}.job WHERE id = $1::uuid`, [id]);
    if (rows[0]) return shapeJob(rows[0] as AnyObject);
  }
  throw new DomainError('not_found', `작업 ${id} 가 없음`);
}

// ---------------------------------------------------------------------------
// 운영 상태(대시보드 배너, Q64 C)
// ---------------------------------------------------------------------------

export interface OpsStatus {
  failed_jobs_24h: number;
  failed_runs_24h: number;
  /** app_setting `backup.last` 의 at(백업 작업이 기록). 아직 없으면 null */
  last_backup_at: string | null;
  /** 대기 중(created·retry) pg-boss 작업 수 */
  queue_depth: number;
  /** 실행 중 작업·실행 기록 수 */
  active: number;
  /** 최근 24시간 실패 최대 5건(배너 문구) */
  recent_failures: { id: string; kind: 'job' | 'run'; name: string; error: string | null; at: string | null }[];
}

export async function opsStatus(db: Queryable): Promise<OpsStatus> {
  const installed = await pgBossInstalled(db);
  let failedJobs = 0;
  let depth = 0;
  let active = 0;
  const failures: OpsStatus['recent_failures'] = [];
  if (installed) {
    const { rows } = await db.query<{ failed: number; depth: number; active: number }>(
      `SELECT count(*) FILTER (WHERE state = 'failed' AND coalesce(completed_on, created_on) > now() - interval '24 hours')::int AS failed,
              count(*) FILTER (WHERE state IN ('created', 'retry'))::int AS depth,
              count(*) FILTER (WHERE state = 'active')::int AS active
         FROM ${PGBOSS_SCHEMA}.job`,
    );
    failedJobs = rows[0]?.failed ?? 0;
    depth = rows[0]?.depth ?? 0;
    active = rows[0]?.active ?? 0;
    const f = await db.query(
      `SELECT ${JOB_COLS} FROM ${PGBOSS_SCHEMA}.job
        WHERE state = 'failed' AND coalesce(completed_on, created_on) > now() - interval '24 hours'
        ORDER BY coalesce(completed_on, created_on) DESC LIMIT 5`,
    );
    for (const r of f.rows) {
      const j = shapeJob(r as AnyObject);
      failures.push({ id: j.id, kind: 'job', name: j.name, error: j.error, at: j.completed_at ?? j.created_at });
    }
  }
  const runs = await db.query<{ failed: number; active: number }>(
    `SELECT count(*) FILTER (WHERE status = 'failed' AND coalesce(finished_at, started_at) > now() - interval '24 hours')::int AS failed,
            count(*) FILTER (WHERE status = 'running')::int AS active
       FROM ingest.run`,
  );
  const fr = await db.query(
    `SELECT ${RUN_COLS} FROM ingest.run
      WHERE status = 'failed' AND coalesce(finished_at, started_at) > now() - interval '24 hours'
      ORDER BY coalesce(finished_at, started_at) DESC LIMIT 5`,
  );
  for (const r of fr.rows) {
    const j = shapeRun(r as AnyObject);
    failures.push({ id: j.id, kind: 'run', name: j.name, error: j.error, at: j.completed_at ?? j.started_at });
  }
  failures.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  const backup = await getSetting<{ at?: string }>(db, 'backup.last');
  return {
    failed_jobs_24h: failedJobs,
    failed_runs_24h: runs.rows[0]?.failed ?? 0,
    last_backup_at: typeof backup?.value.at === 'string' ? backup.value.at : null,
    queue_depth: depth,
    active: active + (runs.rows[0]?.active ?? 0),
    recent_failures: failures.slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// 설정(app_setting)
// ---------------------------------------------------------------------------

export async function getSetting<T = unknown>(
  db: Queryable,
  key: string,
): Promise<{ value: T; updated_at: string } | null> {
  const { rows } = await db.query<{ value: T; updated_at: Date }>(
    `SELECT value, updated_at FROM app_setting WHERE key = $1`,
    [key],
  );
  return rows[0] ? { value: rows[0].value, updated_at: iso(rows[0].updated_at)! } : null;
}

export async function putSetting(db: Queryable, key: string, value: unknown): Promise<void> {
  await db.query(
    `INSERT INTO app_setting (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

export const AgentBudgetSchema = z.object({ monthly_usd: z.number().min(0).max(10_000) }).strict();
export type AgentBudget = z.infer<typeof AgentBudgetSchema>;

/** 알려진 설정(관리 앱 설정 화면). editable = PUT 경로가 있는 것 */
export const KNOWN_SETTINGS = [
  {
    key: 'agent.budget',
    description: '에이전트(LLM) 월 예산(USD). 실행 전 이번 달 누적 비용이 넘으면 거부(FR-AGT-006)',
    default: { monthly_usd: 30 } satisfies AgentBudget,
    editable: true,
  },
  {
    key: 'validation.last',
    description: '마지막 전체 검증(validate-all) 결과',
    default: null,
    editable: false,
  },
  {
    key: 'backup.last',
    description: '마지막 백업 시각 { at } — 백업 작업이 기록',
    default: null,
    editable: false,
  },
] as const;

export async function listSettings(db: Queryable) {
  const { rows } = await db.query<{ key: string; value: unknown; updated_at: Date }>(
    `SELECT key, value, updated_at FROM app_setting WHERE key = ANY($1)`,
    [KNOWN_SETTINGS.map((s) => s.key)],
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return {
    items: KNOWN_SETTINGS.map((s) => {
      const r = byKey.get(s.key);
      // 검증 결과는 커서 목록에서는 요약만
      let value: unknown = r ? r.value : s.default;
      if (s.key === 'validation.last' && value && typeof value === 'object') {
        const v = value as ValidationResult;
        value = { at: v.at, hard_count: v.hard_count, soft_total: v.soft_total };
      }
      return {
        key: s.key,
        description: s.description,
        value,
        default: s.default,
        is_default: !r,
        editable: s.editable,
        updated_at: r ? iso(r.updated_at) : null,
      };
    }),
  };
}

/** 이번 달(Asia/Seoul 기준) 첫날 0시 */
const MONTH_START = `(date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`;

export interface AgentBudgetStatus {
  monthly_usd: number;
  is_default: boolean;
  updated_at: string | null;
  /** YYYY-MM(Asia/Seoul) */
  month: string;
  /** 이번 달 ingest.run(task 'agent:%') cost_usd 합 */
  spent_usd: number;
  runs: number;
  remaining_usd: number;
  exceeded: boolean;
}

export async function getAgentBudget(db: Queryable): Promise<AgentBudgetStatus> {
  const s = await getSetting<Partial<AgentBudget>>(db, 'agent.budget');
  const parsed = AgentBudgetSchema.safeParse(s?.value);
  const monthly = parsed.success ? parsed.data.monthly_usd : KNOWN_SETTINGS[0].default.monthly_usd;
  const { rows } = await db.query<{ spent: string | null; runs: number; month: string }>(
    `SELECT sum(cost_usd)::text AS spent, count(*)::int AS runs,
            to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') AS month
       FROM ingest.run WHERE task LIKE 'agent:%' AND started_at >= ${MONTH_START}`,
  );
  const spent = Number(rows[0]?.spent ?? 0);
  return {
    monthly_usd: monthly,
    is_default: !parsed.success,
    updated_at: s?.updated_at ?? null,
    month: rows[0]!.month,
    spent_usd: spent,
    runs: rows[0]?.runs ?? 0,
    remaining_usd: Math.max(0, Number((monthly - spent).toFixed(4))),
    exceeded: spent >= monthly,
  };
}

export async function setAgentBudget(db: Queryable, input: unknown): Promise<AgentBudgetStatus> {
  const r = AgentBudgetSchema.safeParse(input);
  if (!r.success)
    throw new DomainError('validation', '예산 형식 오류', {
      violations: r.error.issues.map((i) => ({ rule: 'schema', path: i.path.join('.'), message: i.message })),
    });
  await putSetting(db, 'agent.budget', r.data);
  return getAgentBudget(db);
}

// ---------------------------------------------------------------------------
// 전체 검증(validate-all)
// ---------------------------------------------------------------------------

/** 저장하는 Hard 위반 최대 건수(전체 건수는 hard_count) */
export const VALIDATION_HARD_LIMIT = 1000;

export interface ValidationHardItem extends Violation {
  entity_type: string | null;
  label: string;
}

export interface ValidationResult {
  at: string;
  ms: number;
  entity_count: number;
  rules: string[];
  hard_count: number;
  hard: ValidationHardItem[];
  hard_truncated: boolean;
  soft_counts: { id: string; title: string; count: number; note?: string }[];
  soft_total: number;
}

/**
 * 모든 활성 개체 id 로 Hard 규칙(적용기와 같은 SQL)을 돌리고 Soft 규칙 건수를 센다. 결과는 app_setting `validation.last`.
 * Hard 규칙 SQL 은 `= ANY($1)` 이라 id 배열을 한 번에 넘긴다(PostgreSQL 이 큰 배열은 해시로 비교한다).
 */
export async function validateAll(db: Queryable, opts: { store?: boolean } = {}): Promise<ValidationResult> {
  const t = Date.now();
  const ids = await db.query<{ ids: string[] | null }>(
    `SELECT array_agg(id ORDER BY id) AS ids FROM entity WHERE deleted_at IS NULL`,
  );
  const all = ids.rows[0]?.ids ?? [];
  const violations = await runHardRules(db, all);
  const shown = violations.slice(0, VALIDATION_HARD_LIMIT);
  const labels = await entityLabels(
    db,
    shown.map((v) => v.entity_id).filter((x): x is string => !!x),
  );
  const soft = await qualitySummary(db);
  const result: ValidationResult = {
    at: new Date().toISOString(),
    ms: 0,
    entity_count: all.length,
    rules: HARD_RULES.map((r) => r.id),
    hard_count: violations.length,
    hard: shown.map((v) => {
      const l = v.entity_id ? labels.get(v.entity_id) : undefined;
      return { ...v, entity_type: l?.type ?? null, label: l?.label ?? v.entity_id ?? '' };
    }),
    hard_truncated: violations.length > shown.length,
    soft_counts: soft.rules,
    soft_total: soft.rules.reduce((s, r) => s + r.count, 0),
  };
  result.ms = Date.now() - t;
  if (opts.store ?? true) await putSetting(db, 'validation.last', result);
  return result;
}

export async function lastValidation(db: Queryable): Promise<ValidationResult | null> {
  return (await getSetting<ValidationResult>(db, 'validation.last'))?.value ?? null;
}

// ---------------------------------------------------------------------------
// 수집기 과제 목록(관리 앱 실행 양식)
// ---------------------------------------------------------------------------

/**
 * 관리 앱에서 `importer.run` 으로 보낼 수 있는 과제. api 는 @k-raildex/importers 에 의존하지 않아(잠금 파일 변경 회피)
 * 여기 정적 목록으로 둔다. worker 시험이 importers 의 IMPORTER_TASKS 가 모두 여기 있는지 확인한다.
 * 목록에 있어도 worker 에 아직 없는 과제는 작업이 실패(ingest.run 없이 pg-boss failed)로 끝난다.
 */
export const IMPORTER_TASK_LIST: readonly { task: string; label: string; description: string }[] = [
  {
    task: 'tago-timetable',
    label: 'TAGO 지하철 시간표',
    description: '국토교통부 TAGO 지하철 시간표 → 시간표 세트 교체(수도권 기본)',
  },
  {
    task: 'kric-train-ops',
    label: '레일포털 열차 운행정보',
    description: 'KRIC 운행정보(노선번호별) → 운행정보 보강 세트 교체',
  },
  {
    task: 'osm-rail',
    label: 'OSM 철도 선형',
    description: 'OpenStreetMap 철도 선형·역 → osm 스키마(ODbL). worker 에 과제가 등록돼 있어야 실행된다',
  },
];
