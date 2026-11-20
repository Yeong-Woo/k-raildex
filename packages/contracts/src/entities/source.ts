/** 출처 source (docs/03-data-model.md 4-2절). source 자신은 출처 연결(record_source)을 요구하지 않는다 */
import { z } from 'zod';
import { codes } from '../codes';
import { idSchema } from '../ids';
import {
  checkUnique,
  dateSchema,
  defineContract,
  keyBy,
  nameRefFields,
  nullish,
  optFuzzy,
  optText,
  recFields,
  recReadFields,
  sourceLinkSchema,
  uuidSchema,
} from './common';

/** 출처 ↔ 원문 문서 source_document */
export const sourceDocumentLinkSchema = z
  .object({
    document_id: uuidSchema,
    role: z.enum(codes.sourceDocumentRole.values),
  })
  .strict();
export type SourceDocumentLink = z.infer<typeof sourceDocumentLinkSchema>;

const shape = {
  id: idSchema('source'),
  title: z.string().min(1),
  publisher: z.string().min(1),
  type: z.enum(codes.sourceType.values),
  url: optText(),
  license: z.string().min(1),
  license_class: z.enum(codes.licenseClass.values),
  attribution: optText(),
  published: optFuzzy(),
  published_raw: optText(),
  data_as_of: optText(),
  retrieved_at: dateSchema,
  refresh: nullish(z.enum(codes.sourceRefresh.values)),
  notice_number: optText(),
  dataset_key: optText(),
  download: nullish(z.record(z.string(), z.unknown())),
  note: optText(),
  ...recFields,
  /** 필드별 출처(선택) — source 는 출처 ≥ 1 을 요구하지 않는다 */
  sources: z.array(sourceLinkSchema).default([]),
  ...nameRefFields,
  documents: z.array(sourceDocumentLinkSchema).default([]),
};

const contract = defineContract(shape, recReadFields, (row, ctx) => {
  checkUnique(row, ctx, 'documents', keyBy('document_id'));
});

export const SourceCreateSchema = contract.create;
export const SourceUpdateSchema = contract.update;
export const SourceReadSchema = contract.read;
export type SourceCreate = z.infer<typeof SourceCreateSchema>;
export type SourceUpdate = z.infer<typeof SourceUpdateSchema>;
export type SourceRead = z.infer<typeof SourceReadSchema>;
