/**
 * 여러 건 입력(FR-ADM-085, docs/04-api.md 4-2절). 엑셀에서 복사한 표(TSV)·CSV → 열 대응 추정 → 값 변환·검증 → draft 변경 묶음 1개.
 *
 * - 첫 줄은 머리글. 열 대응은 계약 필드 이름·관리 앱 라벨(entityUiMeta)·간단한 별칭으로 추정하고, 호출자가 mapping 으로 덮어쓸 수 있다.
 * - 값 변환: 퍼지 날짜(2028·2028-03·2028-H2·2028-03-01·?/미정), 참조(id 또는 이름 — 역은 별칭 포함, 여럿이면 후보와 함께 오류),
 *   참/거짓(예/아니요/true/false/1/0), 코드값(값 또는 한국어 라벨), 시·도(코드·이름·약칭).
 * - 대상: 개체 생성(station·line_station·train_number_range·rolling_stock_range·event)과
 *   계획 하위 목록 추가(plan_refs·plan_milestones — 계획마다 update op 하나, 기존 목록 뒤에 붙인다).
 * - 반영은 하지 않는다. submitBulk 는 submitDraft(origin bulk_import)로 검수 대기에 올린다(FR-ADM-007).
 */
import {
  codes,
  entityContracts,
  entityUiMeta,
  isEntityId,
  isValidFuzzy,
  lineStationId,
  planMilestoneSchema,
  planRefSchema,
  type CodeDomain,
  type EntityType,
  type FuzzyDate,
} from '@k-raildex/contracts';
import type { z } from 'zod';
import { submitDraft, type Op } from './applier';
import type { Queryable } from './db';
import { DomainError, type Violation } from './errors';
import { ENTITY_SPECS } from './mapping';
import { requireEntity, shapeOf } from './repo';

type AnyObject = Record<string, unknown>;

export const BULK_ENTITY_TYPES = [
  'station',
  'line_station',
  'train_number_range',
  'rolling_stock_range',
  'event',
] as const satisfies readonly EntityType[];
export type BulkEntityType = (typeof BULK_ENTITY_TYPES)[number];
export const BULK_MODES = ['plan_refs', 'plan_milestones'] as const;
export type BulkMode = (typeof BULK_MODES)[number];
export type BulkTarget = BulkEntityType | BulkMode;
export const BULK_TARGETS: readonly BulkTarget[] = [...BULK_ENTITY_TYPES, ...BULK_MODES];

export function isBulkTarget(v: unknown): v is BulkTarget {
  return typeof v === 'string' && (BULK_TARGETS as readonly string[]).includes(v);
}

export const BULK_TARGET_LABELS: Readonly<Record<BulkTarget, string>> = {
  station: '역',
  line_station: '정거장(노선 정거장 순서)',
  train_number_range: '열차번호대',
  rolling_stock_range: '차량번호대',
  event: '연표 이벤트',
  plan_refs: '계획 사업 — 상위 계획 반영 내역',
  plan_milestones: '계획 사업 — 기대 일정',
};

export type BulkFieldKind =
  | 'text'
  | 'int'
  | 'num'
  | 'bool'
  | 'code'
  | 'fuzzy'
  | 'date'
  | 'ref'
  | 'refs'
  | 'region'
  | 'regions'
  | 'areas'
  | 'strings'
  | 'lat'
  | 'lng'
  | 'point'
  | 'targets';

export interface BulkField {
  name: string;
  label: string;
  kind: BulkFieldKind;
  required: boolean;
  domain?: CodeDomain;
  target?: EntityType;
  /** 머리글 별칭(정규화 전) */
  aliases?: string[];
}

export interface BulkDefaults {
  /** 행에 출처가 없을 때 쓸 출처 id(레코드 전체 출처) */
  source_id?: string | null;
  /** 행에 확인일이 없을 때(YYYY-MM-DD) */
  checked_at?: string | null;
}

export interface BulkColumn {
  index: number;
  header: string;
  field: string | null;
}

export interface BulkRowError {
  field: string;
  message: string;
}

export interface BulkRow {
  /** 데이터 행 번호(머리글 다음 줄이 1) */
  index: number;
  cells: string[];
  /** 변환된 값(Create 의 부분 객체, 계획 모드는 하위 항목 + plan_id) */
  data: AnyObject;
  errors: BulkRowError[];
}

