/**
 * 사용자 정의 열 형식과 공간 SQL 도우미.
 *
 * 형식 대응(일관 규칙):
 * - date → `{ mode: 'string' }` ('YYYY-MM-DD')
 * - timestamptz → `{ withTimezone: true, mode: 'string' }`
 * - numeric(p,s) → `{ mode: 'number' }` (정밀도 ≤ 12 자리라 double 로 손실 없음)
 * - bigint → `{ mode: 'number' }` (identity·OSM id 는 2^53 미만)
 * - geography(Point, 4326) → `{ lat, lng }` (드라이버 값 hex EWKB 를 직접 해석, 쓰기는 EWKT)
 * - geometry(…, 4326) → hex EWKB 문자열 그대로. 읽기·쓰기는 `asGeoJSON()`·`geomFromGeoJSON()` SQL 조각을 쓴다.
 */
import { customType } from 'drizzle-orm/pg-core';
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

export interface LatLng {
  lat: number;
  lng: number;
}

/** hex EWKB(Point) → { lat, lng }. 형식이 다르면 예외 */
export function parseEwkbPoint(hex: string): LatLng {
  const buf = Buffer.from(hex, 'hex');
  const le = buf.readUInt8(0) === 1;
  const rawType = le ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
  if ((rawType & 0xff) !== 1) throw new Error(`EWKB 가 Point 가 아니다: type=${rawType}`);
  if (rawType & 0x80000000 || rawType & 0x40000000) throw new Error('Z/M 좌표가 있는 Point 는 지원하지 않는다');
  let off = 5;
  if (rawType & 0x20000000) off += 4; // SRID
  const x = le ? buf.readDoubleLE(off) : buf.readDoubleBE(off);
  const y = le ? buf.readDoubleLE(off + 8) : buf.readDoubleBE(off + 8);
  return { lat: y, lng: x };
}

/** geography(Point, 4326) ↔ { lat, lng } */
export const geographyPoint = customType<{ data: LatLng; driverData: string }>({
  dataType() {
    return 'geography(Point, 4326)';
  },
  toDriver(v) {
    return `SRID=4326;POINT(${v.lng} ${v.lat})`;
  },
  fromDriver(v) {
    return parseEwkbPoint(v);
  },
});

function geometryType(kind: string) {
  return customType<{ data: string; driverData: string }>({
    dataType() {
      return `geometry(${kind}, 4326)`;
    },
  });
}

/** geometry(MultiLineString, 4326). 값은 hex EWKB(또는 쓰기 시 EWKT/EWKB) 문자열 */
export const geometryMultiLineString = geometryType('MultiLineString');
/** geometry(LineString, 4326) — osm.way */
export const geometryLineString = geometryType('LineString');

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

/** numeric[] ↔ number[] (pg 는 원소를 문자열로 준다) */
export const numericArray = customType<{ data: number[]; driverData: (string | number)[] }>({
  dataType() {
    return 'numeric[]';
  },
  toDriver(v) {
    return v;
  },
  fromDriver(v) {
    return v.map(Number);
  },
});

// ── SQL 조각 ──

/** 위경도 → geography(Point, 4326) */
export function pointFromLatLng(lat: number, lng: number): SQL {
  return sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
}

/** geography Point 열의 위도 */
export function latOf(col: SQLWrapper): SQL<number | null> {
  return sql<number | null>`ST_Y(${col}::geometry)`;
}

/** geography Point 열의 경도 */
export function lngOf(col: SQLWrapper): SQL<number | null> {
  return sql<number | null>`ST_X(${col}::geometry)`;
}

/** 공간 열 → GeoJSON 문자열 */
export function asGeoJSON(col: SQLWrapper): SQL<string | null> {
  return sql<string | null>`ST_AsGeoJSON(${col})`;
}

/** GeoJSON(geometry) → geometry(…, 4326). MultiLineString 열이면 ST_Multi 로 감싼다 */
export function geomFromGeoJSON(geojson: string | object, multi = true): SQL {
  const text = typeof geojson === 'string' ? geojson : JSON.stringify(geojson);
  const g = sql`ST_SetSRID(ST_GeomFromGeoJSON(${text}), 4326)`;
  return multi ? sql`ST_Multi(${g})` : g;
}
