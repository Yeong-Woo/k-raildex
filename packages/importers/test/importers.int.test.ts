/**
 * 통합 시험(Testcontainers PostGIS): 시간표 교체 쓰기·멱등·실패 시 이전 세트 유지, raw → TAGO·운행정보 수집기,
 * TAGO 실시간 경로(가짜 fetch: 429 재시도·호출 기록·일일 한도).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { freshDb, type FreshDb } from '@k-raildex/db/testing';
import { applyChangeset, ensureServiceUser, fixtureOps } from '@k-raildex/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  KRIC_SOURCE,
  replaceTimetableSets,
  runImporter,
  runKricTrainOps,
  runTagoTimetable,
  setConfig,
  TAGO_SOURCE,
  type KricConfig,
  type KricFile,
  type TagoRawFile,
  type TagoRawRow,
} from '../src';

const D = '2026-11-21';
const source = (id: string, title: string) => ({
  op: 'create' as const,
  entity_type: 'source' as const,
  data: {
    id,
    title,
    publisher: '국토교통부',
    type: 'dataset_api',
    license: '공공누리 제1유형',
    license_class: 'kogl_1',
    retrieved_at: D,
    checked_at: D,
  },
});

const row = (dep: string, day: string, ud: string, to?: string): TagoRawRow => ({
  subwayRouteId: 'MTRFX1',
  depTime: dep,
  arrTime: '0',
  dailyTypeCode: day,
  upDownTypeCode: ud,
  ...(to ? { endSubwayStationNm: to } : {}),
});

describe('시간표 수집기(DB)', () => {
  let fx: FreshDb;
  let tagoDir: string;
  let kricDir: string;
  const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    (await fx.client.query(sql, p)).rows as T[];

  beforeAll(async () => {
    fx = await freshDb();
    const author = await ensureServiceUser(fx.client, 'system', 'test');
    await applyChangeset(fx.client, {
      title: '픽스처',
      origin: 'legacy_migration',
      author_id: author,
      ops: [
        ...fixtureOps(),
        source(TAGO_SOURCE, '국토교통부_(TAGO)_지하철정보'),
        source(KRIC_SOURCE, '표준데이터 운행정보'),
      ],
    });
    await fx.client.query(
      `INSERT INTO external_ref (entity_id, system, code) VALUES
         ('ls-fx-one--fx-a', 'tago_subway', 'MTRFX1001'), ('ls-fx-one--fx-c', 'tago_subway', 'MTRFX1003')`,
    );
    await setConfig(fx.client, 'tago-timetable', 'route_services', [
      { route_id: 'MTRFX1', name: '시험 1호선', service_id: 'svc-fx-one' },
    ]);
    const kricCfg: KricConfig = {
      routes: [{ line_no: 'S9901', service_id: 'svc-fx-one' }],
      day_types: { 평일: ['weekday'], '토요일+공휴일': ['saturday', 'holiday'] },
      kinds: { 급행: '급행' },
      names: { S9901: { 다역: 'stn-fx-c' } },
    };
    await setConfig(fx.client, 'kric-train-ops', 'routes', kricCfg);
    await setConfig(fx.client, 'kric-train-ops', 'rafis_abbr', {});

    tagoDir = mkdtempSync(join(tmpdir(), 'tago-'));
    const raws: TagoRawFile[] = [
      {
        subwayStationId: 'MTRFX1001',
        retrieved_at: '2026-10-11',
        items: [
          row('053000', '01', 'D', '다'),
          row('053000', '01', 'D', '다'),
          row('060000', '01', 'D', '나'),
          row('003000', '01', 'D', '다'),
          row('070000', '03', 'D', '다'),
        ],
      },
      { subwayStationId: 'MTRFX1003', retrieved_at: '2026-10-11', items: [row('054000', '01', 'U', '가')] },
    ];
    for (const r of raws) writeFileSync(join(tagoDir, `${r.subwayStationId}.json.gz`), gzipSync(JSON.stringify(r)));

    kricDir = mkdtempSync(join(tmpdir(), 'kric-'));
    const t = (no: string, day: string, kind: string, stops: [string, string, string][]) => ({
      no,
      day,
      kind,
      from: stops[0]![0],
      to: stops[stops.length - 1]![0],
      stops,
    });
    const kric: KricFile = {
      line_no: 'S9901',
      data_as_of: '2026-06-25',
      trains: [
        t('1001', '평일', '일반', [
          ['가', '00:00:00', '05:30:00'],
          ['나', '05:32:00', '05:33:00'],
          ['다역', '05:35:00', '00:00:00'],
        ]),
        t('1002', '토요일+공휴일', '급행', [
          ['가', '00:00:00', '06:00:00'],
          ['모르는역', '06:01:00', '06:01:00'],
          ['다역', '06:05:00', '00:00:00'],
        ]),
      ],
    };
    writeFileSync(join(kricDir, 'all-S9901.json.gz'), gzipSync(JSON.stringify(kric)));
  });
  afterAll(async () => {
    await fx?.close();
    for (const d of [tagoDir, kricDir]) if (d) rmSync(d, { recursive: true, force: true });
  });

  it('픽스처 운행 계통은 수도권', async () => {
    const r = await q<{ areas: string[] }>(`SELECT areas FROM v_service_area WHERE service_id = 'svc-fx-one'`);
    expect(r[0]!.areas).toContain('capital');
  });

  it('tago-timetable(raw): 세트 교체·실행 기록·멱등', async () => {
    const r1 = await runTagoTimetable(fx.client, { fromRaw: tagoDir });
    expect(r1.stats).toMatchObject({ files: 2, sets: 3, entries: 5 });
    const sets = await q<{ id: string; import_run_id: string; line_station_id: string; direction_label: string }>(
      `SELECT id, import_run_id, line_station_id, direction_label FROM timetable_set ORDER BY id`,
    );
    expect(sets.map((s) => s.id)).toEqual([
      'tt-fx-a-mtrfx1-holiday-down',
      'tt-fx-a-mtrfx1-weekday-down',
      'tt-fx-c-mtrfx1-weekday-up',
    ]);
    expect(sets.every((s) => Number(s.import_run_id) === r1.runId)).toBe(true);
    expect(sets[1]).toMatchObject({ line_station_id: 'ls-fx-one--fx-a', direction_label: '다·나 방면' });
    const entries = await q<{ ord: number; minute: number }>(
      `SELECT ord, minute FROM timetable_entry WHERE set_id = 'tt-fx-a-mtrfx1-weekday-down' ORDER BY ord`,
    );
    expect(entries).toEqual([
      { ord: 1, minute: 330 },
      { ord: 2, minute: 360 },
      { ord: 3, minute: 1470 },
    ]);
    const run = await q<{ status: string; task: string }>(`SELECT status, task FROM ingest.run WHERE id = $1`, [
      r1.runId,
    ]);
    expect(run[0]).toEqual({ status: 'done', task: 'tago-timetable' });

    const r2 = await runImporter(fx.client, 'tago-timetable', { fromRaw: tagoDir });
    expect(r2.stats).toMatchObject({ sets: 3, entries: 5, snapshot: { new: 0, changed: 0, same: 2 } });
    expect(r2.stats.write).toEqual({ deleted_sets: 3, inserted_sets: 3, inserted_entries: 5 });
    expect((await q(`SELECT 1 FROM timetable_set`)).length).toBe(3);
  });

  it('dry-run 은 DB 에 쓰지 않는다', async () => {
    const before = await q<{ n: number }>(`SELECT count(*)::int AS n FROM ingest.run`);
    const r = await runTagoTimetable(fx.client, { fromRaw: tagoDir, dryRun: true });
    expect(r.runId).toBeNull();
    expect(r.stats).toMatchObject({ sets: 3, write: { deleted_sets: 0, inserted_sets: 0 } });
    expect(await q(`SELECT count(*)::int AS n FROM ingest.run`)).toEqual(before);
  });

  it('kric-train-ops: TAGO 에 없는 조합만, 열차번호·운행유형, 미해석 역명 통계', async () => {
    const r = await runKricTrainOps(fx.client, { fromRaw: kricDir });
    // 1001(평일, 가 → 다): 다 = TAGO 하행 종착 → down. (가, weekday, down) 은 TAGO 에 있어 생략, 나·다 만
    // 1002(토요일+공휴일): 가·다 × saturday·holiday (TAGO holiday down 은 가 에 있음 → 가 holiday 생략)
    const sets = await q<{ id: string; day_note: string | null; source_id: string }>(
      `SELECT id, day_note, source_id FROM timetable_set WHERE source_id = $1 ORDER BY id`,
      [KRIC_SOURCE],
    );
    expect(sets.map((s) => s.id)).toEqual([
      'tt-fx-a-s9901-saturday-down',
      'tt-fx-b-s9901-weekday-down',
      'tt-fx-c-s9901-holiday-down',
      'tt-fx-c-s9901-saturday-down',
      'tt-fx-c-s9901-weekday-down',
    ]);
    expect(r.stats).toMatchObject({ sets: 5, unresolved_names: 1, unresolved_stop_rows: 1 });
    const e = await q(
      `SELECT minute, dest_name, dest_station_id, train_no, note FROM timetable_entry WHERE set_id = 'tt-fx-c-s9901-saturday-down'`,
    );
    expect(e).toEqual([{ minute: 365, dest_name: '다', dest_station_id: 'stn-fx-c', train_no: '1002', note: '급행' }]);
    expect(sets[0]!.day_note).toContain('토요일·공휴일 공통 다이아');
    // 다시 실행해도 같은 결과(범위 = 출처 + 노선번호)
    const r2 = await runKricTrainOps(fx.client, { fromRaw: kricDir });
    expect(r2.stats.write).toEqual({ deleted_sets: 5, inserted_sets: 5, inserted_entries: r.stats.entries });
    // TAGO 세트는 그대로
    expect((await q(`SELECT 1 FROM timetable_set WHERE source_id = $1`, [TAGO_SOURCE])).length).toBe(3);
  });

  it('쓰기 실패 시 롤백(이전 세트 유지)·실행 기록 failed', async () => {
    const before = await q<{ n: number }>(`SELECT count(*)::int AS n FROM timetable_entry`);
    await expect(
      replaceTimetableSets(
        fx.client,
        { source_id: TAGO_SOURCE, keys: [{}] },
        [
          {
            id: 'tt-nope-mtrfx1-weekday-up',
            station_id: 'stn-nope',
            line_station_id: null,
            service_id: null,
            route_code: 'MTRFX1',
            day_type: 'weekday',
            direction: 'up',
            direction_label: null,
            day_note: null,
            data_as_of: null,
            source_id: TAGO_SOURCE,
            import_run_id: null,
            entries: [],
          },
        ],
        null,
      ),
    ).rejects.toThrow();
    expect(await q(`SELECT count(*)::int AS n FROM timetable_entry`)).toEqual(before);
    await expect(runKricTrainOps(fx.client, { fromRaw: join(kricDir, 'missing') })).rejects.toThrow(/디렉터리 없음/);
    const failed = await q<{ status: string }>(
      `SELECT status FROM ingest.run WHERE task = 'kric-train-ops' ORDER BY id DESC LIMIT 1`,
    );
    expect(failed[0]!.status).toBe('failed');
  });

  it('tago-timetable(실시간, 가짜 fetch): 429 재시도·호출 기록(키 제외)·일일 한도', async () => {
    const urls: URL[] = [];
    let first = true;
    const fetchMock = async (input: string | URL) => {
      const u = new URL(String(input));
      urls.push(u);
      if (first) {
        first = false;
        return new Response('too many', { status: 429 });
      }
      const id = u.searchParams.get('subwayStationId');
      const day = u.searchParams.get('dailyTypeCode');
      const ud = u.searchParams.get('upDownTypeCode');
      const items =
        id === 'MTRFX1001' && day === '01' && ud === 'U'
          ? [row('080000', '01', 'U', '가'), row('081000', '01', 'U', '가')]
          : [];
      return new Response(
        JSON.stringify({
          response: {
            header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
            body: { totalCount: items.length, items: items.length ? { item: items } : '' },
          },
        }),
        { status: 200 },
      );
    };
    const sleeps: number[] = [];
    const r = await runTagoTimetable(fx.client, {
      tagoIds: ['MTRFX1001'],
      gapMs: 0,
      api: {
        fetch: fetchMock,
        env: { DATA_GO_KR_KEY: 'test-key' },
        sleep: async (ms) => void sleeps.push(ms),
      },
    });
    expect(sleeps[0]).toBe(4000); // 429 → 4초 대기 후 재시도
    expect(urls.every((u) => u.pathname.endsWith('/GetSubwaySttnAcctoSchdulList'))).toBe(true);
    expect(urls[0]!.searchParams.get('serviceKey')).toBe('test-key');
    expect(r.stats).toMatchObject({ files: 1, api_calls: 7, stopped_by: null });
    const calls = await q<{ params: Record<string, string>; status: number }>(
      `SELECT params, status FROM ingest.api_call WHERE endpoint_id = 'tago-subway-timetable' ORDER BY id`,
    );
    expect(calls).toHaveLength(7);
    expect(calls[0]!.status).toBe(429);
    expect(JSON.stringify(calls)).not.toContain('test-key');
    // 응답에 없는 요일·방향의 그 역 세트는 지워지고(역 단위 교체) 새 세트 하나
    const sets = await q<{ id: string }>(
      `SELECT id FROM timetable_set WHERE source_id = $1 AND station_id = 'stn-fx-a' ORDER BY id`,
      [TAGO_SOURCE],
    );
    expect(sets.map((s) => s.id)).toEqual(['tt-fx-a-mtrfx1-weekday-up']);
    expect(
      (await q(`SELECT 1 FROM timetable_set WHERE station_id = 'stn-fx-c' AND source_id = $1`, [TAGO_SOURCE])).length,
    ).toBe(1);

    // 일일 한도: 오늘 7회 + 상한 9 → 2회만 더 하고 멈춘다(받은 역 없음 → 쓰기 없음)
    const r2 = await runTagoTimetable(fx.client, {
      tagoIds: ['MTRFX1003'],
      maxCalls: 9,
      gapMs: 0,
      api: { fetch: fetchMock, env: { DATA_GO_KR_KEY: 'test-key' }, sleep: async () => {} },
    });
    expect(String(r2.stats.stopped_by)).toMatch(/LimitReached/);
    expect(r2.stats).toMatchObject({ api_calls: 2, files: 0 });
    expect(
      (await q(`SELECT 1 FROM timetable_set WHERE station_id = 'stn-fx-c' AND source_id = $1`, [TAGO_SOURCE])).length,
    ).toBe(1);
  });

  it('키가 없으면 실시간 경로는 실패로 기록', async () => {
    await expect(runTagoTimetable(fx.client, { api: { env: {} } })).rejects.toThrow(/API 키 없음/);
  });
});
