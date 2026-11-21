/**
 * 개체 CRUD 공통 처리(docs/04-api.md 4절). 모든 쓰기는 도메인 적용기(applyChangeset)를 요청 전용 연결에서 부른다.
 */
import { Inject, Injectable } from '@nestjs/common';
import { lineStationId, type EntityType } from '@k-raildex/contracts';
import {
  applyChangeset,
  DomainError,
  entityLabels,
  findReferences,
  readEntity,
  requireEntity,
  type ApplyResult,
  type Op,
  type Queryable,
} from '@k-raildex/domain';
import { domainErrorBody, type ErrorBody } from '../common/errors';
import type { WriteOptions } from '../common/http';
import { DbService } from '../db/db.service';
import type { Principal } from '../auth/principal';

type AnyObject = Record<string, unknown>;

export interface WriteResponse {
  id: string | null;
  version: number | null;
  changeset_id: string;
  data_version: number | null;
  dry_run: boolean;
  data: AnyObject | null;
  /** Soft 경고(검증 모듈이 생기면 채운다) */
  warnings: unknown[];
}

export interface ReferenceItem {
  table: string;
  column: string;
  owner_id: string | null;
  owner_type: EntityType | null;
  owner_label: string | null;
  owner_deleted: boolean | null;
  count: number;
}

@Injectable()
export class EntityService {
  constructor(@Inject(DbService) private readonly dbs: DbService) {}

  get db(): Queryable {
    return this.dbs.db;
  }

  /** 변경 묶음 하나로 op 들을 적용(dry_run 이면 되돌린다) */
  async apply(p: Principal, ops: Op[], opts: WriteOptions, defaultTitle: string): Promise<ApplyResult> {
    return this.dbs.withClient((c) =>
      applyChangeset(
        c,
        {
          title: opts.changeset_title ?? defaultTitle,
          rationale: opts.rationale,
          origin: 'admin_edit',
          author_id: p.userId,
          ops,
          meta: { via: p.via, ...(p.tokenId ? { token_id: p.tokenId } : {}) },
        },
        { dryRun: opts.dry_run },
      ),
    );
  }

  /** 단건 쓰기 응답: 마지막 op(또는 지정 op)의 결과 */
  toWriteResponse(r: ApplyResult, dryRun: boolean, index = r.results.length - 1): WriteResponse {
    const res = r.results[index];
    const after = (res?.after ?? null) as AnyObject | null;
    return {
      id: res?.entity_id ?? null,
      version: typeof after?.version === 'number' ? after.version : null,
      changeset_id: r.changeset_id,
      data_version: r.data_version,
      dry_run: dryRun,
      data: after,
      warnings: [],
    };
  }

  /** 저장 없이 검증. 도메인 오류는 결과로 돌려준다 */
  async validate(
    p: Principal,
    ops: Op[],
  ): Promise<{ valid: true; results: ApplyResult['results'] } | { valid: false; error: ErrorBody['error'] }> {
    try {
      const r = await this.apply(p, ops, { dry_run: true }, '검증(저장 안 함)');
      return { valid: true, results: r.results };
    } catch (e) {
      if (e instanceof DomainError) return { valid: false, error: domainErrorBody(e).error };
      throw e;
    }
  }

  async typeOfId(id: string): Promise<EntityType> {
    const { rows } = await this.db.query<{ type: EntityType }>(`SELECT type FROM entity WHERE id = $1`, [id]);
    if (!rows[0]) throw new DomainError('not_found', `${id} 가 없음`);
    return rows[0].type;
  }

  async read(type: EntityType, id: string, includeDeleted = false): Promise<AnyObject> {
    return requireEntity(this.db, type, id, { includeDeleted });
  }

