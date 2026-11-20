// 0003 참조 테이블: 권역·시·도·외부 시스템
import { boolean, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { source } from './source';

export const refArea = pgTable('ref_area', {
  code: text('code').primaryKey(),
  nameKo: text('name_ko').notNull(),
  nameEn: text('name_en'),
  ord: integer('ord').notNull(),
});

export const refRegion = pgTable('ref_region', {
  code: text('code').primaryKey(),
  nameKo: text('name_ko').notNull().unique(),
  shortKo: text('short_ko').notNull(),
  slug: text('slug').notNull().unique(),
  areaCode: text('area_code')
    .notNull()
    .references(() => refArea.code),
  ord: integer('ord').notNull(),
});

export const refExternalSystem = pgTable('ref_external_system', {
  code: text('code').primaryKey(),
  nameKo: text('name_ko').notNull(),
  // FK 는 0004 에서 추가
  sourceId: text('source_id').references(() => source.id, { onUpdate: 'cascade' }),
  entityType: text('entity_type').notNull(),
  multiPerEntity: boolean('multi_per_entity').notNull().default(true),
  multiEntityPerCode: boolean('multi_entity_per_code').notNull().default(false),
  note: text('note'),
});
