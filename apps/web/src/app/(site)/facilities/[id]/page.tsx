/** 시설 상세(차량기지 등, 0035): 기능·운영기관·담당 노선·붙은 선로·위치 → 근거 자료 → 출처 */
import type { Metadata } from 'next';
import { codeLabel } from '@k-raildex/contracts';
import { FuzzyDateText, LineChip, ReviewBadge, StatusBadge } from '@/components/badges';
import { AttachmentsSection, DetailBand, Fact, PagePanel, Section, SourcesSection, Toc } from '@/components/detail';
import { BreadcrumbLd } from '@/components/json-ld';
import { getFacility } from '@/lib/data';
import { clip, pageMeta } from '@/lib/site';
import { groupSources } from '@/lib/sources';
import { paths } from '@/lib/urls';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const f = await getFacility(id);
  const served = f.served_lines.map((l) => l.name_ko).join('·');
  return pageMeta(
    f.name_ko,
    clip(
      `${f.name_ko} — ${codeLabel('facilityKind', f.kind)}${served ? `, ${served} 차량` : ''}. 기능·운영기관·위치와 출처.`,
    ),
    paths.facility(f.id),
  );
}

export default async function FacilityPage({ params }: { params: Params }) {
  const { id } = await params;
  const f = await getFacility(id);
  const path = paths.facility(f.id);
  const src = groupSources(f.sources, f.id);
  const kind = codeLabel('facilityKind', f.kind);
  return (
    <>
      <BreadcrumbLd
        items={[
          { label: kind, path: paths.map() },
          { label: f.name_ko, path },
        ]}
      />
      <DetailBand
        colors={f.served_lines.map((l) => l.color)}
        crumbs={[{ href: paths.map(), label: '지도' }, { label: f.name_ko }]}
        title={f.name_ko}
        sub={[f.name_full, f.name_en].filter(Boolean).join(' · ') || undefined}
        badges={
          <>
            <span className="badge outline">{kind}</span>
            <StatusBadge status={f.status} />
            {f.region ? <span className="badge outline">{f.region.name_ko}</span> : null}
            <ReviewBadge status={f.review_status} />
          </>
        }
        facts={
          <>
            <Fact label="기능">
              {f.functions.length ? (
                f.functions.map((x) => codeLabel('facilityFunction', x)).join(' · ')
              ) : (
                <span className="muted">미확인</span>
              )}
            </Fact>
            <Fact label="운영기관">{f.operator?.name_ko ?? <span className="muted">미확인</span>}</Fact>
            <Fact label="개통">
              {f.opened ? <FuzzyDateText value={f.opened} /> : <span className="muted">미확인</span>}
            </Fact>
          </>
        }
      />
      <Toc
        items={[
          { id: 'lines', label: '노선', count: f.served_lines.length + f.connecting_lines.length },
          { id: 'location', label: '위치' },
          ...(f.attachments.length ? [{ id: 'evidence', label: '근거 자료', count: f.attachments.length }] : []),
          { id: 'sources', label: '출처', count: src.length },
        ]}
      />
      <div className="container two-col">
        <div>
          {f.description ? <p className="prose-text">{f.description}</p> : null}
          <Section id="lines" title="노선">
            <dl className="kv" data-testid="facility-lines">
              <dt>담당 노선</dt>
              <dd>
                {f.served_lines.length ? (
                  <span className="chips">
                    {f.served_lines.map((l) => (
                      <LineChip key={l.id} line={l} />
                    ))}
                  </span>
                ) : (
                  '미확인'
                )}
              </dd>
              <dt>붙은 선로</dt>
              <dd>
                {f.connecting_lines.length
                  ? f.connecting_lines.map((l, i) => (
                      <span key={l.id}>
                        {i ? ', ' : ''}
                        <a href={paths.line(l.id)}>{l.name_ko}</a>
                        {l.line_role ? <span className="muted"> · {codeLabel('lineRole', l.line_role)}</span> : null}
                      </span>
                    ))
                  : '미확인'}
              </dd>
            </dl>
          </Section>
          <Section id="location" title="위치">
            <dl className="kv">
              <dt>주소</dt>
              <dd>{f.address ?? '미확인'}</dd>
              <dt>좌표</dt>
              <dd>
                {f.coord ? `${f.coord.lat}, ${f.coord.lng}` : '미확인'}
                {f.approximate ? <span className="muted"> (근사 — 주소·법정동 대표점)</span> : null}
              </dd>
            </dl>
          </Section>
          <AttachmentsSection items={f.attachments} />
          <SourcesSection groups={src} title={f.name_ko} path={path} />
        </div>
        <aside className="aside" aria-label="시설 정보">
          {f.coord ? (
            <div className="panel">
              <h3>지도</h3>
              <a
                className="btn"
                href={paths.map(`facility=${encodeURIComponent(f.id)}`)}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                지도에서 보기
              </a>
            </div>
          ) : null}
          <PagePanel meta={f.meta} id={f.id} />
        </aside>
      </div>
    </>
  );
}
