/** 역 상세 [노선별] 탭(FR-ADM-051): 이 역에 속한 노선별 역 카드 + 계산된 역 상태(읽기 전용) */
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { codeLabel, formatFuzzy, isCode, type FuzzyDate } from '@k-raildex/contracts';
import { Badge, Card, CardHeader, Empty } from '@k-raildex/ui';
import { ExternalLink } from 'lucide-react';
import { api, errorText, qs, type EntityResponse } from '../lib/api';
import { useLabel } from '../form/widgets/RefInput';

type Obj = Record<string, unknown>;

const fz = (v: unknown) => (v ? formatFuzzy(v as FuzzyDate) : '-');
const statusText = (v: unknown) => (typeof v === 'string' && isCode('status', v) ? codeLabel('status', v) : '-');

export function StationLineStations({ stationId, derived }: { stationId: string; derived: Obj }) {
  const list = useQuery({
    queryKey: ['list', 'line_station', { station_id: stationId }],
    queryFn: () =>
      api<{ items: { id: string }[]; total: number }>(
        `/v1/admin/line-station${qs({ station_id: stationId, limit: 100 })}`,
      ),
  });
  const details = useQueries({
    queries: (list.data?.items ?? []).map((it) => ({
      queryKey: ['entity', 'line_station', it.id],
      queryFn: () => api<EntityResponse>(`/v1/admin/line-station/${encodeURIComponent(it.id)}`),
    })),
  });

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader title="역 상태(노선별 역에서 계산 — 읽기 전용)" />
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 p-4 text-sm sm:grid-cols-4" data-testid="station-derived">
          <dt className="text-fg-muted">상태</dt>
          <dd>{statusText(derived.status)}</dd>
          <dt className="text-fg-muted">개통</dt>
          <dd>{fz(derived.opened)}</dd>
          <dt className="text-fg-muted">폐지</dt>
          <dd>{fz(derived.closed)}</dd>
          <dt className="text-fg-muted">노선 수</dt>
          <dd>{String(derived.line_count ?? '-')}</dd>
        </dl>
      </Card>
      {list.isLoading ? (
        <Empty>불러오는 중…</Empty>
      ) : list.error ? (
        <Empty>{errorText(list.error)}</Empty>
      ) : !list.data?.items.length ? (
        <Card>
          <Empty>
            노선별 역이 없는 역입니다. 상태·개통일은 [정보] 탭의 단독 상태(own_status·own_opened·own_closed) 칸에
            입력하세요.
          </Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {details.map((d, i) => {
            const id = list.data.items[i]!.id;
            if (!d.data)
              return (
                <Card key={id} className="p-4 text-sm text-fg-muted">
                  {d.error ? errorText(d.error) : '불러오는 중…'}
                </Card>
              );
            return <LineStationCard key={id} data={d.data.data} />;
          })}
        </div>
      )}
    </div>
  );
}

function LineStationCard({ data }: { data: Obj }) {
  const lineId = String(data.line_id);
  const line = useLabel('line', lineId);
  const ext = (data.external_refs as { system: string; code: string }[] | undefined) ?? [];
  const geom = data.geom as { lat: number; lng: number } | null;
  return (
    <Card className="p-4 text-sm" data-testid="line-station-card">
      <div className="mb-2 flex items-center gap-2">
        <Link
          to="/data/$type/$id"
          params={{ type: 'line', id: lineId }}
          search={{ tab: 'stations' }}
          className="font-semibold hover:underline"
        >
          {line.data?.label ?? lineId}
        </Link>
        {data.station_code ? <Badge tone="info">{String(data.station_code)}</Badge> : null}
        <Badge tone={data.status === 'operating' ? 'good' : data.status === 'closed' ? 'neutral' : 'warn'}>
          {statusText(data.status)}
        </Badge>
        <Link
          to="/data/$type/$id"
          params={{ type: 'line-station', id: String(data.id) }}
          search={{}}
          className="ml-auto text-fg-muted"
          title="노선별 역 편집"
        >
          <ExternalLink className="size-3.5" />
        </Link>
      </div>
      <dl className="grid grid-cols-[6rem_1fr] gap-y-0.5">
        <dt className="text-fg-muted">노선별 이름</dt>
        <dd>{data.name_ko ? String(data.name_ko) : <span className="text-fg-muted">역 이름과 같음</span>}</dd>
        <dt className="text-fg-muted">순서</dt>
        <dd>
          {String(data.seq)}
          {data.branch ? ` · 지선 ${String(data.branch)}` : ''}
          {data.km != null ? ` · ${String(data.km)} km` : ''}
          {data.order_confirmed === false ? ' · 순서 미확인' : ''}
        </dd>
        <dt className="text-fg-muted">개통·폐지</dt>
        <dd>
          {fz(data.opened)} ~ {data.closed ? fz(data.closed) : ''}
        </dd>
        <dt className="text-fg-muted">외부 코드</dt>
        <dd>{ext.length ? ext.map((e) => `${e.system}:${e.code}`).join(', ') : '-'}</dd>
        <dt className="text-fg-muted">승강장 좌표</dt>
        <dd>{geom ? `${geom.lat.toFixed(5)}, ${geom.lng.toFixed(5)}` : '-'}</dd>
      </dl>
    </Card>
  );
}
