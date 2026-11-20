import { describe, expect, it } from 'vitest';
import { basemapStyle, futureLineLayers, LINE_STYLES, STAGE_COLORS, STAGE_ORDER, svgDash } from '../src/index';

describe('map styles', () => {
  it('uses OSM tiles without a VWorld key and VWorld WMTS with one', () => {
    const osm = basemapStyle();
    expect(JSON.stringify(osm.sources)).toContain('tile.openstreetmap.org');
    const vw = basemapStyle({ vworldKey: 'KEY' });
    expect(JSON.stringify(vw.sources)).toContain('api.vworld.kr/req/wmts/1.0.0/KEY/Base');
    expect(JSON.stringify(basemapStyle({ vworldKey: 'KEY', satellite: true }).sources)).toContain('/Satellite/');
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
