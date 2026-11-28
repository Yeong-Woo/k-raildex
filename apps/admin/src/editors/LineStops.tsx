/**
 * 정거장 순서(2026-11-28 사용자 지시 — 위키백과 "역 목록"과 비슷하게): 노선 상세 [정거장 순서] 탭의 보기 표.
 * 본선·지선별 표, 열 = 번호(정거장 번호) · 정거장(한자·로마자) · 구분(코레일 정거장 등급 조차장·신호장·신호소 / 화물역·운전 취급) ·
 * 접속 노선 · 역간 거리 · 영업 거리(km) · 소재지(바뀔 때만). 파생 값(DB 뷰) — 고치기는 [편집](LineStationsEditor).
 * 역 그룹 [앞뒤 정거장] 탭(StopNeighbors) = 모든 노선의 앞뒤 정거장과 거리.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { codeLabel, isCode } from '@k-raildex/contracts';
import { Badge, Card, CardHeader, cn, Empty } from '@k-raildex/ui';
import { api, errorText } from '../lib/api';

interface LinkRef {
  line_station_id: string;
  station_id: string;
  name_ko: string | null;
  distance_km: number | null;
  basis: 'sequence' | 'branch';
}
interface StopRow {
  line_station_id: string;
  pos: number;
  branch: string | null;
  station_id: string;
  station_code: string | null;
  name_ko: string | null;
  name_hanja: string | null;
  name_en: string | null;
  stop_class: string;
  status: string;
  km: number | null;
  prev: LinkRef[];
  next: LinkRef[];
  connections: { line_id: string; name_ko: string | null; status: string }[];
  region_name: string | null;
  address: string | null;
}
interface Neighbor {
  line_id: string;
  line_name_ko: string | null;
  branch: string | null;
  direction: 'prev' | 'next';
  neighbor_station_id: string;
  neighbor_name: string | null;
  distance_km: number | null;
  basis: 'sequence' | 'branch';
}

/** 구분: 조차장·신호장·신호소(정거장 등급) / 화물역·운전 취급(역 그룹 종류). 여객역은 비움(위키 표처럼) */
function classLabel(c: string): string | null {
  if (c === 'station') return null;
  if (isCode('korailStationClass', c)) return codeLabel('korailStationClass', c);
  if (isCode('stationKind', c)) return codeLabel('stationKind', c);
  return c;
}
const kmText = (v: number | null) => (v == null ? '' : v.toFixed(1));
/** 주소에서 시·군·구(첫 "…시·…군·…구" 낱말, 시·도 다음) */
function sigungu(address: string | null): string | null {
  if (!address) return null;
  const t = address.split(/\s+/);
  return t.slice(1, 3).find((w) => /(시|군|구)$/.test(w)) ?? null;
}

function StationLink({ id, name }: { id: string; name: string | null }) {
  return (
    <Link to="/data/$type/$id" params={{ type: 'station', id }} search={{}} className="hover:underline">
      {name ?? id}
    </Link>
  );
}

