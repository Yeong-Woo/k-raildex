/** 도메인 오류 — API 가 HTTP 상태로 옮긴다(docs/04-api.md FR-API-006) */
export interface Violation {
  /** 규칙 id(V-H05 등) 또는 'schema'(zod), 'db'(제약) */
  rule: string;
  /** 필드 경로(예: stop_patterns.0.stops) */
  path: string;
  message: string;
  entity_id?: string;
}

export type DomainErrorCode =
  | 'not_found' // 404
  | 'id_taken' // 409: 같은 id(삭제된 id 포함 — 영구 예약)
  | 'version_conflict' // 409
  | 'referenced' // 409: 활성 참조가 있어 삭제 불가(V-H12)
  | 'invalid_state' // 409: 휴지통에 없는 개체 복구 등
  | 'validation' // 422
  | 'rate_limited'; // 429: 외부 API 일일 한도 등

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details: { violations?: Violation[]; current?: unknown; references?: Reference[] } = {},
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export interface Reference {
  table: string;
  column: string;
  /** 참조하는 행의 소유 개체 id(없으면 null) */
  owner_id: string | null;
  count: number;
}
