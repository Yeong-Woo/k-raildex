/** 공개 읽기 API(WP 6.4~6.6, docs/04-api.md 5절): 응답 계약(zod strict)·공개 범위·캐시(ETag/304)·리다이렉트·원문 다운로드 */
import {
  publicFeedSchema,
  publicHomeSchema,
  publicLineDetailSchema,
  publicLineListSchema,
  publicMapLinesSchema,
  publicMapPlansSchema,
  publicMapServiceSchema,
  publicMapStationsSchema,
  publicMapTimelineSchema,
  publicPlanDetailSchema,
  publicPlanListSchema,
  publicPlanProgramDetailSchema,
  publicPlanProgramListSchema,
  publicSearchSchema,
  publicServiceDetailSchema,
  publicServiceListSchema,
  publicSitemapSchema,
  publicSourceListSchema,
  publicStationDetailSchema,
  publicFacilityDetailSchema,
  publicStationListSchema,
  publicTimelineSchema,
  publicTimetableSchema,
  publicUpcomingSchema,
  publicAreasSchema,
  publicClosedSchema,
  publicTrainsSchema,
  publicTrainClassListSchema,
  publicTermListSchema,
  publicRouteMapListSchema,
  publicTransferCenterListSchema,
  publicRedirectListSchema,
  publicNumberSearchSchema,
} from '@k-raildex/contracts';
import { applyChangeset, ensureServiceUser, updateDocument, uploadDocument } from '@k-raildex/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { startApp, type TestApp } from './helpers';

let t: TestApp;
let author: string;
const get = (url: string, headers: Record<string, string> = {}) => t.app.inject({ method: 'GET', url, headers });

async function ok<S extends z.ZodType>(url: string, schema: S): Promise<z.infer<S>> {
  const r = await get(url);
  expect(r.statusCode, `${url}: ${r.body.slice(0, 300)}`).toBe(200);
  const parsed = schema.safeParse(r.json());
  if (!parsed.success) throw new Error(`${url}: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`);
  return parsed.data;
}

const apply = (ops: Parameters<typeof applyChangeset>[1]['ops']) =>
  applyChangeset(t.fx.client, { title: '시험', origin: 'admin_edit', author_id: author, ops });

let publicDocId = '';
let privateDocId = '';

beforeAll(async () => {
  t = await startApp();
  const c = t.fx.client;
  author = await ensureServiceUser(c, 'system', 'test');
  // 내부 메모·내부 별칭·공개 첨부·비공개 첨부·원문 2개(공개 가능 / 권리 제한)
  const pub = await uploadDocument(c, t.store, {
    buffer: Buffer.from('%PDF-1.4 public notice'),
    filename: '시험 고시.pdf',
    mime: 'application/pdf',
    kind: 'original',
    license_class: 'public_work',
    source_id: 'src-fixture-notice',
    author_id: author,
  });
  publicDocId = pub.document.id;
  await updateDocument(c, publicDocId, { publishable: true });
  const priv = await uploadDocument(c, t.store, {
    buffer: Buffer.from('%PDF-1.4 restricted'),
    filename: 'restricted.pdf',
    mime: 'application/pdf',
    kind: 'upload',
    license_class: 'restricted',
    author_id: author,
  });
  privateDocId = priv.document.id;
  await apply([
    {
      op: 'update',
      entity_type: 'line',
      id: 'line-fx-one',
      data: {
        editor_note: '내부 메모 — 공개 금지',
        names: [
          { name: 'S시험', kind: 'internal' },
          { name: '시험선', kind: 'alias' },
        ],
      },
    },
    { op: 'delete', entity_type: 'plan', id: 'plan-fx-withdrawn', reason: '시험' },
  ]);
  await c.query(
    `INSERT INTO entity_attachment (entity_id, kind, title, quote, is_public, ord) VALUES
       ('line-fx-one', 'quote', '공개 발췌', '시험 1호선은 …', true, 0),
       ('line-fx-one', 'quote', '비공개 발췌', '내부 …', false, 1)`,
  );
  await c.query(
    `INSERT INTO entity_attachment (entity_id, kind, title, document_id, is_public, ord) VALUES ('line-fx-one', 'document', '고시 원문', $1, true, 2)`,
    [publicDocId],
  );
  await c.query(
    `INSERT INTO id_redirect (old_id, new_id, reason) VALUES ('fx_national_rail_4', 'pp-fx-national-rail-4', '시험')`,
  );
  await c.query(
    `INSERT INTO timetable_set (id, station_id, line_station_id, service_id, route_code, day_type, direction, direction_label, day_note, source_id)
     VALUES ('tt-fx-a-weekday-down', 'stn-fx-a', 'ls-fx-one--fx-a', 'svc-fx-one', 'R1', 'weekday', 'down', '다 방면',
             '운행정보 요일구분 "평일" — 평일 다이아', 'src-fixture-notice')`,
  );
  await c.query(
    `INSERT INTO timetable_entry (set_id, minute, dest_name, train_no, ord) VALUES ('tt-fx-a-weekday-down', 330, '다', '1001', 1),
       ('tt-fx-a-weekday-down', 345, '다', '1003', 2)`,
  );
  // Q119 A: 관리용 검수 표시 줄은 공개 응답에서 빠진다
  await c.query(
    `UPDATE plan_milestone SET note = E'근거 메모\n기존 target_open 이관 — 출처는 계획 출처 중 공식 자료에서 자동 선택(검수 필요)'
      WHERE plan_id = 'plan-fx-ext'`,
  );
  await c.query(`SELECT refresh_derived()`);
});
afterAll(async () => t?.close());

