/**
 * 노선별 역 목록 편집 상태(불러오기·초안·저장) — 노선 상세 [역 순서] 탭(LineStationsEditor)과
 * 지도 > 노선 편집(map/LineMapEditor)이 함께 쓴다. 저장 = PUT /v1/admin/lines/:id/stations(전체 교체, 도메인 적용기).
 * 행마다 version 을 함께 보내 다른 곳에서 먼저 고친 행은 409 로 막힌다.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError, errorText } from '../lib/api';
import { toPutItems, type LsRow } from '../lib/line-stations';

interface LsResponse {
  line_id: string;
  items: (Record<string, unknown> & { id: string; version: number })[];
}

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

/** 새 노선별 역 행(상태는 이웃 행을 따른다) */
export function newLineStationRow(stationId: string, status = 'operating'): LsRow {
  return {
    _key: newKey(),
    station_id: stationId,
    branch: null,
    km: null,
    station_code: null,
    order_confirmed: true,
    status,
    opened: null,
    closed: null,
    name_ko: null,
    operator_id: null,
  };
}

export function useLineStations(lineId: string | null) {
  const qc = useQueryClient();
  const path = lineId ? `/v1/admin/lines/${encodeURIComponent(lineId)}/stations` : '';
  const q = useQuery({
    queryKey: ['line-stations', lineId],
    enabled: !!lineId,
    queryFn: () => api<LsResponse>(path),
  });

  const original = useMemo<LsRow[]>(
    () => (q.data?.items ?? []).map((it) => ({ ...it, _key: it.id }) as LsRow),
    [q.data],
  );
  const [rows, setRows] = useState<LsRow[]>(original);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  useEffect(() => {
    setRows(original);
    setRowErrors({});
    setServerErrors([]);
  }, [original]);

  const dirty = JSON.stringify(toPutItems(rows)) !== JSON.stringify(toPutItems(original));

  const save = useMutation({
    mutationFn: () => api<{ changeset_id: string | null }>(path, { method: 'PUT', json: { items: toPutItems(rows) } }),
    onSuccess: async (r) => {
      toast.success(r.changeset_id ? `역 순서를 저장했습니다 (${r.changeset_id})` : '바뀐 것이 없습니다');
      setRowErrors({});
      setServerErrors([]);
      await qc.invalidateQueries({ queryKey: ['line-stations', lineId] });
      await qc.invalidateQueries({ queryKey: ['entity'] });
      await qc.invalidateQueries({ queryKey: ['quality'] });
    },
    onError: (e) => {
      toast.error(errorText(e));
      if (e instanceof ApiError) {
        const re: Record<number, string> = {};
        const other: string[] = [];
        for (const d of e.body.details ?? []) {
          const m = /^items\.(\d+)/.exec(d.path ?? '');
          const msg = `${d.rule ? `[${d.rule}] ` : ''}${d.message}`;
          if (m) re[Number(m[1])] = msg;
          else other.push(`${d.entity_id ? `${d.entity_id}: ` : ''}${d.path ? `${d.path} ` : ''}${msg}`);
        }
        if (e.body.references?.length)
          other.push(
            `삭제하려는 노선별 역을 참조하는 행: ${e.body.references.map((r) => `${r.table}(${r.owner_id ?? '-'})`).join(', ')}`,
          );
        if (e.status === 409 && e.body.current_version !== undefined)
          other.push('다른 곳에서 먼저 수정했습니다. [되돌리기]로 새로 불러온 뒤 다시 편집하세요.');
        if (!other.length && !Object.keys(re).length) other.push(e.body.message);
        setRowErrors(re);
        setServerErrors(other);
      }
    },
  });

  return {
    query: q,
    original,
    rows,
    setRows,
    dirty,
    save,
    rowErrors,
    serverErrors,
    reset: () => setRows(original),
  };
}
