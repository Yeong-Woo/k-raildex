/**
 * 여러 건 입력(FR-ADM-085, Q82 A): 엑셀 표 붙여 넣기·CSV → 열 대응(자동 추정 + 수동) → 미리 보기(행별 검증) → draft 변경 묶음 1개.
 * 반영은 변경 묶음 상세에서 승인한다.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { formatFuzzy, type FuzzyDate } from '@k-raildex/contracts';
import { Badge, Button, Card, CardHeader, Empty, FieldShell, Input, Select, Textarea } from '@k-raildex/ui';
import { RefInput } from '../form/widgets/RefInput';
import { api, ApiError, errorText } from '../lib/api';

interface BulkField {
  name: string;
  label: string;
  kind: string;
  required: boolean;
}
interface TargetInfo {
  target: string;
  label: string;
  fields: BulkField[];
}
interface ParseResult {
  target: string;
  delimiter: string;
  fields: BulkField[];
  columns: { index: number; header: string; field: string | null }[];
  rows: {
    index: number;
    cells: string[];
    data: Record<string, unknown>;
    errors: { field: string; message: string }[];
  }[];
  summary: { total: number; ok: number; error: number };
}

const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

function show(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object' && 'precision' in (v as object)) return formatFuzzy(v as FuzzyDate);
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function Bulk() {
  const navigate = useNavigate();
  const targets = useQuery({
    queryKey: ['bulk-targets'],
    queryFn: () => api<{ items: TargetInfo[] }>('/v1/admin/bulk/targets'),
  });
  const [target, setTarget] = useState('line_station');
  const [text, setText] = useState('');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState(today());
  const [mapping, setMapping] = useState<(string | null)[] | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [title, setTitle] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);

  const info = targets.data?.items.find((t) => t.target === target);
  const defaults = { source_id: sourceId, checked_at: checkedAt || null };

  const parse = useMutation({
    mutationFn: (m: (string | null)[] | null) =>
      api<ParseResult>('/v1/admin/bulk/parse', {
        method: 'POST',
        json: { entity_type: target, text, ...(m ? { mapping: m } : {}), defaults },
      }),
    onSuccess: (r) => {
      setResult(r);
      setMapping(r.columns.map((c) => c.field));
      setExcluded(new Set(r.rows.filter((x) => x.errors.length).map((x) => x.index)));
    },
    onError: (e) => toast.error(errorText(e)),
  });

  // 대상이 바뀌면 열 대응을 새로 추정
  useEffect(() => {
    setResult(null);
    setMapping(null);
  }, [target]);

  const submit = useMutation({
    mutationFn: () =>
      api<{ changeset_id: string; op_count: number; row_count: number }>('/v1/admin/bulk/submit', {
        method: 'POST',
        json: {
          entity_type: target,
          text,
          mapping,
          defaults,
          exclude: [...excluded],
          ...(title.trim() ? { title: title.trim() } : {}),
        },
      }),
    onSuccess: (r) => {
      toast.success(`변경 묶음을 만들었습니다(${r.row_count}행, op ${r.op_count}개) — 확인 후 승인하세요`);
      void navigate({ to: '/changesets/$id', params: { id: r.changeset_id } });
    },
    onError: (e) => {
      toast.error(errorText(e));
      if (e instanceof ApiError && e.status === 422) parse.mutate(mapping);
    },
  });

  const mappedCols = useMemo(() => result?.columns.filter((c) => c.field) ?? [], [result]);
  const included = result ? result.rows.filter((r) => !excluded.has(r.index)) : [];
  const includedErrors = included.filter((r) => r.errors.length).length;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const buf = await f.arrayBuffer();
    // 엑셀 CSV(CP949)도 받는다: UTF-8 로 깨지면 EUC-KR 로 다시 읽는다
    let t = new TextDecoder('utf-8').decode(buf);
    if (t.includes('�')) t = new TextDecoder('euc-kr').decode(buf);
    setText(t);
    setResult(null);
    setMapping(null);
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <h1 className="text-lg font-bold">여러 건 입력</h1>
      <p className="text-sm text-fg-muted">
        엑셀에서 표를 복사해 붙여 넣거나 CSV 를 고릅니다. 첫 줄은 머리글입니다. 결과는 검수 대기(draft) 변경 묶음 하나가
        되고, 변경 묶음 화면에서 승인해야 반영됩니다.
      </p>
      <Card className="grid gap-3 p-4 md:grid-cols-2">
        <FieldShell label="대상" htmlFor="bulk-target">
          <Select id="bulk-target" value={target} onChange={(e) => setTarget(e.target.value)}>
            {(targets.data?.items ?? []).map((t) => (
              <option key={t.target} value={t.target}>
                {t.label}
              </option>
            ))}
          </Select>
        </FieldShell>
        <FieldShell label="변경 묶음 제목(선택)" htmlFor="bulk-title">
          <Input
            id="bulk-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="여러 건 입력: …"
          />
        </FieldShell>
        <FieldShell label="공통 출처(행에 출처 열이 없을 때)">
          <RefInput target="source" value={sourceId} onChange={setSourceId} />
        </FieldShell>
        <FieldShell label="확인일(행에 없을 때)" htmlFor="bulk-checked">
          <Input id="bulk-checked" type="date" value={checkedAt} onChange={(e) => setCheckedAt(e.target.value)} />
        </FieldShell>
        <FieldShell
          label="붙여 넣기"
          htmlFor="bulk-text"
          className="md:col-span-2"
          help={info ? `필드: ${info.fields.map((f) => `${f.label}${f.required ? '*' : ''}`).join(' · ')}` : undefined}
        >
          <Textarea
            id="bulk-text"
            className="min-h-40 font-mono text-xs"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setResult(null);
            }}
            placeholder={'노선\t역\t순서\t상태\nline-…\t서울\t1\t운영 중'}
          />
        </FieldShell>
        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <label className="text-sm text-fg-muted">
            CSV 파일{' '}
            <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          <Button className="ml-auto" disabled={!text.trim() || parse.isPending} onClick={() => parse.mutate(null)}>
            해석
          </Button>
        </div>
      </Card>

      {result ? (
        <>
          <Card data-testid="bulk-mapping">
            <CardHeader title="열 대응" />
            <div className="overflow-x-auto p-3">
              <table className="text-sm">
                <thead className="text-left text-xs text-fg-muted">
                  <tr>
                    <th className="px-2 py-1">머리글</th>
                    <th className="px-2 py-1">필드</th>
                  </tr>
                </thead>
                <tbody>
                  {result.columns.map((c, i) => (
                    <tr key={c.index} className="border-t border-border">
                      <td className="px-2 py-1">{c.header || `(열 ${c.index + 1})`}</td>
                      <td className="px-2 py-1">
                        <Select
                          aria-label={`열 대응: ${c.header}`}
                          value={mapping?.[i] ?? ''}
                          onChange={(e) => {
                            const next = [...(mapping ?? result.columns.map((x) => x.field))];
                            next[i] = e.target.value || null;
                            setMapping(next);
                            parse.mutate(next);
                          }}
                        >
                          <option value="">(무시)</option>
                          {result.fields.map((f) => (
                            <option key={f.name} value={f.name}>
                              {f.label} — {f.name}
                              {f.required ? ' *' : ''}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.fields.filter((f) => f.required && !mapping?.includes(f.name)).length ? (
                <p className="mt-2 text-xs text-warn">
                  대응 안 된 필수 필드:{' '}
                  {result.fields
                    .filter((f) => f.required && !mapping?.includes(f.name))
                    .map((f) => f.label)
                    .join(', ')}{' '}
                  (공통 출처·확인일로 채워지는 것 제외)
                </p>
              ) : null}
            </div>
          </Card>

          <Card data-testid="bulk-preview">
            <CardHeader
              title="미리 보기"
              actions={
                <div className="flex items-center gap-2 text-sm">
                  <Badge tone="good">정상 {result.summary.ok}</Badge>
                  <Badge tone={result.summary.error ? 'danger' : 'neutral'}>오류 {result.summary.error}</Badge>
                  <span className="text-fg-muted">제출 {included.length}행</span>
                </div>
              }
            />
            {!result.rows.length ? (
              <Empty>데이터 행이 없음</Empty>
            ) : (
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-bg-elevated text-left text-fg-muted">
                    <tr>
                      <th className="px-2 py-1">포함</th>
                      <th className="px-2 py-1">행</th>
                      {result.target === 'line_station' ? <th className="px-2 py-1">id</th> : null}
                      {mappedCols.map((c) => (
                        <th key={c.index} className="px-2 py-1">
                          {result.fields.find((f) => f.name === c.field)?.label ?? c.field}
                        </th>
                      ))}
                      <th className="px-2 py-1">오류</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => {
                      const errFields = new Set(r.errors.map((e) => e.field));
                      return (
                        <tr
                          key={r.index}
                          data-testid="bulk-row"
                          className={`border-t border-border ${r.errors.length ? 'bg-danger/5' : ''}`}
                        >
                          <td className="px-2 py-1">
                            <input
                              type="checkbox"
                              aria-label={`${r.index}행 포함`}
                              checked={!excluded.has(r.index)}
                              onChange={(e) => {
                                const next = new Set(excluded);
                                if (e.target.checked) next.delete(r.index);
                                else next.add(r.index);
                                setExcluded(next);
                              }}
                            />
                          </td>
                          <td className="px-2 py-1 text-fg-muted">{r.index}</td>
                          {result.target === 'line_station' ? (
                            <td className="px-2 py-1 text-fg-muted">{show(r.data.id)}</td>
                          ) : null}
                          {mappedCols.map((c) => {
                            const f = c.field!;
                            const base = f.startsWith('geom.') ? 'geom' : f;
                            const v =
                              f === 'source_id' && r.data.sources
                                ? (r.data.sources as { source_id: string }[])[0]?.source_id
                                : f === 'target_ids'
                                  ? r.data.targets
                                  : f.startsWith('geom.')
                                    ? (r.data.geom as Record<string, unknown> | undefined)?.[f.slice(5)]
                                    : r.data[f];
                            return (
                              <td
                                key={c.index}
                                className={`px-2 py-1 ${errFields.has(f) || errFields.has(base) ? 'text-danger' : ''}`}
                                title={r.cells[c.index]}
                              >
                                {v === undefined ? <span className="text-fg-muted">{r.cells[c.index]}</span> : show(v)}
                              </td>
                            );
                          })}
                          <td className="px-2 py-1 text-danger">
                            {r.errors.map((e, i) => (
                              <div key={i}>
                                {e.field}: {e.message}
                              </div>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center gap-2 border-t border-border p-3">
              {includedErrors ? (
                <span className="text-sm text-danger">포함한 행 중 {includedErrors}행에 오류 — 고치거나 빼세요</span>
              ) : null}
              <Button
                className="ml-auto"
                disabled={!included.length || includedErrors > 0 || submit.isPending}
                onClick={() => submit.mutate()}
              >
                변경 묶음 만들기({included.length}행)
              </Button>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
