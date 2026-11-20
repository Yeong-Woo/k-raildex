/**
 * 적재(WP 3.9). 개체는 모두 도메인 적용기(applyChangeset, origin legacy_migration, 작성자 system "legacy-migration")로 쓴다.
 * - 단계(docs/07-migration.md 2절 순서)마다 변경 묶음 하나: cs-<날짜>-legacy-migration-<nn>-<단계>.
 *   한 묶음이 너무 크면 롤백·진단이 어려워 단계로 나눴다(모두 origin legacy_migration).
 * - 시간표(timetable_set·entry)와 id_redirect 는 개체가 아닌 기계적 데이터라 SQL 한 트랜잭션으로 쓴다
 *   (수집기의 시간표 재수집과 같은 성격, CLAUDE.md 3절 8 "자동 반영은 기계적 갱신뿐").
 * - 기존 변경 묶음 170건은 본문만 보관하는 op 없는 변경 묶음으로(Q36 A).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TimetableSet } from '@k-raildex/contracts';
import { migrate, seedReference } from '@k-raildex/db';
import { applyChangeset, DomainError, ensureServiceUser, type Queryable } from '@k-raildex/domain';
import { parseDocument } from 'yaml';
import type { LegacyData } from './read/legacy';
import type { IdRedirect, Stage, TransformResult } from './transform';

export type Log = (msg: string) => void;

export interface LoadTiming {
  stage: string;
  ops: number;
  ms: number;
}

export async function resetDatabase(db: Queryable, log: Log): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('운영 환경에서는 reset 금지');
  await db.query(
    'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS osm CASCADE; DROP SCHEMA IF EXISTS ingest CASCADE; CREATE SCHEMA public;',
  );
  await migrate(db);
  await seedReference(db);
  log('DB 초기화(스키마·참조 시드)');
}

export async function assertEmpty(db: Queryable): Promise<void> {
  const r = await db.query<{ n: string }>(`SELECT count(*) AS n FROM entity`);
  if (Number(r.rows[0]!.n) > 0) throw new Error('DB 에 이미 개체가 있음 — 빈 DB 에서 실행하거나 --reset');
}

function formatViolations(e: unknown): string {
  if (!(e instanceof DomainError)) return String((e as Error)?.stack ?? e);
  const v = e.details.violations ?? [];
  return `${e.message}\n${v
    .slice(0, 30)
    .map((x) => `  ${x.rule} ${x.entity_id ?? ''} ${x.path}: ${x.message}`)
    .join('\n')}${v.length > 30 ? `\n  … 외 ${v.length - 30}건` : ''}`;
}

export async function applyStages(
  db: Queryable,
  stages: Stage[],
  authorId: string,
  date: string,
  log: Log,
): Promise<LoadTiming[]> {
  const timings: LoadTiming[] = [];
  for (const [i, st] of stages.entries()) {
    if (!st.ops.length) continue;
    const t0 = performance.now();
    const id = `cs-${date}-legacy-migration-${String(i + 1).padStart(2, '0')}-${st.key.replace(/_/g, '-')}`;
    try {
      await applyChangeset(db, {
        id,
        title: `기존 시스템 이관: ${st.title}`,
        rationale: 'future-rail-db 데이터 이관(docs/07-migration.md, FR-MIG-004)',
        origin: 'legacy_migration',
        author_id: authorId,
        ops: st.ops,
        meta: { stage: st.key },
      });
    } catch (e) {
      throw new Error(`단계 ${st.key} 적재 실패: ${formatViolations(e)}`, { cause: e });
    }
    const ms = performance.now() - t0;
    timings.push({ stage: st.key, ops: st.ops.length, ms });
    log(`  ${id}: op ${st.ops.length}건 ${(ms / 1000).toFixed(1)}s`);
  }
  return timings;
}

/** 시간표·id 리다이렉트: 한 트랜잭션 SQL */
export async function writeMechanical(db: Queryable, sets: TimetableSet[], redirects: IdRedirect[]): Promise<void> {
  await db.query('BEGIN');
  try {
    for (const r of redirects) {
      await db.query(
        `INSERT INTO id_redirect (old_id, new_id, reason) VALUES ($1, $2, $3) ON CONFLICT (old_id) DO NOTHING`,
        [r.old_id, r.new_id, r.reason],
      );
    }
    for (const s of sets) {
      await db.query(
        `INSERT INTO timetable_set (id, station_id, line_station_id, service_id, route_code, day_type, direction,
           direction_label, day_note, data_as_of, source_id, import_run_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          s.id,
          s.station_id,
          s.line_station_id,
          s.service_id,
          s.route_code,
          s.day_type,
          s.direction,
          s.direction_label,
          s.day_note,
          s.data_as_of,
          s.source_id,
          s.import_run_id,
        ],
      );
      // 행은 묶어서(파라미터 6개 × 최대 1000행)
      for (let i = 0; i < s.entries.length; i += 1000) {
        const chunk = s.entries.slice(i, i + 1000);
        const params: unknown[] = [];
        const values = chunk.map((e) => {
          params.push(s.id, e.minute, e.dest_name, e.dest_station_id, e.train_no, e.note);
          const b = params.length - 6;
          return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`;
        });
        await db.query(
          `INSERT INTO timetable_entry (set_id, minute, dest_name, dest_station_id, train_no, note) VALUES ${values.join(', ')}`,
          params,
        );
      }
    }
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

