/**
 * 용어 페이지 옛 앵커(순수 함수 — test/terms.test.ts). 기존 사이트는 TERMINOLOGY.md 제목을 github-slugger 로 앵커를 만들었다
 * (예 "경전철 (LRT)" → `경전철-lrt`, "1. 철도의 법적 분류" → `1-철도의-법적-분류`). 새 앵커는 용어 id(`term-1-1`)이고,
 * 옛 앵커는 같은 자리의 빈 span id 로 남겨 JS 없이 이어지게 한다(FR-WEB-004).
 */

/** github-slugger 규칙 근사: 소문자, 글자·숫자·결합 문자·밑줄·하이픈·공백만 남기고 공백 → '-' */
export function githubSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

/** 중복이면 -1, -2 … (slugger 와 같음) */
export function slugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = githubSlug(text);
    let slug = base;
    let n = seen.get(base) ?? 0;
    while (seen.has(slug)) slug = `${base}-${++n}`;
    seen.set(base, n);
    seen.set(slug, 0);
    return slug;
  };
}

/** 용어 id(`term-<절>-<번호>`)의 절 번호 */
export function termSectionNo(id: string): number | null {
  const m = /^term-(\d+)-/.exec(id);
  return m ? Number(m[1]) : null;
}
