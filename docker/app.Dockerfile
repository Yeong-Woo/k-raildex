# api·worker·도구(마이그레이션·수집기) 공용 이미지 (docs/02-architecture.md 5절)
# 서버 1대 운영 규모라 작업 공간 전체를 설치한 이미지 하나를 서비스마다 다른 명령으로 쓴다.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH SKIP_SIMPLE_GIT_HOOKS=1 CI=1
RUN corepack enable && corepack prepare pnpm@12.10.1 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -F @k-raildex/api build && pnpm -F @k-raildex/worker build

FROM base AS runtime
# worker 의 PDF 처리(pdftotext·pdftoppm), 운영 백업(pg_dump)
RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils postgresql-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
