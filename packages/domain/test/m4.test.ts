/** M4 도메인: 문서·첨부·품질·지도·되돌리기·일부 승인 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { freshDb, type FreshDb } from '@k-raildex/db/testing';
import {
  applyChangeset,
  approveDraft,
  createAttachment,
  cropFigure,
  deleteAttachment,
  DomainError,
  ensureServiceUser,
  extractDocumentText,
  fixtureOps,
  getDocument,
  listAttachments,
  listDocuments,
  listPageImages,
  mapAtLines,
  mapAtStations,
  mapTimeline,
  mergePreview,
  MemoryObjectStore,
  qualityItems,
  qualitySummary,
  reviewList,
  QUALITY_GUIDES,
  readEntity,
  renderPageImages,
  revertChangeset,
  submitDraft,
  updateAttachment,
  updateDocument,
  uploadDocument,
  type ImageCropper,
  type Op,
} from '../src';
import { makePdf } from './pdf';

let fx: FreshDb;
let db: pg.Client;
let author: string;
const store = new MemoryObjectStore();
const SRC = [{ source_id: 'src-fixture-notice' }];

const apply = (ops: Op[], title = '시험') =>
  applyChangeset(db, { title, origin: 'admin_edit', author_id: author, ops });

async function domainError(p: Promise<unknown>, code: string): Promise<DomainError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe(code);
    return e as DomainError;
  }
  throw new Error(`DomainError(${code}) 를 기대했으나 성공함`);
}

beforeAll(async () => {
  fx = await freshDb();
  db = fx.client;
  author = await ensureServiceUser(db, 'system', 'test');
  await applyChangeset(db, { title: '픽스처', origin: 'legacy_migration', author_id: author, ops: fixtureOps() });
});
afterAll(async () => fx?.close());

describe('문서', () => {
  let docId: string;

  it('업로드·중복·출처 연결·목록', async () => {
    const pdf = makePdf(['Hello page one', 'Second page']);
    const r = await uploadDocument(db, store, {
      buffer: pdf,
      filename: '시험 고시.pdf',
      mime: 'application/octet-stream',
      license_class: 'public_work',
      source_id: 'src-fixture-notice',
      title: '시험 고시문',
      author_id: author,
    });
    expect(r.created).toBe(true);
    expect(r.document).toMatchObject({ mime: 'application/pdf', kind: 'upload', title: '시험 고시문' });
    expect(r.document.storage_key).toBe(`docs/${r.document.sha256.slice(0, 2)}/${r.document.sha256}/시험 고시.pdf`);
    expect(r.document.source_ids).toEqual(['src-fixture-notice']);
    expect(store.objects.has(r.document.storage_key)).toBe(true);
    docId = r.document.id;
    const again = await uploadDocument(db, store, {
      buffer: pdf,
      filename: 'other.pdf',
      license_class: 'unknown',
      author_id: author,
    });
    expect(again).toMatchObject({ created: false, document: { id: docId } });
    expect((await listDocuments(db, { q: '고시문', limit: 10, offset: 0 })).total).toBe(1);
    expect((await listDocuments(db, { source_id: 'src-fixture-notice', limit: 10, offset: 0 })).total).toBe(1);
  });

  it('공개 규칙: restricted 는 publishable 불가(422)', async () => {
    await updateDocument(db, docId, { publishable: true });
    const e = await domainError(updateDocument(db, docId, { license_class: 'restricted' }), 'validation');
    expect(e.details.violations?.[0]?.rule).toBe('document_publishable_chk');
    expect((await updateDocument(db, docId, { publishable: false, title: '바꾼 제목' })).title).toBe('바꾼 제목');
  });

  it('텍스트 추출·쪽 이미지·잘라 내기', async () => {
    const t = await extractDocumentText(db, store, docId);
    expect(t.pages).toBe(2);
    const doc = await getDocument(db, docId, { includeText: true });
    expect(doc.text_content).toContain('Hello page one');
    expect(doc.has_text).toBe(true);

    const r = await renderPageImages(db, store, docId);
    expect(r).toMatchObject({ pages: 2, created: [1, 2] });
    const pages = await listPageImages(db, docId);
    expect(pages.map((p) => [p.page, p.kind, p.mime, p.license_class])).toEqual([
      [1, 'page_image', 'image/png', 'public_work'],
      [2, 'page_image', 'image/png', 'public_work'],
    ]);
    expect((await renderPageImages(db, store, docId)).created).toEqual([]);

    const fake: ImageCropper = async (png) => ({ data: png.subarray(0, 100), width: 10, height: 10 });
    const c = await cropFigure(db, store, fake, {
      document_id: docId,
      page: 2,
      bbox: [0.1, 0.1, 0.5, 0.5],
      title: '그림',
      author_id: author,
    });
    expect(c.created).toBe(true);
    expect(c.document).toMatchObject({
      kind: 'figure_crop',
      page: 2,
      bbox: [0.1, 0.1, 0.5, 0.5],
      parent_document_id: docId,
    });
    const dup = await cropFigure(db, store, fake, {
      document_id: docId,
      page: 2,
      bbox: [0.1, 0.1, 0.5, 0.5],
      author_id: author,
    });
    expect(dup).toMatchObject({ created: false, document: { id: c.document.id } });
    await domainError(
      cropFigure(db, store, fake, { document_id: docId, page: 1, bbox: [0.5, 0.1, 0.2, 0.5], author_id: author }),
      'validation',
    );
  });
});

describe('첨부', () => {
  it('추가·수정(version)·삭제 → 변경 묶음·되돌리기', async () => {
    const c = await createAttachment(
      db,
      'stn-fx-a',
      { kind: 'quote', quote: '역 신설', source_id: 'src-fixture-notice' },
      author,
    );
    expect(c.item).toMatchObject({ kind: 'quote', quote: '역 신설', version: 1, ord: 0 });
    const op = await db.query(
      `SELECT op, entity_type, entity_id, before, after FROM change_op WHERE changeset_id = $1`,
      [c.changeset_id],
    );
    expect(op.rows[0]).toMatchObject({ op: 'update', entity_type: 'station', entity_id: 'stn-fx-a' });
    expect(op.rows[0].before.attachments).toEqual([]);
    expect(op.rows[0].after.attachments).toHaveLength(1);
    expect(c.data_version).toBeGreaterThan(0);

    const id = c.item!.id;
    await domainError(updateAttachment(db, id, { title: 'x' }, 99, author), 'version_conflict');
    await domainError(updateAttachment(db, id, { kind: 'link' }, 1, author), 'validation');
    const u = await updateAttachment(db, id, { title: '발췌' }, 1, author);
    expect(u.item).toMatchObject({ title: '발췌', version: 2 });

    // 되돌리기: 수정 전으로
    const rv = await revertChangeset(db, u.changeset_id, author);
    expect(rv.kind).toBe('attachment');
    expect((await listAttachments(db, 'stn-fx-a'))[0]).toMatchObject({ title: null });

    const d = await deleteAttachment(db, id, author);
    expect(d.item).toBeNull();
    expect(await listAttachments(db, 'stn-fx-a')).toEqual([]);
    expect(await listAttachments(db, 'stn-fx-a', { includeDeleted: true })).toHaveLength(1);
    await revertChangeset(db, d.changeset_id, author);
    expect(await listAttachments(db, 'stn-fx-a')).toHaveLength(1);
  });

  it('공개 첨부는 publishable 문서만(V-H15)', async () => {
    const up = await uploadDocument(db, store, {
      buffer: Buffer.from('image-ish'),
      filename: 'a.png',
      license_class: 'restricted',
      author_id: author,
    });
    const e = await domainError(
      createAttachment(db, 'plan-fx-ext', { kind: 'image', document_id: up.document.id, is_public: true }, author),
      'validation',
    );
    expect(e.details.violations?.[0]?.rule).toBe('V-H15');
    await domainError(createAttachment(db, 'stn-none', { kind: 'link', url: 'https://x' }, author), 'not_found');
  });
});

describe('되돌리기', () => {
  it('생성·수정·삭제·ID 변경 되돌리기, 병합은 409', async () => {
    const created = await apply([
      {
        op: 'create',
        entity_type: 'station',
        data: { id: 'stn-rv-1', name_ko: '되', checked_at: '2026-11-20', sources: SRC },
      },
    ]);
    await revertChangeset(db, created.changeset_id, author);
    expect(await readEntity(db, 'station', 'stn-rv-1')).toBeNull();
    await domainError(revertChangeset(db, created.changeset_id, author), 'invalid_state');

    const upd = await apply([{ op: 'update', entity_type: 'station', id: 'stn-fx-b', data: { address: '주소1' } }]);
    const r = await revertChangeset(db, upd.changeset_id, author);
    expect(r.kind).toBe('entity');
    expect((await readEntity(db, 'station', 'stn-fx-b'))!.address).toBeNull();
    const cs = await db.query(`SELECT origin, reverts_changeset_id FROM changeset WHERE id = $1`, [r.changeset_id]);
    expect(cs.rows[0]).toEqual({ origin: 'revert', reverts_changeset_id: upd.changeset_id });

    // 같은 필드가 그 뒤에 다시 바뀌면 409
    const u1 = await apply([{ op: 'update', entity_type: 'station', id: 'stn-fx-b', data: { address: 'A' } }]);
    await apply([{ op: 'update', entity_type: 'station', id: 'stn-fx-b', data: { address: 'B' } }]);
    await domainError(revertChangeset(db, u1.changeset_id, author), 'version_conflict');

    const ren = await apply([{ op: 'rename_id', entity_type: 'station', id: 'stn-fx-c', new_id: 'stn-fx-c2' }]);
    await revertChangeset(db, ren.changeset_id, author);
    expect(await readEntity(db, 'station', 'stn-fx-c')).not.toBeNull();
    expect((await db.query(`SELECT * FROM id_redirect WHERE old_id = 'stn-fx-c'`)).rowCount).toBe(0);

    await apply([
      {
        op: 'create',
        entity_type: 'station',
        data: { id: 'stn-rv-2', name_ko: '병', checked_at: '2026-11-20', sources: SRC },
      },
    ]);
    const merged = await apply([{ op: 'merge_station', entity_type: 'station', id: 'stn-rv-2', into_id: 'stn-fx-e' }]);
    await domainError(revertChangeset(db, merged.changeset_id, author), 'invalid_state');
  });

  it('op 하나만(seq)', async () => {
    const two = await apply([
      { op: 'update', entity_type: 'station', id: 'stn-fx-a', data: { address: '가주소' } },
      { op: 'update', entity_type: 'station', id: 'stn-fx-e', data: { address: '마주소' } },
    ]);
    await domainError(revertChangeset(db, two.changeset_id, author, { seq: 2, entity_id: 'stn-fx-a' }), 'validation');
    await revertChangeset(db, two.changeset_id, author, { seq: 2, entity_id: 'stn-fx-e' });
    expect((await readEntity(db, 'station', 'stn-fx-e'))!.address).toBeNull();
    expect((await readEntity(db, 'station', 'stn-fx-a'))!.address).toBe('가주소');
    await domainError(revertChangeset(db, two.changeset_id, author, { seq: 2 }), 'invalid_state');
  });
});

describe('승인: 일부·충돌', () => {
  const st = (id: string): Op => ({
    op: 'create',
    entity_type: 'station',
    data: { id, name_ko: id, checked_at: '2026-11-20', sources: SRC },
  });

  it('op_seqs 일부 승인 → 나머지는 새 draft', async () => {
    const id = await submitDraft(db, {
      title: '둘',
      origin: 'agent',
      author_id: author,
      ops: [st('stn-pa-1'), st('stn-pa-2')],
    });
    await db.query(
      `INSERT INTO change_evidence (changeset_id, op_seq, quote) VALUES ($1, 2, '근거2'), ($1, 1, '근거1')`,
      [id],
    );
    const r = await approveDraft(db, id, author, { op_seqs: [2] });
    expect(r.remainder_changeset_id).toBeTruthy();
    expect(await readEntity(db, 'station', 'stn-pa-2')).not.toBeNull();
    expect(await readEntity(db, 'station', 'stn-pa-1')).toBeNull();
    const rest = await db.query(`SELECT status, meta, base_data_version FROM changeset WHERE id = $1`, [
      r.remainder_changeset_id,
    ]);
    expect(rest.rows[0]).toMatchObject({ status: 'draft', meta: { split_from: id, split_seqs: [1] } });
    expect(rest.rows[0].base_data_version).not.toBeNull();
    const ev = await db.query(`SELECT changeset_id, op_seq, quote FROM change_evidence ORDER BY quote`);
    expect(ev.rows).toEqual([
      { changeset_id: r.remainder_changeset_id, op_seq: 1, quote: '근거1' },
      { changeset_id: id, op_seq: 1, quote: '근거2' },
    ]);
    await domainError(approveDraft(db, r.remainder_changeset_id!, author, { op_seqs: [5] }), 'validation');
    await approveDraft(db, r.remainder_changeset_id!, author);
    expect(await readEntity(db, 'station', 'stn-pa-1')).not.toBeNull();
  });

  it('제출 뒤 대상이 바뀌면 409, force 면 적용', async () => {
    const id = await submitDraft(db, {
      title: '수정 제안',
      origin: 'agent',
      author_id: author,
      ops: [{ op: 'update', entity_type: 'station', id: 'stn-fx-d', data: { address: '제안' } }],
    });
    await apply([{ op: 'update', entity_type: 'station', id: 'stn-fx-d', data: { address: '직접' } }]);
    const e = await domainError(approveDraft(db, id, author), 'version_conflict');
    expect(e.details.violations?.[0]).toMatchObject({ rule: 'base_data_version', entity_id: 'stn-fx-d' });
    expect((await db.query(`SELECT status FROM changeset WHERE id = $1`, [id])).rows[0].status).toBe('draft');
    await approveDraft(db, id, author, { force: true });
    expect((await readEntity(db, 'station', 'stn-fx-d'))!.address).toBe('제안');
  });
});

describe('품질·지도(픽스처)', () => {
  it('품질 규칙 집계·목록', async () => {
    const s = await qualitySummary(db);
    const count = (id: string) => s.rules.find((r) => r.id === id)!.count;
    expect(s.rules.find((r) => r.id === 'V-S03')).toMatchObject({ count: 0, note: expect.any(String) });
    // 검수 매뉴얼(2026-11-26): 모든 규칙에 있고, 매뉴얼만 있고 규칙이 없는 것도 없다
    expect(s.rules.filter((r) => !r.guide || !r.guide.steps.length).map((r) => r.id)).toEqual([]);
    expect(Object.keys(QUALITY_GUIDES).sort()).toEqual(s.rules.map((r) => r.id).sort());
    expect(s.guide_common.length).toBeGreaterThan(0);
    expect(count('V-S10')).toBe(2);
    expect(count('V-S11')).toBe(1);
    expect(count('V-S12')).toBe(1);
    expect(count('V-S13')).toBe(0);
    const s11 = await qualityItems(db, 'V-S11', { limit: 10, offset: 0 });
    expect(s11.items).toEqual([
      { entity_type: 'plan', entity_id: 'plan-fx-withdrawn', label: '시험 철회 사업', detail: expect.any(String) },
    ]);
    const s12 = await qualityItems(db, 'V-S12', { limit: 10, offset: 0 });
    expect(s12.items[0]).toMatchObject({ entity_id: 'plan-fx-ext', detail: '개략 선형뿐' });
    await domainError(qualityItems(db, 'V-S99', { limit: 1, offset: 0 }), 'not_found');

    // 자료를 더해 다른 규칙도 확인
    await apply([
      {
        op: 'create',
        entity_type: 'station',
        data: {
          id: 'stn-q-dup',
          name_ko: '나',
          geom: { lat: 37.4801, lng: 127.0501 },
          coord_source: 'official',
          checked_at: '2020-01-01',
          sources: SRC,
        },
      },
      { op: 'update', entity_type: 'line_station', id: 'ls-fx-two--fx-e', data: { order_confirmed: false } },
    ]);
    const s2 = await qualitySummary(db);
    expect(s2.rules.find((r) => r.id === 'V-S06')!.count).toBe(1);
    expect(s2.rules.find((r) => r.id === 'V-S05')!.count).toBe(1);
    expect((await qualityItems(db, 'V-S07', { limit: 10, offset: 0 })).items.map((i) => i.entity_id)).toEqual([
      'stn-q-dup',
    ]);
  });

  it('고르기 목록(지도 편집·노선 편집): 개체별 걸린 규칙, 노선별 역 규칙은 그 역·노선에', async () => {
    const lines = await reviewList(db, 'line');
    const s10 = await qualityItems(db, 'V-S10', { limit: 50, offset: 0 });
    expect(
      lines.items
        .filter((i) => i.issues.some((x) => x.rule === 'V-S10'))
        .map((i) => i.id)
        .sort(),
    ).toEqual(
      s10.items
        .filter((i) => i.entity_type === 'line')
        .map((i) => i.entity_id)
        .sort(),
    );
    // 위에서 ls-fx-two--fx-e 를 순서 미확인으로 바꿨다(V-S05 = line_station)
    expect(lines.items.find((i) => i.id === 'line-fx-two')!.issues.map((x) => x.rule)).toContain('V-S05');
    const st = await reviewList(db, 'station');
    const e = st.items.find((i) => i.id === 'stn-fx-e')!;
    expect(e.issues.map((x) => x.rule)).toContain('V-S05');
    expect(e.lines).toContain('시험 2호선');
    expect(st.items.some((i) => i.issues.length === 0)).toBe(true);
    expect(st.items.find((i) => i.id === 'stn-q-dup')).toMatchObject({ name_ko: '나', has_geom: true });
  });

  it('V-S04 거리 확인: 맞다고 확인하면 빠지고, 앞 역이 바뀌면 다시 나온다', async () => {
    const hits = async () =>
      (await qualityItems(db, 'V-S04', { limit: 50, offset: 0 })).items.filter(
        (i) => i.entity_id === 'ls-fx-two--q-far',
      );
    await apply([
      {
        op: 'create',
        entity_type: 'station',
        data: {
          id: 'stn-q-far',
          name_ko: '먼역',
          region_code: '41',
          geom: { lat: 37.9, lng: 127.0 },
          coord_source: 'official',
          checked_at: '2026-01-01',
          sources: SRC,
        },
      },
      {
        op: 'create',
        entity_type: 'line_station',
        data: { id: 'ls-fx-two--q-far', line_id: 'line-fx-two', station_id: 'stn-q-far', seq: 3, status: 'operating' },
      },
    ]);
    const [h] = await hits();
    expect(h).toMatchObject({
      action_ref: 'ls-fx-two--fx-e',
      detail: expect.stringContaining('앞 역 마(ls-fx-two--fx-e)과 55.'),
    });
    // 다른 앞 역으로 확인한 것은 효력 없음
    await apply([
      {
        op: 'update',
        entity_type: 'line_station',
        id: 'ls-fx-two--q-far',
        data: { gap_confirmed_prev_id: 'ls-fx-two--fx-a' },
      },
    ]);
    expect(await hits()).toHaveLength(1);
    await apply([
      {
        op: 'update',
        entity_type: 'line_station',
        id: 'ls-fx-two--q-far',
        data: { gap_confirmed_prev_id: 'ls-fx-two--fx-e' },
      },
    ]);
    expect(await hits()).toEqual([]);
    expect((await reviewList(db, 'station')).items.find((i) => i.id === 'stn-q-far')!.issues).toEqual([]);
    // km 역행은 확인해도 남는다(action_ref 없음)
    await apply([
      { op: 'update', entity_type: 'line_station', id: 'ls-fx-two--fx-e', data: { km: 10 } },
      { op: 'update', entity_type: 'line_station', id: 'ls-fx-two--q-far', data: { km: 5 } },
    ]);
    const [k] = await hits();
    expect(k).toMatchObject({ action_ref: null, detail: 'km 역행(10.00 → 5.00)' });
    await apply([
      { op: 'update', entity_type: 'line_station', id: 'ls-fx-two--fx-e', data: { km: null } },
      { op: 'delete', entity_type: 'line_station', id: 'ls-fx-two--q-far' },
    ]);
  });

  it('분리 정거장(X-station-split): 분리 유지 메모면 빠지고, 미리 보기 → 근거 출처와 함께 병합', async () => {
    const hits = async () =>
      (await qualityItems(db, 'X-station-split', { limit: 50, offset: 0 })).items.filter(
        (i) => i.entity_id === 'stn-q-split',
      );
    await apply([
      {
        op: 'create',
        entity_type: 'station',
        data: {
          id: 'stn-q-split',
          name_ko: '다(신설)',
          region_code: '41',
          merge_into_id: 'stn-fx-c',
          checked_at: '2026-01-01',
          sources: SRC,
        },
      },
      {
        op: 'create',
        entity_type: 'line_station',
        data: {
          id: 'ls-fx-two--q-split',
          line_id: 'line-fx-two',
          station_id: 'stn-q-split',
          seq: 9,
          status: 'under_construction',
        },
      },
    ]);
    const [h] = await hits();
    expect(h).toMatchObject({ action_ref: 'stn-fx-c', detail: expect.stringContaining('→ 다(stn-fx-c)') });
    expect((await reviewList(db, 'station')).items.find((i) => i.id === 'stn-q-split')!.issues).toContainEqual(
      expect.objectContaining({ rule: 'X-station-split' }),
    );
    // 다른 역 id 로 적은 분리 유지는 효력 없음, 병합할 역 id 로 적으면 빠진다
    await apply([
      { op: 'update', entity_type: 'station', id: 'stn-q-split', data: { editor_note: '분리 유지(stn-fx-b): x' } },
    ]);
    expect(await hits()).toHaveLength(1);
    await apply([
      {
        op: 'update',
        entity_type: 'station',
        id: 'stn-q-split',
        data: { editor_note: '분리 유지(stn-fx-c): 환승 미정' },
      },
    ]);
    expect(await hits()).toEqual([]);

    const p = await mergePreview(db, 'stn-q-split', 'stn-fx-c');
    expect(p).toMatchObject({
      matches_merge_into: true,
      adds_former_name: true,
      distance_m: null,
      line_stations: [{ id: 'ls-fx-two--q-split', action: 'move', twin_id: null, status: 'under_construction' }],
    });
    expect(p.into.lines.map((l) => l.line_id)).toEqual(['line-fx-one']);
    await domainError(mergePreview(db, 'stn-q-split', 'stn-q-split'), 'validation');

    await apply([
      {
        op: 'merge_station',
        entity_type: 'station',
        id: 'stn-q-split',
        into_id: 'stn-fx-c',
        reason: '환승역 확인',
        source_id: 'src-fixture-notice',
      },
    ]);
    const ls = await readEntity(db, 'line_station', 'ls-fx-two--q-split');
    expect(ls?.station_id).toBe('stn-fx-c');
    const rs = await db.query(`SELECT field, note FROM record_source WHERE entity_id = 'ls-fx-two--q-split'`);
    expect(rs.rows).toContainEqual({ field: 'station_id', note: '역 병합 근거(stn-q-split → stn-fx-c)' });
    expect(await hits()).toEqual([]);
    await apply([{ op: 'delete', entity_type: 'line_station', id: 'ls-fx-two--q-split' }]);
  });

  it('이관 검수 목록: 폐기 근거 필요(Q101)·뺀 정차역(Q105)', async () => {
    const count = async (id: string) => (await qualitySummary(db)).rules.find((r) => r.id === id)!.count;
    expect(await count('X-plan-abandoned-evidence')).toBe(0);
    expect(await count('X-service-dropped-stops')).toBe(0);
    await apply([
      { op: 'update', entity_type: 'plan', id: 'plan-fx-withdrawn', data: { stage_override: 'abandoned' } },
      {
        op: 'update',
        entity_type: 'service',
        id: 'svc-fx-one',
        data: {
          extra: {
            dropped_stops: [
              // express 패턴에 stn-fx-b 가 없음 → 목록에
              { pattern: 'express', seq: 2, station_id: 'stn-fx-b', reason: 'ambiguous', candidates: ['l1', 'l2'] },
              // local 패턴에는 이미 stn-fx-b 가 있음(보강됨) → 목록에서 빠짐
              { pattern: 'local', seq: 2, station_id: 'stn-fx-b', reason: 'not_on_service_lines' },
              { pattern: 'gone', seq: 1, station_id: 'stn-fx-a', reason: 'pattern_dropped' },
            ],
          },
        },
      },
    ]);
    const ab = await qualityItems(db, 'X-plan-abandoned-evidence', { limit: 10, offset: 0 });
    expect(ab.items.map((i) => i.entity_id)).toEqual(['plan-fx-withdrawn']);
    const ds = await qualityItems(db, 'X-service-dropped-stops', { limit: 10, offset: 0 });
    expect(ds.items.map((i) => i.detail)).toEqual([
      'express #2 stn-fx-b — 노선 모호(후보 l1, l2)',
      'gone #1 stn-fx-a — 패턴 전체 제외(해석 정차역 2개 미만)',
    ]);
    expect(ds.items.every((i) => i.entity_type === 'service' && i.entity_id === 'svc-fx-one')).toBe(true);
    // 근거가 이력에 들어가면 빠진다
    await apply([
      {
        op: 'update',
        entity_type: 'plan',
        id: 'plan-fx-withdrawn',
        data: {
          stage_events: [
            { stage: 'feasibility', date: { value: '2019', precision: 'year' }, source_id: 'src-fixture-notice' },
            { stage: 'abandoned', date: { value: '2022', precision: 'year' }, source_id: 'src-fixture-notice' },
          ],
        },
      },
    ]);
    expect(await count('X-plan-abandoned-evidence')).toBe(0);
    await apply([
      {
        op: 'update',
        entity_type: 'plan',
        id: 'plan-fx-withdrawn',
        data: {
          stage_override: null,
          stage_events: [
            { stage: 'feasibility', date: { value: '2019', precision: 'year' }, source_id: 'src-fixture-notice' },
            {
              stage: 'feasibility',
              kind: 'withdrawn',
              date: { value: '2021', precision: 'year' },
              source_id: 'src-fixture-notice',
            },
          ],
        },
      },
      { op: 'update', entity_type: 'service', id: 'svc-fx-one', data: { extra: {} } },
    ]);
  });

  it('시점별 지도·연표', async () => {
    const ids = (fc: { features: { id?: string }[] }) => fc.features.map((f) => f.id).sort();
    const now = await mapAtLines(db, { year: 2026, stage_min: 'basic_plan', include_undated: false });
    expect(ids(now)).toEqual(['line:line-fx-one', 'line:line-fx-two']);
    const y2030 = await mapAtLines(db, { year: 2030, stage_min: 'basic_plan', include_undated: false });
    expect(ids(y2030)).toEqual(['line:line-fx-one', 'line:line-fx-two', 'plan:plan-fx-ext']);
    const fut = await mapAtLines(db, { year: null, stage_min: 'basic_plan', include_undated: false });
    expect(ids(fut)).toEqual(['line:line-fx-one', 'plan:plan-fx-ext', 'plan:plan-fx-replace']);
    const ext = fut.features.find((f) => f.id === 'plan:plan-fx-ext')!;
    expect(ext.properties).toMatchObject({
      color: '#0052A4',
      color_basis: 'extends_line',
      quality: 'schematic',
      stage: 'construction',
    });
    expect(ext.geometry).toMatchObject({ type: 'MultiLineString' });
    const st = await mapAtStations(db, { year: 2030, stage_min: 'basic_plan', include_undated: false });
    expect(st.features.find((f) => f.id === 'stn-fx-d')?.properties).toMatchObject({
      future: true,
      plan_ids: ['plan-fx-ext'],
    });
    expect(await mapTimeline(db, 'basic_plan')).toEqual({
      stage_min: 'basic_plan',
      years: [
        { year: 2029, count: 1 },
        { year: 2032, count: 1 },
      ],
      undated: 0,
    });
    expect((await mapTimeline(db, 'concept')).undated).toBe(1);
  });
});
