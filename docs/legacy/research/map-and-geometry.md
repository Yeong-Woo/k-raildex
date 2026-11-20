# 노선도·지도 기술 조사

- 조사일: 2026-10-11
- 조사 방식: WebSearch/WebFetch/curl로 공식 페이지 직접 열람, Overpass API로 OSM 한국 철도 데이터 직접 집계. "미확인"은 직접 열람으로 확인하지 못한 항목.
- 편집 주: 6절의 "미래철도20XX를 찾지 못함"은 조사 담당의 한계이며, 해당 사이트(metro20xx.kr, 카카오 지도 + 도식 노선도)는 docs/research/benchmark-sites.md에서 별도로 분석했다.

## 1. 공개 노선도 자료

| 노선도                                           | 기관                                | URL                                                                                                                                                                                                                | 형식                                               | 이용 조건                                                                                                                                                             | 비고                                                                                                                                                                                                  |
| ------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 한국철도노선도 (전국, KTX 포함, "2025.1.1 기준") | 한국철도공사(코레일)                | https://info.korail.com/info/contents.do?key=857&pageId=TK0403020001 (PDF: `/downloadContentsFile.do?key=857&fileNo=1149`, 이미지: `fileNo=947`, 표시 이미지 `/DATA/contents/main/korailroutemap_260101.jpg`)      | PDF, JPG                                           | **공공누리 제4유형 (출처표시+상업적 이용금지+변경금지)** — 페이지에 명시                                                                                              | 원본 그대로 비상업 목적 재게시·링크만 가능. 자르기·가공·재가공 불가. 파일명으로 보아 연 1회(1월 1일 기준) 갱신 추정(공식 갱신 주기 미확인). 코레일 수도권 전철 전용 노선도는 별도로 확인 못함(미확인) |
| 수도권 지하철 노선도 (사이버스테이션)            | 서울교통공사                        | https://www.seoulmetro.co.kr/kr/cyberStation.do — 다운로드: `/download/map_korea.pdf`, `/download/map_english.jpg`, `/download/map_japanese.jpg`, `/download/map_chinese.jpg`, `/download/map_color_blindness.zip` | PDF, JPG, ZIP(색각이상자용)                        | 페이지 소스에 **공공누리 제3유형(출처표시+변경금지)** 아이콘·링크(kogl.or.kr/info/licenseType3.do)가 들어 있으나 `display:none` 처리됨 → 적용 범위는 공사에 확인 필요 | 한/영/일/중 4개 언어. SSL 인증서 오류로 일반 fetch 실패, curl -k로 확인. 갱신 주기 미확인                                                                                                             |
| 부산 도시철도 노선도 (1~4호선 개별+통합)         | 부산교통공사                        | https://www.data.go.kr/data/15054957/fileData.do                                                                                                                                                                   | PNG                                                | 공공데이터포털 "이용허락범위 제한 없음" (공공누리 유형 미표시)                                                                                                        | 기준일 2024-09-30, "수시(1회성)". 다국어판(검색 결과상 15054958)은 직접 열람 못함. 공사 홈페이지(humetro.busan.kr)는 에러 페이지 반환 → 미확인                                                        |
| 대전 도시철도 1호선 노선도                       | 대전교통공사                        | https://www.data.go.kr/data/15050368/fileData.do                                                                                                                                                                   | JPG (한글/영문/한문판은 GIF로 별도 등록, 검색결과) | "이용허락범위 제한 없음" (공공누리 유형 미표시)                                                                                                                       | 2025-10-31 기준, 수정 2025-11-21. 공사 홈페이지(djet.co.kr) 접속 거부 → 미확인                                                                                                                        |
| 인천 도시철도 노선도                             | 인천교통공사                        | https://www.ictr.or.kr/main/railway/guidance/map.jsp (이미지 `/main/img/contents/railway_map.gif?=v2026`)                                                                                                          | GIF (이미지맵)                                     | 페이지 하단 "COPYRIGHT © INCHEON TRANSIT CORPORATION. ALL RIGHTS RESERVED." — 공공누리 표시 없음                                                                      | 수도권 노선도는 서울교통공사 사이버스테이션으로 외부 링크. 재배포 가능 여부 미확인(링크만 안전)                                                                                                       |
| 광주 도시철도 2호선(건설 중) 노선도              | 전남광주통합특별시 도시철도건설본부 | https://www.data.go.kr/data/15081251/fileData.do                                                                                                                                                                   | PNG                                                | "이용허락범위 제한 없음"                                                                                                                                              | 연간 갱신. 1호선 노선도(광주교통공사)는 data.go.kr에서 미발견, gwangjusubway.co.kr 접속 거부 → 미확인                                                                                                 |
| 대구 도시철도 노선도                             | 대구교통공사                        | dtro.or.kr (안티봇 스크립트로 열람 실패)                                                                                                                                                                           | 미확인                                             | 미확인                                                                                                                                                                | data.go.kr에는 노선도 이미지 없음(역간거리·구간정보 CSV만 있음, 검색 결과)                                                                                                                            |
| 호남고속철도 노선도(1·2단계)                     | 국가철도공단                        | https://www.data.go.kr/data/15118168/fileData.do                                                                                                                                                                   | JPEG                                               | "이용허락범위 제한 없음"                                                                                                                                              | 2023-08-09 등록. 국가철도공단 홈페이지(kr.or.kr)에는 전국 노선도 PDF 없음(철도건설 브로셔 팝업만)                                                                                                     |
| 국토교통부 전국 철도 노선도                      | 국토교통부                          | —                                                                                                                                                                                                                  | —                                                  | —                                                                                                                                                                     | 독립 노선도 파일 미발견. 국가철도망 구축계획 고시문(HWP)에 노선도가 포함된 것으로 검색 결과에 나오나 직접 열람 실패(molit.go.kr 리다이렉트 오류) → 미확인                                             |
| SRT 노선도                                       | (주)SR                              | https://etk.srail.kr/hpg/hra/01/selectMapInfo.do                                                                                                                                                                   | HTML(텍스트 노선 선택 메뉴)                        | 저작권 표시 없음                                                                                                                                                      | 이미지 노선도 파일은 미발견. 경부/호남/전라/경전/동해 5개 계통 역 목록만 제공                                                                                                                         |

