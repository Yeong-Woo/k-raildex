import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { freshDb, type FreshDb } from '@k-raildex/db/testing';
import {
  applyChangeset,
  DomainError,
  ensureServiceUser,
  entityLabels,
  fixtureOps,
  listEntities,
  listTrash,
  lookup,
  type ListQuery,
} from '../src';

let fx: FreshDb;
let db: pg.Client;
let author: string;

beforeAll(async () => {
  fx = await freshDb();
  db = fx.client;
  author = await ensureServiceUser(db, 'system', 'test');
  await applyChangeset(db, { title: '픽스처', origin: 'legacy_migration', author_id: author, ops: fixtureOps() });
  // 휴지통 시험용: 역 하나를 만들고 삭제
  await applyChangeset(db, {
    title: '삭제용',
    origin: 'admin_edit',
    author_id: author,
    ops: [
      {
        op: 'create',
        entity_type: 'station',
        data: {
          id: 'stn-fx-trash',
          name_ko: '휴지통역',
          checked_at: '2026-11-20',
          sources: [{ source_id: 'src-fixture-notice' }],
        },
      },
      { op: 'delete', entity_type: 'station', id: 'stn-fx-trash', reason: '시험' },
    ],
  });
});
afterAll(async () => fx.close());

describe('listEntities', () => {
  it('기본 목록은 삭제된 것을 빼고 id 순으로 요약을 낸다', async () => {
    const r = await listEntities(db, 'station');
    expect(r.total).toBe(6);
    expect(r.limit).toBe(50);
    expect(r.offset).toBe(0);
    expect(r.items.map((i) => i.id)).toEqual([
      'stn-fx-a',
      'stn-fx-b',
      'stn-fx-c',
      'stn-fx-closed',
      'stn-fx-d',
      'stn-fx-e',
    ]);
    const a = r.items[0]!;
    expect(a).toMatchObject({ type: 'station', name_ko: '가', status: 'operating', review_status: 'unverified' });
    expect(a.version).toBeGreaterThanOrEqual(1);
    expect(typeof a.updated_at).toBe('string');
    expect(a.deleted_at).toBeNull();
    expect(r.items.find((i) => i.id === 'stn-fx-closed')?.status).toBe('closed');
    expect(r.items.find((i) => i.id === 'stn-fx-d')?.status).toBe('under_construction');
  });

  it('include_deleted·deleted_only', async () => {
    expect((await listEntities(db, 'station', { include_deleted: true })).total).toBe(7);
    const del = await listEntities(db, 'station', { deleted_only: true });
    expect(del.items.map((i) => i.id)).toEqual(['stn-fx-trash']);
    expect(del.items[0]!.deleted_at).not.toBeNull();
  });

  it('q: 이름·별칭·id·역번호', async () => {
    expect((await listEntities(db, 'station', { q: '가역' })).items.map((i) => i.id)).toEqual(['stn-fx-a']);
    expect((await listEntities(db, 'station', { q: 'fx-e' })).items.map((i) => i.id)).toEqual(['stn-fx-e']);
    expect((await listEntities(db, 'station', { q: '103' })).items.map((i) => i.id)).toEqual(['stn-fx-c']);
    expect((await listEntities(db, 'line', { q: '2호선' })).items.map((i) => i.id)).toEqual(['line-fx-two']);
    // LIKE 특수 문자는 그대로 찾는다
    expect((await listEntities(db, 'station', { q: '%' })).total).toBe(0);
  });

  it('status: 역은 계산된 상태, 계획은 현재 단계', async () => {
    expect((await listEntities(db, 'station', { status: 'operating' })).total).toBe(4);
    const plans = await listEntities(db, 'plan', { status: 'construction' });
    expect(plans.items.map((i) => i.id)).toEqual(['plan-fx-ext']);
    expect(plans.items[0]!.stage).toBe('construction');
    expect((await listEntities(db, 'line', { status: 'operating' })).total).toBe(2);
  });

  it('정렬·쪽·필터', async () => {
    const r = await listEntities(db, 'station', { sort: '-name_ko', limit: 2, offset: 1 });
    expect(r.total).toBe(6);
    // 이름 내림차순: 바, 마, 라, 다, 나, 가 → offset 1 limit 2 = 마, 라
    expect(r.items.map((i) => i.name_ko)).toEqual(['마', '라']);
    const ls = await listEntities(db, 'line_station', { filters: { line_id: 'line-fx-one' }, sort: 'seq' });
    expect(ls.items.map((i) => i.id)).toEqual([
      'ls-fx-one--fx-a',
      'ls-fx-one--fx-b',
      'ls-fx-one--fx-c',
      'ls-fx-one--fx-d',
    ]);
    // 정거장 이름은 역 이름을 따른다(다를 때만 자체 이름)
    const two = await listEntities(db, 'line_station', { filters: { line_id: 'line-fx-two' }, sort: 'seq' });
    expect(two.items.map((i) => i.name_ko)).toEqual(['가(2호선)', '마']);
    expect((await listEntities(db, 'station', { region: '41' })).total).toBe(3);
    expect((await listEntities(db, 'station', { area: 'capital' })).total).toBe(5);
    expect((await listEntities(db, 'source', {})).items[0]!.name_ko).toBe('시험용 고시');
  });

  it('노선·운영기관 관계 필터', async () => {
    // line-fx-two 정거장: 가(2호선)·마
    expect((await listEntities(db, 'station', { line: 'line-fx-two' })).total).toBe(2);
    expect((await listEntities(db, 'line_station', { line: 'line-fx-one' })).total).toBe(4);
    // 운영기관: line-fx-one 만 op-fx-metro
    expect((await listEntities(db, 'line', { operator: 'op-fx-metro' })).items.map((i) => i.id)).toEqual([
      'line-fx-one',
    ]);
    expect((await listEntities(db, 'line_station', { operator: 'op-fx-metro' })).total).toBe(4);
    expect((await listEntities(db, 'station', { operator: 'op-fx-metro' })).total).toBe(4);
    await expect(listEntities(db, 'source', { line: 'line-fx-one' })).rejects.toBeInstanceOf(DomainError);
  });

  it('updated_since', async () => {
    expect((await listEntities(db, 'station', { updated_since: '2000-01-01' })).total).toBe(6);
    expect((await listEntities(db, 'station', { updated_since: '2999-01-01T00:00:00Z' })).total).toBe(0);
  });

  it('잘못된 정렬·필터·limit 은 validation 오류', async () => {
    const cases: ListQuery[] = [
      { sort: 'geom' },
      { sort: 'nope; DROP TABLE station' },
      { filters: { 'x"; --': '1' } },
      { limit: 501 },
      { updated_since: 'not-a-date' },
      { review_status: 'verified', filters: {} },
    ];
    for (const q of cases) {
      const p = listEntities(db, q.review_status ? 'line_station' : 'station', q);
      await expect(p).rejects.toBeInstanceOf(DomainError);
    }
  });
});