export interface BulkParseResult {
  target: BulkTarget;
  delimiter: 'tab' | 'comma' | 'semicolon';
  fields: BulkField[];
  columns: BulkColumn[];
  rows: BulkRow[];
  summary: { total: number; ok: number; error: number };
}

// ---------------------------------------------------------------------------
// 표 읽기
// ---------------------------------------------------------------------------

const DELIMS = { tab: '\t', comma: ',', semicolon: ';' } as const;

function detectDelimiter(text: string): BulkParseResult['delimiter'] {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  if (first.includes('\t')) return 'tab';
  if (first.includes(',')) return 'comma';
  if (first.includes(';')) return 'semicolon';
  return 'tab';
}

/** RFC 4180 식 따옴표 처리(엑셀 TSV 도 줄바꿈이 든 칸을 따옴표로 감싼다). 빈 줄은 버린다 */
export function parseTable(
  text: string,
  delimiter?: BulkParseResult['delimiter'],
): {
  delimiter: BulkParseResult['delimiter'];
  rows: string[][];
} {
  const src = text.replace(/^\uFEFF/, '');
  const dname = delimiter ?? detectDelimiter(src);
  const d = DELIMS[dname];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const pushRow = () => {
    row.push(cell);
    if (row.some((c) => c.trim() !== '')) rows.push(row.map((c) => c.trim()));
    row = [];
    cell = '';
  };
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
      i++;
      continue;
    }
    if (ch === d) {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      pushRow();
      if (ch === '\r' && src[i + 1] === '\n') i++;
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  if (cell !== '' || row.length) pushRow();
  return { delimiter: dname, rows };
}

// ---------------------------------------------------------------------------
// 필드 정의
// ---------------------------------------------------------------------------

const ALIASES: Record<string, string[]> = {
  id: ['아이디', '식별자'],
  name_ko: ['역명', '역이름', '이름', '명칭', '한글명', '역사명'],
  name_en: ['영문명', '영문', '영문역명', '영문역사명'],
  name_hanja: ['한자명', '한문역명', '한자역사명'],
  station_id: ['역', '역명', '역이름', '역id', '역사명'],
  line_id: ['노선', '노선명', '노선id', '선명'],
  seq: ['순서', '순번', '역순서', '구성순서'],
  station_code: ['역번호', '역코드'],
  km: ['영업거리', '거리', 'km', '키로정', '누적거리'],
  opened: ['개통', '개통일', '개통일자', '역신설일자'],
  closed: ['폐지', '폐지일', '폐지일자', '역폐지일자'],
  status: ['상태'],
  region_code: ['시도', '시·도', '지역'],
  address: ['주소', '도로명주소', '소재지'],
  'geom.lat': ['위도', 'lat', 'latitude', 'y'],
  'geom.lng': ['경도', 'lng', 'lon', 'longitude', 'x'],
  geom: ['좌표', '위경도'],
  source_id: ['출처', '출처id', 'source'],
  checked_at: ['확인일', '확인일자'],
  operator_id: ['운영기관', '운영사', '철도운영기관', '철도운영기관명'],
  plan_id: ['계획', '계획사업', '사업', '계획id', '사업명'],
  program_id: ['상위계획', '계획명칭', '반영계획'],
  date: ['날짜', '일자', '일시'],
  title: ['제목', '내용'],
  type: ['유형', '종류'],
  target_ids: ['대상', '대상개체', '대상id'],
  expected: ['기대시점', '목표', '목표시점', '예정', '예정시기'],
  basis: ['근거', '근거구분'],
  as_of: ['기준시점', '기준일'],
  stage: ['단계', '사업단계'],
  range_from: ['시작', '번호시작', '시작번호'],
  range_to: ['끝', '번호끝', '끝번호'],
  number_from: ['시작', '번호시작', '시작번호'],
  number_to: ['끝', '번호끝', '끝번호'],
};

function isRequired(schema: unknown): boolean {
  return !(schema as z.ZodType).safeParse(undefined).success;
}

