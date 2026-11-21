/**
 * 열차번호·차량번호 체계(P2 `/trains/`, 기존 D28): 열차번호(운행 번호)와 차량번호(차호)·편성번호는 서로 다른 번호다(C-3).
 * 번호 찾기 `?n=` 는 서버에서 공개 API `/numbers/search` 로(JS 없이 동작). 행 앵커 = 번호대 id(`#tnr-…`, `#rsn-…`, 기존 유지).
 */
import type { Metadata } from 'next';
import { codeLabel, codes } from '@k-raildex/contracts';
import { FuzzyDateText } from '@/components/badges';
import { SourceMini } from '@/components/source-mini';
import { getTrains, searchNumber, type Trains } from '@/lib/data';
import { pageMeta } from '@/lib/site';
import { firstParam, paths } from '@/lib/urls';

export const metadata: Metadata = pageMeta(
  '열차번호·차량번호',
  '열차번호(운행 번호) 체계와 차량번호(차호)·편성번호 체계 — 운영기관·등급·운행 계통별 번호대와 번호 찾기.',
  '/trains/',
);

type SP = Promise<Record<string, string | string[] | undefined>>;
type Tnr = Trains['train_number_ranges'][number];
type Rsr = Trains['rolling_stock_ranges'][number];

const pad = (n: number, d: number) => String(n).padStart(d, '0');

