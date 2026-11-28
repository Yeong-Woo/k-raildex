/**
 * 데이터 스키마 보기(관리 앱 "데이터 스키마", 2026-11-28 사용자 지시).
 * - schemaGraph: public·osm 스키마의 표·열·기본 키·외래 키 + 외래 키 없는 논리 관계(다형 entity_id, OSM id 배열)
 * - schemaTrace: 한 개체(계획·노선·노선역·역 그룹·시설)에서 출발해 계획 → 노선 → 노선역 → 역 그룹 → 시설 →
 *   지도 선형(OSM way·계획 선형) → OSM relation 까지 실제 데이터 관계를 그래프(노드·간선)로 돌려준다.
 *   OSM 좌표는 돌려주지 않는다(개수·길이·태그 이름만, C-6).
 * - schemaCases: 다양한 경우의 예시 개체를 DB 에서 골라 준다.
 */
import type { QueryResultRow } from 'pg';
import type { Queryable } from './db';
import { DomainError } from './errors';
import { ENTITY_SPECS } from './mapping';

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  pk: boolean;
}
export interface SchemaTable {
  schema: string;
  name: string;
  kind: 'table' | 'view';
  /** 이 표를 원천으로 쓰는 개체 종류(entity_type) */
  entity_type: string | null;
  /** 대략적인 행 수(pg_class.reltuples, 뷰는 null) */
  rows: number | null;
  columns: SchemaColumn[];
}
export interface SchemaRelation {
  from_table: string;
  from_columns: string[];
  to_table: string;
  to_columns: string[];
  /** fk = 외래 키 제약, logical = 제약 없는 논리 관계 */
  kind: 'fk' | 'logical';
  note?: string;
}
export interface SchemaGraph {
  tables: SchemaTable[];
  relations: SchemaRelation[];
}

const qualified = (schema: string, name: string) => (schema === 'public' ? name : `${schema}.${name}`);

/** 외래 키 제약이 없는 논리 관계 */
const LOGICAL: SchemaRelation[] = [
  {
    from_table: 'line_osm_map',
    from_columns: ['relation_ids'],
    to_table: 'osm.relation',
    to_columns: ['id'],
    kind: 'logical',
    note: 'bigint[] — OSM relation id',
  },
  {
    from_table: 'line_osm_map',
    from_columns: ['way_ids'],
    to_table: 'osm.way',
    to_columns: ['id'],
    kind: 'logical',
    note: 'bigint[] — 개별 지정 way',
  },
  {
    from_table: 'line_osm_map',
    from_columns: ['way_names'],
    to_table: 'osm.way',
    to_columns: ['tags'],
    kind: 'logical',
    note: 'way 이름(name 태그) 일치',
  },
  {
    from_table: 'line_osm_map',
    from_columns: ['share_with'],
    to_table: 'line',
    to_columns: ['id'],
    kind: 'logical',
    note: 'text[] — 선형을 함께 쓰는 노선',
  },
  {
    from_table: 'osm.relation_member',
    from_columns: ['way_id'],
    to_table: 'osm.way',
    to_columns: ['id'],
    kind: 'logical',
    note: '추출에 없는 way 도 있음',
  },
  {
    from_table: 'plan_geometry',
    from_columns: ['via_station_ids'],
    to_table: 'station',
    to_columns: ['id'],
    kind: 'logical',
    note: 'text[] — 개략 선형 경유 역',
  },
  ...['entity_name', 'external_ref', 'record_source', 'entity_attachment', 'event_target', 'change_op'].map(
    (t): SchemaRelation => ({
      from_table: t,
      from_columns: ['entity_id'],
      to_table: '*',
      to_columns: ['id'],
      kind: 'logical',
      note: '다형 — entity_type 열이 대상 표를 정함',
    }),
  ),
];

