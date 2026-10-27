import React, { useState, useRef } from 'react';
import './SettingForm.css'; // 共通CSSスタイル

// --- 型定義 ---
export type ThemeOption = 'light' | 'dark' | 'system';
export type LanguageOption = 'ja' | 'en' | 'zh';

// 基本設定のデータ構造（追加資料の仕様を反映）
export interface GeneralSettingsState {
  // 1. UI・テーマ表示
  theme: ThemeOption;         // 画面カラーテーマ ('light' | 'dark' | 'system')
  language: LanguageOption;   // UI言語 ('ja' | 'en' | 'zh')
  
  // 2. マップ・リアルタイム表示 (FactoryMap.tsx 連動)
  mapRefreshInterval: number; // 車両位置の取得・ポーリング周期 (ms) (デフォルト: 3000ms)
  showGrid: boolean;           // グリッド線（方眼）表示フラグ
  showVehiclePath: boolean;   // 車両の走行軌跡（履歴線）表示フラグ
  showVehicleTheta: boolean;  // 車両向き（Yaw角度 θ）インジケータ表示フラグ
  
  // --- 【追加仕様】通信仕様書 (agv_protocol.md) に対応 ---
  showNav2Path: boolean;      // Nav2が計画した目標経路 (agv/{id}/path) の描画フラグ
  enableCameraOverlay: boolean;// カメラ映像ストリーミング (http://<PC1>:5000/video) のオーバーレイ表示
}

