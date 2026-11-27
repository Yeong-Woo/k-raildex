/**
 * 계획 "노선과 역할"(plan_line) 편집 — 일반 하위 목록 편집기 + [새 노선 만들기](2026-11-27 사용자 지시, 품질 X-plan-no-line).
 * 새 노선 만들기: 계획 이름·출처로 노선(계획/공사 중 상태)을 바로 만들고(POST /v1/admin/line), 이 계획의 노선 목록에 역할과 함께 넣는다.
 * 계획 연결은 계획을 저장해야 반영된다(노선 레코드는 이미 만들어짐 — 계획을 저장하지 않으면 노선만 남는다).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  codeLabel,
  codes,
  entityContracts,
  ID_PREFIX,
  isEntityId,
  type Code,
  type PlanLine,
  type Widget,
} from '@k-raildex/contracts';
import { Button, Dialog, Input, Select } from '@k-raildex/ui';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText } from '../lib/api';
import type { Z } from '../form/introspect';
import { WidgetInput } from '../form/widgets/Widget';

type Obj = Record<string, unknown>;
interface SourceLink {
  source_id: string;
  field?: string | null;
  locator?: string | null;
  note?: string | null;
}

const planShape = (entityContracts.plan.create as unknown as { shape: Record<string, Z> }).shape;
const LINES_WIDGET: Widget = { kind: 'editor', editor: 'plan_lines' } as Widget;

/** plan-seoul-seobu-line → line-seoul-seobu-line */
export const suggestLineId = (planId: string) =>
  planId.startsWith(`${ID_PREFIX.plan}-`) ? `${ID_PREFIX.line}-${planId.slice(ID_PREFIX.plan.length + 1)}` : '';

/** 계획 출처를 노선 출처로(필드 지정은 계획 필드라 버린다, 같은 출처는 하나만) */
function lineSources(planSources: SourceLink[]): SourceLink[] {
  const seen = new Set<string>();
  const out: SourceLink[] = [];
  for (const s of planSources) {
    if (seen.has(s.source_id)) continue;
    seen.add(s.source_id);
    out.push({ source_id: s.source_id, locator: s.locator ?? null, note: s.note ?? null });
  }
  return out;
}

