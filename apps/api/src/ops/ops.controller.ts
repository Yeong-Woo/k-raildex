/**
 * 운영 API(docs/04-api.md 4-3절): 작업 목록·상세·요청, 운영 상태(대시보드 배너), 전체 검증, 원본 재다운로드, 설정(에이전트 예산).
 * 처리 로직은 도메인 ops.ts·ops-refetch.ts. app_setting·document 행은 개체가 아니라 변경 묶음을 남기지 않는다.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Res } from '@nestjs/common';
import {
  DomainError,
  getAgentBudget,
  getDocument,
  getJob,
  IMPORTER_TASK_LIST,
  JOB,
  lastValidation,
  listJobs,
  listSettings,
  opsStatus,
  refetchDocument,
  setAgentBudget,
  validateAll,
  type JobQueue,
  type ObjectStore,
} from '@k-raildex/domain';
import type { FastifyReply } from 'fastify';
import { CurrentPrincipal, RequireScope, type Principal } from '../auth/principal';
import { ApiError } from '../common/errors';
import { boolParam } from '../common/http';
import { DbService } from '../db/db.service';
import { JOB_QUEUE, OBJECT_STORE } from '../tokens';
import { jobRequestSchema, RUNNABLE_JOBS, type JobRequest } from './job-request';

type Q = Record<string, string | undefined>;

/** 동기 전체 검증을 허용하는 최대 활성 개체 수(그보다 크면 작업으로 보낸다) */
export const SYNC_VALIDATE_MAX_ENTITIES = 50_000;

@Controller('v1/admin')
export class OpsController {
  constructor(
    @Inject(DbService) private readonly dbs: DbService,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
  ) {}

  // -------------------------------------------------------------------------
  // 작업
  // -------------------------------------------------------------------------

  @Get('jobs')
  @RequireScope('admin:read')
  async list(@Query() q: Q) {
    return listJobs(this.dbs.db, q);
  }

  /** 실행 양식용: 보낼 수 있는 작업과 수집기 과제(정적 목록 — api 는 importers 에 의존하지 않는다) */
  @Get('jobs/importer-tasks')
  @RequireScope('admin:read')
  importerTasks() {
    return { items: IMPORTER_TASK_LIST, jobs: RUNNABLE_JOBS };
  }

  @Get('jobs/:id')
  @RequireScope('admin:read')
  async get(@Param('id') id: string) {
    return getJob(this.dbs.db, id);
  }

  @Post('jobs')
  @HttpCode(202)
  @RequireScope('admin:write')
  async send(@Body() body: unknown) {
    const req = jobRequestSchema.parse(body ?? {});
    if (req.name === JOB.docTextExtract || req.name === JOB.docPageImages) {
      const doc = await getDocument(this.dbs.db, req.data.document_id);
      if (doc.mime !== 'application/pdf')
        throw new DomainError('validation', `PDF 만 처리할 수 있음(${doc.mime})`, {
          violations: [{ rule: 'mime', path: 'data.document_id', message: 'application/pdf 만' }],
        });
    }
    const id = await this.sendJob(req);
    // stately 큐(파생 갱신·검증·정리)는 이미 대기 중이면 null — 그 작업에 합쳐진다
    return { name: req.name, id, deduplicated: id === null };
  }

  private sendJob(req: JobRequest): Promise<string | null> {
    switch (req.name) {
      case JOB.refreshDerived:
        return this.jobs.send(req.name, { reason: req.data.reason ?? 'admin' });
      case JOB.importerRun:
        return this.jobs.send(req.name, { task: req.data.task, options: { trigger: 'manual', ...req.data.options } });
      case JOB.validateAll:
        return this.jobs.send(req.name, { reason: req.data.reason ?? 'admin' });
      case JOB.docTextExtract:
        return this.jobs.send(req.name, req.data);
      case JOB.docPageImages:
        return this.jobs.send(req.name, req.data);
      case JOB.cleanupApiCalls:
        return this.jobs.send(req.name, req.data);
    }
  }

  /** 대시보드 배너(Q64 C): 24시간 실패·마지막 백업·큐 길이 */
  @Get('ops/status')
  @RequireScope('admin:read')
  async status() {
    return opsStatus(this.dbs.db);
  }

  // -------------------------------------------------------------------------
  // 전체 검증
  // -------------------------------------------------------------------------

  @Post('validate-all')
  @HttpCode(202)
  @RequireScope('admin:write')
  async validate(@Query() q: Q, @Res({ passthrough: true }) reply: FastifyReply) {
    const sync = boolParam.parse(q.sync);
    if (!sync) {
      const id = await this.jobs.send(JOB.validateAll, { reason: 'admin' });
      return { job: JOB.validateAll, job_id: id, deduplicated: id === null };
    }
    const { rows } = await this.dbs.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM entity WHERE deleted_at IS NULL`,
    );
    if ((rows[0]?.n ?? 0) > SYNC_VALIDATE_MAX_ENTITIES)
      throw new ApiError(
        409,
        'too_large',
        `개체가 ${SYNC_VALIDATE_MAX_ENTITIES}개를 넘어 동기 검증을 하지 않음 — sync 없이 작업으로 보내세요`,
      );
    const result = await this.dbs.withClient((c) => validateAll(c));
    void reply.status(200);
    return result;
  }

  @Get('validate-all/last')
  @RequireScope('admin:read')
  async lastValidate() {
    const r = await lastValidation(this.dbs.db);
    if (!r) throw new ApiError(404, 'not_found', '아직 전체 검증 결과가 없음');
    return r;
  }

  // -------------------------------------------------------------------------
  // 원본 재다운로드(Q76)
  // -------------------------------------------------------------------------

  @Post('documents/:id/refetch')
  @HttpCode(200)
  @RequireScope('admin:write')
  async refetch(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    let r;
    try {
      r = await this.dbs.withClient((c) => refetchDocument(c, this.store, id, { author_id: p.userId }));
    } catch (e) {
      // 원본 서버 쪽 실패(응답 오류·시간 초과)는 502, 요청·문서 문제(scheme·크기·종류)는 422
      const rule = e instanceof DomainError ? e.details.violations?.[0]?.rule : undefined;
      if (rule === 'refetch.http' || rule === 'refetch.timeout')
        throw new ApiError(502, 'bad_gateway', (e as Error).message, {
          details: e instanceof DomainError ? e.details.violations : undefined,
        });
      throw e;
    }
    let jobId: string | null = null;
    if (r.changed && r.document.mime === 'application/pdf')
      jobId = await this.jobs.send(JOB.docTextExtract, { document_id: r.document.id });
    return { ...r, text_extract_job_id: jobId };
  }

  // -------------------------------------------------------------------------
  // 설정
  // -------------------------------------------------------------------------

  @Get('settings')
  @RequireScope('admin:read')
  async settings() {
    return listSettings(this.dbs.db);
  }

  @Get('settings/agent-budget')
  @RequireScope('admin:read')
  async agentBudget() {
    return getAgentBudget(this.dbs.db);
  }

  @Put('settings/agent-budget')
  @RequireScope('admin:write')
  async putAgentBudget(@Body() body: unknown) {
    return setAgentBudget(this.dbs.db, body ?? {});
  }
}
