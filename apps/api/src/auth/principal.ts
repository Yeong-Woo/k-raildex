/** 요청 주체(docs/04-api.md 3절) */
import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Code } from '@k-raildex/contracts';

export const SCOPES = ['public:read', 'admin:read', 'admin:write', 'proposal:write', 'system:write'] as const;
export type Scope = (typeof SCOPES)[number];

export interface Principal {
  /** admin = Cloudflare Access(또는 개발 우회), token = API 토큰 */
  via: 'access' | 'dev_bypass' | 'token';
  userId: string;
  userKind: Code<'appUserKind'>;
  email: string | null;
  tokenId: string | null;
  scopes: ReadonlySet<Scope>;
}

export const ALL_SCOPES: ReadonlySet<Scope> = new Set(SCOPES);

/** 필요한 범위(하나라도 있으면 통과). admin:write 는 admin:read 를 포함한다 */
export function hasScope(p: Principal, anyOf: readonly Scope[]): boolean {
  return anyOf.some((s) => p.scopes.has(s) || (s === 'admin:read' && p.scopes.has('admin:write')));
}

export const SCOPES_KEY = 'krdx:scopes';
export const PUBLIC_KEY = 'krdx:public';

/** 이 처리기가 요구하는 범위(여럿이면 하나만 있어도 된다) */
export const RequireScope = (...anyOf: Scope[]) => SetMetadata(SCOPES_KEY, anyOf);
/** 인증 없음(/health) */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export interface AuthedRequest {
  principal?: Principal;
  headers: Record<string, string | string[] | undefined>;
}

export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.principal) throw new Error('principal 없음 — AuthGuard 가 먼저 돌아야 함');
  return req.principal;
});
