/** 공개 API — 지도 GeoJSON(docs/04-api.md 5절, docs/03-data-model.md 6-1절). OSM 선형을 쓰면 attribution(ODbL) */
import { z } from 'zod';
import { codes } from '../codes';

const featureSchema = <P extends z.ZodType>(props: P) =>
  z
    .object({
      type: z.literal('Feature'),
      id: z.string().optional(),
      geometry: z.object({ type: z.string(), coordinates: z.array(z.unknown()) }).nullable(),
      properties: props,
    })
    .strict();

const collection = <P extends z.ZodType>(props: P) =>
  z
    .object({
      type: z.literal('FeatureCollection'),
      /** 'current' = 현재 지도, 연도 또는 'future' = 시점별 지도 */
      at: z.union([z.literal('current'), z.literal('future'), z.number().int()]),
      stage_min: z.enum(codes.planStage.values).nullable(),
      include_undated: z.boolean(),
      attribution: z.string().optional(),
      features: z.array(featureSchema(props)),
    })
    .strict();

export const publicMapStationsSchema = collection(
  z
    .object({
      station_id: z.string(),
      name_ko: z.string(),
      status: z.string(),
      approximate: z.boolean(),
      /** 시점별 지도: 그 시점에 새로 생기는 역 */
      future: z.boolean(),
      plan_ids: z.array(z.string()),
      line_ids: z.array(z.string()),
    })
    .strict(),
);

export const publicMapLinesSchema = collection(
  z
    .object({
      feature_id: z.string(),
      line_id: z.string().nullable(),
      plan_id: z.string().nullable(),
      name_ko: z.string(),
      status: z.string().nullable(),
      stage: z.string().nullable(),
      line_style: z.string(),
      color: z.string().nullable(),
      color_basis: z.string(),
      quality: z.string(),
      odbl: z.boolean(),
      delayed: z.boolean(),
      target_value: z.string().nullable(),
      target_precision: z.string().nullable(),
      /** false = 여객 미취급(화물 전용) 노선 — 지도는 회색 가는 선(Q115 A) */
      passenger: z.boolean(),
    })
    .strict(),
);

export const publicMapPlansSchema = collection(
  z
    .object({
      plan_id: z.string(),
      name_ko: z.string(),
      stage: z.string(),
      line_style: z.string(),
      color: z.string().nullable(),
      quality: z.string().nullable(),
      odbl: z.boolean(),
      delayed: z.boolean(),
      undated: z.boolean(),
      target_value: z.string().nullable(),
      target_precision: z.string().nullable(),
    })
    .strict(),
);
