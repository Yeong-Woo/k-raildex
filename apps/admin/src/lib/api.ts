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
