/** 품질(Soft 규칙) 집계·목록(docs/04-api.md 4-3절, docs/03-data-model.md 8-3절) */
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { qualityItems, qualitySummary } from '@k-raildex/domain';
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

  @Get(':rule')
  @RequireScope('admin:read')
  async items(@Param('rule') rule: string, @Query() query: Record<string, string | undefined>) {
    const q = z.object({ limit: limitParam, offset: offsetParam }).parse(query);
    return qualityItems(this.dbs.db, rule, q);
  }
}
