/**
 * 도메인 검증 — Hard 규칙(docs/03-data-model.md 8-2절) 중 DB 제약·트리거로 표현하지 않은 것.
 * 적용기가 쓰기 직후(같은 트랜잭션) 영향받은 개체 id 범위로 실행한다. 위반이 있으면 적용기는 롤백한다.
 * (V-H01 출처·V-H03·V-H07·V-H15·V-H16 은 DB 트리거·CHECK 가 강제한다)
 */
import type { Queryable } from './db';
import type { Violation } from './errors';

interface HardRule {
  id: string;
  message: string;
  /** $1 = 영향받은 id 배열. 위반 개체 id 를 entity_id 열로 돌려준다(필요하면 detail) */
  sql: string;
}

export const HARD_RULES: HardRule[] = [
  {
    id: 'V-H02',
    message: '병합 대상 역(merge_into_id)이 다시 다른 역으로 병합 예정(연쇄 금지)',
    sql: `SELECT s.id AS entity_id, s.merge_into_id AS detail FROM station s JOIN station t ON t.id = s.merge_into_id
           WHERE s.deleted_at IS NULL AND t.merge_into_id IS NOT NULL AND (s.id = ANY($1) OR t.id = ANY($1))`,
  },
  {
    id: 'V-H04',
    message: '노선 단위 계획 사업은 상위 계획 반영 내역이 하나 이상 필요',
    sql: `SELECT p.id AS entity_id, NULL AS detail FROM plan p
           WHERE p.id = ANY($1) AND p.deleted_at IS NULL AND p.scope = 'line'
             AND NOT EXISTS (SELECT 1 FROM plan_ref f WHERE f.plan_id = p.id)`,
  },
  {
    id: 'V-H05',
    message: '정차역(노선역)의 노선이 운행 계통 노선에 없음',
    sql: `SELECT sp.service_id AS entity_id, x.id AS detail
            FROM stop_pattern sp JOIN stop_pattern_stop ps ON ps.pattern_id = sp.id
            JOIN line_station x ON x.id = ps.line_station_id
           WHERE (sp.service_id = ANY($1) OR x.id = ANY($1))
             AND NOT EXISTS (SELECT 1 FROM service_line sl WHERE sl.service_id = sp.service_id AND sl.line_id = x.line_id)`,
  },
  {
    id: 'V-H05b',
    message: '정차역이 삭제된 노선역',
    sql: `SELECT sp.service_id AS entity_id, x.id AS detail
            FROM stop_pattern sp JOIN stop_pattern_stop ps ON ps.pattern_id = sp.id
            JOIN line_station x ON x.id = ps.line_station_id
            JOIN service sv ON sv.id = sp.service_id AND sv.deleted_at IS NULL
           WHERE (sp.service_id = ANY($1) OR x.id = ANY($1)) AND x.deleted_at IS NOT NULL`,
  },
  {
    id: 'V-H06',
    message: '노선 기점·종점 역이 그 노선의 역 목록에 없음',
    sql: `SELECT l.id AS entity_id, s AS detail FROM line l,
                 LATERAL unnest(ARRAY[l.start_station_id, l.end_station_id]) s
           WHERE l.id = ANY($1) AND l.deleted_at IS NULL AND s IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM line_station x WHERE x.line_id = l.id AND x.station_id = s AND x.deleted_at IS NULL)`,
  },
  {
    id: 'V-H08',
    message: '좌표를 빌려 올 역(coord_same_as_id)에 좌표가 없음',
    sql: `SELECT s.id AS entity_id, s.coord_same_as_id AS detail FROM station s JOIN station t ON t.id = s.coord_same_as_id
           WHERE s.id = ANY($1) AND s.deleted_at IS NULL AND t.geom IS NULL`,
  },
  {
    id: 'V-H09',
    message: '후속(successor_id) 관계가 순환함',
    sql: `WITH RECURSIVE chain(start_id, cur, path, cyc) AS (
              SELECT id, successor_id, ARRAY[id], false FROM train_class WHERE id = ANY($1) AND successor_id IS NOT NULL
              UNION ALL
              SELECT c.start_id, t.successor_id, c.path || t.id, t.id = ANY(c.path)
                FROM chain c JOIN train_class t ON t.id = c.cur WHERE NOT c.cyc AND t.successor_id IS NOT NULL
            ), chain2(start_id, cur, path, cyc) AS (
              SELECT id, successor_id, ARRAY[id], false FROM service WHERE id = ANY($1) AND successor_id IS NOT NULL
              UNION ALL
              SELECT c.start_id, t.successor_id, c.path || t.id, t.id = ANY(c.path)
                FROM chain2 c JOIN service t ON t.id = c.cur WHERE NOT c.cyc AND t.successor_id IS NOT NULL
            )
          SELECT DISTINCT start_id AS entity_id, NULL AS detail FROM chain WHERE cyc OR cur = start_id
          UNION SELECT DISTINCT start_id, NULL FROM chain2 WHERE cyc OR cur = start_id`,
  },
  {
    id: 'V-H10',
    message: '폐지일이 개통일보다 앞섬',
    sql: `SELECT id AS entity_id, 'line' AS detail FROM line WHERE id = ANY($1) AND closed_to < opened_from
          UNION ALL SELECT id, 'line_station' FROM line_station WHERE (id = ANY($1) OR line_id = ANY($1) OR station_id = ANY($1)) AND closed_to < opened_from
          UNION ALL SELECT id, 'service' FROM service WHERE id = ANY($1) AND closed_to < opened_from
          UNION ALL SELECT id, 'station' FROM station WHERE id = ANY($1) AND own_closed_to < own_opened_from
          UNION ALL SELECT id, 'train_class' FROM train_class WHERE id = ANY($1) AND ended_to < started_from`,
  },
  {
    id: 'V-H11',
    message: '운영 중(operating)인데 폐지일이 있음',
    sql: `SELECT id AS entity_id, 'line' AS detail FROM line WHERE id = ANY($1) AND status = 'operating' AND closed_precision IS NOT NULL
          UNION ALL SELECT id, 'line_station' FROM line_station WHERE (id = ANY($1) OR line_id = ANY($1)) AND status = 'operating' AND closed_precision IS NOT NULL
          UNION ALL SELECT id, 'service' FROM service WHERE id = ANY($1) AND status = 'operating' AND closed_precision IS NOT NULL
          UNION ALL SELECT id, 'station' FROM station WHERE id = ANY($1) AND own_status = 'operating' AND own_closed_precision IS NOT NULL`,
  },
  {
    id: 'V-H13',
    message: '노선역이 있는 역은 단독 상태·개통일(own_*)을 비워야 함',
    sql: `SELECT s.id AS entity_id, NULL AS detail FROM station s
           WHERE (s.id = ANY($1) OR EXISTS (SELECT 1 FROM line_station x WHERE x.station_id = s.id AND x.id = ANY($1)))
             AND s.deleted_at IS NULL
             AND (s.own_status IS NOT NULL OR s.own_opened_precision IS NOT NULL OR s.own_closed_precision IS NOT NULL)
             AND EXISTS (SELECT 1 FROM line_station x WHERE x.station_id = s.id AND x.deleted_at IS NULL)`,
  },
  {
    id: 'V-H14',
    message:
      '병합 예정(merge_into_id) 역의 노선역은 모두 미개통(공사 중·계획)이어야 함 — 개통하면 같은 변경 묶음에서 병합',
    sql: `SELECT s.id AS entity_id, x.id AS detail FROM station s JOIN line_station x ON x.station_id = s.id AND x.deleted_at IS NULL
           WHERE (s.id = ANY($1) OR x.id = ANY($1)) AND s.deleted_at IS NULL AND s.merge_into_id IS NOT NULL
             AND x.status NOT IN ('under_construction', 'planned')`,
  },
  {
    id: 'V-H18',
    message:
      '코레일 정거장 등급·관리역은 운영기관이 한국철도공사인 노선역만. 관리역(managed_by_id)은 정거장 등급이 관리역인 코레일 노선역이어야 하고, 관리역 자신은 다른 관리역에 속하지 않음',
    sql: `SELECT x.id AS entity_id, '운영기관 ' || coalesce(vo.operator_id, '미상') AS detail
            FROM line_station x JOIN v_line_station_operator vo ON vo.line_station_id = x.id
           WHERE x.id = ANY($1) AND x.deleted_at IS NULL
             AND (x.korail_class IS NOT NULL OR x.managed_by_id IS NOT NULL) AND vo.operator_id IS DISTINCT FROM 'op-korail'
          UNION ALL
          SELECT x.id, x.managed_by_id FROM line_station x
            JOIN line_station m ON m.id = x.managed_by_id
            JOIN v_line_station_operator mo ON mo.line_station_id = m.id
           WHERE (x.id = ANY($1) OR m.id = ANY($1)) AND x.deleted_at IS NULL
             AND (m.korail_class IS DISTINCT FROM 'management' OR x.korail_class = 'management'
                  OR mo.operator_id IS DISTINCT FROM 'op-korail')`,
  },
  {
    id: 'V-H17',
    message: '활성 행이 삭제(휴지통)된 개체를 가리킴',
    sql: `SELECT r.plan_id AS entity_id, r.line_id AS detail FROM plan_line r JOIN entity e ON e.id = r.line_id
           WHERE r.plan_id = ANY($1) AND e.deleted_at IS NOT NULL
          UNION ALL SELECT r.plan_id, r.station_id FROM plan_station r JOIN entity e ON e.id = r.station_id
           WHERE r.plan_id = ANY($1) AND e.deleted_at IS NOT NULL
          UNION ALL SELECT x.id, x.station_id FROM line_station x JOIN entity e ON e.id = x.station_id
           WHERE x.id = ANY($1) AND x.deleted_at IS NULL AND e.deleted_at IS NOT NULL
          UNION ALL SELECT sl.service_id, sl.line_id FROM service_line sl JOIN entity e ON e.id = sl.line_id
           WHERE sl.service_id = ANY($1) AND e.deleted_at IS NOT NULL`,
  },
];

export async function runHardRules(db: Queryable, affectedIds: string[]): Promise<Violation[]> {
  if (affectedIds.length === 0) return [];
  const out: Violation[] = [];
  for (const rule of HARD_RULES) {
    const { rows } = await db.query<{ entity_id: string; detail: string | null }>(rule.sql, [affectedIds]);
    for (const r of rows) {
      out.push({
        rule: rule.id,
        path: '',
        entity_id: r.entity_id,
        message: r.detail ? `${rule.message} (${r.detail})` : rule.message,
      });
    }
  }
  return out;
}
