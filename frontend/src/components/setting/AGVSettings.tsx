import React, { useState, useRef } from 'react';
import './SettingForm.css'; // 共通デザインスタイル

// --- 型定義 ---
export interface AGVSettingsState {
  // 1. 走行・モーション制御
  maxSpeed: number;               // 最高速度 (km/h) ★単位を変更 (5, 10, 15, 20, 30)
  maxTurnSpeed: number;           // 旋回速度 (rad/s)
  maxAcceleration: number;        // 加速度制限 (m/s²)
  
  // 2. 安全・センサ設定
  obstacleDetectDistance: number; // 障害物検知距離 (cm)
  emergencyAutoClear: boolean;    // 障害物除去後の自動復帰フラグ
  
  // 3. バッテリー・電源管理
  autoChargeThreshold: number;    // 自動充電開始閾値 (%)
  batteryWarningThreshold: number;// 低バッテリー警告閾値 (%)
  
  // 4. 座標系・マップ変換設定
  mapResolution: number;          // マップ解像度 (m/px)
  originX: number;                // マップ原点X座標 (m)
  originY: number;                // マップ原点Y座標 (m)
  waypointsAlias: string;         // 地点 (Waypoints) 別名定義

  // 5. マルチAGV・カメラ・接続設定
  realVehicleId: string;          // 実機ラジコンカー識別ID
  simulatedVehicleCount: number;  // 疑似車体の台数
  cameraStreamUrl: string;        // カメラ配信ストリームURL
  defaultMapId: string;           // 初期マップID
}

