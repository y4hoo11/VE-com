import React, { useEffect, useState } from 'react';
import '../styles/EmergencyControl.css';

export type Vehicle = {
  id: string;
  name: string;
  status: string;
  streamUrl?: string;
};

// 8方向のソナー距離（単位: cm）
type MeterSonarData = {
  frontLeftCorner: number;   // A(左)
  frontLeftCenter: number;   // B(左)
  frontRightCenter: number;  // B(右)
  frontRightCorner: number;  // A(右)
  rearLeftCorner: number;    // C(左)
  rearLeftCenter: number;    // D(左)
  rearRightCenter: number;   // D(右)
  rearRightCorner: number;   // C(右)
};

type Props = {
  selectedVehicle: Vehicle;
  onBack: () => void;
};

export const EmergencyBrake: React.FC<Props> = ({ selectedVehicle, onBack }) => {
  const [activeKeys, setActiveKeys] = useState<{ [key: string]: boolean }>({
    w: false, a: false, s: false, d: false,
  });

  // 8箇所の初期距離設定
  const [sonar, setSonar] = useState<MeterSonarData>({
    frontLeftCorner: 150,
    frontLeftCenter: 35,  // 危険（内側赤点滅）デモ
    frontRightCenter: 120,
    frontRightCorner: 180,
    rearLeftCorner: 70,   // 注意（黄）デモ
    rearLeftCenter: 160,
    rearRightCenter: 160,
    rearRightCorner: 180,
  });

  const [isDemoMode, setIsDemoMode] = useState<boolean>(true);

  // ランダムデモアニメーション
  useEffect(() => {
    if (!isDemoMode) return;
    const interval = setInterval(() => {
      setSonar({
        frontLeftCorner: Math.floor(Math.random() * 160) + 20,
        frontLeftCenter: Math.floor(Math.random() * 160) + 20,
        frontRightCenter: Math.floor(Math.random() * 160) + 20,
        frontRightCorner: Math.floor(Math.random() * 160) + 20,
        rearLeftCorner: Math.floor(Math.random() * 160) + 20,
        rearLeftCenter: Math.floor(Math.random() * 160) + 20,
        rearRightCenter: Math.floor(Math.random() * 160) + 20,
        rearRightCorner: Math.floor(Math.random() * 160) + 20,
      });
    }, 1400);

    return () => clearInterval(interval);
  }, [isDemoMode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(key)) {
        setActiveKeys((prev) => ({ ...prev, [key]: true }));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(key)) {
        setActiveKeys((prev) => ({ ...prev, [key]: false }));
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

  // 距離から点灯させるアークのレベル（0:消灯, 1:遠〜4:近）を判定
  const getActiveLevel = (dist: number) => {
    if (dist < 40) return 4;
    if (dist < 70) return 3;
    if (dist < 100) return 2;
    if (dist < 140) return 1;
    return 0;
  };

  const getArcColor = (dist: number, barIndex: number) => {
    if (dist < 40) {
      return barIndex === 3 ? '#ef4444' : '#f87171'; // 最近接は赤
    }
    if (dist < 70) return '#facc15'; // 黄
    return '#38bdf8'; // 水色
  };

  // SVGアーク描画ヘルパー (角度と半径から円弧パスを生成)
  const renderArcSegment = (
    dist: number,
    startAngle: number,
    endAngle: number,
    radiusOffset: number,
    barIndex: number
  ) => {
    const level = getActiveLevel(dist);
    const isActive = level >= (4 - barIndex);
    if (!isActive) return null;

    const cx = 150;
    const cy = 150;
    const r = 65 + radiusOffset * 10; // 内側から外側へ

    const startRad = ((startAngle - 90) * Math.PI) / 180;
    const endRad = ((endAngle - 90) * Math.PI) / 180;

    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);

    const d = `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
    const strokeColor = getArcColor(dist, barIndex);
    const isDanger = dist < 40 && barIndex === 3;

    return (
      <path
        key={barIndex}
        d={d}
        fill="none"
        stroke={strokeColor}
        strokeWidth="6"
        strokeLinecap="round"
        className={isDanger ? 'svg-danger-pulse' : ''}
      />
    );
  };

  // セクターごとの4重アーク描画
  const renderSectorArcs = (dist: number, startAngle: number, endAngle: number) => {
    return [0, 1, 2, 3].map((barIndex) =>
      renderArcSegment(dist, startAngle, endAngle, barIndex, barIndex)
    );
  };

  const hasDanger = Object.values(sonar).some((d) => d < 40);

  return (
    <div className="emergency-container">
      <header className="emergency-header">
        <h2 className="emergency-title">🚨 車両遠隔制御・緊急制動</h2>
        <button type="button" onClick={onBack} className="back-button">
          ← 車両管理画面に戻る
        </button>
      </header>

      <main className="emergency-main">
        <div className="control-grid">
          {/* 左：カメラ & WASD */}
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

          {/* 右：車載メーター風クリアランスソナー */}
          <div className="side-panel">
            <div className="around-sensor-card">
              <div className="sensor-card-header">
                <h3 className="section-title">📡 クリアランスソナー (アラウンドビュー)</h3>
                <button
                  type="button"
                  className={`demo-toggle-btn ${isDemoMode ? 'active' : ''}`}
                  onClick={() => setIsDemoMode(!isDemoMode)}
                >
                  {isDemoMode ? 'デモ動作中 🔄' : 'デモ再開 ▶'}
                </button>
              </div>

              <div className="meter-display-area">
                {/* SVGで綺麗な円弧インジケーターを描画 */}
                <svg className="sonar-svg-layer" viewBox="0 0 300 300">
                  {/* ガイド背景線（灰色のアーク） */}
                  <g opacity="0.15" stroke="#ffffff" strokeWidth="6" fill="none">
                    {/* フロント4セクターガイド */}
                    <path d="M 80 80 A 100 100 0 0 1 220 80" />
                    {/* リア4セクターガイド */}
                    <path d="M 80 220 A 100 100 0 0 0 220 220" />
                  </g>

                  {/* 実データのアーク (前方4セクター) */}
                  {renderSectorArcs(sonar.frontLeftCorner, -65, -35)}
                  {renderSectorArcs(sonar.frontLeftCenter, -30, -5)}
                  {renderSectorArcs(sonar.frontRightCenter, 5, 30)}
                  {renderSectorArcs(sonar.frontRightCorner, 35, 65)}

                  {/* 実データのアーク (後方4セクター) */}
                  {renderSectorArcs(sonar.rearLeftCorner, -145, -115)}
                  {renderSectorArcs(sonar.rearLeftCenter, -175, -150)}
                  {renderSectorArcs(sonar.rearRightCenter, 150, 175)}
                  {renderSectorArcs(sonar.rearRightCorner, 115, 145)}
                </svg>

                {/* 中央の車体（縦向き上面図） */}
                <div className={`car-vertical-body ${hasDanger ? 'danger-body' : ''}`}>
                  <div className="windshield-v front-v" />
                  <div className="windshield-v rear-v" />
                </div>

                {/* 下部ステータス表示 */}
                <div className="meter-footer-status">
                  {hasDanger ? (
                    <span className="status-alert-red">⚠️ 接近警告！障害物を検知しました</span>
                  ) : (
                    <span className="status-ok">周囲クリアランス 正常検知中</span>
                  )}
                </div>
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