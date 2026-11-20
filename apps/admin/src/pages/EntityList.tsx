/** 개체 목록(FR-ADM-010~014): 검색·상태·검수 필터, 서버 페이지네이션, URL 상태 */
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { codeLabel, entityUiMeta, isCode } from '@k-raildex/contracts';
import { Badge, Button, Card, Empty, Input, Select } from '@k-raildex/ui';
import { Plus } from 'lucide-react';
import { api, qs } from '../lib/api';
import { fromSlug } from '../lib/entity-types';

interface ListItem {
  id: string;
  name_ko: string | null;
  name_en: string | null;
  status: string | null;
  stage: string | null;
  review_status: string | null;
  version: number;
  updated_at: string;
  deleted_at: string | null;
}

const LIMIT = 50;

export function EntityList() {
  const { type: slug } = useParams({ from: '/data/$type' });
  const search = useSearch({ from: '/data/$type' });
  const navigate = useNavigate({ from: '/data/$type' });
  const type = fromSlug(slug);
  const [q, setQ] = useState(search.q ?? '');
  const query = useQuery({
    queryKey: ['list', type, search],
    enabled: !!type,
    queryFn: () =>
      api<{ items: ListItem[]; total: number }>(
        `/v1/admin/${slug}${qs({ q: search.q, status: search.status, review_status: search.review_status, sort: search.sort, offset: search.offset ?? 0, limit: LIMIT })}`,
      ),
  });
  if (!type) return <Empty>알 수 없는 개체 종류</Empty>;
  const meta = entityUiMeta[type];
  const offset = search.offset ?? 0;
  const total = query.data?.total ?? 0;
  const statusDomain = type === 'plan' ? 'planStage' : 'status';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-bold">{meta.label}</h1>
        <span className="text-sm text-fg-muted">{total.toLocaleString()}건</span>
        <Link to="/data/$type/$id" params={{ type: slug, id: 'new' }} search={{}} className="ml-auto">
          <Button>
            <Plus className="size-4" /> 새로 만들기
          </Button>
        </Link>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate({ search: { ...search, q: q || undefined, offset: undefined } });
        }}
      >
        <Input
          className="max-w-xs"
          placeholder="이름·별칭·id·역번호"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          className="w-40"
          value={search.status ?? ''}
          onChange={(e) =>
            void navigate({ search: { ...search, status: e.target.value || undefined, offset: undefined } })
          }
        >
          <option value="">{type === 'plan' ? '모든 단계' : '모든 상태'}</option>
          {(statusDomain === 'planStage'
            ? [
                'concept',
                'plan_listed',
                'prefeasibility',
                'feasibility',
                'basic_plan',
                'detail_design',
                'construction',
                'trial_run',
                'opened',
                'abandoned',
                'dormant',
              ]
            : ['operating', 'suspended', 'under_construction', 'planned', 'abandoned', 'closed']
          ).map((v) => (
            <option key={v} value={v}>
              {isCode(statusDomain, v) ? codeLabel(statusDomain, v) : v}
            </option>
          ))}
        </Select>
        <Select
          className="w-32"
          value={search.review_status ?? ''}
          onChange={(e) =>
            void navigate({ search: { ...search, review_status: e.target.value || undefined, offset: undefined } })
          }
        >
          <option value="">검수 전체</option>
          <option value="verified">검수 완료</option>
          <option value="unverified">검수 전</option>
          <option value="flagged">이의 있음</option>
        </Select>
        <Button type="submit" variant="secondary">
          검색
        </Button>
      </form>
      <Card>
        {query.isLoading ? (
          <Empty>불러오는 중…</Empty>
        ) : !query.data?.items.length ? (
          <Empty>없음</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-fg-muted">
              <tr>
                <th className="px-3 py-2">이름</th>
                <th className="px-3 py-2">id</th>
                <th className="px-3 py-2">{type === 'plan' ? '현재 단계' : '상태'}</th>
                <th className="px-3 py-2">검수</th>
                <th className="px-3 py-2">수정</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((it) => (
                <Row key={it.id} slug={slug} it={it} />
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <div className="flex items-center gap-2 text-sm">
        <Button
          variant="secondary"
          size="sm"
          disabled={offset === 0}
          onClick={() => void navigate({ search: { ...search, offset: Math.max(0, offset - LIMIT) } })}
        >
          이전
        </Button>
        <span className="text-fg-muted">
          {total === 0 ? 0 : offset + 1}–{Math.min(offset + LIMIT, total)} / {total}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={offset + LIMIT >= total}
          onClick={() => void navigate({ search: { ...search, offset: offset + LIMIT } })}
        >
          다음
        </Button>
      </div>
    </div>
  );
}

function Row({ slug, it }: { slug: string; it: ListItem }) {
  const st = it.stage ?? it.status;
  const domain = it.stage ? 'planStage' : 'status';
  return (
    <tr className="border-t border-border hover:bg-muted/50">
      <td className="px-3 py-1.5">
        <Link
          to="/data/$type/$id"
          params={{ type: slug, id: it.id }}
          search={{}}
          className="font-medium hover:underline"
        >
          {it.name_ko ?? it.id}
        </Link>
        {it.name_en ? <span className="ml-2 text-xs text-fg-muted">{it.name_en}</span> : null}
        {it.deleted_at ? (
          <Badge tone="danger" className="ml-2">
            휴지통
          </Badge>
        ) : null}
      </td>
      <td className="px-3 py-1.5">
        <code className="text-xs text-fg-muted">{it.id}</code>
      </td>
      <td className="px-3 py-1.5">{st ? (isCode(domain, st) ? codeLabel(domain, st) : st) : '-'}</td>
      <td className="px-3 py-1.5">
        {it.review_status ? (
          <Badge tone={it.review_status === 'verified' ? 'good' : it.review_status === 'flagged' ? 'danger' : 'warn'}>
            {codeLabel('reviewStatus', it.review_status as 'verified')}
          </Badge>
        ) : null}
      </td>
      <td className="px-3 py-1.5 text-xs text-fg-muted">{it.updated_at.slice(0, 16).replace('T', ' ')}</td>
    </tr>
  );
}