export const AGVSettings: React.FC = () => {
  // 1. 設定フォームの状態管理
  const [settings, setSettings] = useState<AGVSettingsState>({
    maxSpeed: 10, // デフォルト値を 10 km/h に設定
    maxTurnSpeed: 1.0,
    maxAcceleration: 0.5,
    obstacleDetectDistance: 50,
    emergencyAutoClear: false,
    autoChargeThreshold: 20,
    batteryWarningThreshold: 15,
    mapResolution: 0.05,
    originX: -5.0,
    originY: -5.0,
    waypointsAlias: 'Dock-A, Station-1, Station-2',
    realVehicleId: 'AGV-01',
    simulatedVehicleCount: 3,
    cameraStreamUrl: 'http://192.168.1.100:5000/video',
    defaultMapId: 'demo_map',
  });

  const [isSaved, setIsSaved] = useState(false);

  // ドラッグスクロール制御
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (['INPUT', 'SELECT', 'BUTTON', 'LABEL', 'TEXTAREA'].includes(target.tagName)) return;
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

  const handleChange = <K extends keyof AGVSettingsState>(
    key: K,
    value: AGVSettingsState[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setIsSaved(false);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('AGV・運行パラメータ設定（AGVSettings）を保存しました:', settings);
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

        {/* --- セクション1: 走行・モーション制御 --- */}
<section className="setting-section">
  <h3 className="setting-section-title">走行・モーション制御</h3>

  {/* 最高速度の設定 */}
  <div className="setting-row">
    <label className="setting-label" htmlFor="max-speed">
      最高速度の設定 (km/h)
      <span className="setting-sub-label">直進走行時の許容最高速度を選択します</span>
    </label>
    <select
      id="max-speed"
      value={settings.maxSpeed}
      onChange={(e) => handleChange('maxSpeed', Number(e.target.value))}
      className="setting-select-number" /* ★ こちらに変更 */
    >
      <option value={5}>5 km/h</option>
      <option value={10}>10 km/h</option>
      <option value={15}>15 km/h</option>
      <option value={20}>20 km/h</option>
      <option value={30}>30 km/h</option>
    </select>
  </div>

  {/* 旋回速度の設定 */}
  <div className="setting-row">
    <label className="setting-label" htmlFor="max-turn-speed">
      旋回速度の設定 (rad/s)
      <span className="setting-sub-label">ステアリング・超信地旋回時の角速度限界</span>
    </label>
    <select
      id="max-turn-speed"
      value={settings.maxTurnSpeed}
      onChange={(e) => handleChange('maxTurnSpeed', Number(e.target.value))}
      className="setting-select-number" /* ★ こちらに変更 */
    >
      <option value={0.5}>0.5 rad/s (緩やか)</option>
      <option value={1.0}>1.0 rad/s (標準)</option>
      <option value={1.5}>1.5 rad/s (クイック)</option>
      <option value={2.0}>2.0 rad/s (急旋回)</option>
    </select>
  </div>

  {/* 加速度制限の設定 */}
  <div className="setting-row">
    <label className="setting-label" htmlFor="max-acceleration">
      加速度制限の設定 (m/s²)
      <span className="setting-sub-label">急発進・発進時の最大加速度 (0.1 〜 3.0 m/s²)</span>
    </label>
    <input
      id="max-acceleration"
      type="number"
      min={0.1}
      max={3.0}
      step={0.1}
      value={settings.maxAcceleration}
      onChange={(e) => handleChange('maxAcceleration', Number(e.target.value))}
      className="setting-input-number"
    />
  </div>
</section>

        {/* --- セクション2: 安全・センサ設定 --- */}
        <section className="setting-section">
          <h3 className="setting-section-title">安全・センサ設定</h3>

          <div className="setting-row">
            <label className="setting-label" htmlFor="obstacle-distance">
              障害物検知距離の設定 (cm)
              <span className="setting-sub-label">自動減速・停止を開始する前方センサー感度</span>
            </label>
            <input
              id="obstacle-distance"
              type="number"
              min={10}
              max={300}
              step={5}
              value={settings.obstacleDetectDistance}
              onChange={(e) => handleChange('obstacleDetectDistance', Number(e.target.value))}
              className="setting-input-number"
            />
          </div>

          <div className="setting-row">
            <label className="setting-label" htmlFor="emergency-auto-clear">
              障害物除去後の自動復帰設定
              <span className="setting-sub-label">検知対象が消えた際に自動で復帰走行を行うか (BLOCKED等)</span>
            </label>
            <input
              id="emergency-auto-clear"
              type="checkbox"
              checked={settings.emergencyAutoClear}
              onChange={(e) => handleChange('emergencyAutoClear', e.target.checked)}
              className="setting-checkbox"
            />
          </div>
        </section>

        {/* --- セクション3: バッテリー・電源管理 --- */}
        <section className="setting-section">
          <h3 className="setting-section-title">バッテリー・電源管理</h3>

          <div className="setting-row">
            <label className="setting-label" htmlFor="auto-charge">
              自動充電開始閾値の設定 (%)
              <span className="setting-sub-label">この残量を下回ると自動で充電ステーションへ移動</span>
            </label>
            <input
              id="auto-charge"
              type="number"
              min={5}
              max={50}
              step={1}
              value={settings.autoChargeThreshold}
              onChange={(e) => handleChange('autoChargeThreshold', Number(e.target.value))}
              className="setting-input-number"
            />
          </div>

          <div className="setting-row">
            <label className="setting-label" htmlFor="battery-warning">
              低バッテリー警告閾値の設定 (%)
              <span className="setting-sub-label">UI上に警告アラートを発出する残量</span>
            </label>
            <input
              id="battery-warning"
              type="number"
              min={5}
              max={30}
              step={1}
              value={settings.batteryWarningThreshold}
              onChange={(e) => handleChange('batteryWarningThreshold', Number(e.target.value))}
              className="setting-input-number"
            />
          </div>
        </section>

        {/* --- セクション4: 座標系・マップ変換設定 --- */}
        <section className="setting-section">
          <h3 className="setting-section-title">座標系・マップ変換設定</h3>

          <div className="setting-row">
            <label className="setting-label" htmlFor="map-resolution">
              マップ解像度の設定 (m/px)
              <span className="setting-sub-label">世界座標(m)と地図画像ピクセル変換の解像度 (demo_map: 0.05)</span>
            </label>
            <input
              id="map-resolution"
              type="number"
              min={0.01}
              max={0.5}
              step={0.01}
              value={settings.mapResolution}
              onChange={(e) => handleChange('mapResolution', Number(e.target.value))}
              className="setting-input-number"
            />
          </div>

          <div className="setting-row">
            <label className="setting-label" htmlFor="origin-x">
              原点X座標の設定 (m)
              <span className="setting-sub-label">地図の左下原点位置 X (demo_map: -5.0)</span>
            </label>
            <input
              id="origin-x"
              type="number"
              step={0.1}
              value={settings.originX}
              onChange={(e) => handleChange('originX', Number(e.target.value))}
              className="setting-input-number"
            />
          </div>

          <div className="setting-row">
            <label className="setting-label" htmlFor="origin-y">
              原点Y座標の設定 (m)
              <span className="setting-sub-label">地図の左下原点位置 Y (demo_map: -5.0)</span>
            </label>
            <input
              id="origin-y"
              type="number"
              step={0.1}
              value={settings.originY}
              onChange={(e) => handleChange('originY', Number(e.target.value))}
              className="setting-input-number"
            />
          </div>

          <div className="setting-row">
            <label className="setting-label" htmlFor="waypoints-alias">
              登録地点 (Waypoints) の登録設定
              <span className="setting-sub-label">タスク割り当てで使用する地点名リスト (カンマ区切り)</span>
            </label>
            <input
              id="waypoints-alias"
              type="text"
              value={settings.waypointsAlias}
              onChange={(e) => handleChange('waypointsAlias', e.target.value)}
              className="setting-input-text"
            />
          </div>
        </section>

        {/* --- セクション5: マルチAGV・カメラ・接続設定 --- */}
        <section className="setting-section">
          <h3 className="setting-section-title">マルチAGV・カメラ・接続設定</h3>

          <div className="setting-row">
            <label className="setting-label" htmlFor="real-vehicle-id">
              実機車両IDの設定
              <span className="setting-sub-label">通信・制御を行う1台の実機ラジコンカー識別ID</span>
            </label>
            <input
              id="real-vehicle-id"
              type="text"
              value={settings.realVehicleId}
              onChange={(e) => handleChange('realVehicleId', e.target.value)}
              className="setting-input-text"
            />
          </div>

          <div className="setting-row">
            <label className="setting-label" htmlFor="simulated-count">
              疑似車体 (シミュレーション) 台数の設定
              <span className="setting-sub-label">連携走行させるソフトウェア疑似車体の台数 (0 〜 10)</span>
            </label>
            <input
              id="simulated-count"
              type="number"
              min={0}
              max={10}
              step={1}
              value={settings.simulatedVehicleCount}
              onChange={(e) => handleChange('simulatedVehicleCount', Number(e.target.value))}
              className="setting-input-number"
            />
          </div>

          <div className="setting-row">
            <label className="setting-label" htmlFor="camera-url">
              カメラ配信ストリームURLの設定
              <span className="setting-sub-label">PC1配信のMJPEG映像URL (例: http://&lt;PC1&gt;:5000/video)</span>
            </label>
            <input
              id="camera-url"
              type="text"
              value={settings.cameraStreamUrl}
              onChange={(e) => handleChange('cameraStreamUrl', e.target.value)}
              className="setting-input-text"
            />
          </div>

          <div className="setting-row">
            <label className="setting-label" htmlFor="default-map-id">
              使用マップIDの選択
              <span className="setting-sub-label">運行時にロードする初期エリア地図データ (demo_map等)</span>
            </label>
            <select
              id="default-map-id"
              value={settings.defaultMapId}
              onChange={(e) => handleChange('defaultMapId', e.target.value)}
              className="setting-select"
            >
              <option value="demo_map">demo_map (デモ用エリア)</option>
              <option value="MAP-FACTORY-A">区画A (メインエリア)</option>
              <option value="MAP-FACTORY-B">区画B (サブエリア)</option>
            </select>
          </div>
        </section>

        {/* --- 保存ボタン & メッセージ --- */}
        <div className="setting-button-container">
          {isSaved && <span className="setting-success-badge">✓ AGV・運行パラメータを保存しました</span>}
          <button type="submit" className="setting-save-button">設定を保存</button>
        </div>
      </form>
    </div>
  );
};

export default AGVSettings;