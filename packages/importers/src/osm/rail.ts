/**
 * osm-rail 수집기(docs/08 3-1, docs/03-data-model.md 4-19): OSM 철도 선형(ODbL)을 `osm` 스키마에 통째로 교체한다.
 * - 입력: 기존 저장소 추출 파일(`--from-raw <dir>`, 기본 LEGACY_ROOT/data/osm — fetch-osm-rail.ts 형식)
 *   rail-ways.geojson(way LineString) · rail-construction-kr.geojson(전국 공사 중 way, rail-ways 에 없는 것만 더함) ·
 *   rail-routes.json(relation 태그 + member way id) · manifest.json(쿼리 원문·추출 시각)
 *   또는 `--live`: Overpass API 를 직접 부른다(fetch-osm-rail.ts 의 쿼리 그대로, node:https — 새 의존성 없음).
 * - 파일(묶음)마다 osm.extract 1행(sha256 = 파일 내용, live 는 응답 본문). way 태그 = 추출 properties(osm_id 제외),
 *   is_construction = railway=construction(construction=* 태그만 있는 운영 way 는 제외, 아래 isConstructionTags). relation_member = member way 순서(seq 1..n).
 *   하위 relation 구성원(route=tracks 의 relation 구성원 등)은 기존 build-map 과 같이 쓰지 않는다(통계만).
 * - OSM 좌표는 osm 스키마에만 둔다(C-6). 자체 테이블에는 쓰지 않는다. 교체는 한 트랜잭션, 끝나면 refresh_derived().
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import type { Queryable } from '@k-raildex/domain';
import type { RunTrigger } from '../core/run';
import { withRun } from '../core/run';

export const OSM_TASK = 'osm-rail';
const DEFAULT_LEGACY_ROOT = '/home/kimyw/Git/future-rail-db';
export const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'k-raildex/0.1 (osm-rail importer)';

export function defaultOsmDir(): string {
  return join(process.env.LEGACY_ROOT ?? DEFAULT_LEGACY_ROOT, 'data/osm');
}

/** fetch-osm-rail.ts 의 쿼리(전국 대한민국 행정 경계) */
export const OSM_QUERIES = {
  ways_capital: `[out:json][timeout:600];
area["ISO3166-1"="KR"]["admin_level"="2"]->.kr;
way(area.kr)["railway"~"^(rail|subway|light_rail|monorail|construction)$"][!"service"][!"railway:preserved"];
out geom;`,
  ways_highspeed: `[out:json][timeout:300];
area["ISO3166-1"="KR"]["admin_level"="2"]->.kr;
way(area.kr)["railway"="rail"]["highspeed"="yes"][!"service"];
out geom;`,
  routes_capital: `[out:json][timeout:600];
area["ISO3166-1"="KR"]["admin_level"="2"]->.kr;
rel(area.kr)["route"~"^(subway|light_rail|train|tracks)$"];
out body;`,
  routes_tracks_kr: `[out:json][timeout:300];
area["ISO3166-1"="KR"]["admin_level"="2"]->.kr;
rel(area.kr)["route"="tracks"];
out body;`,
  /** 노선 relation(route=tracks)의 구성 way 는 service=yard·spur 등(기지선·조차장선·인입선)이어도 받는다 — 시설 선로 노선(2026-11-22). 역 대피선(siding)·건넘선(crossover)은 노선 선형이 아니라 뺀다 */
  ways_tracks_members_kr: `[out:json][timeout:600];
area["ISO3166-1"="KR"]["admin_level"="2"]->.kr;
rel(area.kr)["route"="tracks"]->.t;
way(r.t)["railway"~"^(rail|construction)$"]["service"]["service"!~"^(siding|crossover)$"];
out geom;`,
  ways_construction_kr: `[out:json][timeout:300];
area["ISO3166-1"="KR"]["admin_level"="2"]->.kr;
way(area.kr)["railway"="construction"][!"service"];
out geom;`,
} as const;

