/**
 * 외부 API 탐색기(FR-ADM-100~106, docs/04-api.md 4-2-1절, docs/03-data-model.md 4-19-1절).
 *
 * - 카탈로그 ingest.api_endpoint 는 개체가 아닌 설정 테이블이라 변경 묶음 없이 직접 SQL 로 쓴다(META 열은 채운다).
 * - 등록된 엔드포인트만 호출한다(자유 URL 금지). 호출 허용 호스트 = base_url 의 호스트(포트 포함). 다른 호스트로 가는 리다이렉트는 막는다.
 * - 키는 서버가 환경 변수(key_env → 제공처 공통 변수 순)에서 붙이고, 저장·응답하는 원문·URL 에서는 가린다(***).
 *   key_env 는 외부 API 키 변수 이름 규칙(KEY_ENV_PATTERN)만 허용한다 — DB 비밀번호 같은 다른 변수를 실어 보내지 못하게.
 * - 결과는 DB 개체를 바꾸지 않는다. 남기려면 스냅샷 문서(document kind snapshot)로.
 * - 호출마다 ingest.api_call 1행(키 뺀 매개변수·상태·시간·결과 코드·원문(가린 뒤)·sha256). 본문은 7일 뒤 지운다(스냅샷은 문서로 영구).
 * - XML 해석기는 앱이 넘긴다(api: fast-xml-parser) — 도메인 패키지에 파서 의존성을 두지 않는다.
 */
import { codes, type Code } from '@k-raildex/contracts';
import { z } from 'zod';
import type { Queryable } from './db';
import { documentKey, getDocument, safeFilename, sha256Hex, type DocumentRow } from './documents';
import { DomainError } from './errors';
import { entityLabels } from './list';
import type { ObjectStore } from './storage';

type AnyObject = Record<string, unknown>;

// ---------------------------------------------------------------------------
// 상수·규칙
// ---------------------------------------------------------------------------

export const API_PROVIDERS = ['data_go_kr', 'kric', 'tago', 'vworld', 'seoul_open', 'law_go_kr', 'other'] as const;
export type ApiProvider = (typeof API_PROVIDERS)[number];

export const API_PROVIDER_LABELS: Readonly<Record<ApiProvider, string>> = {
  data_go_kr: '공공데이터포털',
  kric: '레일포털(KRIC)',
  tago: 'TAGO(국토교통부)',
  vworld: 'VWorld',
  seoul_open: '서울 열린데이터광장',
  law_go_kr: '법제처(국가법령정보센터)',
  other: '기타',
};

/** 제공처 공통 키 변수(.env.example: 서비스별 변수 → 공통 변수 순서로 조회) */
export const PROVIDER_COMMON_KEY_ENV: Readonly<Record<ApiProvider, string | null>> = {
  data_go_kr: 'DATA_GO_KR_KEY',
  tago: 'DATA_GO_KR_KEY',
  kric: 'KRIC_KEY',
  vworld: 'VWORLD_API_KEY',
  seoul_open: 'SEOUL_OPEN_KEY',
  law_go_kr: 'LAW_GO_KR_OC',
  other: null,
};

/** 키 변수 이름으로 쓸 수 있는 것: 외부 API 키 변수와 그 서비스별 변형만 */
export const KEY_ENV_PATTERN = /^(DATA_GO_KR_KEY|KRIC_KEY|VWORLD_API_KEY|SEOUL_OPEN_KEY|LAW_GO_KR_OC)(_[A-Z0-9]+)*$/;

export const CALL_TIMEOUT_MS = 30_000;
export const CALL_MAX_BYTES = 20 * 1024 * 1024;
export const ALL_PAGES_DEFAULT_CAP = 20;
export const ALL_PAGES_MAX_CAP = 100;
/** 응답 본문 보관 일수(스냅샷은 문서로 영구) */
export const CALL_BODY_RETENTION_DAYS = 7;
/** API 응답에 싣는 원문 최대 글자 수(저장은 전부) */
const RAW_RESPONSE_LIMIT = 2_000_000;
const ROWS_RESPONSE_LIMIT = 10_000;

/** 공공데이터포털 resultCode·returnReasonCode 의미 */
export const DATA_GO_KR_CODES: Readonly<Record<string, string>> = {
  '00': '정상',
  '01': '어플리케이션 오류',
  '02': 'DB 오류',
  '03': '데이터 없음',
  '04': 'HTTP 오류',
  '05': '서비스 연결 실패(시간 초과)',
  '10': '잘못된 요청 매개변수',
  '11': '필수 요청 매개변수 없음',
  '12': '해당 오픈 API 서비스가 없거나 폐기됨(미승인 키로 호출해도 나옴)',
  '20': '서비스 접근 거부(활용 신청 미승인)',
  '21': '일시적으로 사용할 수 없는 서비스 키',
  '22': '서비스 요청 제한 횟수 초과(일일 한도)',
  '30': '등록되지 않은 서비스 키',
  '31': '기한 만료된 서비스 키',
  '32': '등록되지 않은 IP',
  '33': '서명되지 않은 호출',
  '99': '기타 오류',
};

/** 레일포털(KRIC) resultCode — 기존 수집기(fetch-kric-station-info.ts)에서 관찰한 값 */
export const KRIC_CODES: Readonly<Record<string, string>> = {
  '00': '정상',
  '03': '데이터 없음',
  '30': '등록되지 않은 키',
  '41': '승인 대기 중',
};

/** 성공으로 보는 결과 코드(데이터 없음 포함) */
const OK_CODES = ['00', '03', 'OK', 'NOT_FOUND', 'INFO-000', 'INFO-200'];

// ---------------------------------------------------------------------------
// 카탈로그 형식
// ---------------------------------------------------------------------------

export const apiParamDefSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.]*$/, { message: '매개변수 이름 형식 오류' }),
    label: z.string().optional(),
    description: z.string().optional(),
    required: z.boolean().default(false),
    default: z.string().optional(),
    example: z.string().optional(),
    kind: z.enum(['text', 'int', 'date', 'enum', 'station_ref']).default('text'),
    /** station_ref: 역 선택기로 채울 외부 코드 체계(ref_external_system.code) */
    ref_system: z.string().optional(),
    /** enum: 허용 값 */
    options: z.array(z.string()).optional(),
    /** 항상 default 값으로 보낸다(형식 지정 등) */
    fixed: z.boolean().optional(),
  })
  .strict();
export type ApiParamDef = z.infer<typeof apiParamDefSchema>;

export const apiPagingSchema = z
  .object({
    /** 쪽 번호 방식 */
    page_param: z.string().optional(),
    size_param: z.string().optional(),
    /** 범위 방식(서울 열린데이터: 시작·끝 행 번호, 1부터) */
    start_param: z.string().optional(),
    end_param: z.string().optional(),
    /** 전체 건수 경로(점 표기). 없으면 totalCount·list_total_count·total 을 찾는다 */
    total_path: z.string().optional(),
  })
  .strict();
export type ApiPaging = z.infer<typeof apiPagingSchema>;

/** DB 비교(FR-ADM-103) 설정: 응답 행의 코드·이름·좌표 필드(점 표기) */
export const apiCompareSchema = z
  .object({
    code_field: z.string().min(1),
    name_field: z.string().optional(),
    lat_field: z.string().optional(),
    lng_field: z.string().optional(),
  })
  .strict();
export type ApiCompare = z.infer<typeof apiCompareSchema>;

