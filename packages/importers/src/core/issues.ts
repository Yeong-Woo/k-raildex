/** 수집 실행 중 사람 확인이 필요한 항목(종류별 목록) — 실행 stats·log 에 들어간다 */
export class IssueLog {
  readonly items = new Map<string, string[]>();

  add(kind: string, detail: string): void {
    const l = this.items.get(kind) ?? [];
    this.items.set(kind, l);
    l.push(detail);
  }

  counts(): Record<string, number> {
    return Object.fromEntries([...this.items.entries()].sort().map(([k, v]) => [k, v.length]));
  }

  toJSON(limit = 200): Record<string, string[]> {
    return Object.fromEntries([...this.items.entries()].sort().map(([k, v]) => [k, v.slice(0, limit)]));
  }

  toMarkdown(limit = 100): string[] {
    const md: string[] = [];
    for (const [k, v] of [...this.items.entries()].sort()) {
      md.push(`### ${k} (${v.length}건)`, '');
      for (const it of v.slice(0, limit)) md.push(`- ${it}`);
      if (v.length > limit) md.push(`- … 외 ${v.length - limit}건`);
      md.push('');
    }
    return md;
  }
}
