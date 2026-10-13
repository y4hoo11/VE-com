import React from 'react';

export const AGVSettings: React.FC = () => {
  return (
    <div>
      <h3 style={{ borderBottom: '1px solid #ddd', paddingBottom: '8px' }}>
        AGV・運行パラメータ設定
      </h3>
      <p style={{ color: '#666' }}>
        最高速度、障害物センサ感度、走行エリア制限などの運行パラメータをここで設定します。
      </p>
      <ul>
        <li>最高速度設定 (m/s)</li>
        <li>障害物検知距離 (cm)</li>
        <li>自動充電しきい値 (%)</li>
      </ul>
    </div>
  );
};

export default AGVSettings;