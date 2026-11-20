/** DI 토큰 */
export const CONFIG = Symbol('CONFIG');
export const PG_POOL = Symbol('PG_POOL');
/** Cloudflare Access 공개키 해석기(jose JWTVerifyGetKey). 시험에서 로컬 키로 바꾼다 */
export const ACCESS_KEYS = Symbol('ACCESS_KEYS');
/** 문서 저장소(ObjectStore). 시험은 MemoryObjectStore */
export const OBJECT_STORE = Symbol('OBJECT_STORE');
/** 작업 큐(JobQueue). 운영은 pg-boss, 시험은 기록용 가짜 */
export const JOB_QUEUE = Symbol('JOB_QUEUE');