function Section({ title, rows }: { title: string; rows: StopRow[] }) {
  let lastPlace = '';
  return (
    <Card data-testid="stop-section">
      <CardHeader title={title} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-fg-muted">
            <tr>
              <th className="w-16 px-3 py-2">번호</th>
              <th className="px-2 py-2">정거장</th>
              <th className="w-20 px-2 py-2">구분</th>
              <th className="px-2 py-2">접속 노선</th>
              <th className="w-20 px-2 py-2 text-right">역간 거리(km)</th>
              <th className="w-20 px-2 py-2 text-right">영업 거리(km)</th>
              <th className="w-44 px-3 py-2">소재지</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const seqPrev = s.prev.find((p) => p.basis === 'sequence');
              const branchPrev = s.prev.find((p) => p.basis === 'branch');
              const cls = classLabel(s.stop_class);
              const place = [s.region_name, sigungu(s.address)].filter(Boolean).join(' ');
              const showPlace = place && place !== lastPlace;
              if (place) lastPlace = place;
              const inactive = s.status !== 'operating';
              return (
                <tr
                  key={s.line_station_id}
                  className={cn('border-t border-border align-top', inactive && 'text-fg-muted')}
                  data-testid="stop-row"
                >
                  <td className="px-3 py-1.5 font-mono text-xs">{s.station_code ?? ''}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="font-medium">
                        <StationLink id={s.station_id} name={s.name_ko} />
                      </span>
                      {s.name_hanja ? <span className="text-xs text-fg-muted">{s.name_hanja}</span> : null}
                      {inactive && isCode('status', s.status) ? (
                        <Badge tone={s.status === 'closed' ? 'danger' : 'warn'}>{codeLabel('status', s.status)}</Badge>
                      ) : null}
                    </div>
                    {s.name_en ? <div className="text-[11px] text-fg-muted">{s.name_en}</div> : null}
                    {branchPrev ? (
                      <div className="text-[11px] text-fg-muted">
                        ← <StationLink id={branchPrev.station_id} name={branchPrev.name_ko} />
                        에서 분기
                      </div>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 text-xs">{cls ? <Badge>{cls}</Badge> : null}</td>
                  <td className="px-2 py-1.5 text-xs">
                    {s.connections.map((c, i) => (
                      <span key={c.line_id}>
                        {i ? ' · ' : ''}
                        <Link
                          to="/data/$type/$id"
                          params={{ type: 'line', id: c.line_id }}
                          search={{ tab: 'stations' } as never}
                          className={cn('hover:underline', c.status !== 'operating' && 'text-fg-muted')}
                        >
                          {c.name_ko ?? c.line_id}
                        </Link>
                      </span>
                    ))}
                  </td>
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums">
                    {seqPrev ? (
                      seqPrev.distance_km == null ? (
                        <span className="text-fg-muted">미확인</span>
                      ) : (
                        kmText(seqPrev.distance_km)
                      )
                    ) : branchPrev?.distance_km != null ? (
                      kmText(branchPrev.distance_km)
                    ) : (
                      ''
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums">
                    {s.km == null ? <span className="text-fg-muted">미확인</span> : kmText(s.km)}
                  </td>
                  <td className="px-3 py-1.5 text-xs">{showPlace ? place : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** 노선 [정거장 순서] 탭의 보기 표 */
export function LineStopTable({ lineId }: { lineId: string }) {
  const [hideClosed, setHideClosed] = useState(false);
  const q = useQuery({
    queryKey: ['line-stops', lineId],
    queryFn: () => api<{ items: StopRow[] }>(`/v1/admin/lines/${encodeURIComponent(lineId)}/stops`),
  });
  if (q.isLoading) return <Empty>불러오는 중…</Empty>;
  if (q.error) return <Empty>{errorText(q.error)}</Empty>;
  const all = q.data?.items ?? [];
  const items = hideClosed ? all.filter((s) => s.status !== 'closed') : all;
  const groups = new Map<string, StopRow[]>();
  for (const s of items) groups.set(s.branch ?? '', [...(groups.get(s.branch ?? '') ?? []), s]);
  const closedCount = all.filter((s) => s.status === 'closed').length;
  return (
    <div className="flex flex-col gap-4" data-testid="line-stops">
      <div className="flex flex-wrap items-center gap-3 text-xs text-fg-muted">
        <span>
          정거장 {all.length}곳. 역간 거리 = 앞 정거장과의 영업 거리 차이(둘 다 있을 때만). 구분 = 코레일 정거장
          등급(조차장·신호장·신호소) 또는 역 그룹 종류.
        </span>
        {closedCount ? (
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={hideClosed} onChange={(e) => setHideClosed(e.target.checked)} /> 폐지{' '}
            {closedCount}곳 숨기기
          </label>
        ) : null}
      </div>
      {items.length === 0 ? <Empty>정거장이 없습니다. [편집]에서 넣으세요.</Empty> : null}
      {[...groups.entries()].map(([branch, rows]) => (
        <Section key={branch || '-'} title={branch ? `지선 ${branch}` : '본선'} rows={rows} />
      ))}
    </div>
  );
}

/** 역 그룹 [앞뒤 정거장] 탭 */
export function StopNeighbors({ stationId }: { stationId: string }) {
  const q = useQuery({
    queryKey: ['stop-neighbors', stationId],
    queryFn: () => api<{ items: Neighbor[] }>(`/v1/admin/stations/${encodeURIComponent(stationId)}/stop-neighbors`),
  });
  if (q.isLoading) return <Empty>불러오는 중…</Empty>;
  if (q.error) return <Empty>{errorText(q.error)}</Empty>;
  const items = q.data?.items ?? [];
  const byLine = new Map<string, Neighbor[]>();
  for (const n of items) byLine.set(n.line_id, [...(byLine.get(n.line_id) ?? []), n]);
  return (
    <Card data-testid="stop-neighbors">
      <CardHeader title="앞뒤 정거장(노선별, 분기면 여러 개)" />
      {items.length === 0 ? (
        <Empty>정거장이 없습니다.</Empty>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-fg-muted">
            <tr>
              <th className="px-4 py-2">노선</th>
              <th className="px-2 py-2">앞 정거장(거리)</th>
              <th className="px-2 py-2">뒤 정거장(거리)</th>
            </tr>
          </thead>
          <tbody>
            {[...byLine.entries()].map(([lineId, list]) => (
              <tr key={lineId} className="border-t border-border align-top" data-testid="neighbor-row">
                <td className="px-4 py-1.5">
                  <Link
                    to="/data/$type/$id"
                    params={{ type: 'line', id: lineId }}
                    search={{ tab: 'stations' } as never}
                  >
                    {list[0]!.line_name_ko ?? lineId}
                  </Link>
                </td>
                {(['prev', 'next'] as const).map((d) => (
                  <td key={d} className="px-2 py-1.5 text-xs">
                    <ul className="flex flex-col gap-0.5">
                      {list
                        .filter((n) => n.direction === d)
                        .map((n) => (
                          <li key={`${n.neighbor_station_id}:${n.basis}`} className="flex flex-wrap items-center gap-1">
                            <StationLink id={n.neighbor_station_id} name={n.neighbor_name} />
                            <span className={n.distance_km == null ? 'text-fg-muted' : ''}>
                              {n.distance_km == null ? '미확인' : `${n.distance_km.toFixed(1)} km`}
                            </span>
                            {n.basis === 'branch' ? <Badge>분기 {n.branch}</Badge> : null}
                          </li>
                        ))}
                    </ul>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
