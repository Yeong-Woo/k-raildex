/** 운행 계통 목록(P1): 열차/전철 탭(D21) + 권역 + 종류. 카드마다 종류·열차 등급·지나는 노선 */
import type { Metadata } from 'next';
import { codeLabel, codes } from '@k-raildex/contracts';
import { LineChip, ReviewBadge, StatusBadge } from '@/components/badges';
import { FilterRow, LinkTabs } from '@/components/tabs';
import { getLineIndex, getServices } from '@/lib/data';
import { areaCounts, areaLabel, areaMatches, byKo } from '@/lib/filters';
import { fmtNum, serviceGroupOf, type ServiceGroup } from '@/lib/format';
import { pageMeta } from '@/lib/site';
import { paths, pickParam, withQuery } from '@/lib/urls';

export const metadata: Metadata = pageMeta(
  '운행 계통',
  '열차(고속·일반·관광)와 전철(광역전철·도시철도) 운행 계통 목록 — 종류·열차 등급·지나는 노선·정차역 수.',
  '/services/',
);

type SP = Promise<Record<string, string | string[] | undefined>>;
const GROUPS = ['train', 'metro'] as const;
const GROUP_LABEL: Record<ServiceGroup, string> = { train: '열차', metro: '전철' };

export default async function ServicesPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const group = pickParam(sp.group, GROUPS, 'train');
  const area = pickParam(sp.area, ['all', ...codes.area.values] as const, 'all');
  const kind = pickParam(sp.kind, ['all', ...codes.serviceKind.values] as const, 'all');
  const current = { group, area, kind };
  const defaults = { group: 'train', area: 'all', kind: 'all' };
  const link = (change: Record<string, string | undefined>) => withQuery(paths.services(), current, change, defaults);

  const [all, lineIndex] = await Promise.all([getServices(), getLineIndex()]);
  const inGroup = all.filter((s) => serviceGroupOf(s.kind) === group);
  const kinds = codes.serviceKind.values.filter(
    (k) => serviceGroupOf(k) === group && inGroup.some((s) => s.kind === k),
  );
  const kindOk = kind === 'all' || (kinds as string[]).includes(kind) ? kind : 'all';
  const inKind = inGroup.filter((s) => kindOk === 'all' || s.kind === kindOk);
  const shown = inKind.filter((s) => areaMatches(s.areas, area)).sort(byKo);

  return (
    <div className="container" style={{ paddingBottom: 'var(--kr-space-12)' }}>
      <div className="page-head">
        <h1>운행 계통</h1>
        <p className="lead">
          열차가 실제로 달리는 이름·구간입니다. 한 운행 계통이 여러 <a href={paths.lines()}>물리 노선</a>을 지나기도
          합니다. 광역전철은 운행 계통의 종류이고, 광역철도(노선의 법적 지정)와는 다른 축입니다.
        </p>
      </div>
      <div className="filters">
        <FilterRow label="구분">
          <LinkTabs
            label="열차/전철"
            current={group}
            items={GROUPS.map((g) => ({
              value: g,
              label: GROUP_LABEL[g],
              count: all.filter((s) => serviceGroupOf(s.kind) === g).length,
              href: withQuery(paths.services(), {}, { group: g, area }, defaults),
            }))}
          />
        </FilterRow>
        <FilterRow label="종류">
          <LinkTabs
            small
            label="종류"
            current={kindOk}
            items={[
              { value: 'all', label: '전체', count: inGroup.length, href: link({ kind: 'all' }) },
              ...kinds.map((k) => ({
                value: k,
                label: codeLabel('serviceKind', k),
                count: inGroup.filter((s) => s.kind === k).length,
                href: link({ kind: k }),
              })),
            ]}
          />
        </FilterRow>
        <FilterRow label="권역">
          <LinkTabs
            small
            label="권역"
            anchor="area"
            current={area}
            items={areaCounts(inKind).map((a) => ({ ...a, label: areaLabel(a.value), href: link({ area: a.value }) }))}
          />
        </FilterRow>
      </div>
      <p className="muted num" style={{ fontSize: 'var(--kr-text-sm)' }}>
        {fmtNum(shown.length)}개 운행 계통
      </p>
      {shown.length === 0 ? (
        <p className="empty surface">조건에 맞는 운행 계통이 없습니다.</p>
      ) : (
        <div className="cards" id={`group-${group}`}>
          {shown.map((s) => (
            <article
              key={s.id}
              className={`card${s.color ? '' : ' nocolor'}`}
              style={{ ['--c' as string]: s.color ?? undefined }}
            >
              <h3>
                <a href={paths.service(s.id)}>{s.name_ko}</a>
              </h3>
              <div className="chips">
                <span className="badge outline">{codeLabel('serviceKind', s.kind)}</span>
                {s.train_class ? <span className="badge outline">{s.train_class.name_ko}</span> : null}
                {s.status !== 'operating' ? <StatusBadge status={s.status} /> : null}
                <ReviewBadge status={s.review_status} />
              </div>
              <div className="chips">
                {s.line_ids.slice(0, 6).map((id) => {
                  const l = lineIndex.get(id);
                  return l ? <LineChip key={id} line={l} /> : null;
                })}
                {s.line_ids.length > 6 ? <span className="muted">외 {s.line_ids.length - 6}</span> : null}
              </div>
              <span className="meta num">정차역 {fmtNum(s.stop_count)}개</span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
