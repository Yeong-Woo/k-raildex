import { describe, expect, it } from 'vitest';
import {
  availableBasemaps,
  basemapStyle,
  futureLineLayers,
  resolveBasemap,
  LINE_STYLES,
  STAGE_COLORS,
  STAGE_ORDER,
  svgDash,
} from '../src/index';

describe('map styles', () => {
  it('defaults to the OSM transport map with a Thunderforest key, else OSM standard', () => {
    expect(JSON.stringify(basemapStyle().sources)).toContain('tile.openstreetmap.org');
    // VWorld 키만 있어도 기본은 OSM 표준(사용자 요청 2026-11-24)
    expect(JSON.stringify(basemapStyle({ vworldKey: 'KEY' }).sources)).toContain('tile.openstreetmap.org');
    expect(JSON.stringify(basemapStyle({ thunderforestKey: 'TF' }).sources)).toContain('thunderforest.com/transport');
    expect(JSON.stringify(basemapStyle({ vworldKey: 'KEY', basemap: 'vworld-base' }).sources)).toContain(
      'api.vworld.kr/req/wmts/1.0.0/KEY/Base',
    );
    expect(JSON.stringify(basemapStyle({ vworldKey: 'KEY', satellite: true }).sources)).toContain('/Satellite/');
  });

  it('offers only basemaps whose key is present and falls back for unknown ids', () => {
    expect(availableBasemaps({}).map((b) => b.id)).toEqual(['osm-standard']);
    expect(availableBasemaps({ vworldKey: 'K', thunderforestKey: 'T' }, { satellite: false }).map((b) => b.id)).toEqual(
      ['osm-transport', 'osm-standard', 'vworld-base'],
    );
    expect(resolveBasemap('vworld-base', {})).toBe('osm-standard');
    expect(resolveBasemap('nope', { thunderforestKey: 'T' })).toBe('osm-transport');
  });

  it('has one future line layer per line style, dashed only for non-solid', () => {
    const layers = futureLineLayers('src');
    expect(layers.map((l) => l.id)).toEqual([
      'future-line-solid',
      'future-line-dashed_bold',
      'future-line-dashed_thin',
    ]);
    expect(layers[0]!.paint!['line-dasharray']).toBeUndefined();
    expect(layers[2]!.paint!['line-dasharray']).toEqual(LINE_STYLES.dashed_thin.dasharray);
    expect(svgDash('solid')).toBeUndefined();
  });

  it('defines a palette color for each of the 12 progress stages', () => {
    expect(STAGE_ORDER).toHaveLength(12);
    for (const s of STAGE_ORDER) expect(STAGE_COLORS[s]).toMatch(/^#[0-9A-F]{6}$/);
  });
});