const endpointShape = {
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: '소문자·숫자·하이픈' }),
  provider: z.enum(API_PROVIDERS),
  name_ko: z.string().min(1),
  method: z.enum(['GET', 'POST']).default('GET'),
  base_url: z
    .string()
    .regex(/^https?:\/\/[^/@\s]+(\/\S*)?$/, { message: 'http(s) URL(사용자 정보 없이)' })
    .refine((u) => URL.canParse(u.replace(/\{[A-Za-z0-9_]+\}/g, 'x')), { message: 'URL 형식 오류' }),
  params: z.array(apiParamDefSchema).default([]),
  key_param: z.string().min(1).nullable().default(null),
  key_env: z
    .string()
    .regex(KEY_ENV_PATTERN, { message: '외부 API 키 변수 이름만(.env.example)' })
    .nullable()
    .default(null),
  response_format: z.enum(['xml', 'json']),
  rows_path: z.string().min(1).nullable().default(null),
  paging: apiPagingSchema.nullable().default(null),
  compare: apiCompareSchema.nullable().default(null),
  daily_limit: z.number().int().positive().nullable().default(null),
  external_system: z.string().min(1).nullable().default(null),
  source_id: z.string().min(1).nullable().default(null),
  doc_url: z.string().url().nullable().default(null),
  note: z.string().nullable().default(null),
};

const checkEndpoint = (e: AnyObject, ctx: z.RefinementCtx) => {
  if (e.key_env != null && e.key_param == null)
    ctx.addIssue({ code: 'custom', path: ['key_param'], message: 'key_env 가 있으면 key_param 이 필요함' });
  const params = (e.params as ApiParamDef[] | undefined) ?? [];
  const names = new Set<string>();
  for (const [i, p] of params.entries()) {
    if (names.has(p.name)) ctx.addIssue({ code: 'custom', path: ['params', i, 'name'], message: '중복 매개변수' });
    names.add(p.name);
    if (e.key_param != null && p.name === e.key_param)
      ctx.addIssue({
        code: 'custom',
        path: ['params', i, 'name'],
        message: '키 매개변수는 정의하지 않는다(서버가 붙임)',
      });
    if (p.fixed && p.default === undefined)
      ctx.addIssue({ code: 'custom', path: ['params', i, 'default'], message: 'fixed 매개변수는 default 가 필요함' });
    if (p.kind === 'enum' && !p.options?.length)
      ctx.addIssue({ code: 'custom', path: ['params', i, 'options'], message: 'enum 은 options 가 필요함' });
  }
};

export const apiEndpointCreateSchema = z.object(endpointShape).strict().superRefine(checkEndpoint);
export const apiEndpointUpdateSchema = z
  .object(
    Object.fromEntries(
      Object.entries(endpointShape)
        .filter(([k]) => k !== 'id')
        .map(([k, v]) => [k, (v instanceof z.ZodDefault ? (v.unwrap() as z.ZodType) : v).optional()]),
    ) as Record<string, z.ZodType>,
  )
  .strict();
export type ApiEndpointCreate = z.input<typeof apiEndpointCreateSchema>;

export interface ApiEndpoint {
  id: string;
  provider: ApiProvider;
  name_ko: string;
  method: 'GET' | 'POST';
  base_url: string;
  params: ApiParamDef[];
  key_param: string | null;
  key_env: string | null;
  response_format: 'xml' | 'json';
  rows_path: string | null;
  paging: ApiPaging | null;
  compare: ApiCompare | null;
  daily_limit: number | null;
  external_system: string | null;
  source_id: string | null;
  doc_url: string | null;
  note: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** 오늘(한국 시간) 호출 수 */
  today_calls: number;
  /** 키 변수 설정 여부(값은 내보내지 않는다) */
  key_configured: boolean | null;
}

function zodToDomain(err: z.ZodError, prefix = ''): DomainError {
  return new DomainError('validation', '형식 오류', {
    violations: err.issues.map((i) => ({ rule: 'schema', path: prefix + i.path.join('.'), message: i.message })),
  });
}

function parseOr<T>(schema: z.ZodType<T>, v: unknown, prefix = ''): T {
  const r = schema.safeParse(v);
  if (!r.success) throw zodToDomain(r.error, prefix);
  return r.data;
}

