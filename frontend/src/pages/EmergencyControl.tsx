import React, { useEffect, useState } from 'react';
import '../styles/EmergencyControl.css';
export type Vehicle = {
  id: string;
  name: string;
  status: string;
  streamUrl?: string; // カメラ映像のURL（任意）
};

type Props = {
  selectedVehicle: Vehicle;
  onBack: () => void;
};

export const EmergencyBrake: React.FC<Props> = ({ selectedVehicle, onBack }) => {
  // 押下されているキーの状態
  const [activeKeys, setActiveKeys] = useState<{ [key: string]: boolean }>({
    w: false,
    a: false,
    s: false,
    d: false,
  });

  // キーボード入力の監視
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(key)) {
        setActiveKeys((prev) => ({ ...prev, [key]: true }));
        // TODO: 車両への移動指示コマンド（例: WebSocket送信）を発行
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(key)) {
        setActiveKeys((prev) => ({ ...prev, [key]: false }));
        // TODO: 該当キー解除時の停止・制御指示を送る
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const handleEmergencyStop = () => {
    alert(`⚠️ 車両【${selectedVehicle.name}】（ID: ${selectedVehicle.id}）へ緊急停止信号を送信しました`);
  };

  return (
    <div className="emergency-container">
      {/* ヘッダー領域 */}
      <header className="emergency-header">
        <h2 className="emergency-title">🚨 車両遠隔制御・緊急制動</h2>
        <button type="button" onClick={onBack} className="back-button">
          ← 車両管理画面に戻る
        </button>
      </header>

      <main className="emergency-main">
        {/* メイン監視＆操作エリア */}
        <div className="control-grid">
          {/* 左カラム：映像ビュー & 下部にWASD操作 */}
          <div className="camera-column">
            <div className="camera-view">
              {selectedVehicle.streamUrl ? (
                <img
                  src={selectedVehicle.streamUrl}
                  alt="リアルタイムカメラ映像"
                  className="video-stream"
                />
              ) : (
                <div className="no-camera">
                  <p>📷 カメラ映像受信用エリア</p>
                  <span>（WebRTC / MJPEG ストリームを表示予定）</span>
                </div>
              )}
            </div>

            {/* カメラの下に配置されたWASDコントローラー */}
            <div className="wasd-controller">
              <p className="wasd-title">🎮 走行操作 (WASDキー)</p>
              <div className="wasd-keys">
                <div className={`key-cap key-w ${activeKeys.w ? 'active' : ''}`}>W</div>
                <div className="wasd-row">
                  <div className={`key-cap ${activeKeys.a ? 'active' : ''}`}>A</div>
                  <div className={`key-cap ${activeKeys.s ? 'active' : ''}`}>S</div>
                  <div className={`key-cap ${activeKeys.d ? 'active' : ''}`}>D</div>
                </div>
              </div>
            </div>
          </div>

          {/* 右カラム：カメラの横にアラウンドビューセンサー ＆ 車両情報 */}
          <div className="side-panel">
            {/* アラウンドビュー / センサー画面 */}
            <div className="around-sensor-card">
              <h3 className="section-title">📡 アラウンドビュー＆障害物センサー</h3>
              <div className="sensor-display-placeholder">
                <div className="vehicle-center-icon">🚗</div>
                <div className="radar-wave wave-1" />
                <div className="radar-wave wave-2" />
                <span className="sensor-status-label">周囲360° センサー検知中</span>
              </div>
            </div>

            {/* 対象車両情報 */}
            <div className="vehicle-info-card">
              <h3 className="vehicle-info-title">対象車両情報</h3>
              <p className="vehicle-info-item"><strong>ID:</strong> {selectedVehicle.id}</p>
              <p className="vehicle-info-item"><strong>名前:</strong> {selectedVehicle.name}</p>
              <p className="vehicle-info-item">
                <strong>状態:</strong> <span className="status-highlight">{selectedVehicle.status}</span>
              </p>
            </div>
          </div>
        </div>

        {/* 緊急停止ボタン */}
        <div className="action-area">
          <button type="button" onClick={handleEmergencyStop} className="stop-button">
            【{selectedVehicle.name}】を緊急停止する (SPACE)
          </button>
        </div>
      </main>
    </div>
  );
};