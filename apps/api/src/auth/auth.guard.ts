import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from '../common/errors';
import { AuthService } from './auth.service';
import { hasScope, PUBLIC_KEY, SCOPES_KEY, type AuthedRequest, type Scope } from './principal';

/** 전역 가드: @Public 이 아니면 인증하고 @RequireScope 범위를 확인한다(표시가 없으면 admin:write) */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const principal = await this.auth.authenticate(req);
    req.principal = principal;
    const need = this.reflector.getAllAndOverride<Scope[] | undefined>(SCOPES_KEY, targets) ?? ['admin:write'];
    if (!hasScope(principal, need)) throw new ApiError(403, 'forbidden', `범위 부족(필요: ${need.join(' 또는 ')})`);
    return true;
  }
}
