/** `POST /v1/admin/jobs` 본문 — 관리 앱에서 직접 보낼 수 있는 작업과 페이로드(docs/04-api.md 4-3절) */
import { IMPORTER_TASK_LIST, JOB, type JobName, type JobPayloads } from '@k-raildex/domain';
import { z } from 'zod';

const importerTasks = IMPORTER_TASK_LIST.map((t) => t.task) as [string, ...string[]];

export const jobRequestSchema = z.discriminatedUnion('name', [
  z
    .object({
      name: z.literal(JOB.refreshDerived),
      data: z
        .object({ reason: z.string().max(200).optional() })
        .strict()
        .default({}),
    })
    .strict(),
  z
    .object({
      name: z.literal(JOB.importerRun),
      data: z
        .object({
          task: z.enum(importerTasks),
          // 옵션 검증은 worker(ImporterOptionsSchema, strict)가 한다
          options: z.record(z.string(), z.unknown()).default({}),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      name: z.literal(JOB.validateAll),
      data: z
        .object({ reason: z.string().max(200).optional() })
        .strict()
        .default({}),
    })
    .strict(),
  z.object({ name: z.literal(JOB.docTextExtract), data: z.object({ document_id: z.uuid() }).strict() }).strict(),
  z
    .object({
      name: z.literal(JOB.docPageImages),
      data: z.object({ document_id: z.uuid(), force: z.boolean().optional() }).strict(),
    })
    .strict(),
  z
    .object({
      name: z.literal(JOB.cleanupApiCalls),
      data: z
        .object({ days: z.number().int().min(1).max(365).optional() })
        .strict()
        .default({}),
    })
    .strict(),
]);

export type JobRequest = z.infer<typeof jobRequestSchema>;

/** 관리 앱 실행 양식에 보여 줄 작업 목록 */
export const RUNNABLE_JOBS: readonly { name: JobName; label: string; description: string }[] = [
  { name: JOB.refreshDerived, label: '파생 뷰 갱신', description: '지도·검색 물리화 뷰 다시 계산' },
  { name: JOB.importerRun, label: '수집기 실행', description: '시간표·운행정보·OSM 수집기(과제 선택)' },
  { name: JOB.validateAll, label: '전체 검증', description: 'Hard 규칙 전 개체 + Soft 규칙 건수' },
  { name: JOB.docTextExtract, label: '문서 텍스트 추출', description: 'PDF → text_content(문서 id)' },
  { name: JOB.docPageImages, label: '문서 쪽 이미지', description: 'PDF → 쪽 이미지(문서 id)' },
  { name: JOB.cleanupApiCalls, label: '외부 API 기록 정리', description: '7일 지난 응답 본문 비우기' },
];

export type SendableJob = { [N in JobName]: { name: N; data: JobPayloads[N] } }[JobName];
