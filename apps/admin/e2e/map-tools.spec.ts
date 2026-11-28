/**
 * 지도 도구(FR-ADM-050·073·074): 노선 편집(역 점 클릭 → 노선역 추가·저장) · 계획 선형 편집(경유역 클릭 → schematic 저장) ·
 * OSM 매핑 점검(way 클릭 → relation 추가).
 * 전역 준비는 픽스처만 넣으므로(OSM 없음) 작은 OSM 추출을 E2E DB 에 직접 넣는다(osm 스키마만 — 자체 데이터는 API 로만 바꾼다).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, pickRef, test, toast } from './fixtures';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const requireFromDb = createRequire(path.join(ROOT, 'packages/db/package.json'));
type PgClient = {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
};
const pg = requireFromDb('pg') as { Client: new (o: { connectionString: string }) => PgClient };

type Coord = [number, number];
/** 픽스처 역(가·나·다) 옆을 지나는 way 와 relation */
const WAYS: { id: number; tags: Record<string, string>; coords: Coord[]; construction?: boolean }[] = [
  {
    id: 7001,
    tags: { railway: 'subway', name: '시험 1호선', ref: 'T1' },
    coords: [
      [127.0, 37.5],
      [127.05, 37.48],
    ],
  },
  {
    id: 7002,
    tags: { railway: 'subway', name: '시험 1호선', ref: 'T1' },
    coords: [
      [127.05, 37.48],
      [127.1, 37.45],
    ],
  },
  {
    id: 7003,
    tags: { railway: 'construction', construction: 'subway', name: '시험 1호선 연장' },
    coords: [
      [127.1, 37.45],
      [127.15, 37.42],
    ],
    construction: true,
  },
];
const RELATION = 990001;

