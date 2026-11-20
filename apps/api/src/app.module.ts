/**
 * 루트 모듈. 설정·pg 풀·Access 공개키를 전역 제공자로 둔다.
 * 주입은 모두 @Inject(토큰) 을 명시한다 — tsx·esbuild(tsup)는 emitDecoratorMetadata 를 내지 않으므로
 * 타입 메타데이터에 기대지 않아야 dev(tsx watch)·build(tsup)·test(swc) 어디서나 같게 동작한다.
 */
import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import type pg from 'pg';
import { AuthModule } from './auth/auth.module';
import { ChangesetModule } from './changeset/changeset.module';
import { AllExceptionsFilter } from './common/errors';
import type { AppConfig } from './config';
import { DbService } from './db/db.service';
import { EntityModule } from './entity/entity.module';
import { HealthModule } from './health/health.module';
import { ACCESS_KEYS, CONFIG, PG_POOL } from './tokens';

export interface AppModuleOptions {
  config: AppConfig;
  pool: pg.Pool;
  /** 시험용: Access 공개키 해석기 교체 */
  accessKeys?: JWTVerifyGetKey | null;
}

@Global()
@Module({})
class CoreModule {
  static forRoot(opts: AppModuleOptions): DynamicModule {
    const keys =
      opts.accessKeys !== undefined
        ? opts.accessKeys
        : opts.config.access
          ? createRemoteJWKSet(new URL(`https://${opts.config.access.teamDomain}/cdn-cgi/access/certs`))
          : null;
    return {
      module: CoreModule,
      global: true,
      providers: [
        { provide: CONFIG, useValue: opts.config },
        { provide: PG_POOL, useValue: opts.pool },
        { provide: ACCESS_KEYS, useValue: keys },
        DbService,
      ],
      exports: [CONFIG, PG_POOL, ACCESS_KEYS, DbService],
    };
  }
}

@Module({})
export class AppModule {
  static forRoot(opts: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forRoot(opts), AuthModule, EntityModule, ChangesetModule, HealthModule],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    };
  }
}
