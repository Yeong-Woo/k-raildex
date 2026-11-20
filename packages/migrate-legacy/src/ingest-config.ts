/**
 * 수집기 설정 이관(docs/08 3-3 ingest.config): 기존 보정 파일 → (task, key) 행.
 * - (tago-timetable, route_services) ← data/own/overrides/tago-route-services.yaml (subwayRouteId 접두 → 운행 계통·방향·fallback_label)
 * - (kric-train-ops, routes)         ← data/own/overrides/kric-train-ops-routes.yaml (routes·day_types·kinds·names)
 * - (kric-train-ops, rafis_abbr)     ← data/public/raw/src-kric-rafis-station/rafis-stations.csv (역약어명 → 역명, cp949)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Queryable } from '@k-raildex/domain';
import { parse } from 'yaml';
import { cleanName, setConfig } from './importers';

export interface IngestConfigRow {
  task: string;
  key: string;
  value: unknown;
  note: string;
}

/** RAFIS 역 CSV(cp949) → 역약어명 → 역명 목록(약어와 역명이 같으면 뺀다 — 기존 build-timetables.ts 규칙) */
export function parseRafisAbbr(buf: Buffer): Record<string, string[]> {
  const text =
    buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
      ? buf.subarray(3).toString('utf8')
      : new TextDecoder('euc-kr').decode(buf);
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = (lines.shift() ?? '').split(',').map((h) => h.trim());
  const iName = header.indexOf('역명');
  const iAbbr = header.indexOf('역약어명');
  if (iName < 0 || iAbbr < 0) throw new Error('RAFIS CSV 머리글에 역명·역약어명이 없음');
  const out: Record<string, string[]> = {};
  for (const l of lines) {
    const c = l.split(',');
    const a = cleanName(c[iAbbr] ?? '');
    const n = cleanName(c[iName] ?? '');
    if (!a || !n || a === n) continue;
    (out[a] ??= []).push(n);
  }
  return out;
}

export function legacyIngestConfig(root: string): IngestConfigRow[] {
  const rows: IngestConfigRow[] = [];
  const tago = join(root, 'data/own/overrides/tago-route-services.yaml');
  if (existsSync(tago))
    rows.push({
      task: 'tago-timetable',
      key: 'route_services',
      value: parse(readFileSync(tago, 'utf8')) as unknown,
      note: '기존 data/own/overrides/tago-route-services.yaml 이관',
    });
  const kric = join(root, 'data/own/overrides/kric-train-ops-routes.yaml');
  if (existsSync(kric))
    rows.push({
      task: 'kric-train-ops',
      key: 'routes',
      value: parse(readFileSync(kric, 'utf8')) as unknown,
      note: '기존 data/own/overrides/kric-train-ops-routes.yaml 이관(routes·day_types·kinds·names)',
    });
  const rafis = join(root, 'data/public/raw/src-kric-rafis-station/rafis-stations.csv');
  if (existsSync(rafis))
    rows.push({
      task: 'kric-train-ops',
      key: 'rafis_abbr',
      value: parseRafisAbbr(readFileSync(rafis)),
      note: 'RAFIS 역 정보(src-kric-rafis-station) 역약어명 → 역명. 운행정보 역명 해석용',
    });
  return rows;
}

export async function writeIngestConfig(db: Queryable, rows: IngestConfigRow[]): Promise<void> {
  for (const r of rows) await setConfig(db, r.task, r.key, r.value, r.note);
}
