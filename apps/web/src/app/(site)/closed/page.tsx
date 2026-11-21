/** 폐선·폐역(P2 `/closed/`): 폐지·휴업 노선·역·운행 계통 + 폐기된 계획. 기존 절 앵커 `#h-lines`·`#h-stations`·`#h-services`·`#h-plans` 유지 */
import type { Metadata } from 'next';
import { compareFuzzy } from '@k-raildex/contracts';
import { FuzzyDateText, StageBadge } from '@/components/badges';
import { getClosed, getPlans } from '@/lib/data';
import { areaLabel } from '@/lib/filters';
import { fmtNum } from '@/lib/format';
import { pageMeta } from '@/lib/site';
import { paths } from '@/lib/urls';

export const metadata: Metadata = pageMeta(
  '폐선·폐역',
  '운행을 마친 철도 노선·역·운행 계통과 폐기된 계획 — 개통·폐지일과 출처.',
  '/closed/',
);

type Row = {
  id: string;
  name_ko: string;
  opened: { value: string | null; precision: 'day' | 'month' | 'half' | 'year' | 'unknown' } | null;
  closed: Row['opened'];
  areas: string[];
};

function Table({ rows, href, label }: { rows: Row[]; href: (id: string) => string; label: string }) {
  if (rows.length === 0) return <p className="empty surface">해당 항목이 없습니다.</p>;
  return (
    <div className="table-wrap">
      <table className="data cardify">
        <thead>
          <tr>
            <th scope="col">{label}</th>
            <th scope="col">개통</th>
            <th scope="col">폐지·휴업</th>
            <th scope="col">권역</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <a href={href(r.id)}>{r.name_ko}</a>
              </td>
              <td data-label="개통" className="nowrap">
                <FuzzyDateText value={r.opened} />
              </td>
              <td data-label="폐지·휴업" className="nowrap">
                <FuzzyDateText value={r.closed} />
              </td>
              <td data-label="권역" style={{ fontSize: 'var(--kr-text-xs)' }}>
                {r.areas.map(areaLabel).join(' · ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ClosedPage() {
  const [c, plans] = await Promise.all([getClosed(), getPlans()]);
  const byClosed = (a: Row, b: Row) => compareFuzzy(b.closed, a.closed);
  const abandoned = plans
    .filter((p) => p.stage === 'abandoned')
    .sort((a, b) => a.name_ko.localeCompare(b.name_ko, 'ko'));
  const secs = [
    { id: 'h-lines', title: '노선', rows: [...c.lines].sort(byClosed), href: paths.line, label: '노선' },
    { id: 'h-stations', title: '역', rows: [...c.stations].sort(byClosed), href: paths.station, label: '역' },
    {
      id: 'h-services',
      title: '운행 계통',
      rows: [...c.services].sort(byClosed),
      href: paths.service,
      label: '운행 계통',
    },
  ];
  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <div className="page-head">
        <h1>폐선·폐역</h1>
        <p className="lead">
          운행을 마쳤거나 쉬고 있는 노선·역·운행 계통과 폐기된 계획입니다. 개통을 앞둔 것은{' '}
          <a href={paths.upcoming()}>개통 예정</a>, 날짜순 기록은 <a href={paths.timeline()}>연표</a>.
        </p>
      </div>
      <nav className="chips" aria-label="절">
        {secs.map((s) => (
          <a key={s.id} className="chip" href={`#${s.id}`} style={{ paddingLeft: '0.6em' }}>
            {s.title} {s.rows.length}
          </a>
        ))}
        <a className="chip" href="#h-plans" style={{ paddingLeft: '0.6em' }}>
          폐기된 계획 {abandoned.length}
        </a>
      </nav>
      {secs.map((s) => (
        <section key={s.id} className="section" aria-labelledby={s.id}>
          <div className="section-head">
            <h2 id={s.id}>{s.title}</h2>
            <span className="muted num">{fmtNum(s.rows.length)}</span>
          </div>
          <Table rows={s.rows} href={s.href} label={s.label} />
        </section>
      ))}
      <section className="section" aria-labelledby="h-plans">
        <div className="section-head">
          <h2 id="h-plans">폐기된 계획</h2>
          <span className="muted num">{fmtNum(abandoned.length)}</span>
        </div>
        {abandoned.length === 0 ? (
          <p className="empty surface">폐기된 계획이 없습니다.</p>
        ) : (
          <ul className="ulist surface">
            {abandoned.map((p) => (
              <li key={p.id}>
                <span>
                  <a href={paths.plan(p.id)}>{p.name_ko}</a>
                </span>
                <span className="when">
                  <StageBadge stage={p.stage} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
