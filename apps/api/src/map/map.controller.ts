/**
 * 지도 GeoJSON — 관리 앱(현재 지도·미래 지도 미리 보기, docs/05-admin-app.md 6절 FR-ADM-070·075).
 * 공개 API(/v1/public/map/*)도 같은 도메인 함수(map.ts)를 쓸 예정.
 */
import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  currentMapLines,
  currentMapStations,
  mapAtLines,
  mapAtStations,
  mapTimeline,
  parseMapAt,
  parseStageMin,
  type MapAtQuery,
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

  @Get('current-lines')
  @RequireScope('admin:read')
  async currentLines() {
    return currentMapLines(this.dbs.db);
  }

  @Get('timeline')
  @RequireScope('admin:read')
  async timeline(@Query() q: Q) {
    return mapTimeline(this.dbs.db, parseStageMin(q.stage_min));
  }
}
