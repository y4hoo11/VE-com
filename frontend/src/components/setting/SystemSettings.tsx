import React, { useState, useRef } from 'react';
import './SettingForm.css'; // 共通デザインスタイル

// --- 型定義 ---
export interface SystemSettingsState {
  // 1. MQTT通信設定 (agv_protocol.md に準拠)
  mqttBrokerHost: string;     // MQTTブローカーのアドレス (PC2 Mosquitto :1883)
  mqttBrokerPort: number;     // ポート番号 (デフォルト: 1883)
  mqttTopicPrefix: string;    // ベースプレフィックス (デフォルト: agv)
  mqttUseTls: boolean;        // SSL/TLS暗号化接続フラグ
  
  // 2. データベース接続設定 (db_design.md に準拠)
  databaseUrl: string;        // Prisma / PostgreSQL 接続文字列

  // 3. 通信・ネットワーク・ハートビート制御
  apiTimeoutMs: number;       // APIタイムアウト制限時間 (ms)
  apiRetryCount: number;      // 通信失敗時のリトライ回数
  heartbeatTimeoutSec: number;// 【追加】車両オフライン判定時間 (秒) (デフォルト: 3秒)
  useMockAuth: boolean;       // 開発用モックモードフラグ
}

export const SystemSettings: React.FC = () => {
  // 1. 設定フォームの状態管理（UI確認用初期値）
  const [settings, setSettings] = useState<SystemSettingsState>({
    mqttBrokerHost: 'localhost',
    mqttBrokerPort: 1883,
    mqttTopicPrefix: 'agv',
    mqttUseTls: false,
    databaseUrl: 'postgresql://user:password@localhost:5432/vecom_db',
    apiTimeoutMs: 5000,
    apiRetryCount: 3,
    heartbeatTimeoutSec: 3,   // 通信仕様書の3秒仕様を適用
    useMockAuth: true,
  });

  // 2. 保存完了通知バナー表示状態
  const [isSaved, setIsSaved] = useState(false);

  // 3. ドラッグスクロール（パン操作）用の参照と座標状態
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  // --- ドラッグ制御イベントハンドラー ---
  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (['INPUT', 'SELECT', 'BUTTON', 'LABEL'].includes(target.tagName)) return;
    if (!scrollRef.current) return;

    setIsDragging(true);
    setStartX(e.pageX - scrollRef.current.offsetLeft);
    setStartY(e.pageY - scrollRef.current.offsetTop);
    setScrollLeft(scrollRef.current.scrollLeft);
    setScrollTop(scrollRef.current.scrollTop);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollRef.current) return;
    e.preventDefault();

    const x = e.pageX - scrollRef.current.offsetLeft;
    const y = e.pageY - scrollRef.current.offsetTop;
    scrollRef.current.scrollLeft = scrollLeft - (x - startX) * 1.5;
    scrollRef.current.scrollTop = scrollTop - (y - startY) * 1.5;
  };

  // --- 汎用入力チェンジハンドラー ---
  const handleChange = <K extends keyof SystemSettingsState>(
    key: K,
    value: SystemSettingsState[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setIsSaved(false);
  };

  // --- 設定保存処理（モック） ---
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('通信・システム設定（SystemSettings）を保存しました:', settings);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div
      ref={scrollRef}
      className={`setting-scroll-wrapper ${isDragging ? 'is-dragging' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseLeave={() => setIsDragging(false)}
      onMouseUp={() => setIsDragging(false)}
      onMouseMove={handleMouseMove}
    >
      <form className="setting-container" onSubmit={handleSave}>

        {/* --- セクション1: MQTT通信設定 --- */}
        <section className="setting-section">
          <h3 className="setting-section-title">MQTT通信設定</h3>

          <div className="setting-row">
            <label className="setting-label" htmlFor="mqtt-host">
              ブローカーURL / アドレスの設定
              <span className="setting-sub-label">車両通信用MQTTサーバー (PC2 Mosquitto)</span>
            </label>
            <input
              id="mqtt-host"
              type="text"
              value={settings.mqttBrokerHost}
              onChange={(e) => handleChange('mqttBrokerHost', e.target.value)}
              className="setting-input-text"
            />
          </div>

          <div className="setting-row">
            <label className="setting-label" htmlFor="mqtt-port">
              ポート番号の設定
              <span className="setting-sub-label">標準: 1883 (非暗号化) / 8883 (SSL)</span>
            </label>
            <input
              id="mqtt-port"
              type="number"
              min={1}
              max={65535}
              value={settings.mqttBrokerPort}
              onChange={(e) => handleChange('mqttBrokerPort', Number(e.target.value))}
              className="setting-input-number"
            />
          </div>

          <div className="setting-row">
            <label className="setting-label" htmlFor="mqtt-prefix">
              ベーストピックプレフィックスの設定
              <span className="setting-sub-label">送信・受信トピックの共通接頭辞 (例: agv ⇒ agv/&#123;id&#125;/telemetry)</span>
            </label>
            <input
              id="mqtt-prefix"
              type="text"
              value={settings.mqttTopicPrefix}
              onChange={(e) => handleChange('mqttTopicPrefix', e.target.value)}
              className="setting-input-text"
            />
          </div>

          <div className="setting-row">
            <label className="setting-label" htmlFor="mqtt-tls">
              SSL/TLS暗号化接続の有効化
              <span className="setting-sub-label">MQTTS によるセキュア通信の利用設定</span>
            </label>
            <input
              id="mqtt-tls"
              type="checkbox"
              checked={settings.mqttUseTls}
              onChange={(e) => handleChange('mqttUseTls', e.target.checked)}
              className="setting-checkbox"
            />
          </div>
        </section>

        {/* --- セクション2: データベース接続設定 --- */}
        <section className="setting-section">
          <h3 className="setting-section-title">データベース接続設定</h3>

          <div className="setting-row">
            <label className="setting-label" htmlFor="db-url">
              DB接続URI (Database URL) の設定
              <span className="setting-sub-label">Prisma / PostgreSQL 接続文字列</span>
            </label>
            <input
              id="db-url"
              type="text"
              value={settings.databaseUrl}
              onChange={(e) => handleChange('databaseUrl', e.target.value)}
              className="setting-input-text"
            />
          </div>
        </section>

        {/* --- セクション3: API通信・ネットワーク制御 --- */}
        <section className="setting-section">
          <h3 className="setting-section-title">API通信・ネットワーク制御</h3>

          <div className="setting-row">
            <label className="setting-label" htmlFor="api-timeout">
              APIタイムアウト時間の設定 (ms)
              <span className="setting-sub-label">応答待機の制限時間 (1000〜30000ms)</span>
            </label>
            <input
              id="api-timeout"
              type="number"
              min={1000}
              max={30000}
              step={500}
              value={settings.apiTimeoutMs}
              onChange={(e) => handleChange('apiTimeoutMs', Number(e.target.value))}
              className="setting-input-number"
            />
          </div>

          <div className="setting-row">
            <label className="setting-label" htmlFor="api-retry">
              通信リトライ回数の設定
              <span className="setting-sub-label">通信失敗時の再試行回数 (0〜10回)</span>
            </label>
            <input
              id="api-retry"
              type="number"
              min={0}
              max={10}
              step={1}
              value={settings.apiRetryCount}
              onChange={(e) => handleChange('apiRetryCount', Number(e.target.value))}
              className="setting-input-number"
            />
          </div>

          <div className="setting-row">
            <label className="setting-label" htmlFor="heartbeat-timeout">
              オフライン自動判定時間の設定 (秒)
              <span className="setting-sub-label">車両データ未受信時に OFFLINE 判定に切り替える時間</span>
            </label>
            <input
              id="heartbeat-timeout"
              type="number"
              min={1}
              max={30}
              step={1}
              value={settings.heartbeatTimeoutSec}
              onChange={(e) => handleChange('heartbeatTimeoutSec', Number(e.target.value))}
              className="setting-input-number"
            />
          </div>

          <div className="setting-row">
            <label className="setting-label" htmlFor="use-mock">
              モックモードの有効化
              <span className="setting-sub-label">実機通信を行わずローカルの模擬データを使用設定</span>
            </label>
            <input
              id="use-mock"
              type="checkbox"
              checked={settings.useMockAuth}
              onChange={(e) => handleChange('useMockAuth', e.target.checked)}
              className="setting-checkbox"
            />
          </div>
        </section>

        {/* --- 保存ボタン & メッセージ --- */}
        <div className="setting-button-container">
          {isSaved && <span className="setting-success-badge">✓ 通信・システム設定を保存しました</span>}
          <button type="submit" className="setting-save-button">設定を保存</button>
        </div>
      </form>
    </div>
  );
};

export default SystemSettings;