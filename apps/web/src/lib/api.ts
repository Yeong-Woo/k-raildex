/**
 * 공개 API 클라이언트 — 서버 전용(FR-WEB-002: 브라우저는 API 에 닿지 않는다).
 * - 주소 `PUBLIC_API_URL`(기본 http://127.0.0.1:5101). 옛 시스템의 `API_URL`(5100, 다른 API)은 읽지 않는다, 토큰 `WEB_API_TOKEN`(범위 public:read)이 있으면 Bearer.
 * - 캐시(FR-WEB-003): fetch 캐시 30초 재검증 + 태그(`kr-data` 데이터 전체, `kr-path:<경로>`, 개체 id). 쓰기 반영 30초 이내(Q52 A).
 * - 응답은 contracts 의 zod 규격으로 검증한다. 개발 중에는 어긋나면 오류, 운영은 기록만 하고 그대로 쓴다(새 필드 때문에 사이트가 멈추지 않게).
 * - 옛 id: src/proxy.ts 가 먼저 301 로 보낸다. 여기까지 온 API 301 은 permanentRedirect(308, 예비), 없음·삭제(404·410)는 notFound().
 */
import 'server-only';
import { notFound, permanentRedirect } from 'next/navigation';
import type { z } from 'zod';

import { API_BASE, apiHeaders } from './api-base';

export { API_BASE, apiHeaders };

/** 데이터 재검증 주기(초) — Q52 A "30초 이내" */
export const REVALIDATE_SECONDS = 30;

/** 모든 공개 데이터 fetch 에 붙는 태그(revalidateTag('kr-data') 로 한꺼번에 비운다) */
export const DATA_TAG = 'kr-data';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

type QueryValue = string | number | boolean | null | undefined;

export function apiPath(path: string, query?: Record<string, QueryValue>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return `/v1/public${path}${s ? `?${s}` : ''}`;
}

interface GetOptions {
  query?: Record<string, QueryValue>;
  /** 개체 id 등 추가 캐시 태그 */
  tags?: string[];
  /** 404 를 notFound() 대신 null 로 */
  nullOn404?: boolean;
}

export async function apiGet<S extends z.ZodType>(
  path: string,
  schema: S,
  opts: GetOptions & { nullOn404: true },
): Promise<z.infer<S> | null>;
export async function apiGet<S extends z.ZodType>(path: string, schema: S, opts?: GetOptions): Promise<z.infer<S>>;
export async function apiGet<S extends z.ZodType>(
  path: string,
  schema: S,
  opts: GetOptions = {},
): Promise<z.infer<S> | null> {
  const p = apiPath(path, opts.query);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${p}`, {
      headers: apiHeaders(),
      redirect: 'manual',
      next: { revalidate: REVALIDATE_SECONDS, tags: [DATA_TAG, `kr-path:${p}`.slice(0, 250), ...(opts.tags ?? [])] },
    });
  } catch (e) {
    throw new ApiError(503, p, `공개 API 에 연결하지 못함: ${(e as Error).message}`);
  }
  if (res.status === 301 || res.status === 308) {
    const body = (await res.json().catch(() => null)) as { redirect?: { url_path?: string | null } } | null;
    const to = body?.redirect?.url_path;
    if (to) permanentRedirect(to);
    notFound();
  }
  if (res.status === 404 || res.status === 410) {
    if (opts.nullOn404) return null;
    notFound();
  }
  if (!res.ok) throw new ApiError(res.status, p, `공개 API 오류 ${res.status} (${p})`);
  const data: unknown = await res.json();
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const summary = parsed.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('; ');
  if (process.env.NODE_ENV !== 'production' || process.env.WEB_STRICT_CONTRACTS === '1') {
    throw new ApiError(500, p, `응답이 계약과 다름 (${p}): ${summary}`);
  }
  console.error(`[web] 응답이 계약과 다름 (${p}): ${summary}`);
  return data as z.infer<S>;
}

/** 목록을 끝까지(공개 목록 limit 최대 500) */
export async function apiGetAll<I>(
  path: string,
  schema: z.ZodType<{ items: I[]; total: number }>,
  query: Record<string, QueryValue> = {},
): Promise<I[]> {
  const items: I[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await apiGet(path, schema, { query: { ...query, limit: 500, offset } });
    items.push(...page.items);
    if (page.items.length < 500 || items.length >= page.total) break;
  }
  return items;
}
