/** 지도 클릭 대상(역·노선·계획 선) 판별 — 순수 함수(시험 대상) */

export type PopupTarget =
  | { kind: 'station'; id: string; props: Record<string, unknown> }
  | { kind: 'line'; id: string; props: Record<string, unknown> }
  | { kind: 'plan'; id: string; props: Record<string, unknown> };

/** 지도 피처 속성 → 팝업 대상. 역은 station_id, 계획 선은 plan_id, 노선 선은 line_id */
export function targetOf(props: Record<string, unknown> | null | undefined): PopupTarget | null {
  if (!props) return null;
  const s = (k: string) => (typeof props[k] === 'string' && props[k] ? (props[k] as string) : null);
  if (s('station_id')) return { kind: 'station', id: s('station_id')!, props };
  if (s('plan_id')) return { kind: 'plan', id: s('plan_id')!, props };
  if (s('line_id')) return { kind: 'line', id: s('line_id')!, props };
  return null;
}

export const keyOf = (t: PopupTarget) => `${t.kind}:${t.id}`;

/**
 * 클릭 지점 주변의 대상 고르기. 역이 잡히면 역(역 팝업에서 지나는 노선을 다시 고를 수 있다),
 * 아니면 겹친 노선·계획 선 전부(같은 대상은 하나로). layers 앞쪽이 목록 앞쪽.
 */
export function pickTargets(
  feats: { layer: { id: string }; properties: Record<string, unknown> | null }[],
  layers: string[],
) {
  const seen = new Set<string>();
  const out: PopupTarget[] = [];
  for (const l of layers)
    for (const f of feats) {
      if (f.layer.id !== l) continue;
      const t = targetOf(f.properties);
      if (!t || seen.has(keyOf(t))) continue;
      seen.add(keyOf(t));
      out.push(t);
    }
  const station = out.find((t) => t.kind === 'station');
  return station ? [station] : out;
}