// ---------------------------------------------------------------- 입력 형식(fetch-osm-rail.ts)
type Coord = [number, number];
export interface OsmWayFeature {
  type: 'Feature';
  id?: number;
  properties: Record<string, string | number | null | undefined>;
  geometry: { type: 'LineString'; coordinates: Coord[] } | null;
}
export interface OsmWaysFile {
  features: OsmWayFeature[];
  extracted_at?: string;
  osm_base_timestamp?: string | null;
  query?: string;
}
export interface OsmRoute {
  osm_id: number;
  tags: Record<string, string>;
  way_ids: number[];
  relation_ids?: number[];
}
export interface OsmRoutesFile {
  routes: OsmRoute[];
  extracted_at?: string;
}
export interface OsmManifest {
  extracted_at?: string;
  osm_base_timestamp?: string | null;
  endpoint?: string;
  queries?: Record<string, string>;
}

/** 한 묶음(파일) — sha256 은 원문 바이트 기준 */
export interface OsmInputPart<T> {
  name: string;
  data: T;
  sha256: string;
}
export interface OsmInput {
  ways: OsmInputPart<OsmWaysFile>;
  construction?: OsmInputPart<OsmWaysFile>;
  routes: OsmInputPart<OsmRoutesFile>;
  manifest?: OsmManifest | null;
  /** raw | live */
  origin: string;
}

// ---------------------------------------------------------------- 정규화 결과
export interface OsmExtractRow {
  key: 'ways' | 'construction' | 'routes';
  kind: string;
  bbox: [number, number, number, number] | null;
  fetched_at: string;
  overpass_query: string | null;
  sha256: string;
  note: string;
}
export interface OsmWayRow {
  id: number;
  extract: OsmExtractRow['key'];
  tags: Record<string, string>;
  is_construction: boolean;
  coords: Coord[];
}
export interface OsmRelationRow {
  id: number;
  tags: Record<string, string>;
}
export interface OsmMemberRow {
  relation_id: number;
  way_id: number;
  role: string | null;
  seq: number;
}
export interface OsmDataset {
  extracts: OsmExtractRow[];
  ways: OsmWayRow[];
  relations: OsmRelationRow[];
  members: OsmMemberRow[];
  stats: {
    ways: number;
    ways_construction: number;
    ways_from_construction_file: number;
    ways_skipped: number;
    ways_by_railway: Record<string, number>;
    relations: number;
    relation_members: number;
    members_missing_way: number;
    sub_relation_members_skipped: number;
  };
}

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

function dedupe(coords: Coord[]): Coord[] {
  const out: Coord[] = [];
  for (const c of coords) {
    const last = out[out.length - 1];
    if (!last || last[0] !== c[0] || last[1] !== c[1]) out.push(c);
  }
  return out;
}

function validCoord(c: unknown): c is Coord {
  return (
    Array.isArray(c) &&
    typeof c[0] === 'number' &&
    typeof c[1] === 'number' &&
    Number.isFinite(c[0]) &&
    Number.isFinite(c[1]) &&
    Math.abs(c[0]) <= 180 &&
    Math.abs(c[1]) <= 90
  );
}

function wayTags(p: OsmWayFeature['properties']): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'osm_id' || v === null || v === undefined) continue;
    tags[k] = String(v);
  }
  return tags;
}

/**
 * 공사 중 = railway=construction(기존 build-map 규칙). construction=* 태그만 있는 운영 way(railway=rail + construction=rail,
 * 2026-10 추출에서 중앙선 254 등 264건 — 복선화 뒤 남은 태그)는 운영 선형으로 둔다. 그렇지 않으면 운영 중 노선 선형이 지도에서 빠진다
 */
export function isConstructionTags(tags: Record<string, string>): boolean {
  return tags.railway === 'construction';
}

