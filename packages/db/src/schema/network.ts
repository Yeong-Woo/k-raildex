// 0006 운영기관·역·노선·노선역
import {
  bigint,
  boolean,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { entityPk, fuzzy, meta, names, rec } from './columns';
import { refRegion } from './reference';
import { geographyPoint, numericArray } from './types';

export const operator = pgTable('operator', {
  id: entityPk(),
  ...names(),
  shortKo: text('short_ko'),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  mergedIntoId: text('merged_into_id').references((): AnyPgColumn => operator.id, { onUpdate: 'cascade' }),
  ...fuzzy('founded'),
  ...fuzzy('ended'),
  homepage: text('homepage'),
  ...rec(),
  ...meta(),
});

export const station = pgTable('station', {
  id: entityPk(),
  ...names({ hanja: true }),
  kind: text('kind').notNull().default('station'),
  regionCode: text('region_code').references(() => refRegion.code),
  regionBasis: text('region_basis'),
  address: text('address'),
  geom: geographyPoint('geom'),
  coordSource: text('coord_source'),
  coordBasis: text('coord_basis'),
  coordQuery: text('coord_query'),
  coordSameAsId: text('coord_same_as_id').references((): AnyPgColumn => station.id, { onUpdate: 'cascade' }),
  coordNote: text('coord_note'),
  grade: text('grade'),
  historyText: text('history_text'),
  introText: text('intro_text'),
  mergeIntoId: text('merge_into_id').references((): AnyPgColumn => station.id, { onUpdate: 'cascade' }),
  ownStatus: text('own_status'),
  ...fuzzy('own_opened'),
  ...fuzzy('own_closed'),
  ...rec(),
  ...meta(),
});

export const line = pgTable('line', {
  id: entityPk(),
  ...names({ hanja: true }),
  category: text('category').notNull(),
  railClass: text('rail_class').notNull(),
  isWideArea: boolean('is_wide_area'),
  wideAreaNote: text('wide_area_note'),
  passengerService: boolean('passenger_service').notNull().default(true),
  lineRole: text('line_role'),
  status: text('status').notNull(),
  owner: text('owner'),
  startStationId: text('start_station_id').references(() => station.id, { onUpdate: 'cascade' }),
  endStationId: text('end_station_id').references(() => station.id, { onUpdate: 'cascade' }),
  lengthKm: numeric('length_km', { mode: 'number' }),
  ...fuzzy('opened'),
  ...fuzzy('closed'),
  track: text('track'),
  electrification: text('electrification'),
  gaugeMm: integer('gauge_mm'),
  designSpeedKmh: integer('design_speed_kmh'),
  color: text('color'),
  description: text('description'),
  parentLineId: text('parent_line_id').references((): AnyPgColumn => line.id, { onUpdate: 'cascade' }),
  ...rec(),
  ...meta(),
});

export const lineRegion = pgTable(
  'line_region',
  {
    lineId: text('line_id')
      .notNull()
      .references(() => line.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    regionCode: text('region_code')
      .notNull()
      .references(() => refRegion.code),
  },
  (t) => [primaryKey({ columns: [t.lineId, t.regionCode] })],
);

export const lineOperator = pgTable(
  'line_operator',
  {
    lineId: text('line_id')
      .notNull()
      .references(() => line.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    operatorId: text('operator_id')
      .notNull()
      .references(() => operator.id, { onUpdate: 'cascade' }),
    role: text('role').notNull().default('operator'),
    ord: integer('ord').notNull().default(0),
    note: text('note'),
  },
  (t) => [primaryKey({ columns: [t.lineId, t.operatorId, t.role] })],
);

export const lineOsmMap = pgTable('line_osm_map', {
  lineId: text('line_id')
    .primaryKey()
    .references(() => line.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  relationIds: bigint('relation_ids', { mode: 'number' })
    .array()
    .notNull()
    .default(sql`'{}'`),
  wayNames: text('way_names')
    .array()
    .notNull()
    .default(sql`'{}'`),
  bbox: numericArray('bbox'),
  priority: integer('priority').notNull().default(0),
  includeConstruction: boolean('include_construction').notNull().default(true),
  wayIds: bigint('way_ids', { mode: 'number' })
    .array()
    .notNull()
    .default(sql`'{}'`),
  shareWith: text('share_with')
    .array()
    .notNull()
    .default(sql`'{}'`),
  connectTerminals: boolean('connect_terminals').notNull().default(false),
  note: text('note'),
});

export const lineStation = pgTable('line_station', {
  id: entityPk(),
  lineId: text('line_id')
    .notNull()
    .references(() => line.id, { onUpdate: 'cascade' }),
  stationId: text('station_id')
    .notNull()
    .references(() => station.id, { onUpdate: 'cascade' }),
  seq: integer('seq').notNull(),
  branch: text('branch'),
  km: numeric('km', { precision: 7, scale: 2, mode: 'number' }),
  stationCode: text('station_code'),
  orderConfirmed: boolean('order_confirmed').notNull().default(true),
  /** V-S04 거리 확인: 확인할 때의 앞 노선역 id(0030) */
  gapConfirmedPrevId: text('gap_confirmed_prev_id'),
  nameKo: text('name_ko'),
  nameEn: text('name_en'),
  operatorId: text('operator_id').references(() => operator.id, { onUpdate: 'cascade' }),
  /** 한국철도공사 정거장 등급·관리역(0032 — 코레일 노선역만, V-H18) */
  korailClass: text('korail_class'),
  korailMgmtGrade: smallint('korail_mgmt_grade'),
  managedById: text('managed_by_id').references((): AnyPgColumn => lineStation.id, { onUpdate: 'cascade' }),
  status: text('status').notNull(),
  ...fuzzy('opened'),
  ...fuzzy('closed'),
  geom: geographyPoint('geom'),
  note: text('note'),
  ...meta(),
});
