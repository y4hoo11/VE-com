import React from 'react';

export const SystemSettings: React.FC = () => {
  return (
    <div>
      <h3 style={{ borderBottom: '1px solid #ddd', paddingBottom: '8px' }}>
        通信・MQTT/DB接続設定
      </h3>
      <p style={{ color: '#666' }}>
        MQTTブローカーアドレス、データベース接続情報、APIタイムアウト等の設定を行います。
      </p>
      <ul>
        <li>MQTTブローカーURL / ポート</li>
        <li>データベース接続文字列</li>
        <li>通信リトライ回数設定</li>
      </ul>
    </div>
  );
};

export default SystemSettings;