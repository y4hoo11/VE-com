import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import styles from '../../styles/VehicleCards.module.css';

export interface VehicleItem {
  id: string;
  name: string;
  status: string;
  batteryLevel: number | null;
  currentX: number;
  currentY: number;
  emergencyReason?: string | null;
}

type VehicleCardsProps = {
  onSelectVehicle: (id: string) => void;
  onAcknowledgeEmergency?: (id: string) => void;
};

const getBatteryColor = (battery: number | null): string => {
  if (battery === null) return '#a1a1aa';
  if (battery <= 20) return '#ff6b6b';
  if (battery <= 40) return '#facc15';
  return '#ffffff';
};

export const VehicleCards: React.FC<VehicleCardsProps> = ({
  onSelectVehicle,
  onAcknowledgeEmergency,
}) => {
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);

  // データベースから車両一覧を取得
  const fetchVehicles = async () => {
    try {
      const res = await api.get<VehicleItem[]>('/vehicles');
      setVehicles(res.data);
    } catch (err) {
      console.error('車両一覧の取得に失敗しました:', err);
    }
  };

  useEffect(() => {
    fetchVehicles();
    const interval = setInterval(fetchVehicles, 3000); // 3秒ごとにポーリング
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={styles.container}>
      {vehicles.map((v) => {
        const hasEmergency = v.status === 'ERROR';

        return (
          <div key={v.id} className={styles.card}>
            {/* 行1: 車両名+バッテリー / 異常検知 */}
            <div className={styles.headerLeft}>
              <span className={styles.vehicleName}>{v.name || v.id}</span>
              <span
                className={styles.batteryText}
                style={{
                  color: getBatteryColor(v.batteryLevel),
                  fontWeight: v.batteryLevel !== null && v.batteryLevel <= 20 ? 700 : 400,
                }}
              >
                バッテリー残量: {v.batteryLevel !== null ? `${v.batteryLevel}%` : '--'}
              </span>
            </div>

            <div
              className={`${styles.statusBadge} ${
                hasEmergency ? styles.statusEmergency : styles.statusNormal
              }`}
            >
              {hasEmergency ? '緊急事態発生' : v.status}
            </div>

            {/* 行2: 詳細ボタン / 緊急詳細 */}
            <button
              type="button"
              onClick={() => {
                navigate(`/emergency/${v.id}`); // ★画面遷移を実行
                onSelectVehicle(v.id);
              }}
              className={styles.detailButton}
            >
              車両詳細
              <span className={styles.detailButtonSub}></span>
            </button>

            <div className={styles.emergencyInfo}>
              <div className={styles.emergencyLabel}>状態・詳細</div>
              <div className={styles.emergencyBody}>
                <span>{hasEmergency ? (v.emergencyReason || 'エラー発生中') : `座標: X=${v.currentX}, Y=${v.currentY}`}</span>
                {hasEmergency && onAcknowledgeEmergency && (
                  <button
                    type="button"
                    onClick={() => onAcknowledgeEmergency(v.id)}
                    className={styles.ackButton}
                  >
                    確認
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

}; 