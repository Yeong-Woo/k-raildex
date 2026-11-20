/** 출처 변환 + license_class 판정(WP 3.2) */
import type { Code, SourceCreate } from '@k-raildex/contracts';
import type { LSource } from '../read/types';
import { compact, fuzzyFromString, type MigrationReport } from './common';

type LicenseClass = Code<'licenseClass'>;

/** 판정을 흐리게 만드는 표현 — 이 말이 붙은 공공누리 표기는 확정 유형으로 보지 않는다 */
const HEDGE = /추정|준해|준함|숨김|미확인|확인 중|확인 전/;

/**
 * license_class 판정 규칙표(WP 3.2):
 * 1. type notice·law → public_work
 * 2. 라이선스 문자열 "공공누리 제N유형" → kogl_N (단 "추정·준함·숨김" 등 유보 표현이 있으면 판정하지 않음)
 * 3. ODbL·CC → open
 * 4. type wiki·news → restricted
 * 5. 나머지 → unknown(리포트)
 */
export function licenseClassOf(type: string, license: string): { cls: LicenseClass; rule: string } {
  if (type === 'notice' || type === 'law') return { cls: 'public_work', rule: 'type' };
  const kogl = /공공누리\s*제\s*([1-4])\s*유형/.exec(license);
  if (kogl && !HEDGE.test(license)) return { cls: `kogl_${kogl[1]}` as LicenseClass, rule: 'kogl' };
  if (/\bODbL\b|\bCC[ -]BY\b|\bCC0\b/i.test(license)) return { cls: 'open', rule: 'open' };
  if (type === 'wiki' || type === 'news') return { cls: 'restricted', rule: 'type' };
  return { cls: 'unknown', rule: 'unknown' };
}

export function transformSource(s: LSource, report: MigrationReport, editorNote: string | null): SourceCreate {
  const { cls } = licenseClassOf(s.type, s.license);
  if (cls === 'unknown') report.add('license_class unknown', `${s.id} [${s.type}] ${s.license}`);
  report.count(`license_class.${cls}`);
  const published = fuzzyFromString(s.published_at);
  if (s.published_at && !published)
    report.add('출처 published_at 해석 실패(published_raw 로 보관)', `${s.id}: ${s.published_at}`);
  return {
    id: s.id,
    title: s.title,
    publisher: s.publisher,
    type: s.type as SourceCreate['type'],
    url: s.url ?? null,
    license: s.license,
    license_class: cls,
    attribution: s.attribution ?? null,
    published,
    published_raw: s.published_at && !published ? s.published_at : null,
    data_as_of: s.data_as_of ?? null,
    retrieved_at: s.retrieved_at,
    refresh: (s.refresh as SourceCreate['refresh']) ?? null,
    notice_number: null,
    dataset_key: s.dataset_key ?? null,
    download: s.download ? compact(s.download) : null,
    note: s.note ?? null,
    // 기존 출처에는 확인일이 따로 없어 retrieved_at(실제로 내려받은/확인한 날)을 쓴다
    checked_at: s.retrieved_at,
    provenance_note: null,
    review_status: 'unverified',
    editor_note: editorNote,
    extra: {},
    sources: [],
    names: [],
    external_refs: [],
    documents: [],
  };
}