/** 추출 파일 묶음 → osm 스키마 행(순수 함수) */
export function buildOsmDataset(input: OsmInput): OsmDataset {
  const m = input.manifest ?? null;
  const stats: OsmDataset['stats'] = {
    ways: 0,
    ways_construction: 0,
    ways_from_construction_file: 0,
    ways_skipped: 0,
    ways_by_railway: {},
    relations: 0,
    relation_members: 0,
    members_missing_way: 0,
    sub_relation_members_skipped: 0,
  };
  const ways = new Map<number, OsmWayRow>();
  const bboxOf = new Map<OsmExtractRow['key'], [number, number, number, number]>();
  const addWays = (part: OsmInputPart<OsmWaysFile>, key: 'ways' | 'construction') => {
    for (const f of part.data.features ?? []) {
      const id = Number(f.properties?.osm_id ?? f.id);
      if (!Number.isSafeInteger(id) || id <= 0 || ways.has(id)) {
        if (!ways.has(id)) stats.ways_skipped++;
        continue;
      }
      const raw = f.geometry?.type === 'LineString' ? f.geometry.coordinates : [];
      const coords = dedupe(raw.filter(validCoord).map((c) => [c[0], c[1]] as Coord));
      if (coords.length < 2) {
        stats.ways_skipped++;
        continue;
      }
      const tags = wayTags(f.properties ?? {});
      const row: OsmWayRow = { id, extract: key, tags, is_construction: isConstructionTags(tags), coords };
      ways.set(id, row);
      if (key === 'construction') stats.ways_from_construction_file++;
      const b = bboxOf.get(key) ?? [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of coords) {
        b[0] = Math.min(b[0], x);
        b[1] = Math.min(b[1], y);
        b[2] = Math.max(b[2], x);
        b[3] = Math.max(b[3], y);
      }
      bboxOf.set(key, b);
    }
  };
  addWays(input.ways, 'ways');
  if (input.construction) addWays(input.construction, 'construction');

  const sortedWays = [...ways.values()].sort((a, b) => a.id - b.id);
  for (const w of sortedWays) {
    stats.ways++;
    if (w.is_construction) stats.ways_construction++;
    const r = w.tags.railway ?? '?';
    stats.ways_by_railway[r] = (stats.ways_by_railway[r] ?? 0) + 1;
  }

  const relations = new Map<number, OsmRelationRow>();
  const members: OsmMemberRow[] = [];
  for (const r of input.routes.data.routes ?? []) {
    const id = Number(r.osm_id);
    if (!Number.isSafeInteger(id) || id <= 0 || relations.has(id)) continue;
    relations.set(id, { id, tags: Object.fromEntries(Object.entries(r.tags ?? {}).map(([k, v]) => [k, String(v)])) });
    let seq = 0;
    for (const wid of r.way_ids ?? []) {
      if (!Number.isSafeInteger(wid) || wid <= 0) continue;
      members.push({ relation_id: id, way_id: wid, role: null, seq: ++seq });
      if (!ways.has(wid)) stats.members_missing_way++;
    }
    stats.sub_relation_members_skipped += r.relation_ids?.length ?? 0;
  }
  stats.relations = relations.size;
  stats.relation_members = members.length;

  const round = (b: [number, number, number, number] | undefined) =>
    b && Number.isFinite(b[0]) ? (b.map((v) => Math.round(v * 1e6) / 1e6) as [number, number, number, number]) : null;
  // fetched_at = 추출(호출) 시각. OSM 데이터 기준 시각(osm_base_timestamp)은 note 에 남긴다
  const when = (d: { extracted_at?: string }) => d.extracted_at ?? m?.extracted_at ?? new Date().toISOString();
  const base = (d: { osm_base_timestamp?: string | null }) => d.osm_base_timestamp ?? m?.osm_base_timestamp ?? '미기록';
  const q = (...keys: string[]) => {
    const parts = keys.map((k) => m?.queries?.[k]).filter((x): x is string => !!x);
    return parts.length ? parts.join('\n\n') : null;
  };
  const extracts: OsmExtractRow[] = [
    {
      key: 'ways',
      kind: 'ways',
      bbox: round(bboxOf.get('ways')),
      fetched_at: when(input.ways.data),
      overpass_query: input.ways.data.query ?? q('ways_capital', 'ways_highspeed'),
      sha256: input.ways.sha256,
      note: `${input.origin}: ${input.ways.name} (OSM 기준 ${base(input.ways.data)})`,
    },
  ];
  if (input.construction)
    extracts.push({
      key: 'construction',
      kind: 'construction',
      bbox: round(bboxOf.get('construction')),
      fetched_at: when(input.construction.data),
      overpass_query: input.construction.data.query ?? q('ways_construction_kr'),
      sha256: input.construction.sha256,
      note: `${input.origin}: ${input.construction.name} (OSM 기준 ${base(input.construction.data)}, ${input.ways.name} 에 없는 way ${stats.ways_from_construction_file})`,
    });
  extracts.push({
    key: 'routes',
    kind: 'routes',
    bbox: null,
    fetched_at: when(input.routes.data),
    overpass_query: q('routes_capital', 'routes_tracks_kr'),
    sha256: input.routes.sha256,
    note: `${input.origin}: ${input.routes.name} (OSM 기준 ${base({})})`,
  });
  return {
    extracts,
    ways: sortedWays,
    relations: [...relations.values()].sort((a, b) => a.id - b.id),
    members,
    stats,
  };
}

