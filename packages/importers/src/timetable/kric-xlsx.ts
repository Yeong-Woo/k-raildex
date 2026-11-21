/**
 * 레일포털(KRIC) 파일데이터 "표준데이터 운행정보" 원본 xlsx 내려받기·정규화(round-04 Q108 A).
 * 기존 packages/pipeline/src/ingest/fetch-kric-train-ops.ts 이식 — 같은 입력이면 같은 정규화 결과(열차 단위
 * { no, day, kind, from, to, stops: [[역명 원문, 도착, 출발]] }, 노선번호별 KricFile)를 낸다.
 * - 원본: https://data.kric.go.kr/rips/dataset/download.file?type=filedata&id=<id>&operation=1 (키·로그인 불필요)
 *   id 900 = 전체 기관(정규화 산출은 이 파일에서만, 코레일 id 6·서울교통공사 id 14 는 그 부분집합)
 * - 모양 두 가지: 역마다 1행(코레일 — 머리글 앞에 안내 행) / 열차 1편이 1행이고 역·시각이 '+'·',' 로 이어짐(서울·인천 등).
 *   항목 앞 순번·역번호("001-", "D12-", "4107-")는 뗀다. 시각은 엑셀 시간값이라 HH:MM:SS 만 쓴다.
 * - 노선번호 행이 MIN_ROWS(5) 미만이면 셀 깨짐으로 보고 건너뛴다(김포골드라인 L41G2~59 처럼 1행짜리).
 * xlsx 는 exceljs 스트리밍 해석기로 읽는다(원본 18MB·22만 행).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import type { KricFile, KricTrain } from './kric';

export const KRIC_FILEDATA_ID = 900;
export const KRIC_FILEDATA_LABEL = '전체 기관';
export const KRIC_SOURCE_ID = 'src-kric-file-train-ops';
export const KRIC_MIN_ROWS = 5;

export const kricFiledataUrl = (id: number = KRIC_FILEDATA_ID) =>
  `https://data.kric.go.kr/rips/dataset/download.file?type=filedata&id=${id}&operation=1`;
export const kricXlsxName = (id: number = KRIC_FILEDATA_ID) => `kric-filedata-${id}.xlsx`;

const pad = (n: number) => String(n).padStart(2, '0');

/** 엑셀 셀 → 시각 "HH:MM:SS". Date(1899-12-30 기준 UTC) / 일 단위 소수 / "HH:MM(:SS)" 문자열. 빈 값은 '' */
export function toTime(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  if (typeof v === 'number') {
    const s = Math.round(v * 86400) % 86400;
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  }
  if (typeof v === 'object' && 'result' in v) return toTime((v as { result: unknown }).result);
  const t = String(v as string | number | boolean).trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (m) return `${m[1]!.padStart(2, '0')}:${m[2]}:${m[3] ?? '00'}`;
  return t;
}

export function toText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('');
    if ('result' in o) return toText(o.result);
    if ('text' in o) return String(o.text as string);
  }
  return String(v as string | number | boolean).trim();
}

/** 데이터기준일자: Date / 엑셀 일련번호(46173) / "2026-05-31" */
export function toDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000)
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const t = toText(v);
  const m = /^(\d{4})[-.](\d{2})[-.](\d{2})/.exec(t);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : t;
}

const stripCode = (s: string) => s.replace(/^[A-Za-z]{0,3}\d{2,4}-/, '').trim();

export interface KricXlsxResult {
  files: KricFile[];
  sheet: string;
  header_row: number;
  rows: number;
  data_as_of: string;
  /** 행 수가 적어 건너뛴 노선번호 → 행 수 */
  skipped: Record<string, number>;
  sha256: string;
  bytes: number;
}

/** 행 배열(머리글 포함, 1부터 번호) → 정규화. 해석 규칙의 본체(시험은 이 함수와 실제 xlsx 둘 다로) */
export class KricRowNormalizer {
  private header: string[] = [];
  headerRow = 0;
  rows = 0;
  dataAsOf = '';
  private lines = new Map<string, { name: string; trains: Map<string, KricTrain>; rows: number }>();

  push(rowNumber: number, vals: unknown[]): void {
    if (!this.header.length) {
      const texts = vals.map(toText);
      if (texts.includes('열차번호')) {
        this.header = texts.map((h) => h.replace(/\s+/g, ''));
        this.headerRow = rowNumber;
      }
      return;
    }
    const o: Record<string, unknown> = {};
    this.header.forEach((h, i) => {
      if (h) o[h] = vals[i];
    });
    const lineNo = toText(o['노선번호']);
    const no = toText(o['열차번호']);
    if (!lineNo || !no) return;
    this.rows++;
    const day = toText(o['요일구분']);
    const kind = toText(o['운행유형']) || '일반';
    const from = toText(o['운행구간기점명']).replace(/^[A-Za-z]{0,3}\d{2,4}-/, '');
    const to = toText(o['운행구간종점명']).replace(/^[A-Za-z]{0,3}\d{2,4}-/, '');
    const asOf = toDate(o['데이터기준일자']);
    if (asOf > this.dataAsOf) this.dataAsOf = asOf;
    let L = this.lines.get(lineNo);
    if (!L) this.lines.set(lineNo, (L = { name: toText(o['노선명']), trains: new Map(), rows: 0 }));
    L.rows++;
    const tKey = `${day}|${no}|${kind}|${from}|${to}`;
    let T = L.trains.get(tKey);
    if (!T) L.trains.set(tKey, (T = { no, day, kind, from, to, stops: [] }));
    const stRaw = toText(o['운행구간정거장']);
    // 열 이름 오타(정가장출발시각, 전체 기관 파일)도 받아들인다
    const arrRaw = o['정거장도착시각'];
    const depRaw = o['정거장출발시각'] ?? o['정가장출발시각'];
    const sep = stRaw.includes('+') ? '+' : stRaw.includes(',') ? ',' : undefined;
    if (sep) {
      const names = stRaw.split(sep).map(stripCode);
      const arrs = toText(arrRaw)
        .split(sep)
        .map((s) => toTime(stripCode(s)));
      const deps = toText(depRaw)
        .split(sep)
        .map((s) => toTime(stripCode(s)));
      names.forEach((n, i) => T.stops.push([n, arrs[i] ?? '', deps[i] ?? '']));
    } else
      T.stops.push([
        stripCode(stRaw),
        toTime(typeof arrRaw === 'string' ? stripCode(arrRaw) : arrRaw),
        toTime(typeof depRaw === 'string' ? stripCode(depRaw) : depRaw),
      ]);
  }

