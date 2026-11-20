/**
 * 원문 문서(document) — 파일 메타데이터(개체 아님, docs/03-data-model.md 4-3절).
 * 문서 행은 변경 묶음을 거치지 않고 트랜잭션 안의 직접 SQL 로 쓴다(작성자 = created_by). 사실(개체) 변경이 아니라
 * 파일 보관이기 때문이다. 공개 규칙(publishable·라이선스)은 DB CHECK·트리거가 강제하고, 위반은 DomainError validation(422).
 *
 * 저장 키: 업로드·원본 `docs/<sha256[0:2]>/<sha256>/<파일명>`, 파생(쪽 이미지·잘라 낸 그림) `derived/<원본 id>/<이름>`.
 * PDF 처리는 poppler(pdftotext·pdftoppm·pdfinfo)를 부른다. 이미지 잘라 내기는 앱이 넘겨 주는 cropper(sharp)를 쓴다.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { codes, type Code } from '@k-raildex/contracts';
import type { Queryable } from './db';
import { DomainError } from './errors';
import type { ObjectStore } from './storage';

const run = promisify(execFile);

type AnyObject = Record<string, unknown>;

export type Bbox = [number, number, number, number];

export interface DocumentRow {
  id: string;
  storage_key: string;
  filename: string;
  title: string | null;
  mime: string;
  size_bytes: number;
  sha256: string;
  origin_url: string | null;
  retrieved_at: string | null;
  kind: Code<'documentKind'>;
  parent_document_id: string | null;
  page: number | null;
  bbox: number[] | null;
  license_class: Code<'licenseClass'>;
  publishable: boolean;
  pages: number | null;
  has_text: boolean;
  text_content?: string | null;
  meta: AnyObject;
  source_ids: string[];
  created_at: string;
  created_by: string | null;
  deleted_at: string | null;
}

/** 쪽 이미지 해상도(dpi) */
export const PAGE_IMAGE_DPI = 110;

const SELECT_COLS = `d.id, d.storage_key, d.filename, d.meta->>'title' AS title, d.mime, d.size_bytes, d.sha256, d.origin_url,
  d.retrieved_at, d.kind, d.parent_document_id, d.page, d.bbox, d.license_class, d.publishable, d.pages,
  d.text_content IS NOT NULL AS has_text, d.meta, d.created_at, d.created_by, d.deleted_at,
  coalesce((SELECT array_agg(sd.source_id ORDER BY sd.source_id) FROM source_document sd WHERE sd.document_id = d.id), '{}') AS source_ids`;

function shape(r: AnyObject, withText = false): DocumentRow {
  const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
  const out: DocumentRow = {
    id: String(r.id),
    storage_key: String(r.storage_key),
    filename: String(r.filename),
    title: (r.title as string | null) ?? null,
    mime: String(r.mime),
    size_bytes: Number(r.size_bytes),
    sha256: String(r.sha256),
    origin_url: (r.origin_url as string | null) ?? null,
    retrieved_at: iso(r.retrieved_at),
    kind: r.kind as Code<'documentKind'>,
    parent_document_id: (r.parent_document_id as string | null) ?? null,
    page: (r.page as number | null) ?? null,
    bbox: Array.isArray(r.bbox) ? (r.bbox as unknown[]).map(Number) : null,
    license_class: r.license_class as Code<'licenseClass'>,
    publishable: Boolean(r.publishable),
    pages: (r.pages as number | null) ?? null,
    has_text: Boolean(r.has_text),
    meta: (r.meta as AnyObject) ?? {},
    source_ids: (r.source_ids as string[]) ?? [],
    created_at: iso(r.created_at)!,
    created_by: (r.created_by as string | null) ?? null,
    deleted_at: iso(r.deleted_at),
  };
  if (withText) out.text_content = (r.text_content as string | null) ?? null;
  return out;
}

// ---------------------------------------------------------------------------
// 도우미
// ---------------------------------------------------------------------------

export const sha256Hex = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

