/**
 * 작업 큐(pg-boss) 이름·페이로드 — api(보내기)와 worker(처리)가 함께 쓴다(docs/04-api.md 4-3절, docs/02-architecture.md).
 * pg-boss 큐 이름에는 ':' 를 쓸 수 없어 문서의 `doc:text-extract` 는 큐 이름 `doc.text-extract` 다.
 */

export const JOB = {
  /** 물리화 뷰 갱신(SELECT refresh_derived()) — data_changed NOTIFY 를 2초 디바운스해서 보낸다 */
  refreshDerived: 'refresh-derived',
  /** PDF 텍스트 추출(pdftotext -layout) → document.text_content */
  docTextExtract: 'doc.text-extract',
  /** PDF 쪽 이미지(pdftoppm -r 110, PNG) → 파생 문서 page_image */
  docPageImages: 'doc.page-images',
  /** 쪽 이미지 영역 잘라 내기(sharp) → 파생 문서 figure_crop */
  docCrop: 'doc.crop',
  /** 외부 API 호출 기록의 응답 본문 7일 뒤 비우기 */
  cleanupApiCalls: 'cleanup-api-calls',
  /** 전체 검증(Hard 규칙 전 개체 + Soft 규칙 건수) → app_setting validation.last (ops.ts) */
  validateAll: 'validate-all',
  /** 수집기 실행 — 처리기·과제 정의는 packages/importers(IMPORTER_JOB 과 같은 이름) */
  importerRun: 'importer.run',
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

export interface JobPayloads {
  'refresh-derived': { reason?: string; data_version?: number };
  'doc.text-extract': { document_id: string };
  'doc.page-images': { document_id: string; force?: boolean };
  'doc.crop': {
    document_id: string;
    page: number;
    bbox: [number, number, number, number];
    title?: string;
    author_id?: string | null;
  };
  'cleanup-api-calls': { days?: number };
  'validate-all': { reason?: string };
  /** task·options 검증은 worker(@k-raildex/importers ImporterJobSchema)가 한다 */
  'importer.run': { task: string; options?: Record<string, unknown> };
}

/** 큐 설정(pg-boss createQueue 옵션의 부분 집합) */
export interface JobQueueOptions {
  policy?: 'standard' | 'short' | 'singleton' | 'stately' | 'exclusive';
  retryLimit?: number;
  retryDelay?: number;
  expireInSeconds?: number;
}

export const JOB_QUEUES: Readonly<Record<JobName, JobQueueOptions>> = {
  // 실행 중 1개 + 대기 1개만(그 사이 들어온 요청은 대기 중인 것 하나로 합쳐진다)
  'refresh-derived': { policy: 'stately', retryLimit: 2, retryDelay: 5, expireInSeconds: 600 },
  'doc.text-extract': { policy: 'standard', retryLimit: 1, expireInSeconds: 600 },
  'doc.page-images': { policy: 'standard', retryLimit: 1, expireInSeconds: 1800 },
  'doc.crop': { policy: 'standard', retryLimit: 1, expireInSeconds: 300 },
  'cleanup-api-calls': { policy: 'stately', retryLimit: 1, expireInSeconds: 600 },
  'validate-all': { policy: 'stately', retryLimit: 0, expireInSeconds: 1800 },
  // 실패해도 이전 세트 유지(재시도 없음, 실행 기록 ingest.run 에 failed)
  'importer.run': { policy: 'standard', retryLimit: 0, expireInSeconds: 7200 },
};

/** 매일 04:00(Asia/Seoul) 정리. 수집기(importer.run)는 예약하지 않는다 — 시간표 재수집은 수동 실행만(round-04 Q110 C) */
export const JOB_SCHEDULES: ReadonlyArray<{ name: JobName; cron: string; tz: string }> = [
  { name: JOB.cleanupApiCalls, cron: '0 4 * * *', tz: 'Asia/Seoul' },
];

/** 작업 보내기 추상화(api 는 pg-boss, 시험은 기록용 가짜) */
export interface JobQueue {
  send<N extends JobName>(name: N, data: JobPayloads[N], opts?: { singletonKey?: string }): Promise<string | null>;
}

/** 외부 API 응답 본문 보관 기간(docs/04-api.md 4-2-1절) */
export const API_CALL_BODY_RETENTION_DAYS = 7;
