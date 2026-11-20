/**
 * 시각 규칙(docs/legacy/design/timetable-model.md "시각 표기 규칙"): 04시 이전(00~03시)은 전날 다이아의 연장으로 보아
 * 24~27시(1440~1679분)로 둔다. 초는 버린다.
 */

const shift = (h: number) => (h < 4 ? h + 24 : h);

/** TAGO "HHMMSS"(앞 0 생략 가능, 없으면 "0") → 분 */
export function tagoMinute(raw: string | undefined | null): number | null {
  if (!raw || raw === '0') return null;
  const s = raw.padStart(6, '0');
  if (!/^\d{6}$/.test(s)) return null;
  const h = Number(s.slice(0, 2));
  const m = Number(s.slice(2, 4));
  if (h > 27 || m > 59) return null;
  return shift(h) * 60 + m;
}

/** 운행정보 "HH:MM(:SS)" → 분. 빈 값·"00:00"(기점 도착/종점 출발 없음)은 null */
export function opsMinute(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h === 0 && mi === 0) return null;
  if (h > 27 || mi > 59) return null;
  return shift(h) * 60 + mi;
}

/** 분 → "HH:MM"(24시 이후 표기 유지) */
export function minuteToHhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** "HH:MM" 또는 "HHMM" → 분 */
export function hhmmToMinute(t: string): number {
  const d = t.replace(':', '');
  return Number(d.slice(0, 2)) * 60 + Number(d.slice(2, 4));
}

/** 오늘 날짜(Asia/Seoul, YYYY-MM-DD) */
export function todayKst(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
