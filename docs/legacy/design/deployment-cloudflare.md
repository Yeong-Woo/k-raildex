# 도메인 연동 계획 — Cloudflare 도메인 ↔ 운영 서버

- 작성일: 2026-10-15 (사용자 요청 "Cloudflare 에서 도메인을 구매했는데, 우리 서버와 연동하는 방법을 계획해줘")
- 상태: **적용 완료(2026-10-18)** — https://k-raildex.com 공개(Cloudflare Tunnel, www·http 301). 도메인 **k-raildex.com**(Cloudflare Registrar 구매). 결정은 6절, 적용 기록은 7절. 남은 확인: VWorld 타일 브라우저 확인(4절 8), Search Console(10).
- 관련: [platform-architecture.md](platform-architecture.md) 3-5(공개 사이트 SSR)·3-6(호스팅), docs/REFERENCE.md P2(배포 도메인)·P3(VWorld 키 도메인 등록), CLAUDE.md "키·비밀값".

## 1. 현황

| 항목              | 지금                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 서버              | 운영자 서버 한 대, docker compose(`docker-compose.yml`)                                                                                                    |
| 공개 사이트 `web` | Next.js SSR, 호스트 포트 **5000**(모든 인터페이스에 바인딩), 요청마다 비공개 `api` 에서 데이터                                                             |
| 개발 서버 `dev`   | next dev, 5001 — 공개 대상 아님                                                                                                                            |
| 관리 앱 `admin`   | Next.js, **127.0.0.1:5200** 만(비공개, round-6 Q144 A), 토큰 로그인(httpOnly 쿠키)                                                                         |
| `api` / `db`      | 127.0.0.1:5100 / 127.0.0.1:5433 — 외부 공개 안 함(Q146 A)                                                                                                  |
| TLS·리버스 프록시 | 없음(http 만)                                                                                                                                              |
| 공인 IP           | 서버가 가정·사무실 회선에 있고 고정 IP 여부 **미확인**                                                                                                     |
| 도메인            | **k-raildex.com** — Cloudflare Registrar 에서 구매(2026-10-15) → Cloudflare 에 DNS 존(zone)이 자동으로 있다                                                 |
| 절대 URL          | `SITE_URL`(실행 환경 변수)로 sitemap·robots·canonical 을 만든다(`apps/web/src/lib/site.ts`, 없으면 `x-forwarded-host`/`host`). 바꿔도 다시 빌드하지 않는다 |
| 지도 타일         | VWorld 키는 **도메인에 묶인** 공개 키(CLAUDE.md) — 새 도메인을 키에 등록해야 타일이 나온다                                                                 |

## 2. 선택지

|               | A. Cloudflare Tunnel(cloudflared) — **권장**                                                   | B. DNS 프록시 + 포트 개방 + 서버 리버스 프록시            | C. DNS only + Let's Encrypt |
| ------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------- |
| 인바운드 포트 | **없음**(서버가 Cloudflare 로 나가는 연결만)                                                   | 443 포트포워딩 + Caddy/nginx(Cloudflare Origin CA 인증서) | 80/443 포트포워딩 + certbot |
| 공인 IP       | 유동이어도 됨, 외부에 안 보임                                                                  | 고정 IP 또는 DDNS 필요, Cloudflare 뒤에 숨음              | 고정/DDNS, **IP 노출**      |
| TLS           | Cloudflare 가 종단(인증서 자동)                                                                | Cloudflare↔서버 구간 인증서 관리                          | 서버가 직접                 |
| 비용          | 무료 플랜                                                                                      | 무료 플랜                                                 | 무료                        |
| 관리 앱 보호  | Cloudflare Access(이메일 OTP) 를 앞에 둘 수 있음                                               | 가능                                                      | 직접 구현                   |
| 단점          | 모든 트래픽이 Cloudflare 를 지남(장애 시 단일 경로), cloudflared 컨테이너 1개·토큰 비밀값 추가 | 라우터 설정·인증서 갱신                                   | 보안·인증서 전부 직접       |

A 를 권장하는 이유: 서버가 가정·사무실 회선이라 포트 개방과 IP 고정이 부담이고, 지금 구조(모든 서비스가 compose 한 네트워크)에 컨테이너 하나만 더하면 된다. B·C 는 공인 IP 가 고정이고 포트를 열 수 있을 때의 대안으로 남긴다.

