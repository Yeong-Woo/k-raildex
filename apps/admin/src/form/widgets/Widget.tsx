/** 위젯 디스패처 — UI 메타데이터의 widget 종류로 입력 컴포넌트를 고른다 */
import { useState } from 'react';
import { codes, formatFuzzy, isValidFuzzy, type CodeDomain, type FuzzyDate, type Widget } from '@k-raildex/contracts';
import { Button, Input, Select, Textarea } from '@k-raildex/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useReference } from '../../lib/reference';
import { arrayElement, CHILD_LABELS, inferWidget, shapeOf, unwrap, type Z } from '../introspect';
import { RefInput, RefsInput } from './RefInput';

export interface WidgetProps {
  widget: Widget;
  value: unknown;
  onChange: (v: unknown) => void;
  /** 계약의 이 필드 스키마(하위 목록 편집에 필요) */
  schema?: Z | undefined;
  id?: string;
  disabled?: boolean;
}

const str = (v: unknown) => (v == null ? '' : String(v));
const orNull = (s: string) => (s === '' ? null : s);

export function WidgetInput({ widget, value, onChange, schema, id, disabled }: WidgetProps) {
  switch (widget.kind) {
    case 'id':
    case 'text':
    case 'url':
    case 'document':
      return (
        <Input
          id={id}
          disabled={disabled}
          type={widget.kind === 'url' ? 'url' : 'text'}
          value={str(value)}
          onChange={(e) => onChange(orNull(e.target.value))}
        />
      );
    case 'textarea':
    case 'markdown':
      return (
        <Textarea
          id={id}
          disabled={disabled}
          rows={widget.kind === 'markdown' ? 6 : 3}
          value={str(value)}
          onChange={(e) => onChange(orNull(e.target.value))}
        />
      );
    case 'number':
      return (
        <Input
          id={id}
          disabled={disabled}
          type="number"
          step={widget.integer ? 1 : 'any'}
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    case 'boolean':
      return (
        <BoolSelect
          id={id}
          value={value as boolean | null}
          onChange={onChange}
          nullable={schema ? unwrap(schema).nullable : true}
        />
      );
    case 'date':
      return (
        <Input
          id={id}
          disabled={disabled}
          type="date"
          value={str(value)}
          onChange={(e) => onChange(orNull(e.target.value))}
        />
      );
    case 'color':
      return (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={str(value) || '#000000'}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="h-9 w-12 rounded border border-border"
          />
          <Input id={id} value={str(value)} placeholder="#RRGGBB" onChange={(e) => onChange(orNull(e.target.value))} />
        </div>
      );
    case 'code':
      return (
        <CodeSelect
          id={id}
          domain={widget.domain}
          value={value as string | null}
          onChange={onChange}
          nullable={schema ? unwrap(schema).nullable : true}
        />
      );
    case 'fuzzy':
      return <FuzzyInput value={value as FuzzyDate | null} onChange={onChange} />;
    case 'point':
      return <PointInput value={value as { lat: number; lng: number } | null} onChange={onChange} />;
    case 'ref':
      return (
        <RefInput
          id={id}
          target={widget.target}
          value={(value as string | null) ?? null}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'refs':
      return <RefsInput target={widget.target} value={(value as string[] | null) ?? []} onChange={onChange} />;
    case 'region':
      return <RegionSelect id={id} value={value as string | null} onChange={onChange} />;
    case 'regions':
      return <RegionMulti value={(value as string[] | null) ?? []} onChange={onChange} />;
    case 'area':
      return <CodeSelect id={id} domain="area" value={value as string | null} onChange={onChange} nullable />;
    case 'areas':
      return <CodeMulti domain="area" value={(value as string[] | null) ?? []} onChange={onChange} />;
    case 'string_list':
      return <StringList value={(value as string[] | null) ?? []} onChange={onChange} />;
    case 'json':
      return <JsonInput value={value} onChange={onChange} />;
    case 'sources':
    case 'names':
    case 'external_refs':
    case 'editor':
      if (!schema) return <p className="text-xs text-danger">스키마 없음</p>;
      return arrayElement(schema) ? (
        <ObjectListEditor
          schema={schema}
          value={(value as Record<string, unknown>[] | null) ?? []}
          onChange={onChange}
        />
      ) : (
        <ObjectEditor schema={schema} value={value as Record<string, unknown> | null} onChange={onChange} />
      );
  }
}

function BoolSelect({
  id,
  value,
  onChange,
  nullable,
}: {
  id?: string | undefined;
  value: boolean | null;
  onChange: (v: unknown) => void;
  nullable: boolean;
}) {
  return (
    <Select
      id={id}
      value={value == null ? '' : value ? 'true' : 'false'}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'true')}
    >
      {nullable ? <option value="">미확인</option> : null}
      <option value="true">예</option>
      <option value="false">아니요</option>
    </Select>
  );
}

