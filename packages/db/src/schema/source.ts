// 0004 출처·원문 문서 (+ 0002 change_evidence: document FK 때문에 여기 둔다)
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { dateStr, fuzzy, meta, rec, tstz } from './columns';
import { appUser, changeset, entity } from './system';
import { numericArray, tsvector } from './types';

export const source = pgTable('source', {
  id: text('id')
    .primaryKey()
    .references(() => entity.id, { onUpdate: 'cascade' }),
  title: text('title').notNull(),
  publisher: text('publisher').notNull(),
  type: text('type').notNull(),
  url: text('url'),
  license: text('license').notNull(),
  licenseClass: text('license_class').notNull(),
  attribution: text('attribution'),
  ...fuzzy('published'),
  publishedRaw: text('published_raw'),
  dataAsOf: text('data_as_of'),
  retrievedAt: date('retrieved_at', dateStr).notNull(),
  refresh: text('refresh'),
  noticeNumber: text('notice_number'),
  datasetKey: text('dataset_key'),
  download: jsonb('download'),
  note: text('note'),
  ...rec(),
  ...meta(),
});

export const document = pgTable('document', {
  id: uuid('id').primaryKey().defaultRandom(),
  storageKey: text('storage_key').notNull().unique(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  originUrl: text('origin_url'),
  retrievedAt: timestamp('retrieved_at', tstz),
  kind: text('kind').notNull(),
  parentDocumentId: uuid('parent_document_id').references((): AnyPgColumn => document.id),
  page: integer('page'),
  bbox: numericArray('bbox'),
  licenseClass: text('license_class').notNull(),
  publishable: boolean('publishable').notNull().default(false),
  textContent: text('text_content'),
  textTsv: tsvector('text_tsv'),
  pages: integer('pages'),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', tstz).notNull().defaultNow(),
  createdBy: uuid('created_by').references(() => appUser.id),
  deletedAt: timestamp('deleted_at', tstz),
});

export const sourceDocument = pgTable(
  'source_document',
  {
    sourceId: text('source_id')
      .notNull()
      .references(() => source.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => document.id),
    role: text('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.documentId] })],
);

export const changeEvidence = pgTable('change_evidence', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  changesetId: text('changeset_id')
    .notNull()
    .references(() => changeset.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  opSeq: integer('op_seq'),
  documentId: uuid('document_id').references(() => document.id),
  url: text('url'),
  quote: text('quote').notNull(),
  locator: text('locator'),
  confidence: numeric('confidence', { precision: 3, scale: 2, mode: 'number' }),
  note: text('note'),
});
