/**
 * 단계 타임라인 + 기대 일정(FR-ADM-055). 왼쪽 = 단계 이력(지난 사실), 오른쪽 = 기대 일정(앞으로의 예정).
 * 위에 계산된 현재 단계·개통 목표·12단계 진행 띠 — DB 뷰와 같은 TS 규칙(@k-raildex/domain/calc)으로 실시간 미리 보기.
 */
import {
  codeLabel,
  codes,
  formatFuzzy,
  PLAN_STAGE_PROGRESS,
  type Code,
  type FuzzyDate,
  type PlanMilestone,
  type PlanStageEvent,
} from '@k-raildex/contracts';
import { currentStage, targetOpen } from '@k-raildex/domain/calc';
import { STAGE_COLORS, STAGE_ORDER } from '@k-raildex/map';
import { Badge, Button, Card, cn, Input, Select } from '@k-raildex/ui';
import { Plus, Trash2 } from 'lucide-react';
import { FuzzyCell } from '../form/widgets/FuzzyCell';
import { RefInput } from '../form/widgets/RefInput';

type Stage = Code<'planStage'>;

const todayYear = new Date().getFullYear();

export function PlanStagesEditor({
  events,
  milestones,
  override,
  opened,
  onChange,
  errors,
}: {
  events: PlanStageEvent[];
  milestones: PlanMilestone[];
  override: Stage | null;
  opened: FuzzyDate | null;
  onChange: (patch: { stage_events?: PlanStageEvent[]; milestones?: PlanMilestone[] }) => void;
  errors: Record<string, string>;
}) {
  // 입력 중인(불완전한) 행은 계산에서 뺀다
  const validEvents = events.filter((e) => e.stage && e.date);
  const validMs = milestones.filter((m) => m.stage && m.expected);
  const stage = currentStage(validEvents, override);
  const target = targetOpen(validMs);
  const targetYear = target?.value ? Number(target.value.slice(0, 4)) : null;
  const delayed = !opened && targetYear !== null && targetYear < todayYear;

  const setEvent = (i: number, p: Partial<PlanStageEvent>) =>
    onChange({ stage_events: events.map((e, j) => (j === i ? { ...e, ...p } : e)) });
  const setMs = (i: number, p: Partial<PlanMilestone>) =>
    onChange({ milestones: milestones.map((m, j) => (j === i ? { ...m, ...p } : m)) });
  const err = (prefix: string, i: number) =>
    Object.entries(errors)
      .filter(([k]) => k === `${prefix}.${i}` || k.startsWith(`${prefix}.${i}.`))
      .map(([k, v]) => `${k.split('.').slice(2).join('.') || ''} ${v}`.trim());

  return (
    <div className="flex flex-col gap-3" data-testid="plan-stages-editor">
      <StageBar stage={stage} target={target} delayed={delayed} override={override} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold text-fg-muted">단계 이력(지난 사실 · 날짜·출처 필수)</h4>
          {events.map((e, i) => (
            <div key={i} className="rounded-md border border-border p-2" data-testid="stage-event-row">
              <div className="grid grid-cols-[1fr_7rem_8rem_auto] items-center gap-1.5">
                <Select
                  className="h-8 text-xs"
                  aria-label="단계"
                  value={e.stage}
                  onChange={(ev) => setEvent(i, { stage: ev.target.value as Stage })}
                >
                  {codes.planStage.values.map((s) => (
                    <option key={s} value={s}>
                      {codeLabel('planStage', s)}
                    </option>
                  ))}
                </Select>
                <Select
                  className="h-8 text-xs"
                  aria-label="종류"
                  value={e.kind}
                  onChange={(ev) => setEvent(i, { kind: ev.target.value as PlanStageEvent['kind'] })}
                >
                  {codes.planStageEventKind.values.map((k) => (
                    <option key={k} value={k}>
                      {codeLabel('planStageEventKind', k)}
                    </option>
                  ))}
                </Select>
                <FuzzyCell label="날짜" value={e.date} onChange={(v) => setEvent(i, { date: v as FuzzyDate })} />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="단계 이력 삭제"
                  onClick={() => onChange({ stage_events: events.filter((_, j) => j !== i) })}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              <div className="mt-1.5 grid grid-cols-[1fr_1fr] gap-1.5">
                <RefInput
                  target="source"
                  value={e.source_id ?? null}
                  onChange={(v) => setEvent(i, { source_id: v as string })}
                />
                <Input
                  className="h-9 text-xs"
                  placeholder="메모"
                  value={e.note ?? ''}
                  onChange={(ev) => setEvent(i, { note: ev.target.value || null })}
                />
              </div>
              {e.origin && e.origin !== 'manual' ? (
                <Badge className="mt-1">{codeLabel('planStageEventOrigin', e.origin)}</Badge>
              ) : null}
              {err('stage_events', i).map((m) => (
                <p key={m} className="mt-1 text-xs text-danger">
                  {m}
                </p>
              ))}
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() =>
              onChange({
                stage_events: [
                  ...events,
                  {
                    stage: nextStage(stage),
                    kind: 'reached',
                    date: null as unknown as FuzzyDate,
                    note: null,
                    source_id: events.at(-1)?.source_id ?? (null as unknown as string),
                    origin: 'manual',
                  },
                ],
              })
            }
          >
            <Plus className="size-4" /> 단계 추가
          </Button>
        </section>
        <section className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold text-fg-muted">기대 일정(앞으로의 예정 · 공식·보도 근거만, Q94)</h4>
          {milestones.map((m, i) => (
            <div key={i} className="rounded-md border border-border p-2" data-testid="milestone-row">
              <div className="grid grid-cols-[1fr_8rem_6rem_auto] items-center gap-1.5">
                <Select
                  className="h-8 text-xs"
                  aria-label="예정 단계"
                  value={m.stage}
                  onChange={(ev) => setMs(i, { stage: ev.target.value as Stage })}
                >
                  {codes.planStage.values.map((s) => (
                    <option key={s} value={s}>
                      {codeLabel('planStage', s)}
                    </option>
                  ))}
                </Select>
                <FuzzyCell
                  label="예정 시기"
                  value={m.expected}
                  onChange={(v) => setMs(i, { expected: v as FuzzyDate })}
                />
                <Select
                  className="h-8 text-xs"
                  aria-label="근거"
                  value={m.basis}
                  onChange={(ev) => setMs(i, { basis: ev.target.value as PlanMilestone['basis'] })}
                >
                  {codes.milestoneBasis.values
                    .filter((b) => b !== 'estimate' || m.basis === 'estimate')
                    .map((b) => (
                      <option key={b} value={b}>
                        {codeLabel('milestoneBasis', b)}
                      </option>
                    ))}
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="기대 일정 삭제"
                  onClick={() => onChange({ milestones: milestones.filter((_, j) => j !== i) })}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              <div className="mt-1.5 grid grid-cols-[8rem_1fr] items-center gap-1.5">
                <FuzzyCell
                  label="발표 시점"
                  className="h-9 px-1.5 text-xs"
                  value={m.as_of}
                  onChange={(v) => setMs(i, { as_of: v })}
                />
                <RefInput target="source" value={m.source_id ?? null} onChange={(v) => setMs(i, { source_id: v })} />
              </div>
              <Input
                className="mt-1.5 h-8 text-xs"
                placeholder="메모"
                value={m.note ?? ''}
                onChange={(ev) => setMs(i, { note: ev.target.value || null })}
              />
              {err('milestones', i).map((x) => (
                <p key={x} className="mt-1 text-xs text-danger">
                  {x}
                </p>
              ))}
            </div>
          ))}
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() =>
              onChange({
                milestones: [
                  ...milestones,
                  {
                    stage: 'opened',
                    expected: null as unknown as FuzzyDate,
                    basis: 'official',
                    as_of: null,
                    source_id: milestones.at(-1)?.source_id ?? events.at(-1)?.source_id ?? null,
                    note: null,
                  },
                ],
              })
            }
          >
            <Plus className="size-4" /> 기대 일정 추가
          </Button>
        </section>
      </div>
    </div>
  );
}

function nextStage(cur: Stage | null): Stage {
  if (!cur || PLAN_STAGE_PROGRESS[cur] < 0) return 'concept';
  return STAGE_ORDER[Math.min(PLAN_STAGE_PROGRESS[cur] + 1, STAGE_ORDER.length - 1)] as Stage;
}

/** 계산된 현재 단계·개통 목표 + 12단계 진행 띠 */
export function StageBar({
  stage,
  target,
  delayed,
  override,
}: {
  stage: Stage | null;
  target: FuzzyDate | null;
  delayed: boolean;
  override: Stage | null;
}) {
  const progress = stage ? PLAN_STAGE_PROGRESS[stage] : -1;
  const inactive = stage === 'abandoned' || stage === 'dormant';
  return (
    <Card className="p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span>
          현재 단계 <strong data-testid="computed-stage">{stage ? codeLabel('planStage', stage) : '미상'}</strong>
          {override ? <span className="ml-1 text-xs text-warn">(수동 지정)</span> : null}
        </span>
        <span>
          개통 목표 <strong data-testid="computed-target">{target ? formatFuzzy(target) : '미정'}</strong>
        </span>
        {delayed ? <Badge tone="danger">지연</Badge> : null}
        <span className="ml-auto text-xs text-fg-muted">저장 전 미리 보기 · DB 뷰와 같은 규칙</span>
      </div>
      <ol className="grid grid-cols-12 gap-0.5" aria-label="12단계 진행">
        {STAGE_ORDER.map((s, i) => {
          const done = !inactive && i <= progress;
          return (
            <li key={s} className="flex flex-col items-center gap-1" title={codeLabel('planStage', s)}>
              <span
                className={cn('h-2 w-full rounded-sm', !done && 'bg-muted', i === progress && 'ring-2 ring-fg/30')}
                style={done ? { background: STAGE_COLORS[s] } : undefined}
              />
              <span
                className={cn(
                  'w-full truncate text-center text-[10px] leading-tight',
                  i === progress ? 'font-semibold text-fg' : 'text-fg-muted',
                )}
              >
                {codeLabel('planStage', s)}
              </span>
            </li>
          );
        })}
      </ol>
      {inactive ? (
        <p className="mt-1 text-xs text-fg-muted">
          {stage === 'abandoned' ? '폐기된 사업' : '휴면 — 후속 상위 계획 미반영'}
        </p>
      ) : null}
    </Card>
  );
}
