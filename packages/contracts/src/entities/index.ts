/**
 * 개체 계약(zod) — docs/03-data-model.md 4절. 개체마다 Create·Update·Read 계약을 둔다.
 */
import type { EntityType } from '../ids';
import type { ContractSet } from './common';
import { EventCreateSchema, EventReadSchema, EventUpdateSchema } from './event';
import { FacilityCreateSchema, FacilityReadSchema, FacilityUpdateSchema } from './facility';
import { GlossaryTermCreateSchema, GlossaryTermReadSchema, GlossaryTermUpdateSchema } from './glossary-term';
import { LineCreateSchema, LineReadSchema, LineUpdateSchema } from './line';
import { LineStationCreateSchema, LineStationReadSchema, LineStationUpdateSchema } from './line-station';
import { OperatorCreateSchema, OperatorReadSchema, OperatorUpdateSchema } from './operator';
import { PlanCreateSchema, PlanReadSchema, PlanUpdateSchema } from './plan';
import { PlanProgramCreateSchema, PlanProgramReadSchema, PlanProgramUpdateSchema } from './plan-program';
import {
  RollingStockRangeCreateSchema,
  RollingStockRangeReadSchema,
  RollingStockRangeUpdateSchema,
} from './rolling-stock-range';
import { RouteMapCreateSchema, RouteMapReadSchema, RouteMapUpdateSchema } from './route-map';
import { ServiceCreateSchema, ServiceReadSchema, ServiceUpdateSchema } from './service';
import { SourceCreateSchema, SourceReadSchema, SourceUpdateSchema } from './source';
import { StationCreateSchema, StationReadSchema, StationUpdateSchema } from './station';
import { TrainClassCreateSchema, TrainClassReadSchema, TrainClassUpdateSchema } from './train-class';
import {
  TrainNumberRangeCreateSchema,
  TrainNumberRangeReadSchema,
  TrainNumberRangeUpdateSchema,
} from './train-number-range';
import { TransferCenterCreateSchema, TransferCenterReadSchema, TransferCenterUpdateSchema } from './transfer-center';

export {
  anyEntityIdSchema,
  areaCodeSchema,
  attachmentSchema,
  bboxSchema,
  colorSchema,
  curatedFields,
  dateSchema,
  defineContract,
  entityNameSchema,
  externalRefSchema,
  metaReadFields,
  multiLineStringSchema,
  nameFields,
  nameFieldsNoHanja,
  nameRefFields,
  pointSchema,
  recFields,
  recReadFields,
  regionCodeSchema,
  sourceLinkSchema,
  timestampSchema,
  updateShapeOf,
  uuidSchema,
  type Attachment,
  type ContractSet,
  type EntityName,
  type ExternalRef,
  type MultiLineString,
  type Point,
  type SourceLink,
} from './common';
export * from './source';
export * from './operator';
export * from './station';
export * from './line-station';
export * from './line';
export * from './train-class';
export * from './service';
export * from './plan-program';
export * from './plan';
export * from './event';
export * from './train-number-range';
export * from './rolling-stock-range';
export * from './transfer-center';
export * from './route-map';
export * from './glossary-term';
export * from './facility';
export * from './document';
export * from './timetable';

/** 개체 종류 → 계약. document·timetable_set 은 개체가 아니므로 따로 export 한다 */
export const entityContracts = {
  source: { create: SourceCreateSchema, update: SourceUpdateSchema, read: SourceReadSchema },
  operator: { create: OperatorCreateSchema, update: OperatorUpdateSchema, read: OperatorReadSchema },
  station: { create: StationCreateSchema, update: StationUpdateSchema, read: StationReadSchema },
  line_station: { create: LineStationCreateSchema, update: LineStationUpdateSchema, read: LineStationReadSchema },
  line: { create: LineCreateSchema, update: LineUpdateSchema, read: LineReadSchema },
  train_class: { create: TrainClassCreateSchema, update: TrainClassUpdateSchema, read: TrainClassReadSchema },
  service: { create: ServiceCreateSchema, update: ServiceUpdateSchema, read: ServiceReadSchema },
  plan_program: { create: PlanProgramCreateSchema, update: PlanProgramUpdateSchema, read: PlanProgramReadSchema },
  plan: { create: PlanCreateSchema, update: PlanUpdateSchema, read: PlanReadSchema },
  event: { create: EventCreateSchema, update: EventUpdateSchema, read: EventReadSchema },
  train_number_range: {
    create: TrainNumberRangeCreateSchema,
    update: TrainNumberRangeUpdateSchema,
    read: TrainNumberRangeReadSchema,
  },
  rolling_stock_range: {
    create: RollingStockRangeCreateSchema,
    update: RollingStockRangeUpdateSchema,
    read: RollingStockRangeReadSchema,
  },
  transfer_center: {
    create: TransferCenterCreateSchema,
    update: TransferCenterUpdateSchema,
    read: TransferCenterReadSchema,
  },
  route_map: { create: RouteMapCreateSchema, update: RouteMapUpdateSchema, read: RouteMapReadSchema },
  glossary_term: { create: GlossaryTermCreateSchema, update: GlossaryTermUpdateSchema, read: GlossaryTermReadSchema },
  facility: { create: FacilityCreateSchema, update: FacilityUpdateSchema, read: FacilityReadSchema },
} as const satisfies Record<EntityType, ContractSet>;

export type EntityContracts = typeof entityContracts;