// ---------------------------------------------------------------- 입력 읽기
function readPart<T>(dir: string, name: string, required: boolean): OsmInputPart<T> | undefined {
  const path = join(dir, name);
  if (!existsSync(path)) {
    if (required) throw new Error(`OSM 추출 파일 없음: ${path}`);
    return undefined;
  }
  const buf = readFileSync(path);
  return { name, data: JSON.parse(buf.toString('utf-8')) as T, sha256: sha256(buf) };
}

export function readOsmRaw(dir: string): OsmInput {
  const manifest = readPart<OsmManifest>(dir, 'manifest.json', false)?.data ?? null;
  return {
    ways: readPart<OsmWaysFile>(dir, 'rail-ways.geojson', true)!,
    construction: readPart<OsmWaysFile>(dir, 'rail-construction-kr.geojson', false),
    routes: readPart<OsmRoutesFile>(dir, 'rail-routes.json', true)!,
    manifest,
    origin: `raw ${dir}`,
  };
}

// ---------------------------------------------------------------- 실시간(Overpass)
interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; ref: number; role: string }[];
}
interface OverpassResponse {
  elements: OverpassElement[];
  osm3s?: { timestamp_osm_base?: string };
}
/** POST(form) → { status, text }. 시험에서는 가짜를 넣는다 */
export type OverpassPost = (endpoint: string, query: string) => Promise<{ status: number; text: string }>;

