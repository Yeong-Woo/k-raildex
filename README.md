# 한국철도도감 (K-Raildex)

대한민국 철도의 **현재 정보**(노선·역·운행 계통·열차·계획 시간표)와 **계획 정보**(상위 계획·계획 사업·사업 단계·근거 고시)를 출처와 함께 제공하는 비상업 공개 사이트 — DB 원천 재구축 저장소.

- 설계: [docs/README.md](docs/README.md) · 결정: [docs/decisions.md](docs/decisions.md) · 구현 계획: [docs/11-implementation-plan.md](docs/11-implementation-plan.md)
- 에이전트·작업 규칙: [CLAUDE.md](CLAUDE.md)

## 개발

```bash
pnpm install
cp .env.example .env    # 값 채우기(커밋 금지)
pnpm dev:infra          # PostgreSQL(PostGIS) 127.0.0.1:5440 + S3(SeaweedFS) 127.0.0.1:8333
pnpm check && pnpm lint && pnpm test
```

## 라이선스

코드 MIT, 자체 데이터 CC BY 4.0, 공공데이터·OSM·노선도 이미지는 각 출처 조건.