## 3. 설계 (A)

### 3-1. 호스트 이름 → 컨테이너

| 공개 호스트      | 원본(터널 Public Hostname 의 Service)                | 보호                                                                                     |
| ---------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `k-raildex.com`     | `http://web:5000`                                       | 공개                                                                                     |
| `www.k-raildex.com` | (Cloudflare Redirect Rule 로 `https://k-raildex.com` 301) | —                                                                                        |
| ~~`admin.<도메인>`~~ | 만들지 않음(2026-10-18 Q-a B)                           | 관리 앱은 127.0.0.1:5200 만(SSH 터널)                                                    |

`dev`(5001)·`admin`(5200)·`api`·`db` 는 호스트 이름을 만들지 않는다(공개 안 함). 터널의 Service 에는 compose 서비스 이름을 쓴다(같은 compose 네트워크 안에서 이름으로 닿는다) — `localhost` 가 아니다. 5000 외의 포트를 뒤에 다른 도메인으로 연결할 계획(Q-b)이면 같은 터널에 Public Hostname 을 추가하거나(다른 존도 가능) 터널을 따로 만든다 — compose 서비스 이름으로 가리키면 된다.

### 3-2. docker-compose 추가(2026-10-18 반영)

```yaml
# Cloudflare Tunnel: 서버에서 Cloudflare 로 나가는 연결만 쓴다(포트 개방 없음). 호스트 이름 → 서비스 매핑은 Cloudflare 대시보드(터널 Public Hostname)에 있다.
cloudflared:
  profiles: ["tunnel"]                 # .env 의 COMPOSE_PROFILES=tunnel 로 기본 포함
  image: cloudflare/cloudflared:2026.10.1 # Docker Hub 안정 태그로 고정(latest 금지)
  command: tunnel --no-autoupdate run
  environment:
    TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN:-}
  depends_on:
    web:
      condition: service_healthy
  restart: unless-stopped
```

- `web` 의 `ports: "5000:5000"` 과 다른 포트는 **그대로 둔다**(포트 배치는 사용자 결정, 5000/5001/5200 유지). 외부에서 5000 으로 직접 들어오는 길은 라우터에서 포워딩하지 않으면 없다. 더 조이고 싶으면 `127.0.0.1:5000:5000` 으로 바꿀 수 있다(5절 Q-b).
- 프로필 `tunnel` 로 둔다. `${VAR:?}` 필수 처리는 compose 파일 전체 해석 때 걸려 토큰이 없으면 `up -d --build web` 같은 다른 명령까지 막으므로 쓰지 않는다. 대신 `.env` 의 `COMPOSE_PROFILES=tunnel` 을 토큰을 넣은 뒤에 켠다(그 전엔 cloudflared 가 기동 대상이 아니다). `web` 이미지에 HEALTHCHECK(wget 127.0.0.1:5000)가 있어 `service_healthy` 가 동작한다.

### 3-3. 환경 변수(.env — 커밋 금지)

| 변수                      | 값                    | 비고                                                                                                               |
| ------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `CLOUDFLARE_TUNNEL_TOKEN` | 터널 생성 화면의 토큰 | **비밀값**. `.env.example` 에는 이름만. 유출되면 터널을 지우고 다시 만든다(토큰은 터널에 묶임)                     |
| `SITE_URL`                | `https://k-raildex.com` | sitemap·robots·canonical. `docker compose up -d web` 으로 재시작만(다시 빌드 아님)                                 |
| `PUBLIC_ISSUES_URL`       | GitHub 이슈 양식 URL  | 제보 링크(Q148 C)                                                                                                  |
| `VWORLD_API_KEY`          | 도메인이 등록된 키    | VWorld 콘솔 "서비스 URL" 에 `https://k-raildex.com` 추가(기존 키에 추가하거나 새 키). 등록 전에는 지도 타일이 안 나온다 |

Next.js 쪽 변경은 없다: `next start` 는 호스트를 제한하지 않고, `site.ts` 가 `SITE_URL` 을 우선 읽는다. `DEV_ALLOWED_ORIGINS` 는 dev 를 공개하지 않으므로 필요 없다.

### 3-4. Cloudflare 설정

