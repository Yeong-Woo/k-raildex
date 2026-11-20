/**
 * docs/TERMINOLOGY.md 파서. 형식(파일 머리 설명): `## N. 절` 아래 `### 용어`, 본문은
 * "- 정의: / - 근거: (근거·출처, 출처) / - 예: / - 주의:" 글머리. 그 밖의 글머리(연혁·수행·관련 용어 …)와
 * 표·문단은 정의 본문 뒤에 마크다운 그대로 붙인다. `###` 없이 표만 있는 절(사업 단계·기관)은 절 단위 항목으로 돌려준다.
 */

export interface ParsedTerm {
  /** 절 번호(1부터) */
  sectionNo: number;
  section: string;
  /** null = 절 머리 본문(### 앞) */
  term: string | null;
  definition: string | null;
  basis: string | null;
  example: string | null;
  caution: string | null;
  /** 정의에 붙일 나머지 마크다운 */
  rest: string | null;
}

export interface ParsedGlossary {
  updatedAt: string | null;
  terms: ParsedTerm[];
}

const FIELD: Record<string, 'definition' | 'basis' | 'example' | 'caution'> = {
  정의: 'definition',
  '정의(통용)': 'definition',
  근거: 'basis',
  '근거·출처': 'basis',
  출처: 'basis',
  예: 'example',
  주의: 'caution',
};

export function parseTerminology(md: string): ParsedGlossary {
  const updated = /최종 갱신:\s*(\d{4}-\d{2}-\d{2})/.exec(md)?.[1] ?? null;
  const lines = md.split('\n');
  const terms: ParsedTerm[] = [];
  let sectionNo = 0;
  let section = '';
  let cur: { term: string | null; body: string[] } | null = null;

  const flush = () => {
    if (!cur || sectionNo === 0) return;
    const t = buildTerm(sectionNo, section, cur.term, cur.body);
    if (t) terms.push(t);
  };

  for (const line of lines) {
    const h2 = /^##\s+(\d+)\.\s*(.+?)\s*$/.exec(line);
    if (h2) {
      flush();
      sectionNo = Number(h2[1]);
      section = h2[2]!;
      cur = { term: null, body: [] };
      continue;
    }
    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if (h3 && sectionNo > 0) {
      flush();
      cur = { term: h3[1]!, body: [] };
      continue;
    }
    if (/^---\s*$/.test(line)) continue;
    cur?.body.push(line);
  }
  flush();
  return { updatedAt: updated, terms };
}

function buildTerm(sectionNo: number, section: string, term: string | null, body: string[]): ParsedTerm | null {
  const text = body.join('\n').trim();
  if (!text) return null;
  const fields: Record<'definition' | 'basis' | 'example' | 'caution', string[]> = {
    definition: [],
    basis: [],
    example: [],
    caution: [],
  };
  const rest: string[] = [];
  // 글머리 단위로 자른다(들여쓴 이어지는 줄은 같은 글머리)
  const blocks: string[] = [];
  for (const line of text.split('\n')) {
    if (/^- /.test(line) || blocks.length === 0 || (!/^\s/.test(line) && !/^- /.test(blocks.at(-1)!))) {
      blocks.push(line);
    } else {
      blocks[blocks.length - 1] += `\n${line}`;
    }
  }
  for (const b of blocks) {
    const m = /^- ([^:：]{1,20})[:：]\s*([\s\S]*)$/.exec(b);
    const key = m ? FIELD[m[1]!.trim()] : undefined;
    if (m && key) fields[key].push(m[2]!.trim());
    else if (b.trim()) rest.push(b);
  }
  const join = (a: string[]) => (a.length ? a.join('\n\n') : null);
  return {
    sectionNo,
    section,
    term,
    definition: join(fields.definition),
    basis: join(fields.basis),
    example: join(fields.example),
    caution: join(fields.caution),
    rest: rest.length
      ? rest
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
      : null,
  };
}
