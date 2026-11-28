/** 노선 정거장 순서 편집기(FR-ADM-050)의 순수 계산 — km 역행·일괄 상태·PUT 본문 */

export interface LsRow {
  /** 화면 키(저장하지 않음) */
  _key: string;
  id?: string;
  version?: number;
  station_id: string;
  station_name_ko?: string | null;
  /** 역 쪽 종류·좌표(읽기 전용, 서버가 붙임) */
  station_kind?: string | null;
  station_geom?: { lng: number; lat: number } | null;
  branch: string | null;
  /** 지선이 갈라져 나오는 정거장(지선 행만, 0042) */
  branch_from_id?: string | null;
  km: number | null;
  station_code: string | null;
  order_confirmed: boolean;
  status: string;
  opened: unknown;
  closed: unknown;
  name_ko: string | null;
  operator_id: string | null;
  [k: string]: unknown;
}

/** 저장하지 않는(서버가 정하는) 필드 */
const SERVER_FIELDS = new Set([
  '_key',
  'seq',
  'line_id',
  'created_at',
  'updated_at',
  'deleted_at',
  'last_changeset_id',
  'station_name_ko',
  'station_kind',
  'station_geom',
]);

/**
 * km 역행 행 인덱스. 같은 지선(branch, NULL = 본선) 안에서 바로 앞의 km 값보다 작으면 역행.
 * 본선 km 가 줄어드는 방향(감소)으로 매긴 노선이면 증가가 역행이므로, 처음 두 값으로 방향을 정한다.
 */
export function kmRegressions(rows: Pick<LsRow, 'branch' | 'km'>[]): Set<number> {
  const out = new Set<number>();
  const byBranch = new Map<string, { i: number; km: number }[]>();
  rows.forEach((r, i) => {
    if (r.km == null || Number.isNaN(r.km)) return;
    const k = r.branch ?? '';
    if (!byBranch.has(k)) byBranch.set(k, []);
    byBranch.get(k)!.push({ i, km: r.km });
  });
  for (const list of byBranch.values()) {
    if (list.length < 2) continue;
    const first = list.find((x, j) => j > 0 && x.km !== list[j - 1]!.km);
    const dir = first ? Math.sign(first.km - list[list.indexOf(first) - 1]!.km) : 1;
    for (let j = 1; j < list.length; j++) {
      const d = list[j]!.km - list[j - 1]!.km;
      if (Math.sign(d) === -dir && d !== 0) out.add(list[j]!.i);
    }
  }
  return out;
}

/** 선택한 행들의 상태를 한꺼번에 */
export function setStatusFor<T extends { status: string; _key: string }>(
  rows: T[],
  keys: Set<string>,
  status: string,
): T[] {
  return rows.map((r) => (keys.has(r._key) ? { ...r, status } : r));
}

/** 시작~끝(포함) 행 키 — shift 클릭 범위 선택 */
export function rangeKeys(rows: { _key: string }[], a: string, b: string): string[] {
  const i = rows.findIndex((r) => r._key === a);
  const j = rows.findIndex((r) => r._key === b);
  if (i < 0 || j < 0) return [b];
  const [lo, hi] = i < j ? [i, j] : [j, i];
  return rows.slice(lo, hi + 1).map((r) => r._key);
}

/** PUT /lines/:id/stations 본문 — 배열 순서가 순서 */
export function toPutItems(rows: LsRow[]): Record<string, unknown>[] {
  return rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) if (!SERVER_FIELDS.has(k) && v !== undefined) o[k] = v;
    return o;
  });
}
