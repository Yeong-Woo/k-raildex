/** 특수 편집기(FR-ADM-050~) — UI 메타데이터 widget editor 이름으로 일반 하위 목록 편집기를 바꾼다 */
import type { ReactNode } from 'react';
import type { Code, FuzzyDate, PlanMilestone, PlanStageEvent, StopPattern } from '@k-raildex/contracts';
import { PlanStagesEditor } from '../editors/PlanStagesEditor';
import { StopPatternMatrix } from '../editors/StopPatternMatrix';

type Obj = Record<string, unknown>;

interface SpecialEditor {
  /** 다른 특수 편집기가 함께 그리는 필드 */
  hidden?: boolean;
  label?: string;
  /** 하위 행 오류를 편집기 안에서 보여 준다 */
  ownErrors?: boolean;
  render: (p: { name: string; record: Obj; onChange: (v: Obj) => void; errors: Record<string, string> }) => ReactNode;
}

const SPECIAL: Record<string, SpecialEditor> = {
  stop_patterns: {
    render: ({ name, record, onChange }) => (
      <StopPatternMatrix
        value={(record[name] as StopPattern[] | null) ?? []}
        lines={(record.lines as string[] | null) ?? []}
        onChange={(v) => onChange({ ...record, [name]: v })}
      />
    ),
  },
  plan_stages: {
    label: '단계 이력 · 기대 일정',
    ownErrors: true,
    render: ({ record, onChange, errors }) => (
      <PlanStagesEditor
        events={(record.stage_events as PlanStageEvent[] | null) ?? []}
        milestones={(record.milestones as PlanMilestone[] | null) ?? []}
        override={(record.stage_override as Code<'planStage'> | null) ?? null}
        opened={(record.opened as FuzzyDate | null) ?? null}
        errors={errors}
        onChange={(patch) => onChange({ ...record, ...patch })}
      />
    ),
  },
  plan_milestones: { hidden: true, render: () => null },
};

export function specialEditor(name: string): SpecialEditor | null {
  return SPECIAL[name] ?? null;
}