| 항목             | 값                                                                                                                                                                                                                                                                                   | 이유                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| DNS              | 터널 Public Hostname 을 만들면 CNAME(`<uuid>.cfargotunnel.com`, 프록시 켜짐)이 자동 생성                                                                                                                                                                                             | 손으로 A 레코드를 만들지 않는다                  |
| SSL/TLS          | Full(기본). 터널 구간은 Cloudflare 가 암호화하므로 서버 인증서 불필요                                                                                                                                                                                                                |                                                  |
| Always Use HTTPS | 켬                                                                                                                                                                                                                                                                                   | http 요청을 https 로                             |
| HSTS             | 처음 몇 주는 끔, 안정되면 켬                                                                                                                                                                                                                                                         | 되돌리기 어려움                                  |
| Redirect Rule    | `www.k-raildex.com/*` → `https://k-raildex.com/$1` 301                                                                                                                                                                                                                                         | 정식 호스트 하나                                 |
| 캐시             | 기본값 유지. HTML 은 Cloudflare 가 기본으로 캐시하지 않아 SSR 의 "변경 묶음 반영 → 몇 초 안에 새 데이터"가 유지된다. `/_next/static/*` 는 Next.js 가 immutable 헤더를 붙여 기본 규칙으로 캐시됨. `/map/*.geojson`·`/timetable/*`·`/route-maps/*` 를 길게 캐시하는 Cache Rule 은 선택 | 데이터 즉시 반영 원칙(platform-architecture 3-5) |
| Access           | 쓰지 않음(2026-10-18 Q-a B — 관리 앱을 공개하지 않으므로 Access 응용 프로그램도 만들지 않는다)                                                                                                                                                                                     | 관리 앱 비공개(Q144 A) 유지                      |
| WAF·Bot          | 무료 기본 규칙만. 검색엔진 봇은 차단하지 않음                                                                                                                                                                                                                                        | 공개 사이트 색인                                 |
| Email Routing    | 쓰지 않음(2026-10-18 Q-e). 제보 창구는 GitHub 이슈                                                                                                                                                                                                      |                                                  |

### 3-5. 원칙 확인

- 비상업 원칙(CLAUDE.md 7): Cloudflare 무료 플랜, 광고·유료 기능 없음. 코레일 노선도(공공누리 제4유형) 게시 조건에 영향 없음.
- 비공개 API(Q146 A): 브라우저는 여전히 `web` 이 만든 HTML 만 받는다. `api` 는 호스트 이름을 만들지 않는다.
- 키·비밀값: 터널 토큰·`SITE_URL` 은 `.env` 에만. `.env.example` 과 CLAUDE.md 키 목록에 이름을 추가한다(이 문서와 함께 반영).

## 4. 적용 절차(체크리스트) — k-raildex.com

서버 쪽(1·3·6)은 2026-10-18 준비됐고, 대시보드 쪽(2·4·5·7·8)은 운영자가 한다. 진행 상황은 7-2 에 적는다.