export async function schemaGraph(db: Queryable): Promise<SchemaGraph> {
  const entityOf = new Map<string, string>();
  for (const [type, spec] of Object.entries(ENTITY_SPECS)) entityOf.set(spec.table, type);
  const cols = await db.query<{
    schema: string;
    table: string;
    kind: string;
    column: string;
    type: string;
    nullable: boolean;
    pk: boolean;
    rows: number | null;
  }>(
    `SELECT n.nspname AS schema, c.relname AS table, CASE WHEN c.relkind IN ('v','m') THEN 'view' ELSE 'table' END AS kind,
            a.attname AS column, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable,
            coalesce(a.attnum = ANY (i.indkey::int2[]), false) AS pk,
            CASE WHEN c.relkind = 'r' THEN greatest(c.reltuples, 0)::bigint END AS rows
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
      WHERE n.nspname IN ('public', 'osm') AND c.relkind IN ('r', 'v', 'm')
        AND c.relname NOT IN ('spatial_ref_sys', 'geometry_columns', 'geography_columns', '_migrations', 'schema_migrations')
      ORDER BY n.nspname, c.relname, a.attnum`,
  );
  const tables = new Map<string, SchemaTable>();
  for (const r of cols.rows) {
    const key = qualified(r.schema, r.table);
    let t = tables.get(key);
    if (!t) {
      t = {
        schema: r.schema,
        name: key,
        kind: r.kind as 'table' | 'view',
        entity_type: r.schema === 'public' ? (entityOf.get(r.table) ?? null) : null,
        rows: r.rows == null ? null : Number(r.rows),
        columns: [],
      };
      tables.set(key, t);
    }
    t.columns.push({ name: r.column, type: r.type, nullable: r.nullable, pk: r.pk });
  }
  const fks = await db.query<{ fs: string; ft: string; fc: string[]; ts: string; tt: string; tc: string[] }>(
    `SELECT fn.nspname AS fs, f.relname AS ft,
            array(SELECT attname FROM unnest(con.conkey) WITH ORDINALITY k(n, o) JOIN pg_attribute ON attrelid = con.conrelid AND attnum = k.n ORDER BY o)::text[] AS fc,
            tn.nspname AS ts, t.relname AS tt,
            array(SELECT attname FROM unnest(con.confkey) WITH ORDINALITY k(n, o) JOIN pg_attribute ON attrelid = con.confrelid AND attnum = k.n ORDER BY o)::text[] AS tc
       FROM pg_constraint con
       JOIN pg_class f ON f.oid = con.conrelid JOIN pg_namespace fn ON fn.oid = f.relnamespace
       JOIN pg_class t ON t.oid = con.confrelid JOIN pg_namespace tn ON tn.oid = t.relnamespace
      WHERE con.contype = 'f' AND fn.nspname IN ('public', 'osm')
      ORDER BY 1, 2, 3`,
  );
  const relations: SchemaRelation[] = fks.rows
    .map((r): SchemaRelation => ({
      from_table: qualified(r.fs, r.ft),
      from_columns: r.fc,
      to_table: qualified(r.ts, r.tt),
      to_columns: r.tc,
      kind: 'fk',
    }))
    .filter((r) => tables.has(r.from_table) && tables.has(r.to_table));
  for (const l of LOGICAL)
    if (tables.has(l.from_table) && (l.to_table === '*' || tables.has(l.to_table))) relations.push(l);
  return { tables: [...tables.values()], relations };
}

// ---------------------------------------------------------------------------
// 관계 추적
// ---------------------------------------------------------------------------

/** 노드 층(왼쪽 → 오른쪽 그리기 순서) */
export const TRACE_LAYERS = ['plan', 'line', 'line_station', 'station', 'facility', 'map', 'osm_relation'] as const;
export type TraceLayer = (typeof TRACE_LAYERS)[number];