describe('노선·역·운행 계통', () => {
  it('노선 목록·상세: 역 순서·구간별 상태·관련 계획·내부 필드 없음', async () => {
    const list = await ok('/v1/public/lines', publicLineListSchema);
    expect(list.items.map((l) => l.id)).toEqual(['line-fx-one', 'line-fx-two']);
    expect(list.items[0]!.station_count).toBe(4);
    const filtered = await ok('/v1/public/lines?rail_class=urban', publicLineListSchema);
    expect(filtered.total).toBe(1);

    const r = await get('/v1/public/lines/line-fx-one');
    expect(r.body).not.toContain('내부 메모');
    expect(r.body).not.toContain('S시험');
    expect(r.body).not.toContain('비공개 발췌');
    const line = publicLineDetailSchema.parse(r.json());
    expect(line.stations.map((s) => [s.station_id, s.status])).toEqual([
      ['stn-fx-a', 'operating'],
      ['stn-fx-b', 'operating'],
      ['stn-fx-c', 'operating'],
      ['stn-fx-d', 'under_construction'],
    ]);
    expect(line.stations[0]!.transfer_line_ids).toEqual(['line-fx-two']);
    expect(line.plans).toEqual([
      expect.objectContaining({
        plan_id: 'plan-fx-ext',
        role: 'extends',
        stage: 'construction',
        target_open: expect.objectContaining({ value: '2029-H2', basis: 'press', delayed: false }),
      }),
    ]);
    expect(line.names.map((n) => n.name)).toEqual(['시험선']);
    expect(line.sources[0]).toMatchObject({ source_id: 'src-fixture-notice', checked_at: '2026-11-20' });
    expect(line.sources[0]!.documents.map((d) => d.id)).toEqual([publicDocId]);
    expect(line.attachments.map((a) => a.title)).toEqual(['공개 발췌', '고시 원문']);
    expect(line.attachments[1]!.document?.download_path).toBe(`/v1/public/documents/${publicDocId}`);
    expect(line.services.map((s) => s.id)).toEqual(['svc-fx-one']);
    expect(line.events.some((e) => e.type === 'opened')).toBe(true);
  });

  it('본선·지선: 고시 노선번호 앞 세 자리가 같은 노선이 본선(v_line_branch)', async () => {
    const SRC = [{ source_id: 'src-fixture-notice' }];
    await apply([
      {
        op: 'update',
        entity_type: 'line',
        id: 'line-fx-one',
        data: { external_refs: [{ system: 'molit_line_no', code: '901', source_id: 'src-fixture-notice' }] },
      },
      {
        op: 'create',
        entity_type: 'line',
        data: {
          id: 'line-fx-depot',
          name_ko: '시험기지선',
          category: 'metro',
          rail_class: 'urban',
          line_role: 'depot_line',
          status: 'operating',
          external_refs: [{ system: 'molit_line_no', code: '90101', source_id: 'src-fixture-notice' }],
          checked_at: '2026-11-27',
          sources: SRC,
        },
      },
      {
        op: 'create',
        entity_type: 'line',
        data: {
          id: 'line-fx-orphan',
          name_ko: '본선없는삼각선',
          category: 'metro',
          rail_class: 'urban',
          line_role: 'wye',
          status: 'operating',
          external_refs: [{ system: 'molit_line_no', code: '99901', source_id: 'src-fixture-notice' }],
          checked_at: '2026-11-27',
          sources: SRC,
        },
      },
    ]);
    const list = await ok('/v1/public/lines', publicLineListSchema);
    const by = new Map(list.items.map((l) => [l.id, l]));
    expect(by.get('line-fx-one')).toMatchObject({ line_no: '901', branch_of: null });
    expect(by.get('line-fx-depot')).toMatchObject({
      line_no: '90101',
      branch_of: { id: 'line-fx-one', name_ko: '시험 1호선' },
    });
    expect(by.get('line-fx-orphan')).toMatchObject({ line_no: '99901', branch_of: null });
    const one = await ok('/v1/public/lines/line-fx-one', publicLineDetailSchema);
    expect(one.branches).toEqual([
      { id: 'line-fx-depot', name_ko: '시험기지선', status: 'operating', line_role: 'depot_line', line_no: '90101' },
    ]);
    await apply([
      { op: 'delete', entity_type: 'line', id: 'line-fx-depot' },
      { op: 'delete', entity_type: 'line', id: 'line-fx-orphan' },
      { op: 'update', entity_type: 'line', id: 'line-fx-one', data: { external_refs: [] } },
    ]);
    expect((await ok('/v1/public/lines/line-fx-one', publicLineDetailSchema)).branches).toEqual([]);
  });

  it('시설(차량기지): 상세(기능·운영기관·담당 노선·붙은 선로), 지도 depots.geojson', async () => {
    await apply([
      {
        op: 'create',
        entity_type: 'facility',
        data: {
          id: 'fac-fx-depot',
          name_ko: '시험차량기지',
          kind: 'depot',
          functions: ['stabling', 'heavy_maintenance'],
          operator_id: 'op-fx-metro',
          geom: { lat: 37.6, lng: 127.1 },
          coord_source: 'official',
          lines: [
            { line_id: 'line-fx-one', role: 'serves' },
            { line_id: 'line-fx-two', role: 'connects' },
          ],
          checked_at: '2026-11-27',
          sources: [{ source_id: 'src-fixture-notice' }],
        },
      },
    ]);
    const d = await ok('/v1/public/facilities/fac-fx-depot', publicFacilityDetailSchema);
    expect(d).toMatchObject({
      kind: 'depot',
      functions: ['stabling', 'heavy_maintenance'],
      operator: { id: 'op-fx-metro' },
      served_lines: [{ id: 'line-fx-one', name_ko: '시험 1호선', color: '#0052A4' }],
      connecting_lines: [{ id: 'line-fx-two', line_role: null }],
      coord: { lat: 37.6, lng: 127.1 },
    });
    expect(d.sources[0]).toMatchObject({ source_id: 'src-fixture-notice' });
    const fc = (await get('/v1/public/map/depots.geojson')).json() as {
      features: { properties: Record<string, unknown> }[];
    };
    expect(fc.features.map((f) => f.properties)).toEqual([
      expect.objectContaining({ facility_id: 'fac-fx-depot', kind: 'depot', color: '#0052A4', served: ['시험 1호선'] }),
    ]);
    expect((await get('/v1/public/facilities/fac-none')).statusCode).toBe(404);
    await apply([{ op: 'delete', entity_type: 'facility', id: 'fac-fx-depot' }]);
  });

  it('역 목록(탭 숫자)·상세(노선별 절·이웃 역·시간표 요약·요일 설명 분리)', async () => {
    const list = await ok('/v1/public/stations', publicStationListSchema);
    expect(list.total).toBe(6);
    expect(list.facets.status).toMatchObject({ operating: 4, under_construction: 1, closed: 1 });
    const unopened = await ok('/v1/public/stations?opened=unopened', publicStationListSchema);
    expect(unopened.items.map((s) => s.id)).toEqual(['stn-fx-d']);
    const byRegion = await ok('/v1/public/stations?region=11', publicStationListSchema);
    expect(byRegion.items.map((s) => s.id).sort()).toEqual(['stn-fx-a', 'stn-fx-b']);

    const a = await ok('/v1/public/stations/stn-fx-a', publicStationDetailSchema);
    expect(a.lines.map((l) => [l.line_id, l.name_ko, l.station_code])).toEqual([
      ['line-fx-two', '가(2호선)', null],
      ['line-fx-one', '가', '101'],
    ]);
    const one = a.lines.find((l) => l.line_id === 'line-fx-one')!;
    expect(one.next).toEqual([{ id: 'stn-fx-b', name_ko: '나' }]);
    expect(one.prev).toEqual([]);
    expect(a.timetables).toHaveLength(1);
    expect(a.timetables[0]).toMatchObject({
      count: 2,
      first_minute: 330,
      day_note: '평일 다이아',
      line_id: 'line-fx-one',
    });
    // 원문 요일구분은 공개하지 않는다(Q139 B)
    expect(a).not.toHaveProperty('timetable_source_notes');
    const d = await ok('/v1/public/stations/stn-fx-d', publicStationDetailSchema);
    expect(d.approximate).toBe(true);
    expect(d.target_open).toEqual({ value: '2029-H2', precision: 'half' });
    expect(d.plans.map((p) => [p.plan_id, p.role])).toEqual([['plan-fx-ext', 'new']]);

    const tt = await ok('/v1/public/timetable/stn-fx-a', publicTimetableSchema);
    expect(tt.sets[0]!.entries.map((e) => e.minute)).toEqual([330, 345]);
    expect(tt.sets[0]!.day_note).toBe('평일 다이아');
  });

  it('운행 계통', async () => {
    const list = await ok('/v1/public/services', publicServiceListSchema);
    expect(list.items[0]!.stop_count).toBe(3);
    const s = await ok('/v1/public/services/svc-fx-one', publicServiceDetailSchema);
    expect(s.stop_patterns.map((p) => p.stops.map((x) => x.station_id))).toEqual([
      ['stn-fx-a', 'stn-fx-b', 'stn-fx-c'],
      ['stn-fx-a', 'stn-fx-c'],
    ]);
    expect(s.stops_assumed).toBe(false);
  });
});