/** 저장 키에 쓸 파일 이름: 경로 구분자·제어 문자 제거, 200자 이내 */
export function safeFilename(name: string): string {
  const base = [...name.replace(/[\\/]/g, '_')]
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)
    .join('')
    .trim();
  return (base || 'file').slice(-200);
}

export function documentKey(sha: string, filename: string): string {
  return `docs/${sha.slice(0, 2)}/${sha}/${safeFilename(filename)}`;
}

export function derivedKey(parentId: string, name: string): string {
  return `derived/${parentId}/${safeFilename(name)}`;
}

/** 선언된 MIME 이 비었거나 octet-stream 이면 내용·확장자로 추정 */
export function sniffMime(buf: Buffer, filename: string, declared?: string | null): string {
  if (declared && declared !== 'application/octet-stream') return declared;
  const head = buf.subarray(0, 8);
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const byExt: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    xml: 'application/xml',
    hwp: 'application/x-hwp',
    hwpx: 'application/haansofthwpx',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    zip: 'application/zip',
  };
  return byExt[ext] ?? 'application/octet-stream';
}

/** pg 오류(CHECK·FK·트리거 RAISE) → DomainError validation */
function toDomainError(e: unknown, path = ''): unknown {
  const pg = e as { code?: string; message?: string; constraint?: string };
  if (pg && typeof pg.code === 'string' && /^(23|P0)/.test(pg.code)) {
    return new DomainError('validation', '문서 규칙 위반', {
      violations: [{ rule: pg.constraint ?? 'db', path, message: pg.message ?? String(e) }],
    });
  }
  return e;
}

async function tx<T>(db: Queryable, fn: () => Promise<T>): Promise<T> {
  await db.query('BEGIN');
  try {
    const r = await fn();
    await db.query('COMMIT');
    return r;
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw toDomainError(e);
  }
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'krdx-doc-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function assertBbox(bbox: unknown): asserts bbox is Bbox {
  const ok =
    Array.isArray(bbox) &&
    bbox.length === 4 &&
    bbox.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) &&
    bbox[0] < bbox[2] &&
    bbox[1] < bbox[3];
  if (!ok)
    throw new DomainError('validation', 'bbox 형식 오류', {
      violations: [{ rule: 'schema', path: 'bbox', message: '[x0, y0, x1, y1], 0~1 비율, x0<x1·y0<y1' }],
    });
}

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

export interface DocumentListQuery {
  q?: string;
  source_id?: string;
  kind?: string;
  /** uuid = 그 문서의 파생 문서, 'none' = 원본(최상위)만 */
  parent?: string;
  include_deleted?: boolean;
  limit: number;
  offset: number;
}