function widgetKind(w: { kind: string; domain?: CodeDomain; target?: EntityType }): Partial<BulkField> | null {
  switch (w.kind) {
    case 'id':
    case 'text':
    case 'textarea':
    case 'markdown':
    case 'url':
    case 'color':
      return { kind: 'text' };
    case 'number':
      return { kind: (w as { integer?: boolean }).integer ? 'int' : 'num' };
    case 'boolean':
      return { kind: 'bool' };
    case 'code':
      return { kind: 'code', domain: w.domain };
    case 'fuzzy':
      return { kind: 'fuzzy' };
    case 'date':
      return { kind: 'date' };
    case 'point':
      return { kind: 'point' };
    case 'ref':
      return { kind: 'ref', target: w.target };
    case 'refs':
      return { kind: 'refs', target: w.target };
    case 'region':
      return { kind: 'region' };
    case 'regions':
      return { kind: 'regions' };
    case 'areas':
      return { kind: 'areas' };
    case 'string_list':
      return { kind: 'strings' };
    default:
      return null; // json·names·external_refs·sources·document·editor 는 표 한 칸으로 넣지 않는다
  }
}

const childField = (
  name: string,
  label: string,
  kind: BulkFieldKind,
  required: boolean,
  extra: Partial<BulkField> = {},
): BulkField => ({ name, label, kind, required, ...extra });

const PLAN_FIELD = childField('plan_id', '계획 사업', 'ref', true, { target: 'plan' });

function childFields(mode: BulkMode): BulkField[] {
  if (mode === 'plan_refs')
    return [
      PLAN_FIELD,
      childField('program_id', '상위 계획', 'ref', true, { target: 'plan_program' }),
      childField('edition', '판(차수)', 'text', false),
      childField('timing', '시기', 'text', false),
      childField('class', '반영 구분', 'code', true, { domain: 'planRefClass', aliases: ['구분', '반영구분'] }),
      childField('category', '분류', 'code', false, { domain: 'planRefCategory', aliases: ['분야'] }),
      childField('section', '구간', 'text', false, { aliases: ['사업구간', '절'] }),
      childField('content', '사업 내용', 'text', false, { aliases: ['내용'] }),
      childField('length_km', '연장(km)', 'num', false, { aliases: ['연장'] }),
      childField('cost_100m_krw', '사업비(억 원)', 'num', false, { aliases: ['사업비', '총사업비'] }),
      childField('task_group', '과제 묶음', 'text', false),
      childField('source_id', '출처', 'ref', true, { target: 'source' }),
      childField('locator', '쪽·위치', 'text', false, { aliases: ['쪽', '위치'] }),
    ];
  return [
    PLAN_FIELD,
    childField('stage', '단계', 'code', true, { domain: 'planStage' }),
    childField('expected', '기대 시점', 'fuzzy', true),
    childField('basis', '근거 구분', 'code', true, { domain: 'milestoneBasis' }),
    childField('as_of', '기준 시점', 'fuzzy', false),
    childField('source_id', '출처', 'ref', true, { target: 'source' }),
    childField('note', '메모', 'text', false),
  ];
}

/** 대상의 입력 가능 필드(관리 앱 열 대응 목록) */
export function bulkFields(target: BulkTarget): BulkField[] {
  if (target === 'plan_refs' || target === 'plan_milestones') return childFields(target);
  const meta = entityUiMeta[target];
  const shape = shapeOf(target);
  const out: BulkField[] = [];
  for (const [name, fm] of Object.entries(meta.fields)) {
    if (!(name in shape)) continue;
    const k = widgetKind(fm.widget as never);
    if (!k) continue;
    if (k.kind === 'point') {
      out.push({ name, label: `${fm.label}(위도, 경도)`, kind: 'point', required: false });
      out.push({ name: `${name}.lat`, label: `${fm.label} 위도`, kind: 'lat', required: false });
      out.push({ name: `${name}.lng`, label: `${fm.label} 경도`, kind: 'lng', required: false });
      continue;
    }
    // 정거장 id 는 비우면 노선·역에서 만든다
    const required = name === 'id' && target === 'line_station' ? false : isRequired(shape[name]);
    out.push({ name, label: fm.label, required, ...k } as BulkField);
  }
  if ('sources' in shape) {
    const req = isRequired(shape.sources) || (shape.sources as z.ZodType).safeParse([]).success === false;
    out.push({ name: 'source_id', label: '출처', kind: 'ref', target: 'source', required: req });
  }
  if (target === 'event') out.push({ name: 'target_ids', label: '대상 개체 id', kind: 'targets', required: false });
  return out;
}

