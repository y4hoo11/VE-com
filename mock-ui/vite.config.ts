import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 画面モック（バックエンド不要。src/mock/ の中で車両の動きを疑似的に作っている）
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5180, open: true },
});
