/**
 * 오류 응답(docs/04-api.md FR-API-006): { error: { code, message, details?: [{ path, rule, message }] } }.
 * DomainError → 404/409/422, zod → 400, ApiError → 지정 상태.
 */
import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { DomainError, StorageUnavailableError, type DomainErrorCode } from '@k-raildex/domain';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';

export interface ErrorDetail {
  path: string;
  rule: string;
  message: string;
  entity_id?: string;
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
    [extra: string]: unknown;
  };
}

/** API 자체 오류(인증·요청 형식 등) */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: { details?: ErrorDetail[]; [k: string]: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const DOMAIN_STATUS: Record<DomainErrorCode, number> = {
  not_found: 404,
  id_taken: 409,
  version_conflict: 409,
  referenced: 409,
  invalid_state: 409,
  validation: 422,
};

const HTTP_CODE: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'validation',
  428: 'precondition_required',
  429: 'too_many_requests',
  503: 'service_unavailable',
};

export function zodDetails(err: z.ZodError, prefix = ''): ErrorDetail[] {
  return err.issues.map((i) => ({ path: prefix + i.path.join('.'), rule: 'schema', message: i.message }));
}

/** DomainError → 응답 본문 */
export function domainErrorBody(e: DomainError): ErrorBody {
  const body: ErrorBody = { error: { code: e.code, message: e.message } };
  if (e.details.violations?.length)
    body.error.details = e.details.violations.map((v) => ({
      path: v.path,
      rule: v.rule,
      message: v.message,
      ...(v.entity_id ? { entity_id: v.entity_id } : {}),
    }));
  if (e.details.references) body.error.references = e.details.references;
  const current = e.details.current as { version?: unknown } | undefined;
  if (current && typeof current.version === 'number') body.error.current_version = current.version;
  return body;
}

export function toErrorResponse(e: unknown): { status: number; body: ErrorBody } {
  if (e instanceof DomainError) return { status: DOMAIN_STATUS[e.code], body: domainErrorBody(e) };
  if (e instanceof z.ZodError)
    return { status: 400, body: { error: { code: 'bad_request', message: '요청 형식 오류', details: zodDetails(e) } } };
  if (e instanceof StorageUnavailableError)
    return { status: 503, body: { error: { code: 'storage_unavailable', message: e.message } } };
  if (e instanceof ApiError)
    return { status: e.status, body: { error: { code: e.code, message: e.message, ...e.extra } } };
  if (e instanceof HttpException) {
    const status = e.getStatus();
    return { status, body: { error: { code: HTTP_CODE[status] ?? 'error', message: e.message } } };
  }
  // Fastify 오류(본문 JSON 파싱 실패 등)
  const fe = e as { statusCode?: number; code?: string; message?: string };
  if (typeof fe?.statusCode === 'number' && fe.statusCode >= 400 && fe.statusCode < 500) {
    return {
      status: fe.statusCode,
      body: { error: { code: HTTP_CODE[fe.statusCode] ?? 'bad_request', message: fe.message ?? '요청 오류' } },
    };
  }
  return { status: 500, body: { error: { code: 'internal', message: '서버 오류' } } };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const { status, body } = toErrorResponse(exception);
    if (status >= 500)
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : exception);
    void reply.status(status).header('content-type', 'application/json; charset=utf-8').send(body);
  }
}
