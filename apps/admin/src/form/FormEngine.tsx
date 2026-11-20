/** 스키마 기반 폼(FR-ADM-021): UI 메타데이터 그룹 순서대로 필드를 그린다 */
import { entityContracts, entityUiMeta, type EntityType } from '@k-raildex/contracts';
import { Card, FieldShell } from '@k-raildex/ui';
import type { Z } from './introspect';
import { defaultFor, WidgetInput } from './widgets/Widget';
import { specialEditor } from './special';

type Obj = Record<string, unknown>;

const WIDE = new Set([
  'textarea',
  'markdown',
  'json',
  'refs',
  'regions',
  'areas',
  'string_list',
  'sources',
  'names',
  'external_refs',
  'editor',
]);

export function contractShape(type: EntityType): Record<string, Z> {
  return (entityContracts[type].create as unknown as { shape: Record<string, Z> }).shape;
}

/** 새 레코드 기본값(계약 기본값 적용) */
export function emptyRecord(type: EntityType): Obj {
  const shape = contractShape(type);
  const out: Obj = {};
  for (const [k, s] of Object.entries(shape)) out[k] = k === 'id' ? '' : defaultFor(s);
  if ('checked_at' in shape) out.checked_at = new Date().toISOString().slice(0, 10);
  return out;
}

export function FormEngine({
  type,
  value,
  onChange,
  errors,
  mode,
}: {
  type: EntityType;
  value: Obj;
  onChange: (v: Obj) => void;
  errors: Record<string, string>;
  mode: 'create' | 'edit';
}) {
  const meta = entityUiMeta[type];
  const shape = contractShape(type);
  return (
    <div className="flex flex-col gap-4">
      {meta.groups.map((g) => {
        const fields = Object.entries(meta.fields).filter(([, f]) => f.group === g.key);
        if (fields.length === 0) return null;
        return (
          <Card key={g.key} className="p-4">
            <h3 className="mb-3 text-sm font-semibold">{g.label}</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {fields.map(([name, f]) => {
                const err = errors[name] ?? Object.entries(errors).find(([p]) => p.startsWith(`${name}.`))?.[1];
                const special = f.widget.kind === 'editor' ? specialEditor(f.widget.editor) : null;
                if (special) {
                  if (special.hidden) return null;
                  return (
                    <FieldShell
                      key={name}
                      label={special.label ?? f.label}
                      help={f.help}
                      error={special.ownErrors ? undefined : err}
                      className="md:col-span-2"
                    >
                      {special.render({ name, record: value, onChange, errors })}
                    </FieldShell>
                  );
                }
                return (
                  <FieldShell
                    key={name}
                    label={f.label}
                    help={f.help}
                    error={err}
                    htmlFor={`f-${name}`}
                    className={WIDE.has(f.widget.kind) ? 'md:col-span-2' : ''}
                  >
                    <WidgetInput
                      id={`f-${name}`}
                      widget={f.widget}
                      schema={shape[name]}
                      value={value[name]}
                      disabled={mode === 'edit' && !!f.createOnly}
                      onChange={(nv) => onChange({ ...value, [name]: nv })}
                    />
                  </FieldShell>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
