/**
 * 지도 도구(FR-ADM-073·074): 계획 선형 편집(경유역 클릭 → schematic 저장) · OSM 매핑 점검(way 클릭 → relation 추가).
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
  await expect(page.getByRole('heading', { level: 1 })).toContainText('계획 선형 편집');
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
  await expect(page.getByRole('heading', { level: 1 })).toContainText('계획 선형 편집');
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
  await popup.getByRole('link', { name: /역 편집/ }).click();
  await expect(page).toHaveURL(/\/data\/station\/stn-fx-a/);
});