export interface TraceNode {
  key: string;
  layer: TraceLayer;
  /** 관리 앱 개체 종류(링크용). 지도·OSM 노드는 null */
  entity_type: string | null;
  id: string;
  label: string;
  sub: string | null;
  /** 저장 위치(표·뷰) */
  table: string;
}
export interface TraceEdge {
  from: string;
  to: string;
  label: string;
  /** 관계가 저장된 표·열 */
  via: string;
}
export interface SchemaTrace {
  root: string;
  nodes: TraceNode[];
  edges: TraceEdge[];
  /** 노드 수 제한으로 줄인 것 */
  truncated: string[];
}

export const TRACE_ROOT_TYPES = ['plan', 'line', 'line_station', 'station', 'facility'] as const;
export type TraceRootType = (typeof TRACE_ROOT_TYPES)[number];

/** 노선 하나에서 보여 줄 노선역 수(앞·뒤 절반씩) */
const LS_SAMPLE = 8;
const MAX_LINES = 12;

class TraceBuilder {
  readonly nodes = new Map<string, TraceNode>();
  readonly edges: TraceEdge[] = [];
  readonly truncated: string[] = [];
  private readonly edgeKeys = new Set<string>();
  node(n: TraceNode): string {
    if (!this.nodes.has(n.key)) this.nodes.set(n.key, n);
    return n.key;
  }
  edge(from: string, to: string, label: string, via: string) {
    const k = `${from}|${to}|${label}`;
    if (this.edgeKeys.has(k)) return;
    this.edgeKeys.add(k);
    this.edges.push({ from, to, label, via });
  }
}

const notFound = (type: string, id: string) => new DomainError('not_found', `${type} ${id} 가 없음`);