요약: **재배포 가능한 것은 공공데이터포털 등록본(부산·대전·광주2호선·호남고속철도)**이며, 코레일 전국 노선도는 제4유형이라 "변경 없이, 비상업, 출처표시"로만 게시 가능(사이트가 광고·수익 없는 개인 프로젝트라면 가능하나 상업성 판단은 보수적으로). 서울교통공사는 제3유형(변경금지) 표시가 숨겨져 있어 공사에 문의 권장. 인천은 링크/임베드만 권장.

## 2. 선형 데이터

### 2-1. OpenStreetMap (ODbL)

Overpass API(overpass-api.de, 2026-10-11 기준, `area["ISO3166-1"="KR"]`)로 직접 집계한 결과:

| 객체                                                         | 수량           |
| ------------------------------------------------------------ | -------------- |
| way `railway=rail`                                           | 21,888         |
| way `railway=subway`                                         | 2,243          |
| way `railway=light_rail`                                     | 331            |
| way `railway=construction`                                   | 440            |
| way `railway=proposed`                                       | 63             |
| relation `route=train` / `route=subway` / `route=light_rail` | 106 / 181 / 22 |
| relation `route=tracks` (국가철도 노선 단위)                 | 125            |
| node `railway=station` (그중 `station=subway`)               | 1,325 (669)    |
| node `public_transport=station`                              | 1,900          |
| 계획(proposed) 상태의 route relation                         | 0              |

