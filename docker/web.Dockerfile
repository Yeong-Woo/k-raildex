# 공개 사이트: Next.js standalone 출력(docs/06-public-web.md 6절, docs/02-architecture.md 5절)
# 데이터는 실행 때 공개 API(PUBLIC_API_URL)에서 받으므로 빌드에는 API·DB 가 필요 없다(모든 페이지가 요청 때 렌더).
FROM node:24-bookworm-slim AS build
ENV SKIP_SIMPLE_GIT_HOOKS=1 CI=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@12.10.1 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -F @k-raildex/web build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
# standalone = 서버 + 추적된 node_modules(모노레포 구조 그대로). 정적 파일·public 은 따로 복사한다
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
