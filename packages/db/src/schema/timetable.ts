// 0010 계획 시간표. 04시 이전은 24~27시(1440~1679분)
import { bigint, pgTable, primaryKey, smallint, text } from 'drizzle-orm/pg-core';
import { lineStation, station } from './network';
import { service } from './service';
import { source } from './source';

export const timetableSet = pgTable('timetable_set', {
  id: text('id').primaryKey(),
  stationId: text('station_id')
    .notNull()
    .references(() => station.id, { onUpdate: 'cascade' }),
  lineStationId: text('line_station_id').references(() => lineStation.id, { onUpdate: 'cascade' }),
  serviceId: text('service_id').references(() => service.id, { onUpdate: 'cascade' }),
  routeCode: text('route_code').notNull(),
  dayType: text('day_type').notNull(),
  direction: text('direction').notNull(),
  directionLabel: text('direction_label'),
  dayNote: text('day_note'),
  dataAsOf: text('data_as_of'),
  sourceId: text('source_id')
    .notNull()
    .references(() => source.id, { onUpdate: 'cascade' }),
  importRunId: bigint('import_run_id', { mode: 'number' }),
});

export const timetableEntry = pgTable(
  'timetable_entry',
  {
    setId: text('set_id')
      .notNull()
      .references(() => timetableSet.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    minute: smallint('minute').notNull(),
    destName: text('dest_name'),
    destStationId: text('dest_station_id').references(() => station.id, { onUpdate: 'cascade' }),
    trainNo: text('train_no').notNull().default(''),
    note: text('note'),
  },
  (t) => [primaryKey({ columns: [t.setId, t.minute, t.trainNo] })],
);
