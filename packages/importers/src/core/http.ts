/**
 * 외부 API 호출 도구(docs/08 3-1, docs/03 4-19-1).
 * - 429(초당 제한)·5xx·네트워크 오류는 지연을 늘리며 재시도(429 = 4초×n, 그 밖 = 1.5초×n). 기존 fetch-tago-timetable.ts 와 같은 규칙.
 * - 시도마다 ingest.api_call 에 기록(키 제외)하고, 엔드포인트별 오늘(Asia/Seoul) 호출 수가 일일 한도에 닿으면 LimitReached.
 */
import { createHash } from 'node:crypto';
import type { Queryable } from '@k-raildex/domain';
import { apiKey, commonKeyVar } from './keys';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type Sleep = (ms: number) => Promise<void>;

export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class LimitReached extends Error {
  override name = 'LimitReached';
}
/** 키 미등록·만료 등 재시도해도 소용없는 오류 */
export class FatalApiError extends Error {
  override name = 'FatalApiError';
}
export class RetryableApiError extends Error {
  override name = 'RetryableApiError';
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** 재시도 지연(ms). 429 는 길게 */
export function backoffMs(attempt: number, status?: number): number {
  return status === 429 ? 4000 * (attempt + 1) : 1500 * (attempt + 1);
}

export interface EndpointDef {
  id: string;
  provider: string;
  name_ko: string;
  base_url: string;
  key_param: string | null;
  key_env: string | null;
  response_format: 'json' | 'xml';
  daily_limit: number | null;
  source_id?: string | null;
  doc_url?: string | null;
  note?: string | null;
}

/** 엔드포인트 카탈로그 행이 없으면 기본 정의로 만든다(있으면 DB 값 — 관리 앱에서 바꾼 한도 등 — 을 쓴다) */
export async function ensureEndpoint(db: Queryable, def: EndpointDef): Promise<EndpointDef> {
  await db.query(
    `INSERT INTO ingest.api_endpoint (id, provider, name_ko, base_url, key_param, key_env, response_format, daily_limit,
       source_id, doc_url, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT id FROM public.source WHERE id = $9),$10,$11)
     ON CONFLICT (id) DO NOTHING`,
    [
      def.id,
      def.provider,
      def.name_ko,
      def.base_url,
      def.key_param,
      def.key_env,
      def.response_format,
      def.daily_limit,
      def.source_id ?? null,
      def.doc_url ?? null,
      def.note ?? null,
    ],
  );
  const r = await db.query<EndpointDef>(
    `SELECT id, provider, name_ko, base_url, key_param, key_env, response_format, daily_limit, source_id, doc_url, note
       FROM ingest.api_endpoint WHERE id = $1 AND deleted_at IS NULL`,
    [def.id],
  );
  if (!r.rows[0]) throw new Error(`외부 API 엔드포인트가 삭제됨: ${def.id}`);
  return r.rows[0];
}

export async function callsToday(db: Queryable, endpointId: string): Promise<number> {
  const r = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM ingest.api_call
      WHERE endpoint_id = $1 AND called_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`,
    [endpointId],
  );
  return Number(r.rows[0]!.n);
}

export interface ApiClientOptions {
  fetch?: FetchLike;
  sleep?: Sleep;
  /** 이번 실행의 호출 상한(일일 한도보다 작게 둘 때). 오늘 누적 + 이번 실행이 이 값·일일 한도에 닿으면 멈춘다 */
  maxCalls?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /** 응답 본문을 api_call 에 남길지(기본 true, 7일 뒤 worker 가 비운다) */
  keepBody?: boolean;
}

export interface ApiResponse {
  status: number;
  text: string;
}

/**
 * 엔드포인트 하나에 묶인 호출기. 응답 해석(성공 여부 판정)은 parse 콜백이 하고, RetryableApiError 를 던지면 재시도한다.
 */
export class ApiClient {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: Sleep;
  private used = -1;
  calls = 0;
  readonly key: string;

  constructor(
    private readonly db: Queryable,
    readonly endpoint: EndpointDef,
    private readonly opts: ApiClientOptions = {},
  ) {
    this.fetchImpl = opts.fetch ?? ((i, init) => fetch(i, init));
    this.sleep = opts.sleep ?? realSleep;
    const k = apiKey(endpoint.key_env, commonKeyVar(endpoint.provider), opts.env);
    if (!k) throw new FatalApiError(`API 키 없음: ${endpoint.key_env ?? '-'} → ${commonKeyVar(endpoint.provider)}`);
    this.key = k.key;
  }

  private get limit(): number {
    const lims = [this.endpoint.daily_limit, this.opts.maxCalls].filter((x): x is number => typeof x === 'number');
    return lims.length ? Math.min(...lims) : Number.POSITIVE_INFINITY;
  }

  async request<T>(
    op: string,
    params: Record<string, string>,
    parse: (res: ApiResponse) => { value: T; resultCode?: string; resultMessage?: string },
  ): Promise<T> {
    if (this.used < 0) this.used = await callsToday(this.db, this.endpoint.id);
    const url = new URL(op ? `${this.endpoint.base_url.replace(/\/$/, '')}/${op}` : this.endpoint.base_url);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (this.endpoint.key_param) url.searchParams.set(this.endpoint.key_param, this.key);
    const logged = { op, ...params };
    const maxAttempts = this.opts.maxAttempts ?? 7;
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this.used >= this.limit) throw new LimitReached(`일일 호출 상한 ${this.limit} 도달(${this.endpoint.id})`);
      this.used++;
      this.calls++;
      const t0 = Date.now();
      let status: number | null = null;
      let text = '';
      let resultCode: string | undefined;
      let resultMessage: string | undefined;
      try {
        const res = await this.fetchImpl(url, {
          headers: { 'User-Agent': 'k-raildex-importer/0.1' },
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
        });
        status = res.status;
        text = await res.text();
        if (res.status === 429 || res.status >= 500) throw new RetryableApiError(`HTTP ${res.status}`, res.status);
        const out = parse({ status: res.status, text });
        resultCode = out.resultCode;
        resultMessage = out.resultMessage;
        await this.record(logged, status, Date.now() - t0, resultCode, resultMessage, text);
        return out.value;
      } catch (e) {
        const err = e as Error;
        await this.record(logged, status, Date.now() - t0, resultCode ?? err.name, err.message, text).catch(() => {});
        if (e instanceof LimitReached || e instanceof FatalApiError) throw e;
        lastErr = e;
        if (attempt + 1 < maxAttempts) await this.sleep(backoffMs(attempt, status ?? undefined));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private async record(
    params: Record<string, string>,
    status: number | null,
    elapsed: number,
    code: string | undefined,
    message: string | undefined,
    body: string,
  ): Promise<void> {
    const buf = Buffer.from(body, 'utf8');
    await this.db.query(
      `INSERT INTO ingest.api_call (endpoint_id, params, origin, status, elapsed_ms, result_code, result_message,
         response_body, response_sha256)
       VALUES ($1, $2, 'importer', $3, $4, $5, $6, $7, $8)`,
      [
        this.endpoint.id,
        JSON.stringify(params),
        status,
        elapsed,
        code ?? null,
        message?.slice(0, 500) ?? null,
        this.opts.keepBody === false || !body ? null : buf,
        body ? createHash('sha256').update(buf).digest('hex') : null,
      ],
    );
  }
}
