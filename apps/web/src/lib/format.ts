/** 화면 표기 도우미(순수 함수 — test/format.test.ts). 코드값 라벨은 contracts 의 codeLabel 을 쓴다. */
import { codeLabel, formatFuzzy, fuzzyFrom, isCode, type FuzzyDate } from '@k-raildex/contracts';

export { formatFuzzy };

/** 숫자 천 단위 쉼표 */
export function fmtNum(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('ko-KR');
}

/** 연장(km) 소수 첫째 자리 */
export function fmtKm(km: number | null | undefined): string {
  if (km == null) return '—';
  return (Math.round(km * 10) / 10).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
}

/** 하루 중 분(0~) → "05:30". 자정 넘김은 24:38 처럼 그대로(시간표 관례) */
export function fmtMinute(m: number | null | undefined): string {
  if (m == null) return '—';
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 파일 크기 */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 오늘 날짜(Asia/Seoul) YYYY-MM-DD */
export function todayKst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
}

/**
 * D-day 표기 — 날짜 정밀도가 **일 단위일 때만**(06 문서 4-1절). 월·반기·연 단위는 null(기간 그대로 표기).
 * 지난 날짜는 null(개통 예정이 지났으면 "지연" 배지로 따로 보인다).
 */
export function dday(f: FuzzyDate | null | undefined, today: string = todayKst()): string | null {
  if (!f || f.precision !== 'day' || !f.value) return null;
  const t = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const d = Date.UTC(+f.value.slice(0, 4), +f.value.slice(5, 7) - 1, +f.value.slice(8, 10));
  const diff = Math.round((d - t) / 86_400_000);
  if (diff < 0) return null;
  return diff === 0 ? 'D-day' : `D-${diff}`;
}

/** 퍼지 날짜의 기계 판독 값(<time dateTime>) */
export function fuzzyDateTime(f: FuzzyDate | null | undefined): string | undefined {
  if (!f || f.precision === 'unknown' || !f.value) return undefined;
  if (f.precision === 'half') return f.value.slice(0, 4);
  return f.value;
}

/** 시각 문자열(ISO) → "11-21" 처럼 월-일(Asia/Seoul) */
export function fmtMonthDay(iso: string): string {
  const d = todayKst(new Date(iso));
  return d.slice(5);
}

/** ISO 시각 → YYYY-MM-DD(Asia/Seoul) */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : todayKst(new Date(iso));
}

export { fuzzyFrom };

/**
 * 노선 칩·표지에 넣는 짧은 글자(시각 표시 전용, 데이터 아님).
 * "서울 지하철 2호선" → "2", "GTX-A" → "A", "부산 김해 경전철" → "부산", 그 밖은 앞 두 글자.
 */
export function lineShortLabel(nameKo: string): string {
  const num = /(\d+)호선/.exec(nameKo);
  if (num) return num[1]!;
  const gtx = /^GTX-([A-Z])/.exec(nameKo);
  if (gtx) return gtx[1]!;
  const stripped = nameKo.replace(/^(서울|부산|대구|인천|광주|대전|수도권)\s*(지하철|도시철도|전철)\s*/, '');
  const word = stripped.replace(/\s.*$/, '').replace(/(선|철도|경전철|고속선)$/, '');
  const base = word || stripped;
  return [...base].slice(0, 2).join('');
}

/** 운행 계통 종류 → 열차/전철 묶음(D21: 열차 = 고속·일반·관광, 전철 = 광역전철·도시철도) */
export type ServiceGroup = 'train' | 'metro';
export function serviceGroupOf(kind: string): ServiceGroup {
  return kind === 'wide_area' || kind === 'metro' ? 'metro' : 'train';
}

/** 역 구분(정차 열차 기준, legacy 12절). 정차 계통 종류가 없으면 노선의 법적 분류로 */
export type StopClass = 'high_speed' | 'intercity' | 'metro';
export const STOP_CLASS_ORDER: readonly StopClass[] = ['high_speed', 'intercity', 'metro'];
export const STOP_CLASS_LABEL: Record<StopClass, string> = {
  high_speed: '고속열차 정차역',
  intercity: '일반열차 정차역',
  metro: '광역전철·도시철도역',
};
export function stopClassesOf(serviceKinds: readonly string[], lineClasses: readonly string[]): StopClass[] {
  const out = new Set<StopClass>();
  for (const k of serviceKinds) {
    if (k === 'high_speed') out.add('high_speed');
    else if (k === 'intercity' || k === 'tourist') out.add('intercity');
    else if (k === 'wide_area' || k === 'metro') out.add('metro');
  }
  if (out.size === 0)
    for (const c of lineClasses) {
      if (c === 'high_speed') out.add('high_speed');
      else if (c === 'conventional') out.add('intercity');
      else if (c === 'urban') out.add('metro');
    }
  return STOP_CLASS_ORDER.filter((c) => out.has(c));
}

/** 검색 일치 종류(mv_search name_kind) → 화면 라벨. 모르는 값은 null(표시 안 함) */
export function matchedKindLabel(kind: string | null | undefined): string | null {
  if (!kind) return null;
  if (kind === 'name_en') return '영문';
  if (kind === 'name_full') return '정식 명칭';
  if (kind === 'line_name') return '노선별 역명';
  if (kind === 'section') return '구간';
  if (kind.startsWith('alias_')) {
    const k = kind.slice('alias_'.length);
    return isCode('entityNameKind', k) ? codeLabel('entityNameKind', k) : '별칭';
  }
  return null;
}
