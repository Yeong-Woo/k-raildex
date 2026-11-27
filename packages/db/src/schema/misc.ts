// 0009 연표·열차번호대·차량번호대·환승센터·노선도·용어
import { bigint, integer, numeric, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { entityPk, fuzzy, meta, names, rec } from './columns';
import { geographyPoint } from './types';
import { line, operator, station } from './network';
import { plan, planProgram } from './plan';
import { refArea, refRegion } from './reference';
import { service, trainClass } from './service';
import { document, source } from './source';
import { entity } from './system';

const sourceIdRequired = () =>
  text('source_id')
    .notNull()
    .references(() => source.id, { onUpdate: 'cascade' });

export const event = pgTable('event', {
  id: entityPk(),
  type: text('type').notNull(),
  ...fuzzy('date', { required: true }),
  title: text('title').notNull(),
  note: text('note'),
  origin: text('origin').notNull(),
  ...rec(),
  ...meta(),
});

export const eventTarget = pgTable(
  'event_target',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    entityId: text('entity_id')
      .notNull()
      .references(() => entity.id, { onUpdate: 'cascade' }),
    role: text('role').notNull().default('subject'),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.entityId] })],
);

export const eventArea = pgTable(
  'event_area',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    areaCode: text('area_code')
      .notNull()
      .references(() => refArea.code),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.areaCode] })],
);

export const trainNumberRange = pgTable('train_number_range', {
  id: entityPk(),
  operatorId: text('operator_id')
    .notNull()
    .references(() => operator.id, { onUpdate: 'cascade' }),
  codePrefix: text('code_prefix'),
  rangeFrom: integer('range_from').notNull(),
  rangeTo: integer('range_to').notNull(),
  group: text('group').notNull(),
  trainClassId: text('train_class_id').references(() => trainClass.id, { onUpdate: 'cascade' }),
  routeText: text('route_text'),
  parityRule: text('parity_rule'),
  ...fuzzy('valid_from'),
  ...fuzzy('valid_to'),
  note: text('note'),
  ...rec(),
  ...meta(),
});

export const trainNumberRangeService = pgTable(
  'train_number_range_service',
  {
    rangeId: text('range_id')
      .notNull()
      .references(() => trainNumberRange.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => service.id, { onUpdate: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.rangeId, t.serviceId] })],
);

export const trainNumberRangeLine = pgTable(
  'train_number_range_line',
  {
    rangeId: text('range_id')
      .notNull()
      .references(() => trainNumberRange.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    lineId: text('line_id')
      .notNull()
      .references(() => line.id, { onUpdate: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.rangeId, t.lineId] })],
);

export const rollingStockRange = pgTable('rolling_stock_range', {
  id: entityPk(),
  operatorId: text('operator_id')
    .notNull()
    .references(() => operator.id, { onUpdate: 'cascade' }),
  series: text('series').notNull(),
  numberPrefix: text('number_prefix'),
  numberFrom: integer('number_from').notNull(),
  numberTo: integer('number_to').notNull(),
  digits: integer('digits').notNull(),
  group: text('group').notNull(),
  model: text('model'),
  trainClassId: text('train_class_id').references(() => trainClass.id, { onUpdate: 'cascade' }),
  numberRule: text('number_rule'),
  status: text('status').notNull(),
  ...fuzzy('introduced'),
  ...fuzzy('retired'),
  ownerNote: text('owner_note'),
  formationLabel: text('formation_label'),
  formationFrom: text('formation_from'),
  formationTo: text('formation_to'),
  formationCount: integer('formation_count'),
  formationCars: integer('formation_cars'),
  formationCodePrefix: text('formation_code_prefix'),
  formationNote: text('formation_note'),
  note: text('note'),
  ...rec(),
  ...meta(),
});

export const rollingStockRangeService = pgTable(
  'rolling_stock_range_service',
  {
    rangeId: text('range_id')
      .notNull()
      .references(() => rollingStockRange.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => service.id, { onUpdate: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.rangeId, t.serviceId] })],
);

export const rollingStockRangeLine = pgTable(
  'rolling_stock_range_line',
  {
    rangeId: text('range_id')
      .notNull()
      .references(() => rollingStockRange.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    lineId: text('line_id')
      .notNull()
      .references(() => line.id, { onUpdate: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.rangeId, t.lineId] })],
);

