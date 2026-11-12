// frontend/vite.config.ts
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ROS の地図画像（edge_ai/.../maps/*.pgm）を、画面に埋め込んで読み込めるようにする（src/store/map.ts）
  assetsInclude: ['**/*.pgm'],
})
