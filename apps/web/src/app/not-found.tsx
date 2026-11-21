import { paths } from '@/lib/urls';

export default function NotFound() {
  return (
    <div className="container page-head" style={{ paddingBottom: 'var(--kr-space-16)' }}>
      <h1>페이지를 찾을 수 없습니다</h1>
      <p className="lead">주소가 바뀌었거나 삭제된 항목일 수 있습니다. 검색으로 찾아보세요.</p>
      <form
        className="bigsearch"
        action={paths.search()}
        method="get"
        role="search"
        style={{ marginTop: 'var(--kr-space-6)', marginLeft: 0 }}
      >
        <label htmlFor="nf-q" className="sr-only">
          검색어
        </label>
        <input id="nf-q" name="q" type="search" placeholder="역·노선·계획 검색" />
        <button type="submit" className="btn primary">
          검색
        </button>
      </form>
      <p style={{ marginTop: 'var(--kr-space-6)' }}>
        <a href="/">홈으로</a>
      </p>
    </div>
  );
}
