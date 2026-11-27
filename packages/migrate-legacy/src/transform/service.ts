/** 열차 등급·운행 계통 변환(WP 3.4, docs/07-migration.md 3-3절) */
import type { LineStationCreate, ServiceCreate, TrainClassCreate } from '@k-raildex/contracts';
import type { LService, LTrainClass } from '../read/types';
import { aliasNames, fuzzy, nameCols, rec, type MigrationReport } from './common';

type Names = { name_ko: string; name_en: string | null; name_hanja: string | null; name_full: string | null };

export function transformTrainClass(
  t: LTrainClass,
  report: MigrationReport,
  editorNote: string | null,
): TrainClassCreate {
  const where = `train_class ${t.id}`;
  const ended = fuzzy(t.ended_at, `${where}.ended_at`);
  const retired = fuzzy(t.retired_at, `${where}.retired_at`);
  // TrainClass.retired_at → ended (ended_at 이 있으면 그것, 다르면 리포트)
  if (ended && retired && (ended.value !== retired.value || ended.precision !== retired.precision))
    report.add(
      '열차 등급 ended_at ≠ retired_at(ended_at 사용, retired_at 은 extra)',
      `${t.id}: ${ended.value} / ${retired.value}`,
    );
  const extra: Record<string, unknown> = {};
  if (retired && ended && (ended.value !== retired.value || ended.precision !== retired.precision))
    extra.retired_at = retired;
  if (t.codes && Object.keys(t.codes).length) {
    extra.codes = t.codes;
    report.add('열차 등급 codes(외부 시스템 미등록, extra 로 보관)', t.id);
  }
  return {
    id: t.id,
    ...(nameCols(t.name) as Names),
    tier: t.tier as TrainClassCreate['tier'],
    status: (t.status ?? 'active') as TrainClassCreate['status'],
    successor_id: t.successor_id ?? null,
    max_speed_kmh: t.max_speed_kmh ?? null,
    started: fuzzy(t.started_at, `${where}.started_at`),
    ended: ended ?? retired,
    description: t.description ?? null,
    ...rec(t.provenance, { review: t.review_status, editorNote, extra }),
    names: aliasNames(t.aliases, t.name.ko),
    external_refs: [],
  };
}

/**
 * 정차역 → 노선역(07 문서 3-3): 운행 계통 노선들 중 그 역의 노선역. 하나면 확정,
 * 여럿이면 패턴 순서상 앞뒤 역과 같은 노선을 우선, 그래도 못 풀면 리포트하고 그 정차역을 뺀다.
 * 뺀 정차역은 `dropped` 에 모아 운행 계통 `extra.dropped_stops` 로 남긴다 → 품질 목록 X-service-dropped-stops(Q105 A).
 */
export interface DroppedStop {
  pattern: string;
  /** 기존 정차 순서(1부터) */
  seq: number;
  station_id: string;
  /** not_on_service_lines = 운행 계통 노선에 그 역의 노선역 없음, ambiguous = 후보 여럿, pattern_dropped = 패턴 전체 제외(해석 정차역 2개 미만) */
  reason: 'not_on_service_lines' | 'ambiguous' | 'pattern_dropped';
  candidates?: string[];
}

