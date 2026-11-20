# K-Raildex(한국철도도감) 재구축 설계 문서

- 작성일: 2026-11-20
- 대상: `/home/kimyw/Git/future-rail-db`(이하 **기존 시스템**)를 대체하는 새 구현(이 저장소, 이하 **새 시스템**)
- 상태: **설계 확정본**(round-01~03 결정 반영, 2026-11-20). 결정 표 [decisions.md](decisions.md). 구현 계획 [11-implementation-plan.md](11-implementation-plan.md).

## 문서 목록

| #   | 문서                                                       | 내용                                                                  |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| 01  | [01-overview.md](01-overview.md)                           | 목적, 범위, 승계 제약(불변 원칙), 기존 시스템과의 차이, 용어          |
| 02  | [02-architecture.md](02-architecture.md)                   | 전체 구조, 기술 스택, 모노레포 구성, 데이터 흐름, 배포                |
| 03  | [03-data-model.md](03-data-model.md)                       | **DB 스키마 전체**(테이블·열·제약·관계·파생 뷰), 검증 규칙, 감사·이력 |
| 04  | [04-api.md](04-api.md)                                     | NestJS API 모듈, 엔드포인트, 인증·권한, 쓰기 흐름, 캐시               |
| 05  | [05-admin-app.md](05-admin-app.md)                         | 관리 앱 요구사항(전 개체 조회·수정·삭제, 특수 편집기, 검수 대기열)    |
| 06  | [06-public-web.md](06-public-web.md)                       | 공개 사이트 요구사항(라우트, 화면, 디자인, SEO)                       |
| 07  | [07-migration.md](07-migration.md)                         | 기존 시스템 데이터 이관 절차와 대응표                                 |
| 08  | [08-ingestion-closed-loop.md](08-ingestion-closed-loop.md) | 공공데이터 수집기와 LLM 에이전트 Closed Loop(후순위)                  |
| 09  | [09-non-functional.md](09-non-functional.md)               | 성능, 보안, 접근성, 라이선스, 백업, 관측, 테스트, CI                  |
| 10  | [10-roadmap.md](10-roadmap.md)                             | 단계별 구현 순서와 완료 기준                                          |
| 11  | [11-implementation-plan.md](11-implementation-plan.md)     | 상세 구현 계획(작업 패키지·마이그레이션 순서·완료 기준·위험)          |
| —   | [review/README.md](review/README.md)                       | 리뷰 운영 규칙                                                        |
| —   | [review/round-01.md](review/round-01.md)                   | **1차 리뷰 질문**(추천 답변 포함) — 답변 완료                         |
| —   | [review/round-02.md](review/round-02.md)                   | **2차 리뷰 질문**(후속 질문·미래 지도) — 답변 완료                    |
| —   | [review/round-03.md](review/round-03.md)                   | **3차 리뷰 질문**(3개) — 답변 완료                                    |
| —   | [decisions.md](decisions.md)                               | 확정된 결정 표(Q1~Q96)                                                |

## 읽는 순서

1. 01 → 02 로 전체 그림을 잡는다.
2. 03(스키마)이 모든 구현의 기준이다. 우선순위 1번은 "스키마 정돈 → 관리 앱"이므로 03·04·05·07 이 1차 구현 범위다.
3. 06(공개 사이트)·08(Closed Loop)은 후속 단계다.

## 표기 규칙

- 언어: 한국어. 날짜 `YYYY-MM-DD`.
- 요구사항 ID: `FR-<영역>-<번호>`(기능), `NFR-<영역>-<번호>`(비기능). 영역 약어: `DM` 데이터 모델, `API`, `ADM` 관리 앱, `WEB` 공개 사이트, `MIG` 이관, `ING` 수집, `AGT` 에이전트, `OPS` 운영.
- 결정 참조: `(Q12 A)` = 확정된 결정(decisions.md). `(→ R-Qn)` = 열린 질문(현재 없음).
- 철도 용어 표기는 용어 사전을 따른다(이관 전에는 기존 시스템 `docs/TERMINOLOGY.md`, 이관 후에는 DB `glossary_term` 과 그 사본, Q4·Q86).
- "기존 시스템 경로"는 `future-rail-db/…` 로 줄여 쓴다.
