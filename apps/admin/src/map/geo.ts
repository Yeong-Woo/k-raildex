/** 지도 도구용 좌표 계산(turf 없이): 하버사인 길이, 경유역 곡선 보간(Catmull-Rom), GeoJSON 붙여넣기 해석 */
export type Coord = [number, number];

const R = 6371.0088; // 평균 지구 반지름(km)
const rad = (d: number) => (d * Math.PI) / 180;

/** 두 점 거리(km) */
export function haversineKm(a: Coord, b: Coord): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 선(여러 줄) 길이 합(km) */
export function lengthKm(lines: Coord[][]): number {
  let s = 0;
  for (const l of lines) for (let i = 1; i < l.length; i++) s += haversineKm(l[i - 1]!, l[i]!);
  return s;
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * 경유역을 지나는 곡선(중심 Catmull-Rom, alpha 0.5). 표시용 개략 선형이므로 경유역은 반드시 지나고 사이를 부드럽게 잇는다.
 * 점이 2개 이하면 직선 그대로.
 */
export function curveThrough(points: Coord[], segments = 12): Coord[] {
  if (points.length < 3) return points.map((p) => [round6(p[0]), round6(p[1])]);
  const out: Coord[] = [];
  const p = [points[0]!, ...points, points[points.length - 1]!];
  const tj = (ti: number, a: Coord, b: Coord) => ti + Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5, 1e-9);
  for (let i = 1; i < p.length - 2; i++) {
    const [p0, p1, p2, p3] = [p[i - 1]!, p[i]!, p[i + 1]!, p[i + 2]!];
    const t0 = 0;
    const t1 = tj(t0, p0, p1);
    const t2 = tj(t1, p1, p2);
    const t3 = tj(t2, p2, p3);
    for (let s = 0; s < segments; s++) {
      const t = t1 + ((t2 - t1) * s) / segments;
      const lerp = (a: Coord, b: Coord, ta: number, tb: number): Coord => {
        const w = tb === ta ? 0 : (t - ta) / (tb - ta);
        return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
      };
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2);
      const b2 = lerp(a2, a3, t1, t3);
      const c = lerp(b1, b2, t1, t2);
      out.push([round6(c[0]), round6(c[1])]);
    }
  }
  const last = points[points.length - 1]!;
  out.push([round6(last[0]), round6(last[1])]);
  return out;
}

export interface MultiLine {
  type: 'MultiLineString';
  coordinates: Coord[][];
}

const isCoord = (c: unknown): c is Coord =>
  Array.isArray(c) &&
  c.length >= 2 &&
  typeof c[0] === 'number' &&
  typeof c[1] === 'number' &&
  Math.abs(c[0]) <= 180 &&
  Math.abs(c[1]) <= 90;

/**
 * 붙여 넣은 GeoJSON(Feature·FeatureCollection·LineString·MultiLineString) → MultiLineString.
 * 선이 아닌 geometry 는 무시하고, 선이 하나도 없으면 오류.
 */
export function parseLineGeoJson(text: string): MultiLine {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error('JSON 형식이 아닙니다');
  }
  const lines: Coord[][] = [];
  const walk = (g: unknown): void => {
    if (!g || typeof g !== 'object') return;
    const o = g as {
      type?: string;
      features?: unknown[];
      geometry?: unknown;
      geometries?: unknown[];
      coordinates?: unknown;
    };
    if (o.type === 'FeatureCollection') o.features?.forEach(walk);
    else if (o.type === 'Feature') walk(o.geometry);
    else if (o.type === 'GeometryCollection') o.geometries?.forEach(walk);
    else if (o.type === 'LineString' && Array.isArray(o.coordinates)) lines.push(o.coordinates as Coord[]);
    else if (o.type === 'MultiLineString' && Array.isArray(o.coordinates)) lines.push(...(o.coordinates as Coord[][]));
  };
  walk(v);
  const clean = lines
    .map((l) => l.filter(isCoord).map((c) => [round6(c[0]), round6(c[1])] as Coord))
    .filter((l) => l.length >= 2);
  if (!clean.length) throw new Error('선(LineString·MultiLineString)이 없습니다(좌표는 [경도, 위도])');
  return { type: 'MultiLineString', coordinates: clean };
}

/** 지도 상태로 쓰는 bbox 문자열(w,s,e,n, 소수 4자리) */
export function bboxParam(b: { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number }): string {
  const f = (v: number) => (Math.round(v * 1e4) / 1e4).toString();
  return [
    f(Math.max(-180, b.getWest())),
    f(Math.max(-90, b.getSouth())),
    f(Math.min(180, b.getEast())),
    f(Math.min(90, b.getNorth())),
  ].join(',');
}

/**
 * 순서 있는 점 목록에 새 점을 넣을 자리(0..n) — 이웃 사이 경로 길이가 가장 적게 늘어나는 곳.
 * 좌표가 없는 행은 건너뛰고 가장 가까운 좌표 있는 행을 이웃으로 본다. 새 점 좌표가 없거나 좌표 있는 행이 하나도 없으면 끝(n).
 */
export function bestInsertIndex(points: (Coord | null)[], c: Coord | null): number {
  const n = points.length;
  if (!c || !points.some(Boolean)) return n;
  let best = n;
  let bestCost = Infinity;
  for (let i = 0; i <= n; i++) {
    let prev: Coord | null = null;
    for (let j = i - 1; j >= 0 && !prev; j--) prev = points[j] ?? null;
    let next: Coord | null = null;
    for (let j = i; j < n && !next; j++) next = points[j] ?? null;
    let cost: number;
    if (prev && next) cost = haversineKm(prev, c) + haversineKm(c, next) - haversineKm(prev, next);
    else if (prev) cost = haversineKm(prev, c);
    else if (next) cost = haversineKm(c, next);
    else continue;
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = i;
    }
  }
  return best;
}
