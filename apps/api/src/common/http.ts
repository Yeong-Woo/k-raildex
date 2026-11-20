/** 요청 해석 도우미 */
import { codes, type EntityType } from '@k-raildex/contracts';
import { z } from 'zod';
import { ApiError } from './errors';

const ENTITY_TYPES = codes.entityType.values as readonly EntityType[];

/** 경로의 kebab-case 개체 종류 → EntityType. 모르면 404 */
export function entityTypeParam(raw: string): EntityType {
  const t = raw.replace(/-/g, '_');
  if ((ENTITY_TYPES as readonly string[]).includes(t)) return t as EntityType;
  throw new ApiError(404, 'not_found', `알 수 없는 개체 종류: ${raw}`);
}

export const kebab = (t: EntityType): string => t.replace(/_/g, '-');

export const boolParam = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', ''])])
  .optional()
  .transform((v) => v === true || v === 'true' || v === '1');

export const limitParam = z.coerce.number().int().min(1).max(500).default(50);
export const offsetParam = z.coerce.number().int().min(0).default(0);

/** 공통 쓰기 옵션(docs/04-api.md 4절): rationale, changeset_title, dry_run */
export const writeOptionsSchema = z.object({
  rationale: z.string().optional(),
  changeset_title: z.string().min(1).optional(),
  dry_run: boolParam,
});
export type WriteOptions = z.infer<typeof writeOptionsSchema>;

/** If-Match: W/"3" · "3" · 3 → 3 */
export function parseIfMatch(header: string | string[] | undefined, required: boolean): number | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw == null || raw === '') {
    if (required) throw new ApiError(428, 'precondition_required', 'If-Match 헤더(개체 version)가 필요함');
    return undefined;
  }
  const m = /^\s*(?:W\/)?"?(\d+)"?\s*$/.exec(raw);
  if (!m) throw new ApiError(400, 'bad_request', `If-Match 형식 오류: ${raw}`);
  return Number(m[1]);
}

export const etagOf = (version: unknown): string => `W/"${String(version)}"`;
