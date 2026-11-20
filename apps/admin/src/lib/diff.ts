/** 바뀐 최상위 필드(저장 전 미리 보기·PATCH 본문) */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((k) => JSON.stringify(norm(before[k])) !== JSON.stringify(norm(after[k])));
}

function norm(v: unknown): unknown {
  if (v === undefined || v === '') return null;
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) o[k] = norm((v as Record<string, unknown>)[k]);
    return o;
  }
  return v;
}

export function pretty(v: unknown): string {
  return v === undefined ? '' : JSON.stringify(v, null, 2);
}
