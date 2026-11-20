/**
 * 파일 머리 주석 → docs/legacy/own-file-headers.md (FR-MIG-005, Q41 A).
 * 기존 YAML 파일 첫 주석(파일 설명·작성 규칙)은 개체에 속하지 않아 editor_note 로 옮기지 않고 문서 하나로 모은다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPORT_DIR } from './report';

export const HEADERS_FILE = 'own-file-headers.md';

/** 주석 본문이 코드 울타리(```)를 깨지 않게 울타리 길이를 늘린다 */
function fence(text: string): string {
  let f = '```';
  while (text.includes(f)) f += '`';
  return f;
}

export function renderHeaders(headers: ReadonlyMap<string, string>): string {
  const files = [...headers.keys()].sort();
  const out: string[] = [
    '# 기존 YAML 파일 머리 주석',
    '',
    `> 이관 도구(\`pnpm -F @k-raildex/migrate-legacy migrate:headers\`)가 생성한 파일 — 고치지 않는다(FR-MIG-005, Q41 A).`,
    `> 원본: \`future-rail-db\` 저장소 \`data/own/**/*.yaml\` 의 첫 주석. 파일 ${files.length}개(경로순).`,
    '',
  ];
  for (const f of files) {
    const body = headers.get(f)!.replace(/\s+$/, '');
    const fc = fence(body);
    out.push(`## \`${f}\``, '', `${fc}text`, body, fc, '');
  }
  return out.join('\n');
}

export function writeHeaders(headers: ReadonlyMap<string, string>, dir = REPORT_DIR): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, HEADERS_FILE);
  writeFileSync(path, renderHeaders(headers));
  return path;
}
