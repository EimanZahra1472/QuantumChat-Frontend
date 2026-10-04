import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Local QuantumAI proxy — browser calls same-origin `/quantum-ai/*` so Helmet
 * CORP on the remote AI host cannot block the response. Vite forwards to the
 * real AI API (production by default, or VITE_AI_PROXY_TARGET).
 */
export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/quantum-ai': {
        target: process.env.VITE_AI_PROXY_TARGET || 'https://quantum-ai-backend-six.vercel.app',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/quantum-ai/, '/api/v1'),
      },
    },
  },
});
