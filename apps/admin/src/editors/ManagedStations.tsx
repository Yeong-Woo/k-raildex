/**
 * 관리역 ↔ 소속 노선역(2026-11-27 사용자 지시 — 한국철도공사 직제규정 시행세칙의 관리역 체계, 0032).
 * 정거장 등급·관리역은 노선역 단위다(경인선 소사 = 보통역·부천역 소속, 서해선 소사 = 무배치간이역·부천역 소속).
 * 노선역 상세 [관리역] 탭: 이 노선역이 관리역이면 소속 노선역 목록·추가·빼기(각 소속 노선역의 managed_by_id 를 바꾼다),
 * 아니면 이 노선역의 관리역을 보여 준다. 운영기관이 한국철도공사인 노선역만 쓸 수 있다(V-H18).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { codeLabel, isCode } from '@k-raildex/contracts';
import { Button, Card, CardHeader, Empty, Input } from '@k-raildex/ui';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText, qs, type EntityResponse } from '../lib/api';
import { RefInput, useLabel } from '../form/widgets/RefInput';

interface ListItem {
  id: string;
  name_ko: string | null;
  status: string | null;
}
export interface LineStationLite {
  id: string;
  korail_class?: string | null;
  korail_mgmt_grade?: number | null;
  managed_by_id?: string | null;
}

export const korailClassText = (c: string | null | undefined) =>
  c && isCode('korailStationClass', c) ? codeLabel('korailStationClass', c) : '등급 미입력';

const KORAIL = 'op-korail';

/** 소속 노선역의 managed_by_id 를 바꾼다(버전 확인) */
async function setManager(lsId: string, managerId: string | null, rationale: string) {
  const path = `/v1/admin/line-station/${encodeURIComponent(lsId)}`;
  const cur = await api<EntityResponse<LineStationLite>>(path);
  return api(`${path}${qs({ rationale })}`, {
    method: 'PATCH',
    ifMatch: cur.version,
    json: { managed_by_id: managerId },
  });
}

function LsLink({ id, tab }: { id: string; tab?: string }) {
  const label = useLabel('line_station', id);
  return (
    <Link
      to="/data/$type/$id"
      params={{ type: 'line-station', id }}
      search={tab ? { tab } : {}}
      className="hover:underline"
    >
      {label.data?.label ?? id}
    </Link>
  );
}

export function ManagedStations({ ls, operatorId }: { ls: LineStationLite; operatorId: string | null }) {
  const qc = useQueryClient();
  const isKorail = operatorId === KORAIL;
  const isManager = ls.korail_class === 'management';
  const [pick, setPick] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const subs = useQuery({
    queryKey: ['managed-stations', ls.id],
    enabled: isManager,
    queryFn: () =>
      api<{ items: ListItem[]; total: number }>(`/v1/admin/line-station${qs({ managed_by_id: ls.id, limit: 500 })}`),
  });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['managed-stations', ls.id] }),
      qc.invalidateQueries({ queryKey: ['entity', 'line_station'] }),
    ]);
  };
  const add = useMutation({
    mutationFn: async (subId: string) => {
      const cur = await api<EntityResponse<LineStationLite>>(`/v1/admin/line-station/${encodeURIComponent(subId)}`);
      const prev = cur.data.managed_by_id;
      if (prev && prev !== ls.id && !window.confirm(`${subId} 는 지금 ${prev} 소속입니다. 이 관리역으로 옮길까요?`))
        return null;
      await setManager(subId, ls.id, `소속 노선역 추가 → 관리역 ${ls.id}`);
      return subId;
    },
    onSuccess: async (id) => {
      if (!id) return;
      toast.success(`${id} 를 소속 노선역으로 넣었습니다`);
      setPick(null);
      await refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: (sub: ListItem) => setManager(sub.id, null, `소속 노선역 빼기 ← 관리역 ${ls.id}`),
    onSuccess: async () => {
      toast.success('소속에서 뺐습니다');
      await refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  if (!isKorail) {
    return (
      <Card className="p-4 text-sm" data-testid="managed-stations">
        <p>
          운영기관이 한국철도공사가 아닌 노선역입니다({operatorId ?? '운영기관 미정'}). 정거장 등급·관리역은 코레일
          노선역에만 씁니다.
        </p>
        {!operatorId ? (
          <p className="mt-2 text-xs text-fg-muted">
            노선 운영기관이 둘 이상이거나 없으면 [정보] 탭 "운영기관" 에 이 노선역의 운영기관을 적으세요(품질
            X-line-station-operator).
          </p>
        ) : null}
      </Card>
    );
  }

  if (!isManager) {
    return (
      <Card className="p-4 text-sm" data-testid="managed-stations">
        <p>
          정거장 등급(코레일): <strong>{korailClassText(ls.korail_class)}</strong>
        </p>
        <p className="mt-1">
          관리역:{' '}
          {ls.managed_by_id ? (
            <LsLink id={ls.managed_by_id} tab="managed" />
          ) : (
            <span className="text-fg-muted">없음</span>
          )}
        </p>
        <p className="mt-3 text-xs text-fg-muted">
          이 노선역이 관리역이면 [정보] 탭에서 정거장 등급을 "관리역"으로 저장하세요. 그러면 여기서 소속 노선역을 넣고
          뺄 수 있습니다. 이 노선역의 관리역은 [정보] 탭 "관리역(소속)" 으로 정하거나, 관리역의 이 탭에서 넣습니다.
        </p>
      </Card>
    );
  }

  const items = subs.data?.items ?? [];
  const t = filter.trim();
  const shown = t ? items.filter((s) => (s.name_ko ?? '').includes(t) || s.id.includes(t)) : items;
  return (
    <Card data-testid="managed-stations">
      <CardHeader
        title={`관리역${ls.korail_mgmt_grade ? ` ${ls.korail_mgmt_grade}급` : ''} · 소속 노선역 ${subs.data?.total ?? 0}곳`}
      />
      <div className="flex flex-col gap-3 p-4 text-sm">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1">
            <label className="mb-1 block text-xs text-fg-muted">소속 노선역 추가</label>
            <RefInput target="line_station" value={pick} onChange={setPick} />
          </div>
          <Button
            data-testid="managed-add"
            disabled={!pick || pick === ls.id || add.isPending}
            onClick={() => pick && add.mutate(pick)}
          >
            <Plus className="size-4" /> 넣기
          </Button>
        </div>
        {items.length > 8 ? (
          <Input
            placeholder="소속 노선역 찾기"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8"
          />
        ) : null}
        {subs.isLoading ? (
          <Empty>불러오는 중…</Empty>
        ) : !shown.length ? (
          <Empty>소속 노선역 없음</Empty>
        ) : (
          <ul className="divide-y divide-border rounded border border-border" data-testid="managed-list">
            {shown.map((s) => (
              <li key={s.id} className="flex items-center gap-2 px-3 py-1.5">
                <LsLink id={s.id} />
                <code className="text-xs text-fg-muted">{s.id}</code>
                <button
                  type="button"
                  className="ml-auto text-fg-muted hover:text-danger"
                  aria-label={`${s.id} 소속에서 빼기`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(s)}
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-fg-muted">
          소속 노선역을 넣으면 그 노선역의 "관리역(소속)" 이 이 노선역으로 바뀝니다(노선역마다 변경 묶음). 근거(직제규정
          시행세칙 등)는 소속 노선역의 출처에 필드 managed_by_id 로 붙이세요.
        </p>
      </div>
    </Card>
  );
}