function NewLineDialog({
  record,
  open,
  onOpenChange,
  onCreated,
}: {
  record: Obj;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (row: PlanLine) => void;
}) {
  const qc = useQueryClient();
  const planId = String(record.id ?? '');
  const sources = lineSources((record.sources as SourceLink[] | null) ?? []);
  const [id, setId] = useState(suggestLineId(planId));
  const [nameKo, setNameKo] = useState(String(record.name_ko ?? ''));
  const [nameEn, setNameEn] = useState(String(record.name_en ?? ''));
  const [category, setCategory] = useState<Code<'lineCategory'>>('conventional');
  const [railClass, setRailClass] = useState<Code<'railClass'>>('conventional');
  const [status, setStatus] = useState<'planned' | 'under_construction'>('planned');
  const [role, setRole] = useState<Code<'planLineRole'>>('new');
  const idOk = isEntityId('line', id);

  const create = useMutation({
    mutationFn: () =>
      api('/v1/admin/line', {
        method: 'POST',
        json: {
          id,
          name_ko: nameKo.trim(),
          name_en: nameEn.trim() || null,
          category,
          rail_class: railClass,
          status,
          checked_at: new Date().toISOString().slice(0, 10),
          sources,
        },
      }),
    onSuccess: async () => {
      toast.success(`노선 ${id} 를 만들었습니다 — 계획을 저장하면 연결됩니다`);
      onCreated({ line_id: id, role, from_line_station_id: null, to_line_station_id: null, note: null });
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: ['quality'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const label = (t: string, el: ReactNode, htmlFor?: string) => (
    <div>
      <label className="mb-1 block text-xs text-fg-muted" htmlFor={htmlFor}>
        {t}
      </label>
      {el}
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="새 노선 만들기"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            data-testid="new-line-create"
            disabled={!idOk || !nameKo.trim() || !sources.length || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? '만드는 중…' : '노선 만들기'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2" data-testid="new-line-dialog">
        {label(
          '노선 id',
          <>
            <Input id="nl-id" value={id} onChange={(e) => setId(e.target.value.trim())} />
            {!idOk ? <p className="mt-1 text-xs text-danger">line- 로 시작하는 영문 소문자·숫자·하이픈</p> : null}
          </>,
          'nl-id',
        )}
        {label(
          '이 계획에서의 역할',
          <Select id="nl-role" value={role} onChange={(e) => setRole(e.target.value as Code<'planLineRole'>)}>
            {codes.planLineRole.values.map((v) => (
              <option key={v} value={v}>
                {codeLabel('planLineRole', v)}
              </option>
            ))}
          </Select>,
          'nl-role',
        )}
        {label('이름', <Input id="nl-name" value={nameKo} onChange={(e) => setNameKo(e.target.value)} />, 'nl-name')}
        {label(
          '영문 이름',
          <Input id="nl-name-en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />,
          'nl-name-en',
        )}
        {label(
          '노선 종류',
          <Select
            id="nl-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as Code<'lineCategory'>)}
          >
            {codes.lineCategory.values.map((v) => (
              <option key={v} value={v}>
                {codeLabel('lineCategory', v)}
              </option>
            ))}
          </Select>,
          'nl-category',
        )}
        {label(
          '철도 구분',
          <Select id="nl-rail" value={railClass} onChange={(e) => setRailClass(e.target.value as Code<'railClass'>)}>
            {codes.railClass.values.map((v) => (
              <option key={v} value={v}>
                {codeLabel('railClass', v)}
              </option>
            ))}
          </Select>,
          'nl-rail',
        )}
        {label(
          '상태',
          <Select
            id="nl-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as 'planned' | 'under_construction')}
          >
            <option value="planned">{codeLabel('status', 'planned')}</option>
            <option value="under_construction">{codeLabel('status', 'under_construction')}</option>
          </Select>,
          'nl-status',
        )}
        <div className="text-xs sm:col-span-2">
          <span className="text-fg-muted">출처(계획에서 가져옴): </span>
          {sources.length ? (
            sources.map((s) => s.source_id).join(', ')
          ) : (
            <span className="text-danger">계획에 출처가 없습니다 — 계획에 출처를 먼저 붙이세요</span>
          )}
        </div>
        <p className="text-xs text-fg-muted sm:col-span-2">
          노선은 바로 만들어집니다. 역·선형·운영기관은 만든 뒤 노선 편집에서 채웁니다.
        </p>
      </div>
    </Dialog>
  );
}

export function PlanLinesEditor({ name, record, onChange }: { name: string; record: Obj; onChange: (v: Obj) => void }) {
  const [open, setOpen] = useState(false);
  const rows = (record[name] as PlanLine[] | null) ?? [];
  const isNew = !isEntityId('plan', String(record.id ?? ''));
  return (
    <div className="flex flex-col gap-2" data-testid="plan-lines-editor">
      {!rows.length ? (
        <p className="rounded border border-danger/30 bg-danger-soft/40 px-2 py-1 text-xs text-danger">
          이어진 노선이 없습니다. 기존 노선이면 [항목 추가]로 고르고, 새로 생기는 노선이면 [새 노선 만들기].
        </p>
      ) : null}
      <WidgetInput
        widget={LINES_WIDGET}
        schema={planShape[name]}
        value={rows}
        onChange={(v) => onChange({ ...record, [name]: v })}
      />
      <div>
        <Button
          size="sm"
          variant="outline"
          data-testid="new-line-open"
          disabled={isNew}
          title={isNew ? '계획 id 를 먼저 정하세요' : undefined}
          onClick={() => setOpen(true)}
        >
          <Plus className="size-3.5" /> 새 노선 만들기
        </Button>
      </div>
      {open ? (
        <NewLineDialog
          record={record}
          open={open}
          onOpenChange={setOpen}
          onCreated={(row) => onChange({ ...record, [name]: [...rows, row] })}
        />
      ) : null}
    </div>
  );
}