export async function listDocuments(
  db: Queryable,
  q: DocumentListQuery,
): Promise<{ items: DocumentRow[]; total: number; limit: number; offset: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;
  if (!q.include_deleted) where.push('d.deleted_at IS NULL');
  if (q.q) {
    const v = p(`%${q.q}%`);
    where.push(`(d.filename ILIKE ${v} OR d.meta->>'title' ILIKE ${v})`);
  }
  if (q.kind) where.push(`d.kind = ${p(q.kind)}`);
  if (q.source_id)
    where.push(
      `EXISTS (SELECT 1 FROM source_document sd WHERE sd.document_id = d.id AND sd.source_id = ${p(q.source_id)})`,
    );
  if (q.parent === 'none') where.push('d.parent_document_id IS NULL');
  else if (q.parent) where.push(`d.parent_document_id = ${p(q.parent)}`);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM document d ${w}`, params);
  const { rows } = await db.query(
    `SELECT ${SELECT_COLS} FROM document d ${w}
      ORDER BY d.created_at DESC, d.page NULLS FIRST, d.id LIMIT ${p(q.limit)} OFFSET ${p(q.offset)}`,
    params,
  );
  return {
    items: rows.map((r) => shape(r as AnyObject)),
    total: total.rows[0]?.n ?? 0,
    limit: q.limit,
    offset: q.offset,
  };
}

export async function getDocument(
  db: Queryable,
  id: string,
  opts: { includeText?: boolean; includeDeleted?: boolean } = {},
): Promise<DocumentRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError('not_found', `문서 ${id} 가 없음`);
  const { rows } = await db.query(
    `SELECT ${SELECT_COLS}${opts.includeText ? ', d.text_content' : ''} FROM document d
      WHERE d.id = $1${opts.includeDeleted ? '' : ' AND d.deleted_at IS NULL'}`,
    [id],
  );
  if (!rows[0]) throw new DomainError('not_found', `문서 ${id} 가 없음`);
  return shape(rows[0] as AnyObject, opts.includeText);
}

// ---------------------------------------------------------------------------
// 업로드
// ---------------------------------------------------------------------------

export interface UploadInput {
  buffer: Buffer;
  filename: string;
  mime?: string | null;
  kind?: 'upload' | 'original';
  license_class: Code<'licenseClass'>;
  source_id?: string | null;
  origin_url?: string | null;
  title?: string | null;
  author_id: string | null;
}

/** 업로드: sha256 이 같은 원본·업로드 문서가 있으면 그것을 돌려준다(출처 연결만 보탠다) */
export async function uploadDocument(
  db: Queryable,
  store: ObjectStore,
  input: UploadInput,
): Promise<{ document: DocumentRow; created: boolean }> {
  if (!(codes.licenseClass.values as readonly string[]).includes(input.license_class))
    throw new DomainError('validation', 'license_class 값 오류', {
      violations: [{ rule: 'schema', path: 'license_class', message: codes.licenseClass.values.join('|') }],
    });
  const sha = sha256Hex(input.buffer);
  const filename = safeFilename(input.filename);
  const mime = sniffMime(input.buffer, filename, input.mime);
  const linkSource = async (docId: string) => {
    if (!input.source_id) return;
    await db.query(
      `INSERT INTO source_document (source_id, document_id, role) VALUES ($1, $2, 'original') ON CONFLICT DO NOTHING`,
      [input.source_id, docId],
    );
  };
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM document WHERE sha256 = $1 AND kind IN ('upload', 'original') AND deleted_at IS NULL
      ORDER BY created_at LIMIT 1`,
    [sha],
  );
  if (existing.rows[0]) {
    const id = existing.rows[0].id;
    await tx(db, () => linkSource(id));
    return { document: await getDocument(db, id), created: false };
  }
  const key = documentKey(sha, filename);
  // 저장소 먼저(같은 내용이면 같은 키라 고아 객체가 생겨도 해가 없다), 그다음 행
  if (!(await store.head(key))) await store.put(key, input.buffer, mime);
  const id = await tx(db, async () => {
    const meta: AnyObject = {};
    if (input.title) meta.title = input.title;
    const r = await db.query<{ id: string }>(
      `INSERT INTO document (storage_key, filename, mime, size_bytes, sha256, origin_url, retrieved_at, kind, license_class, meta, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6::text IS NULL THEN NULL ELSE now() END, $7, $8, $9, $10)
       ON CONFLICT (storage_key) DO NOTHING RETURNING id`,
      [
        key,
        filename,
        mime,
        input.buffer.length,
        sha,
        input.origin_url ?? null,
        input.kind ?? 'upload',
        input.license_class,
        meta,
        input.author_id,
      ],
    );
    let docId = r.rows[0]?.id;
    if (!docId) {
      // 같은 키의 (삭제된) 행 — 되살린다
      const old = await db.query<{ id: string }>(
        `UPDATE document SET deleted_at = NULL, license_class = $2 WHERE storage_key = $1 RETURNING id`,
        [key, input.license_class],
      );
      docId = old.rows[0]!.id;
    }
    await linkSource(docId);
    return docId;
  });
  return { document: await getDocument(db, id), created: true };
}

// ---------------------------------------------------------------------------
// 수정
// ---------------------------------------------------------------------------

