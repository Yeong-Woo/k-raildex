/** 정거장(0042): v_line_stop 순서·v_line_stop_link 앞뒤·거리·지선 분기, V-H19 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { freshDb, type FreshDb } from '@k-raildex/db/testing';
import { applyChangeset, DomainError, ensureServiceUser, fixtureOps, lineStops, stopNeighbors } from '../src';

let fx: FreshDb;
let db: pg.Client;
let author: string;
const src = [{ source_id: 'src-fixture-notice' }];
const D = '2026-11-28';
const fac = (id: string, name: string, kind: string, lines: unknown[]) => ({
  op: 'create' as const,
  entity_type: 'facility' as const,
  data: { id, name_ko: name, kind, status: 'operating', checked_at: D, sources: src, lines },
});

beforeAll(async () => {
  fx = await freshDb();
  db = fx.client;
  author = await ensureServiceUser(db, 'system', 'test');
  await applyChangeset(db, { title: '픽스처', origin: 'legacy_migration', author_id: author, ops: fixtureOps() });
  const km = (id: string, v: number) => ({
    op: 'update' as const,
    entity_type: 'line_station' as const,
    id,
    data: { km: v },
  });
  await applyChangeset(db, {
    title: '정거장 시험',
    origin: 'admin_edit',
    author_id: author,
    ops: [
      km('ls-fx-one--fx-a', 0),
      km('ls-fx-one--fx-b', 2),
      km('ls-fx-one--fx-c', 5),
      // 시험 1호선 지선 X: 나(b)에서 갈라져 마(e)
      {
        op: 'create',
        entity_type: 'line_station',
        data: {
          id: 'ls-fx-one--fx-e-x',
          line_id: 'line-fx-one',
          station_id: 'stn-fx-e',
          seq: 5,
          branch: 'X',
          branch_from_id: 'ls-fx-one--fx-b',
          km: 3,
          status: 'operating',
        },
      },
      // 나~다 사이 신호장(km 3.5), 시험 2호선 첫머리 신호소(km 미확인)
      fac('fac-fx-sig', '시험신호장', 'signal_station', [
        { line_id: 'line-fx-one', role: 'located', after_line_station_id: 'ls-fx-one--fx-b', km: 3.5 },
      ]),
      fac('fac-fx-post', '시험신호소', 'signal_post', [{ line_id: 'line-fx-two', role: 'located' }]),
    ],
  });
});
afterAll(async () => {
  await fx?.close();
});

describe('정거장 순서·앞뒤(v_line_stop·v_line_stop_link)', () => {
  it('노선역과 노선 위 시설을 노선 순서로 엮는다(지선은 따로 순번)', async () => {
    const r = await lineStops(db, 'line-fx-one');
    expect(r.map((s) => [s.branch, s.pos, s.node_id, s.stop_kind])).toEqual([
      [null, 1, 'stn-fx-a', 'station'],
      [null, 2, 'stn-fx-b', 'station'],
      [null, 3, 'fac-fx-sig', 'signal_station'],
      [null, 4, 'stn-fx-c', 'station'],
      [null, 5, 'stn-fx-d', 'station'],
      ['X', 1, 'stn-fx-e', 'station'],
    ]);
    const b = r.find((s) => s.node_id === 'stn-fx-b')!;
    expect(b.prev.map((p) => [p.node_id, p.distance_km])).toEqual([['stn-fx-a', 2]]);
    // 분기: 뒤 정거장이 둘(본선 신호장 1.5 km, 지선 마 1 km)
    expect(b.next.map((n) => [n.node_id, n.distance_km, n.basis]).sort()).toEqual([
      ['fac-fx-sig', 1.5, 'sequence'],
      ['stn-fx-e', 1, 'branch'],
    ]);
    // km 없는 정거장(라)과의 거리는 미확인(null)
    const c = r.find((s) => s.node_id === 'stn-fx-c')!;
    expect(c.next).toEqual([expect.objectContaining({ node_id: 'stn-fx-d', distance_km: null })]);
  });

  it('정거장별 앞뒤는 모든 노선에서 모은다(여러 노선·분기면 여러 개)', async () => {
    const n = await stopNeighbors(db, 'station', 'stn-fx-a');
    expect(n.map((x) => [x.line_id, x.direction, x.neighbor_id])).toEqual(
      expect.arrayContaining([
        ['line-fx-one', 'next', 'stn-fx-b'],
        ['line-fx-two', 'prev', 'fac-fx-post'],
        ['line-fx-two', 'next', 'stn-fx-e'],
      ]),
    );
    expect(n).toHaveLength(3);
    const sig = await stopNeighbors(db, 'facility', 'fac-fx-sig');
    expect(sig.map((x) => [x.direction, x.neighbor_id, x.distance_km])).toEqual([
      ['prev', 'stn-fx-b', 1.5],
      ['next', 'stn-fx-c', 1.5],
    ]);
    await expect(stopNeighbors(db, 'line', 'line-fx-one')).rejects.toBeInstanceOf(DomainError);
  });

  it('V-H19: 앞 노선역은 같은 노선, 노선 위 정거장은 신호장·신호소·조차장만', async () => {
    await expect(
      applyChangeset(db, {
        title: '다른 노선 노선역',
        origin: 'admin_edit',
        author_id: author,
        ops: [
          fac('fac-fx-bad', '틀린신호장', 'signal_station', [
            { line_id: 'line-fx-two', role: 'located', after_line_station_id: 'ls-fx-one--fx-b' },
          ]),
        ],
      }),
    ).rejects.toMatchObject({ details: { violations: [expect.objectContaining({ rule: 'V-H19' })] } });
    await expect(
      applyChangeset(db, {
        title: '차량기지 위치',
        origin: 'admin_edit',
        author_id: author,
        ops: [fac('fac-fx-bad2', '틀린기지', 'depot', [{ line_id: 'line-fx-one', role: 'located' }])],
      }),
    ).rejects.toMatchObject({ details: { violations: [expect.objectContaining({ rule: 'V-H19' })] } });
  });
});
