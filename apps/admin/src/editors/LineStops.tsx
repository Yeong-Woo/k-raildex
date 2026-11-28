/**
 * 정거장(0042, 2026-11-28 사용자 지시): 노선 [정거장] 탭 = 노선역 + 노선 위 신호장·신호소·조차장을 노선 순서로,
 * 역 그룹·시설 [앞뒤 정거장] 탭 = 모든 노선의 앞뒤 정거장과 거리. 파생 값(DB 뷰, 저장 안 함) — 읽기 전용.
 * 순서·위치 고치기: 노선역은 [역 순서] 탭, 신호장 등은 시설 정보의 "노선 위 정거장"(앞 노선역·km).
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { codeLabel, isCode } from '@k-raildex/contracts';
import { Badge, Card, CardHeader, Empty } from '@k-raildex/ui';
import { api, errorText } from '../lib/api';

type NodeType = 'station' | 'facility';
interface StopRef {
  node_type: NodeType;
  node_id: string;
  name_ko: string | null;
  distance_km: number | null;
  basis: 'sequence' | 'branch';
  branch: string | null;
}
interface LineStop {
  pos: number;
  branch: string | null;
  node_type: NodeType;
  node_id: string;
  stop_kind: string;
  name_ko: string | null;
  km: number | null;
  status: string;
  prev: StopRef[];
  next: StopRef[];
}
interface Neighbor {
  line_id: string;
  line_name_ko: string | null;
  branch: string | null;
  direction: 'prev' | 'next';
  neighbor_type: NodeType;
  neighbor_id: string;
  neighbor_name: string | null;
  distance_km: number | null;
  basis: 'sequence' | 'branch';
}

const kindLabel = (k: string) => (isCode('stopKind', k) ? codeLabel('stopKind', k) : k);
const km = (v: number | null) => (v == null ? '미확인' : `${v.toFixed(1)} km`);

function StopLink({ type, id, name }: { type: NodeType; id: string; name: string | null }) {
  return (
    <Link to="/data/$type/$id" params={{ type, id }} search={{}} className="underline-offset-2 hover:underline">
      {name ?? id}
    </Link>
  );
}

function Refs({ refs }: { refs: StopRef[] }) {
  if (!refs.length) return <span className="text-fg-muted">—</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {refs.map((r) => (
        <li key={`${r.node_type}:${r.node_id}:${r.basis}`} className="flex flex-wrap items-center gap-1">
          <StopLink type={r.node_type} id={r.node_id} name={r.name_ko} />
          <span className={r.distance_km == null ? 'text-fg-muted' : ''}>{km(r.distance_km)}</span>
          {r.basis === 'branch' ? <Badge>분기 {r.branch}</Badge> : null}
        </li>
      ))}
    </ul>
  );
}

/** 노선 [정거장] 탭 */
export function LineStops({ lineId }: { lineId: string }) {
  const q = useQuery({
    queryKey: ['line-stops', lineId],
    queryFn: () => api<{ items: LineStop[] }>(`/v1/admin/lines/${encodeURIComponent(lineId)}/stops`),
  });
  if (q.isLoading) return <Empty>불러오는 중…</Empty>;
  if (q.error) return <Empty>{errorText(q.error)}</Empty>;
  const items = q.data?.items ?? [];
  const groups = new Map<string, LineStop[]>();
  for (const s of items) {
    const k = s.branch ?? '';
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return (
    <div className="flex flex-col gap-4" data-testid="line-stops">
      <p className="text-xs text-fg-muted">
        정거장 = 역·화물역·신호장·신호소·조차장. 노선역과 노선 위 시설(앞 노선역·km)로 순서를 계산합니다(저장하지 않음).
        거리는 두 정거장 km 가 모두 있을 때의 차이, 없으면 미확인. 노선역 순서는 [역 순서] 탭, 신호장 등의 자리는 시설
        정보의 "노선 위 정거장"에서 고칩니다.
      </p>
      {items.length === 0 ? <Empty>정거장이 없습니다.</Empty> : null}
      {[...groups.entries()].map(([branch, list]) => (
        <Card key={branch || '-'}>
          <CardHeader title={branch ? `지선 ${branch}` : '본선'} />
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-fg-muted">
              <tr>
                <th className="w-10 px-3 py-2">#</th>
                <th className="w-20 px-2 py-2">종류</th>
                <th className="px-2 py-2">정거장</th>
                <th className="w-20 px-2 py-2">km</th>
                <th className="px-2 py-2">앞 정거장(거리)</th>
                <th className="px-2 py-2">뒤 정거장(거리)</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr
                  key={`${s.node_type}:${s.node_id}`}
                  className="border-t border-border align-top"
                  data-testid="stop-row"
                >
                  <td className="px-3 py-1.5 text-xs text-fg-muted">{s.pos}</td>
                  <td className="px-2 py-1.5">
                    <Badge tone={s.node_type === 'facility' ? 'warn' : undefined}>{kindLabel(s.stop_kind)}</Badge>
                  </td>
                  <td className="px-2 py-1.5 font-medium">
                    <StopLink type={s.node_type} id={s.node_id} name={s.name_ko} />
                    {s.status !== 'operating' && isCode('status', s.status) ? (
                      <span className="ml-1 text-xs text-fg-muted">{codeLabel('status', s.status)}</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 text-xs">{s.km ?? <span className="text-fg-muted">미확인</span>}</td>
                  <td className="px-2 py-1.5 text-xs">
                    <Refs refs={s.prev} />
                  </td>
                  <td className="px-2 py-1.5 text-xs">
                    <Refs refs={s.next} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}

/** 역 그룹·시설 [앞뒤 정거장] 탭 */
export function StopNeighbors({ type, id }: { type: NodeType; id: string }) {
  const q = useQuery({
    queryKey: ['stop-neighbors', type, id],
    queryFn: () => api<{ items: Neighbor[] }>(`/v1/admin/stops/${type}/${encodeURIComponent(id)}/neighbors`),
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
        <Empty>
          {type === 'facility'
            ? '노선 위 자리가 없습니다 — 정보의 "노선 위 정거장"(앞 노선역·km)을 넣으면 계산됩니다.'
            : '노선역이 없습니다.'}
        </Empty>
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
                  <Link to="/data/$type/$id" params={{ type: 'line', id: lineId }} search={{ tab: 'stops' } as never}>
                    {list[0]!.line_name_ko ?? lineId}
                  </Link>
                </td>
                {(['prev', 'next'] as const).map((d) => (
                  <td key={d} className="px-2 py-1.5 text-xs">
                    <Refs
                      refs={list
                        .filter((n) => n.direction === d)
                        .map((n) => ({
                          node_type: n.neighbor_type,
                          node_id: n.neighbor_id,
                          name_ko: n.neighbor_name,
                          distance_km: n.distance_km,
                          basis: n.basis,
                          branch: n.branch,
                        }))}
                    />
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
