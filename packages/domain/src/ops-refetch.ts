/**
 * 원본 재다운로드(docs/04-api.md 4-3절 `POST /v1/admin/documents/:id/refetch`, Q76).
 * 문서의 origin_url 을 다시 받아 sha256 을 비교한다. 같으면 retrieved_at 만 갱신, 다르면 **새 문서 행**(kind original)을 만들고
 * 옛 행은 그대로 둔다(meta.previous_document_id 로 이전 판을 가리킨다, 출처 연결은 복사). 공개 여부(publishable)는 새 판에서 다시 정한다.
 *
 * 안전 제한: http·https 만, 리디렉션은 직접 따라가며 매번 scheme 확인(최대 5회), 크기 상한 100MB(Content-Length·실제 바이트 둘 다),
 * 시간 제한 60초(전체). 관리 앱은 내부망에서만 쓰므로 사설 주소 차단은 두지 않는다(내부 문서 서버도 원본일 수 있다).
 */
import type { Queryable } from './db';
import { documentKey, getDocument, safeFilename, sha256Hex, sniffMime, type DocumentRow } from './documents';
import { DomainError } from './errors';
import type { FetchLike } from './external-api';
import type { ObjectStore } from './storage';

export interface RefetchLimits {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
}

export const REFETCH_LIMITS: RefetchLimits = { maxBytes: 100 * 1024 * 1024, timeoutMs: 60_000, maxRedirects: 5 };

export interface RefetchOptions {
  author_id: string | null;
  fetchImpl?: FetchLike;
  limits?: Partial<RefetchLimits>;
}

export interface RefetchResult {
  changed: boolean;
  document: DocumentRow;
  previous_document_id: string | null;
  sha256: string;
  size_bytes: number;
}

const fail = (message: string, rule = 'refetch') =>
  new DomainError('validation', message, { violations: [{ rule, path: 'origin_url', message }] });

function checkScheme(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw fail(`origin_url 형식 오류: ${raw}`, 'refetch.url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    throw fail(`http·https 만 받을 수 있음(${u.protocol})`, 'refetch.scheme');
  return u;
}

/** 크기 상한을 지키며 본문 읽기 */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw fail(`파일이 너무 큼(${declared} 바이트 > ${maxBytes})`, 'refetch.size');
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw fail(`파일이 너무 큼(> ${maxBytes} 바이트)`, 'refetch.size');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** URL 내려받기(리디렉션 수동 추적) */
export async function fetchOrigin(
  url: string,
  opts: { fetchImpl?: FetchLike; limits?: Partial<RefetchLimits> } = {},
): Promise<{ buffer: Buffer; contentType: string | null; finalUrl: string; filename: string | null }> {
  const limits = { ...REFETCH_LIMITS, ...opts.limits };
  const doFetch = opts.fetchImpl ?? ((u: string, i: RequestInit) => fetch(u, i));
  const signal = AbortSignal.timeout(limits.timeoutMs);
  let current = checkScheme(url);
  try {
    for (let hop = 0; ; hop++) {
      const res = await doFetch(current.toString(), {
        redirect: 'manual',
        signal,
        headers: { 'user-agent': 'k-raildex-admin/1 (document refetch)' },
      });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => {});
        const loc = res.headers.get('location');
        if (!loc) throw fail(`리디렉션(${res.status})에 Location 이 없음`, 'refetch.http');
        if (hop >= limits.maxRedirects) throw fail(`리디렉션이 ${limits.maxRedirects}회를 넘음`, 'refetch.redirect');
        current = checkScheme(new URL(loc, current).toString());
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw fail(`원본 서버 응답 ${res.status}`, 'refetch.http');
      }
      const buffer = await readCapped(res, limits.maxBytes);
      const cd = res.headers.get('content-disposition') ?? '';
      const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) ?? /filename="?([^";]+)"?/i.exec(cd);
      let filename: string | null = null;
      if (m) {
        try {
          filename = decodeURIComponent(m[1]!);
        } catch {
          filename = m[1]!;
        }
      }
      return {
        buffer,
        contentType: res.headers.get('content-type')?.split(';')[0]?.trim() || null,
        finalUrl: current.toString(),
        filename,
      };
    }
  } catch (e) {
    if (e instanceof DomainError) throw e;
    const err = e as { name?: string; message?: string };
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError')
      throw fail(`시간 초과(${limits.timeoutMs / 1000}초)`, 'refetch.timeout');
    throw fail(`내려받기 실패: ${err?.message ?? String(e)}`, 'refetch.http');
  }
}

/** db 는 전용 연결(트랜잭션을 연다) */
export async function refetchDocument(
  db: Queryable,
  store: ObjectStore,
  id: string,
  opts: RefetchOptions,
): Promise<RefetchResult> {
  const old = await getDocument(db, id);
  if (old.kind !== 'original' && old.kind !== 'upload')
    throw fail(`원본·업로드 문서만 다시 받을 수 있음(${old.kind})`, 'refetch.kind');
  if (!old.origin_url) throw fail('origin_url 이 없는 문서', 'refetch.url');
  const got = await fetchOrigin(old.origin_url, opts);
  const sha = sha256Hex(got.buffer);
  if (sha === old.sha256) {
    await db.query(
      `UPDATE document SET retrieved_at = now(),
              meta = meta || jsonb_build_object('last_refetch', jsonb_build_object('at', now(), 'changed', false))
        WHERE id = $1`,
      [id],
    );
    return {
      changed: false,
      document: await getDocument(db, id),
      previous_document_id: null,
      sha256: sha,
      size_bytes: got.buffer.length,
    };
  }
  const filename = safeFilename(old.filename || got.filename || 'file');
  const mime = sniffMime(got.buffer, filename, got.contentType);
  const key = documentKey(sha, filename);
  if (!(await store.head(key))) await store.put(key, got.buffer, mime);
  await db.query('BEGIN');
  let newId: string;
  try {
    const meta: Record<string, unknown> = {
      previous_document_id: old.id,
      refetched_from: got.finalUrl,
    };
    if (old.title) meta.title = old.title;
    const r = await db.query<{ id: string }>(
      `INSERT INTO document (storage_key, filename, mime, size_bytes, sha256, origin_url, retrieved_at, kind,
                             license_class, publishable, meta, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, now(), 'original', $7, false, $8, $9)
       ON CONFLICT (storage_key) DO NOTHING RETURNING id`,
      [key, filename, mime, got.buffer.length, sha, old.origin_url, old.license_class, meta, opts.author_id],
    );
    if (r.rows[0]) newId = r.rows[0].id;
    else {
      // 같은 내용의 판이 이미 있다(내용이 예전 판으로 되돌아감) — 그 행을 쓴다
      const ex = await db.query<{ id: string }>(
        `UPDATE document SET deleted_at = NULL, retrieved_at = now() WHERE storage_key = $1 RETURNING id`,
        [key],
      );
      newId = ex.rows[0]!.id;
    }
    await db.query(
      `INSERT INTO source_document (source_id, document_id, role)
       SELECT source_id, $2, role FROM source_document WHERE document_id = $1 ON CONFLICT DO NOTHING`,
      [old.id, newId],
    );
    await db.query(
      `UPDATE document SET meta = meta || jsonb_build_object('last_refetch',
              jsonb_build_object('at', now(), 'changed', true, 'next_document_id', $2::text))
        WHERE id = $1`,
      [old.id, newId],
    );
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  }
  return {
    changed: true,
    document: await getDocument(db, newId),
    previous_document_id: old.id,
    sha256: sha,
    size_bytes: got.buffer.length,
  };
}