1. [x] 서버: `docker-compose.yml` 에 `cloudflared`(프로필 tunnel) 추가, `.env` 에 `SITE_URL=https://k-raildex.com`·`CLOUDFLARE_TUNNEL_TOKEN=`(빈칸)·`#COMPOSE_PROFILES=tunnel` 추가(2026-10-18).
2. [x] 대시보드: `k-raildex.com` → DNS: Registrar 기본 레코드(있다면 A/AAAA/CNAME 자리표시)가 없는지 확인. 있으면 지운다. 터널 CNAME 과 충돌하면 Public Hostname 생성이 실패한다.
3. [x] 대시보드: Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared → 이름 `k-raildex` → 설치 안내 화면의 명령에서 `--token` 뒤 긴 문자열(토큰)만 복사 → 서버 `.env` 의 `CLOUDFLARE_TUNNEL_TOKEN=` 에 붙여 넣고 `#COMPOSE_PROFILES=tunnel` 의 `#` 을 지운다.
4. [x] 서버: `docker compose up -d cloudflared` → `docker compose logs cloudflared` 에 "Registered tunnel connection" 이 보이면 성공(대시보드 터널 상태 HEALTHY). 대시보드 설치 안내는 "Next" 로 넘어간다(서버에 cloudflared 를 따로 설치하지 않는다 — 컨테이너가 그 역할).
5. [x] 대시보드: 터널 → Public Hostname(새 UI: 게시된 애플리케이션 경로 → 경로 추가) → Subdomain 비움, Domain `k-raildex.com`, Path 비움, 서비스 URL `http://web:5000`(새 UI 는 프로토콜까지 한 칸에; `web:5000` 만 넣으면 형식 오류) → Save. DNS 탭에 `k-raildex.com` CNAME(`<uuid>.cfargotunnel.com`, 프록시 켜짐)이 생겼는지 확인.
6. [x] 서버: `.env` 의 `SITE_URL=https://k-raildex.com` 으로 `docker compose up -d web` 재시작(2026-10-18). 공개 뒤 `curl -s https://k-raildex.com/robots.txt` 에 `Sitemap: https://k-raildex.com/sitemap.xml` 이 나오는지 확인.
7. [x] 대시보드: SSL/TLS → Overview 암호화 모드 Full(기본값이면 그대로); Edge Certificates → Always Use HTTPS 켬. Rules → Redirect Rules → Create: 이름 `www to apex`, 조건 Hostname equals `www.k-raildex.com`, 동작 Dynamic redirect, 식 `concat("https://k-raildex.com", http.request.uri.path)`, 상태 301, 쿼리 문자열 보존 켬. `www` 용 DNS 레코드가 없으면 리다이렉트가 동작하지 않으므로 DNS 에 `www` CNAME → `k-raildex.com`(프록시 켜짐)을 하나 만든다.
8. [ ] VWorld 콘솔: 인증키의 서비스 URL 에 `https://k-raildex.com` 추가(기존 키에 추가하거나 새 키). 키를 새로 만들었으면 `.env` 갱신 후 `docker compose up -d web`. `/map/` 에서 타일이 나오는지 확인(안 나오면 브라우저 콘솔 403).
9. [x] 점검(2026-10-18, 아래 7-2): `curl -I https://k-raildex.com/`(200, `server: cloudflare`), `curl -I http://k-raildex.com/`(301 → https), `curl -I https://www.k-raildex.com/`(301 → apex), `/sitemap.xml`, `/map/`, `/plans/`, 검색창. `https://k-raildex.com:5200`·`admin.k-raildex.com` 은 열리지 않아야 한다. 외부 망(휴대전화 LTE)에서도 확인.
10. [ ] 선택: Google Search Console 도메인 속성(DNS TXT) 등록 → sitemap 제출. HSTS 는 몇 주 안정 뒤.
11. [x] 문서 갱신(2026-10-18): README 배포 절, docs/REFERENCE.md P2 → 결정 사항, docs/PLAN.md 0-7 배포 행, CLAUDE.md 디렉터리·키 목록. 이 문서 상태를 "적용 완료(날짜)"로.

## 5. 운영 메모

- 서버 재부팅: `restart: unless-stopped` 라 compose 가 다시 올린다. 터널은 `web` 이 healthy 가 된 뒤 붙는다.
- cloudflared 갱신: 이미지 태그를 올리고 `docker compose up -d cloudflared`. `latest` 는 쓰지 않는다(재현성).
- 장애: Cloudflare 장애 시 사이트 접속 불가(단일 경로). 서버 쪽은 `docker compose logs cloudflared` 와 대시보드 터널 상태로 구분.
- 토큰 유출: 터널 삭제 → 새 터널 → 새 토큰 → Public Hostname 다시.
- dev(5001)·admin(5200) 포트 배치는 그대로(사용자 지시). admin 은 `127.0.0.1:5200`(SSH 터널) 한 길뿐이다(Q-a B).
- 다른 포트를 다른 도메인에 붙일 때: 같은 터널의 Public Hostname 에 호스트 → `http://<compose 서비스>:<포트>` 를 추가한다(dev 는 `dev:5000`, admin 은 `admin:5200`). 공개 범위가 바뀌는 결정이므로 그때 질문으로 올린다.

## 6. 결정 사항 (2026-10-18 사용자 답변 — round-9 질문 후보였던 Q-a~e)