export const GeneralSettings: React.FC = () => {
  // 1. 設定フォームの状態管理（UI確認用初期値）
  const [settings, setSettings] = useState<GeneralSettingsState>({
    theme: 'light',
    language: 'ja',
    mapRefreshInterval: 3000,
    showGrid: true,
    showVehiclePath: true,
    showVehicleTheta: true,
    showNav2Path: true,       // Nav2 計画経路の表示 (デフォルトON)
    enableCameraOverlay: false, // カメラ映像ポップアップ (デフォルトOFF)
  });

  // 2. 設定保存成功バナーの表示状態
  const [isSaved, setIsSaved] = useState(false);

  // 3. ドラッグスクロール（パン操作）用の参照と座標状態
  const scrollRef = useRef<HTMLDivElement>(null); // スクロール枠への参照
  const [isDragging, setIsDragging] = useState(false); // ドラッグ中フラグ
  const [startX, setStartX] = useState(0);             // ドラッグ開始時のX座標
  const [startY, setStartY] = useState(0);             // ドラッグ開始時のY座標
  const [scrollLeft, setScrollLeft] = useState(0);     // ドラッグ開始時のスクロールX位置
  const [scrollTop, setScrollTop] = useState(0);         // ドラッグ開始時のスクロールY位置

  // --- ドラッグ操作イベントハンドラー ---

  // マウスダウン：ドラッグ開始
  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // フォーム入力部品（input, select, buttonなど）の操作時はドラッグをスキップ
    if (['INPUT', 'SELECT', 'BUTTON', 'LABEL'].includes(target.tagName)) return;
    if (!scrollRef.current) return;

    setIsDragging(true);
    // マウス位置とコンテナ初期スクロール量の保存
    setStartX(e.pageX - scrollRef.current.offsetLeft);
    setStartY(e.pageY - scrollRef.current.offsetTop);
    setScrollLeft(scrollRef.current.scrollLeft);
    setScrollTop(scrollRef.current.scrollTop);
  };

  // マウス移動：ドラッグ中のスクロール移動
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollRef.current) return;
    e.preventDefault(); // テキスト選択などを防止

    // 現在のマウス座標からの移動量を計算（1.5倍速度で追従）
    const x = e.pageX - scrollRef.current.offsetLeft;
    const y = e.pageY - scrollRef.current.offsetTop;
    scrollRef.current.scrollLeft = scrollLeft - (x - startX) * 1.5;
    scrollRef.current.scrollTop = scrollTop - (y - startY) * 1.5;
  };

  // --- 汎用入力チェンジハンドラー ---
  const handleChange = <K extends keyof GeneralSettingsState>(
    key: K,
    value: GeneralSettingsState[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setIsSaved(false); // 値が変更されたら保存バナーを一旦非表示
  };

  // --- 設定保存処理（モック） ---
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('基本設定（GeneralSettings）を保存しました:', settings);
    setIsSaved(true);
    // 3秒後に「保存しました」メッセージを自動削除
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div
      ref={scrollRef}
      className={`setting-scroll-wrapper ${isDragging ? 'is-dragging' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseLeave={() => setIsDragging(false)} // 枠外に出たらドラッグ終了
      onMouseUp={() => setIsDragging(false)}    // マウス離したらドラッグ終了
      onMouseMove={handleMouseMove}
    >
      <form className="setting-container" onSubmit={handleSave}>
        {/* ドラッグ操作案内バナー */}

        {/* --- セクション1: 表示・テーマ設定 --- */}
        <section className="setting-section">
          <h3 className="setting-section-title">表示・テーマ</h3>
          
          {/* カラーテーマ選択 */}
          <div className="setting-row">
            <label className="setting-label" htmlFor="theme-select">
              テーマ
              <span className="setting-sub-label">画面全体のカラーテーマを選択します</span>
            </label>
            <select
              id="theme-select"
              value={settings.theme}
              onChange={(e) => handleChange('theme', e.target.value as ThemeOption)}
              className="setting-select"
            >
              <option value="light">ライトモード</option>
              <option value="dark">ダークモード</option>
              <option value="system">システム設定に従う</option>
            </select>
          </div>

          {/* 表示言語選択 */}
          <div className="setting-row">
            <label className="setting-label" htmlFor="language-select">
              表示言語
              <span className="setting-sub-label">UIの表示言語を切り替えます</span>
            </label>
            <select
              id="language-select"
              value={settings.language}
              onChange={(e) => handleChange('language', e.target.value as LanguageOption)}
              className="setting-select"
            >
              <option value="ja">日本語</option>
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
          </div>
        </section>

        {/* --- セクション2: マップ・リアルタイム表示設定 --- */}
        <section className="setting-section">
          <h3 className="setting-section-title">マップ・リアルタイム表示</h3>
          
         

          {/* 2. グリッド線表示 */}
          <div className="setting-row">
            <label className="setting-label" htmlFor="show-grid">
              グリッド線の表示
              <span className="setting-sub-label">マップ上にグリッド（方眼）を表示します</span>
            </label>
            <input
              id="show-grid"
              type="checkbox"
              checked={settings.showGrid}
              onChange={(e) => handleChange('showGrid', e.target.checked)}
              className="setting-checkbox"
            />
          </div>

          {/* 3. 過去の走行軌跡表示 */}
          <div className="setting-row">
            <label className="setting-label" htmlFor="show-path">
              走行軌跡（トレース）の表示
              <span className="setting-sub-label">車両の移動履歴線をマップ上に描画します</span>
            </label>
            <input
              id="show-path"
              type="checkbox"
              checked={settings.showVehiclePath}
              onChange={(e) => handleChange('showVehiclePath', e.target.checked)}
              className="setting-checkbox"
            />
          </div>

          {/* 4. 車体向き表示 */}
          <div className="setting-row">
            <label className="setting-label" htmlFor="show-theta">
              車体向きインジケータの表示
              <span className="setting-sub-label">マップ上の車体アイコンに向き（Yaw角度 θ）を表示します</span>
            </label>
            <input
              id="show-theta"
              type="checkbox"
              checked={settings.showVehicleTheta}
              onChange={(e) => handleChange('showVehicleTheta', e.target.checked)}
              className="setting-checkbox"
            />
          </div>

          {/* 5. Nav2 計画経路表示 */}
          <div className="setting-row">
            <label className="setting-label" htmlFor="show-nav2-path">
              Nav2 計画経路の表示
              <span className="setting-sub-label">PC1から送信される目標地点までの予定経路線を描画します[cite: 17, 18]</span>
            </label>
            <input
              id="show-nav2-path"
              type="checkbox"
              checked={settings.showNav2Path}
              onChange={(e) => handleChange('showNav2Path', e.target.checked)}
              className="setting-checkbox"
            />
          </div>

          {/* 6. カメラ映像表示 */}
          <div className="setting-row">
            <label className="setting-label" htmlFor="enable-camera">
              カメラ映像オーバーレイの表示
              <span className="setting-sub-label">PC1配信のマーカー解析つき映像を表示します[cite: 17, 18]</span>
            </label>
            <input
              id="enable-camera"
              type="checkbox"
              checked={settings.enableCameraOverlay}
              onChange={(e) => handleChange('enableCameraOverlay', e.target.checked)}
              className="setting-checkbox"
            />
          </div>
        </section>
        {/* --- 保存ボタン & ステータス表示 --- */}
        <div className="setting-button-container">
          {isSaved && <span className="setting-success-badge">✓ 基本設定を保存しました</span>}
          <button type="submit" className="setting-save-button">設定を保存</button>
        </div>
      </form>
    </div>
  );
};

export default GeneralSettings;