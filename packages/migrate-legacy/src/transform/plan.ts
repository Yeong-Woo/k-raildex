/** 상위 계획·계획 사업 변환(WP 3.5, docs/07-migration.md 3-4절, Q88·Q90·Q94) */
import type { PlanCreate, PlanProgramCreate } from '@k-raildex/contracts';
import type { LLine, LPlan, LPlanProgram, LPlanRoute, LSource, LStation } from '../read/types';
import { aliasNames, fuzzy, nameCols, programId, rec, regionCode, regionCodes, type MigrationReport } from './common';

type Names = { name_ko: string; name_en: string | null; name_full: string | null };

export function transformPlanProgram(
  p: LPlanProgram,
  ord: number,
  report: MigrationReport,
  editorNote: string | null,
): PlanProgramCreate {
  const where = `plan_program ${p.id}`;
  const region = regionCode(p.region);
  if (p.region && !region) report.add('시·도 이름 해석 실패', `${where}: ${p.region}`);
  return {
    id: programId(p.id),
    ...(nameCols(p.name, false) as Names),
    kind: p.kind as PlanProgramCreate['kind'],
    short: p.short,
    round: p.round ?? null,
    region_code: region,
    period_from: p.period?.from ?? null,
    period_to: p.period?.to ?? null,
    issuer: p.issuer ?? null,
    legal_basis: p.legal_basis ?? null,
    status: p.status as PlanProgramCreate['status'],
    parent_id: p.parent ? programId(p.parent) : null,
    summary: p.summary ?? null,
    document_note: p.document_note ?? null,
    ord,
    ...rec(p.provenance, { review: p.review_status, editorNote, extra: { legacy_id: p.id } }),
    names: [
      {
        name: p.id,
        kind: 'internal',
        lang: 'ko',
        valid_from: null,
        valid_to: null,
        source_id: null,
        note: '기존 id(Q69 A)',
      },
    ],
    external_refs: [],
    notices: (p.notices ?? []).map((n, i) => ({
      kind: n.kind as PlanProgramCreate['notices'][number]['kind'],
      title: n.title,
      number: n.number ?? null,
      date: fuzzy(n.date, `${where}.notices.${i}.date`)!,
      note: n.note ?? null,
      source_id: n.source,
    })),
    points: p.rail_points ?? [],
    figures: (p.figures ?? []).map((f) => ({ label: f.label, value: f.value, source_id: f.source ?? null })),
  };
}

/** 기대 일정 근거 판정(Q94 A): notice·law·official_page·press_release → official, news → press. 그 밖은 근거 아님 */
export function milestoneBasisOf(sourceType: string): 'official' | 'press' | null {
  if (['notice', 'law', 'official_page', 'press_release'].includes(sourceType)) return 'official';
  if (sourceType === 'news') return 'press';
  return null;
}

export interface PlanContext {
  sources: Map<string, LSource>;
  lines: Map<string, LLine>;
  /** 계산된 역 상태(기존 빌드 값) */
  stations: Map<string, LStation>;
  /** 노선 id → 연장 관계 부모 노선(parent_line_id). 기존 데이터에는 없다 */
  parentOf: Map<string, string>;
  /** 좌표가 있는 역 */
  stationsWithGeom: Set<string>;
}

