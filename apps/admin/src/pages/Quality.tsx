/** 품질 대시보드(FR-ADM-090): Soft 규칙별 건수 → 규칙을 고르면 대상 목록(쪽 넘김) */
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { entityUiMeta, isCode, type EntityType } from '@k-raildex/contracts';
import { Badge, Button, Card, CardHeader, cn, Empty } from '@k-raildex/ui';
import { apiOptional, errorText, qs } from '../lib/api';
import { toSlug } from '../lib/entity-types';

export interface QualityRule {
  id: string;
  title: string;
  count: number;
}
interface QualityItem {
  entity_type: string;
  entity_id: string;
  label: string | null;
  detail: string | null;
}

const LIMIT = 50;

export function useQualityRules() {
  return useQuery({
    queryKey: ['quality'],
    queryFn: () => apiOptional<{ rules: QualityRule[] }>('/v1/admin/quality'),
  });
}

export function Quality() {
  const search = useSearch({ from: '/quality' });
  const navigate = useNavigate({ from: '/quality' });
  const rules = useQualityRules();
  const rule = search.rule ?? null;
  const offset = search.offset ?? 0;
  const items = useQuery({
    queryKey: ['quality', rule, offset],
    enabled: !!rule,
    queryFn: () =>
      apiOptional<{ items: QualityItem[]; total: number }>(
        `/v1/admin/quality/${encodeURIComponent(rule!)}${qs({ limit: LIMIT, offset })}`,
      ),
  });
  const current = rules.data?.rules.find((r) => r.id === rule);
  const total = items.data?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-bold">품질</h1>
      {rules.isLoading ? (
        <Empty>불러오는 중…</Empty>
      ) : rules.error ? (
        <Empty>{errorText(rules.error)}</Empty>
      ) : !rules.data ? (
        <Card>
          <Empty>품질 API(/v1/admin/quality)가 아직 없습니다.</Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_1fr]">
          <Card className="self-start">
            <CardHeader title={`규칙 ${rules.data.rules.length}개`} />
            <ul className="divide-y divide-border text-sm" data-testid="quality-rules">
              {rules.data.rules.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => void navigate({ search: { rule: r.id, offset: undefined } })}
                    className={cn(
                      'flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-muted',
                      r.id === rule && 'bg-muted font-medium',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <code className="block text-[11px] text-fg-muted">{r.id}</code>
                      {r.title}
                    </span>
                    <Badge tone={r.count === 0 ? 'good' : 'warn'}>{r.count.toLocaleString()}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="self-start">
            <CardHeader title={current ? `${current.id} · ${current.title}` : '규칙을 고르세요'} />
            {!rule ? (
              <Empty>왼쪽에서 규칙을 고르면 해당 개체 목록이 나옵니다.</Empty>
            ) : items.isLoading ? (
              <Empty>불러오는 중…</Empty>
            ) : items.error ? (
              <Empty>{errorText(items.error)}</Empty>
            ) : !items.data?.items.length ? (
              <Empty>해당 없음</Empty>
            ) : (
              <>
                <table className="w-full text-sm" data-testid="quality-items">
                  <thead className="text-left text-xs text-fg-muted">
                    <tr>
                      <th className="px-4 py-2">종류</th>
                      <th className="px-4 py-2">개체</th>
                      <th className="px-4 py-2">내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.data.items.map((it) => {
                      const t = isCode('entityType', it.entity_type) ? (it.entity_type as EntityType) : null;
                      return (
                        <tr key={`${it.entity_type}/${it.entity_id}`} className="border-t border-border">
                          <td className="px-4 py-1.5 text-xs text-fg-muted">
                            {t ? entityUiMeta[t].label : it.entity_type}
                          </td>
                          <td className="px-4 py-1.5">
                            {t ? (
                              <Link
                                to="/data/$type/$id"
                                params={{ type: toSlug(t), id: it.entity_id }}
                                search={{}}
                                className="hover:underline"
                              >
                                {it.label ?? it.entity_id}
                              </Link>
                            ) : (
                              (it.label ?? it.entity_id)
                            )}
                            <code className="ml-2 text-xs text-fg-muted">{it.entity_id}</code>
                          </td>
                          <td className="px-4 py-1.5 text-xs">{it.detail ?? ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-sm">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={offset === 0}
                    onClick={() =>
                      void navigate({ search: { rule, offset: Math.max(0, offset - LIMIT) || undefined } })
                    }
                  >
                    이전
                  </Button>
                  <span className="text-fg-muted">
                    {offset + 1}–{Math.min(offset + LIMIT, total)} / {total}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={offset + LIMIT >= total}
                    onClick={() => void navigate({ search: { rule, offset: offset + LIMIT } })}
                  >
                    다음
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