| 질문 | 답 | 반영 |
| --- | --- | --- |
| Q-a 관리 앱 `admin.<도메인>` 공개 | **B** 공개하지 않음, localhost(127.0.0.1:5200)로만 관리 | 터널에 admin 호스트 없음, Access 없음 |
| Q-b `web` 5000 바인딩 | **A** 5000 을 그대로 두고 이 포트만 도메인에 연결. 다른 포트는 뒤에 다른 도메인에 연결할 계획 | compose 포트 변경 없음, 5절 메모 |
| Q-c `www` 처리 | **A** `www.k-raildex.com` → `https://k-raildex.com` 301(권장안) | 4절 7단계 |
| Q-d 도메인 이름 | **k-raildex.com** | 문서·`.env.example`·`SITE_URL` |
| Q-e Email Routing | 없음 | — |

용어: **apex**(루트 도메인) = 하위 이름이 없는 `k-raildex.com` 그 자체. `www.k-raildex.com` 은 그 아래 하위 호스트다. 정식 주소를 apex 하나로 두고 `www` 로 들어온 요청을 apex 로 301 돌리는 것이 요즘 일반적인 방식이라 A 를 권장했다(검색엔진 색인·canonical 이 한 주소로 모인다).

## 7. 적용 기록

### 7-1. 2026-10-18 서버 준비

- `docker-compose.yml`: `cloudflared` 서비스(프로필 `tunnel`, `cloudflare/cloudflared:2026.10.1`, `TUNNEL_TOKEN` ← `CLOUDFLARE_TUNNEL_TOKEN`, `web` healthy 뒤 기동).
- `.env.example`: `COMPOSE_PROFILES` 추가, `SITE_URL` 예를 k-raildex.com 으로.
- `.env`(커밋 안 함): `SITE_URL=https://k-raildex.com`, `CLOUDFLARE_TUNNEL_TOKEN=`(빈칸, 운영자가 채움), `#COMPOSE_PROFILES=tunnel`.
- `web` 을 `SITE_URL` 로 재시작 → `/robots.txt` 의 Sitemap 이 `https://k-raildex.com/sitemap.xml`.

### 7-2. 2026-10-18 공개·점검

- 터널 `k-raildex`(Zero Trust) 생성, 토큰을 `.env` 에 넣고 `COMPOSE_PROFILES=tunnel` 활성 → `docker compose up -d cloudflared`: 로그 "Registered tunnel connection" 4개(서울 icn01·icn06, QUIC), 사전 점검 전부 PASS.
- Public Hostname `k-raildex.com → http://web:5000` 저장(11:38 터널 설정 갱신 확인). 한국어 새 UI 에서는 "게시된 애플리케이션 경로 → 경로 추가", 서비스 URL 은 프로토콜 포함.
- DNS: `k-raildex.com` CNAME(터널), `www` CNAME → `k-raildex.com`(프록시). Always Use HTTPS 켬. 리디렉션 규칙 www → apex(템플릿 "WWW에서 루트로 리디렉션" 또는 동적 식 `concat("https://k-raildex.com", http.request.uri.path)`, 301, 쿼리 유지). www 가 터널 404("No webpage was found")로 떨어지던 것은 규칙 적용으로 해결 — 터널에 www 를 넣지 않는다.
- 점검(서버에서 curl): DNS 는 Cloudflare IP 만 노출(104.21.x/172.67.x, IPv6). `https://k-raildex.com/` 200 `server: cloudflare`; `/sitemap.xml`·`/map/`·`/plans/`·계획 상세·`/map/plans.geojson` 200; robots `Sitemap: https://k-raildex.com/sitemap.xml`; `http://k-raildex.com/` → 301 https; `https://www.k-raildex.com/plans/?area=all` → 301 `https://k-raildex.com/plans/?area=all`(쿼리 유지, 최종 200). VWorld 타일은 Referer k-raildex.com 으로 curl 200(png)이나 브라우저 확인은 아직.
- 문서 갱신: README 공개 주소 절, docs/REFERENCE.md P2 완료, docs/PLAN.md 0-7·8절, CLAUDE.md 디렉터리 목록.
- 보안 메모(사용자 질문): 리디렉션 규칙은 이 존에 들어온 요청에만 적용되고 존의 규칙·DNS 는 계정 소유자만 바꿀 수 있다. 남이 자기 도메인을 우리 쪽으로 돌리는 것은 링크와 같고, 우리 요청을 가로채려면 계정 탈취가 필요하다 → 계정 2단계 인증·터널 토큰 보관이 실제 방어선.

## 8. 성능 (2026-10-18 공개 직후 측정·조치)

