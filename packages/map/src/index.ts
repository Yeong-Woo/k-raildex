/**
 * MapLibre 공용 스타일·레이어(M5) — 관리 앱·공개 사이트가 같은 규칙으로 그리도록 순수 객체만 둔다.
 * maplibre-gl 에 의존하지 않는다(레이어 명세는 일반 객체, 앱에서 maplibre 형식으로 넘긴다).
 *
 * 규칙(docs/03-data-model.md 6-1절, docs/06-public-web.md FR-WEB-023·024, decisions 2026-11-20):
 * - 선 모양 = 단계: 착공 이상 실선 / 기본계획~실시설계 굵은 점선 / 그 전 가는 점선(API 의 line_style)
 * - 색 = API 의 color(연장이면 기존 노선색, 공식색) → NULL 이면 단계 대표색(화면이 선택)
 * - 선형 품질 schematic 은 "개략" — 가는 점선 + 범례 표시
 */

/**
 * 계획 단계 대표색(색 NULL 일 때) = 디자인 토큰 단계 묶음 색(라이트)의 hex(docs/design/tokens.md 3절).
 * 묶음: 구상·계획 반영(회청) / 타당성 조사(보라) / 기본계획~실시설계(파랑) / 공사·시운전(주황) / 개통(초록) / 중단(회색).
 * 색은 선 모양(LINE_STYLES)·라벨과 함께 쓴다 — 색만으로 단계를 전달하지 않는다.
 * 값은 packages/ui 의 tokens.ts 와 교차 시험으로 맞춘다(packages/ui/test/tokens.test.ts).
 */
import { basemapSource, defaultBasemap, resolveBasemap, type BasemapId, type BasemapKeys } from './basemap';

export * from './basemap';

export const STAGE_COLORS: Readonly<Record<string, string>> = {
  concept: '#7A8798',
  plan_listed: '#7A8798',
  prefeasibility: '#8059BB',
  feasibility: '#8059BB',
  strategic_eia: '#8059BB',
  basic_plan: '#1F68BC',
  basic_design: '#1F68BC',
  eia: '#1F68BC',
  detail_design: '#1F68BC',
  construction: '#D0750A',
  trial_run: '#D0750A',
  opened: '#1C8742',
  abandoned: '#7C8186',
  dormant: '#7C8186',
};
export const STAGE_FALLBACK_COLOR = '#7A8798';

/** 12단계 진행 띠 순서(docs/05 FR-ADM-055) */
export const STAGE_ORDER = [
  'concept',
  'plan_listed',
  'prefeasibility',
  'feasibility',
  'strategic_eia',
  'basic_plan',
  'basic_design',
  'eia',
  'detail_design',
  'construction',
  'trial_run',
  'opened',
] as const;

export type LineStyle = 'solid' | 'dashed_bold' | 'dashed_thin';

/** 선 모양(단계) → 선 굵기·점선 */
export const LINE_STYLES: Readonly<Record<LineStyle, { width: number; dasharray: number[] | null; label: string }>> = {
  solid: { width: 4, dasharray: null, label: '시공 이상(실선)' },
  dashed_bold: { width: 4, dasharray: [2, 1.2], label: '기본계획~실시설계(굵은 점선)' },
  dashed_thin: { width: 2, dasharray: [1.5, 1.5], label: '그 전 단계(가는 점선)' },
};

/** 여객 미취급(화물 전용) 노선: 회색 가는 선(Q115 A). 시점 지도에서 사라지면 "폐선"으로 오해하므로 그린다 */
export const FREIGHT_LINE = { color: '#8A9099', width: 1.5, label: '여객 미취급(화물 전용)' } as const;

/** 속성 passenger = false 인 선인가(속성이 없으면 여객선으로 본다) */
export const isFreightExpression = (): unknown[] => ['==', ['get', 'passenger'], false];

/** 역 상태 색(현재 지도) = 토큰 `status-*-mark`(라이트). 범례에는 모양(STATUS_SHAPE)과 라벨을 함께 */
export const STATUS_COLORS: Readonly<Record<string, string>> = {
  operating: '#2A904B',
  suspended: '#DF6C32',
  under_construction: '#CE710C',
  planned: '#3C79D1',
  closed: '#CB4644',
  abandoned: '#82878C',
};

/** 선형 품질 라벨(범례) */
export const GEOMETRY_QUALITY_LABELS: Readonly<Record<string, string>> = {
  osm: 'OSM 선형',
  osm_construction: 'OSM 공사 선형',
  official: '공식 도면',
  traced: '도면 추출',
  station_sequence: '역 순서 연결',
  schematic: '선형 미확정(개략)',
};

export const DISCLAIMER = '개통 예정은 발표 시점 기준이며 바뀔 수 있습니다. 개략 선형은 실제 위치와 다를 수 있습니다.';

export const KOREA_CENTER: [number, number] = [127.0, 37.55];

/** 일반 객체 레이어 명세(maplibre LayerSpecification 과 같은 모양) */
export interface LayerSpec {
  id: string;
  type: 'line' | 'circle' | 'symbol' | 'raster' | 'fill';
  source: string;
  filter?: unknown[];
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  minzoom?: number;
}

export interface RasterStyle {
  version: 8;
  sources: Record<string, unknown>;
  layers: LayerSpec[];
  glyphs?: string;
}

