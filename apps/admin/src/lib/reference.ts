import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface CodeOption {
  value: string;
  label: string;
  desc?: string;
}
export interface Reference {
  codes: Record<string, CodeOption[]>;
  areas: { code: string; name_ko: string }[];
  regions: { code: string; name_ko: string; short_ko: string; area_code: string }[];
  external_systems: { code: string; name_ko: string; entity_type: string }[];
}

/** 코드값 라벨·권역·시·도·외부 시스템(폼 구성) — 한 번 받아 캐시 */
export function useReference() {
  return useQuery({
    queryKey: ['reference'],
    queryFn: () => api<Reference>('/v1/admin/reference'),
    staleTime: Infinity,
  });
}
