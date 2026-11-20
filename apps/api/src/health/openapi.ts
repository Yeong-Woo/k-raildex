/**
 * OpenAPI 3.1 문서(docs/04-api.md FR-API-002). 개체 계약(zod, packages/contracts)을 z.toJSONSchema 로 옮겨
 * components.schemas 에 <Type>Create·<Type>Update·<Type>Read 를 두고, 관리 API 경로를 적는다.
 * 표현할 수 없는 검사(superRefine 등)는 빠진다 — 최종 검증은 서버(zod·도메인 적용기)가 한다.
 */
import { codes, entityContracts, type EntityType } from '@k-raildex/contracts';
import { z } from 'zod';

type Json = Record<string, unknown>;

const pascal = (t: string) =>
  t
    .split(/[_-]/)
    .map((s) => s[0]!.toUpperCase() + s.slice(1))
    .join('');

function toSchema(schema: z.ZodType, io: 'input' | 'output'): Json {
  try {
    const s = z.toJSONSchema(schema, { io, unrepresentable: 'any', target: 'draft-2020-12' }) as Json;
    delete s.$schema;
    return s;
  } catch (e) {
    return { description: `스키마 변환 실패: ${(e as Error).message}` };
  }
}

const errorSchema: Json = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: {
          type: 'array',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, rule: { type: 'string' }, message: { type: 'string' } },
          },
        },
      },
    },
  },
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: Json) => ({ 'application/json': { schema } });
const errors = Object.fromEntries(
  ['400', '401', '403', '404', '409', '422'].map((c) => [c, { $ref: `#/components/responses/Error` }]),
);
const ok = (schema: Json = { type: 'object' }, code = '200') => ({
  [code]: { description: 'OK', content: json(schema) },
});
const pathParam = (name: string) => ({ name, in: 'path', required: true, schema: { type: 'string' } });
const queryParam = (name: string, schema: Json = { type: 'string' }) => ({
  name,
  in: 'query',
  required: false,
  schema,
});

const writeOpts = [queryParam('dry_run', { type: 'boolean' }), queryParam('rationale'), queryParam('changeset_title')];

