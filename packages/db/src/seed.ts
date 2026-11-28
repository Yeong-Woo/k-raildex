/**
 * 참조 시드: 권역·시·도·외부 시스템 (docs/03-data-model.md 4-1·3-2절). 몇 번 실행해도 같은 결과(upsert).
 * 시·도 이름·슬러그·순서는 기존 시스템 packages/core/src/region.ts 를 승계한다. 코드 = 행정표준코드 앞 2자리.
 */
import { codes } from '@k-raildex/contracts';
import type { Client, Pool, PoolClient } from 'pg';

type Queryable = Pick<Client | PoolClient | Pool, 'query'>;

export const REGIONS = [
  { code: '11', name: '서울특별시', short: '서울', slug: 'seoul', area: 'capital' },
  { code: '26', name: '부산광역시', short: '부산', slug: 'busan', area: 'southeast' },
  { code: '27', name: '대구광역시', short: '대구', slug: 'daegu', area: 'daegyeong' },
  { code: '28', name: '인천광역시', short: '인천', slug: 'incheon', area: 'capital' },
  { code: '29', name: '광주광역시', short: '광주', slug: 'gwangju', area: 'honam' },
  { code: '30', name: '대전광역시', short: '대전', slug: 'daejeon', area: 'chungcheong' },
  { code: '31', name: '울산광역시', short: '울산', slug: 'ulsan', area: 'southeast' },
  { code: '36', name: '세종특별자치시', short: '세종', slug: 'sejong', area: 'chungcheong' },
  { code: '41', name: '경기도', short: '경기', slug: 'gyeonggi', area: 'capital' },
  { code: '51', name: '강원특별자치도', short: '강원', slug: 'gangwon', area: 'gangwon' },
  { code: '43', name: '충청북도', short: '충북', slug: 'chungbuk', area: 'chungcheong' },
  { code: '44', name: '충청남도', short: '충남', slug: 'chungnam', area: 'chungcheong' },
  { code: '52', name: '전북특별자치도', short: '전북', slug: 'jeonbuk', area: 'honam' },
  { code: '46', name: '전라남도', short: '전남', slug: 'jeonnam', area: 'honam' },
  { code: '47', name: '경상북도', short: '경북', slug: 'gyeongbuk', area: 'daegyeong' },
  { code: '48', name: '경상남도', short: '경남', slug: 'gyeongnam', area: 'southeast' },
  { code: '50', name: '제주특별자치도', short: '제주', slug: 'jeju', area: 'jeju' },
] as const;

/** 옛 시·도 이름(이관 때 기존 데이터의 region 문자열 해석용) */
export const REGION_ALIASES: Readonly<Record<string, string>> = {
  강원도: '51',
  전라북도: '52',
};

const AREA_EN: Record<string, string> = {
  capital: 'Capital Region',
  southeast: 'Southeast Region',
  daegyeong: 'Daegu–Gyeongbuk Region',
  chungcheong: 'Chungcheong Region',
  honam: 'Honam Region',
  gangwon: 'Gangwon Region',
  jeju: 'Jeju Region',
  national: 'Nationwide',
};

/** 외부 데이터셋 코드 체계. entity_type = 코드를 붙이는 개체(노선 문맥 코드는 정거장, Q72 A) */
export const EXTERNAL_SYSTEMS = [
  { code: 'tago_subway', name: 'TAGO 지하철역 ID', entity: 'line_station' },
  { code: 'kric_station_std', name: '전국도시철도역사정보 표준데이터 역번호', entity: 'line_station' },
  { code: 'molit_metro_lines', name: '국토교통부 도시철도 전체노선 역 키', entity: 'line_station' },
  { code: 'rafis', name: '국가철도공단 RAFIS 역', entity: 'station' },
  { code: 'korail_station_kilo', name: '코레일 역키로정내역 역명', entity: 'station' },
  { code: 'korail_ktx_stations', name: '코레일 KTX 정거장정보', entity: 'station' },
  { code: 'kric_station_info', name: '국가철도공단 철도역 정보', entity: 'station' },
  { code: 'korail_station_loc', name: '코레일 역 위치', entity: 'station' },
  { code: 'korail_stn_cd', name: '코레일 역 코드', entity: 'station' },
  { code: 'tago_train', name: 'TAGO 열차정보 역 ID', entity: 'station' },
  { code: 'kric_route', name: '레일포털 노선정보 노선번호', entity: 'line' },
  { code: 'kric_metro_line_info', name: '도시광역철도 노선정보', entity: 'line' },
  { code: 'kric_station_std_line', name: '표준데이터 노선번호', entity: 'line' },
  { code: 'molit_line_no', name: '사업용철도 노선번호(국토교통부 고시)', entity: 'line', multiEntity: true },
  { code: 'kr_line_no', name: '국가철도공단 노선번호', entity: 'line' },
  { code: 'korail_kilo_line', name: '코레일 역키로정 노선코드', entity: 'line' },
  { code: 'molit_metro_lines_line', name: '국토교통부 도시철도 전체노선 노선', entity: 'line' },
] as const;

export async function seedReference(db: Queryable): Promise<void> {
  const areas = codes.area.values;
  for (const [i, code] of areas.entries()) {
    await db.query(
      `INSERT INTO ref_area (code, name_ko, name_en, ord) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE SET name_ko = EXCLUDED.name_ko, name_en = EXCLUDED.name_en, ord = EXCLUDED.ord`,
      [code, codes.area.labels[code].ko, AREA_EN[code] ?? null, i + 1],
    );
  }
  for (const [i, r] of REGIONS.entries()) {
    await db.query(
      `INSERT INTO ref_region (code, name_ko, short_ko, slug, area_code, ord) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (code) DO UPDATE SET name_ko = EXCLUDED.name_ko, short_ko = EXCLUDED.short_ko,
         slug = EXCLUDED.slug, area_code = EXCLUDED.area_code, ord = EXCLUDED.ord`,
      [r.code, r.name, r.short, r.slug, r.area, i + 1],
    );
  }
  for (const s of EXTERNAL_SYSTEMS) {
    await db.query(
      `INSERT INTO ref_external_system (code, name_ko, entity_type, multi_entity_per_code) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE SET name_ko = EXCLUDED.name_ko, entity_type = EXCLUDED.entity_type,
         multi_entity_per_code = EXCLUDED.multi_entity_per_code`,
      [s.code, s.name, s.entity, 'multiEntity' in s ? s.multiEntity : false],
    );
  }
}