  finish(meta: { file_id: number; label: string; retrieved_at: string; minRows?: number }): {
    files: KricFile[];
    skipped: Record<string, number>;
  } {
    const minRows = meta.minRows ?? KRIC_MIN_ROWS;
    const files: KricFile[] = [];
    const skipped: Record<string, number> = {};
    for (const [lineNo, L] of [...this.lines.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (L.rows < minRows) {
        skipped[lineNo] = L.rows;
        continue;
      }
      const trains = [...L.trains.values()].sort(
        (a, b) =>
          a.day.localeCompare(b.day) ||
          a.no.localeCompare(b.no, undefined, { numeric: true }) ||
          a.kind.localeCompare(b.kind) ||
          a.from.localeCompare(b.from),
      );
      files.push({
        source_id: KRIC_SOURCE_ID,
        file_id: meta.file_id,
        label: meta.label,
        line_no: lineNo,
        line_name: L.name,
        data_as_of: this.dataAsOf,
        retrieved_at: meta.retrieved_at,
        rows: L.rows,
        trains,
      });
    }
    return { files, skipped };
  }
}

/** 원본 xlsx 하나 → 노선번호별 KricFile(스트리밍) */
export async function normalizeKricXlsx(
  path: string,
  meta: { file_id?: number; label?: string; retrieved_at?: string; minRows?: number } = {},
): Promise<KricXlsxResult> {
  const buf = readFileSync(path);
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {
    entries: 'emit',
    sharedStrings: 'cache',
    worksheets: 'emit',
  });
  const norm = new KricRowNormalizer();
  let sheet = '';
  for await (const ws of reader) {
    sheet ||= (ws as unknown as { name?: string }).name ?? '';
    for await (const row of ws as AsyncIterable<ExcelJS.Row>) {
      norm.push(row.number, (row.values as unknown[]).slice(1));
    }
  }
  const { files, skipped } = norm.finish({
    file_id: meta.file_id ?? KRIC_FILEDATA_ID,
    label: meta.label ?? KRIC_FILEDATA_LABEL,
    retrieved_at: meta.retrieved_at ?? statSync(path).mtime.toISOString().slice(0, 10),
    minRows: meta.minRows,
  });
  return {
    files,
    sheet,
    header_row: norm.headerRow,
    rows: norm.rows,
    data_as_of: norm.dataAsOf,
    skipped,
    sha256: createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length,
  };
}

/** --from-xlsx 값(파일 또는 디렉터리) → xlsx 경로. 디렉터리면 kric-filedata-900.xlsx, 없으면 유일한 .xlsx */
export function resolveKricXlsx(p: string): string {
  if (!existsSync(p)) throw new Error(`운행정보 xlsx 없음: ${p}`);
  if (!statSync(p).isDirectory()) return p;
  const preferred = join(p, kricXlsxName());
  if (existsSync(preferred)) return preferred;
  const xs = readdirSync(p).filter((f) => f.toLowerCase().endsWith('.xlsx'));
  if (xs.length === 1) return join(p, xs[0]!);
  throw new Error(
    `${p}: ${kricXlsxName()} 가 없고 .xlsx 가 ${xs.length}개 — 파일 경로를 직접 주세요(--from-xlsx <file>)`,
  );
}

const UA = 'k-raildex-ingest (non-commercial)';

/** 원본 xlsx 내려받기(키 불필요). dir/kric-filedata-<id>.xlsx 에 저장 */
export async function downloadKricXlsx(
  dir: string,
  opts: { fileId?: number; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ path: string; url: string; bytes: number; sha256: string }> {
  const id = opts.fileId ?? KRIC_FILEDATA_ID;
  const url = kricFiledataUrl(id);
  const f = opts.fetchImpl ?? fetch;
  const res = await f(url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(opts.timeoutMs ?? 300_000),
  });
  if (!res.ok) throw new Error(`운행정보 xlsx 내려받기 실패: HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000 || buf[0] !== 0x50 || buf[1] !== 0x4b)
    throw new Error(`xlsx(zip) 가 아님: ${buf.length} bytes, content-type=${res.headers.get('content-type')}`);
  mkdirSync(resolve(dir), { recursive: true });
  const path = join(resolve(dir), kricXlsxName(id));
  writeFileSync(path, buf);
  return { path, url, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}
