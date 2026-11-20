// 0011 OSM(ODbL) — 자체 데이터와 분리된 osm 스키마
import { bigint, boolean, integer, jsonb, pgSchema, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { tstz } from './columns';
import { geometryLineString, numericArray } from './types';

export const osmSchema = pgSchema('osm');

export const osmExtract = osmSchema.table('extract', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  kind: text('kind').notNull(),
  bbox: numericArray('bbox'),
  fetchedAt: timestamp('fetched_at', tstz).notNull(),
  overpassQuery: text('overpass_query'),
  sha256: text('sha256'),
  note: text('note'),
});

export const osmWay = osmSchema.table('way', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  extractId: bigint('extract_id', { mode: 'number' }).references(() => osmExtract.id),
  tags: jsonb('tags').$type<Record<string, string>>().notNull(),
  isConstruction: boolean('is_construction').notNull(),
  geom: geometryLineString('geom').notNull(),
});

export const osmRelation = osmSchema.table('relation', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  extractId: bigint('extract_id', { mode: 'number' }).references(() => osmExtract.id),
  tags: jsonb('tags').$type<Record<string, string>>().notNull(),
});

export const osmRelationMember = osmSchema.table(
  'relation_member',
  {
    relationId: bigint('relation_id', { mode: 'number' })
      .notNull()
      .references(() => osmRelation.id, { onDelete: 'cascade' }),
    wayId: bigint('way_id', { mode: 'number' }).notNull(),
    role: text('role'),
    seq: integer('seq').notNull(),
  },
  (t) => [primaryKey({ columns: [t.relationId, t.seq] })],
);
