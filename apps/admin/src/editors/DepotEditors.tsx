/**
 * 차량기지 정보(0034): 역 그룹 kind depot 일 때만 기능·운영기관·개통과 담당 노선을 편집한다(V-H19).
 * 붙은 기지선은 역 그룹의 노선역(예: 광명주박기지선 위 광명주박기지)으로 나타낸다 — [노선별] 탭.
 */
import { entityContracts, type Widget } from '@k-raildex/contracts';
import type { Z } from '../form/introspect';
import { WidgetInput } from '../form/widgets/Widget';

type Obj = Record<string, unknown>;
const shape = (entityContracts.station.create as unknown as { shape: Record<string, Z> }).shape;

export function DepotField({
  name,
  record,
  onChange,
}: {
  name: 'depot' | 'depot_lines';
  record: Obj;
  onChange: (v: Obj) => void;
}) {
  if (record.kind !== 'depot') {
    const has = name === 'depot' ? record.depot != null : ((record.depot_lines as unknown[] | null) ?? []).length > 0;
    return (
      <p className="text-xs text-fg-muted" data-testid={`${name}-hint`}>
        역 종류가 "차량기지"일 때 씁니다.
        {has ? (
          <span className="text-danger"> 지금 값이 있습니다 — 저장하면 V-H19 로 거부됩니다. 비우세요.</span>
        ) : null}
      </p>
    );
  }
  const widget = { kind: 'editor', editor: name === 'depot' ? 'station_depot' : 'station_depot_lines' } as Widget;
  const value =
    name === 'depot'
      ? (record.depot ?? { functions: [], operator_id: null, opened: null, note: null })
      : (record.depot_lines ?? []);
  return (
    <div data-testid={`${name}-editor`}>
      <WidgetInput
        widget={widget}
        schema={shape[name]}
        value={value}
        onChange={(v) => onChange({ ...record, [name]: v })}
      />
    </div>
  );
}
