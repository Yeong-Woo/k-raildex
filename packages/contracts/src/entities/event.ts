/** 연표 이벤트 event (docs/03-data-model.md 4-12절) + event_target·event_area */
import { z } from 'zod';
import { fuzzyDateSchema } from '../fuzzy-date';
import { codes } from '../codes';
import { idSchema } from '../ids';
import {
  anyEntityIdSchema,
  areaCodeSchema,
  checkUnique,
  curatedFields,
  defineContract,
  keyBy,
  optText,
  recReadFields,
} from './common';

export const eventTargetRoleValues = ['subject', 'related'] as const;

/** 이벤트 대상 event_target(역·노선·운행 계통·계획 등) */
export const eventTargetSchema = z
  .object({
    entity_id: anyEntityIdSchema,
    role: z.enum(eventTargetRoleValues).default('subject'),
  })
  .strict();
export type EventTarget = z.infer<typeof eventTargetSchema>;

const shape = {
  id: idSchema('event'),
  type: z.enum(codes.eventType.values),
  date: fuzzyDateSchema,
  title: z.string().min(1),
  note: optText(),
  origin: z.enum(codes.eventOrigin.values),
  ...curatedFields,
  targets: z.array(eventTargetSchema).default([]),
  area_codes: z.array(areaCodeSchema).default([]),
};

const contract = defineContract(shape, recReadFields, (row, ctx) => {
  checkUnique(row, ctx, 'targets', keyBy('entity_id'));
  checkUnique(row, ctx, 'area_codes');
});

export const EventCreateSchema = contract.create;
export const EventUpdateSchema = contract.update;
export const EventReadSchema = contract.read;
export type EventCreate = z.infer<typeof EventCreateSchema>;
export type EventUpdate = z.infer<typeof EventUpdateSchema>;
export type EventRead = z.infer<typeof EventReadSchema>;
