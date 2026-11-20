/**
 * 루트 모듈. 설정·pg 풀·Access 공개키를 전역 제공자로 둔다.
 * 주입은 모두 @Inject(토큰) 을 명시한다 — tsx·esbuild(tsup)는 emitDecoratorMetadata 를 내지 않으므로
 * 타입 메타데이터에 기대지 않아야 dev(tsx watch)·build(tsup)·test(swc) 어디서나 같게 동작한다.
 */
import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { RecordingJobQueue } from './jobs/job-queue';
import { UnconfiguredObjectStore, type JobQueue, type ObjectStore } from '@k-raildex/domain';
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import type pg from 'pg';
import { AttachmentModule } from './attachment/attachment.module';
import { AuthModule } from './auth/auth.module';
import { ChangesetModule } from './changeset/changeset.module';
import { AllExceptionsFilter } from './common/errors';
import type { AppConfig } from './config';
import { DbService } from './db/db.service';
import { DocumentModule } from './document/document.module';
import { EntityModule } from './entity/entity.module';
import { HealthModule } from './health/health.module';
import { MapModule } from './map/map.module';
import { QualityModule } from './quality/quality.module';
import { BulkModule } from './bulk/bulk.module';
import { ExternalModule } from './external/external.module';
import { OpsModule } from './ops/ops.module';
import { ACCESS_KEYS, CONFIG, EXTERNAL_HTTP, JOB_QUEUE, OBJECT_STORE, PG_POOL, type ExternalHttp } from './tokens';

export interface AppModuleOptions {
  config: AppConfig;
  pool: pg.Pool;
  /** 시험용: Access 공개키 해석기 교체 */
  accessKeys?: JWTVerifyGetKey | null;
  /** 문서 저장소(없으면 모든 문서 기능 503) */
  store?: ObjectStore;
  /** 작업 큐(없으면 보낸 작업을 기록만 함) */
  jobs?: JobQueue;
  /** 외부 API 탐색기: fetch·키 환경 변수(없으면 전역 fetch·process.env) */
  external?: Partial<ExternalHttp>;
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
        { provide: OBJECT_STORE, useValue: opts.store ?? new UnconfiguredObjectStore() },
        { provide: JOB_QUEUE, useValue: opts.jobs ?? new RecordingJobQueue() },
        {
          provide: EXTERNAL_HTTP,
          useValue: {
            fetchImpl: opts.external?.fetchImpl,
            env: opts.external?.env ?? process.env,
          } satisfies ExternalHttp,
        },
        DbService,
      ],
      exports: [CONFIG, PG_POOL, ACCESS_KEYS, OBJECT_STORE, JOB_QUEUE, EXTERNAL_HTTP, DbService],
    };
  }
}

@Module({})
export class AppModule {
  static forRoot(opts: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(opts),
        AuthModule,
        DocumentModule,
        AttachmentModule,
        QualityModule,
        MapModule,
        EntityModule,
        ChangesetModule,
        BulkModule,
        ExternalModule,
        OpsModule,
        HealthModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    };
  }
}
