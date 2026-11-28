/**
 * 지도 GeoJSON — 관리 앱(현재 지도·미래 지도·노선 편집·계획 선형 편집·OSM 매핑 점검, docs/05-admin-app.md 6절 FR-ADM-070~075).
 * 공개 API(/v1/public/map/*)도 같은 도메인 함수(map.ts)를 쓸 예정.
 */
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import {
  currentMapLines,
  currentMapStations,
  lineGeometry,
  osmWays,
  parseBbox,
  planGeometry,
  mapAtLines,
  mapAtStations,
  mapTimeline,
  parseMapAt,
  parseStageMin,
  type MapAtQuery,
  publicMapDepots,
  facilityTracks,
  mapFocus,
  MAP_FOCUS_TYPES,
  DomainError,
  type MapFocusType,
} from '@k-raildex/domain';
import { RequireScope } from '../auth/principal';
import { boolParam } from '../common/http';
import { DbService } from '../db/db.service';

type Q = Record<string, string | undefined>;

function mapAtQuery(q: Q): MapAtQuery {
  return {
    year: parseMapAt(q.at),
    stage_min: parseStageMin(q.stage_min),
    include_undated: boolParam.parse(q.include_undated),
  };
}

@Controller('v1/admin/map')
export class MapController {
  constructor(@Inject(DbService) private readonly dbs: DbService) {}

  @Get('lines')
  @RequireScope('admin:read')
  async lines(@Query() q: Q) {
    return mapAtLines(this.dbs.db, mapAtQuery(q));
  }

  @Get('stations')
  @RequireScope('admin:read')
  async stations(@Query() q: Q) {
    return mapAtStations(this.dbs.db, mapAtQuery(q));
  }

  @Get('current-stations')
  @RequireScope('admin:read')
  async currentStations() {
    return currentMapStations(this.dbs.db);
  }

  /** 시설 OSM 선로(0036, ODbL — 지도 표시만) */
  @Get('facility-tracks')
  @RequireScope('admin:read')
  async facilityTracks() {
    return facilityTracks(this.dbs.db);
  }

  /** 시설 점(공개 지도의 차량기지 + 시험 선로 등 모든 시설 종류) */
  @Get('depots')
  @RequireScope('admin:read')
  async depots() {
    return publicMapDepots(this.dbs.db, { allKinds: true });
  }

  @Get('current-lines')
  @RequireScope('admin:read')
  async currentLines() {
    return currentMapLines(this.dbs.db);
  }

  /** 개체 지도 강조(상세 화면 지도 탭): 강조할 노선·역 그룹·시설 id + 시설 점 */
  @Get('focus/:type/:id')
  @RequireScope('admin:read')
  async focus(@Param('type') type: string, @Param('id') id: string) {
    if (!(MAP_FOCUS_TYPES as readonly string[]).includes(type))
      throw new DomainError('validation', `지도 강조를 지원하지 않는 종류: ${type}`);
    return mapFocus(this.dbs.db, type as MapFocusType, id);
  }

  /** OSM way(참고, ODbL): bbox=w,s,e,n · line_id · unassigned=true. 3000건 상한(truncated) */
  @Get('osm-ways')
  @RequireScope('admin:read')
  async osmWays(@Query() q: Q) {
    return osmWays(this.dbs.db, {
      bbox: parseBbox(q.bbox),
      line_id: q.line_id || null,
      unassigned: boolParam.parse(q.unassigned),
    });
  }

  /** 노선에 배정된 OSM way + 정거장 점 */
  @Get('line-geometry/:line_id')
  @RequireScope('admin:read')
  async lineGeometry(@Param('line_id') lineId: string) {
    return lineGeometry(this.dbs.db, lineId);
  }

  /** 계획 선형 목록 + 경유역 + v_plan_shape 결과 */
  @Get('plan-geometry/:plan_id')
  @RequireScope('admin:read')
  async planGeometry(@Param('plan_id') planId: string) {
    return planGeometry(this.dbs.db, planId);
  }

  @Get('timeline')
  @RequireScope('admin:read')
  async timeline(@Query() q: Q) {
    return mapTimeline(this.dbs.db, parseStageMin(q.stage_min));
  }
}
