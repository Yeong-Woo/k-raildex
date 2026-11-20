/** pg 연결 추상화와 값 변환 */
import type pg from 'pg';

export type Queryable = Pick<pg.Client | pg.PoolClient, 'query'>;

/** pg 가 돌려준 값을 계약 형태로: date → YYYY-MM-DD, timestamptz → ISO, numeric·bigint 문자열 → number */
export function fromDb(value: unknown, dataType: string): unknown {
  if (value === null || value === undefined) return null;
  switch (dataType) {
    case 'date':
      if (value instanceof Date) {
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, '0');
        const d = String(value.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
      return value;
    case 'timestamp with time zone':
      return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
    case 'numeric':
    case 'bigint':
      return typeof value === 'string' ? Number(value) : value;
    default:
      return value;
  }
}