  /** 계산값(DB 뷰). 삭제된 개체는 뷰에서 빠지므로 null 값 */
  async derived(type: EntityType, id: string): Promise<AnyObject> {
    const one = async <T extends AnyObject>(sql: string): Promise<T | null> =>
      ((await this.db.query<T>(sql, [id])).rows[0] as T | undefined) ?? null;
    const fuzzy = (value: unknown, precision: unknown) =>
      precision == null ? null : { value: value ?? null, precision };
    switch (type) {
      case 'station': {
        const st = await one<AnyObject>(`SELECT * FROM v_station_status WHERE station_id = $1`);
        const area = await one<{ areas: string[] }>(`SELECT areas FROM v_station_area WHERE station_id = $1`);
        const cls = await one<{ line_classes: string[] }>(
          `SELECT line_classes FROM v_station_line_class WHERE station_id = $1`,
        );
        const rev = await one<{ review_status: string }>(
          `SELECT review_status FROM v_station_review WHERE station_id = $1`,
        );
        return {
          status: st?.status ?? null,
          opened: st ? fuzzy(st.opened_value, st.opened_precision) : null,
          closed: st ? fuzzy(st.closed_value, st.closed_precision) : null,
          line_count: st?.line_count ?? null,
          areas: area?.areas ?? null,
          line_classes: cls?.line_classes ?? null,
          review_status: rev?.review_status ?? null,
        };
      }
      case 'plan': {
        const stage = await one<{ stage: string | null }>(`SELECT stage FROM v_plan_stage WHERE plan_id = $1`);
        const t = await one<AnyObject>(`SELECT * FROM v_plan_target_open WHERE plan_id = $1`);
        const area = await one<{ areas: string[] }>(`SELECT areas FROM v_plan_area WHERE plan_id = $1`);
        return {
          stage: stage?.stage ?? null,
          target_open: t
            ? {
                ...(fuzzy(t.value, t.precision) ?? {}),
                basis: t.basis ?? null,
                source_id: t.source_id ?? null,
                as_of: fuzzy(t.as_of_value, t.as_of_precision),
              }
            : null,
          areas: area?.areas ?? null,
        };
      }
      case 'line': {
        const area = await one<{ areas: string[] }>(`SELECT areas FROM v_line_area WHERE line_id = $1`);
        return { areas: area?.areas ?? null };
      }
      case 'service': {
        const area = await one<{ areas: string[] }>(`SELECT areas FROM v_service_area WHERE service_id = $1`);
        return { areas: area?.areas ?? null };
      }
      default:
        return {};
    }
  }

  async references(type: EntityType, id: string, activeOnly = true): Promise<ReferenceItem[]> {
    const refs = await findReferences(this.db, type, id, { activeOnly });
    const labels = await entityLabels(
      this.db,
      refs.map((r) => r.owner_id).filter((x): x is string => !!x),
    );
    return refs.map((r) => {
      const l = r.owner_id ? labels.get(r.owner_id) : undefined;
      return {
        table: r.table,
        column: r.column,
        owner_id: r.owner_id,
        owner_type: l?.type ?? null,
        owner_label: l?.label ?? null,
        owner_deleted: l ? l.deleted : null,
        count: r.count,
      };
    });
  }