export interface DocumentPatch {
  license_class?: Code<'licenseClass'>;
  publishable?: boolean;
  title?: string | null;
  origin_url?: string | null;
}

export async function updateDocument(db: Queryable, id: string, patch: DocumentPatch): Promise<DocumentRow> {
  await getDocument(db, id);
  const sets: string[] = [];
  const params: unknown[] = [id];
  const p = (v: unknown) => `$${params.push(v)}`;
  if (patch.license_class !== undefined) sets.push(`license_class = ${p(patch.license_class)}`);
  if (patch.publishable !== undefined) sets.push(`publishable = ${p(patch.publishable)}`);
  if (patch.origin_url !== undefined) sets.push(`origin_url = ${p(patch.origin_url)}`);
  if (patch.title !== undefined)
    sets.push(
      patch.title === null
        ? `meta = meta - 'title'`
        : `meta = jsonb_set(meta, '{title}', to_jsonb(${p(patch.title)}::text))`,
    );
  if (sets.length) {
    await tx(db, async () => {
      await db.query(`UPDATE document SET ${sets.join(', ')} WHERE id = $1`, params);
      // 라이선스를 바꾸면 파생 문서(쪽 이미지·잘라 낸 그림·추출 텍스트)도 따라간다(공개 여부는 각자)
      if (patch.license_class !== undefined)
        await db.query(
          `UPDATE document SET license_class = $2, publishable = publishable AND $2 IN ('public_work','kogl_1','kogl_2','kogl_3','kogl_4','open')
            WHERE parent_document_id = $1`,
          [id, patch.license_class],
        );
    });
  }
  return getDocument(db, id);
}

// ---------------------------------------------------------------------------
// PDF 처리(poppler)
// ---------------------------------------------------------------------------

async function loadPdf(db: Queryable, store: ObjectStore, id: string): Promise<{ doc: DocumentRow; pdf: Buffer }> {
  const doc = await getDocument(db, id);
  if (doc.mime !== 'application/pdf')
    throw new DomainError('validation', `PDF 만 처리할 수 있음(${doc.mime})`, {
      violations: [{ rule: 'mime', path: 'mime', message: 'application/pdf 만 지원(HWP·HWPX·xlsx 는 후순위)' }],
    });
  return { doc, pdf: await store.getBuffer(doc.storage_key) };
}