const TODAY_START = `(date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

function shapeEndpoint(r: AnyObject, env?: EnvLike): ApiEndpoint {
  const pagingRaw = (r.paging as AnyObject | null) ?? null;
  const { compare, ...paging } = pagingRaw ?? {};
  const e: ApiEndpoint = {
    id: String(r.id),
    provider: r.provider as ApiProvider,
    name_ko: String(r.name_ko),
    method: r.method as 'GET' | 'POST',
    base_url: String(r.base_url),
    params: (r.params as ApiParamDef[]) ?? [],
    key_param: (r.key_param as string | null) ?? null,
    key_env: (r.key_env as string | null) ?? null,
    response_format: r.response_format as 'xml' | 'json',
    rows_path: (r.rows_path as string | null) ?? null,
    paging: pagingRaw && Object.keys(paging).length ? (paging as ApiPaging) : null,
    compare: (compare as ApiCompare | undefined) ?? null,
    daily_limit: r.daily_limit == null ? null : Number(r.daily_limit),
    external_system: (r.external_system as string | null) ?? null,
    source_id: (r.source_id as string | null) ?? null,
    doc_url: (r.doc_url as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    version: Number(r.version),
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
    deleted_at: iso(r.deleted_at),
    today_calls: Number(r.today_calls ?? 0),
    key_configured: null,
  };
  if (env) e.key_configured = e.key_env ? resolveKey(e, env).value != null : null;
  return e;
}

/** paging 열(jsonb)에 compare 를 함께 둔다(마이그레이션 없이, docs/03 4-19-1절) */
function pagingColumn(paging: ApiPaging | null | undefined, compare: ApiCompare | null | undefined): AnyObject | null {
  const out: AnyObject = { ...(paging ?? {}) };
  if (compare) out.compare = compare;
  return Object.keys(out).length ? out : null;
}

const ENDPOINT_COLS = `e.*, (SELECT count(*)::int FROM ingest.api_call c WHERE c.endpoint_id = e.id AND c.called_at >= ${TODAY_START}) AS today_calls`;

// ---------------------------------------------------------------------------
// 카탈로그 CRUD
// ---------------------------------------------------------------------------

export type EnvLike = Readonly<Record<string, string | undefined>>;

export async function listApiEndpoints(
  db: Queryable,
  opts: { includeDeleted?: boolean; env?: EnvLike } = {},
): Promise<ApiEndpoint[]> {
  const { rows } = await db.query(
    `SELECT ${ENDPOINT_COLS} FROM ingest.api_endpoint e ${opts.includeDeleted ? '' : 'WHERE e.deleted_at IS NULL'}
      ORDER BY e.provider, e.name_ko, e.id`,
  );
  return rows.map((r) => shapeEndpoint(r as AnyObject, opts.env));
}

export async function getApiEndpoint(
  db: Queryable,
  id: string,
  opts: { includeDeleted?: boolean; env?: EnvLike } = {},
): Promise<ApiEndpoint> {
  const { rows } = await db.query(
    `SELECT ${ENDPOINT_COLS} FROM ingest.api_endpoint e WHERE e.id = $1${opts.includeDeleted ? '' : ' AND e.deleted_at IS NULL'}`,
    [id],
  );
  if (!rows[0]) throw new DomainError('not_found', `엔드포인트 ${id} 가 없음`);
  return shapeEndpoint(rows[0] as AnyObject, opts.env);
}

function pgToDomain(e: unknown): unknown {
  const pg = e as { code?: string; message?: string; constraint?: string };
  if (pg?.code === '23505') return new DomainError('id_taken', '같은 id 의 엔드포인트가 있음(삭제된 것 포함)');
  if (pg?.code && /^23/.test(pg.code))
    return new DomainError('validation', 'DB 제약 위반', {
      violations: [{ rule: pg.constraint ?? 'db', path: '', message: pg.message ?? '' }],
    });
  return e;
}

export async function createApiEndpoint(db: Queryable, input: unknown, authorId: string | null): Promise<ApiEndpoint> {
  const e = parseOr(apiEndpointCreateSchema, input);
  try {
    await db.query(
      `INSERT INTO ingest.api_endpoint (id, provider, name_ko, method, base_url, params, key_param, key_env, response_format,
         rows_path, paging, daily_limit, external_system, source_id, doc_url, note, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)`,
      [
        e.id,
        e.provider,
        e.name_ko,
        e.method,
        e.base_url,
        JSON.stringify(e.params),
        e.key_param,
        e.key_env,
        e.response_format,
        e.rows_path,
        pagingColumn(e.paging, e.compare),
        e.daily_limit,
        e.external_system,
        e.source_id,
        e.doc_url,
        e.note,
        authorId,
      ],
    );
  } catch (err) {
    throw pgToDomain(err);
  }
  return getApiEndpoint(db, e.id);
}

export async function updateApiEndpoint(
  db: Queryable,
  id: string,
  patch: unknown,
  authorId: string | null,
  expectedVersion?: number,
): Promise<ApiEndpoint> {
  const p = parseOr(apiEndpointUpdateSchema, patch) as Partial<ApiEndpointCreate>;
  const cur = await getApiEndpoint(db, id);
  if (expectedVersion !== undefined && expectedVersion !== cur.version)
    throw new DomainError('version_conflict', `엔드포인트 ${id} 가 그사이 바뀜`, { current: cur });
  const merged = { ...cur, ...p };
  const {
    version: _v,
    created_at: _c,
    updated_at: _u,
    deleted_at: _d,
    today_calls: _t,
    key_configured: _k,
    ...rest
  } = merged as ApiEndpoint;
  const e = parseOr(apiEndpointCreateSchema, rest);
  try {
    await db.query(
      `UPDATE ingest.api_endpoint SET provider = $2, name_ko = $3, method = $4, base_url = $5, params = $6, key_param = $7,
         key_env = $8, response_format = $9, rows_path = $10, paging = $11, daily_limit = $12, external_system = $13,
         source_id = $14, doc_url = $15, note = $16, updated_by = $17, updated_at = now(), version = version + 1
       WHERE id = $1`,
      [
        id,
        e.provider,
        e.name_ko,
        e.method,
        e.base_url,
        JSON.stringify(e.params),
        e.key_param,
        e.key_env,
        e.response_format,
        e.rows_path,
        pagingColumn(e.paging, e.compare),
        e.daily_limit,
        e.external_system,
        e.source_id,
        e.doc_url,
        e.note,
        authorId,
      ],
    );
  } catch (err) {
    throw pgToDomain(err);
  }
  return getApiEndpoint(db, id);
}

/** 소프트 삭제(호출 기록이 참조하므로). id 는 다시 쓰지 않는다 */
export async function deleteApiEndpoint(
  db: Queryable,
  id: string,
  authorId: string | null,
  reason?: string,
): Promise<void> {
  const r = await db.query(
    `UPDATE ingest.api_endpoint SET deleted_at = now(), deleted_by = $2, delete_reason = $3, version = version + 1, updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL`,
    [id, authorId, reason ?? null],
  );
  if (!r.rowCount) throw new DomainError('not_found', `엔드포인트 ${id} 가 없음`);
}

/** 시드: id 기준 upsert(삭제된 것은 되살리지 않는다) */
export async function upsertApiEndpoint(
  db: Queryable,
  input: ApiEndpointCreate,
  authorId: string | null,
): Promise<'created' | 'updated' | 'skipped'> {
  const e = parseOr(apiEndpointCreateSchema, input);
  const cur = await db.query<{ deleted_at: Date | null }>(`SELECT deleted_at FROM ingest.api_endpoint WHERE id = $1`, [
    e.id,
  ]);
  if (!cur.rows[0]) {
    await createApiEndpoint(db, e, authorId);
    return 'created';
  }
  if (cur.rows[0].deleted_at) return 'skipped';
  const { id, ...rest } = e;
  await updateApiEndpoint(db, id, rest, authorId);
  return 'updated';
}

// ---------------------------------------------------------------------------
// 키
// ---------------------------------------------------------------------------

export interface KeyResolution {
  /** 실제로 값이 있는 변수 이름 */
  env: string | null;
  value: string | null;
  candidates: string[];
}

export function keyCandidates(e: Pick<ApiEndpoint, 'key_env' | 'provider'>): string[] {
  const out: string[] = [];
  if (e.key_env) out.push(e.key_env);
  const common = PROVIDER_COMMON_KEY_ENV[e.provider];
  if (common && !out.includes(common)) out.push(common);
  return out.filter((n) => KEY_ENV_PATTERN.test(n));
}

export function resolveKey(e: Pick<ApiEndpoint, 'key_env' | 'provider'>, env: EnvLike): KeyResolution {
  const candidates = keyCandidates(e);
  for (const name of candidates) {
    const v = env[name];
    if (v != null && v.trim() !== '') return { env: name, value: v.trim(), candidates };
  }
  return { env: null, value: null, candidates };
}

export interface KeyStatus {
  provider: ApiProvider;
  key_env: string;
  fallback_env: string | null;
  configured: boolean;
  /** 실제로 쓰이는 변수 */
  using_env: string | null;
  endpoint_ids: string[];
  last_success_at: string | null;
}

const OK_SQL = `(c.status BETWEEN 200 AND 299 AND (c.result_code IS NULL OR c.result_code = ANY ($1::text[])))`;

export async function keyStatuses(db: Queryable, env: EnvLike): Promise<KeyStatus[]> {
  const eps = await listApiEndpoints(db);
  const groups = new Map<string, KeyStatus>();
  for (const e of eps) {
    if (!e.key_env) continue;
    const k = `${e.provider}|${e.key_env}`;
    let g = groups.get(k);
    if (!g) {
      const r = resolveKey(e, env);
      const common = PROVIDER_COMMON_KEY_ENV[e.provider];
      g = {
        provider: e.provider,
        key_env: e.key_env,
        fallback_env: common && common !== e.key_env ? common : null,
        configured: r.value != null,
        using_env: r.env,
        endpoint_ids: [],
        last_success_at: null,
      };
      groups.set(k, g);
    }
    g.endpoint_ids.push(e.id);
  }
  for (const g of groups.values()) {
    const r = await db.query<{ at: Date | null }>(
      `SELECT max(c.called_at) AS at FROM ingest.api_call c WHERE c.endpoint_id = ANY ($2::text[]) AND ${OK_SQL}`,
      [OK_CODES, g.endpoint_ids],
    );
    g.last_success_at = iso(r.rows[0]?.at ?? null);
  }
  return [...groups.values()].sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.key_env.localeCompare(b.key_env),
  );
}

// ---------------------------------------------------------------------------
// 응답 해석
// ---------------------------------------------------------------------------

export type XmlParser = (text: string) => unknown;

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.').filter(Boolean)) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as AnyObject)[part];
  }
  return cur;
}

const isPlainObject = (v: unknown): v is AnyObject => v != null && typeof v === 'object' && !Array.isArray(v);

/** 반복 항목 배열 자동 감지: 가장 큰 "객체 배열". 없으면 item·row 로 끝나는 단일 객체를 [obj] 로 */
export function detectRows(parsed: unknown, rowsPath?: string | null): { path: string | null; rows: AnyObject[] } {
  const wrap = (v: unknown): AnyObject[] =>
    Array.isArray(v) ? v.map((x) => (isPlainObject(x) ? x : { value: x })) : isPlainObject(v) ? [v] : [];
  if (rowsPath) return { path: rowsPath, rows: wrap(getPath(parsed, rowsPath)) };
  let best: { path: string; rows: unknown[] } | null = null;
  let single: { path: string; obj: AnyObject } | null = null;
  const walk = (v: unknown, path: string, depth: number) => {
    if (depth > 8 || v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      const objs = v.filter(isPlainObject).length;
      if (objs > 0 && objs >= v.length / 2 && (!best || v.length > best.rows.length)) best = { path, rows: v };
      for (const x of v.slice(0, 3)) walk(x, path, depth + 1);
      return;
    }
    for (const [k, x] of Object.entries(v as AnyObject)) {
      const p = path ? `${path}.${k}` : k;
      if (!single && isPlainObject(x) && /^(item|row|items|list)$/i.test(k)) single = { path: p, obj: x };
      walk(x, p, depth + 1);
    }
  };
  walk(parsed, '', 0);
  const b = best as { path: string; rows: unknown[] } | null;
  if (b) return { path: b.path || null, rows: wrap(b.rows) };
  const s = single as { path: string; obj: AnyObject } | null;
  if (s) return { path: s.path, rows: [s.obj] };
  return { path: null, rows: [] };
}

export interface ResultInterpretation {
  code: string | null;
  message: string | null;
  ok: boolean;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'object') {
    const t = (v as AnyObject)['#text'];
    return t == null ? null : String(t);
  }
  return String(v);
}

/** 결과 코드 해석: 공공데이터포털(resultCode·returnReasonCode)·레일포털·VWorld·서울 열린데이터 */
export function interpretResult(
  provider: ApiProvider,
  parsed: unknown,
  httpStatus: number | null,
): ResultInterpretation {
  const httpOk = httpStatus != null && httpStatus >= 200 && httpStatus < 300;
  if (!isPlainObject(parsed)) return { code: null, message: null, ok: httpOk };
  // 공공데이터포털 게이트웨이 오류(키·승인·한도)
  const gw = getPath(parsed, 'OpenAPI_ServiceResponse.cmmMsgHeader');
  if (isPlainObject(gw)) {
    const code = str(gw.returnReasonCode);
    const msg = [str(gw.returnAuthMsg), str(gw.errMsg)].filter(Boolean).join(' / ');
    const meaning = code ? DATA_GO_KR_CODES[code.padStart(2, '0')] : undefined;
    return {
      code: code ? code.padStart(2, '0') : null,
      message: meaning ? `${meaning} (${msg})` : msg || null,
      ok: false,
    };
  }
  const header =
    (getPath(parsed, 'response.header') as AnyObject | undefined) ??
    (isPlainObject(parsed.header) ? (parsed.header as AnyObject) : undefined);
  if (isPlainObject(header) && header.resultCode != null) {
    const raw = str(header.resultCode)!;
    const code = /^\d+$/.test(raw) ? raw.padStart(2, '0') : raw;
    const table = provider === 'kric' ? KRIC_CODES : DATA_GO_KR_CODES;
    const meaning = table[code];
    const msg = str(header.resultMsg);
    return {
      code,
      message: meaning ? (msg && msg !== meaning ? `${meaning} (${msg})` : meaning) : msg,
      ok: httpOk && OK_CODES.includes(code),
    };
  }
  // VWorld: { response: { status: OK|NOT_FOUND|ERROR, error: { code, text } } }
  const vw = parsed.response;
  if (isPlainObject(vw) && typeof vw.status === 'string') {
    const err = isPlainObject(vw.error) ? vw.error : null;
    const code = err?.code ? `${vw.status}:${String(err.code)}` : vw.status;
    const message = vw.status === 'OK' ? '정상' : vw.status === 'NOT_FOUND' ? '결과 없음' : (str(err?.text) ?? '오류');
    return { code, message, ok: httpOk && (vw.status === 'OK' || vw.status === 'NOT_FOUND') };
  }
  // 서울 열린데이터: { RESULT: {CODE, MESSAGE} } 또는 { <서비스>: { RESULT: {...} } }
  const seoul =
    (isPlainObject(parsed.RESULT) ? parsed.RESULT : null) ??
    Object.values(parsed)
      .map((v) => (isPlainObject(v) && isPlainObject(v.RESULT) ? v.RESULT : null))
      .find(Boolean) ??
    null;
  if (isPlainObject(seoul) && seoul.CODE != null) {
    const code = String(seoul.CODE);
    return { code, message: str(seoul.MESSAGE), ok: httpOk && OK_CODES.includes(code) };
  }
  return { code: null, message: null, ok: httpOk };
}

function findTotal(parsed: unknown, totalPath?: string): number | null {
  if (totalPath) {
    const v = Number(str(getPath(parsed, totalPath)));
    return Number.isFinite(v) ? v : null;
  }
  let found: number | null = null;
  const walk = (v: unknown, depth: number) => {
    if (found != null || depth > 6 || !isPlainObject(v)) return;
    for (const [k, x] of Object.entries(v)) {
      if (/^(totalCount|list_total_count|total|totalcnt)$/i.test(k)) {
        const n = Number(str(x));
        if (Number.isFinite(n)) {
          found = n;
          return;
        }
      }
    }
    for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(parsed, 0);
  return found;
}

export interface PageInfo {
  kind: 'page' | 'range';
  page: number;
  size: number | null;
  total: number | null;
  has_next: boolean;
  next_params: Record<string, string> | null;
}

function pageInfo(e: ApiEndpoint, params: Record<string, string>, parsed: unknown, rowCount: number): PageInfo | null {
  const pg = e.paging;
  if (!pg) return null;
  const total = findTotal(parsed, pg.total_path);
  if (pg.page_param) {
    const page = Number(params[pg.page_param] ?? 1) || 1;
    const size = pg.size_param && params[pg.size_param] ? Number(params[pg.size_param]) || null : null;
    const hasNext =
      total != null && size != null ? page * size < total : size != null ? rowCount >= size && rowCount > 0 : false;
    return {
      kind: 'page',
      page,
      size,
      total,
      has_next: hasNext,
      next_params: hasNext ? { ...params, [pg.page_param]: String(page + 1) } : null,
    };
  }
  if (pg.start_param && pg.end_param) {
    const start = Number(params[pg.start_param] ?? 1) || 1;
    const end = Number(params[pg.end_param] ?? start) || start;
    const size = end - start + 1;
    const hasNext = total != null ? end < total : rowCount >= size && rowCount > 0;
    return {
      kind: 'range',
      page: Math.floor((start - 1) / size) + 1,
      size,
      total,
      has_next: hasNext,
      next_params: hasNext
        ? { ...params, [pg.start_param]: String(end + 1), [pg.end_param]: String(end + size) }
        : null,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 호출
// ---------------------------------------------------------------------------

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface CallOptions {
  fetchImpl?: FetchLike;
  env: EnvLike;
  origin?: 'admin' | 'importer' | 'agent';
  parseXml?: XmlParser;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface CallResult {
  call_id: number;
  endpoint_id: string;
  called_at: string;
  params: Record<string, string>;
  /** 요청 URL(키 가림) */
  url: string;
  status: number | null;
  elapsed_ms: number | null;
  ok: boolean;
  result_code: string | null;
  result_message: string | null;
  content_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  raw: string | null;
  raw_truncated: boolean;
  parsed: unknown;
  rows_path: string | null;
  rows: AnyObject[];
  rows_truncated: boolean;
  row_count: number;
  page_info: PageInfo | null;
  snapshot_document_id: string | null;
  today_calls: number;
  daily_limit: number | null;
}

/** 매개변수 검증·정규화(키 매개변수는 받지 않는다) */
export function normalizeParams(e: ApiEndpoint, input: unknown): Record<string, string> {
  const src = input == null ? {} : input;
  if (!isPlainObject(src))
    throw new DomainError('validation', '매개변수는 객체여야 함', {
      violations: [{ rule: 'schema', path: 'params', message: '{ 이름: 값 }' }],
    });
  const defs = new Map(e.params.map((p) => [p.name, p]));
  const violations: { rule: string; path: string; message: string }[] = [];
  const out: Record<string, string> = {};
  for (const k of Object.keys(src)) {
    if (e.key_param && k === e.key_param)
      violations.push({ rule: 'key', path: `params.${k}`, message: '키는 서버가 붙인다 — 보내지 말 것' });
    else if (!defs.has(k)) violations.push({ rule: 'schema', path: `params.${k}`, message: '정의되지 않은 매개변수' });
  }
  for (const p of e.params) {
    const rawV = (src as AnyObject)[p.name];
    let v = p.fixed ? p.default : rawV == null || rawV === '' ? p.default : String(rawV);
    if (v === undefined || v === '') {
      if (p.required) violations.push({ rule: 'required', path: `params.${p.name}`, message: '필수 매개변수' });
      continue;
    }
    v = String(v).trim();
    if (p.kind === 'int' && !/^-?\d+$/.test(v))
      violations.push({ rule: 'schema', path: `params.${p.name}`, message: '정수가 아님' });
    if (p.kind === 'date' && !/^(\d{8}|\d{4}-\d{2}-\d{2}|\d{6}|\d{4})$/.test(v))
      violations.push({ rule: 'schema', path: `params.${p.name}`, message: '날짜 형식(YYYYMMDD 등)이 아님' });
    if (p.kind === 'enum' && p.options && !p.options.includes(v))
      violations.push({ rule: 'schema', path: `params.${p.name}`, message: `허용 값: ${p.options.join(', ')}` });
    if (v.length > 2000) violations.push({ rule: 'schema', path: `params.${p.name}`, message: '너무 김' });
    out[p.name] = v;
  }
  if (violations.length) throw new DomainError('validation', '매개변수 오류', { violations });
  return out;
}

/** URL 만들기: base_url 의 {이름} 자리는 경로에, 나머지는 쿼리에. 키도 같은 규칙 */
export function buildUrl(e: ApiEndpoint, params: Record<string, string>, key: string | null): URL {
  const all: Record<string, string> = { ...params };
  if (e.key_param && key != null) all[e.key_param] = key;
  const used = new Set<string>();
  const filled = e.base_url.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, name: string) => {
    used.add(name);
    const v = all[name];
    if (v === undefined)
      throw new DomainError('validation', `경로 매개변수 ${name} 값이 없음`, {
        violations: [{ rule: 'required', path: `params.${name}`, message: '경로에 들어가는 값' }],
      });
    return encodeURIComponent(v);
  });
  const url = new URL(filled);
  const base = new URL(e.base_url.replace(/\{[A-Za-z0-9_]+\}/g, 'x'));
  if (url.host !== base.host) throw new DomainError('validation', '허용 호스트가 아님');
  for (const [k, v] of Object.entries(all)) if (!used.has(k)) url.searchParams.set(k, v);
  return url;
}

/** 키 값 가리기: 원문·URL 인코딩·폼 인코딩 모두 */
export function maskKey(text: string, key: string | null): string {
  if (!key) return text;
  const forms = new Set([key, encodeURIComponent(key), new URLSearchParams({ k: key }).toString().slice(2)]);
  let out = text;
  for (const f of [...forms].sort((a, b) => b.length - a.length)) if (f) out = out.split(f).join('***');
  return out;
}

class CallFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const len = Number(res.headers.get('content-length') ?? NaN);
  if (Number.isFinite(len) && len > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new CallFailure('TOO_LARGE', `응답이 상한(${maxBytes} 바이트)보다 큼`, res.status);
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new CallFailure('TOO_LARGE', `응답이 상한(${maxBytes} 바이트)보다 큼`, res.status);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** 허용 호스트만, 같은 호스트 리다이렉트만 따라간다(최대 3번) */
async function fetchAllowed(
  fetchImpl: FetchLike,
  url: URL,
  method: string,
  allowedHost: string,
  timeoutMs: number,
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  let cur = url;
  for (let hop = 0; hop < 4; hop++) {
    if (cur.host !== allowedHost)
      throw new CallFailure('HOST_BLOCKED', `허용 호스트(${allowedHost})가 아님: ${cur.host}`);
    let res: Response;
    try {
      res = await fetchImpl(cur.toString(), {
        method,
        redirect: 'manual',
        signal,
        headers: { 'user-agent': 'k-raildex-admin/0.1', accept: 'application/json, application/xml, text/xml, */*' },
      });
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError')
        throw new CallFailure('TIMEOUT', `시간 초과(${Math.round(timeoutMs / 1000)}초)`);
      throw new CallFailure('NETWORK', `연결 실패: ${(e as Error)?.message ?? String(e)}`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location')!, cur);
      await res.body?.cancel().catch(() => {});
      if (next.host !== allowedHost)
        throw new CallFailure('REDIRECT_BLOCKED', `다른 호스트로 리다이렉트: ${next.host}`, res.status);
      cur = next;
      continue;
    }
    return res;
  }
  throw new CallFailure('REDIRECT_LOOP', '리다이렉트가 너무 많음');
}

function parseBody(text: string, contentType: string | null, format: 'xml' | 'json', parseXml?: XmlParser): unknown {
  const t = text.trimStart();
  const looksXml = t.startsWith('<') || /xml/i.test(contentType ?? '');
  const looksJson = t.startsWith('{') || t.startsWith('[');
  if (looksJson || (!looksXml && format === 'json')) {
    try {
      return JSON.parse(text);
    } catch {
      /* XML 일 수 있다 */
    }
  }
  if ((looksXml || format === 'xml') && parseXml) {
    try {
      return parseXml(text);
    } catch {
      return null;
    }
  }
  return null;
}

async function todayCalls(db: Queryable, endpointId: string): Promise<number> {
  const r = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ingest.api_call WHERE endpoint_id = $1 AND called_at >= ${TODAY_START}`,
    [endpointId],
  );
  return r.rows[0]?.n ?? 0;
}