describe('계획·상위 계획', () => {
  it('목록·상세(단계·기대 일정·반영 내역·역할). 삭제된 계획은 목록에 없고 상세는 410', async () => {
    const list = await ok('/v1/public/plans', publicPlanListSchema);
    expect(list.items.map((p) => p.id).sort()).toEqual(['plan-fx-ext', 'plan-fx-replace']);
    const withTarget = await ok('/v1/public/plans?has_target=true&stage_min=detail_design', publicPlanListSchema);
    expect(withTarget.total).toBe(2);
    const p = await ok('/v1/public/plans/plan-fx-ext', publicPlanDetailSchema);
    expect(p.stage).toBe('construction');
    expect(p.milestones[0]).toMatchObject({ stage: 'opened', basis: 'press', expected: { value: '2029-H2' } });
    expect(p.milestones.map((m) => m.note)).toContain('근거 메모');
    expect(JSON.stringify(p.milestones)).not.toContain('검수 필요');
    expect(p.stage_events.map((e) => e.stage)).toEqual(['plan_listed', 'construction']);
    expect(p.lines).toEqual([expect.objectContaining({ line_id: 'line-fx-one', role: 'extends' })]);
    expect(p.refs[0]).toMatchObject({ program_id: 'pp-fx-national-rail-4', section: '다~라' });
    expect(p.shape).toEqual({ quality: 'schematic', odbl: false });
    expect(p.map_path).toBe('/map/?at=2029#plan=plan-fx-ext');
    expect((await get('/v1/public/plans/plan-fx-withdrawn')).statusCode).toBe(410);
    expect((await get('/v1/public/plans/plan-nope')).statusCode).toBe(404);
  });

  it('상위 계획 목록·상세, 옛 id 는 301 + Location, 리다이렉트 정보', async () => {
    const list = await ok('/v1/public/plan-programs', publicPlanProgramListSchema);
    expect(list.items[0]).toMatchObject({ id: 'pp-fx-national-rail-4', plan_count: 2 });
    const d = await ok('/v1/public/plan-programs/pp-fx-national-rail-4', publicPlanProgramDetailSchema);
    expect(d.plans).toHaveLength(2);
    const moved = await get('/v1/public/plan-programs/fx_national_rail_4');
    expect(moved.statusCode).toBe(301);
    expect(moved.headers.location).toBe('/v1/public/plan-programs/pp-fx-national-rail-4');
    expect(moved.json().redirect).toMatchObject({ new_id: 'pp-fx-national-rail-4', type: 'plan_program' });
    const info = await get('/v1/public/redirects/fx_national_rail_4');
    expect(info.json()).toMatchObject({
      old_id: 'fx_national_rail_4',
      new_id: 'pp-fx-national-rail-4',
      url_path: '/plans/programs/#pp-fx-national-rail-4',
    });
    expect((await get('/v1/public/redirects/nope')).statusCode).toBe(404);
    const all = await ok('/v1/public/redirects', publicRedirectListSchema);
    expect(all.items.map((r) => r.old_id)).toEqual(['fx_national_rail_4']);
  });
});

