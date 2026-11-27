/** "출처" 절 묶기(순수 함수 — test/sources.test.ts). FR-WEB-005: 출처마다 발행처·유형·라이선스·받은 날·대상 필드·공개 원문 */
import type { PublicDocument, PublicSourceRef } from '@k-raildex/contracts';

export interface SourceGroup {
  n: number;
  source_id: string;
  title: string;
  publisher: string;
  type: PublicSourceRef['type'];
  url: string | null;
  license: string;
  license_class: PublicSourceRef['license_class'];
  attribution: string | null;
  published: PublicSourceRef['published'];
  retrieved_at: string;
  checked_at: string;
  /** 대상 필드(없으면 "전체") — 중복 제거 */
  fields: string[];
  /** 노선역 등 하위 개체 출처일 때 그 개체 id */
  entity_ids: string[];
  locators: string[];
  notes: string[];
  documents: PublicDocument[];
  /** 덧붙일 원문 표기(지금은 쓰지 않음 — 시간표 요일구분 원문은 Q139 B 로 공개하지 않는다) */
  extra_notes: string[];
}

/** 같은 출처(source_id)를 한 항목으로 묶고 처음 나온 순서로 번호를 매긴다 */
export function groupSources(refs: readonly PublicSourceRef[], primaryEntityId?: string): SourceGroup[] {
  const map = new Map<string, SourceGroup>();
  for (const r of refs) {
    let g = map.get(r.source_id);
    if (!g) {
      g = {
        n: map.size + 1,
        source_id: r.source_id,
        title: r.title,
        publisher: r.publisher,
        type: r.type,
        url: r.url,
        license: r.license,
        license_class: r.license_class,
        attribution: r.attribution,
        published: r.published,
        retrieved_at: r.retrieved_at,
        checked_at: r.checked_at,
        fields: [],
        entity_ids: [],
        locators: [],
        notes: [],
        documents: [],
        extra_notes: [],
      };
      map.set(r.source_id, g);
    }
    if (r.field && !g.fields.includes(r.field)) g.fields.push(r.field);
    if (primaryEntityId && r.entity_id !== primaryEntityId && !g.entity_ids.includes(r.entity_id))
      g.entity_ids.push(r.entity_id);
    if (r.locator && !g.locators.includes(r.locator)) g.locators.push(r.locator);
    if (r.note && !g.notes.includes(r.note)) g.notes.push(r.note);
    if (r.checked_at > g.checked_at) g.checked_at = r.checked_at;
    for (const d of r.documents) if (!g.documents.some((x) => x.id === d.id)) g.documents.push(d);
  }
  return [...map.values()];
}

/** 출처 번호 찾기(핵심 수치 칸의 각주) */
export function sourceNumberFor(groups: readonly SourceGroup[], field: string): number | null {
  const g = groups.find((x) => x.fields.includes(field));
  return g ? g.n : null;
}
