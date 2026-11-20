/** pg 풀. 읽기는 풀에서 바로, 쓰기(적용기)는 전용 연결에서(applyChangeset 이 BEGIN/COMMIT 을 직접 관리) */
import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@k-raildex/domain';
import type pg from 'pg';
import { z } from 'zod';
import { PG_POOL } from '../tokens';

@Injectable()
export class DbService {
  constructor(@Inject(PG_POOL) readonly pool: pg.Pool) {}

  /** 읽기용 Queryable */
  get db(): pg.Pool {
    return this.pool;
  }

  /** 요청 하나의 전용 연결. 예기치 않은 오류면 연결을 버린다 */
  async withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken: Error | undefined;
    try {
      return await fn(client);
    } catch (e) {
      if (!(e instanceof DomainError) && !(e instanceof z.ZodError)) broken = e as Error;
      throw e;
    } finally {
      client.release(broken);
    }
  }
}
