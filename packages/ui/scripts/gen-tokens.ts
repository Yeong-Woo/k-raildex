// tokens.css 생성기 — `node packages/ui/scripts/gen-tokens.ts` (node 의 타입 제거 실행)
// 저장소의 Prettier 설정으로 정리해서 쓴다(시험은 공백을 무시하고 비교한다).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { renderTokensCss } from '../src/tokens.ts';

const out = fileURLToPath(new URL('../src/tokens.css', import.meta.url));
const config = (await resolveConfig(out)) ?? {};
writeFileSync(out, await format(renderTokensCss(), { ...config, filepath: out }));
console.log(`tokens.css 를 썼습니다: ${out}`);
