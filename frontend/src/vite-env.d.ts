/// <reference types="vite/client" />

// frontend/.env で設定できる値（.env.example を参照）
interface ImportMetaEnv {
  /** バックエンドの URL（例: http://192.168.1.100:3001）。無ければ、画面を開いた PC の 3001 番 */
  readonly VITE_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
