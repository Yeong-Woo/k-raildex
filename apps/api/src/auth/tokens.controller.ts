/**
 * 서비스 토큰(docs/04-api.md 4-3절 `GET/POST /v1/admin/tokens`). 평문 토큰은 만들 때 한 번만 돌려주고 sha256 만 저장한다.
 * api_token 은 개체가 아니라 인증 설정이라 도메인 적용기를 거치지 않는다.
 */
import { randomBytes } from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ensureServiceUser } from '@k-raildex/domain';
import { z } from 'zod';
import { ApiError } from '../common/errors';
import { DbService } from '../db/db.service';
import { sha256 } from './auth.service';
import { CurrentPrincipal, RequireScope, SCOPES, type Principal } from './principal';

const createTokenSchema = z
  .object({
    name: z.string().min(1).max(100),
    scopes: z.array(z.enum(SCOPES)).min(1),
    expires_at: z.iso.datetime({ offset: true }).nullable().optional(),
    /** 토큰 사용자 종류. 생략하면 범위로 정한다(admin:write → 만든 관리자, system:write → system, proposal:write → agent, 그 밖 web) */
    user_kind: z.enum(['admin', 'system', 'agent', 'web']).optional(),
  })
  .strict();

interface TokenRow {
  id: string;
  name: string;
  scopes: string[];
  user_id: string;
  user_kind: string;
  user_name: string;
  created_at: Date;
  expires_at: Date | null;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

const SELECT = `SELECT t.id, t.name, t.scopes, t.user_id, u.kind AS user_kind, u.display_name AS user_name,
                       t.created_at, t.expires_at, t.last_used_at, t.revoked_at
                  FROM api_token t JOIN app_user u ON u.id = t.user_id`;

@Controller('v1/admin/tokens')
export class TokensController {
  constructor(@Inject(DbService) private readonly dbs: DbService) {}

  @Get()
  @RequireScope('admin:write')
  async list() {
    const { rows } = await this.dbs.db.query<TokenRow>(`${SELECT} ORDER BY t.created_at DESC`);
    return { items: rows, total: rows.length, limit: rows.length, offset: 0 };
  }

  @Post()
  @RequireScope('admin:write')
  async create(@Body() body: unknown, @CurrentPrincipal() p: Principal) {
    const input = createTokenSchema.parse(body ?? {});
    const kind =
      input.user_kind ??
      (input.scopes.includes('admin:write')
        ? 'admin'
        : input.scopes.includes('system:write')
          ? 'system'
          : input.scopes.includes('proposal:write')
            ? 'agent'
            : 'web');
    let userId: string;
    if (kind === 'admin') {
      if (p.userKind !== 'admin') throw new ApiError(403, 'forbidden', '관리자 토큰은 관리자만 만들 수 있음');
      userId = p.userId;
    } else {
      userId = await ensureServiceUser(this.dbs.db, kind, input.name);
    }
    const token = `krdx_${randomBytes(32).toString('base64url')}`;
    const { rows } = await this.dbs.db.query<{ id: string }>(
      `INSERT INTO api_token (user_id, name, token_hash, scopes, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, input.name, sha256(token), input.scopes, input.expires_at ?? null],
    );
    const row = await this.dbs.db.query<TokenRow>(`${SELECT} WHERE t.id = $1`, [rows[0]!.id]);
    return { ...row.rows[0], token };
  }

  @Delete(':id')
  @HttpCode(200)
  @RequireScope('admin:write')
  async revoke(@Param('id') id: string) {
    const tokenId = z.uuid().parse(id);
    const { rowCount } = await this.dbs.db.query(
      `UPDATE api_token SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1`,
      [tokenId],
    );
    if (!rowCount) throw new ApiError(404, 'not_found', `토큰 ${id} 가 없음`);
    const row = await this.dbs.db.query<TokenRow>(`${SELECT} WHERE t.id = $1`, [tokenId]);
    return row.rows[0];
  }
}
