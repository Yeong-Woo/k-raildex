/** 관리 API 호출. 인증은 Cloudflare Access 쿠키(운영) 또는 개발 우회 — 브라우저는 토큰을 갖지 않는다 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: { path?: string; rule?: string; message: string; entity_id?: string }[];
  references?: { table: string; column: string; owner_id: string | null; count: number }[];
  current_version?: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown; ifMatch?: number } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  if (init.ifMatch !== undefined) headers.set('if-match', String(init.ifMatch));
  const res = await fetch(path, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  if (!res.ok) {
    let body: ApiErrorBody = { code: 'http_' + res.status, message: res.statusText };
    try {
      const j = (await res.json()) as { error?: ApiErrorBody };
      if (j.error) body = j.error;
    } catch {
      /* 본문 없음 */
    }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** 아직 없는 경로(백엔드 구현 전)·404 는 null — 빈 상태로 보여 준다 */
export async function apiOptional<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T | null> {
  try {
    return await api<T>(path, init);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 501)) return null;
    throw e;
  }
}

/** 토스트용 오류 문구(검증 위반·참조 목록 포함) */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const parts = [e.body.message];
    if (e.status === 409 && e.body.current_version !== undefined)
      parts.push('다른 곳에서 먼저 수정했습니다 — 새로 불러온 뒤 다시 저장하세요');
    for (const d of e.body.details?.slice(0, 5) ?? [])
      parts.push(`${d.rule ? `[${d.rule}] ` : ''}${d.path ? `${d.path}: ` : ''}${d.message}`);
    if (e.body.references?.length)
      parts.push(`참조: ${e.body.references.map((r) => `${r.table}(${r.owner_id ?? '-'})`).join(', ')}`);
    return parts.join('\n');
  }
  return e instanceof Error ? e.message : String(e);
}

/** 개체 상세 응답(GET /v1/admin/:type/:id) */
export interface EntityResponse<T = Record<string, unknown>> {
  data: T & { version?: number };
  version: number;
  derived: Record<string, unknown>;
  referenced_by: {
    total: number;
    items: {
      table: string;
      column: string;
      owner_id: string | null;
      owner_type: string | null;
      owner_label: string | null;
      owner_deleted: boolean;
      count: number;
    }[];
  };
}