function CodeSelect({
  id,
  domain,
  value,
  onChange,
  nullable,
}: {
  id?: string | undefined;
  domain: CodeDomain;
  value: string | null;
  onChange: (v: unknown) => void;
  nullable: boolean;
}) {
  const table = codes[domain];
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
      {nullable || value == null ? <option value="">—</option> : null}
      {table.values.map((v) => (
        <option key={v} value={v} title={(table.labels as Record<string, { desc?: string }>)[v]?.desc}>
          {(table.labels as Record<string, { ko: string }>)[v]?.ko ?? v} ({v})
        </option>
      ))}
    </Select>
  );
}

function CodeMulti({
  domain,
  value,
  onChange,
}: {
  domain: CodeDomain;
  value: string[];
  onChange: (v: unknown) => void;
}) {
  const table = codes[domain];
  return (
    <div className="flex flex-wrap gap-2">
      {table.values.map((v) => (
        <label key={v} className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={value.includes(v)}
            onChange={(e) => onChange(e.target.checked ? [...value, v] : value.filter((x) => x !== v))}
          />
          {(table.labels as Record<string, { ko: string }>)[v]?.ko ?? v}
        </label>
      ))}
    </div>
  );
}

function RegionSelect({
  id,
  value,
  onChange,
}: {
  id?: string | undefined;
  value: string | null;
  onChange: (v: unknown) => void;
}) {
  const ref = useReference();
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
      <option value="">미상</option>
      {ref.data?.regions.map((r) => (
        <option key={r.code} value={r.code}>
          {r.name_ko}
        </option>
      ))}
    </Select>
  );
}

function RegionMulti({ value, onChange }: { value: string[]; onChange: (v: unknown) => void }) {
  const ref = useReference();
  return (
    <div className="flex flex-wrap gap-2">
      {ref.data?.regions.map((r) => (
        <label key={r.code} className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={value.includes(r.code)}
            onChange={(e) => onChange(e.target.checked ? [...value, r.code] : value.filter((x) => x !== r.code))}
          />
          {r.short_ko}
        </label>
      ))}
    </div>
  );
}

const PRECISIONS = [
  ['', '없음'],
  ['day', '일'],
  ['month', '월'],
  ['half', '반기'],
  ['year', '연'],
  ['unknown', '미상'],
] as const;

/** 퍼지 날짜(FR-ADM-031): 정밀도 → 입력 형태 */
export function FuzzyInput({ value, onChange }: { value: FuzzyDate | null; onChange: (v: unknown) => void }) {
  const p = value?.precision ?? '';
  const v = value?.value ?? '';
  const valid = !value || isValidFuzzy(value.value, value.precision);
  const placeholder: Record<string, string> = {
    day: 'YYYY-MM-DD',
    month: 'YYYY-MM',
    half: 'YYYY-H1 / YYYY-H2',
    year: 'YYYY',
  };
  return (
    <div className="flex items-center gap-2">
      <Select
        className="w-24 shrink-0"
        value={p}
        onChange={(e) => {
          const np = e.target.value;
          if (np === '') onChange(null);
          else if (np === 'unknown') onChange({ value: null, precision: 'unknown' });
          else onChange({ value: v || null, precision: np });
        }}
      >
        {PRECISIONS.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </Select>
      {p && p !== 'unknown' ? (
        <Input
          aria-invalid={!valid}
          placeholder={placeholder[p]}
          type={p === 'day' ? 'date' : p === 'month' ? 'month' : 'text'}
          value={v}
          onChange={(e) => onChange({ value: e.target.value || null, precision: p })}
        />
      ) : null}
      {value ? (
        <span className="shrink-0 text-xs text-fg-muted">{valid ? formatFuzzy(value) : '형식 오류'}</span>
      ) : null}
    </div>
  );
}

function PointInput({
  value,
  onChange,
}: {
  value: { lat: number; lng: number } | null;
  onChange: (v: unknown) => void;
}) {
  const set = (k: 'lat' | 'lng', s: string) => {
    if (s === '' && (!value || (k === 'lat' ? value.lng : value.lat) == null)) return onChange(null);
    onChange({ lat: value?.lat ?? 0, lng: value?.lng ?? 0, [k]: Number(s) });
  };
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        step="any"
        placeholder="위도"
        value={value?.lat ?? ''}
        onChange={(e) => set('lat', e.target.value)}
      />
      <Input
        type="number"
        step="any"
        placeholder="경도"
        value={value?.lng ?? ''}
        onChange={(e) => set('lng', e.target.value)}
      />
      {value ? (
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          지우기
        </Button>
      ) : null}
    </div>
  );
}

