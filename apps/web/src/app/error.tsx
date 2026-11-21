'use client';

/** 데이터를 받지 못했을 때(공개 API 오류·연결 실패) */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="container page-head" style={{ paddingBottom: 'var(--kr-space-16)' }}>
      <h1>잠시 자료를 불러오지 못했습니다</h1>
      <p className="lead">공개 자료 서버가 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.</p>
      {error.digest ? <p className="muted">오류 번호: {error.digest}</p> : null}
      <button type="button" className="btn" onClick={reset} style={{ marginTop: 'var(--kr-space-4)' }}>
        다시 시도
      </button>
    </div>
  );
}
