/** 외부 API XML 응답 → JSON(fast-xml-parser). 값은 문자열 그대로(결과 코드 '00'·역 ID 앞자리 0 보존) */
import { XMLParser } from 'fast-xml-parser';
import type { XmlParser } from '@k-raildex/domain';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
});

export const parseXml: XmlParser = (text) => parser.parse(text) as unknown;
