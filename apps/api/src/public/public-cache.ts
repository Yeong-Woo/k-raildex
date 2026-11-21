/**
 * 공개 API 응답 캐시·조건부 요청(docs/04-api.md 5절 "캐시").
 * - ETag = 데이터 판(data_version 최대값) + DB 날짜(파생 연표·지연 여부가 날짜에 따라 바뀐다). If-None-Match 가 같으면
 *   읽기 모델을 만들지 않고 304.
 * - 물리화 뷰(mv_search·mv_map_*)를 읽는 응답은 판이 오른 뒤 worker 가 갱신하기까지 몇 초 늦을 수 있어 본문 해시를 ETag 로
 *   쓰고 메모 수명을 짧게 둔다.
 * - 메모: 경로+쿼리 × 판 × 날짜 단위로 직렬화된 본문을 프로세스 메모리(크기 상한 LRU)에 둔다 — 지도 연도별 GeoJSON 등.
 *   판이 바뀌면 키가 달라져 자연히 버려진다(저장하는 값이 아니라 응답 캐시).
 */
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { dataVersion, resolveMissing } from '@k-raildex/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DbService } from '../db/db.service';

export type CacheKind =
  /** 일반 읽기 모델(뷰·테이블) */
  | 'data'
  /** 시점별 지도(map_at_*) — 판 단위 캐시 */
  | 'map'
  /** 물리화 뷰를 읽는 응답(검색·현재 지도) */
  | 'mv';

const CACHE_CONTROL: Record<CacheKind, string> = {
  // 공개 사이트 쓰기 반영 30초 이내(Q52 A) — 엣지·SSR 이 30초 안에 다시 확인하고 ETag 로 304 를 받는다
  data: 'public, max-age=30, stale-while-revalidate=300',
  map: 'public, max-age=30, stale-while-revalidate=600',
  mv: 'public, max-age=30, stale-while-revalidate=120',
};

const MEMO_MAX_BYTES = 96 * 1024 * 1024;
const MEMO_TTL_MS: Record<CacheKind, number> = { data: 10 * 60_000, map: 30 * 60_000, mv: 30_000 };

interface Entry {
  body: string;
  etag: string;
  at: number;
  kind: CacheKind;
}

/** 크기 상한 LRU(Map 삽입 순서) */
export class MemoCache {
  private readonly map = new Map<string, Entry>();
  private bytes = 0;
  constructor(private readonly maxBytes = MEMO_MAX_BYTES) {}

  get(key: string): Entry | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() - e.at > MEMO_TTL_MS[e.kind]) {
      this.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, e);
    return e;
  }

  set(key: string, e: Entry): void {
    this.delete(key);
    if (e.body.length > this.maxBytes / 4) return;
    this.map.set(key, e);
    this.bytes += e.body.length;
    for (const [k] of this.map) {
      if (this.bytes <= this.maxBytes) break;
      this.delete(k);
    }
  }

  private delete(key: string): void {
    const e = this.map.get(key);
    if (!e) return;
    this.bytes -= e.body.length;
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
    this.bytes = 0;
  }

  get size(): number {
    return this.map.size;
  }
}

export interface ServeOptions {
  kind?: CacheKind;
  /** 결과가 null 일 때 리다이렉트·삭제 판정에 쓸 id(상세 응답) */
  id?: string;
  contentType?: string;
}

function inm(req: FastifyRequest): string[] {
  const h = req.headers['if-none-match'];
  const raw = Array.isArray(h) ? h.join(',') : (h ?? '');
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

@Injectable()
export class PublicCache {
  readonly memo = new MemoCache();

  constructor(@Inject(DbService) private readonly dbs: DbService) {}

  /** 읽기 모델 fn 을 판 단위 ETag·메모와 함께 보낸다. fn 이 null 이면 301(리다이렉트)·410(삭제)·404 */
  async serve(
    req: FastifyRequest,
    reply: FastifyReply,
    fn: (version: number) => Promise<unknown>,
    opts: ServeOptions = {},
  ): Promise<FastifyReply> {
    const kind = opts.kind ?? 'data';
    const { version, today } = await dataVersion(this.dbs.db);
    const dvTag = `W/"v${version}-${today}"`;
    const conditional = inm(req);
    void reply
      .header('x-data-version', String(version))
      .header('cache-control', CACHE_CONTROL[kind])
      .header('vary', 'Authorization');
    if (kind !== 'mv' && (conditional.includes(dvTag) || conditional.includes('*')))
      return reply.header('etag', dvTag).status(304).send();

    const key = `${req.url}|${version}|${today}`;
    let entry = this.memo.get(key);
    if (!entry) {
      const result = await fn(version);
      if (result === null || result === undefined) return this.missing(req, reply, opts.id);
      const body = JSON.stringify(result);
      const etag = kind === 'mv' ? `W/"h${createHash('sha1').update(body).digest('hex').slice(0, 20)}"` : dvTag;
      entry = { body, etag, at: Date.now(), kind };
      this.memo.set(key, entry);
    }
    void reply.header('etag', entry.etag);
    if (conditional.includes(entry.etag)) return reply.status(304).send();
    return reply
      .status(200)
      .type(opts.contentType ?? 'application/json; charset=utf-8')
      .send(entry.body);
  }

  /** 없는 id: 리다이렉트가 있으면 301 + Location(같은 경로의 새 id), 삭제됐으면 410, 아니면 404 (FR-API-007) */
  private async missing(req: FastifyRequest, reply: FastifyReply, id: string | undefined): Promise<FastifyReply> {
    void reply.header('cache-control', 'public, max-age=30').type('application/json; charset=utf-8');
    if (!id) return reply.status(404).send({ error: { code: 'not_found', message: '없음' } });
    const m = await resolveMissing(this.dbs.db, id);
    if (m.kind === 'moved') {
      const path = req.url.replace(`/${encodeURIComponent(id)}`, `/${encodeURIComponent(m.redirect.new_id)}`);
      return reply
        .status(301)
        .header('location', path)
        .send({
          error: { code: 'moved_permanently', message: `${id} → ${m.redirect.new_id}` },
          redirect: { ...m.redirect, api_path: path },
        });
    }
    if (m.kind === 'gone') return reply.status(410).send({ error: { code: 'gone', message: `${id} 는 삭제됨` } });
    return reply.status(404).send({ error: { code: 'not_found', message: `${id} 가 없음` } });
  }
}
