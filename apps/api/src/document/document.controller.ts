/**
 * 원문 문서(docs/04-api.md 4-3절, docs/03-data-model.md 4-3절). 문서 행은 파일 메타데이터라 변경 묶음 대신
 * 도메인 documents.ts 의 트랜잭션 SQL 로 쓴다(작성자 = 요청 주체). 공개 규칙 위반(DB CHECK·트리거)은 422.
 * 쪽 이미지·텍스트 추출은 작업 큐(worker), 그림 잘라 내기는 동기(sharp).
 */
import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { codes } from '@k-raildex/contracts';
import {
  cropFigure,
  DomainError,
  getDocument,
  getPageImage,
  JOB,
  listDocuments,
  listPageImages,
  updateDocument,
  uploadDocument,
  type JobQueue,
  type ObjectStore,
} from '@k-raildex/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentPrincipal, RequireScope, type Principal } from '../auth/principal';
import { ApiError } from '../common/errors';
import { boolParam, limitParam, offsetParam } from '../common/http';
import { DbService } from '../db/db.service';
import { sharpCropper } from '../storage/cropper';
import { JOB_QUEUE, OBJECT_STORE } from '../tokens';

type Q = Record<string, string | undefined>;

const licenseClass = z.enum(codes.licenseClass.values);
const uploadFieldsSchema = z
  .object({
    kind: z.enum(['upload', 'original']).default('upload'),
    license_class: licenseClass,
    source_id: z.string().min(1).optional(),
    origin_url: z.string().url().optional(),
    title: z.string().min(1).optional(),
  })
  .strict();

const listSchema = z.object({
  q: z.string().optional(),
  source_id: z.string().optional(),
  kind: z.enum(codes.documentKind.values).optional(),
  parent: z.union([z.literal('none'), z.uuid()]).optional(),
  include_deleted: boolParam,
  limit: limitParam,
  offset: offsetParam,
});

const patchSchema = z
  .object({
    license_class: licenseClass.optional(),
    publishable: z.boolean().optional(),
    title: z.string().min(1).nullable().optional(),
    origin_url: z.string().url().nullable().optional(),
  })
  .strict();

const cropSchema = z
  .object({
    page: z.number().int().min(1),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    title: z.string().min(1).optional(),
  })
  .strict();