- **공사중 노선 태깅 현황**(construction way 이름 집계): 경전본선, 호남고속선(2단계), 장항선, 신안산선, 경강선, 평택고속연결선, 평택~오송 고속철도, 대구산업선, 남부내륙선, GTX-A/B/C, 동탄인덕원선, 서해선, 중앙본선, 9호선, 위례선, 동북선, 양산선, 부산 5호선, 광주 2호선, 대전 2호선(tram), 7호선 도봉산옥정선·옥정포천선, 1호선 동탄 연장, 신분당선, 화성고속연결선 등. 대형 사업은 대부분 들어 있음.
- **계획(proposed) 노선**: 63개 way뿐이며 36개는 이름 없음. 이름 있는 것: 강동하남남양주선, 대장홍대선, GTX-C(일부), 서해선-경부고속선 연결선, 신분당선 용산-신사 연장, 별내선, 평택선, 3호선 하남연장, 마천연결선, 8호선 의정부 연장안, 대구 4호선, 광주 2호선 효천지선, 신안산선 여의도-서울역 연장. **국가철도망 구축계획 신규 노선 대부분은 OSM에 없음** → 계획 노선은 수기로 그려야 함.
- 태깅 규칙: OSM 위키 `Korea/Railways`(ref 번호 체계: 첫 자리 1=고속, 2=준고속, 3=일반; usage=main/branch; 공사중 노선 목록 유지, 2026-01-02 최종 편집)와 `Ko:OpenRailwayMap/Tagging in South Korea`(rail/subway/light_rail 구분 기준, route=tracks·route=railway·route=train/subway 3계층 relation, 역명에서 "역" 제외 등). 데이터 품질은 수도권·간선 중심으로 양호하나 일부 relation 중복·누락이 위키에서도 확인됨.
- 추출 방법: (a) Overpass QL(위와 같은 쿼리, `out geom`으로 GeoJSON 변환: osmtogeojson), (b) Geofabrik `south-korea-latest.osm.pbf`(약 275MB, 2026-10-09 데이터까지 포함, 사실상 매일 갱신) 또는 `south-korea-latest-free.shp.zip`(약 557MB; `railways` 레이어 fclass: rail, light_rail, subway, tram, monorail 등 — **proposed/construction은 무료 shapefile에 포함되지 않음**, PBF에서 osmium/osm2pgsql로 직접 추출 필요).
- **ODbL 의미**: 출처표시("© OpenStreetMap contributors") 필수. OSM 선형을 자체 역/노선 DB와 **하나의 DB로 합쳐 공개하면 그 파생 DB도 ODbL(share-alike)로 공개**해야 함. 반면 OSM 선형 파일과 자체 데이터(역 속성, 계획 정보)를 **별도 파일로 유지(집합 DB, collective database)**하면 자체 데이터는 다른 라이선스(CC-BY 등) 유지 가능. 렌더링 결과물(지도 이미지)은 "Produced Work"로 ODbL 강제 대상 아님(출처표시만). 코드·데이터 공개 예정이므로 **선형 GeoJSON은 ODbL, 자체 DB는 분리**하는 구조 권장.

### 2-2. 국가공간정보포털 / VWorld / 국토교통부 공식 GIS

