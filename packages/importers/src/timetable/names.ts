/** 역명 정규화(기존 packages/pipeline/src/ingest/lib.ts 의 cleanName·baseKey 와 같은 규칙) */

export function cleanName(s: string): string {
  return s
    .replace(/[\r\n\t]+/g, '')
    .replace(/[․∙•・｡ㆍ･‧]/g, '·')
    .replace(/(?<=[가-힣])\.(?=[가-힣])/g, '·')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 대조용 키: 공백·괄호 부역명·가운뎃점·끝 "역" 제거 */
export function baseKey(s: string): string {
  const t = cleanName(s)
    .replace(/\s+/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/·/g, '')
    .replace(/역$/, '');
  return t || cleanName(s).replace(/\s+/g, '');
}
