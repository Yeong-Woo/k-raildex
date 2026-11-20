/** 설정 › 참조 테이블(읽기 전용): 권역·시·도·외부 시스템 — `/v1/admin/reference` */
import type { ReactNode } from 'react';
import { Card, CardHeader, Empty } from '@k-raildex/ui';
import { errorText } from '../lib/api';
import { useReference } from '../lib/reference';

function Table({ title, head, rows }: { title: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <Card className="self-start">
      <CardHeader title={`${title} ${rows.length}`} />
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-fg-muted">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-1.5">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function ReferencePanel() {
  const ref = useReference();
  if (ref.isLoading) return <Empty>불러오는 중…</Empty>;
  if (ref.error || !ref.data) return <Empty>{errorText(ref.error)}</Empty>;
  const areaName = new Map(ref.data.areas.map((a) => [a.code, a.name_ko]));
  return (
    <div className="flex flex-col gap-2" data-testid="reference-tables">
      <p className="text-xs text-fg-muted">
        참조 테이블은 DB 참조 시드(packages/db)로 관리합니다. 여기서는 고칠 수 없습니다.
      </p>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Table
          title="권역"
          head={['코드', '이름']}
          rows={ref.data.areas.map((a) => [<code key="c">{a.code}</code>, a.name_ko])}
        />
        <Table
          title="시·도"
          head={['코드', '이름', '약칭', '권역']}
          rows={ref.data.regions.map((r) => [
            <code key="c">{r.code}</code>,
            r.name_ko,
            r.short_ko,
            areaName.get(r.area_code) ?? r.area_code,
          ])}
        />
        <Table
          title="외부 시스템"
          head={['코드', '이름', '개체']}
          rows={ref.data.external_systems.map((s) => [<code key="c">{s.code}</code>, s.name_ko, s.entity_type])}
        />
      </div>
    </div>
  );
}