describe('홈·목록 보조', () => {
  it('홈·권역·개통 예정·폐선·연표·번호·용어·노선도·출처·피드·사이트맵', async () => {
    const home = await ok('/v1/public/home', publicHomeSchema);
    expect(home.stats.stations.total).toBe(6);
    expect(home.stats.plans.total).toBe(2);
    expect(home.upcoming.map((p) => p.id)).toEqual(['plan-fx-ext', 'plan-fx-replace']);
    expect(home.recent_changes[0]!.entities.map((e) => e.id)).not.toContain('plan-fx-withdrawn');
    const areas = await ok('/v1/public/areas', publicAreasSchema);
    expect(areas.items.find((a) => a.code === 'capital')).toMatchObject({ lines: 2 });
    const up = await ok('/v1/public/upcoming', publicUpcomingSchema);
    expect(up.stations.map((s) => s.id)).toEqual(['stn-fx-d']);
    const closed = await ok('/v1/public/closed', publicClosedSchema);
    expect(closed.stations.map((s) => s.id)).toEqual(['stn-fx-closed']);
    const tl = await ok('/v1/public/timeline?decade=1990', publicTimelineSchema);
    expect(tl.items.length).toBeGreaterThan(0);
    expect(tl.decades.length).toBeGreaterThan(0);
    await ok('/v1/public/timeline?area=capital', publicTimelineSchema);
    const undated = await ok('/v1/public/timeline?undated=true', publicTimelineSchema);
    expect(undated.items.every((e) => e.date === null)).toBe(true);
    const dated = await ok('/v1/public/timeline?undated=false', publicTimelineSchema);
    expect(dated.items.every((e) => e.date !== null)).toBe(true);
    await ok('/v1/public/trains', publicTrainsSchema);
    await ok('/v1/public/train-classes', publicTrainClassListSchema);
    await ok('/v1/public/numbers/search?n=K101', publicNumberSearchSchema);
    await ok('/v1/public/terms', publicTermListSchema);
    await ok('/v1/public/route-maps', publicRouteMapListSchema);
    await ok('/v1/public/transfer-centers', publicTransferCenterListSchema);
    const src = await ok('/v1/public/sources?with_documents=true', publicSourceListSchema);
    expect(src.items.map((s) => s.id)).toEqual(['src-fixture-notice']);
    expect(src.items[0]!.documents.map((d) => d.id)).toEqual([publicDocId]);
    const feed = await ok('/v1/public/feed/changes', publicFeedSchema);
    expect(feed.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(feed)).not.toContain('시험'.repeat(3));
    const sm = await ok('/v1/public/sitemap-entries', publicSitemapSchema);
    expect(sm.items.map((x) => x.path)).toContain('/stations/stn-fx-a/');
    expect(sm.items.map((x) => x.path)).not.toContain('/plans/plan-fx-withdrawn/');
  });

  it('검색: 이름·별칭·역번호·초성, 내부 표기는 일치 이름으로 보이지 않음', async () => {
    const s = await ok(`/v1/public/search?q=${encodeURIComponent('가')}`, publicSearchSchema);
    expect(s.items[0]).toMatchObject({ id: 'stn-fx-a', type: 'station', url_path: '/stations/stn-fx-a/' });
    const code = await ok('/v1/public/search?q=103', publicSearchSchema);
    expect(code.items[0]!.id).toBe('stn-fx-c');
    const internal = await ok(`/v1/public/search?q=${encodeURIComponent('S시험')}`, publicSearchSchema);
    const hit = internal.items.find((i) => i.id === 'line-fx-one');
    expect(hit?.matched).toBeNull();
    expect(JSON.stringify(internal.items)).not.toContain('S시험');
  });
});