/** 기존 변경 묶음 → op 없는 변경 묶음(본문 보관, Q36 A) */
export async function archiveLegacyChangesets(db: Queryable, root: string, authorId: string): Promise<number> {
  const dir = join(root, 'data/changesets/applied');
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith('.yaml'))
      .sort();
  } catch {
    return 0;
  }
  let n = 0;
  for (const f of files) {
    const doc = parseDocument(readFileSync(join(dir, f), 'utf8'));
    const body = doc.toJS() as { id?: string; title?: string; rationale?: string };
    const appliedAt = /applied_at:\s*(\S+)/.exec(doc.commentBefore ?? '')?.[1] ?? null;
    const id = body.id ?? f.replace(/\.yaml$/, '');
    const exists = await db.query(`SELECT 1 FROM changeset WHERE id = $1`, [id]);
    if (exists.rowCount) continue;
    await applyChangeset(db, {
      id,
      title: body.title ?? id,
      rationale: body.rationale,
      origin: 'legacy_migration',
      author_id: authorId,
      ops: [],
      body,
      meta: { legacy_changeset: true, legacy_applied_at: appliedAt, file: `data/changesets/applied/${f}` },
    });
    n++;
  }
  return n;
}

export interface RunResult {
  timings: LoadTiming[];
  timetableMs: number;
  legacyChangesets: number;
  totalMs: number;
}

export async function runLoad(
  db: Queryable,
  legacy: LegacyData,
  tr: TransformResult,
  opts: { date?: string; log?: Log } = {},
): Promise<RunResult> {
  const log = opts.log ?? (() => {});
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const t0 = performance.now();
  await assertEmpty(db);
  const author = await ensureServiceUser(db, 'system', 'legacy-migration');
  const timings = await applyStages(db, tr.stages, author, date, log);
  const t1 = performance.now();
  await writeMechanical(db, tr.timetables, tr.redirects);
  const timetableMs = performance.now() - t1;
  log(
    `  시간표 세트 ${tr.timetables.length}건·id 리다이렉트 ${tr.redirects.length}건 ${(timetableMs / 1000).toFixed(1)}s`,
  );
  const legacyChangesets = await archiveLegacyChangesets(db, legacy.root, author);
  log(`  기존 변경 묶음 ${legacyChangesets}건 보관`);
  await db.query('SELECT refresh_derived()');
  log('  물리화 뷰 갱신');
  return { timings, timetableMs, legacyChangesets, totalMs: performance.now() - t0 };
}
