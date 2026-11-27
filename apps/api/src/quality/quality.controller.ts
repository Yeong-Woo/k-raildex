/** 품질(Soft 규칙) 집계·목록(docs/04-api.md 4-3절, docs/03-data-model.md 8-3절) */
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { qualityItems, qualitySummary, reviewList } from '@k-raildex/domain';
import { z } from 'zod';
import { RequireScope } from '../auth/principal';
import { limitParam, offsetParam } from '../common/http';
import { DbService } from '../db/db.service';

@Controller('v1/admin/quality')
export class QualityController {
  constructor(@Inject(DbService) private readonly dbs: DbService) {}

  @Get()
  @RequireScope('admin:read')
  async summary() {
    return qualitySummary(this.dbs.db);
  }

  /** 역·노선 고르기 목록 + 개체별 걸린 규칙(지도 편집·노선 편집) */
  @Get('entities/:type')
  @RequireScope('admin:read')
  async entities(@Param('type') type: string) {
    return reviewList(this.dbs.db, z.enum(['station', 'line', 'plan']).parse(type));
  }

  @Get(':rule')
  @RequireScope('admin:read')
  async items(@Param('rule') rule: string, @Query() query: Record<string, string | undefined>) {
    const q = z.object({ limit: limitParam, offset: offsetParam }).parse(query);
    return qualityItems(this.dbs.db, rule, q);
  }
}
