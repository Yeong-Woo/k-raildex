/** 정거장(0044·0045): 정거장 순서 표(v_line_stop)·앞뒤·역간 거리·지선 분기, 신호장 정거장(운전 취급 역 그룹), V-H18·V-H19 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { freshDb, type FreshDb } from '@k-raildex/db/testing';
import { applyChangeset, DomainError, ensureServiceUser, fixtureOps, lineStopTable, stopNeighbors } from '../src';

let fx: FreshDb;
let db: pg.Client;
let author: string;
const src = [{ source_id: 'src-fixture-notice' }];
const D = '2026-11-28';

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
      km('ls-fx-one--fx-d', 8),
      // 운전 취급 역 그룹 + 신호장 정거장(라 뒤, km 9.5) — 코레일 노선이 아니어도 세 등급은 쓸 수 있다
      {
        op: 'create',
        entity_type: 'station',
        data: { id: 'stn-fx-sig', name_ko: '시험신호장', kind: 'operational', checked_at: D, sources: src },
      },
      {
        op: 'create',
        entity_type: 'line_station',
        data: {
          id: 'ls-fx-one--fx-sig',
          line_id: 'line-fx-one',
          station_id: 'stn-fx-sig',
          seq: 6,
          km: 9.5,
          korail_class: 'signal_station',
          status: 'operating',
        },
      },
      // 지선 X: 나(b)에서 갈라져 마(e)
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
    ],
  });
});
afterAll(async () => {
  await fx?.close();
});

describe('정거장 순서 표(v_line_stop·v_line_stop_link)', () => {
  it('본선·지선별 순번, 구분(신호장 = 코레일 정거장 등급), 역간 거리, 접속 노선', async () => {
    const r = await lineStopTable(db, 'line-fx-one');
    expect(r.map((s) => [s.branch, s.pos, s.station_id, s.stop_class])).toEqual([
      [null, 1, 'stn-fx-a', 'station'],
      [null, 2, 'stn-fx-b', 'station'],
      [null, 3, 'stn-fx-c', 'station'],
      [null, 4, 'stn-fx-d', 'station'],
      [null, 5, 'stn-fx-sig', 'signal_station'],
      ['X', 1, 'stn-fx-e', 'station'],
    ]);
    const b = r.find((s) => s.station_id === 'stn-fx-b')!;
    expect(b.prev.map((p) => [p.station_id, p.distance_km])).toEqual([['stn-fx-a', 2]]);
    // 분기: 뒤 정거장이 둘(본선 다 3 km, 지선 마 1 km)
    expect(b.next.map((n) => [n.station_id, n.distance_km, n.basis]).sort()).toEqual([
      ['stn-fx-c', 3, 'sequence'],
      ['stn-fx-e', 1, 'branch'],
    ]);
    const sig = r.find((s) => s.station_id === 'stn-fx-sig')!;
    expect(sig.prev).toEqual([expect.objectContaining({ station_id: 'stn-fx-d', distance_km: 1.5 })]);
    const a = r.find((s) => s.station_id === 'stn-fx-a')!;
    expect(a.connections.map((c) => c.line_id)).toEqual(['line-fx-two']);
    expect(a.station_code).toBe('101');
  });

  it('역 그룹별 앞뒤는 모든 노선에서 모은다', async () => {
    const n = await stopNeighbors(db, 'stn-fx-a');
    expect(n.map((x) => [x.line_id, x.direction, x.neighbor_station_id]).sort()).toEqual([
      ['line-fx-one', 'next', 'stn-fx-b'],
      ['line-fx-two', 'next', 'stn-fx-e'],
    ]);
    await expect(stopNeighbors(db, 'stn-nope')).rejects.toBeInstanceOf(DomainError);
  });

  it('V-H18: 관리역 등 다른 등급은 여전히 코레일 노선만 / V-H19: 갈라지는 정거장은 같은 노선', async () => {
    await expect(
      applyChangeset(db, {
        title: '관리역 등급',
        origin: 'admin_edit',
        author_id: author,
        ops: [{ op: 'update', entity_type: 'line_station', id: 'ls-fx-one--fx-c', data: { korail_class: 'ordinary' } }],
      }),
    ).rejects.toMatchObject({ details: { violations: [expect.objectContaining({ rule: 'V-H18' })] } });
    await expect(
      applyChangeset(db, {
        title: '다른 노선 분기',
        origin: 'admin_edit',
        author_id: author,
        ops: [
          {
            op: 'update',
            entity_type: 'line_station',
            id: 'ls-fx-one--fx-e-x',
            data: { branch_from_id: 'ls-fx-two--fx-a' },
          },
        ],
      }),
    ).rejects.toMatchObject({ details: { violations: [expect.objectContaining({ rule: 'V-H19' })] } });
  });
});
