/** 공개 API 주소·인증 머리(서버 전용 — proxy·Route Handler·lib/api.ts 가 함께 쓴다). 브라우저 번들에 넣지 않는다 */
export const API_BASE = (process.env.PUBLIC_API_URL || 'http://127.0.0.1:5101').replace(/\/+$/, '');

export function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = process.env.WEB_API_TOKEN;
  return { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra };
}