describe('지도(6.5)', () => {
  it('현재 지도·시점별 지도·계획 선형·연도 슬라이더', async () => {
    const cur = await ok('/v1/public/map/stations.geojson', publicMapStationsSchema);
    expect(cur.at).toBe('current');
    expect(cur.features.map((f) => f.id)).not.toContain('stn-fx-closed');
    const y2030 = await ok('/v1/public/map/lines.geojson?at=2030', publicMapLinesSchema);
    expect(y2030.at).toBe(2030);
    expect(y2030.features.map((f) => f.id)).toContain('plan:plan-fx-ext');
    expect(y2030.features.find((f) => f.id === 'plan:plan-fx-ext')?.properties.passenger).toBe(true);
    const y2026 = await ok('/v1/public/map/lines.geojson?at=2026', publicMapLinesSchema);
    expect(y2026.features.map((f) => f.id)).not.toContain('plan:plan-fx-ext');
    const st2030 = await ok('/v1/public/map/stations.geojson?at=2030', publicMapStationsSchema);
    expect(st2030.features.find((f) => f.id === 'stn-fx-d')?.properties).toMatchObject({
      future: true,
      plan_ids: ['plan-fx-ext'],
    });
    const plans = await ok('/v1/public/map/plans.geojson?at=future', publicMapPlansSchema);
    expect(plans.features.map((f) => f.properties.plan_id)).toEqual(['plan-fx-ext', 'plan-fx-replace']);
    const tl = await ok('/v1/public/map/timeline', publicMapTimelineSchema);
    expect(tl.years.map((y) => [y.year, y.count])).toEqual([
      [2029, 1],
      [2032, 1],
    ]);
    expect((await get('/v1/public/map/lines.geojson?at=abc')).statusCode).toBe(422);
    const r = await get('/v1/public/map/lines.geojson?at=2030');
    expect(r.headers['content-type']).toContain('application/geo+json');
  });

  it('운행 계통 선형: 계통마다 FeatureCollection, 없는 계통은 404', async () => {
    await t.fx.client.query('SELECT refresh_derived()');
    const svc = await ok('/v1/public/map/services/svc-fx-one.geojson', publicMapServiceSchema);
    expect(svc.service_id).toBe('svc-fx-one');
    for (const f of svc.features) expect(f.properties.service_id).toBe('svc-fx-one');
    // 계통 색이 없으면 대표 노선(시험 1호선) 색(Q127 A)
    expect(svc.features[0]!.properties).toMatchObject({ color: '#0052A4', color_basis: 'line' });
    expect((await get('/v1/public/map/services/svc-none.geojson')).statusCode).toBe(404);
  });
});

