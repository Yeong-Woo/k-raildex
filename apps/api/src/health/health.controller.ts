/** HealthModule(docs/04-api.md 2절): /health(인증 없음), /v1/meta */
import { Controller, Get, Inject } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { Public, RequireScope } from '../auth/principal';

@Controller()
export class HealthController {
  constructor(@Inject(DbService) private readonly dbs: DbService) {}

  @Get('health')
  @Public()
  async health() {
    try {
      await this.dbs.db.query('SELECT 1');
      return { status: 'ok', db: 'ok' };
    } catch {
      return { status: 'degraded', db: 'error' };
    }
  }

  @Get('v1/meta')
  @RequireScope('admin:read', 'public:read')
  async meta() {
    const db = this.dbs.db;
    const dv = await db.query<{ version: string; committed_at: Date; changeset_id: string | null }>(
      `SELECT version, committed_at, changeset_id FROM data_version ORDER BY version DESC LIMIT 1`,
    );
    const counts = await db.query<{ type: string; active: number; deleted: number }>(
      `SELECT type, count(*) FILTER (WHERE deleted_at IS NULL)::int AS active,
              count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted
         FROM entity GROUP BY type ORDER BY type`,
    );
    const migrations = await db.query<{ name: string; applied_at: Date }>(
      `SELECT name, applied_at FROM schema_migration ORDER BY name`,
    );
    const latest = dv.rows[0];
    return {
      data_version: latest
        ? { version: Number(latest.version), committed_at: latest.committed_at, changeset_id: latest.changeset_id }
        : null,
      entities: Object.fromEntries(counts.rows.map((r) => [r.type, { active: r.active, deleted: r.deleted }])),
      migrations: migrations.rows,
    };
  }
}