  /** 변경 이력: 이 개체(옛 id 포함)의 적용된 change_op */
  async history(id: string, limit: number, offset: number) {
    const old = await this.db.query<{ old_id: string }>(`SELECT old_id FROM id_redirect WHERE new_id = $1`, [id]);
    const ids = [id, ...old.rows.map((r) => r.old_id)];
    const where = `o.entity_id = ANY ($1) AND c.status = 'applied'`;
    const total = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM change_op o JOIN changeset c ON c.id = o.changeset_id WHERE ${where}`,
      [ids],
    );
    const { rows } = await this.db.query(
      `SELECT o.changeset_id, o.seq, o.op, o.entity_type, o.entity_id, o.payload, o.before, o.after,
              c.title, c.rationale, c.origin, c.applied_at, u.display_name AS author, dv.version AS data_version
         FROM change_op o
         JOIN changeset c ON c.id = o.changeset_id
         LEFT JOIN app_user u ON u.id = c.author_id
         LEFT JOIN data_version dv ON dv.changeset_id = c.id
        WHERE ${where}
        ORDER BY c.applied_at DESC NULLS LAST, o.id DESC
        LIMIT $2 OFFSET $3`,
      [ids, limit, offset],
    );
    return {
      items: rows.map((r) => ({ ...r, data_version: r.data_version == null ? null : Number(r.data_version) })),
      total: total.rows[0]?.n ?? 0,
      limit,
      offset,
    };
  }

  // -------------------------------------------------------------------------
  // 노선별 역 목록(docs/04-api.md 4-1절)
  // -------------------------------------------------------------------------

  async lineStations(lineId: string): Promise<AnyObject[]> {
    await requireEntity(this.db, 'line', lineId);
    // 역 쪽 종류·좌표도 함께(지도 역 점 mv_map_station 은 여객역만이라 화물역·신호장 좌표를 지도 편집기가 못 찾았다)
    const { rows } = await this.db.query<{
      id: string;
      station_name_ko: string | null;
      station_kind: string | null;
      lng: number | null;
      lat: number | null;
    }>(
      `SELECT x.id, s.name_ko AS station_name_ko, s.kind AS station_kind,
              ST_X(s.geom::geometry) AS lng, ST_Y(s.geom::geometry) AS lat
         FROM line_station x LEFT JOIN station s ON s.id = x.station_id
        WHERE x.line_id = $1 AND x.deleted_at IS NULL ORDER BY x.seq`,
      [lineId],
    );
    const out: AnyObject[] = [];
    for (const r of rows) {
      const ls = await readEntity(this.db, 'line_station', r.id);
      if (ls)
        out.push({
          ...ls,
          station_name_ko: r.station_name_ko,
          station_kind: r.station_kind,
          station_geom: r.lng != null && r.lat != null ? { lng: r.lng, lat: r.lat } : null,
        });
    }
    return out;
  }

  /**
   * 노선별 역 전체 교체 → op 계산. 배열 순서가 순서다.
   * - id 가 있는 항목: 이 노선의 활성 행 수정(바뀐 필드만, version 이 있으면 expected_version)
   * - id 가 없는 항목: 새 행(ls-<노선>--<역>[-n], 삭제된 id 도 피한다)
   * - 목록에 없는 활성 행: 소프트 삭제(참조가 있으면 409)
   * seq: (line_id, seq) 유일 제약은 삭제된 행도 포함하므로, 삭제된 행·이번에 삭제할 행의 seq 를 건너뛰며 1부터 매긴다.
   * 그래서 삭제된 행의 seq 는 다시 쓰이지 않고(복구 시 충돌 없음) 활성 행끼리 seq 를 맞바꾸는 것은 지연 제약이 받아 준다.
   */
  async planLineStationOps(lineId: string, items: AnyObject[]): Promise<Op[]> {
    await requireEntity(this.db, 'line', lineId);
    const existing = await this.db.query<{ id: string; seq: number; deleted_at: Date | null }>(
      `SELECT id, seq, deleted_at FROM line_station WHERE line_id = $1`,
      [lineId],
    );
    const active = new Map(existing.rows.filter((r) => !r.deleted_at).map((r) => [r.id, r]));
    const deleted = new Set(existing.rows.filter((r) => r.deleted_at).map((r) => r.id));
    const violations: { rule: string; path: string; message: string }[] = [];
    const keep = new Set<string>();
    items.forEach((it, i) => {
      const id = it.id;
      if (id === undefined || id === null) return;
      if (typeof id !== 'string') violations.push({ rule: 'schema', path: `items.${i}.id`, message: 'id 는 문자열' });
      else if (keep.has(id)) violations.push({ rule: 'schema', path: `items.${i}.id`, message: `중복 id ${id}` });
      else if (deleted.has(id))
        violations.push({ rule: 'schema', path: `items.${i}.id`, message: `${id} 는 휴지통에 있음(먼저 복구)` });
      else if (!active.has(id))
        violations.push({ rule: 'schema', path: `items.${i}.id`, message: `${id} 는 이 노선의 노선별 역이 아님` });
      else keep.add(id);
      if (it.line_id !== undefined && it.line_id !== lineId)
        violations.push({ rule: 'schema', path: `items.${i}.line_id`, message: 'line_id 는 경로의 노선' });
    });
    if (violations.length) throw new DomainError('validation', '노선별 역 목록 오류', { violations });

    const removed = [...active.values()].filter((r) => !keep.has(r.id));
    const occupied = new Set([
      ...existing.rows.filter((r) => r.deleted_at).map((r) => r.seq),
      ...removed.map((r) => r.seq),
    ]);
    let next = 1;
    const nextSeq = () => {
      while (occupied.has(next)) next++;
      return next++;
    };

    const deletes: Op[] = removed.map((r) => ({
      op: 'delete',
      entity_type: 'line_station',
      id: r.id,
      reason: '노선별 역 목록 교체',
    }));
    const updates: Op[] = [];
    const creates: Op[] = [];
    const taken = new Set<string>();
    for (const it of items) {
      const { id, version, line_id: _l, seq: _s, ...fields } = it;
      const seq = nextSeq();
      if (typeof id === 'string') {
        const before = (await readEntity(this.db, 'line_station', id)) as AnyObject;
        const data: AnyObject = { ...fields, seq };
        const changed = Object.keys(data).some(
          (k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(data[k] ?? null),
        );
        if (!changed) continue;
        updates.push({
          op: 'update',
          entity_type: 'line_station',
          id,
          data,
          ...(typeof version === 'number' ? { expected_version: version } : {}),
        });
      } else {
        const stationId = String(fields.station_id ?? '');
        let n = 1;
        let newId = lineStationId(lineId, stationId, n);
        while (taken.has(newId) || (await this.db.query(`SELECT 1 FROM entity WHERE id = $1`, [newId])).rowCount)
          newId = lineStationId(lineId, stationId, ++n);
        taken.add(newId);
        creates.push({
          op: 'create',
          entity_type: 'line_station',
          data: { ...fields, id: newId, line_id: lineId, seq },
        });
      }
    }
    return [...deletes, ...updates, ...creates];
  }
}
