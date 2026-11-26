// frontend/vite.config.ts
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// 設定画面の「バージョン」に出す、画面（frontend）の版・作った日時・コミット
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }
const gitCommit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return '' // git が無い環境（配布したファイルだけで作るときなど）
  }
})()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __GIT_COMMIT__: JSON.stringify(gitCommit),
  },
  // ROS の地図画像（edge_ai/.../maps/*.pgm）を、画面に埋め込んで読み込めるようにする（src/store/map.ts）
  assetsInclude: ['**/*.pgm'],
  // 同じネットワークのほかの端末からも http://<PC2のIP>:5173 で開けるようにする（標準ではこの PC からだけ）
  server: { host: true },
})