export function resolveStops(
  serviceId: string,
  patternId: string,
  serviceLines: string[],
  stationIds: string[],
  lsByStation: Map<string, LineStationCreate[]>,
  report: MigrationReport,
  dropped: DroppedStop[] = [],
): string[] {
  const lineSet = new Set(serviceLines);
  const cands = stationIds.map((s) => (lsByStation.get(s) ?? []).filter((x) => lineSet.has(x.line_id)));
  const linesAt = (i: number): Set<string> => new Set((cands[i] ?? []).map((x) => x.line_id));
  const out: string[] = [];
  for (const [i, c] of cands.entries()) {
    const sid = stationIds[i]!;
    if (c.length === 1) {
      out.push(c[0]!.id);
      continue;
    }
    if (c.length === 0) {
      report.add('정차 패턴 정차역 노선역 미해석(정차역 제외)', `${serviceId}/${patternId}: ${sid}`);
      dropped.push({ pattern: patternId, seq: i + 1, station_id: sid, reason: 'not_on_service_lines' });
      continue;
    }
    const prev = linesAt(i - 1);
    const next = linesAt(i + 1);
    // 앞뒤 둘 다와 같은 노선 > 앞 역과 같은 노선(들어온 노선) > 뒤 역과 같은 노선
    let pick = c.filter((x) => prev.has(x.line_id) && next.has(x.line_id));
    if (pick.length !== 1) pick = c.filter((x) => prev.has(x.line_id));
    if (pick.length !== 1) pick = c.filter((x) => next.has(x.line_id));
    if (pick.length !== 1) {
      // 앞뒤 둘 다와 겹치는 게 없으면 서비스 노선 순서상 앞의 노선(정해진 규칙이 없어 리포트)
      report.add(
        '정차 패턴 정차역 노선 모호(정차역 제외)',
        `${serviceId}/${patternId}: ${sid} 후보 ${c.map((x) => x.line_id).join(', ')}`,
      );
      dropped.push({
        pattern: patternId,
        seq: i + 1,
        station_id: sid,
        reason: 'ambiguous',
        candidates: c.map((x) => x.line_id),
      });
      continue;
    }
    report.count('정차역.앞뒤 역 노선으로 해석');
    out.push(pick[0]!.id);
  }
  return out;
}

export function transformService(
  s: LService,
  lsByStation: Map<string, LineStationCreate[]>,
  report: MigrationReport,
  editorNote: string | null,
): ServiceCreate {
  const where = `service ${s.id}`;
  const patterns: ServiceCreate['stop_patterns'] = [];
  const dropped: DroppedStop[] = [];
  for (const p of s.stop_patterns ?? []) {
    const patDropped: DroppedStop[] = [];
    const stops = resolveStops(s.id, p.id, s.line_ids, p.station_ids, lsByStation, report, patDropped);
    // 같은 노선역이 연달아 나오면(순환선 기점 반복 등) 그대로 둔다 — DB 는 (pattern, seq) 키
    if (stops.length < 2) {
      report.add(
        '정차 패턴 정차역 2개 미만(패턴 제외)',
        `${s.id}/${p.id} (${p.station_ids.length}역 중 ${stops.length} 해석)`,
      );
      // 패턴 전체를 뺐으니 정차역 모두를 남긴다(풀린 것은 pattern_dropped)
      const unresolved = new Map(patDropped.map((d) => [d.seq, d]));
      p.station_ids.forEach((sid, i) =>
        dropped.push(
          unresolved.get(i + 1) ?? { pattern: p.id, seq: i + 1, station_id: sid, reason: 'pattern_dropped' },
        ),
      );
      continue;
    }
    dropped.push(...patDropped);
    if (stops.length !== p.station_ids.length) report.count('정차 패턴.일부 정차역 제외');
    patterns.push({
      code: p.id,
      name_ko: p.name.ko,
      name_en: p.name.en ?? null,
      type: p.type as ServiceCreate['stop_patterns'][number]['type'],
      note: p.note ?? null,
      stops,
    });
  }
  const extra: Record<string, unknown> = {};
  if (dropped.length) {
    extra.dropped_stops = dropped;
    report.count('정차 패턴.뺀 정차역(extra.dropped_stops)', dropped.length);
  }
  return {
    id: s.id,
    ...(nameCols(s.name) as Names),
    kind: s.kind as ServiceCreate['kind'],
    train_class_id: s.train_class_id ?? null,
    status: s.status as ServiceCreate['status'],
    color: s.color ?? null,
    opened: fuzzy(s.opened_at, `${where}.opened_at`),
    closed: fuzzy(s.closed_at, `${where}.closed_at`),
    successor_id: null,
    description: s.description ?? null,
    ...rec(s.provenance, { review: s.review_status, editorNote, extra }),
    names: aliasNames(s.aliases, s.name.ko),
    external_refs: [],
    lines: [...new Set(s.line_ids)],
    stop_patterns: patterns,
  };
}