export interface BasemapOptions extends BasemapKeys {
  /** 배경 id(basemap.ts). 없으면 satellite → VWorld 위성, 아니면 기본 배경(OSM 교통 지도 → 키 없으면 OSM 표준) */
  basemap?: BasemapId | string | null;
  /** VWorld 영상(위성) 배경(위성 비교 화면) */
  satellite?: boolean;
}

/** 래스터 배경 지도 스타일 */
export function basemapStyle(opts: BasemapOptions = {}): RasterStyle {
  const id =
    opts.basemap != null
      ? resolveBasemap(opts.basemap, opts)
      : opts.satellite
        ? resolveBasemap('vworld-satellite', opts)
        : defaultBasemap(opts);
  return {
    version: 8,
    sources: { basemap: basemapSource(id, opts) },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-saturation': -0.4 } }],
  };
}

/** 단계 대표색 match 식(색이 NULL 일 때) */
export function stageColorExpression(stageProp = 'stage'): unknown[] {
  const pairs: unknown[] = [];
  for (const [k, v] of Object.entries(STAGE_COLORS)) pairs.push(k, v);
  return ['match', ['coalesce', ['get', stageProp], ''], ...pairs, STAGE_FALLBACK_COLOR];
}

/** color 속성 → 없으면 단계 대표색 */
export function lineColorExpression(): unknown[] {
  return ['coalesce', ['get', 'color'], stageColorExpression()];
}

/** 미래 지도 선 레이어: 선 모양별로 한 층(점선 패턴은 레이어 단위) */
export function futureLineLayers(source: string): LayerSpec[] {
  return (Object.keys(LINE_STYLES) as LineStyle[]).map((style) => {
    const s = LINE_STYLES[style];
    const paint: Record<string, unknown> = {
      'line-color': ['case', isFreightExpression(), FREIGHT_LINE.color, lineColorExpression()],
      'line-width': ['case', isFreightExpression(), FREIGHT_LINE.width, s.width],
      'line-opacity': ['case', ['==', ['get', 'quality'], 'schematic'], 0.75, 1],
    };
    if (s.dasharray) paint['line-dasharray'] = s.dasharray;
    return {
      id: `future-line-${style}`,
      type: 'line',
      source,
      filter: ['==', ['get', 'line_style'], style],
      layout: { 'line-cap': style === 'solid' ? 'round' : 'butt', 'line-join': 'round' },
      paint,
    };
  });
}

/** 미래 지도 역 레이어(미래 역은 속이 빈 원, 근사 좌표는 흐리게) */
export function futureStationLayers(source: string): LayerSpec[] {
  return [
    {
      id: 'future-station',
      type: 'circle',
      source,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 2.5, 12, 5],
        'circle-color': ['case', ['==', ['get', 'future'], true], '#FFFFFF', '#161B21'],
        'circle-stroke-color': ['case', ['==', ['get', 'future'], true], STATUS_COLORS.under_construction, '#FFFFFF'],
        'circle-stroke-width': 1.5,
        'circle-opacity': ['case', ['==', ['get', 'approximate'], true], 0.6, 1],
      },
    },
  ];
}

/** 현재 노선 레이어(공사 중은 점선) */
export function currentLineLayers(source: string): LayerSpec[] {
  const color = ['coalesce', ['get', 'color'], STAGE_FALLBACK_COLOR];
  return [
    {
      id: 'current-line',
      type: 'line',
      source,
      filter: ['!=', ['get', 'is_construction'], true],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': 3, 'line-opacity': 0.85 },
    },
    {
      id: 'current-line-construction',
      type: 'line',
      source,
      filter: ['==', ['get', 'is_construction'], true],
      paint: { 'line-color': color, 'line-width': 3, 'line-dasharray': [2, 1.2], 'line-opacity': 0.85 },
    },
  ];
}

/** 현재 역 레이어(상태 색, 근사 좌표(coord_basis 있음)는 테두리 주황) */
/** 차량기지(0034): 흰 원 + 굵은 테두리(첫 담당 노선색, 없으면 회색) */
export function depotLayers(source: string): LayerSpec[] {
  return [
    {
      id: `${source}-depot`,
      type: 'circle',
      source,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 4, 13, 8],
        'circle-color': '#FFFFFF',
        'circle-stroke-color': ['case', ['!=', ['coalesce', ['get', 'color'], ''], ''], ['get', 'color'], '#6B7480'],
        'circle-stroke-width': 3,
      },
    },
  ];
}

export function currentStationLayers(source: string): LayerSpec[] {
  const pairs: unknown[] = [];
  for (const [k, v] of Object.entries(STATUS_COLORS)) pairs.push(k, v);
  return [
    {
      id: 'current-station',
      type: 'circle',
      source,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 3, 13, 6],
        'circle-color': ['match', ['coalesce', ['get', 'status'], ''], ...pairs, STATUS_COLORS.abandoned],
        'circle-stroke-color': [
          'case',
          ['!=', ['coalesce', ['get', 'coord_basis'], ''], ''],
          STATUS_COLORS.under_construction,
          '#FFFFFF',
        ],
        'circle-stroke-width': 1.5,
      },
    },
  ];
}

/** 점선 패턴을 SVG stroke-dasharray 로(범례용, 선 굵기 배수) */
export function svgDash(style: LineStyle): string | undefined {
  const s = LINE_STYLES[style];
  return s.dasharray ? s.dasharray.map((n) => n * s.width).join(' ') : undefined;
}
