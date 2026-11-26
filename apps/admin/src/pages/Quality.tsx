/**
 * 품질 대시보드(FR-ADM-090): Soft 규칙별 건수 → 규칙을 고르면 검수 매뉴얼(packages/domain quality-guide.ts)과
 * 대상 목록(쪽 넘김). 좌표·선형 규칙은 행마다 지도 도구로 바로 가는 단추를 둔다.
 */
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { entityUiMeta, isCode, type EntityType } from '@k-raildex/contracts';
import { Badge, Button, Card, CardHeader, cn, Empty } from '@k-raildex/ui';
import { BookOpen, Check } from 'lucide-react';
import { toast } from 'sonner';
import { api, apiOptional, errorText, qs, type EntityResponse } from '../lib/api';
import { toSlug } from '../lib/entity-types';
import { KeepSplitButton, MergeStationButton } from '../editors/MergeStation';

export interface QualityGuide {
  what: string;
  steps: string[];
  done: string;
  impact?: string;
}
export interface QualityRule {
  id: string;
  title: string;
  count: number;
  note?: string;
  guide?: QualityGuide | null;
}
interface QualityItem {
  entity_type: string;
  entity_id: string;
  label: string | null;
  detail: string | null;
  /** 행 처리 단추 값(V-S04: 거리 초과일 때 앞 노선별 역 id, X-station-split: 병합할 역 id) */
  action_ref?: string | null;
}

const LIMIT = 50;

/** 행에서 바로 여는 지도 도구(규칙별) */
const ROW_TOOLS: Record<string, (it: QualityItem) => { label: string; href: string } | null> = {
  'V-S02': (it) => ({ label: '지도에서 찍기', href: `/map?tab=edit&station=${encodeURIComponent(it.entity_id)}` }),
  'X-station-no-coord': (it) => ({
    label: '지도에서 찍기',
    href: `/map?tab=edit&station=${encodeURIComponent(it.entity_id)}`,
  }),
  'X-station-split': (it) => ({ label: '지도', href: `/map?tab=edit&station=${encodeURIComponent(it.entity_id)}` }),
  'X-station-near-other-name': (it) => ({
    label: '지도',
    href: `/map?tab=edit&station=${encodeURIComponent(it.entity_id)}`,
  }),
  'V-S12': (it) => ({ label: '계획 선형 편집', href: `/map?tool=geometry&plan=${encodeURIComponent(it.entity_id)}` }),
  'X-construction-no-geometry': (it) =>
    it.entity_type === 'plan'
      ? { label: '계획 선형 편집', href: `/map?tool=geometry&plan=${encodeURIComponent(it.entity_id)}` }
      : { label: 'OSM 매핑 점검', href: `/map?tool=osm&line=${encodeURIComponent(it.entity_id)}` },
};

/**
 * V-S04 [거리 맞음]: 앞 역과의 거리가 상한을 넘지만 실제로 맞는 구간이면 그때의 앞 노선별 역을 적는다
 * (line_station.gap_confirmed_prev_id). 앞 역이 바뀌면 다시 목록에 나온다. km 역행 행에는 단추가 없다.
 */
function ConfirmGap({ it }: { it: QualityItem }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async () => {
      const path = `/v1/admin/line-station/${encodeURIComponent(it.entity_id)}`;
      const cur = await api<EntityResponse<unknown>>(path);
      return api(path, { method: 'PATCH', ifMatch: cur.version, json: { gap_confirmed_prev_id: it.action_ref } });
    },
    onSuccess: async () => {
      toast.success('거리를 확인했습니다(앞 역이 바뀌면 다시 나옵니다)');
      await qc.invalidateQueries({ queryKey: ['quality'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  if (!it.action_ref) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-xs"
      disabled={m.isPending}
      title="지도·노선도로 확인했고 실제로 이 거리가 맞으면 누릅니다"
      onClick={() => m.mutate()}
    >
      <Check className="size-3.5" /> {m.isPending ? '저장 중…' : '거리 맞음'}
    </Button>
  );
}

/** 행 단위 처리(규칙별) — 지도 도구 링크 옆 */
const ROW_ACTIONS: Record<string, (it: QualityItem) => ReactNode> = {
  'V-S04': (it) => <ConfirmGap it={it} />,
  'X-station-split': (it) =>
    it.action_ref ? (
      <span className="inline-flex gap-1">
        <MergeStationButton fromId={it.entity_id} intoId={it.action_ref} />
        <KeepSplitButton stationId={it.entity_id} intoId={it.action_ref} />
      </span>
    ) : null,
};

function GuidePanel({
  guide,
  common,
  note,
}: {
  guide: QualityGuide | null | undefined;
  common: readonly string[];
  note?: string;
}) {
  if (!guide && !note) return null;
  return (
    <details open className="border-b border-border px-4 py-3 text-sm" data-testid="quality-guide">
      <summary className="flex cursor-pointer items-center gap-1.5 font-semibold select-none">
        <BookOpen className="size-4 text-primary" /> 검수 방법
      </summary>
      {note ? <p className="mt-2 text-fg-muted">{note}</p> : null}
      {guide ? (
        <div className="mt-2 flex flex-col gap-2">
          <p>{guide.what}</p>
          <ol className="list-decimal space-y-1 pl-5">
            {guide.steps.map((st, i) => (
              <li key={i}>{st}</li>
            ))}
          </ol>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            <dt className="font-semibold text-fg-muted">빠지는 조건</dt>
            <dd>{guide.done}</dd>
            {guide.impact ? (
              <>
                <dt className="font-semibold text-fg-muted">영향</dt>
                <dd>{guide.impact}</dd>
              </>
            ) : null}
          </dl>
          {common.length ? (
            <details className="text-xs text-fg-muted">
              <summary className="cursor-pointer select-none">공통 원칙</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {common.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

export function useQualityRules() {
  return useQuery({
    queryKey: ['quality'],
    queryFn: () => apiOptional<{ rules: QualityRule[]; guide_common?: string[] }>('/v1/admin/quality'),
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
  const tool = rule ? ROW_TOOLS[rule] : undefined;
  const action = rule ? ROW_ACTIONS[rule] : undefined;

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
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
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
          <Card className="min-w-0 self-start">
            <CardHeader title={current ? `${current.id} · ${current.title}` : '규칙을 고르세요'} />
            {current ? (
              <GuidePanel guide={current.guide} common={rules.data.guide_common ?? []} note={current.note} />
            ) : null}
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
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="quality-items">
                    <thead className="text-left text-xs text-fg-muted">
                      <tr>
                        <th className="px-4 py-2 whitespace-nowrap">종류</th>
                        <th className="px-4 py-2">개체</th>
                        <th className="px-4 py-2">내용</th>
                        {tool || action ? <th className="px-4 py-2" /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {items.data.items.map((it, i) => {
                        const t = isCode('entityType', it.entity_type) ? (it.entity_type as EntityType) : null;
                        return (
                          <tr key={`${it.entity_type}/${it.entity_id}/${i}`} className="border-t border-border">
                            <td className="px-4 py-1.5 text-xs whitespace-nowrap text-fg-muted">
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
                            <td className="px-4 py-1.5 text-xs break-words">{it.detail ?? ''}</td>
                            {tool || action ? (
                              <td className="px-4 py-1.5 text-right whitespace-nowrap">
                                {action?.(it)}
                                {(() => {
                                  const a = tool?.(it);
                                  return a ? (
                                    <a href={a.href} className="text-xs text-primary hover:underline">
                                      {a.label}
                                    </a>
                                  ) : null;
                                })()}
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
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
