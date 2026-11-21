/**
 * 배지 — 색 + 모양 + 글자 세 겹(NFR-OPS-020, SC 1.4.1). 상태 모양 STATUS_SHAPE, 단계 묶음 STAGE_GROUP(packages/ui tokens).
 * 라벨은 contracts 코드표에서만 가져온다.
 */
import { codeLabel, type Code, type FuzzyDate, type PublicTarget } from '@k-raildex/contracts';
import { STAGE_GROUP, STATUS_SHAPE, readableOn } from '@k-raildex/ui/tokens';
import { dday, formatFuzzy, fuzzyDateTime, lineShortLabel } from '@/lib/format';
import { paths } from '@/lib/urls';

type Status = Code<'status'>;
type Stage = Code<'planStage'>;
type Review = Code<'reviewStatus'>;

/** 상태 짧은 라벨(배지용). 긴 라벨은 title 로 */
const STATUS_SHORT: Partial<Record<Status, string>> = {
  closed: '폐지',
  abandoned: '계획 폐기',
};

export function StatusBadge({ status, unopened }: { status: Status; unopened?: boolean }) {
  const label = STATUS_SHORT[status] ?? codeLabel('status', status);
  const isUnopened = unopened ?? (status === 'planned' || status === 'under_construction');
  return (
    <span className={`badge st-${status}${isUnopened ? ' unopened' : ''}`} title={codeLabel('status', status)}>
      <i className={`shape shape-${STATUS_SHAPE[status]}`} aria-hidden="true" />
      {isUnopened ? `미개통 · ${label}` : label}
    </span>
  );
}

const STAGE_SHORT: Partial<Record<Stage, string>> = {
  construction: '공사',
  plan_listed: '계획 반영',
  prefeasibility: '사전타당성',
  feasibility: '예타',
  strategic_eia: '전략환경',
  eia: '환경영향',
};

export function StageBadge({ stage }: { stage: Stage | null }) {
  if (!stage) return <span className="badge outline">단계 미확인</span>;
  const group = STAGE_GROUP[stage];
  const line = group === 'build' || group === 'open' ? 'solid' : group === 'design' ? 'bold' : 'thin';
  return (
    <span className={`badge stage stage-${group}`} title={codeLabel('planStage', stage)} data-line={line}>
      <i aria-hidden="true">{line === 'solid' ? '━' : line === 'bold' ? '╍' : '┄'}</i>
      {STAGE_SHORT[stage] ?? codeLabel('planStage', stage)}
    </span>
  );
}

/** 검수 상태: 검수 전·이의 있음은 점선 + 글자, 검수 완료는 실선 + ● */
export function ReviewBadge({ status, showVerified = false }: { status: Review; showVerified?: boolean }) {
  if (status === 'verified')
    return showVerified ? (
      <span className="badge verified">
        <i className="shape shape-disc" aria-hidden="true" />
        검수 완료
      </span>
    ) : null;
  if (status === 'flagged')
    return (
      <span className="badge flagged">
        <i className="shape shape-ring" aria-hidden="true" />
        이의 있음
      </span>
    );
  return (
    <span className="badge review" title="자동 수집·이관 값이 섞여 있고 아직 사람이 검수하지 않았습니다">
      <i className="shape shape-ring" aria-hidden="true" />
      검수 전
    </span>
  );
}

/** 퍼지 날짜 표기 + 일 단위일 때만 D-day */
export function FuzzyDateText({
  value,
  withDday = false,
}: {
  value: FuzzyDate | null | undefined;
  withDday?: boolean;
}) {
  if (!value) return <span className="muted">—</span>;
  const d = withDday ? dday(value) : null;
  return (
    <>
      <time dateTime={fuzzyDateTime(value)} className="num">
        {formatFuzzy(value)}
      </time>
      {d ? (
        <>
          {' '}
          <span className="badge dday">{d}</span>
        </>
      ) : null}
    </>
  );
}

/** 개통 예정(기대 일정, Q94: 공식·보도 근거만) */
export function TargetText({ target }: { target: PublicTarget | null | undefined }) {
  if (!target) return <span className="muted">목표 미정</span>;
  const f = { value: target.value, precision: target.precision };
  return (
    <span>
      <FuzzyDateText value={f} withDday />
      {target.basis ? (
        <sup className="ref" title={`근거: ${codeLabel('milestoneBasis', target.basis)}`}>
          {codeLabel('milestoneBasis', target.basis)}
        </sup>
      ) : null}
      {target.delayed ? (
        <>
          {' '}
          <span className="badge delayed">지연</span>
        </>
      ) : null}
    </span>
  );
}

export interface ChipLine {
  id: string;
  name_ko: string;
  color: string | null;
}

/** 노선 칩: 노선 색 바탕 + 대비 큰 글자색(readableOn). 공식 색이 없으면 점선 칩. 이름은 늘 병기 */
export function LineChip({ line, link = true, short }: { line: ChipLine; link?: boolean; short?: boolean }) {
  const mark = lineShortLabel(line.name_ko);
  const style = line.color ? { background: line.color, color: readableOn(line.color) } : undefined;
  const inner = (
    <>
      <span className="dot" style={style} aria-hidden="true">
        {mark}
      </span>
      {short ? <span className="sr-only">{line.name_ko}</span> : line.name_ko}
    </>
  );
  const cls = `chip${line.color ? '' : ' nocolor'}`;
  return link ? (
    <a className={cls} href={paths.line(line.id)}>
      {inner}
    </a>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

/** 노선 표지(상세 머리의 원형 표지) */
export function LineMark({ name, color }: { name: string; color: string | null }) {
  const style = color
    ? { background: color, color: readableOn(color) }
    : {
        background: 'var(--kr-surface-muted)',
        border: '2px dashed var(--kr-border-strong)',
        color: 'var(--kr-fg-muted)',
      };
  return (
    <span className="line-mark" style={style} aria-hidden="true">
      {lineShortLabel(name)}
    </span>
  );
}