- VWorld 공간정보 다운로드(https://www.vworld.kr/dtmk/dtmk_ntads_s001.do): 목록 1페이지(74페이지 중)에 철도 레이어 없음, "도로 교통·물류" 분류 57건 존재 — 철도 중심선 레이어 유무는 **미확인**(로그인·필터 필요). 페이지에 공공누리 표시 없음.
- VWorld 2D 데이터 API 2.0(https://www.vworld.kr/dev/v4dv_2ddataguide2_s001.do): 158개 서비스(연속지적도, 용도지역 등) — 철도 레이어 포함 여부 미확인.
- 국토지리정보원 수치지형도(철도 레이어 포함)는 국토정보플랫폼(map.ngii.go.kr) 로그인 후 다운로드. **공공누리 유형·재배포 조건 미확인**(검색에서 못 찾음).
- 국가교통DB(KTDB) 철도망 GIS: 존재는 논문 등에서 언급되나 신청 절차·재배포 조건 **미확인**(데이터 출처 조사에서는 약관상 재배포 불가로 확인됨).
- 지역 단위: 전남광주통합특별시 "철도선 정보"(https://www.data.go.kr/data/15131581/fileData.do, CSV 1,352행, "도형" 필드 포함 — 좌표 형식 미확인).
- **결론: 전국 철도 중심선을 공공누리 1유형급으로 재배포 가능한 공식 GIS 파일은 확인하지 못함.**

### 2-3. 국가철도공단·코레일 좌표 데이터 (역 Point)

모두 공공데이터포털, 무료, "이용허락범위 제한 없음"(공공누리 유형 미표시):

- 국가철도공단\_철도역 정보 (https://www.data.go.kr/data/15067652/fileData.do): CSV 215행, `LATMAP`/`GRAMAP` 위경도, 연 1회.
- 한국철도공사\_역 위치 정보 (https://www.data.go.kr/data/15127532/fileData.do): CSV 202행(간선 역), 위도/경도/출입구 수.
- 전국도시철도역사정보표준데이터 (https://www.data.go.kr/data/15013205/standard.do): XLSX 1,073행, 위경도·환승·주소, 연 1회.
- 국가철도공단 노선별 "역위치" 시리즈(예: 경의중앙선 https://www.data.go.kr/data/15041487/fileData.do, `LAT`/`LON`, 78행; 수인선·2호선·9호선·인천1호선·신분당선·에버라인 등 검색 결과 존재).
- 국가철도공단\_도시철도 전체노선정보 API (https://www.data.go.kr/data/15041666/openapi.do): 노선별 역 순서(좌표 없음).
- 서울 열린데이터광장 "서울시 역사마스터 정보"(OA-21232, 공공누리 1유형, 검색 결과) / 서울교통공사 1~8호선 역사 좌표(OA-22534, 검색 결과).
- **선형(LineString) 좌표는 국가철도공단·코레일 어디에서도 제공하지 않음.**

### 2-4. 계획 노선(미개통) 선형

- 국가철도망 구축계획: 제4차(국토교통부 고시 제2021-936호, 2021-07-05) 첨부는 HWP 고시문·전문(검색 결과 기준; molit.go.kr 직접 열람은 리다이렉트 오류). 노선도는 PDF/HWP 그림 → GIS 좌표 없음.
- 기본계획·실시계획 고시(관보/국토교통부 행정규칙), 지자체 철도기본계획(예: 경기도) 모두 도면 이미지만 제공.
- 공공데이터포털: 광주 2호선 노선도 PNG(이미지), 국가철도공단 광역철도 사업정보(구간·연장·사업비, 좌표 없음, 검색 결과).
- OSM: 공사중 노선은 상당수 있으나 계획 노선은 극소수(2-1 참조).
- **결론: 계획 노선 선형은 "수기로 그려야 함".** 실무 방안: 고시 도면 PDF를 QGIS에서 지오레퍼런싱 → 정거장 위치 기준으로 LineString 트레이스 → GeoJSON으로 저장(자체 저작물, 원하는 라이선스로 공개 가능). 공사중 노선은 OSM `railway=construction` 재활용.

## 2-5. VWorld WMS/WFS 2.0 — 철도 레이어 없음 (2026-10-11 추가 확인, 운영자 요청)
- 가이드: https://www.vworld.kr/dev/v4dv_wmsguide2_s001.do (원문 HTML 116KB, 레이어 코드 208개 추출)
- 원문에서 "철도", "지하철", "전철", "rail", "subway" 문자열이 **0건**. 교통 분류는 교통CCTV·교통노드·교통링크·도로중심선 4종뿐이고, 도시계획(교통시설) 용도지역 폴리곤(`lt_c_upisuq152`)이 있으나 선형 철도가 아니다.
- 따라서 **VWorld WMS/WFS로는 철도 노선을 지도 위에 그릴 수 없다.** VWorld는 배경지도(WMTS Base/White/Midnight)로만 쓰고, 노선 선형은 계획대로 OSM 추출(ODbL, 별도 파일) + 계획 노선 수기 트레이스 + 공공데이터 역 좌표로 그린다(docs/PLAN.md Phase 2).
- 참고로 확인한 API 규격: WMS `https://api.vworld.kr/req/wms?key=&request=GetMap&layers=&bbox=&width=&height=` (version 1.3.0, crs EPSG:4326 기본, layers 최대 4개), WFS `https://api.vworld.kr/req/wfs?key=&request=GetFeature&typename=&output=application/json` (count 최대 1000, typename 최대 4개). 브라우저 직접 호출 시 `domain=` 필요. 일일 한도 수치 미기재(OVER_REQUEST_LIMIT).
- 향후 행정경계(`lt_c_adsido` 등)나 도로중심선 오버레이가 필요하면 이 WMS/WFS를 쓸 수 있다.

## 2-6. Phase 2 사전 검증 (2026-10-11, 운영자 VWorld 키로 확인)
- **VWorld WMTS** `https://api.vworld.kr/req/wmts/1.0.0/{key}/{layer}/{z}/{y}/{x}.png`: `Base`, `white`, `midnight`, `Hybrid` 는 PNG 200. `gray`, `Satellite` 는 XML 오류(포맷 .jpeg 필요로 추정, 미확인). 레이어 이름은 **대소문자 구분**(White/Midnight 는 500). `domain=` 파라미터·Referer 없이도 서버에서 200 — 운영자 경험대로 도메인 검증이 느슨함. 그래도 키는 커밋하지 않는다.
- **Overpass API**: `User-Agent` 헤더가 없으면 406. 수도권 bbox(36.9,126.3,38.3,127.9)의 `railway=rail|subway|light_rail|monorail|construction` way + 전국 `railway=rail` `highspeed=yes` way = **13,633개**(측선·차량기지 포함, `service=*` 제외 필요). 수도권 `route=subway|light_rail|train|tracks` relation = **335개**. 추출은 osmium 없이 Overpass `out geom` → GeoJSON 변환으로 충분하다.
- 결론: Phase 2 1차(수도권 + 고속선)는 VWorld Base/white 배경 + Overpass 추출 선형으로 바로 진행 가능.

## 3. 지도 타일·API 비교

| 항목                      | 네이버 (NCP Maps)                                                                                                                                                       | 카카오맵                                                                                                                                                        | VWorld (국토교통부)                                                                                                                                                                            | OSM 계열 (OpenFreeMap / Protomaps / MapTiler / osm.org)                                                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 무료 한도                 | Dynamic Map **월 600만 건** 무료(대표 계정 1개 한정, 2023-01부터; 비대표 계정은 과금). Static Map/Geocoding 월 300만                                                    | 지도 Web(JS) SDK **일 30만 건**, 전체 API 월 300만 건. **개발자 계정당 첫 번째 활성화 앱에만** 무료 쿼터(2026-07-21 정책). 초과 시 0.1원/건, 비즈월렛 연결 필요 | 일일 제한 존재(`OVER_REQUEST_LIMIT` 오류 코드) — **수치 미확인**                                                                                                                               | OpenFreeMap: 요청 수 무제한·키 없음·상업 가능. Protomaps: 자체 호스팅(PMTiles) 무제한. MapTiler Free: 세션 5k/월·요청 10만/월, 초과 시 다음 달까지 중단, 로고 필수, "개인·비상업·PoC용". osm.org 타일: 무료이나 heavy use 금지                                                 |
| 키 정책                   | Client ID(공개) + Secret. Web Dynamic Map은 **웹 서비스 URL(도메인) 등록 필수**(최대 10개). Secret 노출 시 재발급 안내. 공개 저장소 게시 허용 여부 약관 조항 **미확인** | JavaScript 키 + **허용 도메인 등록**. REST 키를 SDK에 쓰면 오류. 로컬 API 응답 저장 금지(실시간 호출만, devtalk 답변 기준)                                      | 인증키 발급 시 **도메인 등록**, 불일치 시 `INCORRECT_KEY`; 브라우저 직접 호출 시 `domain=` 파라미터 추가                                                                                       | OpenFreeMap/Protomaps 자체호스팅: 키 없음. MapTiler: API 키(도메인 제한 가능)                                                                                                                                                                                                  |
| 타일 종류                 | 벡터 Dynamic Map, Static Map, Map Style Editor(라이트/다크)                                                                                                             | 지도/스카이뷰/로드뷰                                                                                                                                            | WMTS `https://api.vworld.kr/req/wmts/1.0.0/{key}/{layer}/{z}/{y}/{x}.png` — layer: **Base, gray, midnight, Hybrid, Satellite**(z 6~18/19). 배경지도 API 1.0에는 **White(백지도)**, Midnight 등 | OpenFreeMap 스타일 6종(Positron/Bright/Liberty/Dark/Fiord/3D), Protomaps 벡터(한국어 `name:ko` 로컬라이즈 스타일 제공), OpenMapTiles 스키마는 `ko`, `ko-Latn` 언어 포함                                                                                                        |
| 한국어 라벨               | 최상                                                                                                                                                                    | 최상                                                                                                                                                            | 최상(국가기본도)                                                                                                                                                                               | OSM `name:ko` 기반 — 주요 지명·역명은 양호, 세부 POI는 편차(품질 수치 미확인)                                                                                                                                                                                                  |
| 오픈소스·정적 사이트 제약 | 대표 계정 아닌 계정 과금 위험, 키가 저장소에 노출되면 타인 사용 시 과금은 키 소유자에게. 약관(AI·NAVER API 서비스 이용약관) 원문 미확인                                 | 두 번째 앱부터 유료 설정 필요 → 포크/기여자 테스트가 불편. 지도 데이터 저장·재배포 금지(약관 원문 미확인, 포럼 답변 기준)                                       | 공공 서비스라 비용 없음. 약관 페이지는 JS 호출(`urlFnc.goAgree()`)로 직접 열람 못함 → 출처표시·상업 이용 조건 **미확인**. 배경지도 API 샘플은 Attribution 컨트롤 포함                          | ODbL 출처표시만 지키면 제약 없음. osm.org 타일은 Referer/User-Agent 필수, 오프라인·대량 다운로드 금지, 상업/후원 서비스는 예고 없이 차단 가능 → 운영용으로는 부적합                                                                                                            |
| 재배포                    | 타일·데이터 재배포 불가(약관)                                                                                                                                           | 불가                                                                                                                                                            | 미확인                                                                                                                                                                                         | OpenFreeMap: 주간 전 세계 MBTiles/Btrfs 다운로드 가능, 자체 호스팅 가능(MIT 코드). Protomaps: planet PMTiles(~120GB, z0~15, 일일 빌드) → `pmtiles extract`로 한국만 추출, GitHub Pages(1GB 이하)·Cloudflare R2(권장)·S3 등 Range Request 지원 스토리지에 올리면 서버 없이 서빙 |

참고: OpenRailwayMap 타일(`https://tiles.openrailwaymap.org/{style}/{z}/{x}/{y}.png`, 스타일 CC-BY-SA 2.0, 데이터 ODbL)은 **비상업·공개 프로젝트에 한해** 오버레이로 사용 가능(User-Agent/Referer 필수, 429 시 중단, 가용성 보장 없음) — 철도 인프라 오버레이용 참고.

## 4. 지도 라이브러리 비교

| 라이브러리              | 라이선스                        | 번들(min, gzip)                               | 수백 LineString + 2천 Point 적합성                                                                                                                              | 비고                                                                                  |
| ----------------------- | ------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **MapLibre GL JS** 6.13 | BSD-3-Clause (LICENSE.txt 확인) | 1,076KB / 287KB                               | WebGL 벡터 렌더링 — GeoJSON 소스로 수만 피처도 무리 없음. 벡터 타일(PMTiles/OpenFreeMap)과 결합 최적. 라벨 충돌 처리 내장                                       | 회전·기울기, 스타일 JSON으로 다크모드. PMTiles 프로토콜 플러그인으로 정적 호스팅 가능 |
| **Leaflet** 1.9.4       | BSD-2-Clause                    | 149KB / 43KB                                  | DOM/SVG 렌더링이라 2천 마커는 가능하나 수백 LineString + 마커 동시 표시는 줌/패닝 시 버벅일 수 있음 → `preferCanvas`·클러스터링 필요. 벡터 타일은 플러그인 의존 | 가장 가볍고 단순. VWorld WMTS 래스터와 궁합 좋음                                      |
| **OpenLayers** 10.11    | BSD-2-Clause                    | 300KB / 86KB                                  | Canvas 렌더링, WMTS/WMS 기본 지원 최강(VWorld WMTS에 적합). 수천 피처 OK                                                                                        | API가 무겁고 학습 곡선 있음                                                           |
| **deck.gl** 9.4         | MIT                             | 1,996KB / 553KB (풀 번들; 레이어별 분할 가능) | 대량 데이터(수십만) 시각화용 — 이 규모에는 과함. 기본지도 없음 → 네이버/MapLibre 위에 오버레이(noseon.do 방식)                                                  | 네이버 지도 위에 WebGL 오버레이가 필요할 때만                                         |

## 5. 도식 노선도 생성

- **LOOM** (ad-freiburg/loom, GPL-3.0, 2026-07 최종 push, 306★): GTFS 또는 GeoJSON 그래프 입력 → `topo`→`loom`→`octi`(8방향 도식화)→`transitmap`(SVG/MVT 출력). C++ 빌드(cmake, ILP 솔버 선택). QGIS 플러그인(loom_qgis)도 있음. 논문 수준의 자동 도식화가 실제로 동작하는 유일한 오픈소스. 단, 전국 규모·한국어 라벨·디자인 품질 조정은 추가 작업 필요하며, GPL이므로 산출물이 아닌 **빌드 파이프라인(오프라인 도구)로만** 쓰면 사이트 코드 라이선스와 충돌 없음.
- **Rail Map Painter** (railmapgen/rmp, GPL-3.0, 활발, 209★): 브라우저에서 역을 드래그해 그리는 **수동 편집기**, SVG/PNG/JSON 내보내기. 자동 배치 없음. 한국 스타일 미확인.
- **d3-tube-map** (BSD-3, 2024-03 이후 정체): 좌표를 정수 격자로 직접 지정해야 하는 수동 방식.
- 현실적 판단: 전국 자동 도식화는 LOOM으로 "초안" 생성 후 수동 보정이 한계. **1인 운영에서는 (a) 공식 노선도 이미지를 링크/게시하고, (b) 지도 탭은 지리 기반(실좌표)으로 가는 것이 가장 현실적.** 도식 노선도는 후순위.

## 6. 참고 사례

- **noseon.do** ("미래 지하철 노선도", 수도권 중심 36노선·808역, 연도별 개통/폐지 일정): 페이지 소스에서 `DeckGL`, `naver.com` 문자열 확인 → 네이버 지도 + deck.gl 오버레이. 데이터 출처·라이선스·GitHub 표기 없음(미확인).
- **미래철도DB** (http://frdb.wo.to → http://frdb2.ivyro.net, 운영자 한우진, 2001년 개설, 최종 갱신 2026-08-28): 계획 노선 텍스트 DB. 노선도는 네이버 카페(cafe.naver.com/frdb)로 연결, "미래철도 위성지도"는 개인 블로그 링크. 지도 API 사용 여부 미확인. ※ 조사 담당은 "미래철도20XX"를 검색으로 찾지 못했으나, 본 프로젝트의 benchmark-sites.md에서 카카오 지도 + 도식 노선도 구조를 확인했다.
- **GitHub 오픈소스**:
  - `hiddewie/OpenRailwayMap-vector` (GPL-3.0, 활발): OSM→PostGIS→Martin 벡터 타일→MapLibre. 한국 데이터로 포크 가능한 가장 완성도 높은 OSM 철도 지도 스택. OSM 위키 사용자 aaei924가 한국 태깅 표준화·이 프로젝트 지원 작업 중.
  - `Sinseiki/opensource-seoul-subway-map` (MIT, 2026-07 push): 수도권 노선도 SVG(`mapimage.svg`), 상업 이용·2차 저작 허용 명시. 유지보수 보류 상태.
  - `wodndb/seoul-metro-route-map` (MIT): React 기반 수도권 노선도. wodndb는 OSM 위키 Korea/Railways 영문 지선명 번역 기여자.
  - `southkorea/southkorea-maps`, `southkorea/seoul-maps` (Apache-2.0, 검색 결과): 행정구역 GeoJSON — 배경 레이어용.
  - 전국 철도 선형을 GeoJSON으로 정리한 한국 저장소는 **발견하지 못함**.

## 7. 권장안

**1순위: MapLibre GL JS + 자체 호스팅 벡터 타일(Protomaps PMTiles 한국 추출, 또는 OpenFreeMap 공개 인스턴스) + OSM 추출 선형(ODbL) + 공공데이터 역 좌표 + 수기 계획 노선 GeoJSON**

- 이유: (1) 키·쿼터·약관 리스크 0 — 정적 호스팅(GitHub Pages/Cloudflare R2)만으로 동작, 포크한 사람도 그대로 실행 가능. (2) 라이선스 전부 명확(BSD/MIT/ODbL/공공데이터). (3) 수백 LineString·2천 Point 렌더링에 WebGL이 가장 여유. (4) Protomaps는 `name:ko` 로컬라이즈 스타일 제공, OpenMapTiles도 ko 지원. (5) 현재 노선은 Geofabrik PBF에서 `railway=rail/subway/light_rail` + `route=tracks/subway` relation 추출(osmium), 공사중은 `railway=construction`, 계획은 QGIS로 트레이스. 저장소 구조는 `data/osm/*.geojson`(ODbL)과 `data/own/*.json`(자체 라이선스)으로 분리.
- 주의: OSM 출처표시, ODbL 파생DB 분리, 한국어 라벨 품질은 Protomaps/OpenFreeMap 스타일 중 실제 비교 후 선택. 선택 보조: OpenRailwayMap 타일을 선택적 오버레이로 제공(비상업 조건).

**2순위: VWorld WMTS(Base/White/Midnight) 래스터 + MapLibre 또는 Leaflet/OpenLayers**

- 이유: 국토교통부 공공 지도로 한국어 지명·행정경계 품질 최상, 백지도(White)·야간(Midnight) 스타일이 철도 오버레이에 적합, 비용 없음.
- 단점: 인증키가 도메인에 묶임(포크 시 각자 발급), 일일 한도 수치·약관(출처표시/상업) 미확인, 래스터라 고DPI 품질 한계. 1순위와 병행(타일 소스 전환 옵션)하는 것이 현실적.

**3순위(비권장): 네이버/카카오 지도 API** — 한국어 품질은 최고지만 카카오는 "계정당 첫 앱만 무료", 네이버는 "대표 계정만 무료"라 공개 저장소·기여자 환경과 맞지 않고, 타일·데이터 재배포 불가 약관 때문에 오픈 데이터 프로젝트와 성격이 충돌.

**노선도 이미지 탭**: 공공데이터포털 등록본(부산·대전·광주2호선·호남고속철도)은 파일 동봉 가능, 코레일 전국 노선도는 제4유형 조건(원본 그대로·비상업·출처표시)으로 게시하거나 링크만, 서울교통공사는 제3유형 아이콘 확인 후 원본 그대로 게시(변경 금지), 인천·대구·광주1호선은 외부 링크.

## 출처 URL 목록 (직접 열람)

- https://info.korail.com/info/contents.do?key=857&pageId=TK0403020001
- https://www.korail.com (JS 전용, 메뉴 없음)
- https://www.seoulmetro.co.kr/kr/cyberStation.do (curl -k)
- https://www.ictr.or.kr/ , https://www.ictr.or.kr/main/railway/guidance/map.jsp
- https://www.kr.or.kr/
- https://etk.srail.kr/ , https://etk.srail.kr/hpg/hra/01/selectMapInfo.do
- https://www.humetro.busan.kr/ (에러 페이지), https://www.dtro.or.kr/ (안티봇), https://www.gwangjusubway.co.kr/ , https://www.djet.co.kr/ (접속 거부)
- https://www.data.go.kr/data/15054957/fileData.do , /15054960/ , /15050368/ , /15081251/ , /15118168/ , /15012349/ , /15139197/ , /15041150/ , /15131581/ , /15067652/ , /15127532/ , /15041487/ , /15129754/ , https://www.data.go.kr/data/15041666/openapi.do , https://www.data.go.kr/data/15013205/standard.do
- https://data.seoul.go.kr/dataList/OA-15442/S/1/datasetView.do
- https://www.vworld.kr/dev/v4api.do , https://www.vworld.kr/dev/v4dv_2ddataguide2_s001.do , https://www.vworld.kr/dtmk/dtmk_ntads_s001.do , https://vworld.kr/dev/v4dv_wmtsguide_s001.do , https://www.vworld.kr/dev/v4dv_baseguide_s001.do
- https://guide.ncloud-docs.com/docs/maps-app , https://guide.ncloud-docs.com/docs/maps-overview , https://guide.ncloud-docs.com/docs/application-maps-procedure , https://www.ncloud.com/product/applicationService/maps (curl)
- https://developers.kakao.com/docs/latest/ko/getting-started/quota (curl) , http://developers.kakao.com/docs/ko/kakaomap/common , https://devtalk.kakao.com/t/api-notice-on-new-kakao-map-api-features-and-free-quota-policy/150222
- https://operations.osmfoundation.org/policies/tiles/ , https://openfreemap.org/ , https://www.maptiler.com/cloud/pricing/
- https://docs.protomaps.com/ , https://docs.protomaps.com/basemaps/downloads , https://docs.protomaps.com/basemaps/localization , https://docs.protomaps.com/pmtiles/cloud-storage
- https://download.geofabrik.de/asia/south-korea.html , https://download.geofabrik.de/osm-data-in-gis-formats-free.pdf
- https://wiki.openstreetmap.org/wiki/Korea/Railways , https://wiki.openstreetmap.org/wiki/Ko:OpenRailwayMap/Tagging_in_South_Korea , https://wiki.openstreetmap.org/wiki/OpenRailwayMap , https://wiki.openstreetmap.org/wiki/OpenRailwayMap/API , https://www.openrailwaymap.org/
- https://overpass-api.de/api/interpreter (Overpass QL 집계 쿼리 4종)
- https://openmaptiles.org/schema/ , https://raw.githubusercontent.com/openmaptiles/openmaptiles/master/openmaptiles.yaml
- https://bundlephobia.com/api/size?package=maplibre-gl|leaflet|deck.gl|ol , https://api.github.com/repos/... (라이선스·활동) , https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/LICENSE.txt
- https://github.com/ad-freiburg/loom , https://github.com/johnwalley/d3-tube-map , https://github.com/railmapgen/rmp , https://github.com/Sinseiki/opensource-seoul-subway-map , https://github.com/wodndb/seoul-metro-route-map
- https://noseon.do , http://frdb.wo.to/ , http://frdb2.ivyro.net/

검색 결과로만 확인(직접 열람 실패 또는 미시도): molit.go.kr 제4차 국가철도망 고시(idx=16937)·정책정보(id=4687) — 리다이렉트 오류; m.ncloud.com 요금표; data.go.kr 15054958·15050371·15041336 등 노선별 역위치; data.seoul.go.kr OA-21232·OA-22534; HDX hotosm_kor_railways(403).


## 2-7. 계획 노선 개략 선형 (2026-10-12, round-4 Q80 A)

- QGIS 수기 선형이 들어오기 전까지 `data/own/geometry/plan-routes.yaml`에 주요 경유역(자체 역 id)을 적고 build-map 이 직선 LineString 으로 `public/map/plans.geojson`을 만든다(초록 점선, 지도 '계획 노선(개략)' 체크, `#plan=<id>` 에서 강조·이동). 2026-10-12 수도권 제4차 신규 10건: 신분당선 서북부 연장(용산~삼송), 위례과천선, 송파하남선, 분당선 왕십리~청량리·기흥~오산, 일산선 연장, 서부권 광역급행철도, 수색~광명 고속선, 신구로선, 평택부발선. OSM 공사중 선형이 있는 GTX·대장홍대선·신안산선은 제외.
- 경유역 좌표가 없는 사업(동탄~청주공항, 용문~홍천, 별내선 연장, 위례삼동선, 신분당선 호매실~봉담, 제2경인선, 고양은평선(고양시청), 강동하남남양주선)은 좌표 확보 후 추가. 실제 선로 위치가 아님을 지도·팝업에 명시.