/** 기존 스크립트와 같이 node:https · IPv4 우선(이 환경의 undici fetch ETIMEDOUT 회피) */
export const httpsOverpassPost: OverpassPost = (endpoint, query) =>
  new Promise((resolve, reject) => {
    const body = `data=${encodeURIComponent(query)}`;
    const u = new URL(endpoint);
    const req = httpsRequest(
      {
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
        method: 'POST',
        family: 4,
        timeout: 330_000,
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf-8') }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });

const WAY_TAGS = [
  'railway',
  'name',
  'name:ko',
  'name:en',
  'ref',
  'usage',
  'service',
  'highspeed',
  'electrified',
  'construction',
  'bridge',
  'tunnel',
  /** 입체 구분(지하 −1·−2, 고가 1) — 겹친 노선이 공용 선로인지 층이 다른지 가리는 데 쓴다 */
  'layer',
] as const;
const REL_TAGS = ['type', 'route', 'name', 'name:ko', 'name:en', 'ref', 'colour', 'operator', 'network', 'from', 'to'];

async function overpass(
  post: OverpassPost,
  endpoint: string,
  name: string,
  query: string,
  log: (m: string) => void,
  opts: { attempts: number; waitMs: number },
): Promise<{ json: OverpassResponse; text: string }> {
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    const res = await post(endpoint, query);
    if (res.status === 200) {
      const json = JSON.parse(res.text) as OverpassResponse;
      log(`[${name}] ${json.elements.length} elements`);
      return { json, text: res.text };
    }
    const retryable = res.status === 429 || res.status >= 500;
    log(`[${name}] HTTP ${res.status} (시도 ${attempt})`);
    if (!retryable || attempt === opts.attempts) throw new Error(`Overpass ${name} 실패: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, opts.waitMs * attempt));
  }
  throw new Error('unreachable');
}

function waysToFile(elements: OverpassElement[], extra: Partial<OsmWaysFile>): OsmWaysFile {
  const features: OsmWayFeature[] = [];
  for (const w of elements) {
    if (w.type !== 'way' || !w.geometry || w.geometry.length < 2) continue;
    const properties: OsmWayFeature['properties'] = { osm_id: w.id };
    for (const k of WAY_TAGS) if (w.tags?.[k] !== undefined) properties[k] = w.tags[k];
    const coords = w.geometry.map((p) => [Math.round(p.lon * 1e6) / 1e6, Math.round(p.lat * 1e6) / 1e6] as Coord);
    features.push({ type: 'Feature', id: w.id, properties, geometry: { type: 'LineString', coordinates: coords } });
  }
  features.sort((a, b) => Number(a.id) - Number(b.id));
  return { features, ...extra };
}

/** Overpass 6회 호출 → raw 와 같은 입력 묶음 */
export async function fetchOsmLive(
  opts: {
    endpoint?: string;
    post?: OverpassPost;
    log?: (m: string) => void;
    pauseMs?: number;
    retry?: { attempts: number; waitMs: number };
  } = {},
): Promise<OsmInput> {
  const endpoint = opts.endpoint ?? OVERPASS_ENDPOINT;
  const post = opts.post ?? httpsOverpassPost;
  const log = opts.log ?? (() => {});
  const retry = opts.retry ?? { attempts: 6, waitMs: 15_000 };
  const pause = () => new Promise((r) => setTimeout(r, opts.pauseMs ?? 3000));
  const results: Partial<Record<keyof typeof OSM_QUERIES, { json: OverpassResponse; text: string }>> = {};
  const keys = Object.keys(OSM_QUERIES) as (keyof typeof OSM_QUERIES)[];
  for (const [i, k] of keys.entries()) {
    if (i) await pause();
    results[k] = await overpass(post, endpoint, k, OSM_QUERIES[k], log, retry);
  }
  const r = results as Record<keyof typeof OSM_QUERIES, { json: OverpassResponse; text: string }>;
  const fetchedAt = new Date().toISOString();
  const base = (...ks: (keyof typeof OSM_QUERIES)[]) =>
    ks
      .map((k) => r[k].json.osm3s?.timestamp_osm_base)
      .filter(Boolean)
      .sort()[0] ?? null;
  const hash = (...ks: (keyof typeof OSM_QUERIES)[]) => sha256(ks.map((k) => r[k].text).join('\n'));
  const waysMap = new Map<number, OverpassElement>();
  for (const el of [
    ...r.ways_capital.json.elements,
    ...r.ways_highspeed.json.elements,
    ...r.ways_tracks_members_kr.json.elements,
  ])
    if (el.type === 'way') waysMap.set(el.id, el);
  const rels = new Map<number, OverpassElement>();
  for (const el of [...r.routes_capital.json.elements, ...r.routes_tracks_kr.json.elements])
    if (el.type === 'relation') rels.set(el.id, el);
  const routes: OsmRoute[] = [...rels.values()]
    .sort((a, b) => a.id - b.id)
    .map((rel) => {
      const tags: Record<string, string> = {};
      for (const k of REL_TAGS) if (rel.tags?.[k] !== undefined) tags[k] = rel.tags[k];
      return {
        osm_id: rel.id,
        tags,
        way_ids: (rel.members ?? []).filter((x) => x.type === 'way').map((x) => x.ref),
        relation_ids: (rel.members ?? []).filter((x) => x.type === 'relation').map((x) => x.ref),
      };
    });
  return {
    ways: {
      name: 'overpass ways_capital+ways_highspeed+ways_tracks_members_kr',
      data: waysToFile([...waysMap.values()], {
        extracted_at: fetchedAt,
        osm_base_timestamp: base('ways_capital', 'ways_highspeed', 'ways_tracks_members_kr'),
        query: `${OSM_QUERIES.ways_capital}\n\n${OSM_QUERIES.ways_highspeed}\n\n${OSM_QUERIES.ways_tracks_members_kr}`,
      }),
      sha256: hash('ways_capital', 'ways_highspeed', 'ways_tracks_members_kr'),
    },
    construction: {
      name: 'overpass ways_construction_kr',
      data: waysToFile(r.ways_construction_kr.json.elements, {
        extracted_at: fetchedAt,
        osm_base_timestamp: base('ways_construction_kr'),
        query: OSM_QUERIES.ways_construction_kr,
      }),
      sha256: hash('ways_construction_kr'),
    },
    routes: {
      name: 'overpass routes_capital+routes_tracks_kr',
      data: { routes, extracted_at: fetchedAt },
      sha256: hash('routes_capital', 'routes_tracks_kr'),
    },
    manifest: {
      extracted_at: fetchedAt,
      osm_base_timestamp: base('routes_capital', 'routes_tracks_kr'),
      endpoint,
      queries: { routes_capital: OSM_QUERIES.routes_capital, routes_tracks_kr: OSM_QUERIES.routes_tracks_kr },
    },
    origin: `live ${endpoint}`,
  };
}

// ---------------------------------------------------------------- 쓰기
const BATCH = 2000;

/** osm 스키마 전체 교체(한 트랜잭션). db 는 단일 연결 */
export async function replaceOsmDataset(db: Queryable, ds: OsmDataset): Promise<Record<string, number>> {
  await db.query('BEGIN');
  try {
    const del = await db.query<{ ways: string; relations: string; extracts: string }>(
      `SELECT (SELECT count(*) FROM osm.way) AS ways, (SELECT count(*) FROM osm.relation) AS relations,
              (SELECT count(*) FROM osm.extract) AS extracts`,
    );
    await db.query('DELETE FROM osm.relation_member');
    await db.query('DELETE FROM osm.relation');
    await db.query('DELETE FROM osm.way');
    await db.query('DELETE FROM osm.extract');
    const extractId = new Map<string, number>();
    for (const e of ds.extracts) {
      const r = await db.query<{ id: string }>(
        `INSERT INTO osm.extract (kind, bbox, fetched_at, overpass_query, sha256, note)
         VALUES ($1, $2::numeric[], $3, $4, $5, $6) RETURNING id`,
        [e.kind, e.bbox, e.fetched_at, e.overpass_query, e.sha256, e.note],
      );
      extractId.set(e.key, Number(r.rows[0]!.id));
    }
    for (let i = 0; i < ds.ways.length; i += BATCH) {
      const chunk = ds.ways.slice(i, i + BATCH);
      await db.query(
        `INSERT INTO osm.way (id, extract_id, tags, is_construction, geom)
         SELECT u.id, u.extract_id, u.tags, u.is_construction, ST_SetSRID(ST_GeomFromGeoJSON(u.geom), 4326)
           FROM unnest($1::bigint[], $2::bigint[], $3::jsonb[], $4::boolean[], $5::text[])
                AS u(id, extract_id, tags, is_construction, geom)`,
        [
          chunk.map((w) => w.id),
          chunk.map((w) => extractId.get(w.extract)!),
          chunk.map((w) => JSON.stringify(w.tags)),
          chunk.map((w) => w.is_construction),
          chunk.map((w) => JSON.stringify({ type: 'LineString', coordinates: w.coords })),
        ],
      );
    }
    const relExtract = extractId.get('routes')!;
    for (let i = 0; i < ds.relations.length; i += BATCH) {
      const chunk = ds.relations.slice(i, i + BATCH);
      await db.query(
        `INSERT INTO osm.relation (id, extract_id, tags)
         SELECT u.id, $3, u.tags FROM unnest($1::bigint[], $2::jsonb[]) AS u(id, tags)`,
        [chunk.map((r) => r.id), chunk.map((r) => JSON.stringify(r.tags)), relExtract],
      );
    }
    for (let i = 0; i < ds.members.length; i += BATCH * 5) {
      const chunk = ds.members.slice(i, i + BATCH * 5);
      await db.query(
        `INSERT INTO osm.relation_member (relation_id, way_id, role, seq)
         SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::text[], $4::int[])`,
        [
          chunk.map((m) => m.relation_id),
          chunk.map((m) => m.way_id),
          chunk.map((m) => m.role),
          chunk.map((m) => m.seq),
        ],
      );
    }
    await db.query('COMMIT');
    const d = del.rows[0]!;
    return {
      deleted_ways: Number(d.ways),
      deleted_relations: Number(d.relations),
      deleted_extracts: Number(d.extracts),
      inserted_ways: ds.ways.length,
      inserted_relations: ds.relations.length,
      inserted_members: ds.members.length,
    };
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

/** 교체 뒤 배정 결과 요약(리포트용) */
export async function osmCoverage(db: Queryable): Promise<Record<string, number>> {
  const r = await db.query<Record<string, string>>(
    `SELECT (SELECT count(DISTINCT line_id) FROM osm.v_line_geometry) AS lines_with_geometry,
            (SELECT count(*) FROM line_osm_map) AS lines_mapped,
            (SELECT count(*) FROM osm.v_line_way) AS ways_assigned,
            (SELECT count(*) FROM mv_map_line) AS map_line_rows,
            (SELECT count(*) FROM mv_map_station WHERE snapped) AS stations_snapped,
            (SELECT count(*) FROM v_plan_shape WHERE quality = 'osm_construction') AS plans_osm_construction`,
  );
  return Object.fromEntries(Object.entries(r.rows[0]!).map(([k, v]) => [k, Number(v)]));
}

export interface OsmRunOptions {
  fromRaw?: string;
  live?: boolean;
  endpoint?: string;
  dryRun?: boolean;
  trigger?: RunTrigger;
  log?: (m: string) => void;
  /** 시험용 */
  post?: OverpassPost;
  pauseMs?: number;
  /** 교체 뒤 refresh_derived() (기본 true) */
  refresh?: boolean;
}

export async function runOsmRail(
  db: Queryable,
  opts: OsmRunOptions = {},
): Promise<{ runId: number | null; stats: Record<string, unknown>; log: string[] }> {
  const log = opts.log ?? (() => {});
  const dir = opts.live ? null : (opts.fromRaw ?? defaultOsmDir());
  const params = {
    from_raw: dir,
    live: !!opts.live,
    endpoint: opts.live ? (opts.endpoint ?? OVERPASS_ENDPOINT) : null,
  };
  return withRun(db, OSM_TASK, { trigger: opts.trigger, params, dryRun: opts.dryRun }, async (run) => {
    const input = opts.live
      ? await fetchOsmLive({ endpoint: opts.endpoint, post: opts.post, log, pauseMs: opts.pauseMs })
      : readOsmRaw(dir!);
    const ds = buildOsmDataset(input);
    const stats: Record<string, unknown> = { ...ds.stats, extracts: ds.extracts.length, dry_run: !!opts.dryRun };
    run.log.push(
      `# osm-rail (${input.origin})`,
      '',
      `- way ${ds.stats.ways}(공사 중 ${ds.stats.ways_construction}, 공사 중 파일에서 더함 ${ds.stats.ways_from_construction_file}, 건너뜀 ${ds.stats.ways_skipped})`,
      `- railway 별: ${Object.entries(ds.stats.ways_by_railway)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}`,
      `- relation ${ds.stats.relations}, member way ${ds.stats.relation_members}(추출 밖 way ${ds.stats.members_missing_way}, 하위 relation 구성원 생략 ${ds.stats.sub_relation_members_skipped})`,
      ...ds.extracts.map((e) => `- extract ${e.kind}: ${e.fetched_at} sha256 ${e.sha256.slice(0, 12)}…`),
    );
    if (opts.dryRun) return { stats };
    Object.assign(stats, await replaceOsmDataset(db, ds));
    if (opts.refresh !== false) {
      await db.query('SELECT refresh_derived()');
      const cov = await osmCoverage(db);
      Object.assign(stats, cov);
      run.log.push(
        `- 배정: 노선 ${cov.lines_mapped} 중 선형 있음 ${cov.lines_with_geometry}, way ${cov.ways_assigned}, mv_map_line ${cov.map_line_rows}행`,
        `- 근사 좌표 역 선형 스냅 ${cov.stations_snapped}, 계획 osm_construction ${cov.plans_osm_construction}`,
      );
    }
    return { stats };
  });
}
