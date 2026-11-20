// 0011 수집기·외부 API 탐색기 — ingest 스키마
import {
  bigint,
  date,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { dateStr, meta, tstz } from './columns';
import { refExternalSystem } from './reference';
import { document, source } from './source';
import { entity } from './system';
import { bytea } from './types';

export const ingestSchema = pgSchema('ingest');

export const ingestRun = ingestSchema.table('run', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  task: text('task').notNull(),
  trigger: text('trigger').notNull(),
  status: text('status').notNull(),
  startedAt: timestamp('started_at', tstz),
  finishedAt: timestamp('finished_at', tstz),
  params: jsonb('params'),
  stats: jsonb('stats'),
  model: text('model'),
  promptVersion: text('prompt_version'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 4, mode: 'number' }),
  log: text('log'),
  error: text('error'),
  changesetIds: text('changeset_ids').array(),
});

export const ingestConfig = ingestSchema.table(
  'config',
  {
    task: text('task').notNull(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    note: text('note'),
  },
  (t) => [primaryKey({ columns: [t.task, t.key] })],
);

export const ingestMatchRule = ingestSchema.table('match_rule', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  kind: text('kind').notNull(),
  keys: text('keys').array().notNull(),
  entityId: text('entity_id').references(() => entity.id, { onUpdate: 'cascade' }),
  note: text('note').notNull(),
});

export const ingestSnapshot = ingestSchema.table(
  'snapshot',
  {
    task: text('task').notNull(),
    externalKey: text('external_key').notNull(),
    payload: jsonb('payload').notNull(),
    sha256: text('sha256').notNull(),
    firstSeenRun: bigint('first_seen_run', { mode: 'number' }),
    lastSeenRun: bigint('last_seen_run', { mode: 'number' }),
  },
  (t) => [primaryKey({ columns: [t.task, t.externalKey] })],
);

export const ingestWatch = ingestSchema.table(
  'watch',
  {
    entityId: text('entity_id')
      .notNull()
      .references(() => entity.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    task: text('task').notNull(),
    nextCheckAt: date('next_check_at', dateStr),
    keywords: text('keywords').array(),
    note: text('note'),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.task] })],
);

export const ingestApiEndpoint = ingestSchema.table('api_endpoint', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  nameKo: text('name_ko').notNull(),
  method: text('method').notNull().default('GET'),
  baseUrl: text('base_url').notNull(),
  params: jsonb('params')
    .notNull()
    .default(sql`'[]'::jsonb`),
  keyParam: text('key_param'),
  keyEnv: text('key_env'),
  responseFormat: text('response_format').notNull(),
  rowsPath: text('rows_path'),
  paging: jsonb('paging'),
  dailyLimit: integer('daily_limit'),
  externalSystem: text('external_system').references(() => refExternalSystem.code, { onUpdate: 'cascade' }),
  sourceId: text('source_id').references(() => source.id, { onUpdate: 'cascade' }),
  docUrl: text('doc_url'),
  note: text('note'),
  ...meta(),
});

export const ingestApiCall = ingestSchema.table('api_call', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  endpointId: text('endpoint_id')
    .notNull()
    .references(() => ingestApiEndpoint.id, { onUpdate: 'cascade' }),
  params: jsonb('params').notNull(),
  calledAt: timestamp('called_at', tstz).notNull().defaultNow(),
  origin: text('origin').notNull(),
  status: integer('status'),
  elapsedMs: integer('elapsed_ms'),
  resultCode: text('result_code'),
  resultMessage: text('result_message'),
  responseBody: bytea('response_body'),
  responseSha256: text('response_sha256'),
  snapshotDocumentId: uuid('snapshot_document_id').references(() => document.id),
});

export const ingestApiPreset = ingestSchema.table('api_preset', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  endpointId: text('endpoint_id')
    .notNull()
    .references(() => ingestApiEndpoint.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  name: text('name').notNull(),
  params: jsonb('params').notNull(),
});
