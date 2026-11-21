# 관리 앱: Vite 정적 빌드 + nginx(/v1·/health 는 api 컨테이너로) (docs/02-architecture.md 5절)
FROM node:24-bookworm-slim AS build
ENV SKIP_SIMPLE_GIT_HOOKS=1 CI=1
RUN corepack enable && corepack prepare pnpm@12.10.1 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# 지도 키는 빌드 때 주입(도메인 제한 공개 키). 없으면 OSM 타일로 대체
ARG VITE_VWORLD_API_KEY=
ARG VITE_GOOGLE_MAPS_API_KEY=
RUN pnpm -F @k-raildex/admin build

FROM nginx:1.28-alpine
COPY docker/admin.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
EXPOSE 80