export function buildOpenApi(): Json {
  const schemas: Json = {
    Error: errorSchema,
    WriteResult: {
      type: 'object',
      properties: {
        id: { type: ['string', 'null'] },
        version: { type: ['integer', 'null'] },
        changeset_id: { type: 'string' },
        data_version: { type: ['integer', 'null'] },
        dry_run: { type: 'boolean' },
        data: { type: ['object', 'null'] },
        warnings: { type: 'array' },
      },
    },
    ListItem: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        type: { type: 'string' },
        name_ko: { type: ['string', 'null'] },
        name_en: { type: ['string', 'null'] },
        status: { type: ['string', 'null'] },
        stage: { type: ['string', 'null'] },
        review_status: { type: ['string', 'null'] },
        version: { type: 'integer' },
        updated_at: { type: 'string', format: 'date-time' },
        deleted_at: { type: ['string', 'null'], format: 'date-time' },
      },
    },
  };
  const paths: Json = {};
  for (const [type, c] of Object.entries(entityContracts) as [EntityType, (typeof entityContracts)[EntityType]][]) {
    const P = pascal(type);
    schemas[`${P}Create`] = toSchema(c.create, 'input');
    schemas[`${P}Update`] = toSchema(c.update, 'input');
    schemas[`${P}Read`] = toSchema(c.read, 'output');
    const k = type.replace(/_/g, '-');
    const tag = [codes.entityType.labels[type].ko];
    paths[`/v1/admin/${k}`] = {
      get: {
        tags: tag,
        summary: `${type} 목록`,
        parameters: ['q', 'status', 'review_status', 'region', 'area', 'updated_since', 'sort']
          .map((n) => queryParam(n))
          .concat([
            queryParam('include_deleted', { type: 'boolean' }),
            queryParam('limit', { type: 'integer', minimum: 1, maximum: 500 }),
            queryParam('offset', { type: 'integer', minimum: 0 }),
          ]),
        responses: {
          ...ok({
            type: 'object',
            properties: {
              items: { type: 'array', items: ref('ListItem') },
              total: { type: 'integer' },
              limit: { type: 'integer' },
              offset: { type: 'integer' },
            },
          }),
          ...errors,
        },
      },
      post: {
        tags: tag,
        summary: `${type} 생성`,
        parameters: writeOpts,
        requestBody: { required: true, content: json(ref(`${P}Create`)) },
        responses: { ...ok(ref('WriteResult'), '201'), ...errors },
      },
    };
    paths[`/v1/admin/${k}/{id}`] = {
      parameters: [pathParam('id')],
      get: {
        tags: tag,
        summary: `${type} 상세(derived·referenced_by 포함)`,
        responses: {
          ...ok({
            type: 'object',
            properties: {
              data: ref(`${P}Read`),
              version: { type: 'integer' },
              derived: { type: 'object' },
              referenced_by: { type: 'object' },
            },
          }),
          ...errors,
        },
      },
      patch: {
        tags: tag,
        summary: `${type} 부분 수정(If-Match 필수)`,
        parameters: [{ name: 'If-Match', in: 'header', required: true, schema: { type: 'string' } }, ...writeOpts],
        requestBody: { required: true, content: json(ref(`${P}Update`)) },
        responses: { ...ok(ref('WriteResult')), ...errors, '428': { $ref: '#/components/responses/Error' } },
      },
      delete: {
        tags: tag,
        summary: `${type} 소프트 삭제(purge=true 면 휴지통에서 영구 삭제)`,
        parameters: [queryParam('purge', { type: 'boolean' }), queryParam('reason'), ...writeOpts],
        responses: { ...ok(ref('WriteResult')), ...errors },
      },
    };
    paths[`/v1/admin/${k}/{id}/restore`] = {
      parameters: [pathParam('id')],
      post: { tags: tag, summary: '휴지통 복구', responses: { ...ok(ref('WriteResult')), ...errors } },
    };
    paths[`/v1/admin/${k}/{id}/history`] = {
      parameters: [pathParam('id')],
      get: { tags: tag, summary: '변경 이력', responses: { ...ok(), ...errors } },
    };
    paths[`/v1/admin/${k}/{id}/revert`] = {
      parameters: [pathParam('id')],
      post: { tags: tag, summary: 'op 하나 되돌리기({ changeset_id, seq })', responses: { ...ok(), ...errors } },
    };
    paths[`/v1/admin/${k}/validate`] = {
      post: {
        tags: tag,
        summary: '저장 없이 검증(id 쿼리가 있으면 수정으로)',
        parameters: [queryParam('id')],
        requestBody: { required: true, content: json({ oneOf: [ref(`${P}Create`), ref(`${P}Update`)] }) },
        responses: { ...ok(), ...errors },
      },
    };
  }
  const misc: [string, string, string][] = [
    ['get', '/v1/admin/trash', '휴지통'],
    ['get', '/v1/admin/lookup', '참조 선택기(type, q)'],
    ['get', '/v1/admin/reference', '코드값·권역·시·도·외부 시스템'],
    ['get', '/v1/admin/entities/{id}/references', '참조 행'],
    ['post', '/v1/admin/entities/{id}/rename', 'ID 변경(id_redirect)'],
    ['post', '/v1/admin/stations/{id}/merge', '역 병합'],
    ['get', '/v1/admin/lines/{id}/stations', '노선별 역 목록'],
    ['put', '/v1/admin/lines/{id}/stations', '노선별 역 전체 교체'],
    ['get', '/v1/admin/changesets', '변경 묶음 목록(status, origin)'],
    ['post', '/v1/admin/changesets', 'draft 제출'],
    ['get', '/v1/admin/changesets/{id}', '변경 묶음 상세'],
    ['post', '/v1/admin/changesets/{id}/preview', '미리 보기(롤백)'],
    ['post', '/v1/admin/changesets/{id}/approve', '승인(적용)'],
    ['post', '/v1/admin/changesets/{id}/reject', '반려'],
    ['post', '/v1/admin/changesets/{id}/revert', '되돌림 묶음 생성·적용'],
    ['get', '/v1/admin/bulk/targets', '여러 건 입력 대상·필드'],
    ['post', '/v1/admin/bulk/parse', '여러 건 입력: 표(TSV·CSV) → 열 대응 추정·값 해석·행별 오류'],
    ['post', '/v1/admin/bulk/submit', '여러 건 입력: draft 변경 묶음(origin bulk_import)'],
    ['get', '/v1/admin/external/providers', '외부 API 제공처'],
    ['get', '/v1/admin/external/endpoints', '외부 API 엔드포인트 카탈로그'],
    ['post', '/v1/admin/external/endpoints', '엔드포인트 등록'],
    ['get', '/v1/admin/external/endpoints/{id}', '엔드포인트 상세'],
    ['patch', '/v1/admin/external/endpoints/{id}', '엔드포인트 수정(If-Match 선택)'],
    ['delete', '/v1/admin/external/endpoints/{id}', '엔드포인트 삭제(소프트)'],
    ['post', '/v1/admin/external/catalog/seed', '초기 카탈로그 upsert'],
    ['post', '/v1/admin/external/endpoints/{id}/call', '호출(본문 = 매개변수, 키는 서버가 주입·가림)'],
    ['post', '/v1/admin/external/endpoints/{id}/call-all-pages', '페이지 전부(max_pages)'],
    ['get', '/v1/admin/external/calls', '호출 기록(endpoint_id)'],
    ['get', '/v1/admin/external/calls/{id}', '호출 결과(본문 보관 중이면 원문·행)'],
    ['post', '/v1/admin/external/calls/{id}/snapshot', '결과를 스냅샷 문서로'],
    ['post', '/v1/admin/external/calls/{id}/compare', '응답 행 ↔ external_ref 개체 비교'],
    ['get', '/v1/admin/external/ref-codes', '역 → 외부 코드(entity_id, system)'],
    ['get', '/v1/admin/external/presets', '즐겨찾기 목록(endpoint_id)'],
    ['get', '/v1/admin/external/endpoints/{id}/presets', '엔드포인트 즐겨찾기'],
    ['post', '/v1/admin/external/endpoints/{id}/presets', '즐겨찾기 저장'],
    ['patch', '/v1/admin/external/presets/{pid}', '즐겨찾기 수정'],
    ['delete', '/v1/admin/external/presets/{pid}', '즐겨찾기 삭제'],
    ['get', '/v1/admin/external/keys', '키 상태(변수 유무·최근 성공, 값 없음)'],
    ['get', '/v1/admin/entities/{id}/attachments', '첨부 목록'],
    ['post', '/v1/admin/entities/{id}/attachments', '첨부 추가(변경 묶음)'],
    ['patch', '/v1/admin/attachments/{aid}', '첨부 수정(If-Match)'],
    ['delete', '/v1/admin/attachments/{aid}', '첨부 삭제(소프트)'],
    ['get', '/v1/admin/documents', '문서 목록(q, source_id, kind, parent)'],
    ['post', '/v1/admin/documents', '문서 업로드(multipart: file, kind, license_class, source_id, origin_url, title)'],
    ['get', '/v1/admin/documents/{id}', '문서 상세(include_text)'],
    ['patch', '/v1/admin/documents/{id}', '문서 수정(license_class, publishable, title, origin_url)'],
    ['get', '/v1/admin/documents/{id}/download', '원문 내려받기(스트림)'],
    ['post', '/v1/admin/documents/{id}/extract-text', '텍스트 추출 작업'],
    ['post', '/v1/admin/documents/{id}/pages', '쪽 이미지 생성 작업'],
    ['get', '/v1/admin/documents/{id}/pages', '쪽 이미지 목록'],
    ['get', '/v1/admin/documents/{id}/pages/{n}/image', '쪽 이미지(PNG)'],
    ['post', '/v1/admin/documents/{id}/crop', '그림 잘라 내기 → figure_crop'],
    ['get', '/v1/admin/quality', '품질 규칙별 건수'],
    ['get', '/v1/admin/quality/{rule}', '품질 규칙 대상 목록'],
    ['get', '/v1/admin/map/lines', '시점별 노선 GeoJSON(at, stage_min, include_undated)'],
    ['get', '/v1/admin/map/stations', '시점별 역 GeoJSON'],
    ['get', '/v1/admin/map/current-stations', '현재 역 GeoJSON(mv_map_station)'],
    ['get', '/v1/admin/map/current-lines', '현재 노선 GeoJSON(mv_map_line, ODbL)'],
    ['get', '/v1/admin/map/timeline', '연도별 개통 예정 계획 수'],
    ['get', '/v1/admin/tokens', '서비스 토큰 목록'],
    ['post', '/v1/admin/tokens', '서비스 토큰 발급(평문은 한 번만)'],
    ['delete', '/v1/admin/tokens/{id}', '서비스 토큰 폐기'],
    ['get', '/v1/admin/jobs', '작업(pg-boss)·실행 기록(ingest.run) 목록(state, name, kind, limit)'],
    ['post', '/v1/admin/jobs', '작업 보내기({ name, data } — 허용 작업만)'],
    ['get', '/v1/admin/jobs/importer-tasks', '보낼 수 있는 작업·수집기 과제 목록'],
    ['get', '/v1/admin/jobs/{id}', '작업 상세(uuid = pg-boss, run-<번호> = 실행 기록)'],
    ['get', '/v1/admin/ops/status', '운영 상태(24시간 실패·마지막 백업·큐 길이) — 대시보드 배너'],
    ['post', '/v1/admin/validate-all', '전체 검증(작업, sync=true 면 동기 결과)'],
    ['get', '/v1/admin/validate-all/last', '마지막 전체 검증 결과'],
    ['post', '/v1/admin/documents/{id}/refetch', '원본 재다운로드(origin_url, 바뀌면 새 판)'],
    ['get', '/v1/admin/settings', '알려진 설정 목록'],
    ['get', '/v1/admin/settings/agent-budget', '에이전트 월 예산·이번 달 사용액'],
    ['put', '/v1/admin/settings/agent-budget', '에이전트 월 예산 변경({ monthly_usd })'],
    ['get', '/v1/meta', '데이터 판·개체 수·마이그레이션'],
    ['get', '/health', '상태'],
  ];
  for (const [method, path, summary] of misc) {
    const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => pathParam(m[1]!));
    const entry = (paths[path] ??= {}) as Json;
    entry[method] = {
      summary,
      ...(params.length ? { parameters: params } : {}),
      ...(path === '/health' ? { security: [] } : {}),
      responses: { ...ok(), ...errors },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'K-Raildex API', version: '0.1.0', description: '관리 API(docs/04-api.md). 127.0.0.1 전용.' },
    servers: [{ url: 'http://127.0.0.1:5100' }],
    security: [{ cfAccess: [] }, { bearer: [] }],
    paths,
    components: {
      schemas,
      responses: { Error: { description: '오류(FR-API-006)', content: json(ref('Error')) } },
      securitySchemes: {
        cfAccess: { type: 'apiKey', in: 'header', name: 'Cf-Access-Jwt-Assertion' },
        bearer: { type: 'http', scheme: 'bearer' },
      },
    },
  };
}