export async function schemaTrace(db: Queryable, type: TraceRootType, id: string): Promise<SchemaTrace> {
  const b = new TraceBuilder();
  const one = async <T extends QueryResultRow>(sql: string, params: unknown[]) =>
    (await db.query<T>(sql, params)).rows[0];
  const lineNode = async (lineId: string): Promise<string | null> => {
    const l = await one<{ id: string; name_ko: string; status: string; line_role: string | null }>(
      `SELECT id, name_ko, status, line_role FROM line WHERE id = $1 AND deleted_at IS NULL`,
      [lineId],
    );
    if (!l) return null;
    return b.node({
      key: `line:${l.id}`,
      layer: 'line',
      entity_type: 'line',
      id: l.id,
      label: l.name_ko,
      sub: [l.status, l.line_role].filter(Boolean).join(' · '),
      table: 'line',
    });
  };
  const stationNode = async (stationId: string): Promise<string | null> => {
    const s = await one<{ id: string; name_ko: string; kind: string; status: string | null }>(
      `SELECT s.id, s.name_ko, s.kind, coalesce(v.status, s.own_status) AS status
         FROM station s LEFT JOIN v_station_status v ON v.station_id = s.id WHERE s.id = $1 AND s.deleted_at IS NULL`,
      [stationId],
    );
    if (!s) return null;
    return b.node({
      key: `station:${s.id}`,
      layer: 'station',
      entity_type: 'station',
      id: s.id,
      label: s.name_ko,
      sub: [s.kind, s.status].filter(Boolean).join(' · '),
      table: 'station',
    });
  };
  const lsNode = (r: { id: string; name: string; seq: number; km: string | null; status: string }) =>
    b.node({
      key: `line_station:${r.id}`,
      layer: 'line_station',
      entity_type: 'line_station',
      id: r.id,
      label: `${r.seq}. ${r.name}`,
      sub: [r.status, r.km != null ? `${Number(r.km)} km` : null].filter(Boolean).join(' · '),
      table: 'line_station',
    });

  /** 노선 아래: 노선역(표본)·역 그룹·시설·본선·지도 선형·OSM relation */
  const expandLine = async (lineId: string, depth: number, sample = LS_SAMPLE) => {
    const lk = await lineNode(lineId);
    if (!lk) return;
    const ls = await db.query<{
      id: string;
      name: string;
      seq: number;
      km: string | null;
      status: string;
      station_id: string;
    }>(
      `SELECT ls.id, coalesce(ls.name_ko, s.name_ko) AS name, ls.seq, ls.km::text, ls.status, ls.station_id
         FROM line_station ls JOIN station s ON s.id = ls.station_id
        WHERE ls.line_id = $1 AND ls.deleted_at IS NULL ORDER BY ls.seq`,
      [lineId],
    );
    const rows = ls.rows;
    const pick = depth > 0 || rows.length <= sample ? rows : [...rows.slice(0, sample / 2), ...rows.slice(-sample / 2)];
    if (pick.length < rows.length) b.truncated.push(`${lineId}: 노선역 ${rows.length}개 중 앞뒤 ${pick.length}개`);
    for (const r of depth > 0 ? [] : pick) {
      const k = lsNode(r);
      b.edge(lk, k, '노선역', 'line_station.line_id');
      const sk = await stationNode(r.station_id);
      if (sk) b.edge(k, sk, '역 그룹', 'line_station.station_id');
    }
    if (depth > 0 && rows.length > 0) {
      const ck = b.node({
        key: `ls-count:${lineId}`,
        layer: 'line_station',
        entity_type: null,
        id: lineId,
        label: `노선역 ${rows.length}개`,
        sub: '펼치려면 이 노선에서 시작',
        table: 'line_station',
      });
      b.edge(lk, ck, '노선역', 'line_station.line_id');
    }
    // 본선·합칠 노선
    const rel = await one<{ branch_of_id: string | null; parent_line_id: string | null }>(
      `SELECT branch_of_id, parent_line_id FROM line WHERE id = $1`,
      [lineId],
    );
    for (const [col, label] of [
      ['branch_of_id', '본선(지선의)'],
      ['parent_line_id', '합칠 노선'],
    ] as const) {
      const target = rel?.[col];
      if (target) {
        const tk = await lineNode(target);
        if (tk) b.edge(lk, tk, label, `line.${col}`);
      }
    }
    const branches = await db.query<{ id: string }>(
      `SELECT id FROM line WHERE branch_of_id = $1 AND deleted_at IS NULL ORDER BY id`,
      [lineId],
    );
    for (const br of branches.rows.slice(0, 6)) {
      const bk = await lineNode(br.id);
      if (bk) b.edge(bk, lk, '본선(지선의)', 'line.branch_of_id');
    }
    // 시설
    const fac = await db.query<{ id: string; name_ko: string; kind: string; role: string }>(
      `SELECT f.id, f.name_ko, f.kind, fl.role FROM facility_line fl JOIN facility f ON f.id = fl.facility_id
        WHERE fl.line_id = $1 AND f.deleted_at IS NULL ORDER BY fl.role, f.id LIMIT 12`,
      [lineId],
    );
    for (const f of fac.rows) {
      const fk = b.node({
        key: `facility:${f.id}`,
        layer: 'facility',
        entity_type: 'facility',
        id: f.id,
        label: f.name_ko,
        sub: f.kind,
        table: 'facility',
      });
      b.edge(fk, lk, f.role === 'serves' ? '담당 노선' : '붙은 선로', 'facility_line');
    }
    // 지도: OSM 선형(v_line_way)·계획 선형(v_line_plan_shape)
    const way = await one<{ n: number; km: number | null; cons: number }>(
      `SELECT count(*)::int AS n, round((sum(st_length(geom::geography)) / 1000)::numeric, 1)::float AS km,
              count(*) FILTER (WHERE is_construction)::int AS cons
         FROM osm.v_line_way WHERE line_id = $1`,
      [lineId],
    );
    const om = await one<{ relation_ids: string[]; way_names: string[]; way_ids: string[]; share_with: string[] }>(
      `SELECT relation_ids::text[], way_names, way_ids::text[], share_with FROM line_osm_map WHERE line_id = $1`,
      [lineId],
    );
    if (way && (way.n > 0 || om)) {
      const mk = b.node({
        key: `map:${lineId}`,
        layer: 'map',
        entity_type: null,
        id: lineId,
        label: `OSM 선형 way ${way.n}개`,
        sub: [
          way.km != null ? `${way.km} km` : null,
          way.cons ? `공사 중 ${way.cons}` : null,
          om?.way_names.length ? `이름 ${om.way_names.join('·')}` : null,
          om?.way_ids.length ? `개별 way ${om.way_ids.length}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        table: 'osm.v_line_way',
      });
      b.edge(lk, mk, '지도 선형', 'line_osm_map → osm.v_line_way');
      for (const rid of om?.relation_ids ?? []) {
        const r = await one<{ name: string | null; route: string | null; members: number; have: number }>(
          `SELECT r.tags->>'name' AS name, r.tags->>'route' AS route,
                  (SELECT count(*)::int FROM osm.relation_member m WHERE m.relation_id = r.id) AS members,
                  (SELECT count(*)::int FROM osm.relation_member m JOIN osm.way w ON w.id = m.way_id WHERE m.relation_id = r.id) AS have
             FROM osm.relation r WHERE r.id = $1`,
          [rid],
        );
        const rk = b.node({
          key: `osm_relation:${rid}`,
          layer: 'osm_relation',
          entity_type: null,
          id: rid,
          label: `relation ${rid}`,
          sub: r ? [r.name, r.route, `way ${r.have}/${r.members}`].filter(Boolean).join(' · ') : '추출에 없음',
          table: 'osm.relation',
        });
        b.edge(mk, rk, 'relation_ids', 'line_osm_map.relation_ids');
      }
    }
    const ps = await db.query<{ plan_id: string; quality: string }>(
      `SELECT plan_id, quality FROM v_line_plan_shape WHERE line_id = $1 AND geom IS NOT NULL`,
      [lineId],
    );
    for (const p of ps.rows) {
      const pk = b.node({
        key: `planshape:${p.plan_id}`,
        layer: 'map',
        entity_type: null,
        id: p.plan_id,
        label: '계획 선형',
        sub: `${p.plan_id} · ${p.quality}`,
        table: 'v_line_plan_shape',
      });
      b.edge(lk, pk, '계획 선형', 'v_line_plan_shape');
    }
  };

  const planNode = async (planId: string): Promise<string | null> => {
    const p = await one<{ id: string; name_ko: string; stage: string | null }>(
      `SELECT p.id, p.name_ko, v.stage FROM plan p LEFT JOIN v_plan_stage v ON v.plan_id = p.id WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [planId],
    );
    if (!p) return null;
    return b.node({
      key: `plan:${p.id}`,
      layer: 'plan',
      entity_type: 'plan',
      id: p.id,
      label: p.name_ko,
      sub: p.stage,
      table: 'plan',
    });
  };
  /** 노선을 가리키는 계획들 */
  const plansOfLine = async (lineId: string) => {
    const pls = await db.query<{ plan_id: string; role: string }>(
      `SELECT plan_id, role FROM plan_line WHERE line_id = $1 ORDER BY plan_id LIMIT 8`,
      [lineId],
    );
    for (const p of pls.rows) {
      const pk = await planNode(p.plan_id);
      if (pk) b.edge(pk, `line:${lineId}`, `plan_line ${p.role}`, 'plan_line');
    }
  };

  switch (type) {
    case 'plan': {
      const pk = await planNode(id);
      if (!pk) throw notFound(type, id);
      const pl = await db.query<{ line_id: string; role: string; from_ls: string | null; to_ls: string | null }>(
        `SELECT line_id, role, from_line_station_id AS from_ls, to_line_station_id AS to_ls FROM plan_line WHERE plan_id = $1 ORDER BY line_id`,
        [id],
      );
      for (const l of pl.rows.slice(0, MAX_LINES)) {
        await expandLine(l.line_id, 0, pl.rows.length > 3 ? 4 : LS_SAMPLE);
        b.edge(pk, `line:${l.line_id}`, `plan_line ${l.role}`, 'plan_line');
      }
      if (pl.rows.length > MAX_LINES) b.truncated.push(`계획 노선 ${pl.rows.length}개 중 ${MAX_LINES}개`);
      const pst = await db.query<{ station_id: string; role: string }>(
        `SELECT station_id, role FROM plan_station WHERE plan_id = $1 ORDER BY station_id LIMIT 20`,
        [id],
      );
      for (const s of pst.rows) {
        const sk = await stationNode(s.station_id);
        if (sk) b.edge(pk, sk, `plan_station ${s.role}`, 'plan_station');
      }
      const shape = await one<{ quality: string; odbl: boolean }>(
        `SELECT quality, odbl FROM v_plan_shape WHERE plan_id = $1 AND geom IS NOT NULL`,
        [id],
      );
      const geoms = await db.query<{ id: string; kind: string }>(
        `SELECT id, kind FROM plan_geometry WHERE plan_id = $1 AND deleted_at IS NULL ORDER BY id`,
        [id],
      );
      if (shape || geoms.rows.length) {
        const sk = b.node({
          key: `planshape:${id}`,
          layer: 'map',
          entity_type: null,
          id,
          label: '계획 선형',
          sub: [
            shape ? `${shape.quality}${shape.odbl ? ' (OSM 유래)' : ''}` : null,
            ...geoms.rows.map((g) => `plan_geometry ${g.kind}`),
          ]
            .filter(Boolean)
            .join(' · '),
          table: 'v_plan_shape · plan_geometry',
        });
        b.edge(pk, sk, '지도', 'v_plan_shape');
      }
      break;
    }
    case 'line': {
      await expandLine(id, 0);
      if (!b.nodes.has(`line:${id}`)) throw notFound(type, id);
      await plansOfLine(id);
      break;
    }
    case 'line_station':
    case 'station': {
      let stationId = id;
      if (type === 'line_station') {
        const r = await one<{ station_id: string }>(
          `SELECT station_id FROM line_station WHERE id = $1 AND deleted_at IS NULL`,
          [id],
        );
        if (!r) throw notFound(type, id);
        stationId = r.station_id;
      }
      const sk = await stationNode(stationId);
      if (!sk) throw notFound('station', stationId);
      const ls = await db.query<{
        id: string;
        name: string;
        seq: number;
        km: string | null;
        status: string;
        line_id: string;
      }>(
        `SELECT ls.id, coalesce(ls.name_ko, s.name_ko) AS name, ls.seq, ls.km::text, ls.status, ls.line_id
           FROM line_station ls JOIN station s ON s.id = ls.station_id
          WHERE ls.station_id = $1 AND ls.deleted_at IS NULL ORDER BY ls.line_id`,
        [stationId],
      );
      for (const r of ls.rows) {
        const k = lsNode(r);
        b.edge(k, sk, '역 그룹', 'line_station.station_id');
        await expandLine(r.line_id, 1);
        b.edge(`line:${r.line_id}`, k, '노선역', 'line_station.line_id');
        await plansOfLine(r.line_id);
      }
      const pst = await db.query<{ plan_id: string; role: string }>(
        `SELECT plan_id, role FROM plan_station WHERE station_id = $1 ORDER BY plan_id LIMIT 10`,
        [stationId],
      );
      for (const p of pst.rows) {
        const pk = await planNode(p.plan_id);
        if (pk) b.edge(pk, sk, `plan_station ${p.role}`, 'plan_station');
      }
      break;
    }
    case 'facility': {
      const f = await one<{ id: string; name_ko: string; kind: string }>(
        `SELECT id, name_ko, kind FROM facility WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (!f) throw notFound(type, id);
      const fk = b.node({
        key: `facility:${f.id}`,
        layer: 'facility',
        entity_type: 'facility',
        id: f.id,
        label: f.name_ko,
        sub: f.kind,
        table: 'facility',
      });
      const fl = await db.query<{ line_id: string }>(
        `SELECT line_id FROM facility_line WHERE facility_id = $1 ORDER BY ord`,
        [id],
      );
      for (const l of fl.rows) await expandLine(l.line_id, 1);
      const fw = await one<{ n: number; by_name: number; by_id: number; by_line: number; by_radius: number }>(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE source = 'names')::int AS by_name,
                count(*) FILTER (WHERE source = 'ways')::int AS by_id, count(*) FILTER (WHERE source = 'depot_line')::int AS by_line, count(*) FILTER (WHERE source = 'yard')::int AS by_radius
           FROM osm.v_facility_way WHERE facility_id = $1`,
        [id],
      );
      if (fw && fw.n > 0) {
        const mk = b.node({
          key: `facmap:${id}`,
          layer: 'map',
          entity_type: null,
          id,
          label: `시설 선로 way ${fw.n}개`,
          sub: `이름 ${fw.by_name} · id ${fw.by_id} · 기지선 ${fw.by_line} · 반경 안 기지 선로 ${fw.by_radius}`,
          table: 'osm.v_facility_way',
        });
        b.edge(fk, mk, '지도 선형', 'facility.osm_map → osm.v_facility_way');
      }
      break;
    }
  }
  return { root: `${type}:${id}`, nodes: [...b.nodes.values()], edges: b.edges, truncated: b.truncated };
}

// ---------------------------------------------------------------------------
// 예시 경우
// ---------------------------------------------------------------------------

export interface SchemaCase {
  key: string;
  label: string;
  desc: string;
  type: TraceRootType;
  id: string | null;
  name: string | null;
}

const CASES: { key: string; label: string; desc: string; type: TraceRootType; sql: string }[] = [
  {
    key: 'plan-extends',
    label: '계획: 기존 노선 연장',
    desc: 'plan_line role=extends — 계획이 기존 노선을 늘린다',
    type: 'plan',
    sql: `SELECT p.id, p.name_ko FROM plan p JOIN plan_line pl ON pl.plan_id = p.id WHERE pl.role = 'extends' AND p.deleted_at IS NULL ORDER BY (SELECT count(*) FROM plan_station x WHERE x.plan_id = p.id) DESC, p.id LIMIT 1`,
  },
  {
    key: 'plan-new',
    label: '계획: 새 노선 + 계획 선형',
    desc: 'plan_line role=new, plan_geometry 가 있는 계획',
    type: 'plan',
    sql: `SELECT p.id, p.name_ko FROM plan p JOIN plan_line pl ON pl.plan_id = p.id JOIN plan_geometry g ON g.plan_id = p.id AND g.deleted_at IS NULL WHERE pl.role = 'new' AND p.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM plan_line o WHERE o.plan_id = p.id AND o.role <> 'new') AND EXISTS (SELECT 1 FROM line_station x WHERE x.line_id = pl.line_id AND x.deleted_at IS NULL) ORDER BY p.id LIMIT 1`,
  },
  {
    key: 'plan-multi',
    label: '계획: 여러 노선에 걸침',
    desc: 'plan_line 이 3개 이상(new·upgrades·shares 섞임)',
    type: 'plan',
    sql: `SELECT p.id, p.name_ko FROM plan p JOIN plan_line pl ON pl.plan_id = p.id WHERE p.deleted_at IS NULL GROUP BY p.id ORDER BY count(DISTINCT pl.role) DESC, count(*) DESC, p.id LIMIT 1`,
  },
  {
    key: 'transfer',
    label: '역 그룹: 환승(노선역 여럿)',
    desc: '한 역 그룹에 노선역이 가장 많은 경우',
    type: 'station',
    sql: `SELECT s.id, s.name_ko FROM station s JOIN line_station ls ON ls.station_id = s.id AND ls.deleted_at IS NULL WHERE s.deleted_at IS NULL GROUP BY s.id ORDER BY count(*) DESC, s.id LIMIT 1`,
  },
  {
    key: 'osm-relations',
    label: '노선: OSM relation 여러 개',
    desc: 'line_osm_map.relation_ids 가 가장 많은 노선',
    type: 'line',
    sql: `SELECT l.id, l.name_ko FROM line l JOIN line_osm_map m ON m.line_id = l.id WHERE l.deleted_at IS NULL ORDER BY cardinality(m.relation_ids) DESC, l.id LIMIT 1`,
  },
  {
    key: 'osm-names',
    label: '노선: way 이름으로만 선형',
    desc: 'relation 없이 way_names·bbox 로 OSM 선형을 고른 노선(공사 중 등)',
    type: 'line',
    sql: `SELECT l.id, l.name_ko FROM line l JOIN line_osm_map m ON m.line_id = l.id WHERE l.deleted_at IS NULL AND cardinality(m.relation_ids) = 0 AND cardinality(m.way_names) > 0 AND l.status = 'under_construction' ORDER BY l.id LIMIT 1`,
  },
  {
    key: 'old-line',
    label: '노선: 옛 노선(폐선)',
    desc: '폐역 노선역을 가진 폐선 노선(중앙선(구) 등)',
    type: 'line',
    sql: `SELECT l.id, l.name_ko FROM line l WHERE l.deleted_at IS NULL AND l.status = 'closed' ORDER BY (SELECT count(*) FROM line_station x WHERE x.line_id = l.id AND x.deleted_at IS NULL) DESC, l.id LIMIT 1`,
  },
  {
    key: 'branch',
    label: '노선: 지선이 많은 본선',
    desc: 'line.branch_of_id 로 이어진 지선·연결선·기지선',
    type: 'line',
    sql: `SELECT b.id, b.name_ko FROM line l JOIN line b ON b.id = l.branch_of_id WHERE l.deleted_at IS NULL GROUP BY b.id ORDER BY count(*) DESC, b.id LIMIT 1`,
  },
  {
    key: 'depot',
    label: '시설: 차량기지와 기지선',
    desc: 'facility_line connects 로 기지선(line_role=depot_line)이 붙은 차량기지',
    type: 'facility',
    sql: `SELECT f.id, f.name_ko FROM facility f JOIN facility_line fl ON fl.facility_id = f.id JOIN line l ON l.id = fl.line_id WHERE f.deleted_at IS NULL AND f.kind = 'depot' AND l.line_role = 'depot_line' ORDER BY f.id LIMIT 1`,
  },
  {
    key: 'signal-box',
    label: '시설: 신호장',
    desc: '역 그룹에서 시설로 옮긴 신호장(노선 위치는 facility_line.note)',
    type: 'facility',
    sql: `SELECT f.id, f.name_ko FROM facility f WHERE f.deleted_at IS NULL AND f.kind = 'signal_box' AND EXISTS (SELECT 1 FROM facility_line x WHERE x.facility_id = f.id) ORDER BY f.id LIMIT 1`,
  },
  {
    key: 'construction-station',
    label: '노선역: 공사 중 정거장',
    desc: '공사 중 노선의 정거장(가칭) — 계획·노선·역 그룹이 함께',
    type: 'line_station',
    sql: `SELECT ls.id, s.name_ko FROM line_station ls JOIN station s ON s.id = ls.station_id JOIN plan_station ps ON ps.station_id = s.id WHERE ls.deleted_at IS NULL AND ls.status = 'under_construction' ORDER BY ls.id LIMIT 1`,
  },
];

export async function schemaCases(db: Queryable): Promise<SchemaCase[]> {
  const out: SchemaCase[] = [];
  for (const c of CASES) {
    const r = (await db.query<{ id: string; name_ko: string }>(c.sql)).rows[0];
    out.push({ key: c.key, label: c.label, desc: c.desc, type: c.type, id: r?.id ?? null, name: r?.name_ko ?? null });
  }
  return out;
}
