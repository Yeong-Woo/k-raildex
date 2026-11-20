import { codes, type EntityType } from '@k-raildex/contracts';

/** URL·API 경로의 개체 종류(kebab-case) */
export const toSlug = (t: EntityType) => t.replace(/_/g, '-');
export const fromSlug = (s: string): EntityType | null => {
  const t = s.replace(/-/g, '_');
  return (codes.entityType.values as readonly string[]).includes(t) ? (t as EntityType) : null;
};

/** 내비게이션 묶음(05 문서 2절) */
export const NAV_GROUPS: { label: string; types: EntityType[] }[] = [
  { label: '망', types: ['station', 'line', 'service', 'train_class'] },
  { label: '계획', types: ['plan_program', 'plan', 'transfer_center'] },
  { label: '연표·번호', types: ['event', 'train_number_range', 'rolling_stock_range'] },
  { label: '기타', types: ['operator', 'source', 'route_map', 'glossary_term', 'line_station'] },
];