describe('캐시·인증·원문(6.6)', () => {
  it('ETag = 데이터 판: If-None-Match 이면 304, 쓰기 뒤에는 새 판', async () => {
    const r1 = await get('/v1/public/lines/line-fx-one');
    const etag = r1.headers.etag as string;
    expect(etag).toMatch(/^W\/"v\d+-s\d+o\d+-\d{4}-\d{2}-\d{2}"$/);
    expect(r1.headers['x-data-version']).toBeDefined();
    expect(r1.headers['cache-control']).toContain('max-age=30');
    const r2 = await get('/v1/public/lines/line-fx-one', { 'if-none-match': etag });
    expect(r2.statusCode).toBe(304);
    await apply([{ op: 'update', entity_type: 'line', id: 'line-fx-one', data: { description: '설명 갱신' } }]);
    const r3 = await get('/v1/public/lines/line-fx-one', { 'if-none-match': etag });
    expect(r3.statusCode).toBe(200);
    expect(r3.headers.etag).not.toBe(etag);
    expect(r3.json().description).toBe('설명 갱신');
    // 데이터 판이 그대로여도 규칙(마이그레이션)이 바뀌면 옛 ETag 는 304 가 아니다
    const r4 = await get('/v1/public/lines/line-fx-one');
    await t.fx.client.query(`INSERT INTO schema_migration (name, sha256) VALUES ('9999_test_rule.sql', 'x')`);
    try {
      const r5 = await get('/v1/public/lines/line-fx-one', { 'if-none-match': r4.headers.etag as string });
      expect(r5.statusCode).toBe(200);
      expect(r5.headers.etag).not.toBe(r4.headers.etag);
    } finally {
      await t.fx.client.query(`DELETE FROM schema_migration WHERE name = '9999_test_rule.sql'`);
    }
    // 검색(물리화 뷰)은 본문 해시 ETag
    const s1 = await get('/v1/public/search?q=103');
    expect(s1.headers.etag).toMatch(/^W\/"h[0-9a-f]+"$/);
    expect((await get('/v1/public/search?q=103', { 'if-none-match': s1.headers.etag as string })).statusCode).toBe(304);
  });

  it('public:read 토큰은 공개 API 만, 다른 범위 토큰은 403', async () => {
    const mk = async (scopes: string[]) =>
      (
        await t.app.inject({
          method: 'POST',
          url: '/v1/admin/tokens',
          payload: { name: `t-${scopes.join('-')}`, scopes },
        })
      ).json().token as string;
    const web = await mk(['public:read']);
    const agent = await mk(['proposal:write']);
    expect((await get('/v1/public/home', { authorization: `Bearer ${web}` })).statusCode).toBe(200);
    expect((await get('/v1/admin/station', { authorization: `Bearer ${web}` })).statusCode).toBe(403);
    expect((await get('/v1/public/home', { authorization: `Bearer ${agent}` })).statusCode).toBe(403);
    expect((await get('/v1/public/home', { authorization: 'Bearer nope' })).statusCode).toBe(401);
  });

  it('원문 다운로드: publishable·공개 라이선스만, 아니면 404', async () => {
    const r = await get(`/v1/public/documents/${publicDocId}`);
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe('%PDF-1.4 public notice');
    expect(r.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect(r.headers['x-license-class']).toBe('public_work');
    expect(
      (await get(`/v1/public/documents/${publicDocId}`, { 'if-none-match': r.headers.etag as string })).statusCode,
    ).toBe(304);
    const info = await get(`/v1/public/documents/${publicDocId}/info`);
    expect(info.json()).toMatchObject({ filename: '시험 고시.pdf', source_ids: ['src-fixture-notice'] });
    expect(info.body).not.toContain('storage_key');
    expect((await get(`/v1/public/documents/${privateDocId}`)).statusCode).toBe(404);
    expect((await get('/v1/public/documents/not-a-uuid')).statusCode).toBe(404);
    // 공개 첨부가 가리키는 원문은 공개를 끌 수 없다(DB 트리거) — 공개 응답이 비공개 원문을 가리킬 수 없다
    await expect(updateDocument(t.fx.client, publicDocId, { publishable: false })).rejects.toThrow();
  });
});
