/** 운행정보 원본 xlsx 정규화(Q108 A) — 작은 xlsx 를 만들어 두 모양(역마다 1행 / 열차 1편 1행)을 확인 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { downloadKricXlsx, normalizeKricXlsx, resolveKricXlsx, toDate, toTime } from '../src';

const HEAD = [
  '열차번호',
  '노선번호',
  '노선명',
  '운행구간기점명',
  '운행구간종점명',
  '운행유형',
  '요일구분',
  '운행구간정거장',
  '정거장도착시각',
  '정가장출발시각', // 전체 기관 파일의 열 이름 오타
  '데이터기준일자',
];
const t = (h: number, m: number, sec = 0) => new Date(Date.UTC(1899, 11, 30, h, m, sec));

let dir: string;
let file: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'kric-xlsx-'));
  file = join(dir, 'kric-filedata-900.xlsx');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('표준데이터 운행(전체)');
  ws.addRow(HEAD);
  // 모양 1: 역마다 1행(코레일). 같은 열차의 행이 이어진다
  const k = ['K1001', 'I4103', '4호선', 'K411-당고개', 'K449-오이도', '일반', '평일'];
  ws.addRow([...k, 'K411-당고개', null, t(5, 30), 46173]);
  ws.addRow([...k, '상계', t(5, 32), t(5, 32, 30), 46173]);
  ws.addRow([...k, '노원', t(5, 34), 0.2333333, 46173]);
  for (let i = 0; i < 3; i++)
    ws.addRow([
      'K1003',
      'I4103',
      '4호선',
      '당고개',
      '오이도',
      '급행',
      '토요일+공휴일',
      '상계',
      '06:00',
      '06:01',
      46173,
    ]);
  // 모양 2: 열차 1편 1행, '+' 로 이어짐(서울교통공사)
  for (let i = 0; i < 5; i++)
    ws.addRow([
      `S${200 + i}`,
      'S1102',
      '2호선',
      '201-시청',
      '202-을지로입구',
      null,
      '평일',
      '001-시청+002-을지로입구',
      '05:30+05:32',
      '05:31+05:33',
      new Date(Date.UTC(2026, 5, 25)),
    ]);
  // 행이 적은 노선번호(셀 깨짐) → 건너뜀
  ws.addRow(['G1', 'L41G2', '김포', 'a', 'b', '일반', '평일', '구래', '05:00', '05:00', 46173]);
  await wb.xlsx.writeFile(file);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('운행정보 xlsx 정규화', () => {
  it('셀 값 변환', () => {
    expect(toTime(t(5, 30))).toBe('05:30:00');
    expect(toTime(0.5)).toBe('12:00:00');
    expect(toTime('5:07')).toBe('05:07:00');
    expect(toTime('')).toBe('');
    expect(toDate(46173)).toBe('2026-05-31');
    expect(toDate('2026.06.25')).toBe('2026-06-25');
  });

  it('두 모양을 노선번호별 열차 단위로', async () => {
    const r = await normalizeKricXlsx(file, { retrieved_at: '2026-11-21' });
    expect(r.sheet).toBe('표준데이터 운행(전체)');
    expect(r.header_row).toBe(1);
    expect(r.rows).toBe(12);
    expect(r.data_as_of).toBe('2026-06-25');
    expect(r.skipped).toEqual({ L41G2: 1 });
    expect(r.files.map((f) => f.line_no)).toEqual(['I4103', 'S1102']);
    const i4103 = r.files[0]!;
    expect(i4103).toMatchObject({
      source_id: 'src-kric-file-train-ops',
      file_id: 900,
      label: '전체 기관',
      line_name: '4호선',
      rows: 6,
      retrieved_at: '2026-11-21',
    });
    expect(i4103.trains.map((x) => [x.day, x.no, x.kind, x.from, x.to])).toEqual([
      ['토요일+공휴일', 'K1003', '급행', '당고개', '오이도'],
      ['평일', 'K1001', '일반', '당고개', '오이도'],
    ]);
    expect(i4103.trains[1]!.stops).toEqual([
      ['당고개', '', '05:30:00'],
      ['상계', '05:32:00', '05:32:30'],
      ['노원', '05:34:00', '05:36:00'],
    ]);
    const s1102 = r.files[1]!;
    expect(s1102.trains).toHaveLength(5);
    expect(s1102.trains[0]).toEqual({
      no: 'S200',
      day: '평일',
      kind: '일반',
      from: '시청',
      to: '을지로입구',
      stops: [
        ['시청', '05:30:00', '05:31:00'],
        ['을지로입구', '05:32:00', '05:33:00'],
      ],
    });
  });

  it('디렉터리 → kric-filedata-900.xlsx', () => {
    expect(resolveKricXlsx(dir)).toBe(file);
    expect(() => resolveKricXlsx(join(dir, 'none'))).toThrow(/없음/);
  });

  it('내려받기: zip 이 아니면 거부, 맞으면 저장', async () => {
    const html = (async () => new Response('<html>error</html>'.repeat(100), { status: 200 })) as typeof fetch;
    await expect(downloadKricXlsx(dir, { fetchImpl: html })).rejects.toThrow(/zip/);
    const { readFileSync } = await import('node:fs');
    const body = readFileSync(file);
    let calledUrl = '';
    const ok = (async (u: string | URL | Request) => {
      calledUrl = String(u);
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    const out = join(dir, 'dl');
    const d = await downloadKricXlsx(out, { fetchImpl: ok });
    expect(calledUrl).toBe('https://data.kric.go.kr/rips/dataset/download.file?type=filedata&id=900&operation=1');
    expect(d.bytes).toBe(body.length);
    expect((await normalizeKricXlsx(d.path)).rows).toBe(12);
    writeFileSync(join(out, 'other.xlsx'), body);
    expect(resolveKricXlsx(out)).toBe(d.path);
  });
});
