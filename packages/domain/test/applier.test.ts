import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { entityContracts, type EntityType, type FuzzyDate } from '@k-raildex/contracts';
import { freshDb, type FreshDb } from '@k-raildex/db/testing';
import {
  applyChangeset,
  approveDraft,
  currentStage,
  DomainError,
  ensureServiceUser,
  findReferences,
  fixtureOps,
  readEntity,
  stationStatus,
  submitDraft,
  targetOpen,
  type Op,
} from '../src';

let fx: FreshDb;
let db: pg.Client;
let author: string;

const apply = (ops: Op[], title = '시험') =>
  applyChangeset(db, { title, origin: 'admin_edit', author_id: author, ops });

async function expectDomainError(p: Promise<unknown>, code: string, rule?: string) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    const d = e as DomainError;
    expect(d.code).toBe(code);
    if (rule) expect(d.details.violations?.map((v) => v.rule)).toContain(rule);
    return d;
  }
  throw new Error(`DomainError(${code}) 를 기대했으나 성공함`);
}

beforeAll(async () => {
  fx = await freshDb();
  db = fx.client;
  author = await ensureServiceUser(db, 'system', 'test');
  await applyChangeset(db, { title: '픽스처', origin: 'legacy_migration', author_id: author, ops: fixtureOps() });
});
afterAll(async () => fx.close());

