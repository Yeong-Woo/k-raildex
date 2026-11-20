// 0005 공통 연결: 별칭·외부 코드·출처 연결·첨부
import { bigint, boolean, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { fuzzy, meta } from './columns';
import { refExternalSystem } from './reference';
import { document, source } from './source';
import { entity } from './system';

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const entityId = () =>
  text('entity_id')
    .notNull()
    .references(() => entity.id, { onDelete: 'cascade', onUpdate: 'cascade' });
const sourceId = () => text('source_id').references(() => source.id, { onUpdate: 'cascade' });

export const entityName = pgTable('entity_name', {
  id: id(),
  entityId: entityId(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  lang: text('lang').notNull().default('ko'),
  ...fuzzy('valid_from'),
  ...fuzzy('valid_to'),
  sourceId: sourceId(),
  note: text('note'),
  ord: integer('ord').notNull().default(0),
});

export const externalRef = pgTable('external_ref', {
  id: id(),
  entityId: entityId(),
  system: text('system')
    .notNull()
    .references(() => refExternalSystem.code, { onUpdate: 'cascade' }),
  code: text('code').notNull(),
  label: text('label'),
  isPrimary: boolean('is_primary').notNull().default(false),
  sourceId: sourceId(),
  note: text('note'),
});

export const recordSource = pgTable('record_source', {
  id: id(),
  entityId: entityId(),
  sourceId: text('source_id')
    .notNull()
    .references(() => source.id, { onUpdate: 'cascade' }),
  field: text('field'),
  locator: text('locator'),
  note: text('note'),
  ord: integer('ord').notNull().default(0),
});

export const entityAttachment = pgTable('entity_attachment', {
  id: id(),
  entityId: entityId(),
  kind: text('kind').notNull(),
  title: text('title'),
  quote: text('quote'),
  url: text('url'),
  documentId: uuid('document_id').references(() => document.id),
  page: integer('page'),
  sourceId: sourceId(),
  isPublic: boolean('is_public').notNull().default(false),
  origin: text('origin').notNull().default('manual'),
  ord: integer('ord').notNull().default(0),
  ...meta(),
});
