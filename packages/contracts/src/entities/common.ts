/**
 * 개체 계약 공통 부품 (docs/03-data-model.md 2·3절).
 *
 * 규약
 * - JSON 필드 이름 = DB 열 이름(snake_case).
 * - 퍼지 날짜 열 `x_value/x_precision` 은 필드 하나 `x: FuzzyDate | null`. 생성 열 `x_from/x_to` 는 계약에 없다.
 * - 하위 목록의 `seq`·`ord` 열은 배열 순서에서 정한다(계약에 없음).
 * - Create: 전체 입력(소유 하위 목록 포함). NULL 가능 열은 생략하면 null.
 * - Update: Create 의 부분 집합(id 제외, 기본값 없음 — 생략 = 바꾸지 않음).
 *   여러 필드에 걸친 검사는 관련 필드가 모두 들어 있을 때만 한다(합친 행 검사는 도메인 적용기).
 * - Read: Create + 쓰기 메타(version·created_at·updated_at·deleted_at·last_changeset_id).
 */
import { z } from 'zod';
import { codes } from '../codes';
import { fuzzyDateSchema } from '../fuzzy-date';
import { entityTypeOfId, idSchema } from '../ids';

// ---------------------------------------------------------------------------
// 기본 값 형식
// ---------------------------------------------------------------------------

/** NULL 가능 열: 생략하면 null */
export const nullish = <T extends z.ZodType>(schema: T) => schema.nullable().default(null);

export const textSchema = z.string();
export const optText = () => nullish(z.string());
export const optInt = () => nullish(z.number().int());
export const optPositiveInt = () => nullish(z.number().int().positive());
export const optBool = () => nullish(z.boolean());

/** 퍼지 날짜(NULL 가능) */
export const optFuzzy = () => nullish(fuzzyDateSchema);

/** 날짜(YYYY-MM-DD) — checked_at·retrieved_at */
export const dateSchema = z.iso.date({ message: 'YYYY-MM-DD 형식의 날짜가 아님' });

/** 시각(ISO 8601, 시간대 포함) — Read 메타 */
export const timestampSchema = z.iso.datetime({ offset: true });

export const uuidSchema = z.uuid();

/** 색(#RRGGBB) */
export const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, { message: '#RRGGBB 형식의 색이 아님' });

/** 시·도 코드(행정표준코드 2자리, ref_region.code) */
export const regionCodeSchema = z.string().regex(/^[0-9]{2}$/, { message: '시·도 코드(2자리 숫자)가 아님' });

export const areaCodeSchema = z.enum(codes.area.values);

/** 어떤 개체든 id(접두사로 종류 판별) — event_target 등 다형 참조 */
export const anyEntityIdSchema = z
  .string()
  .refine((id) => entityTypeOfId(id) !== null, { message: '알 수 없는 개체 id 형식' });

/** 점 좌표 geography(Point,4326). 범위는 DB CHECK 와 같다(위도 33~39, 경도 124~132) */
export const pointSchema = z
  .object({
    lat: z.number().min(33).max(39),
    lng: z.number().min(124).max(132),
  })
  .strict();
export type Point = z.infer<typeof pointSchema>;

/** 선 geometry(MultiLineString,4326) — GeoJSON 형식, 좌표는 [경도, 위도] */
export const multiLineStringSchema = z
  .object({
    type: z.literal('MultiLineString'),
    coordinates: z.array(z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])).min(2)).min(1),
  })
  .strict();
export type MultiLineString = z.infer<typeof multiLineStringSchema>;

/** numeric[4] 경계 상자 */
export const bboxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

// ---------------------------------------------------------------------------
// 공통 하위 행(3절)
// ---------------------------------------------------------------------------

/** 출처 연결 record_source (field NULL = 레코드 전체) */
export const sourceLinkSchema = z
  .object({
    source_id: idSchema('source'),
    field: optText(),
    locator: optText(),
    note: optText(),
  })
  .strict();
export type SourceLink = z.infer<typeof sourceLinkSchema>;

/** 별칭 entity_name */
export const entityNameSchema = z
  .object({
    name: z.string().min(1),
    kind: z.enum(codes.entityNameKind.values),
    lang: z.enum(codes.nameLang.values).default('ko'),
    valid_from: optFuzzy(),
    valid_to: optFuzzy(),
    source_id: nullish(idSchema('source')),
    note: optText(),
  })
  .strict();
export type EntityName = z.infer<typeof entityNameSchema>;

/** 외부 코드 external_ref */
export const externalRefSchema = z
  .object({
    system: z.string().min(1),
    code: z.string().min(1),
    label: optText(),
    is_primary: z.boolean().default(false),
    source_id: nullish(idSchema('source')),
    note: optText(),
  })
  .strict();
export type ExternalRef = z.infer<typeof externalRefSchema>;

/** 첨부 entity_attachment (DB CHECK: quote→quote, link→url, image·document→document_id) */
export const attachmentSchema = z
  .object({
    kind: z.enum(codes.attachmentKind.values),
    title: optText(),
    quote: optText(),
    url: optText(),
    document_id: nullish(uuidSchema),
    page: nullish(z.number().int().min(1)),
    source_id: nullish(idSchema('source')),
    is_public: z.boolean().default(false),
    origin: z.enum(codes.attachmentOrigin.values).default('manual'),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (a.kind === 'quote' && a.quote == null)
      ctx.addIssue({ code: 'custom', path: ['quote'], message: 'kind quote 는 quote 가 필요함' });
    if (a.kind === 'link' && a.url == null)
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'kind link 는 url 이 필요함' });
    if ((a.kind === 'image' || a.kind === 'document') && a.document_id == null)
      ctx.addIssue({ code: 'custom', path: ['document_id'], message: 'kind image·document 는 document_id 가 필요함' });
  });