describe('픽스처 적재', () => {
  it('모든 개체를 읽으면 Read 계약을 통과한다', async () => {
    const { rows } = await db.query<{ id: string; type: EntityType }>(`SELECT id, type FROM entity ORDER BY id`);
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) {
      const e = await readEntity(db, r.type, r.id);
      const parsed = entityContracts[r.type].read.safeParse(e);
      expect(parsed.success, `${r.id}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
    }
  });

  it('하위 목록 순서·퍼지 날짜·좌표·선형이 그대로 돌아온다', async () => {
    const svc = await readEntity(db, 'service', 'svc-fx-one');
    expect(svc?.stop_patterns).toEqual([
      {
        code: 'local',
        name_ko: '완행',
        name_en: null,
        type: 'local',
        note: null,
        stops: ['ls-fx-one--fx-a', 'ls-fx-one--fx-b', 'ls-fx-one--fx-c'],
      },
      {
        code: 'express',
        name_ko: '급행',
        name_en: null,
        type: 'express',
        note: null,
        stops: ['ls-fx-one--fx-a', 'ls-fx-one--fx-c'],
      },
    ]);
    const st = await readEntity(db, 'station', 'stn-fx-d');
    expect(st?.geom).toEqual({ lat: 37.42, lng: 127.15 });
    const plan = await readEntity(db, 'plan', 'plan-fx-replace');
    expect(plan?.geometries).toMatchObject([
      {
        kind: 'traced',
        geom: {
          type: 'MultiLineString',
          coordinates: [
            [
              [127, 37.5],
              [127.2, 37.3],
            ],
          ],
        },
      },
    ]);
    expect((plan?.milestones as { expected: FuzzyDate }[])[0]?.expected).toEqual({ value: '2032', precision: 'year' });
  });
});

describe('수정', () => {
  it('바뀐 필드만 기록하고 version·data_version 이 오른다', async () => {
    const before = await readEntity(db, 'station', 'stn-fx-b');
    const r = await apply([
      {
        op: 'update',
        entity_type: 'station',
        id: 'stn-fx-b',
        data: { name_en: 'Na' },
        expected_version: before!.version as number,
      },
    ]);
    expect(r.data_version).toBeGreaterThan(0);
    expect(r.results[0]?.after?.version).toBe((before!.version as number) + 1);
    const op = await db.query(
      `SELECT before->>'name_en' AS b, after->>'name_en' AS a FROM change_op WHERE changeset_id = $1`,
      [r.changeset_id],
    );
    expect(op.rows[0]).toEqual({ b: null, a: 'Na' });
  });

  it('바뀐 것이 없으면 changed=false, data_version 없음', async () => {
    const r = await apply([{ op: 'update', entity_type: 'station', id: 'stn-fx-b', data: { name_en: 'Na' } }]);
    expect(r.results[0]?.changed).toBe(false);
    expect(r.data_version).toBeNull();
  });

  it('버전 충돌', async () => {
    await expectDomainError(
      apply([{ op: 'update', entity_type: 'station', id: 'stn-fx-b', data: { name_en: 'X' }, expected_version: 1 }]),
      'version_conflict',
    );
  });

  it('합친 행으로 교차 필드 검사(좌표만 지우면 좌표 출처와 어긋남)', async () => {
    await expectDomainError(
      apply([{ op: 'update', entity_type: 'station', id: 'stn-fx-b', data: { geom: null } }]),
      'validation',
      'schema',
    );
  });

  it('하위 목록 교체(정차 패턴)는 Hard 규칙으로 검사 — 운행 계통 노선 밖 역이면 롤백(V-H05)', async () => {
    await expectDomainError(
      apply([
        {
          op: 'update',
          entity_type: 'service',
          id: 'svc-fx-one',
          data: {
            stop_patterns: [
              { code: 'local', name_ko: '완행', type: 'local', stops: ['ls-fx-one--fx-a', 'ls-fx-two--fx-e'] },
            ],
          },
        },
      ]),
      'validation',
      'V-H05',
    );
    const svc = await readEntity(db, 'service', 'svc-fx-one');
    expect((svc?.stop_patterns as unknown[]).length).toBe(2); // 그대로
  });

  it('노선 단위 계획은 반영 내역이 필요(V-H04)', async () => {
    await expectDomainError(
      apply([{ op: 'update', entity_type: 'plan', id: 'plan-fx-withdrawn', data: { refs: [] } }]),
      'validation',
      'V-H04',
    );
  });

  it('dryRun 은 반영하지 않는다', async () => {
    await applyChangeset(
      db,
      {
        title: 'dry',
        origin: 'admin_edit',
        author_id: author,
        ops: [{ op: 'update', entity_type: 'station', id: 'stn-fx-b', data: { name_en: 'Dry' } }],
      },
      { dryRun: true },
    );
    expect((await readEntity(db, 'station', 'stn-fx-b'))?.name_en).toBe('Na');
  });
});

describe('삭제·복구·영구 삭제', () => {
  it('참조가 있으면 삭제 거부(V-H12) — 참조 목록 반환', async () => {
    const e = await expectDomainError(apply([{ op: 'delete', entity_type: 'line', id: 'line-fx-one' }]), 'referenced');
    const tables = e.details.references?.map((r) => r.table) ?? [];
    expect(tables).toEqual(expect.arrayContaining(['service_line', 'plan_line', 'stop_pattern_stop']));
    expect(tables).not.toContain('line_station'); // 자기 노선역은 함께 휴지통으로 가므로 참조가 아니다
  });

  it('휴지통 → 복구 → 다시 삭제 → 영구 삭제, id 는 영구 예약', async () => {
    await apply([{ op: 'delete', entity_type: 'station', id: 'stn-fx-closed', reason: '시험' }]);
    expect(await readEntity(db, 'station', 'stn-fx-closed')).toBeNull();
    await expectDomainError(
      apply([
        {
          op: 'create',
          entity_type: 'station',
          data: {
            id: 'stn-fx-closed',
            name_ko: '새',
            checked_at: '2026-11-20',
            sources: [{ source_id: 'src-fixture-notice' }],
          },
        },
      ]),
      'id_taken',
    );
    await apply([{ op: 'restore', entity_type: 'station', id: 'stn-fx-closed' }]);
    expect((await readEntity(db, 'station', 'stn-fx-closed'))?.deleted_at).toBeNull();
    await apply([{ op: 'delete', entity_type: 'station', id: 'stn-fx-closed' }]);
    await apply([{ op: 'purge', entity_type: 'station', id: 'stn-fx-closed' }]);
    expect(await readEntity(db, 'station', 'stn-fx-closed', { includeDeleted: true })).toBeNull();
    const tomb = await db.query(`SELECT deleted_at IS NOT NULL AS d FROM entity WHERE id = 'stn-fx-closed'`);
    expect(tomb.rows[0].d).toBe(true);
  });

  it('노선을 지우면 노선역도 휴지통으로, 복구하면 함께 돌아온다(시험용 노선)', async () => {
    await apply([
      {
        op: 'create',
        entity_type: 'line',
        data: {
          id: 'line-fx-tmp',
          name_ko: '임시선',
          category: 'metro',
          rail_class: 'urban',
          status: 'planned',
          checked_at: '2026-11-20',
          sources: [{ source_id: 'src-fixture-notice' }],
        },
      },
      {
        op: 'create',
        entity_type: 'line_station',
        data: { id: 'ls-fx-tmp--fx-e', line_id: 'line-fx-tmp', station_id: 'stn-fx-e', seq: 1, status: 'planned' },
      },
    ]);
    await apply([{ op: 'delete', entity_type: 'line', id: 'line-fx-tmp' }]);
    expect(await readEntity(db, 'line_station', 'ls-fx-tmp--fx-e')).toBeNull();
    await apply([{ op: 'restore', entity_type: 'line', id: 'line-fx-tmp' }]);
    expect(await readEntity(db, 'line_station', 'ls-fx-tmp--fx-e')).not.toBeNull();
  });
});

describe('ID 변경·역 병합', () => {
  it('ID 변경은 참조 전체로 전파되고 리다이렉트가 남는다', async () => {
    await apply([{ op: 'rename_id', entity_type: 'station', id: 'stn-fx-e', new_id: 'stn-fx-e2', reason: '시험' }]);
    const ls = await readEntity(db, 'line_station', 'ls-fx-two--fx-e');
    expect(ls?.station_id).toBe('stn-fx-e2');
    const rd = await db.query(`SELECT new_id FROM id_redirect WHERE old_id = 'stn-fx-e'`);
    expect(rd.rows[0].new_id).toBe('stn-fx-e2');
    const src = await findReferences(db, 'source', 'src-fixture-notice');
    expect(src.some((r) => r.owner_id === 'stn-fx-e2')).toBe(true);
  });

  it('노선역 운영기관(v_line_station_operator): 노선역 값 > 노선 운영기관 하나, 통합 기관은 승계, 둘 이상이면 미정', async () => {
    const SRCS = [{ source_id: 'src-fixture-notice' }];
    const op = (id: string, data: Record<string, unknown> = {}) => ({
      op: 'create' as const,
      entity_type: 'operator' as const,
      data: {
        id,
        name_ko: id,
        kind: 'national_corp',
        status: 'active',
        checked_at: '2026-11-27',
        sources: SRCS,
        ...data,
      },
    });
    await apply([
      op('op-korail'),
      op('op-kc-old', {
        status: 'merged',
        merged_into_id: 'op-korail',
        ended: { value: '2026-09-01', precision: 'day' },
      }),
      op('op-kc-other', { kind: 'private' }),
    ]);
    const line = (id: string, operators: string[]) => ({
      op: 'create' as const,
      entity_type: 'line' as const,
      data: {
        id,
        name_ko: id,
        category: 'conventional',
        rail_class: 'conventional',
        status: 'operating',
        operators: operators.map((operator_id) => ({ operator_id })),
        checked_at: '2026-11-27',
        sources: SRCS,
      },
    });
    const ls = (id: string, line_id: string, station_id: string, seq: number, data: Record<string, unknown> = {}) => ({
      op: 'create' as const,
      entity_type: 'line_station' as const,
      data: { id, line_id, station_id, seq, status: 'operating', ...data },
    });
    await apply([
      line('line-kc-k', ['op-korail']),
      line('line-kc-merged', ['op-kc-old', 'op-korail']),
      line('line-kc-split', ['op-korail', 'op-kc-other']),
      ls('ls-kc-k--fx-a', 'line-kc-k', 'stn-fx-a', 1),
      ls('ls-kc-k--fx-b', 'line-kc-k', 'stn-fx-b', 2),
      ls('ls-kc-merged--fx-a', 'line-kc-merged', 'stn-fx-a', 1),
      ls('ls-kc-split--fx-a', 'line-kc-split', 'stn-fx-a', 1),
      ls('ls-kc-split--fx-b', 'line-kc-split', 'stn-fx-b', 2, { operator_id: 'op-kc-old' }),
    ]);
    const { rows } = await db.query<{ line_station_id: string; operator_id: string | null; basis: string }>(
      `SELECT line_station_id, operator_id, basis FROM v_line_station_operator WHERE line_station_id LIKE 'ls-kc-%' ORDER BY 1`,
    );
    expect(rows).toEqual([
      { line_station_id: 'ls-kc-k--fx-a', operator_id: 'op-korail', basis: 'line' },
      { line_station_id: 'ls-kc-k--fx-b', operator_id: 'op-korail', basis: 'line' },
      { line_station_id: 'ls-kc-merged--fx-a', operator_id: 'op-korail', basis: 'line' },
      { line_station_id: 'ls-kc-split--fx-a', operator_id: null, basis: 'ambiguous' },
      { line_station_id: 'ls-kc-split--fx-b', operator_id: 'op-korail', basis: 'line_station' },
    ]);
  });

  it('코레일 정거장 등급·관리역(V-H18): 코레일 노선역만, 관리역 노선역만 소속 노선역을 갖는다', async () => {
    const upd = (id: string, data: Record<string, unknown>) =>
      apply([{ op: 'update', entity_type: 'line_station', id, data }]);
    await upd('ls-kc-k--fx-a', { korail_class: 'management', korail_mgmt_grade: 2 });
    await upd('ls-kc-k--fx-b', { korail_class: 'unstaffed_halt', managed_by_id: 'ls-kc-k--fx-a' });
    expect(await readEntity(db, 'line_station', 'ls-kc-k--fx-b')).toMatchObject({ managed_by_id: 'ls-kc-k--fx-a' });
    // 운영기관이 코레일이 아니거나 미정인 노선역에는 못 넣는다
    await expectDomainError(upd('ls-fx-one--fx-a', { korail_class: 'ordinary' }), 'validation', 'V-H18');
    await expectDomainError(upd('ls-kc-split--fx-a', { korail_class: 'ordinary' }), 'validation', 'V-H18');
    // 통합 기관(SR 같은)을 승계한 코레일 노선역은 된다
    await upd('ls-kc-merged--fx-a', { korail_class: 'ordinary', managed_by_id: 'ls-kc-k--fx-a' });
    // 관리역이 아닌 노선역을 관리역으로
    await expectDomainError(upd('ls-kc-merged--fx-a', { managed_by_id: 'ls-kc-k--fx-b' }), 'validation', 'V-H18');
    // 소속 노선역이 있는 관리역의 등급을 내리면 거부
    await expectDomainError(
      upd('ls-kc-k--fx-a', { korail_class: 'ordinary', korail_mgmt_grade: null }),
      'validation',
      'V-H18',
    );
    // 관리역 등급(급)은 관리역에만
    await expectDomainError(upd('ls-kc-k--fx-b', { korail_mgmt_grade: 1 }), 'validation');
    // 정리
    await upd('ls-kc-merged--fx-a', { korail_class: null, managed_by_id: null });
    await upd('ls-kc-k--fx-b', { korail_class: null, managed_by_id: null });
    await upd('ls-kc-k--fx-a', { korail_class: null, korail_mgmt_grade: null });
    for (const id of ['ls-kc-k--fx-a', 'ls-kc-k--fx-b', 'ls-kc-merged--fx-a', 'ls-kc-split--fx-a', 'ls-kc-split--fx-b'])
      await apply([{ op: 'delete', entity_type: 'line_station', id }]);
  });

  it('차량기지(0034): kind depot 만 기지 정보·담당 노선, 붙은 기지선은 노선역(V-H19)', async () => {
    const SRCS = [{ source_id: 'src-fixture-notice' }];
    await apply([
      {
        op: 'create',
        entity_type: 'station',
        data: {
          id: 'stn-fx-depot',
          name_ko: '시험차량기지',
          kind: 'depot',
          geom: { lat: 37.6, lng: 127.1 },
          coord_source: 'official',
          depot: {
            functions: ['stabling', 'inspection'],
            operator_id: 'op-fx-metro',
            opened: { value: '1990', precision: 'year' },
          },
          depot_lines: [{ line_id: 'line-fx-one' }],
          checked_at: '2026-11-27',
          sources: SRCS,
        },
      },
    ]);
    expect(await readEntity(db, 'station', 'stn-fx-depot')).toMatchObject({
      depot: {
        functions: ['stabling', 'inspection'],
        operator_id: 'op-fx-metro',
        opened: { value: '1990', precision: 'year' },
      },
      depot_lines: [{ line_id: 'line-fx-one', note: null }],
    });
    // 여객역에 기지 정보를 넣으면 거부(계약 또는 V-H19)
    await expectDomainError(
      apply([
        { op: 'update', entity_type: 'station', id: 'stn-fx-a', data: { depot_lines: [{ line_id: 'line-fx-one' }] } },
      ]),
      'validation',
      'V-H19',
    );
    await expectDomainError(
      apply([{ op: 'update', entity_type: 'station', id: 'stn-fx-depot', data: { kind: 'station' } }]),
      'validation',
    );
    // 기능 코드값 밖은 거부
    await expectDomainError(
      apply([
        { op: 'update', entity_type: 'station', id: 'stn-fx-depot', data: { depot: { functions: ['parking'] } } },
      ]),
      'validation',
    );
    await apply([{ op: 'delete', entity_type: 'station', id: 'stn-fx-depot' }]);
  });

  it('공사 중 분리 정거장을 기존 역으로 병합', async () => {
    await apply([
      {
        op: 'create',
        entity_type: 'station',
        data: {
          id: 'stn-fx-d-new',
          name_ko: '라(신설)',
          merge_into_id: 'stn-fx-d',
          checked_at: '2026-11-20',
          sources: [{ source_id: 'src-fixture-notice' }],
        },
      },
      {
        op: 'create',
        entity_type: 'line_station',
        data: {
          id: 'ls-fx-two--fx-d-new',
          line_id: 'line-fx-two',
          station_id: 'stn-fx-d-new',
          seq: 3,
          status: 'under_construction',
        },
      },
    ]);
    // V-H14: 병합 예정 역의 노선역을 개통으로 바꾸면 거부
    await expectDomainError(
      apply([{ op: 'update', entity_type: 'line_station', id: 'ls-fx-two--fx-d-new', data: { status: 'operating' } }]),
      'validation',
      'V-H14',
    );
    await apply([{ op: 'merge_station', entity_type: 'station', id: 'stn-fx-d-new', into_id: 'stn-fx-d' }]);
    const ls = await readEntity(db, 'line_station', 'ls-fx-two--fx-d-new');
    expect(ls?.station_id).toBe('stn-fx-d');
    const into = await readEntity(db, 'station', 'stn-fx-d');
    expect(
      (into?.names as { name: string; kind: string }[]).some((n) => n.name === '라(신설)' && n.kind === 'former'),
    ).toBe(true);
    expect(await readEntity(db, 'station', 'stn-fx-d-new')).toBeNull();
  });
});

describe('제안(draft)', () => {
  it('형식 오류는 제출 거부', async () => {
    await expectDomainError(
      submitDraft(db, {
        title: 'x',
        origin: 'agent',
        author_id: author,
        ops: [{ op: 'create', entity_type: 'station', data: { id: 'stn-x' } }],
      }),
      'validation',
      'schema',
    );
  });

  it('승인하면 반영, 실패하면 failed 와 오류 기록', async () => {
    const ok = await submitDraft(db, {
      title: '영문명 제안',
      origin: 'agent',
      author_id: author,
      ops: [{ op: 'update', entity_type: 'station', id: 'stn-fx-c', data: { name_en: 'Da' } }],
    });
    expect((await readEntity(db, 'station', 'stn-fx-c'))?.name_en).toBeNull();
    await approveDraft(db, ok, author, '확인');
    expect((await readEntity(db, 'station', 'stn-fx-c'))?.name_en).toBe('Da');

    const bad = await submitDraft(db, {
      title: '잘못된 제안',
      origin: 'agent',
      author_id: author,
      ops: [{ op: 'update', entity_type: 'plan', id: 'plan-fx-withdrawn', data: { refs: [] } }],
    });
    await expect(approveDraft(db, bad, author)).rejects.toBeInstanceOf(DomainError);
    const cs = await db.query(`SELECT status, error FROM changeset WHERE id = $1`, [bad]);
    expect(cs.rows[0].status).toBe('failed');
    expect(cs.rows[0].error).toContain('V-H04');
  });
});

describe('계산 규칙 TS = SQL', () => {
  it('같은 날짜의 폐기는 반영 뒤(0018)', async () => {
    const src = 'src-fixture-notice';
    const events = [
      { stage: 'plan_listed', kind: 'reached', date: { value: '2018-12', precision: 'month' }, source_id: src },
      { stage: 'abandoned', kind: 'reached', date: { value: '2022-01-21', precision: 'day' }, source_id: src },
      { stage: 'plan_listed', kind: 'reached', date: { value: '2022-01-21', precision: 'day' }, source_id: src },
    ] as const;
    await apply([
      {
        op: 'create',
        entity_type: 'plan',
        data: {
          id: 'plan-fx-same-day-abandon',
          name_ko: '같은 날 폐기',
          refs: [{ program_id: 'pp-fx-national-rail-4', class: 'new', source_id: src }],
          stage_events: [...events],
          checked_at: '2026-11-21',
          sources: [{ source_id: src }],
        },
      },
    ]);
    const { rows } = await db.query(`SELECT stage FROM v_plan_stage WHERE plan_id = 'plan-fx-same-day-abandon'`);
    expect(rows[0].stage).toBe('abandoned');
    expect(currentStage(events as never)).toBe('abandoned');
    // 뒤 날짜의 reached 는 되살린다
    expect(
      currentStage([
        ...events,
        { stage: 'feasibility', kind: 'reached', date: { value: '2023', precision: 'year' } },
      ] as never),
    ).toBe('feasibility');
  });

  it('계획 현재 단계·개통 목표', async () => {
    const { rows } = await db.query<{ plan_id: string; stage: string }>(`SELECT plan_id, stage FROM v_plan_stage`);
    for (const r of rows) {
      const p = await readEntity(db, 'plan', r.plan_id);
      expect(currentStage(p!.stage_events as never, p!.stage_override as never), r.plan_id).toBe(r.stage);
      const t = await db.query(`SELECT value, precision FROM v_plan_target_open WHERE plan_id = $1`, [r.plan_id]);
      expect(targetOpen(p!.milestones as never), r.plan_id).toEqual(t.rows[0] ?? null);
    }
  });

  it('역 상태', async () => {
    const { rows } = await db.query(`SELECT * FROM v_station_status`);
    for (const r of rows) {
      const st = await readEntity(db, 'station', r.station_id);
      const ls = await db.query(
        `SELECT x.id FROM line_station x JOIN line l ON l.id = x.line_id AND l.deleted_at IS NULL WHERE x.station_id = $1 AND x.deleted_at IS NULL`,
        [r.station_id],
      );
      const lineStations = await Promise.all(ls.rows.map((x) => readEntity(db, 'line_station', x.id)));
      const ts = stationStatus(lineStations as never, {
        status: st!.own_status as never,
        opened: st!.own_opened as never,
        closed: st!.own_closed as never,
      });
      expect(ts.status, r.station_id).toBe(r.status);
      expect(ts.opened?.value ?? null, r.station_id).toBe(r.opened_value);
      expect(ts.closed?.value ?? null, r.station_id).toBe(r.closed_value);
    }
  });

  it('무작위 단계 이력 200건', () => {
    // SQL 과의 교차는 위에서, 여기서는 TS 규칙의 성질만: withdrawn 뒤 단계는 그 단계보다 낮다
    const stages = ['plan_listed', 'prefeasibility', 'feasibility', 'basic_plan', 'construction'] as const;
    for (let i = 0; i < 200; i++) {
      const s = stages[i % stages.length]!;
      const r = currentStage([
        { stage: 'construction', kind: 'reached', date: { value: '2010', precision: 'year' } },
        { stage: s, kind: 'withdrawn', date: { value: '2020', precision: 'year' } },
      ]);
      expect(r).not.toBe(s);
    }
  });
});
