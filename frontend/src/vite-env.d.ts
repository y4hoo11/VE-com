/// <reference types="vite/client" />

// frontend/.env で設定できる値（.env.example を参照）
interface ImportMetaEnv {
  /** バックエンドの URL（例: http://192.168.1.100:3001）。無ければ、画面を開いた PC の 3001 番 */
  readonly VITE_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// vite.config.ts の define で埋め込む値（設定画面の「バージョン」）
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string; // 作った日時（開発サーバーでは起動した日時）。ISO 形式
declare const __GIT_COMMIT__: string; // コミットの短いハッシュ。分からなければ空
