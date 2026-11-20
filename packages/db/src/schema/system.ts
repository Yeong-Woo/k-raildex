// 0002 시스템·감사·전역 개체 레지스트리
import {
  bigint,
  boolean,
  integer,
  json,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const tstz = { withTimezone: true, mode: 'string' } as const;

export const appUser = pgTable('app_user', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  email: text('email').unique(),
  displayName: text('display_name').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', tstz).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', tstz),
});

export const apiToken = pgTable('api_token', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => appUser.id),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  scopes: text('scopes').array().notNull(),
  createdAt: timestamp('created_at', tstz).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', tstz),
  lastUsedAt: timestamp('last_used_at', tstz),
  revokedAt: timestamp('revoked_at', tstz),
});

export const changeset = pgTable('changeset', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  rationale: text('rationale'),
  origin: text('origin').notNull(),
  status: text('status').notNull(),
  authorId: uuid('author_id')
    .notNull()
    .references(() => appUser.id),
  submittedAt: timestamp('submitted_at', tstz).notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at', tstz),
  appliedAt: timestamp('applied_at', tstz),
  reviewComment: text('review_comment'),
  error: text('error'),
  baseDataVersion: bigint('base_data_version', { mode: 'number' }),
  revertsChangesetId: text('reverts_changeset_id').references((): AnyPgColumn => changeset.id),
  body: json('body'),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
});

export const changeOp = pgTable('change_op', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  changesetId: text('changeset_id')
    .notNull()
    .references(() => changeset.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  seq: integer('seq').notNull(),
  op: text('op').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  payload: jsonb('payload').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
});

// change_evidence 는 document FK 때문에 source.ts 에 둔다(순환 import 방지).

export const dataVersion = pgTable('data_version', {
  version: bigint('version', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  changesetId: text('changeset_id').references(() => changeset.id, { onUpdate: 'cascade' }),
  committedAt: timestamp('committed_at', tstz).notNull().defaultNow(),
  entityIds: text('entity_ids').array().notNull(),
});

export const appSetting = pgTable('app_setting', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', tstz).notNull().defaultNow(),
});

export const entity = pgTable('entity', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  createdAt: timestamp('created_at', tstz).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', tstz),
});

export const idRedirect = pgTable('id_redirect', {
  oldId: text('old_id').primaryKey(),
  newId: text('new_id')
    .notNull()
    .references(() => entity.id, { onUpdate: 'cascade' }),
  changedAt: timestamp('changed_at', tstz).notNull().defaultNow(),
  reason: text('reason'),
});
