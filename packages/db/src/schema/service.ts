// 0007 열차 등급·운행 계통·정차 패턴
import { bigint, integer, pgTable, primaryKey, text, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { entityPk, fuzzy, meta, names, rec } from './columns';
import { line, lineStation } from './network';

export const trainClass = pgTable('train_class', {
  id: entityPk(),
  ...names({ hanja: true }),
  tier: text('tier').notNull(),
  status: text('status').notNull().default('active'),
  successorId: text('successor_id').references((): AnyPgColumn => trainClass.id, { onUpdate: 'cascade' }),
  maxSpeedKmh: integer('max_speed_kmh'),
  ...fuzzy('started'),
  ...fuzzy('ended'),
  description: text('description'),
  ...rec(),
  ...meta(),
});

export const service = pgTable('service', {
  id: entityPk(),
  ...names({ hanja: true }),
  kind: text('kind').notNull(),
  trainClassId: text('train_class_id').references(() => trainClass.id, { onUpdate: 'cascade' }),
  status: text('status').notNull(),
  color: text('color'),
  ...fuzzy('opened'),
  ...fuzzy('closed'),
  successorId: text('successor_id').references((): AnyPgColumn => service.id, { onUpdate: 'cascade' }),
  description: text('description'),
  ...rec(),
  ...meta(),
});

export const serviceLine = pgTable(
  'service_line',
  {
    serviceId: text('service_id')
      .notNull()
      .references(() => service.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    lineId: text('line_id')
      .notNull()
      .references(() => line.id, { onUpdate: 'cascade' }),
    seq: integer('seq').notNull(),
  },
  (t) => [primaryKey({ columns: [t.serviceId, t.lineId] })],
);

export const stopPattern = pgTable('stop_pattern', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  serviceId: text('service_id')
    .notNull()
    .references(() => service.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  code: text('code').notNull(),
  nameKo: text('name_ko').notNull(),
  nameEn: text('name_en'),
  type: text('type').notNull(),
  seq: integer('seq').notNull(),
  note: text('note'),
});

export const stopPatternStop = pgTable(
  'stop_pattern_stop',
  {
    patternId: bigint('pattern_id', { mode: 'number' })
      .notNull()
      .references(() => stopPattern.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    lineStationId: text('line_station_id')
      .notNull()
      .references(() => lineStation.id, { onUpdate: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.patternId, t.seq] })],
);
