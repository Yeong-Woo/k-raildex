/**
 * 계획 시간표 timetable_set·timetable_entry (docs/03-data-model.md 4-17절). 개체(entity)가 아니다 —
 * 수집기가 세트를 통째로 교체하는 기계적 갱신(버전·소프트 삭제 없음).
 * minute: 04시 이전은 24~27시(1440~1679분).
 */
import { z } from 'zod';
import { codes } from '../codes';
import { idSchema } from '../ids';
import { nullish, optInt, optText } from './common';

/** 시간표 세트 id: tt-<역>-<route_code>-<day>-<dir> */
export const timetableSetIdSchema = z.string().regex(/^tt-[a-z0-9-]+$/, {
  message: 'tt- 로 시작하는 시간표 세트 id 형식이 아님(소문자·숫자·하이픈, DB CHECK 와 같음)',
});

export const TimetableEntrySchema = z
  .object({
    minute: z.number().int().min(0).max(1679),
    dest_name: optText(),
    dest_station_id: nullish(idSchema('station')),
    train_no: z.string().default(''),
    note: optText(),
  })
  .strict();
export type TimetableEntry = z.infer<typeof TimetableEntrySchema>;

export const TimetableSetSchema = z
  .object({
    id: timetableSetIdSchema,
    station_id: idSchema('station'),
    /** 해석 못 하면 NULL(품질 목록 V-S14) */
    line_station_id: nullish(idSchema('line_station')),
    service_id: nullish(idSchema('service')),
    route_code: z.string().min(1),
    day_type: z.enum(codes.dayType.values),
    direction: z.enum(codes.direction.values),
    direction_label: optText(),
    day_note: optText(),
    data_as_of: optText(),
    source_id: idSchema('source'),
    import_run_id: optInt(),
    entries: z.array(TimetableEntrySchema).default([]),
  })
  .strict();
// 행 순서 = 배열 순서(DB ord). 같은 분·다른 종착 행이 있을 수 있어 분·열차번호 중복을 막지 않는다(0016)
export type TimetableSet = z.infer<typeof TimetableSetSchema>;

/**
 * 세트 `day_note` 의 공개 표시(round-04 Q111 A). 수집기는 `원문 — 해석 — 해석…` 꼴로 쓴다
 * (예: `운행정보 요일구분 "토요일+공휴일" — 토요일·공휴일 공통 다이아`).
 * 공개 사이트는 해석(`shown`)만 시간표에 보이고 원문 표기(`original`)는 출처 절에 둔다.
 */
export function splitDayNote(note: string | null | undefined): { shown: string | null; original: string | null } {
  if (!note) return { shown: null, original: null };
  const parts = note
    .split(' — ')
    .map((p) => p.trim())
    .filter(Boolean);
  const isOriginal = (p: string) => /^운행정보 요일구분 "/.test(p);
  const original = parts.filter(isOriginal);
  const shown = parts.filter((p) => !isOriginal(p));
  return {
    shown: shown.length ? shown.join(' · ') : null,
    original: original.length ? original.join(' · ') : null,
  };
}