/** 오래된 호출 본문 지우기(스냅샷은 문서로 남아 있다) */
export async function purgeOldCallBodies(db: Queryable, days = CALL_BODY_RETENTION_DAYS): Promise<number> {
  const r = await db.query(
    `UPDATE ingest.api_call SET response_body = NULL
      WHERE response_body IS NOT NULL AND called_at < now() - make_interval(days => $1)`,
    [days],
  );
  return r.rowCount ?? 0;
}

function resultFromStored(e: ApiEndpoint, row: AnyObject, parseXml: XmlParser | undefined, today: number): CallResult {
  const body = row.response_body as Buffer | null;
  const text = body ? body.toString('utf8') : null;
  const meta = (row.params as AnyObject) ?? {};
  const params = (meta.query as Record<string, string>) ?? {};
  const parsed =
    text != null ? parseBody(text, (meta.content_type as string) ?? null, e.response_format, parseXml) : null;
  const det = parsed != null ? detectRows(parsed, e.rows_path) : { path: null, rows: [] };
  const status = row.status == null ? null : Number(row.status);
  const interp = interpretResult(e.provider, parsed, status);
  const ok =
    row.result_code != null && String(row.result_code).match(/^(TIMEOUT|NETWORK|TOO_LARGE|HOST_BLOCKED|REDIRECT)/)
      ? false
      : interp.ok;
  return {
    call_id: Number(row.id),
    endpoint_id: e.id,
    called_at: iso(row.called_at)!,
    params,
    url: String(meta.url ?? ''),
    status,
    elapsed_ms: row.elapsed_ms == null ? null : Number(row.elapsed_ms),
    ok,
    result_code: (row.result_code as string | null) ?? null,
    result_message: (row.result_message as string | null) ?? null,
    content_type: (meta.content_type as string | null) ?? null,
    size_bytes: body ? body.length : ((meta.size_bytes as number | undefined) ?? null),
    sha256: (row.response_sha256 as string | null) ?? null,
    raw: text != null ? text.slice(0, RAW_RESPONSE_LIMIT) : null,
    raw_truncated: text != null && text.length > RAW_RESPONSE_LIMIT,
    parsed: text != null && text.length <= RAW_RESPONSE_LIMIT ? parsed : null,
    rows_path: det.path,
    rows: det.rows.slice(0, ROWS_RESPONSE_LIMIT),
    rows_truncated: det.rows.length > ROWS_RESPONSE_LIMIT,
    row_count: det.rows.length,
    page_info: parsed != null ? pageInfo(e, params, parsed, det.rows.length) : null,
    snapshot_document_id: (row.snapshot_document_id as string | null) ?? null,
    today_calls: today,
    daily_limit: e.daily_limit,
  };
}