describe('listTrash', () => {
  it('모든 종류의 삭제된 개체', async () => {
    const r = await listTrash(db);
    expect(r.items.map((i) => i.id)).toEqual(['stn-fx-trash']);
    expect((await listTrash(db, { type: 'line' })).total).toBe(0);
  });
});

describe('lookup', () => {
  it('역: 라벨·노선·시·도', async () => {
    const r = await lookup(db, 'station', '가');
    expect(r[0]).toEqual({ id: 'stn-fx-a', label: '가', sublabel: '시험 1호선·시험 2호선 · 서울', deleted: false });
  });
  it('계획: 단계 라벨, 빈 검색어는 전체', async () => {
    const r = await lookup(db, 'plan', '', 10);
    expect(r).toHaveLength(3);
    expect(r.find((i) => i.id === 'plan-fx-ext')?.sublabel).toBe('착공·시공');
  });
  it('삭제된 개체는 나오지 않는다', async () => {
    expect(await lookup(db, 'station', '휴지통')).toEqual([]);
  });
});

describe('entityLabels', () => {
  it('여러 종류 id 의 라벨', async () => {
    const m = await entityLabels(db, ['stn-fx-a', 'line-fx-one', 'ls-fx-two--fx-a', 'stn-fx-trash', 'stn-none']);
    expect(m.get('stn-fx-a')).toEqual({ type: 'station', label: '가', deleted: false });
    expect(m.get('line-fx-one')?.label).toBe('시험 1호선');
    expect(m.get('ls-fx-two--fx-a')?.label).toBe('가(2호선)');
    expect(m.get('stn-fx-trash')?.deleted).toBe(true);
    expect(m.has('stn-none')).toBe(false);
  });
});

describe('본선 필터(v_line_branch)', () => {
  it('노선번호가 없는 기지선도 수동 본선(branch_of_id)으로 본선 필터에 나온다', async () => {
    await applyChangeset(db, {
      title: '기지선',
      origin: 'admin_edit',
      author_id: author,
      ops: [
        {
          op: 'create',
          entity_type: 'line',
          data: {
            id: 'line-fx-spur',
            name_ko: '시험 기지선',
            category: 'conventional',
            rail_class: 'conventional',
            status: 'operating',
            branch_of_id: 'line-fx-one',
            checked_at: '2026-11-28',
            sources: [{ source_id: 'src-fixture-notice' }],
          },
        },
      ],
    });
    const r = await listEntities(db, 'line', { line: 'line-fx-one' });
    expect(r.items.map((i) => i.id)).toEqual(['line-fx-spur']);
    const v = await db.query(`SELECT branch_of_line_id, basis FROM v_line_branch WHERE line_id = 'line-fx-spur'`);
    expect(v.rows).toEqual([{ branch_of_line_id: 'line-fx-one', basis: 'manual' }]);
  });
});