async function withDb<T>(fn: (c: PgClient) => Promise<T>): Promise<T> {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error('E2E_DATABASE_URL 없음 — globalSetup 이 돌지 않았습니다');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** 작은 OSM 추출(osm 스키마 전체 교체) */
async function loadOsm(): Promise<void> {
  await withDb(async (c) => {
    await c.query(
      'DELETE FROM osm.relation_member; DELETE FROM osm.relation; DELETE FROM osm.way; DELETE FROM osm.extract',
    );
    const ex = await c.query(
      `INSERT INTO osm.extract (kind, fetched_at, note) VALUES ('ways', now(), 'e2e') RETURNING id`,
    );
    const extractId = ex.rows[0]!.id;
    for (const w of WAYS)
      await c.query(
        `INSERT INTO osm.way (id, extract_id, tags, is_construction, geom)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326))`,
        [
          w.id,
          extractId,
          JSON.stringify(w.tags),
          !!w.construction,
          JSON.stringify({ type: 'LineString', coordinates: w.coords }),
        ],
      );
    await c.query(`INSERT INTO osm.relation (id, extract_id, tags) VALUES ($1, $2, $3)`, [
      RELATION,
      extractId,
      JSON.stringify({ type: 'route', route: 'subway', name: '시험 1호선 노선', ref: 'T1' }),
    ]);
    await c.query(
      `INSERT INTO osm.relation_member (relation_id, way_id, seq) VALUES ($1, 7001, 1), ($1, 7002, 2), ($1, 7003, 3)`,
      [RELATION],
    );
  });
}

/** 지도 좌표 → 화면 좌표(지도 인스턴스는 도구 화면이 window.__kraildexMap 에 둔다) */
async function clickLngLat(page: Page, testId: string, c: Coord): Promise<void> {
  const box = (await page.getByTestId(testId).boundingBox())!;
  const p = await page.evaluate(
    (ll) =>
      (window as unknown as { __kraildexMap: { project(c: Coord): { x: number; y: number } } }).__kraildexMap.project(
        ll,
      ),
    c,
  );
  await page.mouse.click(box.x + p.x, box.y + p.y);
}

/** 소스가 들어오고 지도가 멈출 때까지 */
async function waitMapReady(page: Page, source: string): Promise<void> {
  await page.waitForFunction((src) => {
    const m = (
      window as unknown as {
        __kraildexMap?: { getSource(id: string): unknown; isSourceLoaded(id: string): boolean; loaded(): boolean };
      }
    ).__kraildexMap;
    return !!m && !!m.getSource(src) && m.isSourceLoaded(src) && m.loaded();
  }, source);
}

test.beforeAll(loadOsm);
test.afterAll(async () => {
  await withDb((c) =>
    c.query('DELETE FROM osm.relation_member; DELETE FROM osm.relation; DELETE FROM osm.way; DELETE FROM osm.extract'),
  );
});

test('계획 선형 편집: 지도에서 경유역을 차례로 클릭해 schematic 선형을 저장한다', async ({ page }) => {
  const api = process.env.E2E_API_URL;
  const before = (await (await page.request.get(`${api}/v1/admin/plan/plan-fx-withdrawn`)).json()) as {
    data: { geometries: unknown[] };
  };
  expect(before.data.geometries).toEqual([]);

  await page.goto('/map?tool=geometry&plan=plan-fx-withdrawn');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('미래 노선 편집');
  await expect(page.getByTestId('plan-shape')).toBeVisible();
  await page.getByRole('button', { name: '개략(경유역)' }).click();
  const draft = page.getByTestId('geometry-draft');
  await expect(draft).toBeVisible();

  // 역 범위로 옮긴 뒤 가·나·다 순서로 클릭
  await waitMapReady(page, 'stations');
  await page.evaluate(() =>
    (window as unknown as { __kraildexMap: { jumpTo(o: { center: Coord; zoom: number }): void } }).__kraildexMap.jumpTo(
      { center: [127.05, 37.475], zoom: 11 },
    ),
  );
  await waitMapReady(page, 'stations');
  for (const c of [
    [127.0, 37.5],
    [127.05, 37.48],
    [127.1, 37.45],
  ] as Coord[])
    await clickLngLat(page, 'geometry-map', c);
  const via = draft.getByTestId('via-list').locator('li');
  await expect(via).toHaveCount(3);
  await expect(via.first()).toContainText('stn-fx-a');
  await expect(via.last()).toContainText('stn-fx-c');
  await expect(draft.getByTestId('draft-length')).toContainText(/길이 1[0-9]\.\d\dkm/);

  // 되돌리기 → 다시 클릭
  await draft.getByRole('button', { name: '되돌리기' }).click();
  await expect(via).toHaveCount(2);
  await clickLngLat(page, 'geometry-map', [127.1, 37.45]);
  await expect(via).toHaveCount(3);

  // 출처 없이는 저장 불가
  await expect(draft.getByTestId('draft-problems')).toContainText('출처');
  await expect(draft.getByRole('button', { name: '선형 저장' })).toBeDisabled();
  await pickRef(page, draft.getByTestId('geometry-source'), '시험', /시험용 고시/);
  await draft.getByLabel('방법 메모').fill('E2E 경유역 클릭');
  await draft.getByRole('button', { name: '선형 저장' }).click();
  await expect(toast(page, '계획 선형을 저장했습니다')).toBeVisible();
  await expect(page.getByTestId('plan-geometry-row')).toHaveCount(1);
  await expect(page.getByTestId('plan-shape')).toContainText('선형 미확정(개략)');

  const after = (await (await page.request.get(`${api}/v1/admin/plan/plan-fx-withdrawn`)).json()) as {
    data: { geometries: { kind: string; via_station_ids: string[]; method_note: string; source_id: string }[] };
  };
  expect(after.data.geometries).toHaveLength(1);
  expect(after.data.geometries[0]).toMatchObject({
    kind: 'schematic',
    via_station_ids: ['stn-fx-a', 'stn-fx-b', 'stn-fx-c'],
    method_note: 'E2E 경유역 클릭',
    source_id: 'src-fixture-notice',
  });
});

test('OSM 매핑 점검: way 를 클릭해 relation 을 노선 osm_map 에 더한다', async ({ page }) => {
  const api = process.env.E2E_API_URL;
  const ways = (await (await page.request.get(`${api}/v1/admin/map/osm-ways?bbox=126.9,37.3,127.3,37.6`)).json()) as {
    features: unknown[];
    attribution: string;
    truncated: boolean;
  };
  expect(ways.features).toHaveLength(3);
  expect(ways.attribution).toContain('OpenStreetMap');

  await page.goto('/map?tool=osm');
  await expect(page.getByTestId('odbl-attribution')).toContainText('OpenStreetMap contributors, ODbL');
  await pickRef(page, page.locator('aside').last(), '시험 1', /시험 1호선/);
  await expect(page.getByTestId('osm-assigned-count')).toHaveText('0');
  // 노선 역 범위로 맞춘 뒤(줌 ≥ 10) 범위 안 way 가 모두 미배정
  await expect(page.getByTestId('osm-view-count')).toContainText('범위 안 way 3');
  await expect(page.getByTestId('osm-view-count')).toContainText('미배정 3');
  await waitMapReady(page, 'osm-view');

  // way 7002 가운데를 클릭
  await clickLngLat(page, 'osm-map', [127.075, 37.465]);
  const panel = page.getByTestId('osm-way-panel');
  await expect(panel).toContainText('way 7002');
  await expect(panel.getByTestId('osm-way-assigned')).toHaveText('미배정');
  const rel = panel.getByTestId('osm-way-relations');
  await expect(rel).toContainText(String(RELATION));
  await expect(rel).toContainText('시험 1호선 노선');
  await rel.getByRole('button', { name: 'osm_map 에 추가' }).click();
  await expect(toast(page, 'OSM 배정을 저장했습니다')).toBeVisible();

  await expect(page.getByTestId('osm-map-relations')).toContainText(String(RELATION));
  await expect(rel.getByRole('button', { name: '이미 있음' })).toBeDisabled();
  // 배정은 뷰(osm.v_line_way)라 바로 바뀐다 — 공사 중 way 포함 3개
  await expect(page.getByTestId('osm-assigned-count')).toHaveText('3');
  await expect(panel.getByTestId('osm-way-assigned')).toHaveText('line-fx-one');

  const line = (await (await page.request.get(`${api}/v1/admin/line/line-fx-one`)).json()) as {
    data: { osm_map: { relation_ids: number[] } | null };
  };
  expect(line.data.osm_map?.relation_ids).toEqual([RELATION]);
});

test('지도 정보 팝업: 편집 중이 아닐 때 역 점을 클릭하면 역 정보와 편집 링크가 뜬다', async ({ page }) => {
  await page.goto('/map?tool=geometry&plan=plan-fx-ext');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('미래 노선 편집');
  await waitMapReady(page, 'stations');
  await page.evaluate(() =>
    (window as unknown as { __kraildexMap: { jumpTo(o: { center: Coord; zoom: number }): void } }).__kraildexMap.jumpTo(
      { center: [127.05, 37.475], zoom: 11 },
    ),
  );
  await waitMapReady(page, 'stations');
  await clickLngLat(page, 'geometry-map', [127.0, 37.5]);
  const popup = page.locator('.maplibregl-popup');
  await expect(popup).toContainText('가');
  await expect(popup).toContainText('stn-fx-a');
  // 고른 역은 지도에서 고리로 강조
  const hl = () =>
    page.evaluate(() =>
      (window as unknown as { __kraildexMap: { getStyle(): { layers: { id: string }[] } } }).__kraildexMap
        .getStyle()
        .layers.filter((l) => l.id.startsWith('kr-hl-'))
        .map((l) => l.id),
    );
  await expect.poll(hl).toContain('kr-hl-current-station-ring');
  await popup.getByRole('link', { name: /역 편집/ }).click();
  await expect(page).toHaveURL(/\/data\/station\/stn-fx-a/);
});

test('노선 편집: 지도에서 역을 클릭해 노선역에 넣고 저장하면 유지된다', async ({ page }) => {
  const api = process.env.E2E_API_URL;
  // 앞 시험(여러 건 입력)이 역을 더했을 수 있으므로 지금 목록을 기준으로 본다
  const stationsOf = async () =>
    (
      (await (await page.request.get(`${api}/v1/admin/lines/line-fx-two/stations`)).json()) as {
        items: { station_id: string; station_name_ko: string | null }[];
      }
    ).items;
  const before = await stationsOf();
  expect(before.map((x) => x.station_id)).not.toContain('stn-fx-c');

  // 옛 링크(?tool=line)는 통합 화면의 [노선] 대상으로 연다
  await page.goto('/map?tool=line&line=line-fx-two');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('역·시설·노선 편집');
  await expect(page.getByTestId('edit-target-line')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('lm-line-summary')).toContainText('시험 2호선');
  await expect(page.getByTestId('lm-line-summary').getByRole('link', { name: /노선 상세 편집/ })).toHaveAttribute(
    'href',
    /\/data\/line\/line-fx-two/,
  );
  const names = page.getByTestId('lm-station-name');
  await expect(names).toHaveText(before.map((x) => x.station_name_ko ?? x.station_id));
  await expect(page.getByTestId('lm-marker')).toHaveCount(before.length);

  await waitMapReady(page, 'lm-stations');
  await page.evaluate(() =>
    (window as unknown as { __kraildexMap: { jumpTo(o: { center: Coord; zoom: number }): void } }).__kraildexMap.jumpTo(
      { center: [127.05, 37.45], zoom: 11 },
    ),
  );
  await waitMapReady(page, 'lm-stations');

  // 추가 모드: 이미 있는 역(가)은 다시 넣지 않는다
  await page.getByRole('button', { name: '지도에서 역 추가' }).click();
  await clickLngLat(page, 'line-map', [127.0, 37.5]);
  const msg = page.getByTestId('lm-add-message');
  await expect(msg).toContainText('이미 이 노선의');
  await expect(names).toHaveCount(before.length);
  await expect(page.locator('.maplibregl-popup')).toHaveCount(0);

  // 다(stn-fx-c)를 클릭 → 경로가 가장 적게 늘어나는 자리에
  await clickLngLat(page, 'line-map', [127.1, 37.45]);
  await expect(msg).toContainText(/다\(stn-fx-c\) → \d+번째에 넣었습니다/);
  const at = Number(/(\d+)번째/.exec((await msg.textContent()) ?? '')![1]);
  await expect(names).toHaveCount(before.length + 1);
  await expect(names.nth(at - 1)).toHaveText('다');
  await expect(page.getByTestId('lm-dirty')).toBeVisible();
  await expect(page.getByTestId('lm-marker')).toHaveCount(before.length + 1);

  await page.getByRole('button', { name: '역 순서 저장' }).click();
  await expect(toast(page, '역 순서를 저장했습니다')).toBeVisible();
  await expect(page.getByTestId('lm-dirty')).toHaveCount(0);

  await page.reload();
  await expect(names).toHaveCount(before.length + 1);
  await expect(names.nth(at - 1)).toHaveText('다');
  const after = await stationsOf();
  expect(after.map((x) => x.station_id)[at - 1]).toBe('stn-fx-c');
  expect(after.filter((x) => x.station_id !== 'stn-fx-c').map((x) => x.station_id)).toEqual(
    before.map((x) => x.station_id),
  );

  // 추가 모드가 아니면 역 점 클릭 → 화면은 그대로, 팝업([이 노선에 추가]·[역 그룹 편집]). [역 그룹 편집]을 눌러야 전환
  await waitMapReady(page, 'lm-stations');
  await page.evaluate(() =>
    (window as unknown as { __kraildexMap: { jumpTo(o: { center: Coord; zoom: number }): void } }).__kraildexMap.jumpTo(
      { center: [127.05, 37.45], zoom: 11 },
    ),
  );
  await waitMapReady(page, 'lm-stations');
  await clickLngLat(page, 'line-map', [127.0, 37.4]);
  const pop = page.getByTestId('pick-popup');
  await expect(pop).toBeVisible();
  await expect(pop.getByTestId('pick-add')).toBeVisible();
  await expect(page.getByTestId('edit-target-line')).toHaveAttribute('aria-pressed', 'true');
  // 대상을 바꿔도 지도는 그대로(같은 인스턴스·같은 위치) — 목록만 바뀐다
  type TaggedMap = { __tag?: string; getCenter(): { lng: number; lat: number }; getZoom(): number };
  const view = () =>
    page.evaluate(() => {
      const m = (window as unknown as { __kraildexMap: TaggedMap }).__kraildexMap;
      const c = m.getCenter();
      return { tag: m.__tag ?? null, lng: c.lng.toFixed(5), lat: c.lat.toFixed(5), zoom: m.getZoom().toFixed(3) };
    });
  await page.evaluate(() => ((window as unknown as { __kraildexMap: TaggedMap }).__kraildexMap.__tag = 'same'));
  const v0 = await view();
  await pop.getByTestId('pick-edit').click();
  await expect(page).toHaveURL(/station=stn-fx-e/);
  await expect(page.getByTestId('edit-target-station')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('map-selected-station')).toBeVisible();
  expect(await view()).toEqual(v0);
  // 다시 [노선] 으로 오면 고른 노선이 그대로
  await page.getByTestId('edit-target-line').click();
  await expect(page.getByTestId('lm-line-summary')).toContainText('시험 2호선');
  expect(await view()).toEqual(v0);
  // 고른 노선 해제 → 노선 목록으로(지도 그대로)
  await page.getByTestId('lm-clear').click();
  await expect(page.getByTestId('lm-line-summary')).toHaveCount(0);
  await expect(page).not.toHaveURL(/line=line-fx-two/);
  expect(await view()).toEqual(v0);
});

test('계획 선형 편집: 계획 목록을 품질 규칙으로 걸러 고른다', async ({ page }) => {
  const api = process.env.E2E_API_URL;
  const ent = (await (await page.request.get(`${api}/v1/admin/quality/entities/plan`)).json()) as {
    items: { id: string; issues: { rule: string }[] }[];
  };
  // 계획에 가장 많이 걸린 규칙
  const counts = new Map<string, number>();
  for (const it of ent.items)
    for (const r of new Set(it.issues.map((x) => x.rule))) counts.set(r, (counts.get(r) ?? 0) + 1);
  const [rule] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  const expected = ent.items
    .filter((it) => it.issues.some((x) => x.rule === rule))
    .map((it) => it.id)
    .sort();

  await page.goto('/map?tool=geometry');
  const list = page.getByTestId('review-list-plan');
  await expect(list.getByTestId('review-row').first()).toBeVisible();
  await expect(list.locator('li')).toHaveCount(ent.items.length);
  await page.getByTestId('review-rule-filter').selectOption(rule);
  await expect
    .poll(async () => (await list.locator('li').evaluateAll((ls) => ls.map((l) => l.getAttribute('data-id')))).sort())
    .toEqual(expected);
  for (const tag of await list.getByTestId('review-tag').all())
    await expect(tag).toHaveAttribute('data-state', 'issue');

  // 선형 필터: 선형 없음 칩은 선형 없는 계획만
  await page.getByTestId('review-rule-filter').selectOption('');
  await page.getByRole('button', { name: /^선형 없음/ }).click();
  for (const row of await list.getByTestId('review-row').all()) await expect(row).toContainText('선형 없음');
  await page.getByRole('button', { name: /^전체/ }).click();

  await page.getByTestId('review-rule-filter').selectOption(rule);
  await list.locator(`li[data-id="${expected[0]}"]`).getByTestId('review-row').click();
  await expect(page).toHaveURL(new RegExp(`plan=${expected[0]}`));
  await expect(page.getByTestId('plan-selected')).toContainText(rule);
  await expect(page.getByTestId('plan-shape')).toBeVisible();
});

test('역·시설 편집 [시설]: 좌표 없는 시설을 고르고 지도에서 찍어 저장한다', async ({ page }) => {
  const api = process.env.E2E_API_URL;
  const r = await page.request.post(`${api}/v1/admin/facility`, {
    data: {
      id: 'fac-e2e-place',
      name_ko: '찍기시험기지',
      checked_at: '2026-11-27',
      sources: [{ source_id: 'src-fixture-notice' }],
    },
  });
  expect(r.ok(), await r.text()).toBe(true);
  await page.goto('/map?tab=edit&target=facility');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('역·시설·노선 편집');
  await expect(page.getByTestId('edit-target-facility')).toHaveAttribute('aria-pressed', 'true');
  await waitMapReady(page, 'current-lines');
  const list = page.getByTestId('review-list-facility');
  await list.locator('li[data-id="fac-e2e-place"]').getByTestId('review-row').click();
  await expect(page.getByTestId('facility-selected')).toContainText('찍기시험기지');
  // 좌표 없는 시설은 바로 찍기 모드
  await expect(page.getByTestId('facility-place')).toContainText('지도를 누르세요');
  await clickLngLat(page, 'facility-map', [127.05, 37.5]);
  await expect(page.getByTestId('facility-pending-coord')).toBeVisible();
  await page.getByRole('button', { name: '좌표 저장' }).click();
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: '시설 좌표를 저장했습니다' }).first(),
  ).toBeVisible();
  const d = await (await page.request.get(`${api}/v1/admin/facility/fac-e2e-place`)).json();
  expect(d.data.coord_source).toBe('manual');
  expect(Math.abs(d.data.geom.lat - 37.5)).toBeLessThan(0.01);
  expect(Math.abs(d.data.geom.lng - 127.05)).toBeLessThan(0.01);
  const del = await page.request.delete(`${api}/v1/admin/facility/fac-e2e-place`, {
    headers: { 'If-Match': String(d.version) },
  });
  expect(del.ok()).toBe(true);
});

test('상세 [지도] 탭: 노선을 강조하고 둘레 역 그룹 목록에서 열면 그 역 그룹 지도 탭', async ({ page }) => {
  await page.goto('/data/line/line-fx-two?tab=map');
  await expect(page.getByTestId('entity-focus-map')).toBeVisible();
  await waitMapReady(page, 'fx-lines');
  const filter = await page.evaluate(() =>
    (window as unknown as { __kraildexMap: { getFilter(id: string): unknown } }).__kraildexMap.getFilter(
      'fx-line-primary',
    ),
  );
  expect(JSON.stringify(filter)).toContain('line-fx-two');
  const aside = page.getByTestId('entity-focus-list');
  await expect(aside).toContainText('강조');
  await expect(aside).toContainText('시험 2호선');
  await aside.getByRole('link', { name: '열기' }).nth(1).click();
  await expect(page).toHaveURL(/\/data\/station\/stn-[^?]+\?tab=map/);
  await expect(page.getByTestId('entity-focus-map')).toBeVisible();
});