// ---------------------------------------------------------------------------
// 머리글 → 필드
// ---------------------------------------------------------------------------

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s·_\-.:/]+/g, '')
    .trim();
const stripParens = (s: string) => s.replace(/\([^)]*\)|\[[^\]]*\]/g, '');

export function guessMapping(target: BulkTarget, headers: string[]): (string | null)[] {
  const fields = bulkFields(target);
  const byKey = new Map<string, string>();
  const add = (key: string, field: string, force = false) => {
    const k = norm(key);
    if (k && (force || !byKey.has(k))) byKey.set(k, field);
  };
  // 우선순위: 필드 이름 > 라벨 > 괄호 뺀 라벨 > 별칭
  for (const f of fields) add(f.name, f.name, true);
  for (const f of fields) add(f.label, f.name);
  for (const f of fields) add(stripParens(f.label), f.name);
  for (const f of fields) for (const a of [...(f.aliases ?? []), ...(ALIASES[f.name] ?? [])]) add(a, f.name);
  const used = new Set<string>();
  return headers.map((h) => {
    const f = byKey.get(norm(h)) ?? byKey.get(norm(stripParens(h))) ?? null;
    if (!f || used.has(f)) return null;
    used.add(f);
    return f;
  });
}

// ---------------------------------------------------------------------------
// 값 변환
// ---------------------------------------------------------------------------

/** 퍼지 날짜 글자 → 값. '' → null, 해석 불가 → undefined */
export function parseFuzzyCell(text: string): FuzzyDate | null | undefined {
  let t = text.trim();
  if (t === '') return null;
  if (/^(\?|미정|미상|unknown|모름)$/i.test(t)) return { value: null, precision: 'unknown' };
  t = t.replace(/\s+/g, ' ');
  let m: RegExpExecArray | null;
  const pad = (n: string) => n.padStart(2, '0');
  const ok = (value: string, precision: FuzzyDate['precision']) =>
    isValidFuzzy(value, precision) ? { value, precision } : undefined;
  if ((m = /^(\d{4})[-./ ]?\s*(?:H([12])|([상하])반기)$/i.exec(t.replace(/년/, ''))))
    return ok(`${m[1]}-H${m[2] ?? (m[3] === '상' ? '1' : '2')}`, 'half');
  if ((m = /^(\d{4})년?$/.exec(t))) return ok(m[1]!, 'year');
  if ((m = /^(\d{4})[-./]\s*(\d{1,2})\.?$/.exec(t)) || (m = /^(\d{4})년\s*(\d{1,2})월$/.exec(t)))
    return ok(`${m[1]}-${pad(m[2]!)}`, 'month');
  if (
    (m = /^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?$/.exec(t)) ||
    (m = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/.exec(t)) ||
    (m = /^(\d{4})(\d{2})(\d{2})$/.exec(t))
  )
    return ok(`${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`, 'day');
  return undefined;
}

function parseDateCell(text: string): string | undefined {
  const f = parseFuzzyCell(text);
  return f && f.precision === 'day' ? f.value! : undefined;
}

function parseBool(text: string): boolean | undefined {
  const t = text.trim().toLowerCase();
  if (['예', '네', 'y', 'yes', 'true', '1', 'o', '○', 'v', '참'].includes(t)) return true;
  if (['아니요', '아니오', '아니', 'n', 'no', 'false', '0', 'x', '×', '거짓'].includes(t)) return false;
  return undefined;
}

function parseNumber(text: string, integer: boolean): number | undefined {
  const t = text.replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return undefined;
  const n = Number(t);
  if (integer && !Number.isInteger(n)) return undefined;
  return n;
}

function parseCode(domain: CodeDomain, text: string): string | undefined {
  const table = codes[domain] as { values: readonly string[]; labels: Record<string, { ko: string }> };
  const t = text.trim();
  if (table.values.includes(t)) return t;
  const lower = t.toLowerCase();
  const byValue = table.values.find((v) => v.toLowerCase() === lower);
  if (byValue) return byValue;
  const n = norm(t);
  return table.values.find((v) => norm(table.labels[v]?.ko ?? '') === n);
}

const splitList = (text: string) =>
  text
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

/** 참조 해석기(한 번 파싱하는 동안 캐시) */
class Resolver {
  private cache = new Map<string, Promise<{ id?: string; error?: string }>>();
  private regions: Promise<{ code: string; name_ko: string; short_ko: string }[]> | null = null;

