// mqtt.ts
import mqtt from 'mqtt';
import dotenv from 'dotenv';

dotenv.config();

// MQTTブローカーのURL（環境変数、またはローカルのデフォルト）
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';

export const mqttClient = mqtt.connect(MQTT_BROKER_URL, {
  clientId: `dispatch_server_${Math.random().toString(16).substring(2, 8)}`,
  clean: true,
  connectTimeout: 4000,
  reconnectPeriod: 2000, // 切断時の再接続間隔(ms)
});

// 同じエラーを2秒ごとに出し続けないよう、前回の内容を覚えておく
let lastErrorText = '';

mqttClient.on('connect', () => {
  lastErrorText = '';
  console.log(' [MQTT] ブローカーに接続しました:', MQTT_BROKER_URL);
});

mqttClient.on('error', (err) => {
  // Windows では「接続先が見つからない」エラーの message が空になるため、code も使う
  const code = (err as { code?: unknown }).code;
  const detail = err.message || (typeof code === 'string' ? code : '') || String(err);
  if (detail === lastErrorText) return;
  lastErrorText = detail;

  const hint =
    code === 'ECONNREFUSED'
      ? '（ブローカーが起動していません。Docker の mosquitto が動いているか確認してください）'
      : '';
  console.error(` [MQTT] 接続エラー: ${detail}${hint} ※再接続を続けます`);
});