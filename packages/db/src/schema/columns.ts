/**
 * 공용 열 묶음 (docs/03-data-model.md 2-3~2-6절). SQL 의 FUZZY(x)·이름·REC·META 와 같은 열을 펼친다.
 * 객체를 펼쳐(`...fuzzy('opened')`) 테이블 정의에 넣는다.
 */
import { sql } from 'drizzle-orm';
import { date, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { appUser, changeset, entity } from './system';

export const tstz = { withTimezone: true, mode: 'string' } as const;
export const dateStr = { mode: 'string' } as const;

type Camel<S extends string> = S extends `${infer H}_${infer T}` ? `${H}${Capitalize<Camel<T>>}` : S;

function camel(s: string): string {
  return s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

function fuzzyRaw(prefix: string, required: boolean) {
  const value = `${prefix}_value`;
  const precision = `${prefix}_precision`;
  return {
    value: text(value),
    precision: required ? text(precision).notNull() : text(precision),
    from: date(`${prefix}_from`, dateStr).generatedAlwaysAs(sql.raw(`fuzzy_from(${value}, ${precision})`)),
    to: date(`${prefix}_to`, dateStr).generatedAlwaysAs(sql.raw(`fuzzy_to(${value}, ${precision})`)),
  };
}

// 형식 추론 전용(실행되지 않음)
const _fuzzyShape = () => ({
  value: text(),
  optional: text(),
  required: text().notNull(),
  gen: date(dateStr).generatedAlwaysAs(sql``),
});
type FS = ReturnType<typeof _fuzzyShape>;
type FuzzyRaw<R extends boolean> = {
  value: FS['value'];
  precision: R extends true ? FS['required'] : FS['optional'];
  from: FS['gen'];
  to: FS['gen'];
};

export type FuzzyColumns<P extends string, R extends boolean = false> = {
  [K in `${Camel<P>}Value`]: FuzzyRaw<R>['value'];
} & { [K in `${Camel<P>}Precision`]: FuzzyRaw<R>['precision'] } & {
  [K in `${Camel<P>}From`]: FuzzyRaw<R>['from'];
} & { [K in `${Camel<P>}To`]: FuzzyRaw<R>['to'] };

/**
 * FUZZY(x): x_value, x_precision, x_from(생성), x_to(생성).
 * TS 속성은 camelCase 접두사: fuzzy('valid_from') → validFromValue·validFromPrecision·validFromFrom·validFromTo.
 * required = x_precision NOT NULL (FUZZY(x) NOT NULL).
 */
export function fuzzy<P extends string, R extends boolean = false>(
  prefix: P,
  opts: { required?: R } = {},
): FuzzyColumns<P, R> {
  const f = fuzzyRaw(prefix, opts.required === true);
  const k = camel(prefix);
  return {
    [`${k}Value`]: f.value,
    [`${k}Precision`]: f.precision,
    [`${k}From`]: f.from,
    [`${k}To`]: f.to,
  } as unknown as FuzzyColumns<P, R>;
}

const baseNames = () => ({
  nameKo: text('name_ko').notNull(),
  nameEn: text('name_en'),
  nameFull: text('name_full'),
});
const hanjaName = () => ({ nameHanja: text('name_hanja') });

/** 이름 묶음: name_ko(필수), name_en, [name_hanja], name_full */
export function names<H extends boolean = false>(
  opts: { hanja?: H } = {},
): ReturnType<typeof baseNames> & (H extends true ? ReturnType<typeof hanjaName> : object) {
  return { ...baseNames(), ...(opts.hanja ? hanjaName() : {}) } as ReturnType<typeof baseNames> &
    (H extends true ? ReturnType<typeof hanjaName> : object);
}

/** REC: 큐레이션 개체 공통 열(확인일·검수·부가 정보) */
export function rec() {
  return {
    checkedAt: date('checked_at', dateStr).notNull(),
    provenanceNote: text('provenance_note'),
    reviewStatus: text('review_status').notNull().default('unverified'),
    reviewedAt: timestamp('reviewed_at', tstz),
    editorNote: text('editor_note'),
    extra: jsonb('extra').$type<Record<string, unknown>>().notNull().default({}),
  };
}

/** META: 낙관적 잠금·생성·수정·소프트 삭제 */
export function meta() {
  return {
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', tstz).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', tstz).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => appUser.id),
    updatedBy: uuid('updated_by').references(() => appUser.id),
    lastChangesetId: text('last_changeset_id').references(() => changeset.id, { onUpdate: 'cascade' }),
    deletedAt: timestamp('deleted_at', tstz),
    deletedBy: uuid('deleted_by').references(() => appUser.id),
    deleteReason: text('delete_reason'),
  };
}

/** 개체 테이블 PK: id text PRIMARY KEY REFERENCES entity(id) ON UPDATE CASCADE */
export function entityPk() {
  return text('id')
    .primaryKey()
    .references(() => entity.id, { onUpdate: 'cascade' });
}
