/**
 * 상세 페이지 골격(docs/06-public-web.md 4-1절): 머리 띠 → 이동 경로 → 이름 → 배지 줄 → 핵심 수치 → 고정 절 탐색 → 본문 + 옆 패널.
 * "출처" 절(FR-WEB-005: 번호 목록 — 발행처·유형·라이선스·받은 날·대상 필드, 공개 원문 다운로드)과 "근거 자료" 절.
 */
import type { ReactNode } from 'react';
import { codeLabel, type PublicAttachment } from '@k-raildex/contracts';
import { fmtBytes, fmtDate } from '@/lib/format';
import type { SourceGroup } from '@/lib/sources';
import { issueUrl, paths } from '@/lib/urls';
import { ReviewBadge } from './badges';

export interface Crumb {
  href?: string;
  label: string;
}

export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="이동 경로">
      <ol className="crumbs">
        {items.map((c, i) => (
          <li key={i}>{c.href ? <a href={c.href}>{c.label}</a> : <span aria-current="page">{c.label}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}

/** 머리 띠. colors 가 여럿이면 줄무늬(역 = 지나는 노선 색) */
export function DetailBand({
  colors,
  crumbs,
  mark,
  title,
  sub,
  badges,
  extra,
  facts,
}: {
  colors: (string | null)[];
  crumbs: Crumb[];
  mark?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  badges?: ReactNode;
  extra?: ReactNode;
  facts?: ReactNode;
}) {
  const real = colors.filter((c): c is string => !!c);
  return (
    <header className="band">
      {real.length > 1 ? (
        <div className="stripes" aria-hidden="true">
          {real.map((c, i) => (
            <span key={i} style={{ background: c }} />
          ))}
        </div>
      ) : (
        <div className="stripe" aria-hidden="true" style={real[0] ? { background: real[0] } : undefined} />
      )}
      <div className="container in">
        <Crumbs items={crumbs} />
        <div className="title-row">
          {mark}
          <div>
            <h1>{title}</h1>
            {sub ? <div className="subname">{sub}</div> : null}
          </div>
        </div>
        {badges ? <div className="badges">{badges}</div> : null}
        {extra ? <div className="badges">{extra}</div> : null}
        {facts ? <dl className="facts">{facts}</dl> : null}
      </div>
    </header>
  );
}

/** 핵심 수치 칸 하나(값 + 작은 출처 각주) */
export function Fact({
  label,
  children,
  note,
  srcN,
}: {
  label: string;
  children: ReactNode;
  note?: ReactNode;
  srcN?: number | null;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {children}
        {srcN ? (
          <sup className="ref">
            <a href={`#src-${srcN}`} aria-label={`출처 ${srcN}`}>
              {srcN}
            </a>
          </sup>
        ) : null}
        {note ? <span className="src">{note}</span> : null}
      </dd>
    </div>
  );
}

export interface TocItem {
  id: string;
  label: string;
  count?: number;
}

/** 고정 절 탐색(앵커 링크 — JS 없이 이동) */
export function Toc({ items }: { items: TocItem[] }) {
  return (
    <nav className="toc" aria-label="이 페이지의 절">
      <div className="container" style={{ display: 'flex', gap: 'var(--kr-space-1)', overflowX: 'auto' }}>
        {items.map((t) => (
          <a key={t.id} href={`#${t.id}`}>
            {t.label}
            {t.count != null ? <span className="count">{t.count}</span> : null}
          </a>
        ))}
      </div>
    </nav>
  );
}

export function Section({
  id,
  title,
  sub,
  more,
  children,
}: {
  id: string;
  title: string;
  sub?: ReactNode;
  more?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section" id={id} aria-labelledby={`${id}-h`}>
      <div className="section-head">
        <h2 id={`${id}-h`}>{title}</h2>
        {sub ? (
          <span className="muted" style={{ fontSize: 'var(--kr-text-sm)' }}>
            {sub}
          </span>
        ) : null}
        {more ? <span className="more">{more}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** 오류 제보(GitHub 이슈 양식). 주소 환경 변수가 없으면 그리지 않는다 */
export function ReportLink({ title, path }: { title: string; path: string }) {
  const url = issueUrl(process.env.PUBLIC_ISSUES_URL || process.env.NEXT_PUBLIC_ISSUE_URL, title, path);
  if (!url) return null;
  return (
    <a href={url} rel="noopener" target="_blank">
      오류 제보
    </a>
  );
}

/** 공개 원문 다운로드 링크(웹 Route Handler 가 중계) */
export function DocumentLink({
  doc,
}: {
  doc: { id: string; filename: string; size_bytes: number; license_class: string; notice: string | null };
}) {
  return (
    <span className="dl-link">
      <a href={paths.document(doc.id)} download={doc.filename}>
        원문 받기
      </a>{' '}
      <span className="muted">
        ({doc.filename}, {fmtBytes(doc.size_bytes)})
      </span>
      {doc.notice ? <span className="name-sub">{doc.notice}</span> : null}
    </span>
  );
}

export function SourcesSection({
  groups,
  title,
  path,
  extraNotes = [],
}: {
  groups: SourceGroup[];
  title: string;
  path: string;
  extraNotes?: string[];
}) {
  return (
    <Section id="sources" title="출처" sub={`${groups.length}건`} more={<ReportLink title={title} path={path} />}>
      {groups.length === 0 ? (
        <p className="note">연결된 출처가 없습니다(미확인).</p>
      ) : (
        <ol className="sources surface">
          {groups.map((g) => (
            <li key={g.source_id} id={`src-${g.n}`}>
              <span className="n">{g.n}</span>
              <div>
                {g.url ? (
                  <a href={g.url} rel="noopener noreferrer" target="_blank">
                    {g.title}
                  </a>
                ) : (
                  <span>{g.title}</span>
                )}
                <span className="meta">
                  {g.publisher} · {codeLabel('sourceType', g.type)} · {g.license}
                  {g.license_class !== 'unknown' && g.license !== codeLabel('licenseClass', g.license_class)
                    ? ` (${codeLabel('licenseClass', g.license_class)})`
                    : ''}{' '}
                  · 받은 날 {fmtDate(g.retrieved_at)} · 확인 {fmtDate(g.checked_at)}
                </span>
                {g.attribution ? <span className="meta">표기: {g.attribution}</span> : null}
                {g.locators.length ? <span className="meta">위치: {g.locators.join(', ')}</span> : null}
                {g.notes.length ? <span className="meta">{g.notes.join(' / ')}</span> : null}
                {g.extra_notes.map((n) => (
                  <span className="meta" key={n}>
                    원문 표기 — {n}
                  </span>
                ))}
                {g.documents.map((d) => (
                  <div key={d.id}>
                    <DocumentLink doc={d} />
                  </div>
                ))}
              </div>
              <span className="badge outline field" title="이 출처가 뒷받침하는 필드">
                {g.fields.length ? g.fields.join(', ') : '전체'}
              </span>
            </li>
          ))}
          {extraNotes.map((n) => (
            <li key={n}>
              <span className="n">·</span>
              <span className="meta">원문 표기 — {n}</span>
              <span />
            </li>
          ))}
        </ol>
      )}
      <p className="muted" style={{ fontSize: 'var(--kr-text-xs)', marginTop: 'var(--kr-space-2)' }}>
        출처 표기·라이선스는 <a href={paths.sources()}>출처·라이선스</a> 페이지에 모아 둡니다. 공공누리 제4유형 원문은
        변경 금지·비상업 조건으로만 제공합니다.
      </p>
    </Section>
  );
}

export function AttachmentsSection({ items }: { items: PublicAttachment[] }) {
  if (items.length === 0) return null;
  return (
    <Section id="evidence" title="근거 자료" sub={`${items.length}건`}>
      <ul className="attachments surface">
        {items.map((a) => (
          <li key={a.id}>
            <span className="badge outline">{codeLabel('attachmentKind', a.kind)}</span>{' '}
            {a.url ? (
              <a href={a.url} rel="noopener noreferrer" target="_blank">
                {a.title ?? a.url}
              </a>
            ) : (
              <b>{a.title ?? '(제목 없음)'}</b>
            )}
            {a.page != null ? <span className="muted"> · {a.page}쪽</span> : null}
            {a.quote ? <blockquote>{a.quote}</blockquote> : null}
            {a.document ? (
              a.kind === 'image' && a.document.mime.startsWith('image/') ? (
                <div style={{ marginTop: 'var(--kr-space-2)' }}>
                  <img
                    src={`${paths.document(a.document.id)}?disposition=inline`}
                    alt={a.title ?? '근거 이미지'}
                    loading="lazy"
                    style={{ maxWidth: '100%', height: 'auto', borderRadius: 'var(--kr-radius-md)' }}
                  />
                  <DocumentLink doc={a.document} />
                </div>
              ) : (
                <div>
                  <DocumentLink doc={a.document} />
                </div>
              )
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** 옆 패널 "이 페이지": 검수·확인일·최근 변경·식별자 */
export function PagePanel({
  meta,
  id,
}: {
  meta: {
    checked_at: string;
    review_status: 'verified' | 'unverified' | 'flagged';
    updated_at: string;
    provenance_note: string | null;
  };
  id: string;
}) {
  return (
    <div className="panel">
      <h3>이 페이지</h3>
      <dl className="kv">
        <dt>검수</dt>
        <dd>
          <ReviewBadge status={meta.review_status} showVerified />
        </dd>
        <dt>확인일</dt>
        <dd className="num">{fmtDate(meta.checked_at)}</dd>
        <dt>최근 변경</dt>
        <dd className="num">{fmtDate(meta.updated_at)}</dd>
        <dt>식별자</dt>
        <dd>
          <code>{id}</code>
        </dd>
      </dl>
    </div>
  );
}