async function pdfPageCount(file: string): Promise<number | null> {
  try {
    const { stdout } = await run('pdfinfo', [file]);
    const m = /^Pages:\s+(\d+)/m.exec(stdout);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** 텍스트 추출(pdftotext -layout) → 원본 행의 text_content·text_tsv·pages */
export async function extractDocumentText(
  db: Queryable,
  store: ObjectStore,
  id: string,
): Promise<{ document_id: string; chars: number; pages: number | null }> {
  const { pdf } = await loadPdf(db, store, id);
  return withTempDir(async (dir) => {
    const inFile = join(dir, 'in.pdf');
    const outFile = join(dir, 'out.txt');
    await writeFile(inFile, pdf);
    await run('pdftotext', ['-layout', '-enc', 'UTF-8', inFile, outFile]);
    const text = (await readFile(outFile, 'utf8')).replaceAll('\u0000', '');
    const pages = (await pdfPageCount(inFile)) ?? (text.split('\f').length - 1 || null);
    await db.query(
      `UPDATE document SET text_content = $2, text_tsv = to_tsvector('simple', $2), pages = coalesce($3, pages),
              meta = meta || jsonb_build_object('text_extract', jsonb_build_object('method', 'pdftotext -layout', 'at', now()))
        WHERE id = $1`,
      [id, text, pages],
    );
    return { document_id: id, chars: text.length, pages };
  });
}

export interface PageImage {
  page: number;
  document: DocumentRow;
}

/** 이미 만든 쪽 이미지(쪽 순) */
export async function listPageImages(db: Queryable, id: string): Promise<DocumentRow[]> {
  await getDocument(db, id);
  const { rows } = await db.query(
    `SELECT ${SELECT_COLS} FROM document d
      WHERE d.parent_document_id = $1 AND d.kind = 'page_image' AND d.deleted_at IS NULL ORDER BY d.page`,
    [id],
  );
  return rows.map((r) => shape(r as AnyObject));
}

export async function getPageImage(db: Queryable, id: string, page: number): Promise<DocumentRow | null> {
  const { rows } = await db.query(
    `SELECT ${SELECT_COLS} FROM document d
      WHERE d.parent_document_id = $1 AND d.kind = 'page_image' AND d.page = $2 AND d.deleted_at IS NULL
      ORDER BY d.created_at DESC LIMIT 1`,
    [id, page],
  );
  return rows[0] ? shape(rows[0] as AnyObject) : null;
}

async function storePageImage(
  db: Queryable,
  store: ObjectStore,
  parent: DocumentRow,
  page: number,
  png: Buffer,
): Promise<DocumentRow> {
  const key = derivedKey(parent.id, `page-${String(page).padStart(4, '0')}.png`);
  await store.put(key, png, 'image/png');
  const base = parent.filename.replace(/\.[^.]+$/, '');
  const filename = `${base}-p${String(page).padStart(3, '0')}.png`;
  const r = await db.query<{ id: string }>(
    `INSERT INTO document (storage_key, filename, mime, size_bytes, sha256, kind, parent_document_id, page, license_class, meta, created_by)
     VALUES ($1, $2, 'image/png', $3, $4, 'page_image', $5, $6, $7, $8, $9)
     ON CONFLICT (storage_key) DO UPDATE SET size_bytes = EXCLUDED.size_bytes, sha256 = EXCLUDED.sha256,
            meta = EXCLUDED.meta, deleted_at = NULL
     RETURNING id`,
    [
      key,
      filename,
      png.length,
      sha256Hex(png),
      parent.id,
      page,
      parent.license_class,
      { dpi: PAGE_IMAGE_DPI, method: `pdftoppm -r ${PAGE_IMAGE_DPI}` },
      parent.created_by,
    ],
  );
  return getDocument(db, r.rows[0]!.id);
}

/**
 * 쪽 이미지 만들기(pdftoppm -r 110 -png). 이미 있는 쪽은 건너뛴다(force 면 다시).
 * pages 를 주면 그 쪽만.
 */
export async function renderPageImages(
  db: Queryable,
  store: ObjectStore,
  id: string,
  opts: { force?: boolean; pages?: number[] } = {},
): Promise<{ document_id: string; pages: number | null; created: number[]; skipped: number[] }> {
  const { doc, pdf } = await loadPdf(db, store, id);
  const existing = new Set((await listPageImages(db, id)).map((d) => d.page!));
  return withTempDir(async (dir) => {
    const inFile = join(dir, 'in.pdf');
    await writeFile(inFile, pdf);
    const total = await pdfPageCount(inFile);
    if (total != null && doc.pages !== total)
      await db.query(`UPDATE document SET pages = $2 WHERE id = $1`, [id, total]);
    const wanted = opts.pages ?? (total ? Array.from({ length: total }, (_, i) => i + 1) : []);
    const todo = wanted.filter((n) => opts.force || !existing.has(n)).filter((n) => !total || (n >= 1 && n <= total));
    const created: number[] = [];
    if (opts.pages && opts.pages.some((n) => total != null && (n < 1 || n > total)))
      throw new DomainError('validation', `쪽 번호 범위 밖(1~${String(total)})`);
    if (todo.length) {
      const first = Math.min(...todo);
      const last = Math.max(...todo);
      const prefix = join(dir, 'p');
      await run('pdftoppm', [
        '-r',
        String(PAGE_IMAGE_DPI),
        '-png',
        '-f',
        String(first),
        '-l',
        String(last),
        inFile,
        prefix,
      ]);
      const files = (await readdir(dir)).filter((f) => /^p-\d+\.png$/.test(f));
      for (const f of files) {
        const n = Number(/^p-(\d+)\.png$/.exec(f)![1]);
        if (!todo.includes(n)) continue;
        await storePageImage(db, store, doc, n, await readFile(join(dir, f)));
        created.push(n);
      }
    }
    created.sort((a, b) => a - b);
    return {
      document_id: id,
      pages: total,
      created,
      skipped: wanted.filter((n) => !created.includes(n)),
    };
  });
}

/** 이미지 잘라 내기(앱이 sharp 로 구현). bbox 는 0~1 비율 */
export type ImageCropper = (png: Buffer, bbox: Bbox) => Promise<{ data: Buffer; width: number; height: number }>;

export interface CropInput {
  document_id: string;
  page: number;
  bbox: Bbox;
  title?: string | null;
  author_id: string | null;
}

/**
 * 그림 잘라 내기 → 파생 문서 figure_crop(parent = 원본, page, bbox). 쪽 이미지가 없으면 그 쪽만 먼저 만든다.
 * 같은 원본·쪽·bbox 가 이미 있으면 그것을 돌려준다.
 */
export async function cropFigure(
  db: Queryable,
  store: ObjectStore,
  cropper: ImageCropper,
  input: CropInput,
): Promise<{ document: DocumentRow; created: boolean }> {
  assertBbox(input.bbox);
  if (!Number.isInteger(input.page) || input.page < 1)
    throw new DomainError('validation', 'page 는 1 이상 정수', {
      violations: [{ rule: 'schema', path: 'page', message: '1 이상 정수' }],
    });
  const parent = await getDocument(db, input.document_id);
  if (parent.kind === 'page_image' || parent.kind === 'figure_crop')
    throw new DomainError('validation', '원본 문서에서 잘라 내야 함(쪽 이미지·그림이 아님)');
  const bbox = input.bbox.map((v) => Math.round(v * 10000) / 10000) as Bbox;
  const dup = await db.query<{ id: string }>(
    `SELECT id FROM document WHERE parent_document_id = $1 AND kind = 'figure_crop' AND page = $2 AND bbox = $3::numeric[]
        AND deleted_at IS NULL LIMIT 1`,
    [parent.id, input.page, bbox],
  );
  if (dup.rows[0]) return { document: await getDocument(db, dup.rows[0].id), created: false };
  let pageImage = await getPageImage(db, parent.id, input.page);
  if (!pageImage) {
    await renderPageImages(db, store, parent.id, { pages: [input.page] });
    pageImage = await getPageImage(db, parent.id, input.page);
    if (!pageImage) throw new DomainError('not_found', `${input.page}쪽 이미지를 만들 수 없음`);
  }
  const png = await store.getBuffer(pageImage.storage_key);
  const out = await cropper(png, bbox);
  const sha = sha256Hex(out.data);
  const key = derivedKey(parent.id, `crop-p${input.page}-${sha.slice(0, 16)}.png`);
  await store.put(key, out.data, 'image/png');
  const base = parent.filename.replace(/\.[^.]+$/, '');
  const meta: AnyObject = { page_image_id: pageImage.id, width: out.width, height: out.height };
  if (input.title) meta.title = input.title;
  const id = await tx(db, async () => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO document (storage_key, filename, mime, size_bytes, sha256, kind, parent_document_id, page, bbox, license_class, meta, created_by)
       VALUES ($1, $2, 'image/png', $3, $4, 'figure_crop', $5, $6, $7, $8, $9, $10)
       ON CONFLICT (storage_key) DO UPDATE SET deleted_at = NULL RETURNING id`,
      [
        key,
        `${base}-p${input.page}-crop.png`,
        out.data.length,
        sha,
        parent.id,
        input.page,
        bbox,
        parent.license_class,
        meta,
        input.author_id,
      ],
    );
    return r.rows[0]!.id;
  });
  return { document: await getDocument(db, id), created: true };
}
