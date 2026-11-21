/**
 * 수집기 과제 목록 — CLI(`pnpm -F @k-raildex/importers run <task>`)와 worker 작업 `importer.run`({ task, options })이 함께 쓴다.
 */
import type { Queryable } from '@k-raildex/domain';
import { z } from 'zod';
import { OSM_TASK, runOsmRail } from './osm/rail';
import { runKricTrainOps, KRIC_TASK } from './timetable/kric';
import { runTagoTimetable, TAGO_TASK, type ImportResult } from './timetable/tago';

/** worker 큐 이름(pg-boss 큐 이름에는 ':' 를 못 쓴다) */
export const IMPORTER_JOB = 'importer.run';

export const ImporterOptionsSchema = z
  .object({
    fromRaw: z.string().min(1).optional(),
    /** kric-train-ops: 원본 xlsx 파일·디렉터리(Q108 A) */
    fromXlsx: z.string().min(1).optional(),
    /** kric-train-ops: 원본 xlsx 를 레일포털에서 내려받아 fromXlsx 디렉터리에 저장(키 불필요) */
    download: z.boolean().optional(),
    dryRun: z.boolean().optional(),
    trigger: z.enum(['schedule', 'manual', 'event']).optional(),
    tagoIds: z.array(z.string()).optional(),
    lineNos: z.array(z.string()).optional(),
    area: z.enum(['capital', 'all']).optional(),
    limit: z.number().int().positive().optional(),
    maxCalls: z.number().int().positive().optional(),
    /** osm-rail: Overpass 를 직접 부른다(기본은 --from-raw 추출 파일) */
    live: z.boolean().optional(),
    endpoint: z.url().optional(),
  })
  .strict();
export type ImporterOptions = z.infer<typeof ImporterOptionsSchema>;

export const ImporterJobSchema = z.object({
  task: z.enum([TAGO_TASK, KRIC_TASK, OSM_TASK]),
  options: ImporterOptionsSchema.default({}),
});
export type ImporterJob = z.input<typeof ImporterJobSchema>;

export const IMPORTER_TASKS = [TAGO_TASK, KRIC_TASK, OSM_TASK] as const;
export type ImporterTask = (typeof IMPORTER_TASKS)[number];

/** 과제 실행. db 는 단일 연결(트랜잭션을 연다) */
export async function runImporter(
  db: Queryable,
  task: string,
  options: ImporterOptions = {},
  log?: (m: string) => void,
): Promise<ImportResult> {
  const job = ImporterJobSchema.parse({ task, options });
  const o = job.options;
  switch (job.task) {
    case TAGO_TASK:
      return runTagoTimetable(db, {
        fromRaw: o.fromRaw,
        dryRun: o.dryRun,
        trigger: o.trigger,
        tagoIds: o.tagoIds,
        area: o.area,
        limit: o.limit,
        maxCalls: o.maxCalls,
        log,
      });
    case KRIC_TASK:
      return runKricTrainOps(db, {
        fromRaw: o.fromRaw,
        fromXlsx: o.fromXlsx,
        download: o.download,
        dryRun: o.dryRun,
        trigger: o.trigger,
        lineNos: o.lineNos,
        log,
      });
    case OSM_TASK:
      return runOsmRail(db, {
        fromRaw: o.fromRaw,
        live: o.live,
        endpoint: o.endpoint,
        dryRun: o.dryRun,
        trigger: o.trigger,
        log,
      });
  }
}