function StringList({ value, onChange }: { value: string[]; onChange: (v: unknown) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {value.map((s, i) => (
        <div key={i} className="flex gap-1">
          <Input value={s} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            aria-label="삭제"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" className="self-start" onClick={() => onChange([...value, ''])}>
        <Plus className="size-4" /> 추가
      </Button>
    </div>
  );
}

/** JSON 값 필드(부가 정보·다운로드 정보·선형 좌표 등 원래 JSON 인 필드에만) */
function JsonInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(() => (value == null ? '' : JSON.stringify(value, null, 2)));
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <Textarea
        className="font-mono text-xs"
        rows={4}
        value={text}
        aria-invalid={!!err}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() === '') {
            setErr(null);
            onChange(null);
            return;
          }
          try {
            onChange(JSON.parse(e.target.value));
            setErr(null);
          } catch {
            setErr('JSON 형식 오류');
          }
        }}
      />
      {err ? <p className="text-xs text-danger">{err}</p> : null}
    </div>
  );
}

/** 하위 객체 목록 편집(반영 내역·단계 이력·출처·별칭 …) — 요소 스키마에서 필드를 만든다 */
export function ObjectListEditor({
  schema,
  value,
  onChange,
}: {
  schema: Z;
  value: Record<string, unknown>[];
  onChange: (v: unknown) => void;
}) {
  const el = arrayElement(schema)!;
  const shape = shapeOf(el);
  const keys = Object.keys(shape);
  const empty = () => Object.fromEntries(keys.map((k) => [k, defaultFor(shape[k]!)]));
  return (
    <div className="flex flex-col gap-2">
      {value.map((item, i) => (
        <div key={i} className="rounded-md border border-border p-2">
          <div className="mb-1 flex items-center gap-1">
            <span className="text-xs font-semibold text-fg-muted">#{i + 1}</span>
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => onChange(move(value, i, i - 1))}>
                ↑
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={i === value.length - 1}
                onClick={() => onChange(move(value, i, i + 1))}
              >
                ↓
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                aria-label="삭제"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
          <ObjectFields
            shape={shape}
            value={item}
            onChange={(nv) => onChange(value.map((x, j) => (j === i ? nv : x)))}
          />
        </div>
      ))}
      <Button variant="secondary" size="sm" className="self-start" onClick={() => onChange([...value, empty()])}>
        <Plus className="size-4" /> 항목 추가
      </Button>
    </div>
  );
}

/** 하위 객체 하나(또는 없음) */
function ObjectEditor({
  schema,
  value,
  onChange,
}: {
  schema: Z;
  value: Record<string, unknown> | null;
  onChange: (v: unknown) => void;
}) {
  const shape = shapeOf(schema);
  if (!value) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onChange(Object.fromEntries(Object.keys(shape).map((k) => [k, defaultFor(shape[k]!)])))}
      >
        <Plus className="size-4" /> 입력
      </Button>
    );
  }
  return (
    <div className="rounded-md border border-border p-2">
      <ObjectFields shape={shape} value={value} onChange={onChange} />
      <Button variant="ghost" size="sm" className="mt-1" onClick={() => onChange(null)}>
        비우기
      </Button>
    </div>
  );
}

function ObjectFields({
  shape,
  value,
  onChange,
}: {
  shape: Record<string, Z>;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {Object.entries(shape).map(([k, s]) => {
        const w = inferWidget(k, s);
        const wide = w.kind === 'refs' || w.kind === 'json' || w.kind === 'string_list' || w.kind === 'textarea';
        return (
          <div key={k} className={wide ? 'md:col-span-2' : ''}>
            <label className="mb-0.5 block text-xs text-fg-muted">{CHILD_LABELS[k] ?? k}</label>
            <WidgetInput widget={w} schema={s} value={value[k]} onChange={(nv) => onChange({ ...value, [k]: nv })} />
          </div>
        );
      })}
    </div>
  );
}

export function defaultFor(s: Z): unknown {
  // 계약의 기본값(.default(...))이 있으면 그 값
  const d = s._zod.def as { type: string; defaultValue?: unknown };
  if (d.type === 'default') {
    const v = typeof d.defaultValue === 'function' ? (d.defaultValue as () => unknown)() : d.defaultValue;
    return structuredClone(v);
  }
  const b = unwrap(s);
  const t = b.base._zod.def.type;
  if (t === 'array') return [];
  if (t === 'boolean') return b.nullable ? null : false;
  return null;
}

function move<T>(a: T[], i: number, j: number): T[] {
  const b = [...a];
  const [x] = b.splice(i, 1);
  b.splice(j, 0, x!);
  return b;
}
