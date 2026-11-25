/**
 * 인증(docs/04-api.md 3절, decisions Q80):
 * - `Authorization: Bearer <토큰>` → api_token(sha256 해시) 조회. 폐기·만료·비활성 사용자는 401. 범위는 토큰의 scopes
 * - 그 밖 → Cloudflare Access JWT(`Cf-Access-Jwt-Assertion`) 검증: 팀 도메인 공개키·audience·issuer, email = ADMIN_EMAIL.
 *   AUTH_DEV_BYPASS=1(운영 아님)이면 Access 검증 없이 관리자로 본다. 관리자는 모든 범위
 * - 단 Cloudflare 를 거쳐 온 요청(Cf-Connecting-Ip·Cf-Ray 헤더)에는 우회를 쓰지 않는다 — 터널 공개 호스트 이름을 잘못
 *   이어 개발용 api·관리 앱이 외부에 열려도 관리자 권한이 나가지 않게(C-9, 2026-11-26 관리 앱 외부 공개)
 */
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ensureAdmin } from '@k-raildex/domain';
import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AppConfig } from '../config';
import { ApiError } from '../common/errors';
import { DbService } from '../db/db.service';
import { ACCESS_KEYS, CONFIG } from '../tokens';
import { ALL_SCOPES, SCOPES, type AuthedRequest, type Principal, type Scope } from './principal';

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

const ADMIN_CACHE_MS = 60_000;

@Injectable()
export class AuthService {
  private readonly adminIds = new Map<string, { id: string; at: number }>();

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DbService) private readonly dbs: DbService,
    @Inject(ACCESS_KEYS) private readonly accessKeys: JWTVerifyGetKey | null,
  ) {}

  async authenticate(req: AuthedRequest): Promise<Principal> {
    const auth = header(req, 'authorization');
    if (auth) {
      const m = /^Bearer\s+(\S+)$/i.exec(auth);
      if (!m) throw new ApiError(401, 'unauthorized', 'Authorization 형식은 Bearer <토큰>');
      return this.fromToken(m[1]!);
    }
    if (this.config.devBypass && !viaCloudflare(req))
      return this.admin(this.config.adminEmail ?? 'dev@localhost', 'dev_bypass');
    const jwt = header(req, 'cf-access-jwt-assertion');
    if (!jwt) throw new ApiError(401, 'unauthorized', '인증 필요(Cloudflare Access 또는 API 토큰)');
    return this.fromAccessJwt(jwt);
  }

  private async fromAccessJwt(jwt: string): Promise<Principal> {
    const access = this.config.access;
    if (!access || !this.accessKeys) throw new ApiError(401, 'unauthorized', 'Cloudflare Access 설정이 없음');
    let email: unknown;
    try {
      const { payload } = await jwtVerify(jwt, this.accessKeys, {
        audience: access.audience,
        issuer: `https://${access.teamDomain}`,
      });
      email = payload.email;
    } catch {
      throw new ApiError(401, 'unauthorized', 'Access 토큰 검증 실패');
    }
    if (typeof email !== 'string' || email.toLowerCase() !== access.adminEmail)
      throw new ApiError(403, 'forbidden', '허용되지 않은 사용자');
    return this.admin(email.toLowerCase(), 'access');
  }

  private async admin(email: string, via: 'access' | 'dev_bypass'): Promise<Principal> {
    const cached = this.adminIds.get(email);
    let id = cached && Date.now() - cached.at < ADMIN_CACHE_MS ? cached.id : undefined;
    if (!id) {
      id = await ensureAdmin(this.dbs.db, email);
      this.adminIds.set(email, { id, at: Date.now() });
    }
    return { via, userId: id, userKind: 'admin', email, tokenId: null, scopes: ALL_SCOPES };
  }

  private async fromToken(token: string): Promise<Principal> {
    const { rows } = await this.dbs.db.query<{
      id: string;
      user_id: string;
      scopes: string[];
      expires_at: Date | null;
      revoked_at: Date | null;
      kind: Principal['userKind'];
      email: string | null;
      active: boolean;
    }>(
      `SELECT t.id, t.user_id, t.scopes, t.expires_at, t.revoked_at, u.kind, u.email, u.active
         FROM api_token t JOIN app_user u ON u.id = t.user_id WHERE t.token_hash = $1`,
      [sha256(token)],
    );
    const t = rows[0];
    if (!t || t.revoked_at || !t.active || (t.expires_at && new Date(t.expires_at).getTime() <= Date.now()))
      throw new ApiError(401, 'unauthorized', '유효하지 않은 토큰');
    await this.dbs.db.query(`UPDATE api_token SET last_used_at = now() WHERE id = $1`, [t.id]);
    const scopes = new Set(t.scopes.filter((s): s is Scope => (SCOPES as readonly string[]).includes(s)));
    return { via: 'token', userId: t.user_id, userKind: t.kind, email: t.email, tokenId: t.id, scopes };
  }
}

function header(req: AuthedRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v || undefined;
}

/** Cloudflare 엣지(터널 포함)가 붙이는 헤더 — 로컬 요청에는 없다 */
function viaCloudflare(req: AuthedRequest): boolean {
  return !!(header(req, 'cf-connecting-ip') || header(req, 'cf-ray'));
}