export type Attachment = z.infer<typeof attachmentSchema>;

// ---------------------------------------------------------------------------
// 열 묶음(2-4·2-5절)과 하위 목록
// ---------------------------------------------------------------------------

/** 이름 열(2-4절) */
export const nameFields = {
  name_ko: z.string().min(1),
  name_en: optText(),
  name_hanja: optText(),
  name_full: optText(),
};

/** 한자 이름 열이 없는 개체(operator·plan_program·plan·transfer_center) */
export const nameFieldsNoHanja = {
  name_ko: z.string().min(1),
  name_en: optText(),
  name_full: optText(),
};

/** 큐레이션 메타 REC 의 입력 열(2-5절). reviewed_at 은 검수 동작이 정하므로 Read 에만 */
export const recFields = {
  checked_at: dateSchema,
  provenance_note: optText(),
  review_status: z.enum(codes.reviewStatus.values).default('unverified'),
  editor_note: optText(),
  extra: z.record(z.string(), z.unknown()).default({}),
};

/** 별칭·외부 코드 목록 */
export const nameRefFields = {
  names: z.array(entityNameSchema).default([]),
  external_refs: z.array(externalRefSchema).default([]),
};

/** 큐레이션 개체 하위 목록: 출처 ≥ 1 (FR-DM-005) + 별칭·외부 코드 */
export const curatedFields = {
  ...recFields,
  sources: z.array(sourceLinkSchema).min(1, { message: '출처가 하나 이상 필요함(FR-DM-005)' }),
  ...nameRefFields,
};

/** 쓰기 메타 META(2-6절) 중 Read 에 싣는 열 */
export const metaReadFields = {
  version: z.number().int().min(1),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  deleted_at: timestampSchema.nullable(),
  last_changeset_id: z.string().nullable(),
};

/** REC 개체 Read 추가 열 */
export const recReadFields = {
  ...metaReadFields,
  reviewed_at: timestampSchema.nullable(),
};

// ---------------------------------------------------------------------------
// 검사 도구
// ---------------------------------------------------------------------------

export type Row = Record<string, unknown>;
export type RowCheck = (row: Row, ctx: z.RefinementCtx) => void;

/** 필드가 모두 들어 있는가(Update 에서 생략된 필드는 검사하지 않는다) */
export function known(row: Row, ...keys: string[]): boolean {
  return keys.every((k) => row[k] !== undefined);
}

export function issue(ctx: z.RefinementCtx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: 'custom', path, message });
}

/** 자기 참조 금지(x <> id) */
export function checkNotSelf(row: Row, ctx: z.RefinementCtx, field: string): void {
  if (known(row, 'id', field) && row[field] != null && row[field] === row['id'])
    issue(ctx, [field], `${field} 는 자기 자신일 수 없음`);
}

/** 범위(to >= from) */
export function checkRange(row: Row, ctx: z.RefinementCtx, from: string, to: string): void {
  if (!known(row, from, to)) return;
  const a = row[from];
  const b = row[to];
  if (typeof a === 'number' && typeof b === 'number' && b < a) issue(ctx, [to], `${to} 는 ${from} 이상이어야 함`);
}

/** 목록 안 중복 금지(관계 테이블 PK) */
export function checkUnique(
  row: Row,
  ctx: z.RefinementCtx,
  field: string,
  keyOf: (item: unknown) => string = String,
): void {
  const list = row[field];
  if (!Array.isArray(list)) return;
  const seen = new Set<string>();
  list.forEach((item, i) => {
    const k = keyOf(item);
    if (seen.has(k)) issue(ctx, [field, i], `${field} 에 중복 항목`);
    seen.add(k);
  });
}

/** 객체 항목의 키 필드 묶음으로 중복 판정 */
export const keyBy =
  (...fields: string[]) =>
  (item: unknown): string =>
    JSON.stringify(fields.map((f) => (item as Row)[f] ?? null));

// ---------------------------------------------------------------------------
// 계약 묶음 생성기
// ---------------------------------------------------------------------------

type StripDefault<T> = T extends z.ZodDefault<infer I> ? I : T;
type UpdateShape<S extends z.ZodRawShape> = {
  [K in Exclude<keyof S, 'id'>]: z.ZodOptional<StripDefault<S[K]>>;
};

function stripDefault(schema: z.ZodType): z.ZodType {
  return schema instanceof z.ZodDefault ? (schema.unwrap() as z.ZodType) : schema;
}

export function updateShapeOf<S extends z.ZodRawShape>(shape: S): UpdateShape<S> {
  const out: Record<string, z.ZodType> = {};
  for (const [k, v] of Object.entries(shape)) {
    if (k === 'id') continue;
    out[k] = stripDefault(v as z.ZodType).optional();
  }
  return out as UpdateShape<S>;
}

/**
 * Create·Update·Read 계약을 한 번에 만든다.
 * @param shape Create 필드(id 포함)
 * @param readExtra Read 에 더할 메타 필드
 * @param check 한 행 안에서 표현되는 검사(DB CHECK). Update 에서는 관련 필드가 다 있을 때만 동작하게 쓴다
 */
export function defineContract<S extends z.ZodRawShape, R extends z.ZodRawShape>(
  shape: S,
  readExtra: R,
  check: RowCheck = () => {},
) {
  const refine = (v: object, ctx: z.RefinementCtx) => check(v as Row, ctx);
  const create = z.object(shape).strict().superRefine(refine);
  const update = z.object(updateShapeOf(shape)).strict().superRefine(refine);
  const read = z
    .object({ ...shape, ...readExtra })
    .strict()
    .superRefine(refine);
  return { create, update, read };
}

export interface ContractSet {
  create: z.ZodType;
  update: z.ZodType;
  read: z.ZodType;
}