  constructor(private readonly db: Queryable) {}

  ref(type: EntityType, text: string): Promise<{ id?: string; error?: string }> {
    const key = `${type}\u0000${text}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.resolveRef(type, text.trim());
      this.cache.set(key, p);
    }
    return p;
  }

  private async resolveRef(type: EntityType, t: string): Promise<{ id?: string; error?: string }> {
    const spec = ENTITY_SPECS[type];
    if (isEntityId(type, t)) {
      const r = await this.db.query(`SELECT 1 FROM "${spec.table}" WHERE id = $1 AND deleted_at IS NULL`, [t]);
      return r.rows.length ? { id: t } : { error: `${t} 가 없음(또는 휴지통)` };
    }
    let rows: { id: string; label: string; sub: string | null }[];
    if (type === 'station') {
      const bare = t.replace(/역$/, '');
      const r = await this.db.query<{ id: string; label: string; sub: string | null }>(
        `SELECT s.id, s.name_ko AS label,
                (SELECT string_agg(DISTINCT l.name_ko, '·') FROM line_station ls JOIN line l ON l.id = ls.line_id
                  WHERE ls.station_id = s.id AND ls.deleted_at IS NULL) AS sub
           FROM station s
          WHERE s.deleted_at IS NULL
            AND (s.name_ko IN ($1, $2)
                 OR EXISTS (SELECT 1 FROM entity_name n WHERE n.entity_id = s.id AND n.name IN ($1, $2)))
          ORDER BY s.id LIMIT 10`,
        [t, bare],
      );
      rows = r.rows;
    } else {
      const titleField = entityUiMeta[type].titleField;
      const extra = type === 'plan_program' ? ` OR t.short = $1` : type === 'operator' ? ` OR t.short_ko = $1` : '';
      if (titleField === 'id') return { error: `${entityUiMeta[type].label} id 형식이 아님: ${t}` };
      const r = await this.db.query<{ id: string; label: string; sub: string | null }>(
        `SELECT t.id, t."${titleField}"::text AS label, NULL AS sub FROM "${spec.table}" t
          WHERE t.deleted_at IS NULL AND (t."${titleField}"::text = $1${extra}) ORDER BY t.id LIMIT 10`,
        [t],
      );
      rows = r.rows;
    }
    if (rows.length === 1) return { id: rows[0]!.id };
    if (!rows.length) return { error: `"${t}" 에 맞는 ${entityUiMeta[type].label} 없음` };
    return {
      error: `"${t}" 후보가 여럿 — id 로 지정: ${rows.map((r) => `${r.id}(${r.label}${r.sub ? `, ${r.sub}` : ''})`).join(', ')}`,
    };
  }

  async region(text: string): Promise<string | undefined> {
    this.regions ??= this.db
      .query<{ code: string; name_ko: string; short_ko: string }>(`SELECT code, name_ko, short_ko FROM ref_region`)
      .then((r) => r.rows);
    const t = text.trim();
    const list = await this.regions;
    return list.find((r) => r.code === t || r.name_ko === t || r.short_ko === t)?.code;
  }
}

async function convertCell(
  f: BulkField,
  text: string,
  res: Resolver,
): Promise<{ value?: unknown; error?: string; skip?: boolean }> {
  const t = text.trim();
  if (t === '') return { skip: true };
  switch (f.kind) {
    case 'text':
      return { value: t };
    case 'int':
    case 'num': {
      const n = parseNumber(t, f.kind === 'int');
      return n === undefined ? { error: `숫자가 아님: ${t}` } : { value: n };
    }
    case 'lat':
    case 'lng': {
      const n = parseNumber(t, false);
      return n === undefined ? { error: `숫자가 아님: ${t}` } : { value: n };
    }
    case 'point': {
      const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(t);
      return m ? { value: { lat: Number(m[1]), lng: Number(m[2]) } } : { error: '"위도, 경도" 형식이 아님' };
    }
    case 'bool': {
      const b = parseBool(t);
      return b === undefined ? { error: `예/아니요가 아님: ${t}` } : { value: b };
    }
    case 'code': {
      const c = parseCode(f.domain!, t);
      if (c !== undefined) return { value: c };
      const table = codes[f.domain!] as { values: readonly string[]; labels: Record<string, { ko: string }> };
      return {
        error: `알 수 없는 값 "${t}" — ${table.values.map((v) => `${v}(${table.labels[v]?.ko ?? v})`).join(', ')}`,
      };
    }
    case 'fuzzy': {
      const v = parseFuzzyCell(t);
      return v === undefined
        ? { error: `날짜 형식이 아님: ${t} (2028 · 2028-03 · 2028-H2 · 2028-03-01 · 미정)` }
        : { value: v };
    }
    case 'date': {
      const v = parseDateCell(t);
      return v === undefined ? { error: `날짜(YYYY-MM-DD)가 아님: ${t}` } : { value: v };
    }
    case 'ref': {
      const r = await res.ref(f.target!, t);
      return r.id ? { value: r.id } : { error: r.error! };
    }
    case 'refs': {
      const ids: string[] = [];
      for (const part of splitList(t)) {
        const r = await res.ref(f.target!, part);
        if (!r.id) return { error: r.error! };
        ids.push(r.id);
      }
      return { value: ids };
    }
    case 'region': {
      const c = await res.region(t);
      return c ? { value: c } : { error: `시·도가 아님: ${t}` };
    }
    case 'regions': {
      const out: string[] = [];
      for (const part of splitList(t)) {
        const c = await res.region(part);
        if (!c) return { error: `시·도가 아님: ${part}` };
        out.push(c);
      }
      return { value: out };
    }
    case 'areas': {
      const out: string[] = [];
      for (const part of splitList(t)) {
        const c = parseCode('area', part);
        if (!c) return { error: `권역이 아님: ${part}` };
        out.push(c);
      }
      return { value: out };
    }
    case 'strings':
      return { value: splitList(t) };
    case 'targets': {
      const out: { entity_id: string; role: 'subject' }[] = [];
      for (const part of splitList(t)) out.push({ entity_id: part, role: 'subject' });
      return { value: out };
    }
  }
}

function zodRowErrors(err: z.ZodError, known: Set<string>): BulkRowError[] {
  return err.issues.map((i) => {
    const head = String(i.path[0] ?? '');
    const field = head === 'sources' ? 'source_id' : head === 'geom' ? 'geom' : known.has(head) ? head : head || '(행)';
    return { field, message: i.path.length > 1 ? `${i.path.join('.')}: ${i.message}` : i.message };
  });
}

// ---------------------------------------------------------------------------
// 파싱
// ---------------------------------------------------------------------------

export interface BulkParseInput {
  text: string;
  /** 열마다 필드 이름 또는 null(무시). 없으면 추정 */
  mapping?: (string | null)[];
  defaults?: BulkDefaults;
}

export async function parseBulk(
  db: Queryable,
  target: BulkTarget,
  input: BulkParseInput | string,
): Promise<BulkParseResult> {
  const inp: BulkParseInput = typeof input === 'string' ? { text: input } : input;
  if (!isBulkTarget(target))
    throw new DomainError('validation', `여러 건 입력 대상이 아님: ${String(target)}`, {
      violations: [{ rule: 'schema', path: 'entity_type', message: BULK_TARGETS.join('|') }],
    });
  const { delimiter, rows: table } = parseTable(inp.text);
  if (!table.length)
    throw new DomainError('validation', '붙여 넣은 표가 비어 있음', {
      violations: [{ rule: 'schema', path: 'text', message: '머리글 줄과 데이터 줄이 필요함' }],
    });
  const header = table[0]!;
  const fields = bulkFields(target);
  const fieldByName = new Map(fields.map((f) => [f.name, f]));
  let mapping = inp.mapping ?? guessMapping(target, header);
  if (mapping.length < header.length) mapping = [...mapping, ...Array(header.length - mapping.length).fill(null)];
  const bad = mapping.filter((m): m is string => m != null && !fieldByName.has(m));
  if (bad.length)
    throw new DomainError('validation', `알 수 없는 필드: ${bad.join(', ')}`, {
      violations: bad.map((b) => ({ rule: 'schema', path: 'mapping', message: `알 수 없는 필드 ${b}` })),
    });
  const columns: BulkColumn[] = header.map((h, i) => ({ index: i, header: h, field: mapping[i] ?? null }));
  const mapped = new Set(columns.map((c) => c.field).filter(Boolean) as string[]);
  const res = new Resolver(db);
  const rows: BulkRow[] = [];
  for (const [ri, cells] of table.slice(1).entries()) {
    const data: AnyObject = {};
    const errors: BulkRowError[] = [];
    for (const col of columns) {
      if (!col.field) continue;
      const f = fieldByName.get(col.field)!;
      const r = await convertCell(f, cells[col.index] ?? '', res);
      if (r.error) errors.push({ field: f.name, message: r.error });
      else if (!r.skip) data[f.name] = r.value;
    }
    const defaults = inp.defaults ?? {};
    for (const f of fields) {
      if (!f.required || data[f.name] !== undefined || errors.some((e) => e.field === f.name)) continue;
      if (derivable(target, f) || (f.name === 'source_id' && defaults.source_id)) continue;
      if (f.name === 'checked_at' && defaults.checked_at) continue;
      errors.push({ field: f.name, message: '필수 값이 없음' });
    }
    const built = buildData(target, data, errors, defaults, mapped);
    rows.push({ index: ri + 1, cells, data: built, errors });
  }
  await validateRows(db, target, rows, fields);
  const err = rows.filter((r) => r.errors.length).length;
  return {
    target,
    delimiter,
    fields,
    columns,
    rows,
    summary: { total: rows.length, ok: rows.length - err, error: err },
  };
}

/** 다른 값에서 만들어지는 필수 필드(검사 생략) */
function derivable(target: BulkTarget, f: BulkField): boolean {
  return target === 'line_station' && f.name === 'id';
}

function buildData(
  target: BulkTarget,
  data: AnyObject,
  errors: BulkRowError[],
  defaults: BulkDefaults,
  mapped: Set<string>,
): AnyObject {
  const out: AnyObject = { ...data };
  // 좌표: geom.lat + geom.lng → geom
  for (const base of ['geom']) {
    const lat = out[`${base}.lat`];
    const lng = out[`${base}.lng`];
    delete out[`${base}.lat`];
    delete out[`${base}.lng`];
    if (lat !== undefined || lng !== undefined) {
      if (lat === undefined || lng === undefined)
        errors.push({ field: `${base}.lat`, message: '위도·경도를 함께 넣어야 함' });
      else out[base] = { lat, lng };
    }
  }
  if (target === 'plan_refs' || target === 'plan_milestones') {
    if (out.source_id === undefined && defaults.source_id) out.source_id = defaults.source_id;
    return out;
  }
  const shape = shapeOf(target);
  if ('sources' in shape) {
    const src = (out.source_id as string | undefined) ?? defaults.source_id ?? undefined;
    delete out.source_id;
    if (src) out.sources = [{ source_id: src }];
  }
  if ('checked_at' in shape && out.checked_at === undefined && defaults.checked_at)
    out.checked_at = defaults.checked_at;
  if (target === 'event' && out.target_ids !== undefined) {
    out.targets = out.target_ids;
    delete out.target_ids;
  }
  // 좌표를 넣었는데 좌표 출처 열이 없으면 수기 확인(manual)으로 본다
  if (target === 'station' && out.geom !== undefined && out.coord_source === undefined && !mapped.has('coord_source'))
    out.coord_source = 'manual';
  return out;
}

async function validateRows(db: Queryable, target: BulkTarget, rows: BulkRow[], fields: BulkField[]): Promise<void> {
  const known = new Set(fields.map((f) => f.name));
  if (target === 'plan_refs' || target === 'plan_milestones') {
    const schema = target === 'plan_refs' ? planRefSchema : planMilestoneSchema;
    for (const r of rows) {
      if (r.errors.length) continue;
      const { plan_id: _p, ...item } = r.data;
      const z1 = schema.safeParse(item);
      if (!z1.success) r.errors.push(...zodRowErrors(z1.error, known));
    }
    return;
  }
  const contract = entityContracts[target].create;
  const usedLs = new Set<string>();
  const seenIds = new Map<string, number>();
  for (const r of rows) {
    if (r.errors.length) continue;
    if (target === 'line_station' && r.data.id === undefined && r.data.line_id && r.data.station_id)
      r.data.id = await freeLineStationId(db, String(r.data.line_id), String(r.data.station_id), usedLs);
    const z1 = contract.safeParse(r.data);
    if (!z1.success) {
      r.errors.push(...zodRowErrors(z1.error, known));
      continue;
    }
    const id = String(r.data.id);
    const prev = seenIds.get(id);
    if (prev !== undefined) r.errors.push({ field: 'id', message: `${prev}행과 id 가 같음` });
    seenIds.set(id, r.index);
    const taken = await db.query(`SELECT 1 FROM entity WHERE id = $1`, [id]);
    if (taken.rows.length) r.errors.push({ field: 'id', message: `이미 쓰인 id(삭제된 id 포함): ${id}` });
  }
}

async function freeLineStationId(db: Queryable, lineId: string, stationId: string, used: Set<string>): Promise<string> {
  for (let n = 1; n < 50; n++) {
    const id = lineStationId(lineId, stationId, n);
    if (used.has(id)) continue;
    const r = await db.query(`SELECT 1 FROM entity WHERE id = $1`, [id]);
    if (!r.rows.length) {
      used.add(id);
      return id;
    }
  }
  return lineStationId(lineId, stationId, 50);
}

// ---------------------------------------------------------------------------
// 제출
// ---------------------------------------------------------------------------

export interface BulkSubmitInput {
  target: BulkTarget;
  /** 붙여 넣은 원문(머리글 포함). rows 와 둘 중 하나 */
  text?: string;
  /** 칸 배열(머리글 포함) */
  rows?: string[][];
  mapping?: (string | null)[];
  defaults?: BulkDefaults;
  /** 제외할 데이터 행 번호(1부터) */
  exclude?: number[];
  author_id: string;
  title?: string;
  rationale?: string;
}

const toTsv = (rows: string[][]) =>
  rows.map((r) => r.map((c) => (/[\t\n\r"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join('\t')).join('\n');

/** 검증 → op 만들기 → draft 1개(origin bulk_import). 행 오류가 있으면 422(rows.<행>.<필드>) */
export async function submitBulk(
  db: Queryable,
  input: BulkSubmitInput,
): Promise<{ changeset_id: string; op_count: number; row_count: number }> {
  const text = input.text ?? (input.rows ? toTsv(input.rows) : '');
  const parsed = await parseBulk(db, input.target, { text, mapping: input.mapping, defaults: input.defaults });
  const exclude = new Set(input.exclude ?? []);
  const rows = parsed.rows.filter((r) => !exclude.has(r.index));
  const violations: Violation[] = rows.flatMap((r) =>
    r.errors.map((e) => ({ rule: 'bulk', path: `rows.${r.index}.${e.field}`, message: e.message })),
  );
  if (violations.length)
    throw new DomainError('validation', `${new Set(violations.map((v) => v.path.split('.')[1])).size}개 행에 오류`, {
      violations,
    });
  if (!rows.length)
    throw new DomainError('validation', '제출할 행이 없음', {
      violations: [{ rule: 'bulk', path: 'rows', message: '데이터 행이 없음' }],
    });
  const ops: Op[] = [];
  if (input.target === 'plan_refs' || input.target === 'plan_milestones') {
    const field = input.target === 'plan_refs' ? 'refs' : 'milestones';
    const byPlan = new Map<string, AnyObject[]>();
    for (const r of rows) {
      const { plan_id, ...item } = r.data;
      byPlan.set(String(plan_id), [...(byPlan.get(String(plan_id)) ?? []), item]);
    }
    for (const [planId, items] of byPlan) {
      const plan = await requireEntity(db, 'plan', planId);
      const existing = (plan[field] as AnyObject[] | undefined) ?? [];
      ops.push({
        op: 'update',
        entity_type: 'plan',
        id: planId,
        data: { [field]: [...existing, ...items] },
        expected_version: Number(plan.version),
      });
    }
  } else {
    for (const r of rows) ops.push({ op: 'create', entity_type: input.target, data: r.data });
  }
  const label = BULK_TARGET_LABELS[input.target];
  const changesetId = await submitDraft(db, {
    title: input.title?.trim() || `여러 건 입력: ${label} ${rows.length}건`,
    rationale: input.rationale,
    origin: 'bulk_import',
    author_id: input.author_id,
    ops,
    meta: {
      bulk: {
        target: input.target,
        row_count: rows.length,
        excluded: [...exclude],
        columns: parsed.columns.map((c) => ({ header: c.header, field: c.field })),
      },
    },
  });
  return { changeset_id: changesetId, op_count: ops.length, row_count: rows.length };
}
