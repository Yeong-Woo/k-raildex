/**
 * 원문 문서 document (docs/03-data-model.md 4-3절). 개체(entity)가 아니다 — id 는 uuid(DB 생성), 버전 없음.
 * DB CHECK: publishable 은 공개 가능 라이선스만, 파생 문서(text_extract·page_image·figure_crop)는 원본 필요.
 */
import { z } from 'zod';
import { codes, type Code } from '../codes';
import {
  bboxSchema,
  defineContract,
  issue,
  known,
  nullish,
  optPositiveInt,
  optText,
  timestampSchema,
  uuidSchema,
} from './common';

/** publishable 을 켤 수 있는 라이선스 분류(Q75 A) */
export const PUBLISHABLE_LICENSE_CLASSES: readonly Code<'licenseClass'>[] = [
  'public_work',
  'kogl_1',
  'kogl_2',
  'kogl_3',
  'kogl_4',
  'open',
];

/** 원본이 필요한 파생 문서 종류 */
export const DERIVED_DOCUMENT_KINDS: readonly Code<'documentKind'>[] = ['text_extract', 'page_image', 'figure_crop'];

const shape = {
  storage_key: z.string().min(1),
  filename: z.string().min(1),
  mime: z.string().min(1),
  size_bytes: z.number().int().min(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, { message: 'sha256 은 소문자 16진수 64자' }),
  origin_url: optText(),
  retrieved_at: nullish(timestampSchema),
  kind: z.enum(codes.documentKind.values),
  parent_document_id: nullish(uuidSchema),
  page: nullish(z.number().int().min(1)),
  /** figure_crop: 쪽 안의 영역(0~1 비율 x0,y0,x1,y1) */
  bbox: nullish(bboxSchema),
  license_class: z.enum(codes.licenseClass.values),
  publishable: z.boolean().default(false),
  text_content: optText(),
  pages: optPositiveInt(),
  meta: z.record(z.string(), z.unknown()).default({}),
};

const readExtra = {
  id: uuidSchema,
  created_at: timestampSchema,
  deleted_at: timestampSchema.nullable(),
};

const contract = defineContract(shape, readExtra, (row, ctx) => {
  if (
    known(row, 'publishable', 'license_class') &&
    row.publishable === true &&
    !PUBLISHABLE_LICENSE_CLASSES.includes(row.license_class as Code<'licenseClass'>)
  )
    issue(ctx, ['publishable'], `license_class ${String(row.license_class)} 문서는 공개할 수 없음(Q75 A)`);
  if (
    known(row, 'kind', 'parent_document_id') &&
    DERIVED_DOCUMENT_KINDS.includes(row.kind as Code<'documentKind'>) &&
    row.parent_document_id == null
  )
    issue(ctx, ['parent_document_id'], `파생 문서(${String(row.kind)})는 parent_document_id 가 필요함`);
});

export const DocumentCreateSchema = contract.create;
export const DocumentUpdateSchema = contract.update;
export const DocumentReadSchema = contract.read;
export type DocumentCreate = z.infer<typeof DocumentCreateSchema>;
export type DocumentUpdate = z.infer<typeof DocumentUpdateSchema>;
export type DocumentRead = z.infer<typeof DocumentReadSchema>;