function TnrTable({ rows }: { rows: Tnr[] }) {
  return (
    <div className="table-wrap">
      <table className="data cardify">
        <thead>
          <tr>
            <th scope="col">번호대</th>
            <th scope="col">운영기관·등급</th>
            <th scope="col">구간</th>
            <th scope="col">홀짝</th>
            <th scope="col">출처</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} id={r.id}>
              <td className="num nowrap">
                {r.code_prefix ? <small className="muted">{r.code_prefix} </small> : null}
                {r.range_from}
                {r.range_to !== r.range_from ? `~${r.range_to}` : ''}
              </td>
              <td data-label="운영기관·등급">
                {r.operator.name_ko}
                {r.train_class ? (
                  <span className="name-sub">
                    <a href={`${paths.trainClasses()}#${r.train_class.id}`}>{r.train_class.name_ko}</a>
                  </span>
                ) : null}
              </td>
              <td data-label="구간" style={{ fontSize: 'var(--kr-text-sm)' }}>
                {r.route_text ?? '—'}
                {r.service_ids.length ? (
                  <span className="name-sub">
                    {r.service_ids.map((s, i) => (
                      <span key={s}>
                        {i ? ', ' : ''}
                        <a href={paths.service(s)}>운행 계통</a>
                      </span>
                    ))}
                  </span>
                ) : null}
                {r.valid_from || r.valid_to ? (
                  <span className="name-sub">
                    적용 <FuzzyDateText value={r.valid_from} /> ~ <FuzzyDateText value={r.valid_to} />
                  </span>
                ) : null}
                {r.note ? <span className="name-sub">{r.note}</span> : null}
              </td>
              <td data-label="홀짝" style={{ fontSize: 'var(--kr-text-xs)' }}>
                {r.parity_rule && (codes.parityRule.values as readonly string[]).includes(r.parity_rule)
                  ? codeLabel('parityRule', r.parity_rule as (typeof codes.parityRule.values)[number])
                  : (r.parity_rule ?? '—')}
              </td>
              <td data-label="출처" style={{ fontSize: 'var(--kr-text-xs)' }}>
                <SourceMini sources={r.sources} checkedAt={r.checked_at} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RsrTable({ rows }: { rows: Rsr[] }) {
  return (
    <div className="table-wrap">
      <table className="data cardify">
        <thead>
          <tr>
            <th scope="col">차량번호</th>
            <th scope="col">운영기관·차종</th>
            <th scope="col">편성</th>
            <th scope="col">상태</th>
            <th scope="col">출처</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} id={r.id}>
              <td className="num nowrap">
                {r.number_prefix ?? ''}
                {pad(r.number_from, r.digits)}~{r.number_prefix ?? ''}
                {pad(r.number_to, r.digits)}
                <span className="name-sub">{r.series}</span>
              </td>
              <td data-label="운영기관·차종">
                {r.operator.name_ko}
                {r.model ? <span className="name-sub">{r.model}</span> : null}
                {r.train_class ? (
                  <span className="name-sub">
                    <a href={`${paths.trainClasses()}#${r.train_class.id}`}>{r.train_class.name_ko}</a>
                  </span>
                ) : null}
                {r.number_rule ? <span className="name-sub">{r.number_rule}</span> : null}
              </td>
              <td data-label="편성" style={{ fontSize: 'var(--kr-text-sm)' }}>
                {r.formation.from && r.formation.to
                  ? `${r.formation.from}~${r.formation.to}`
                  : r.formation.count != null
                    ? `${r.formation.count}${r.formation.label ?? '편성'}`
                    : '—'}
                {r.formation.cars ? <span className="name-sub">{r.formation.cars}량 1편성</span> : null}
                {r.owner_note ? <span className="name-sub">{r.owner_note}</span> : null}
              </td>
              <td data-label="상태">{codeLabel('rsrStatus', r.status)}</td>
              <td data-label="출처" style={{ fontSize: 'var(--kr-text-xs)' }}>
                <SourceMini sources={r.sources} checkedAt={r.checked_at} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function TrainsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const n = (firstParam(sp.n) ?? '').trim().slice(0, 20);
  const [t, found] = await Promise.all([getTrains(), n ? searchNumber(n).catch(() => null) : Promise.resolve(null)]);
  const tnrGroups = codes.tnrGroup.values
    .map((g) => ({ g, rows: t.train_number_ranges.filter((r) => r.group === g) }))
    .filter((x) => x.rows.length);
  const rsrGroups = codes.rsrGroup.values
    .map((g) => ({ g, rows: t.rolling_stock_ranges.filter((r) => r.group === g) }))
    .filter((x) => x.rows.length);
  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <div className="page-head">
        <h1>열차번호·차량번호</h1>
        <p className="lead">
          <b>열차번호</b>는 운행 하나하나에 붙는 번호(예 KTX 101), <b>차량번호(차호)</b>는 차량 한 칸, <b>편성번호</b>는
          묶어 다니는 차량 한 벌의 번호로 서로 다릅니다. 열차 등급은 <a href={paths.trainClasses()}>열차 등급</a>,
          용어는 <a href={paths.terms()}>용어</a>.
        </p>
      </div>
      <form className="filters" action={paths.trains()} method="get" role="search">
        <div className="filter-row">
          <label className="label" htmlFor="num-q">
            번호 찾기
          </label>
          <input
            id="num-q"
            name="n"
            defaultValue={n}
            inputMode="text"
            placeholder="예: 102, 1001, A01"
            className="input"
          />
          <button className="btn" type="submit">
            찾기
          </button>
        </div>
      </form>
      {n ? (
        <section className="section" aria-labelledby="found-h">
          <div className="section-head">
            <h2 id="found-h">“{n}” 찾은 결과</h2>
          </div>
          {!found ? (
            <p className="note">번호를 찾지 못했습니다.</p>
          ) : (
            <>
              <h3 className="fp-sub">열차번호대 {found.train_number_ranges.length}</h3>
              {found.train_number_ranges.length ? (
                <TnrTable rows={found.train_number_ranges} />
              ) : (
                <p className="note">해당 열차번호대가 없습니다.</p>
              )}
              <h3 className="fp-sub">차량번호대 {found.rolling_stock_ranges.length}</h3>
              {found.rolling_stock_ranges.length ? (
                <RsrTable rows={found.rolling_stock_ranges} />
              ) : (
                <p className="note">해당 차량번호대가 없습니다.</p>
              )}
            </>
          )}
        </section>
      ) : null}
      <nav className="chips" aria-label="절" style={{ marginTop: 'var(--kr-space-4)' }}>
        <a className="chip" href="#train-numbers" style={{ paddingLeft: '0.6em' }}>
          1부 열차번호 {t.train_number_ranges.length}
        </a>
        <a className="chip" href="#vehicle-numbers" style={{ paddingLeft: '0.6em' }}>
          2부 차량번호·편성번호 {t.rolling_stock_ranges.length}
        </a>
      </nav>
      <section className="section" id="train-numbers" aria-labelledby="train-numbers-h">
        <div className="section-head">
          <h2 id="train-numbers-h">1부 열차번호(운행 번호)</h2>
        </div>
        {tnrGroups.map(({ g, rows }) => (
          <div key={g} id={`tnr-group-${g}`}>
            <h3 className="fp-sub">
              {codeLabel('tnrGroup', g)} <span className="muted num">{rows.length}</span>
            </h3>
            <TnrTable rows={rows} />
          </div>
        ))}
      </section>
      <section className="section" id="vehicle-numbers" aria-labelledby="vehicle-numbers-h">
        <div className="section-head">
          <h2 id="vehicle-numbers-h">2부 차량번호(차호)·편성번호</h2>
        </div>
        {rsrGroups.map(({ g, rows }) => (
          <div key={g} id={`rsn-group-${g}`}>
            <h3 className="fp-sub">
              {codeLabel('rsrGroup', g)} <span className="muted num">{rows.length}</span>
            </h3>
            <RsrTable rows={rows} />
          </div>
        ))}
      </section>
    </div>
  );
}
