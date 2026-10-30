import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useVehicles } from '../../hooks/useVehicles';
import { vehicleStatusLabel } from '../../constants/statusLabels';
import styles from '../../styles/VehicleCards.module.css';

export type { VehicleItem } from '../../hooks/useVehicles';

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
  // 車両一覧（サーバーからの更新がリアルタイムに反映される）
  const { vehicles } = useVehicles();
  
  // ★ useNavigate はコンポーネント関数の中に移動（慣例として小文字の navigate を使用）
  const navigate = useNavigate();

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
              {hasEmergency ? '緊急事態発生' : vehicleStatusLabel(v.status)}
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
                <span>{hasEmergency ? (v.emergencyReason || 'エラー発生中') : `位置: (${v.currentX.toFixed(2)}, ${v.currentY.toFixed(2)}) m`}</span>
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