import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

/** node-postgres 풀(또는 클라이언트)에 Drizzle 를 씌운다 */
export function createDb(client: pg.Pool | pg.Client | pg.PoolClient): Db {
  return drizzle(client, { schema });
}
