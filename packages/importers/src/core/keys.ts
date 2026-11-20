/**
 * API 키 조회: 서비스별 변수 → 공통 변수 순(CLAUDE.md 6절, .env.example). 값은 로그·기록에 남기지 않는다.
 */
export function apiKey(
  serviceVar: string | null | undefined,
  commonVar = 'DATA_GO_KR_KEY',
  env: NodeJS.ProcessEnv = process.env,
): { key: string; var: string } | null {
  for (const v of [serviceVar, commonVar]) {
    if (!v) continue;
    const val = env[v]?.trim();
    if (val) return { key: val, var: v };
  }
  return null;
}

/** 공공데이터포털 키 변수의 공통 변수 이름(provider → 공통 변수) */
export function commonKeyVar(provider: string): string {
  switch (provider) {
    case 'kric':
      return 'KRIC_KEY';
    case 'seoul_open':
      return 'SEOUL_OPEN_KEY';
    case 'law_go_kr':
      return 'LAW_GO_KR_OC';
    case 'vworld':
      return 'VWORLD_API_KEY';
    default:
      return 'DATA_GO_KR_KEY';
  }
}
