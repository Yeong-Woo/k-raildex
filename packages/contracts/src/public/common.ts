/**
 * 공개 API 응답 공통 부품(docs/04-api.md 5절). 공개 응답은 내부 필드(editor_note·extra·작성자·변경 묶음 id)를 싣지 않는다 —
 * 모든 응답 스키마는 strict 라 시험에서 내부 필드가 새어 나오면 실패한다.
 */
import { z } from 'zod';
import { codes } from '../codes';
import { fuzzyDateSchema } from '../fuzzy-date';

export const pubFuzzy = fuzzyDateSchema.nullable();
export const pubDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const pubTimestamp = z.string();
export const pubAreas = z.array(z.enum(codes.area.values));
export const pubStatus = z.enum(codes.status.values);
export const pubStage = z.enum(codes.planStage.values);
export const pubReview = z.enum(codes.reviewStatus.values);

/** 공개 목록(FR-API-005) */
export const pubList = <T extends z.ZodType>(item: T) =>
  z
    .object({ items: z.array(item), total: z.number().int(), limit: z.number().int(), offset: z.number().int() })
    .strict();

/** 이름·id 만 있는 참조 */
export const pubRefSchema = z.object({ id: z.string(), name_ko: z.string() }).strict();
export type PublicRef = z.infer<typeof pubRefSchema>;

/** 공개 다운로드 가능한 원문(Q39·Q75 A) */
export const pubDocumentSchema = z
  .object({
    id: z.uuid(),
    filename: z.string(),
    mime: z.string(),
    size_bytes: z.number().int(),
    kind: z.enum(codes.documentKind.values),
    license_class: z.enum(codes.licenseClass.values),
    /** 공공누리 4유형: 변경 금지·비상업 문구를 함께 보여야 함 */
    notice: z.string().nullable(),
    download_path: z.string(),
  })
  .strict();
export type PublicDocument = z.infer<typeof pubDocumentSchema>;

/** 출처 연결 + 출처 정보(FR-WEB-005 "출처" 절). entity_id = 출처가 붙은 개체(정거장이면 ls-) */
export const pubSourceRefSchema = z
  .object({
    entity_id: z.string(),
    source_id: z.string(),
    title: z.string(),
    publisher: z.string(),
    type: z.enum(codes.sourceType.values),
    url: z.string().nullable(),
    license: z.string(),
    license_class: z.enum(codes.licenseClass.values),
    attribution: z.string().nullable(),
    published: pubFuzzy,
    retrieved_at: pubDate,
    checked_at: pubDate,
    field: z.string().nullable(),
    locator: z.string().nullable(),
    note: z.string().nullable(),
    documents: z.array(pubDocumentSchema),
  })
  .strict();
export type PublicSourceRef = z.infer<typeof pubSourceRefSchema>;

/** 공개 첨부(근거 자료, Q77 A): is_public 이고 원문이 있으면 publishable 인 것만 */
export const pubAttachmentSchema = z
  .object({
    id: z.number().int(),
    entity_id: z.string(),
    kind: z.enum(codes.attachmentKind.values),
    title: z.string().nullable(),
    quote: z.string().nullable(),
    url: z.string().nullable(),
    page: z.number().int().nullable(),
    source_id: z.string().nullable(),
    document: pubDocumentSchema.nullable(),
  })
  .strict();
export type PublicAttachment = z.infer<typeof pubAttachmentSchema>;

/** 공개 별칭(internal·source_raw 는 검색에만 쓰고 싣지 않는다) */
export const pubNameSchema = z
  .object({
    name: z.string(),
    kind: z.enum(codes.entityNameKind.values),
    lang: z.string(),
    valid_from: pubFuzzy,
    valid_to: pubFuzzy,
    note: z.string().nullable(),
  })
  .strict();

/** 큐레이션 메타(공개 부분): 확인일·출처 메모·검수 상태 */
export const pubRecSchema = z
  .object({
    checked_at: pubDate,
    provenance_note: z.string().nullable(),
    review_status: pubReview,
    updated_at: pubTimestamp,
  })
  .strict();

/** 연표 항목(v_event_all) */
export const pubEventSchema = z
  .object({
    id: z.string(),
    type: z.enum(codes.eventType.values),
    date: pubFuzzy,
    title: z.string(),
    note: z.string().nullable(),
    derived: z.boolean(),
    targets: z.array(z.string()),
  })
  .strict();
export type PublicEvent = z.infer<typeof pubEventSchema>;

/** 개통 예정(기대 일정, Q88·Q94: official·press 만) */
export const pubTargetSchema = z
  .object({
    value: z.string().nullable(),
    precision: z.enum(codes.fuzzyPrecision.values),
    basis: z.enum(codes.milestoneBasis.values).nullable(),
    as_of: pubFuzzy,
    source_id: z.string().nullable(),
    delayed: z.boolean(),
  })
  .strict();
export type PublicTarget = z.infer<typeof pubTargetSchema>;

/** 상세 응답 공통 꼬리: 별칭·출처·첨부·메타 */
export const pubDetailTail = {
  names: z.array(pubNameSchema),
  sources: z.array(pubSourceRefSchema),
  attachments: z.array(pubAttachmentSchema),
  meta: pubRecSchema,
};

/** 옛 id → 새 id(FR-WEB-004, Q69 A) */
export const pubRedirectSchema = z
  .object({
    old_id: z.string(),
    new_id: z.string(),
    type: z.enum(codes.entityType.values),
    url_path: z.string().nullable(),
    reason: z.string().nullable(),
  })
  .strict();
export type PublicRedirect = z.infer<typeof pubRedirectSchema>;
