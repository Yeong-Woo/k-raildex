import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 개발 서버는 /v1·/health 를 관리 API 로 넘긴다. 운영에서는 같은 호스트(Cloudflare Access 뒤)의 리버스 프록시가 맡는다.
const apiTarget = process.env.ADMIN_API_PROXY ?? 'http://127.0.0.1:5101';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5201,
    proxy: { '/v1': apiTarget, '/health': apiTarget },
  },
  preview: { host: '127.0.0.1', port: 5200 },
});
