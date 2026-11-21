import { describe, expect, it } from 'vitest';
import { bboxParam, curveThrough, haversineKm, lengthKm, parseLineGeoJson, type Coord } from './geo';

describe('geo', () => {
  it('하버사인 길이', () => {
    // 위도 1도 ≈ 111.2km
    expect(haversineKm([127, 37], [127, 38])).toBeCloseTo(111.2, 0);
    expect(
      lengthKm([
        [
          [127, 37],
          [127, 37.5],
          [127, 38],
        ],
      ]),
    ).toBeCloseTo(111.2, 0);
    expect(lengthKm([])).toBe(0);
  });

  it('곡선은 경유역을 지나고 끝점이 같다', () => {
    const pts: Coord[] = [
      [127.0, 37.5],
      [127.05, 37.48],
      [127.1, 37.45],
    ];
    const c = curveThrough(pts, 8);
    expect(c[0]).toEqual(pts[0]);
    expect(c[c.length - 1]).toEqual(pts[2]);
    expect(c).toContainEqual(pts[1]);
    expect(c.length).toBe(17);
    // 두 점이면 직선
    expect(curveThrough(pts.slice(0, 2))).toEqual(pts.slice(0, 2));
    // 곡선 길이 ≥ 직선 길이
    expect(lengthKm([c])).toBeGreaterThanOrEqual(lengthKm([pts]) - 1e-9);
  });

  it('GeoJSON 붙여넣기', () => {
    const fc = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [127, 37],
              [127.1, 37.1],
            ],
          },
        },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [127, 37] } },
      ],
    });
    expect(parseLineGeoJson(fc).coordinates).toEqual([
      [
        [127, 37],
        [127.1, 37.1],
      ],
    ]);
    expect(() => parseLineGeoJson('{')).toThrow(/JSON/);
    expect(() => parseLineGeoJson('{"type":"Point","coordinates":[1,2]}')).toThrow(/선/);
  });

  it('bbox 문자열', () => {
    const b = { getWest: () => 126.91234, getSouth: () => 37.4, getEast: () => 200, getNorth: () => 37.6 };
    expect(bboxParam(b)).toBe('126.9123,37.4,180,37.6');
  });
});
