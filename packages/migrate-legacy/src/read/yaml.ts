/**
 * YAML 읽기 — `yaml` Document API 로 주석을 보존해 읽는다(FR-MIG-005).
 * - 레코드(최상위 시퀀스 항목)의 앞·줄 끝 주석과 레코드 안쪽 주석을 모아 editor_note 로 쓴다.
 * - 파일 머리 주석(문서 첫 주석)은 header 로 따로 돌려준다(docs/legacy/own-file-headers.md 용, Q41 A).
 */
import { readFileSync } from 'node:fs';
import { isMap, isNode, isPair, isScalar, isSeq, parseDocument, visit, type Node } from 'yaml';

export interface YamlRecords<T = Record<string, unknown>> {
  file: string;
  header: string | null;
  items: T[];
  /** items 와 같은 순서의 주석(없으면 null) */
  comments: (string | null)[];
}

function clean(c: string | null | undefined): string | null {
  if (c == null) return null;
  const t = c
    .split('\n')
    .map((l) => l.replace(/^\s?/, '').trimEnd())
    .join('\n')
    .trim();
  return t.length ? t : null;
}

/** 노드 안의 모든 주석(앞·줄 끝)을 문서 순서대로 모은다 */
function collectComments(node: Node): string[] {
  const out: string[] = [];
  const push = (c: string | null | undefined) => {
    const t = clean(c);
    if (t) out.push(t);
  };
  push(node.commentBefore);
  visit(node, (_key, n) => {
    if (n === node) return;
    if (isNode(n)) {
      push(n.commentBefore);
      push(n.comment);
    } else if (isPair(n) && isScalar(n.key)) {
      push(n.key.commentBefore);
      push(n.key.comment);
    }
  });
  push(node.comment);
  return out;
}

export function parseYamlRecords<T = Record<string, unknown>>(text: string, file = '<inline>'): YamlRecords<T> {
  const doc = parseDocument(text, { keepSourceTokens: false });
  if (doc.errors.length) throw new Error(`${file}: YAML 오류 ${doc.errors[0]!.message}`);
  const header = clean(doc.commentBefore);
  const contents = doc.contents;
  const js = doc.toJS() as unknown;
  if (!isSeq(contents) || !Array.isArray(js)) {
    return { file, header, items: js == null ? [] : ([js] as T[]), comments: [collectOrNull(contents)] };
  }
  const comments = contents.items.map((it) => (isNode(it) ? collectOrNull(it) : null));
  // 시퀀스 끝 주석(마지막 항목 뒤)은 마지막 레코드에 붙인다
  const tail = clean(contents.comment);
  if (tail && comments.length) {
    const last = comments.length - 1;
    comments[last] = comments[last] ? `${comments[last]}\n${tail}` : tail;
  }
  return { file, header, items: js as T[], comments };
}

function collectOrNull(node: unknown): string | null {
  if (!isNode(node)) return null;
  if (!isMap(node) && !isSeq(node) && !isScalar(node)) return null;
  const c = collectComments(node);
  return c.length ? c.join('\n') : null;
}

export function readYamlRecords<T = Record<string, unknown>>(path: string): YamlRecords<T> {
  return parseYamlRecords<T>(readFileSync(path, 'utf8'), path);
}