/** RFC 6266/5987: 한글 파일 이름 */
export function contentDisposition(kind: 'attachment' | 'inline', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

@Controller('v1/admin/documents')
export class DocumentController {
  constructor(
    @Inject(DbService) private readonly dbs: DbService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
  ) {}

  @Post()
  @RequireScope('admin:write')
  async upload(
    @Req() req: FastifyRequest,
    @CurrentPrincipal() p: Principal,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!req.isMultipart()) throw new ApiError(415, 'unsupported_media_type', 'multipart/form-data 로 보낼 것');
    const fields: Record<string, string> = {};
    let file: { buffer: Buffer; filename: string; mimetype: string } | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file' || file) {
          await part.toBuffer();
          throw new ApiError(400, 'bad_request', `파일은 file 필드 하나만(${part.fieldname})`);
        }
        file = { buffer: await part.toBuffer(), filename: part.filename, mimetype: part.mimetype };
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
    if (!file || !file.buffer.length) throw new ApiError(400, 'bad_request', 'file 필드(빈 파일 아님)가 필요함');
    const input = uploadFieldsSchema.parse(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== '')));
    const f = file;
    const r = await this.dbs.withClient((c) =>
      uploadDocument(c, this.store, {
        buffer: f.buffer,
        filename: f.filename,
        mime: f.mimetype,
        kind: input.kind,
        license_class: input.license_class,
        source_id: input.source_id,
        origin_url: input.origin_url,
        title: input.title,
        author_id: p.userId,
      }),
    );
    void reply.status(r.created ? 201 : 200);
    return { ...r.document, deduplicated: !r.created };
  }

  @Get()
  @RequireScope('admin:read')
  async list(@Query() query: Q) {
    return listDocuments(this.dbs.db, listSchema.parse(query));
  }

  @Get(':id')
  @RequireScope('admin:read')
  async get(@Param('id') id: string, @Query('include_text') includeText: string | undefined) {
    return getDocument(this.dbs.db, id, { includeText: boolParam.parse(includeText) });
  }

  @Get(':id/download')
  @RequireScope('admin:read')
  async download(
    @Param('id') id: string,
    @Query('disposition') disposition: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const doc = await getDocument(this.dbs.db, id);
    const stream = await this.store.getStream(doc.storage_key);
    return reply
      .type(doc.mime)
      .header('content-length', String(doc.size_bytes))
      .header(
        'content-disposition',
        contentDisposition(disposition === 'inline' ? 'inline' : 'attachment', doc.filename),
      )
      .header('cache-control', 'private, max-age=0')
      .send(stream);
  }

  @Patch(':id')
  @RequireScope('admin:write')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const patch = patchSchema.parse(body ?? {});
    return this.dbs.withClient((c) => updateDocument(c, id, patch));
  }

  @Post(':id/extract-text')
  @HttpCode(202)
  @RequireScope('admin:write')
  async extractText(@Param('id') id: string) {
    const doc = await getDocument(this.dbs.db, id);
    this.requirePdf(doc.mime);
    const jobId = await this.jobs.send(JOB.docTextExtract, { document_id: id });
    return { document_id: id, job: JOB.docTextExtract, job_id: jobId };
  }

  @Post(':id/pages')
  @HttpCode(202)
  @RequireScope('admin:write')
  async pages(@Param('id') id: string, @Body() body: unknown) {
    const input = z
      .object({ force: z.boolean().optional() })
      .strict()
      .nullish()
      .parse(body ?? null);
    const doc = await getDocument(this.dbs.db, id);
    this.requirePdf(doc.mime);
    const jobId = await this.jobs.send(JOB.docPageImages, { document_id: id, force: input?.force ?? false });
    return { document_id: id, job: JOB.docPageImages, job_id: jobId };
  }

  @Get(':id/pages')
  @RequireScope('admin:read')
  async listPages(@Param('id') id: string) {
    const doc = await getDocument(this.dbs.db, id);
    const items = await listPageImages(this.dbs.db, id);
    return { document_id: id, pages: doc.pages, items, total: items.length };
  }

  @Get(':id/pages/:n/image')
  @RequireScope('admin:read')
  async pageImage(@Param('id') id: string, @Param('n') n: string, @Res() reply: FastifyReply) {
    const page = z.coerce.number().int().min(1).parse(n);
    await getDocument(this.dbs.db, id);
    const img = await getPageImage(this.dbs.db, id, page);
    if (!img) throw new DomainError('not_found', `${page}쪽 이미지가 아직 없음(POST /pages 로 생성)`);
    const stream = await this.store.getStream(img.storage_key);
    return reply
      .type('image/png')
      .header('content-length', String(img.size_bytes))
      .header('content-disposition', contentDisposition('inline', img.filename))
      .header('cache-control', 'private, max-age=3600')
      .send(stream);
  }

  @Post(':id/crop')
  @RequireScope('admin:write')
  async crop(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = cropSchema.parse(body ?? {});
    const r = await this.dbs.withClient((c) =>
      cropFigure(c, this.store, sharpCropper, {
        document_id: id,
        page: input.page,
        bbox: input.bbox,
        title: input.title,
        author_id: p.userId,
      }),
    );
    void reply.status(r.created ? 201 : 200);
    return { ...r.document, deduplicated: !r.created };
  }

  private requirePdf(mime: string): void {
    if (mime !== 'application/pdf')
      throw new DomainError('validation', `PDF 만 처리할 수 있음(${mime})`, {
        violations: [{ rule: 'mime', path: 'mime', message: 'application/pdf 만 지원' }],
      });
  }
}