export const transferCenter = pgTable('transfer_center', {
  id: entityPk(),
  ...names(),
  kind: text('kind').notNull(),
  regionCode: text('region_code').references(() => refRegion.code),
  areaCode: text('area_code').references(() => refArea.code),
  status: text('status').notNull(),
  ...fuzzy('status_as_of'),
  statusSourceId: text('status_source_id')
    .notNull()
    .references(() => source.id, { onUpdate: 'cascade' }),
  description: text('description'),
  ...rec(),
  ...meta(),
});

const centerIdCascade = () =>
  text('center_id')
    .notNull()
    .references(() => transferCenter.id, { onDelete: 'cascade', onUpdate: 'cascade' });

export const transferCenterPlanRef = pgTable('transfer_center_plan_ref', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  centerId: centerIdCascade(),
  programId: text('program_id')
    .notNull()
    .references(() => planProgram.id, { onUpdate: 'cascade' }),
  class: text('class').notNull(),
  nameRaw: text('name_raw').notNull(),
  cost100mKrw: numeric('cost_100m_krw', { precision: 12, scale: 1, mode: 'number' }),
  railNow: text('rail_now'),
  railFuture: text('rail_future'),
  page: text('page'),
  note: text('note'),
  sourceId: sourceIdRequired(),
  seq: integer('seq').notNull(),
});

export const transferCenterStatusEvent = pgTable('transfer_center_status_event', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  centerId: centerIdCascade(),
  status: text('status').notNull(),
  ...fuzzy('date', { required: true }),
  note: text('note'),
  sourceId: sourceIdRequired(),
});

export const transferCenterStation = pgTable(
  'transfer_center_station',
  {
    centerId: centerIdCascade(),
    stationId: text('station_id')
      .notNull()
      .references(() => station.id, { onUpdate: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.centerId, t.stationId] })],
);

export const transferCenterPlan = pgTable(
  'transfer_center_plan',
  {
    centerId: centerIdCascade(),
    planId: text('plan_id')
      .notNull()
      .references(() => plan.id, { onUpdate: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.centerId, t.planId] })],
);

export const routeMap = pgTable('route_map', {
  id: entityPk(),
  titleKo: text('title_ko').notNull(),
  titleEn: text('title_en'),
  publisher: text('publisher').notNull(),
  region: text('region'),
  mode: text('mode').notNull(),
  documentId: uuid('document_id').references(() => document.id),
  url: text('url').notNull(),
  license: text('license').notNull(),
  attribution: text('attribution').notNull(),
  asOf: text('as_of'),
  width: integer('width'),
  height: integer('height'),
  ...rec(),
  ...meta(),
});

export const glossaryTerm = pgTable('glossary_term', {
  id: entityPk(),
  termKo: text('term_ko').notNull(),
  termEn: text('term_en'),
  section: text('section').notNull(),
  definition: text('definition').notNull(),
  basis: text('basis'),
  example: text('example'),
  caution: text('caution'),
  ord: integer('ord').notNull(),
  ...rec(),
  ...meta(),
});

/** 시설(차량기지 등, 0035) */
export const facility = pgTable('facility', {
  id: entityPk(),
  ...names(),
  kind: text('kind').notNull().default('depot'),
  functions: text('functions')
    .array()
    .notNull()
    .default(sql`'{}'`),
  operatorId: text('operator_id').references(() => operator.id, { onUpdate: 'cascade' }),
  status: text('status').notNull().default('operating'),
  ...fuzzy('opened'),
  ...fuzzy('closed'),
  regionCode: text('region_code').references(() => refRegion.code),
  address: text('address'),
  geom: geographyPoint('geom'),
  coordSource: text('coord_source'),
  coordBasis: text('coord_basis'),
  coordQuery: text('coord_query'),
  coordNote: text('coord_note'),
  description: text('description'),
  ...rec(),
  ...meta(),
});

/** 시설 ↔ 노선(serves 담당 노선 / connects 붙은 선로, 0035) */
export const facilityLine = pgTable(
  'facility_line',
  {
    facilityId: text('facility_id')
      .notNull()
      .references(() => facility.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    lineId: text('line_id')
      .notNull()
      .references(() => line.id, { onUpdate: 'cascade' }),
    role: text('role').notNull().default('serves'),
    note: text('note'),
    ord: integer('ord').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.facilityId, t.lineId, t.role] })],
);