/**
 * 엔드포인트 호출 1회. 한도 초과면 DomainError rate_limited(429), 매개변수 오류·키 없음은 validation(422).
 * 외부 오류(HTTP 오류·시간 초과·결과 코드 오류)는 기록하고 결과로 돌려준다(ok=false).
 */
export async function callEndpoint(
  db: Queryable,
  endpointId: string,
  rawParams: unknown,
  opts: CallOptions,
): Promise<CallResult> {
  const e = await getApiEndpoint(db, endpointId);
  const params = normalizeParams(e, rawParams);
  let key: string | null = null;
  if (e.key_param) {
    const k = resolveKey(e, opts.env);
    if (!k.value)
      throw new DomainError('validation', `키 환경 변수가 없음: ${k.candidates.join(' 또는 ') || '(key_env 미지정)'}`, {
        violations: [{ rule: 'key', path: 'key_env', message: `${k.candidates.join(' → ')} 순서로 찾음` }],
      });
    key = k.value;
  }
  if (e.daily_limit != null) {
    const n = await todayCalls(db, e.id);
    if (n >= e.daily_limit)
      throw new DomainError('rate_limited', `오늘 호출 한도에 닿음(${n}/${e.daily_limit})`, {
        violations: [{ rule: 'daily_limit', path: 'daily_limit', message: `${n}/${e.daily_limit}` }],
      });
  }
  await purgeOldCallBodies(db).catch(() => 0);
  const url = buildUrl(e, params, key);
  const allowedHost = new URL(e.base_url.replace(/\{[A-Za-z0-9_]+\}/g, 'x')).host;
  const maskedUrl = maskKey(url.toString(), key);
  const fetchImpl = opts.fetchImpl ?? ((u: string, i: RequestInit) => fetch(u, i));
  const t0 = Date.now();
  let status: number | null = null;
  let contentType: string | null = null;
  let body: Buffer | null = null;
  let failure: CallFailure | null = null;
  try {
    const res = await fetchAllowed(fetchImpl, url, e.method, allowedHost, opts.timeoutMs ?? CALL_TIMEOUT_MS);
    status = res.status;
    contentType = res.headers.get('content-type');
    const buf = await readCapped(res, opts.maxBytes ?? CALL_MAX_BYTES);
    body = Buffer.from(maskKey(buf.toString('utf8'), key), 'utf8');
  } catch (err) {
    if (!(err instanceof CallFailure)) throw err;
    failure = err;
    status = err.status ?? status;
  }
  const elapsed = Date.now() - t0;
  const text = body?.toString('utf8') ?? null;
  const parsed = text != null ? parseBody(text, contentType, e.response_format, opts.parseXml) : null;
  const interp = failure
    ? { code: failure.code, message: maskKey(failure.message, key), ok: false }
    : interpretResult(e.provider, parsed, status);
  let resultCode = interp.code;
  let resultMessage = interp.message;
  if (!failure && resultCode == null && status != null && (status < 200 || status >= 300)) {
    resultCode = `HTTP_${status}`;
    resultMessage = text ? text.slice(0, 200).replace(/\s+/g, ' ') : null;
  }
  const meta = { query: params, url: maskedUrl, content_type: contentType, size_bytes: body?.length ?? null };
  const ins = await db.query(
    `INSERT INTO ingest.api_call (endpoint_id, params, origin, status, elapsed_ms, result_code, result_message, response_body, response_sha256)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      e.id,
      meta,
      opts.origin ?? 'admin',
      status,
      elapsed,
      resultCode,
      resultMessage,
      body,
      body ? sha256Hex(body) : null,
    ],
  );
  return resultFromStored(e, ins.rows[0] as AnyObject, opts.parseXml, await todayCalls(db, e.id));
}

export interface AllPagesResult {
  endpoint_id: string;
  call_ids: number[];
  pages: number;
  rows: AnyObject[];
  row_count: number;
  rows_truncated: boolean;
  total: number | null;
  /** 멈춘 이유: done(끝) | page_cap(쪽 수 상한) | daily_limit(한도) | error(오류 응답) | no_paging */
  stopped: 'done' | 'page_cap' | 'daily_limit' | 'error' | 'no_paging';
  last: CallResult;
}

/** 페이지 전부(쪽 수 상한 maxPages, 기본 20·최대 100). 각 쪽은 호출 기록 1행 */
export async function callAllPages(
  db: Queryable,
  endpointId: string,
  rawParams: unknown,
  opts: CallOptions & { maxPages?: number },
): Promise<AllPagesResult> {
  const cap = Math.min(Math.max(1, opts.maxPages ?? ALL_PAGES_DEFAULT_CAP), ALL_PAGES_MAX_CAP);
  const e = await getApiEndpoint(db, endpointId);
  let params: unknown = rawParams;
  const ids: number[] = [];
  const rows: AnyObject[] = [];
  let rowCount = 0;
  let last: CallResult | null = null;
  let stopped: AllPagesResult['stopped'] = 'done';
  for (let i = 0; i < cap; i++) {
    try {
      last = await callEndpoint(db, endpointId, params, opts);
    } catch (err) {
      if (err instanceof DomainError && err.code === 'rate_limited' && last) {
        stopped = 'daily_limit';
        break;
      }
      throw err;
    }
    ids.push(last.call_id);
    rowCount += last.row_count;
    for (const r of last.rows) if (rows.length < ROWS_RESPONSE_LIMIT) rows.push(r);
    if (!last.ok) {
      stopped = 'error';
      break;
    }
    if (!e.paging || !last.page_info) {
      stopped = 'no_paging';
      break;
    }
    if (!last.page_info.has_next || !last.page_info.next_params) break;
    if (i === cap - 1) {
      stopped = 'page_cap';
      break;
    }
    params = last.page_info.next_params;
  }
  return {
    endpoint_id: endpointId,
    call_ids: ids,
    pages: ids.length,
    rows,
    row_count: rowCount,
    rows_truncated: rowCount > rows.length,
    total: last?.page_info?.total ?? null,
    stopped,
    last: last!,
  };
}

// ---------------------------------------------------------------------------
// 호출 기록
// ---------------------------------------------------------------------------

export interface ApiCallListItem {
  id: number;
  endpoint_id: string;
  endpoint_name: string | null;
  params: Record<string, string>;
  url: string | null;
  called_at: string;
  origin: string;
  status: number | null;
  elapsed_ms: number | null;
  result_code: string | null;
  result_message: string | null;
  size_bytes: number | null;
  has_body: boolean;
  response_sha256: string | null;
  snapshot_document_id: string | null;
}

export async function listApiCalls(
  db: Queryable,
  q: { endpoint_id?: string; limit: number; offset: number },
): Promise<{ items: ApiCallListItem[]; total: number; limit: number; offset: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.endpoint_id) where.push(`c.endpoint_id = $${params.push(q.endpoint_id)}`);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ingest.api_call c ${w}`, params);
  const { rows } = await db.query(
    `SELECT c.id, c.endpoint_id, e.name_ko AS endpoint_name, c.params, c.called_at, c.origin, c.status, c.elapsed_ms,
            c.result_code, c.result_message, octet_length(c.response_body) AS body_size, c.response_sha256, c.snapshot_document_id
       FROM ingest.api_call c LEFT JOIN ingest.api_endpoint e ON e.id = c.endpoint_id ${w}
      ORDER BY c.called_at DESC, c.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.limit, q.offset],
  );
  return {
    items: rows.map((r) => {
      const meta = (r.params as AnyObject) ?? {};
      return {
        id: Number(r.id),
        endpoint_id: String(r.endpoint_id),
        endpoint_name: (r.endpoint_name as string | null) ?? null,
        params: (meta.query as Record<string, string>) ?? {},
        url: (meta.url as string | null) ?? null,
        called_at: iso(r.called_at)!,
        origin: String(r.origin),
        status: r.status == null ? null : Number(r.status),
        elapsed_ms: r.elapsed_ms == null ? null : Number(r.elapsed_ms),
        result_code: (r.result_code as string | null) ?? null,
        result_message: (r.result_message as string | null) ?? null,
        size_bytes: r.body_size == null ? ((meta.size_bytes as number | null) ?? null) : Number(r.body_size),
        has_body: r.body_size != null,
        response_sha256: (r.response_sha256 as string | null) ?? null,
        snapshot_document_id: (r.snapshot_document_id as string | null) ?? null,
      };
    }),
    total: total.rows[0]?.n ?? 0,
    limit: q.limit,
    offset: q.offset,
  };
}

async function loadCall(db: Queryable, callId: number): Promise<{ row: AnyObject; endpoint: ApiEndpoint }> {
  if (!Number.isSafeInteger(callId) || callId < 1) throw new DomainError('not_found', `호출 ${callId} 가 없음`);
  const { rows } = await db.query(`SELECT * FROM ingest.api_call WHERE id = $1`, [callId]);
  if (!rows[0]) throw new DomainError('not_found', `호출 ${callId} 가 없음`);
  const endpoint = await getApiEndpoint(db, String(rows[0].endpoint_id), { includeDeleted: true });
  return { row: rows[0] as AnyObject, endpoint };
}

export async function getApiCall(
  db: Queryable,
  callId: number,
  opts: { parseXml?: XmlParser } = {},
): Promise<CallResult> {
  const { row, endpoint } = await loadCall(db, callId);
  return resultFromStored(endpoint, row, opts.parseXml, await todayCalls(db, endpoint.id));
}

// ---------------------------------------------------------------------------
// 스냅샷(FR-ADM-104)
// ---------------------------------------------------------------------------

/** 호출 원문을 document(kind snapshot)로. 이미 있으면 그 문서. 본문이 지워졌으면 409 */
export async function snapshotApiCall(
  db: Queryable,
  store: ObjectStore,
  callId: number,
  authorId: string | null,
): Promise<{ document: DocumentRow; created: boolean }> {
  const { row, endpoint } = await loadCall(db, callId);
  if (row.snapshot_document_id)
    return { document: await getDocument(db, String(row.snapshot_document_id)), created: false };
  const body = row.response_body as Buffer | null;
  if (!body)
    throw new DomainError(
      'invalid_state',
      `호출 ${callId} 의 본문이 없음(보관 기간 ${CALL_BODY_RETENTION_DAYS}일 경과 또는 실패)`,
    );
  const meta = (row.params as AnyObject) ?? {};
  const ct = (meta.content_type as string | null) ?? null;
  const isXml = /xml/i.test(ct ?? '') || body.subarray(0, 64).toString('utf8').trimStart().startsWith('<');
  const ext = isXml ? 'xml' : 'json';
  const mime = isXml ? 'application/xml' : 'application/json';
  const calledAt = iso(row.called_at)!;
  const filename = safeFilename(`${endpoint.id}-${calledAt.slice(0, 19).replace(/[:T]/g, '')}-${callId}.${ext}`);
  const sha = sha256Hex(body);
  const key = documentKey(sha, filename);
  let license: Code<'licenseClass'> = 'unknown';
  if (endpoint.source_id) {
    const s = await db.query<{ license_class: string | null }>(`SELECT license_class FROM source WHERE id = $1`, [
      endpoint.source_id,
    ]);
    const lc = s.rows[0]?.license_class;
    if (lc && (codes.licenseClass.values as readonly string[]).includes(lc)) license = lc as Code<'licenseClass'>;
  }
  if (!(await store.head(key))) await store.put(key, body, mime);
  await db.query('BEGIN');
  let docId: string;
  try {
    const ins = await db.query<{ id: string }>(
      `INSERT INTO document (storage_key, filename, mime, size_bytes, sha256, origin_url, retrieved_at, kind, license_class, meta, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'snapshot', $8, $9, $10) RETURNING id`,
      [
        key,
        filename,
        mime,
        body.length,
        sha,
        meta.url ?? null,
        calledAt,
        license,
        {
          title: `${endpoint.name_ko} 응답 스냅샷 (${calledAt.slice(0, 16).replace('T', ' ')})`,
          api_call_id: callId,
          endpoint_id: endpoint.id,
          provider: endpoint.provider,
          params: meta.query ?? {},
          called_at: calledAt,
          status: row.status,
          result_code: row.result_code,
          sha256: sha,
        },
        authorId,
      ],
    );
    docId = ins.rows[0]!.id;
    if (endpoint.source_id)
      await db.query(
        `INSERT INTO source_document (source_id, document_id, role) VALUES ($1, $2, 'snapshot') ON CONFLICT DO NOTHING`,
        [endpoint.source_id, docId],
      );
    await db.query(`UPDATE ingest.api_call SET snapshot_document_id = $2 WHERE id = $1`, [callId, docId]);
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  }
  return { document: await getDocument(db, docId), created: true };
}

// ---------------------------------------------------------------------------
// DB 비교(FR-ADM-103)
// ---------------------------------------------------------------------------

export interface CompareDiff {
  field: 'name' | 'coord';
  external: unknown;
  db: unknown;
  /** 좌표 차이(m) */
  distance_m?: number;
}

export interface ComparePair {
  row_index: number;
  external: { code: string | null; name: string | null; lat: number | null; lng: number | null };
  entity_id: string | null;
  entity_type: string | null;
  label: string | null;
  /** 편집 화면으로 갈 개체(정거장이면 그 역) */
  link_type: string | null;
  link_id: string | null;
  status: 'same' | 'diff' | 'missing';
  diffs: CompareDiff[];
}

export interface CompareResult {
  call_id: number;
  external_system: string;
  entity_type: string | null;
  code_field: string;
  pairs: ComparePair[];
  summary: { rows: number; matched: number; same: number; diff: number; missing: number };
}

/** 좌표 차이 기준(m) — 이보다 멀면 차이로 표시 */
export const COMPARE_COORD_TOLERANCE_M = 200;

const normName = (s: string) =>
  s
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, '')
    .replace(/역$/, '');

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function compareApiCall(
  db: Queryable,
  callId: number,
  opts: { parseXml?: XmlParser } = {},
): Promise<CompareResult> {
  const { row, endpoint } = await loadCall(db, callId);
  if (!endpoint.external_system || !endpoint.compare)
    throw new DomainError(
      'invalid_state',
      `엔드포인트 ${endpoint.id} 에 비교 설정(external_system·compare.code_field)이 없음`,
    );
  const result = resultFromStored(endpoint, row, opts.parseXml, 0);
  if (result.raw == null) throw new DomainError('invalid_state', `호출 ${callId} 의 본문이 없음`);
  const sys = await db.query<{ entity_type: string }>(`SELECT entity_type FROM ref_external_system WHERE code = $1`, [
    endpoint.external_system,
  ]);
  const entityType = sys.rows[0]?.entity_type ?? null;
  const cmp = endpoint.compare;
  const ext = result.rows.map((r) => {
    const num = (p?: string) => {
      if (!p) return null;
      const n = Number(str(getPath(r, p)));
      return Number.isFinite(n) && n !== 0 ? n : null;
    };
    return {
      code: str(getPath(r, cmp.code_field)),
      name: cmp.name_field ? str(getPath(r, cmp.name_field)) : null,
      lat: num(cmp.lat_field),
      lng: num(cmp.lng_field),
    };
  });
  const codesList = [...new Set(ext.map((x) => x.code).filter((c): c is string => !!c))];
  const refs = await db.query<{ code: string; entity_id: string }>(
    `SELECT r.code, r.entity_id FROM external_ref r JOIN entity en ON en.id = r.entity_id
      WHERE r.system = $1 AND r.code = ANY ($2::text[])`,
    [endpoint.external_system, codesList],
  );
  const byCode = new Map<string, string[]>();
  for (const r of refs.rows) byCode.set(r.code, [...(byCode.get(r.code) ?? []), r.entity_id]);
  const ids = [...new Set(refs.rows.map((r) => r.entity_id))];
  const labels = await entityLabels(db, ids);
  // 이름·좌표: 역 · 정거장(역 이름·좌표로 대체)
  const info = new Map<
    string,
    { name: string | null; lat: number | null; lng: number | null; station_id: string | null }
  >();
  if (ids.length) {
    const st = await db.query<{
      id: string;
      name: string | null;
      lat: number | null;
      lng: number | null;
      station_id: string | null;
    }>(
      `SELECT s.id, s.name_ko AS name, ST_Y(s.geom::geometry) AS lat, ST_X(s.geom::geometry) AS lng, s.id AS station_id
         FROM station s WHERE s.id = ANY ($1::text[]) AND s.deleted_at IS NULL
       UNION ALL
       SELECT ls.id, coalesce(ls.name_ko, s.name_ko), ST_Y(coalesce(ls.geom, s.geom)::geometry), ST_X(coalesce(ls.geom, s.geom)::geometry), s.id
         FROM line_station ls JOIN station s ON s.id = ls.station_id
        WHERE ls.id = ANY ($1::text[]) AND ls.deleted_at IS NULL`,
      [ids],
    );
    for (const r of st.rows)
      info.set(r.id, {
        name: r.name,
        lat: r.lat == null ? null : Number(r.lat),
        lng: r.lng == null ? null : Number(r.lng),
        station_id: r.station_id,
      });
  }
  const pairs: ComparePair[] = [];
  for (const [i, x] of ext.entries()) {
    const matches = x.code ? (byCode.get(x.code) ?? []) : [];
    if (!matches.length) {
      pairs.push({
        row_index: i,
        external: x,
        entity_id: null,
        entity_type: null,
        label: null,
        link_type: null,
        link_id: null,
        status: 'missing',
        diffs: [],
      });
      continue;
    }
    for (const id of matches) {
      const lab = labels.get(id);
      const inf = info.get(id);
      const diffs: CompareDiff[] = [];
      const dbName = inf?.name ?? lab?.label ?? null;
      if (x.name && dbName && normName(x.name) !== normName(dbName))
        diffs.push({ field: 'name', external: x.name, db: dbName });
      if (x.lat != null && x.lng != null && inf?.lat != null && inf.lng != null) {
        const d = haversine({ lat: x.lat, lng: x.lng }, { lat: inf.lat, lng: inf.lng });
        if (d > COMPARE_COORD_TOLERANCE_M)
          diffs.push({
            field: 'coord',
            external: { lat: x.lat, lng: x.lng },
            db: { lat: inf.lat, lng: inf.lng },
            distance_m: Math.round(d),
          });
      }
      const type = lab?.type ?? null;
      pairs.push({
        row_index: i,
        external: x,
        entity_id: id,
        entity_type: type,
        label: dbName,
        link_type: type === 'line_station' ? 'station' : type,
        link_id: type === 'line_station' ? (inf?.station_id ?? id) : id,
        status: diffs.length ? 'diff' : 'same',
        diffs,
      });
    }
  }
  const matchedRows = new Set(pairs.filter((p) => p.entity_id).map((p) => p.row_index));
  return {
    call_id: callId,
    external_system: endpoint.external_system,
    entity_type: entityType,
    code_field: cmp.code_field,
    pairs,
    summary: {
      rows: ext.length,
      matched: matchedRows.size,
      same: pairs.filter((p) => p.status === 'same').length,
      diff: pairs.filter((p) => p.status === 'diff').length,
      missing: pairs.filter((p) => p.status === 'missing').length,
    },
  };
}

/** 역 선택기 → 외부 코드: 역 자신과 그 정거장의 external_ref(system) */
export async function externalCodesFor(
  db: Queryable,
  entityId: string,
  system: string,
): Promise<{ code: string; entity_id: string; label: string | null }[]> {
  const { rows } = await db.query<{ code: string; entity_id: string; label: string | null }>(
    `SELECT r.code, r.entity_id, coalesce(r.label, l.name_ko) AS label
       FROM external_ref r
       LEFT JOIN line_station ls ON ls.id = r.entity_id
       LEFT JOIN line l ON l.id = ls.line_id
      WHERE r.system = $2
        AND (r.entity_id = $1 OR r.entity_id IN (SELECT id FROM line_station WHERE station_id = $1 AND deleted_at IS NULL))
      ORDER BY r.is_primary DESC, r.code`,
    [entityId, system],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// 즐겨찾기(매개변수 묶음)
// ---------------------------------------------------------------------------

export interface ApiPreset {
  id: number;
  endpoint_id: string;
  name: string;
  params: Record<string, string>;
}

const presetInput = z.object({ name: z.string().min(1).max(200), params: z.record(z.string(), z.string()) }).strict();

export async function listApiPresets(db: Queryable, endpointId?: string): Promise<ApiPreset[]> {
  const { rows } = await db.query(
    `SELECT id, endpoint_id, name, params FROM ingest.api_preset ${endpointId ? 'WHERE endpoint_id = $1' : ''} ORDER BY endpoint_id, name, id`,
    endpointId ? [endpointId] : [],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    endpoint_id: String(r.endpoint_id),
    name: String(r.name),
    params: r.params as Record<string, string>,
  }));
}

export async function createApiPreset(db: Queryable, endpointId: string, input: unknown): Promise<ApiPreset> {
  const p = parseOr(presetInput, input);
  const e = await getApiEndpoint(db, endpointId);
  normalizeParams(e, p.params);
  const { rows } = await db.query(
    `INSERT INTO ingest.api_preset (endpoint_id, name, params) VALUES ($1, $2, $3) RETURNING id, endpoint_id, name, params`,
    [endpointId, p.name, p.params],
  );
  const r = rows[0]!;
  return {
    id: Number(r.id),
    endpoint_id: String(r.endpoint_id),
    name: String(r.name),
    params: r.params as Record<string, string>,
  };
}

export async function updateApiPreset(db: Queryable, presetId: number, input: unknown): Promise<ApiPreset> {
  const p = parseOr(presetInput.partial(), input);
  const cur = await db.query(`SELECT endpoint_id FROM ingest.api_preset WHERE id = $1`, [presetId]);
  if (!cur.rows[0]) throw new DomainError('not_found', `즐겨찾기 ${presetId} 가 없음`);
  if (p.params) normalizeParams(await getApiEndpoint(db, String(cur.rows[0].endpoint_id)), p.params);
  const { rows } = await db.query(
    `UPDATE ingest.api_preset SET name = coalesce($2, name), params = coalesce($3, params) WHERE id = $1
     RETURNING id, endpoint_id, name, params`,
    [presetId, p.name ?? null, p.params ?? null],
  );
  const r = rows[0]!;
  return {
    id: Number(r.id),
    endpoint_id: String(r.endpoint_id),
    name: String(r.name),
    params: r.params as Record<string, string>,
  };
}

export async function deleteApiPreset(db: Queryable, presetId: number): Promise<void> {
  const r = await db.query(`DELETE FROM ingest.api_preset WHERE id = $1`, [presetId]);
  if (!r.rowCount) throw new DomainError('not_found', `즐겨찾기 ${presetId} 가 없음`);
}
