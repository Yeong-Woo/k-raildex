/** 대시보드(FR-ADM-090): 데이터 판·개체 수·검수 대기·최근 변경 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { codeLabel, entityUiMeta, type EntityType } from '@k-raildex/contracts';
import { Badge, Card, CardHeader, Empty } from '@k-raildex/ui';
import { api, qs } from '../lib/api';
import { toSlug } from '../lib/entity-types';
import { statusTone, type ChangesetRow } from './Changesets';

interface Meta {
  data_version: { version: number; committed_at: string; changeset_id: string | null } | null;
  entities: Record<string, { active: number; deleted: number }>;
}

export function Dashboard() {
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<Meta>('/v1/meta') });
  const drafts = useQuery({
    queryKey: ['changesets', 'draft'],
    queryFn: () =>
      api<{ items: ChangesetRow[]; total: number }>(`/v1/admin/changesets${qs({ status: 'draft', limit: 10 })}`),
  });
  const recent = useQuery({
    queryKey: ['changesets', 'recent'],
    queryFn: () => api<{ items: ChangesetRow[] }>(`/v1/admin/changesets${qs({ status: 'applied', limit: 10 })}`),
  });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-bold">대시보드</h1>
      <Card>
        <CardHeader
          title={`데이터 판 ${meta.data?.data_version?.version ?? '-'}${meta.data?.data_version ? ` · ${meta.data.data_version.committed_at.slice(0, 16).replace('T', ' ')}` : ''}`}
        />
        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4 lg:grid-cols-6">
          {Object.entries(meta.data?.entities ?? {}).map(([t, c]) => (
            <Link
              key={t}
              to="/data/$type"
              params={{ type: toSlug(t as EntityType) }}
              search={{}}
              className="rounded-md border border-border p-2 hover:bg-muted"
            >
              <div className="text-xs text-fg-muted">{entityUiMeta[t as EntityType]?.label ?? t}</div>
              <div className="text-lg font-semibold">{c.active.toLocaleString()}</div>
              {c.deleted ? <div className="text-xs text-fg-muted">휴지통 {c.deleted}</div> : null}
            </Link>
          ))}
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChangesetCard title={`검수 대기 ${drafts.data?.total ?? 0}건`} items={drafts.data?.items} />
        <ChangesetCard title="최근 반영" items={recent.data?.items} />
      </div>
    </div>
  );
}

function ChangesetCard({ title, items }: { title: string; items: ChangesetRow[] | undefined }) {
  return (
    <Card>
      <CardHeader title={title} />
      {!items?.length ? (
        <Empty>없음</Empty>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {items.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-4 py-2">
              <Link to="/changesets/$id" params={{ id: c.id }} className="truncate hover:underline">
                {c.title}
              </Link>
              <Badge tone={statusTone(c.status)} className="ml-auto shrink-0">
                {codeLabel('changesetStatus', c.status as 'draft')}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
