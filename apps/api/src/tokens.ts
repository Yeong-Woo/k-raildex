/** DI 토큰 */
export const CONFIG = Symbol('CONFIG');
export const PG_POOL = Symbol('PG_POOL');
/** Cloudflare Access 공개키 해석기(jose JWTVerifyGetKey). 시험에서 로컬 키로 바꾼다 */
export const ACCESS_KEYS = Symbol('ACCESS_KEYS');
