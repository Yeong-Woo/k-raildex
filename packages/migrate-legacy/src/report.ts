/** 대조 리포트 쓰기: docs/legacy/migration-report-<날짜>.md + .json (docs/07-migration.md 4절) */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EntityDiff, VerifyResult } from './verify';

export const REPORT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'legacy');

const INTENDED: [string, string, string][] = [
  ['D-1', '`LineStation.id`(`line-x--001`) → `ls-…`', '순서와 무관한 안정 id. 대조는 (노선, 역) 키로'],
  ['D-2', '역 `review_status` 원 값 없음', '상속은 뷰(v_station_review)'],
  ['D-3', '파생 이벤트 저장 안 함', '뷰(v_event_derived)가 같은 id 로 생성'],
  ['D-4', '`operator_name` → 운영기관 참조', '원문은 `extra.operator_name_raw` — 역변환은 원문으로 복원'],
  ['D-5', '상위 계획·환승센터 id 변경', 'Q69 A, id_redirect. 역변환은 옛 id 로 복원'],
  ['D-6', '다중 노선 역의 개통일 배분', 'Q95 A: 확실한 노선별 역에만, 나머지 미확인'],
  ['D-7', '`target_open` → 기대 일정', 'Q88·Q94 A: 근거(공식·보도) 출처가 없는 것은 미이관'],
];

const esc = (v: unknown) =>
  JSON.stringify(v ?? null)
    .replace(/\|/g, '\\|')
    .slice(0, 160);

function diffSection(d: EntityDiff): string[] {
  const out = [`### ${d.entity}`, '', `기존 ${d.legacyCount} / 역변환 ${d.migratedCount}`, ''];
  if (d.missing.length) out.push(`- 새 DB 에 없음 ${d.missing.length}: ${d.missing.slice(0, 20).join(', ')}`);
  if (d.extra.length) out.push(`- 기존에 없음 ${d.extra.length}: ${d.extra.slice(0, 20).join(', ')}`);
  const fields = Object.entries(d.fields).sort((a, b) => b[1].count - a[1].count);
  if (!fields.length) {
    out.push('- 필드 차이 없음', '');
    return out;
  }
  out.push('', '| 필드 | 차이 수 | 분류 | 예(id: 기존 → 새) |', '| --- | ---: | --- | --- |');
  for (const [f, v] of fields) {
    const s = v.samples
      .slice(0, 2)
      .map((x) => `${x.id}: ${esc(x.legacy)} → ${esc(x.migrated)}`)
      .join('<br>');
    out.push(`| ${f} | ${v.count} | ${v.intended ?? '**미설명**'} | ${s} |`);
  }
  out.push('');
  return out;
}

export function renderMarkdown(r: VerifyResult): string {
  const md: string[] = [];
  md.push(
    `# 이관 대조 리포트 ${r.date}`,
    '',
    '> `pnpm migrate:verify` 가 생성(packages/migrate-legacy). 기준: docs/07-migration.md 4절. 같은 이름의 .json 에 전체 목록.',
    '',
    '## 요약',
    '',
    `- Hard 위반: **${r.hardViolations.length}**`,
    `- 미설명 차이(필드·누락·추가): **${r.unexplained}**`,
    `- 계산 단계 ≠ 기존 stage: ${r.stageMismatch.length}`,
    `- 이벤트: 테이블 ${r.events.stored} + 파생 뷰 ${r.events.derived}, 기존 id 중 새 DB(테이블∪뷰)에 없는 것 ${r.events.legacyIdsMissing.length}`,
    `- 시간표: 세트 ${r.timetables.sets}, 행 ${r.timetables.entries}`,
    '- FK 위반: 0 (DB 외래 키가 적재 때 강제)',
    '',
    '## 1. 개체 수',
    '',
    '| 개체 | 기존 | 새 | 비고 |',
    '| --- | ---: | ---: | --- |',
  );
  for (const c of r.counts) md.push(`| ${c.entity} | ${c.legacy ?? '-'} | ${c.migrated} | ${c.note} |`);
  md.push('', '## 2. 의도된 차이(D-1~D-7)', '', '| # | 차이 | 이유 |', '| --- | --- | --- |');
  for (const [k, a, b] of INTENDED) md.push(`| ${k} | ${a} | ${b} |`);
  md.push('', '## 3. 필드 대조(역변환 JSON vs data/build/*.json)', '');
  for (const d of r.diffs) md.push(...diffSection(d));
  md.push('## 4. 연표', '');
  md.push(...diffSection(r.events.fieldDiffs));
  if (r.events.legacyIdsMissing.length)
    md.push(
      `- 기존 이벤트 id 중 테이블·파생 뷰에 없는 것 ${r.events.legacyIdsMissing.length}: ${r.events.legacyIdsMissing.slice(0, 30).join(', ')}`,
      '',
    );
  md.push('## 5. 시간표 요약', '');
  md.push(...diffSection(r.timetables.summaryDiffs));
  md.push('## 6. 계획', '', `### 계산 단계 ≠ 기존 stage (${r.stageMismatch.length})`, '');
  for (const s of r.stageMismatch.slice(0, 100)) md.push(`- ${s.id}: 기존 ${s.legacy} → 계산 ${s.computed ?? '없음'}`);
  md.push('', '### 역할 초안 통계', '');
  for (const [k, v] of Object.entries(r.roleStats)) md.push(`- ${k}: ${v}`);
  md.push('', '## 7. Hard 위반', '');
  if (!r.hardViolations.length) md.push('- 없음');
  for (const v of r.hardViolations.slice(0, 100)) md.push(`- ${v.rule} ${v.entity_id ?? ''}: ${v.message}`);
  md.push('', '## 8. 해석 실패·판정 불가(이관 단계)', '');
  for (const [k, list] of Object.entries(r.migrationIssues)) {
    md.push(`### ${k} (${list.length})`, '');
    for (const x of list.slice(0, 40)) md.push(`- ${x}`);
    if (list.length > 40) md.push(`- … 외 ${list.length - 40}건(JSON 참고)`);
    md.push('');
  }
  md.push('## 9. 이관 통계', '');
  for (const [k, v] of Object.entries(r.migrationStats)) md.push(`- ${k}: ${v}`);
  md.push(
    '',
    '## 10. 이 리포트에 없는 항목',
    '',
    '- 파일 sha256·원본 재다운로드(WP 3.7·3.8) — 문서 저장소 적재 단계에서.',
    '- osm 스키마·ingest 설정 이관 — 이후 WP.',
    '',
  );
  return md.join('\n');
}

export function writeReport(r: VerifyResult, dir = REPORT_DIR): { md: string; json: string } {
  mkdirSync(dir, { recursive: true });
  const md = join(dir, `migration-report-${r.date}.md`);
  const json = join(dir, `migration-report-${r.date}.json`);
  writeFileSync(md, renderMarkdown(r));
  writeFileSync(json, `${JSON.stringify(r, null, 2)}\n`);
  return { md, json };
}
