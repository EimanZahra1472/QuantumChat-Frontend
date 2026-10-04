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
  // Whisper (@huggingface/transformers) imports onnxruntime-common from the
  // browser bundle; keep it deduped at the app root (we stub onnxruntime-node
  // for CI, which used to hoist a copy of onnxruntime-common).
  resolve: {
    dedupe: ['onnxruntime-common', 'onnxruntime-web'],
  },
  optimizeDeps: {
    include: ['onnxruntime-common', 'onnxruntime-web'],
  },
  server: {
    port: 5173,
    open: true,
    proxy: {
      '/quantum-ai': {
        target: process.env.VITE_AI_PROXY_TARGET || 'https://ai.quantumlogicslimited.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/quantum-ai/, '/api/v1'),
      },
    },
  },
});
