/**
 * 관리역 ↔ 하위역(소속 역, 2026-11-27 사용자 지시 — 한국철도공사 직제규정 시행세칙의 관리역 체계, 0031).
 * 역 상세 [관리역] 탭: 이 역이 관리역이면 소속 역 목록·추가·빼기(각 소속 역의 managed_by_id 를 바꾼다), 아니면 이 역의 관리역을 보여 준다.
 * 관리역 지정은 역 정보의 "정거장 등급(코레일) = 관리역" 으로 한다(V-H18: 소속 역의 관리역은 관리역 등급이어야 함).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { codeLabel, isCode } from '@k-raildex/contracts';
import { Button, Card, CardHeader, Empty, Input } from '@k-raildex/ui';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorText, qs, type EntityResponse } from '../lib/api';
import { RefInput } from '../form/widgets/RefInput';

interface ListItem {
  id: string;
  name_ko: string;
  status: string | null;
}
interface StationLite {
  id: string;
  name_ko: string;
  korail_class?: string | null;
  korail_mgmt_grade?: number | null;
  managed_by_id?: string | null;
}

const classText = (c: string | null | undefined) =>
  c && isCode('korailStationClass', c) ? codeLabel('korailStationClass', c) : '등급 미입력';

/** 소속 역의 managed_by_id 를 바꾼다(버전 확인) */
async function setManager(stationId: string, managerId: string | null, rationale: string) {
  const path = `/v1/admin/station/${encodeURIComponent(stationId)}`;
  const cur = await api<EntityResponse<StationLite>>(path);
  return api(`${path}${qs({ rationale })}`, {
    method: 'PATCH',
    ifMatch: cur.version,
    json: { managed_by_id: managerId },
  });
}

export function ManagedStations({ station }: { station: StationLite }) {
  const qc = useQueryClient();
  const isManager = station.korail_class === 'management';
  const [pick, setPick] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const subs = useQuery({
    queryKey: ['managed-stations', station.id],
    enabled: isManager,
    queryFn: () =>
      api<{ items: ListItem[]; total: number }>(
        `/v1/admin/station${qs({ managed_by_id: station.id, limit: 500, sort: 'name_ko' })}`,
      ),
  });
  const manager = useQuery({
    queryKey: ['entity', 'station', station.managed_by_id],
    enabled: !!station.managed_by_id,
    queryFn: () => api<EntityResponse<StationLite>>(`/v1/admin/station/${encodeURIComponent(station.managed_by_id!)}`),
  });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['managed-stations', station.id] }),
      qc.invalidateQueries({ queryKey: ['entity', 'station'] }),
    ]);
  };
  const add = useMutation({
    mutationFn: async (subId: string) => {
      const cur = await api<EntityResponse<StationLite>>(`/v1/admin/station/${encodeURIComponent(subId)}`);
      const prev = cur.data.managed_by_id;
      if (
        prev &&
        prev !== station.id &&
        !window.confirm(`${cur.data.name_ko} 는 지금 ${prev} 소속입니다. 이 역으로 옮길까요?`)
      )
        return null;
      await setManager(subId, station.id, `소속 역 추가 → 관리역 ${station.id}`);
      return cur.data.name_ko;
    },
    onSuccess: async (name) => {
      if (!name) return;
      toast.success(`${name} 를 소속 역으로 넣었습니다`);
      setPick(null);
      await refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: (sub: ListItem) => setManager(sub.id, null, `소속 역 빼기 ← 관리역 ${station.id}`),
    onSuccess: async () => {
      toast.success('소속에서 뺐습니다');
      await refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  if (!isManager) {
    return (
      <Card className="p-4 text-sm" data-testid="managed-stations">
        <p>
          정거장 등급(코레일): <strong>{classText(station.korail_class)}</strong>
        </p>
        <p className="mt-1">
          관리역:{' '}
          {station.managed_by_id ? (
            <Link
              to="/data/$type/$id"
              params={{ type: 'station', id: station.managed_by_id }}
              search={{ tab: 'managed' }}
              className="underline"
            >
              {manager.data?.data.name_ko ?? station.managed_by_id}
            </Link>
          ) : (
            <span className="text-fg-muted">없음</span>
          )}
        </p>
        <p className="mt-3 text-xs text-fg-muted">
          이 역이 관리역이면 [정보] 탭에서 정거장 등급을 "관리역"으로 저장하세요. 그러면 여기서 소속 역을 넣고 뺄 수
          있습니다. 이 역의 관리역은 [정보] 탭 "관리역(소속)" 으로 정하거나, 관리역의 이 탭에서 넣습니다.
        </p>
      </Card>
    );
  }

  const items = subs.data?.items ?? [];
  const shown = filter.trim()
    ? items.filter((s) => s.name_ko.includes(filter.trim()) || s.id.includes(filter.trim()))
    : items;
  return (
    <Card data-testid="managed-stations">
      <CardHeader
        title={`관리역${station.korail_mgmt_grade ? ` ${station.korail_mgmt_grade}급` : ''} · 소속 역 ${subs.data?.total ?? 0}곳`}
      />
      <div className="flex flex-col gap-3 p-4 text-sm">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1">
            <label className="mb-1 block text-xs text-fg-muted">소속 역 추가</label>
            <RefInput target="station" value={pick} onChange={setPick} />
          </div>
          <Button
            data-testid="managed-add"
            disabled={!pick || pick === station.id || add.isPending}
            onClick={() => pick && add.mutate(pick)}
          >
            <Plus className="size-4" /> 넣기
          </Button>
        </div>
        {items.length > 8 ? (
          <Input
            placeholder="소속 역 찾기"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8"
          />
        ) : null}
        {subs.isLoading ? (
          <Empty>불러오는 중…</Empty>
        ) : !shown.length ? (
          <Empty>소속 역 없음</Empty>
        ) : (
          <ul className="divide-y divide-border rounded border border-border" data-testid="managed-list">
            {shown.map((s) => (
              <li key={s.id} className="flex items-center gap-2 px-3 py-1.5">
                <Link
                  to="/data/$type/$id"
                  params={{ type: 'station', id: s.id }}
                  search={{}}
                  className="hover:underline"
                >
                  {s.name_ko}
                </Link>
                <code className="text-xs text-fg-muted">{s.id}</code>
                <button
                  type="button"
                  className="ml-auto text-fg-muted hover:text-danger"
                  aria-label={`${s.name_ko} 소속에서 빼기`}
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
          소속 역을 넣으면 그 역의 "관리역(소속)" 이 이 역으로 바뀝니다(역마다 변경 묶음). 근거(직제규정 시행세칙 등)는
          소속 역의 출처에 필드 managed_by_id 로 붙이세요.
        </p>
      </div>
    </Card>
  );
}