### 8-1. 측정 (서버에서 curl, 같은 페이지 직접 vs 도메인)

| 요청 | 직접 127.0.0.1:5000 | k-raildex.com | 비고 |
| --- | --- | --- | --- |
| `/` | 0.01s | 1.6s | TCP 0.18s·TLS 0.42s·첫 바이트 1.4s |
| `/plans/` | 0.12s | 1.2s | HTML gzip 97KB |
| `/stations/` | 0.41s | 2.1s | HTML gzip 226KB |
| `/map/lines.geojson` | 0.04s | **5.8s** | 조치 전: 2.8MB 무압축, `max-age=0`, Cloudflare DYNAMIC |
| `/_next/static/*` | — | 빠름 | Cloudflare HIT(immutable) |

- 접속점: 서버에서 k-raildex.com 은 `cdn-cgi/trace` `colo=LAX`(로스앤젤레스). 같은 서버에서 speed.cloudflare.com 은 `colo=ICN`, 업로드 39MB/s·다운로드 44MB/s. 터널 자체는 서울(icn01·icn06)에 붙어 있다. 즉 회선·터널은 빠르고, **무료 요금제 존의 anycast 대역이 이 통신사에서 미국으로 라우팅**되는 것이 왕복 지연의 원인(한국 통신사 상호접속 비용 문제로 알려진 현상). Pro 요금제로 올리면 ICN/NRT 를 받는 경우가 많지만 보장은 없고, 비상업 원칙상 결제하지 않는다. 이용자 쪽 접속점은 브라우저에서 `https://k-raildex.com/cdn-cgi/trace` 의 `colo=` 로 확인.

### 8-2. 조치 (서버, 커밋)

1. `apps/web/src/lib/artifact.ts`: 산출물(map/·timetable/)을 요청이 gzip 을 받으면 `CompressionStream('gzip')` 으로 압축해 보낸다(lines.geojson 2.8MB → 0.68MB). ETag 는 인코딩별(`-gz`), `vary: accept-encoding`, If-None-Match 304 유지.
2. 판 태그 URL: `lib/data.ts dataVersionTag()`(= /meta 적재 시각·커밋의 sha256 앞 12자)를 지도 페이지(PageScript arg `v`)와 역 상세 시간표 링크(`routes.timetableFile(id, v)`)에 붙여 `…geojson?v=<태그>` 로 요청하고, `?v=` 가 있으면 `cache-control: public, max-age=31536000, immutable` 로 응답한다. worker 가 build_artifact 를 먼저 적재하고 /meta 를 마지막에 쓰므로 새 태그 URL 은 항상 새 산출물이다 → "반영 → 몇 초 안에 새 데이터" 유지. 태그 없는 요청은 종전(`max-age=0` + ETag).
3. `packages/pipeline/src/ingest/build-map.ts serialize`: 소수를 5자리(약 1m)로 줄여 쓴다(OSM round6 → 11만 5천 점). worker 이미지 재빌드 + `pnpm db:rebuild`.

### 8-3. 대시보드에서 할 것 (운영자)

- **Cache Rule**(필수 — Cloudflare 는 `.geojson`·`.json` 을 기본으로 캐시하지 않아 immutable 을 줘도 `cf-cache-status: DYNAMIC`): Caching → Cache Rules → Create rule. 이름 `artifacts`, 조건: URI Path starts with `/map/` **OR** URI Path starts with `/timetable/`. 동작: Cache eligibility **Eligible for cache**, Edge TTL **Use cache-control header if present, bypass cache if not**(원점 헤더 따름 — `?v=` 없는 요청은 `max-age=0` 이라 저장되지 않는다), Browser TTL **Respect origin**. 배포. 확인: `curl -sI "https://k-raildex.com/map/lines.geojson?v=<태그>"` 두 번째가 `cf-cache-status: HIT`.
- 선택: Speed → Optimization → Protocol Optimization 의 HTTP/3(QUIC)·0-RTT, Content Optimization 의 Early Hints 켬. Caching → Tiered Cache → Smart Tiered Cache 켬(접속점 간 캐시 공유).
- 기대: 지도 GeoJSON 은 판이 바뀌지 않는 한 두 번째 방문자부터 가장자리 캐시(가정 회선·터널을 타지 않음). 접속점 왕복 지연(8-1)은 남는다.

