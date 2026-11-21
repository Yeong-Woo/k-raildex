/** 컨테이너 상태 확인(compose healthcheck). 공개 API 에 닿지 않아도 웹 서버가 떠 있으면 200 */
export function GET() {
  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