export function transformPlan(
  p: LPlan,
  yaml: LPlan | undefined,
  routes: LPlanRoute[],
  ctx: PlanContext,
  report: MigrationReport,
  editorNote: string | null,
): PlanCreate {
  const where = `plan ${p.id}`;
  const hasKeywords = (yaml?.gazette_keywords?.length ?? 0) > 0;

  // 단계 이력: 관보 자동분 = 출처 src-kric-gazette + YAML 에 gazette_keywords 가 있는 계획
  const stageEvents: PlanCreate['stage_events'] = (p.stage_history ?? []).map((h, i) => {
    const gazette = h.source === 'src-kric-gazette' && hasKeywords;
    if (gazette) report.count('단계 이력.gazette_auto');
    return {
      stage: h.stage as PlanCreate['stage_events'][number]['stage'],
      kind: 'reached',
      date: fuzzy(h.date, `${where}.stage_history.${i}.date`)!,
      note: h.note ?? null,
      source_id: h.source,
      origin: gazette ? 'gazette_auto' : 'manual',
    };
  });

  // 개통 목표 → 기대 일정(opened). 출처 = 계획 출처 중 공식(우선)·보도 자료, as_of = 계획 checked_at
  const milestones: PlanCreate['milestones'] = [];
  const target = fuzzy(p.target_open, `${where}.target_open`);
  if (target) {
    const cands = p.provenance.sources
      .map((id) => ctx.sources.get(id))
      .filter((s): s is LSource => !!s)
      .map((s) => ({ s, basis: milestoneBasisOf(s.type) }))
      .filter((x) => x.basis !== null)
      .sort(
        (a, b) =>
          (a.basis === 'official' ? 0 : 1) - (b.basis === 'official' ? 0 : 1) ||
          (b.s.published_at ?? '').localeCompare(a.s.published_at ?? '') ||
          a.s.id.localeCompare(b.s.id),
      );
    const pick = cands[0];
    if (!pick) {
      report.add('개통 목표 근거 판정 불가(기대 일정 미이관, D-7)', `${p.id} ${target.value ?? ''}`);
    } else {
      report.count(`기대 일정.${pick.basis}`);
      milestones.push({
        stage: 'opened',
        expected: target,
        basis: pick.basis!,
        as_of: { value: p.provenance.checked_at, precision: 'day' },
        source_id: pick.s.id,
        note: `기존 target_open 이관 — 출처는 계획 출처 중 ${pick.basis === 'official' ? '공식' : '보도'} 자료에서 자동 선택(검수 필요)`,
      });
    }
  }

  // 노선 역할 초안(Q90 A): 공사 중·계획 → new, 운영 중 + 부모 관계 → extends, 운영 중 → upgrades. replaces 는 자동 판정 안 함
  const lines: PlanCreate['lines'] = [];
  for (const lid of p.line_ids ?? []) {
    const l = ctx.lines.get(lid);
    if (!l) {
      report.add('계획의 노선 없음', `${p.id}: ${lid}`);
      continue;
    }
    let role: PlanCreate['lines'][number]['role'];
    if (l.status === 'under_construction' || l.status === 'planned') role = 'new';
    else if (l.status === 'operating' && ctx.parentOf.has(lid)) role = 'extends';
    else role = 'upgrades';
    if (l.status !== 'operating' && role === 'upgrades')
      report.add('계획 노선 역할 확인 필요(운영 중이 아닌 노선 → upgrades 초안)', `${p.id}: ${lid} (${l.status})`);
    report.count(`계획 노선 역할.${role}`);
    lines.push({ line_id: lid, role, from_line_station_id: null, to_line_station_id: null, note: null });
  }
  const stations: PlanCreate['stations'] = [];
  for (const sid of p.station_ids ?? []) {
    const s = ctx.stations.get(sid);
    if (!s) {
      report.add('계획의 역 없음', `${p.id}: ${sid}`);
      continue;
    }
    const unopened = ['under_construction', 'planned', 'abandoned'].includes(s.status);
    if (!unopened && s.status !== 'operating')
      report.add('계획 역 역할 확인 필요(운영 중이 아닌 역 → existing 초안)', `${p.id}: ${sid} (${s.status})`);
    const role = unopened ? 'new' : 'existing';
    report.count(`계획 역 역할.${role}`);
    stations.push({ station_id: sid, role });
  }

  const geometries: PlanCreate['geometries'] = [];
  for (const r of routes) {
    const src = r.source ?? 'src-manual-curation';
    if (!r.source) report.count('계획 선형.출처 없음 → src-manual-curation');
    if (r.kind === 'schematic') {
      const via = r.via ?? [];
      const missing = via.filter((v) => !ctx.stationsWithGeom.has(v));
      if (missing.length || via.length < 2) {
        report.add('계획 선형 경유역 좌표 없음(선형 제외)', `${p.id}: ${missing.join(', ') || '경유역 2개 미만'}`);
        continue;
      }
      geometries.push({
        kind: 'schematic',
        via_station_ids: via,
        geom: null,
        accuracy_m: null,
        method_note: null,
        source_id: src,
        note: r.note ?? null,
      });
    } else {
      const c = r.coordinates ?? [];
      const isMulti = Array.isArray(c[0]) && Array.isArray((c[0] as unknown[])[0]);
      const coords = (isMulti ? c : [c]) as [number, number][][];
      geometries.push({
        kind: r.kind as 'traced' | 'official',
        via_station_ids: null,
        geom: { type: 'MultiLineString', coordinates: coords },
        accuracy_m: null,
        method_note: null,
        source_id: src,
        note: r.note ?? null,
      });
    }
  }

  const extra: Record<string, unknown> = {};
  return {
    id: p.id,
    ...(nameCols(p.name, false) as Names),
    scope: 'line',
    opened: fuzzy(p.opened_at, `${where}.opened_at`),
    operator_text: p.operator_name ?? null,
    description: p.description ?? null,
    is_national: yaml?.national ?? false,
    stage_override: null,
    color: null,
    ...rec(p.provenance, { review: p.review_status, editorNote, extra }),
    names: aliasNames(p.aliases, p.name.ko),
    external_refs: [],
    refs: p.plan_refs.map((r) => ({
      program_id: programId(r.program),
      edition: r.edition ?? null,
      timing: r.timing ?? null,
      class: r.class as PlanCreate['refs'][number]['class'],
      category: (r.category as PlanCreate['refs'][number]['category']) ?? null,
      section: r.section ?? null,
      content: r.content ?? null,
      length_km: r.length_km ?? null,
      cost_100m_krw: r.cost_100m_krw ?? null,
      task_group: r.task_group ?? null,
      source_id: r.source,
      locator: r.locator ?? null,
    })),
    stage_events: stageEvents,
    milestones,
    lines,
    stations,
    regions: regionCodes(p.regions, where, report),
    // 관계는 모든 계획을 만든 뒤 update 로 넣는다(서로 가리키는 계획이 있어 생성 순서로 풀 수 없음)
    relations: [],
    geometries,
    watch_keywords: [...new Set(yaml?.gazette_keywords ?? [])],
  };
}

export function planRelations(p: LPlan, planIds: Set<string>, report: MigrationReport): PlanCreate['relations'] {
  const out: PlanCreate['relations'] = [];
  for (const r of p.related_plans ?? []) {
    if (!planIds.has(r.plan_id)) {
      report.add('계획 관계 대상 없음', `${p.id} → ${r.plan_id}`);
      continue;
    }
    if (!r.source) {
      report.add('계획 관계 출처 없음(관계 제외)', `${p.id} → ${r.plan_id}`);
      continue;
    }
    out.push({
      target_plan_id: r.plan_id,
      relation: r.relation as PlanCreate['relations'][number]['relation'],
      note: r.note ?? null,
      source_id: r.source,
    });
  }
  return out;
}
