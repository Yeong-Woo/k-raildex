/** 설정 › API 토큰: 목록·발급(범위 선택, 평문은 한 번만 표시 + 복사)·폐기 (docs/04-api.md 3절) */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, Empty, FieldShell, Input } from '@k-raildex/ui';
import { api, errorText } from '../lib/api';
import { fmtTime, type ApiToken } from './api';

const SCOPES: { value: string; label: string }[] = [
  { value: 'public:read', label: '공개 읽기(공개 사이트 빌드)' },
  { value: 'admin:read', label: '관리 읽기' },
  { value: 'admin:write', label: '관리 쓰기(관리자 토큰)' },
  { value: 'proposal:write', label: '제안(draft) 쓰기 — 에이전트' },
  { value: 'system:write', label: '시스템 쓰기 — 수집기' },
];

export function TokensPanel() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['tokens'],
    queryFn: () => api<{ items: ApiToken[] }>('/v1/admin/tokens'),
  });
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['admin:read']);
  const [expires, setExpires] = useState('');
  const [created, setCreated] = useState<(ApiToken & { token: string }) | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api<ApiToken & { token: string }>('/v1/admin/tokens', {
        method: 'POST',
        json: {
          name: name.trim(),
          scopes,
          ...(expires ? { expires_at: new Date(`${expires}T23:59:59+09:00`).toISOString() } : {}),
        },
      }),
    onSuccess: async (r) => {
      setCreated(r);
      setName('');
      await qc.invalidateQueries({ queryKey: ['tokens'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/v1/admin/tokens/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('토큰을 폐기했습니다');
      await qc.invalidateQueries({ queryKey: ['tokens'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="새 토큰" />
        <form
          className="flex flex-col gap-3 p-4"
          data-testid="token-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || !scopes.length) return;
            create.mutate();
          }}
        >
          <div className="flex flex-wrap gap-3">
            <FieldShell label="이름" htmlFor="token-name" className="w-64">
              <Input
                id="token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: web-build"
              />
            </FieldShell>
            <FieldShell label="만료일(선택)" htmlFor="token-expires" className="w-44">
              <Input id="token-expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </FieldShell>
          </div>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
            <legend className="mb-1 text-xs font-medium text-fg-muted">범위</legend>
            {SCOPES.map((s) => (
              <label key={s.value} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={scopes.includes(s.value)}
                  onChange={(e) =>
                    setScopes((cur) => (e.target.checked ? [...cur, s.value] : cur.filter((x) => x !== s.value)))
                  }
                />
                <code className="text-xs">{s.value}</code>
                <span className="text-xs text-fg-muted">{s.label}</span>
              </label>
            ))}
          </fieldset>
          <div>
            <Button type="submit" disabled={!name.trim() || !scopes.length || create.isPending}>
              발급
            </Button>
          </div>
        </form>
        {created ? (
          <div
            className="mx-4 mb-4 rounded-md border border-warn/40 bg-warn/10 p-3 text-sm"
            data-testid="token-created"
          >
            <p className="mb-2 font-medium">
              토큰 “{created.name}” — 평문은 지금 한 번만 보입니다. 안전한 곳(.env·GitHub Secrets)에 저장하세요.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-bg px-2 py-1 text-xs" data-testid="token-plain">
                {created.token}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void navigator.clipboard.writeText(created.token).then(
                    () => toast.success('복사했습니다'),
                    () => toast.error('복사하지 못했습니다 — 직접 선택해 복사하세요'),
                  )
                }
              >
                복사
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                닫기
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
      <Card>
        <CardHeader title={`토큰 ${list.data?.items.length ?? 0}개`} />
        {list.isLoading ? (
          <Empty>불러오는 중…</Empty>
        ) : list.error ? (
          <Empty>{errorText(list.error)}</Empty>
        ) : !list.data?.items.length ? (
          <Empty>발급한 토큰이 없습니다</Empty>
        ) : (
          <table className="w-full text-sm" data-testid="tokens-table">
            <thead className="text-left text-xs text-fg-muted">
              <tr>
                <th className="px-4 py-2">이름</th>
                <th className="px-4 py-2">범위</th>
                <th className="px-4 py-2">사용자</th>
                <th className="px-4 py-2">만든 시각</th>
                <th className="px-4 py-2">마지막 사용</th>
                <th className="px-4 py-2">만료</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((t) => (
                <tr key={t.id} className="border-t border-border" data-token={t.name}>
                  <td className="px-4 py-1.5">{t.name}</td>
                  <td className="px-4 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {t.scopes.map((s) => (
                        <Badge key={s}>{s}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-1.5 text-xs text-fg-muted">
                    {t.user_name} ({t.user_kind})
                  </td>
                  <td className="px-4 py-1.5 text-xs text-fg-muted">{fmtTime(t.created_at)}</td>
                  <td className="px-4 py-1.5 text-xs text-fg-muted">{fmtTime(t.last_used_at)}</td>
                  <td className="px-4 py-1.5 text-xs text-fg-muted">{t.expires_at ? fmtTime(t.expires_at) : '없음'}</td>
                  <td className="px-4 py-1.5 text-right">
                    {t.revoked_at ? (
                      <Badge tone="danger">폐기됨</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={revoke.isPending}
                        onClick={() => {
                          if (window.confirm(`토큰 “${t.name}” 을 폐기할까요? 되돌릴 수 없습니다.`))
                            revoke.mutate(t.id);
                        }}
                      >
                        폐기
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
