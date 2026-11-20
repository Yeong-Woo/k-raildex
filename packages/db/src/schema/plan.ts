// 0008 상위 계획·계획 사업
import { bigint, boolean, integer, numeric, pgTable, primaryKey, text, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { entityPk, fuzzy, meta, names, rec } from './columns';
import { line, lineStation, station } from './network';
import { refRegion } from './reference';
import { source } from './source';
import { geometryMultiLineString } from './types';

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const sourceIdRequired = () =>
  text('source_id')
    .notNull()
    .references(() => source.id, { onUpdate: 'cascade' });

export const planProgram = pgTable('plan_program', {
  id: entityPk(),
  ...names(),
  kind: text('kind').notNull(),
  short: text('short').notNull(),
  round: integer('round'),
  regionCode: text('region_code').references(() => refRegion.code),
  periodFrom: integer('period_from'),
  periodTo: integer('period_to'),
  issuer: text('issuer'),
  legalBasis: text('legal_basis'),
  status: text('status').notNull(),
  parentId: text('parent_id').references((): AnyPgColumn => planProgram.id, { onUpdate: 'cascade' }),
  summary: text('summary'),
  documentNote: text('document_note'),
  ord: integer('ord').notNull(),
  ...rec(),
  ...meta(),
});

const programIdCascade = () =>
  text('program_id')
    .notNull()
    .references(() => planProgram.id, { onDelete: 'cascade', onUpdate: 'cascade' });

export const planProgramNotice = pgTable('plan_program_notice', {
  id: id(),
  programId: programIdCascade(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  number: text('number'),
  ...fuzzy('date', { required: true }),
  note: text('note'),
  sourceId: sourceIdRequired(),
  seq: integer('seq').notNull(),
});

export const planProgramPoint = pgTable(
  'plan_program_point',
  {
    programId: programIdCascade(),
    seq: integer('seq').notNull(),
    text: text('text').notNull(),
  },
  (t) => [primaryKey({ columns: [t.programId, t.seq] })],
);

export const planProgramFigure = pgTable(
  'plan_program_figure',
  {
    programId: programIdCascade(),
    seq: integer('seq').notNull(),
    label: text('label').notNull(),
    value: text('value').notNull(),
    sourceId: text('source_id').references(() => source.id, { onUpdate: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.programId, t.seq] })],
);

export const plan = pgTable('plan', {
  id: entityPk(),
  ...names(),
  scope: text('scope').notNull().default('line'),
  ...fuzzy('opened'),
  operatorText: text('operator_text'),
  description: text('description'),
  isNational: boolean('is_national').notNull().default(false),
  stageOverride: text('stage_override'),
  color: text('color'),
  ...rec(),
  ...meta(),
});

const planIdCascade = () =>
  text('plan_id')
    .notNull()
    .references(() => plan.id, { onDelete: 'cascade', onUpdate: 'cascade' });

export const planRef = pgTable('plan_ref', {
  id: id(),
  planId: planIdCascade(),
  programId: text('program_id')
    .notNull()
    .references(() => planProgram.id, { onUpdate: 'cascade' }),
  edition: text('edition'),
  timing: text('timing'),
  class: text('class').notNull(),
  category: text('category'),
  section: text('section'),
  content: text('content'),
  lengthKm: numeric('length_km', { precision: 8, scale: 2, mode: 'number' }),
  cost100mKrw: numeric('cost_100m_krw', { precision: 12, scale: 1, mode: 'number' }),
  taskGroup: text('task_group'),
  sourceId: sourceIdRequired(),
  locator: text('locator'),
  seq: integer('seq').notNull(),
});

export const planStageEvent = pgTable('plan_stage_event', {
  id: id(),
  planId: planIdCascade(),
  stage: text('stage').notNull(),
  kind: text('kind').notNull().default('reached'),
  ...fuzzy('date', { required: true }),
  note: text('note'),
  sourceId: sourceIdRequired(),
  origin: text('origin').notNull().default('manual'),
});

export const planMilestone = pgTable('plan_milestone', {
  id: id(),
  planId: planIdCascade(),
  stage: text('stage').notNull(),
  ...fuzzy('expected', { required: true }),
  basis: text('basis').notNull(),
  ...fuzzy('as_of'),
  sourceId: text('source_id').references(() => source.id, { onUpdate: 'cascade' }),
  note: text('note'),
});

export const planLine = pgTable(
  'plan_line',
  {
    planId: planIdCascade(),
    lineId: text('line_id')
      .notNull()
      .references(() => line.id, { onUpdate: 'cascade' }),
    role: text('role').notNull().default('new'),
    fromLineStationId: text('from_line_station_id').references(() => lineStation.id, { onUpdate: 'cascade' }),
    toLineStationId: text('to_line_station_id').references(() => lineStation.id, { onUpdate: 'cascade' }),
    note: text('note'),
  },
  (t) => [primaryKey({ columns: [t.planId, t.lineId, t.role] })],
);

export const planStation = pgTable(
  'plan_station',
  {
    planId: planIdCascade(),
    stationId: text('station_id')
      .notNull()
      .references(() => station.id, { onUpdate: 'cascade' }),
    role: text('role').notNull().default('new'),
  },
  (t) => [primaryKey({ columns: [t.planId, t.stationId] })],
);

export const planRegion = pgTable(
  'plan_region',
  {
    planId: planIdCascade(),
    regionCode: text('region_code')
      .notNull()
      .references(() => refRegion.code),
  },
  (t) => [primaryKey({ columns: [t.planId, t.regionCode] })],
);

export const planRelation = pgTable('plan_relation', {
  id: id(),
  planId: planIdCascade(),
  targetPlanId: text('target_plan_id')
    .notNull()
    .references(() => plan.id, { onUpdate: 'cascade' }),
  relation: text('relation').notNull(),
  note: text('note'),
  sourceId: sourceIdRequired(),
});

export const planGeometry = pgTable('plan_geometry', {
  id: id(),
  planId: planIdCascade(),
  kind: text('kind').notNull(),
  viaStationIds: text('via_station_ids').array(),
  geom: geometryMultiLineString('geom'),
  accuracyM: integer('accuracy_m'),
  methodNote: text('method_note'),
  sourceId: sourceIdRequired(),
  note: text('note'),
  ...meta(),
});

export const planWatchKeyword = pgTable(
  'plan_watch_keyword',
  {
    planId: planIdCascade(),
    keyword: text('keyword').notNull(),
  },
  (t) => [primaryKey({ columns: [t.planId, t.keyword] })],
);
