import React from 'react';
import type { Vehicle } from '../../types';
import { useNavigate } from 'react-router-dom';
import styles from '../../styles/VehicleCards.module.css';

type VehicleCardsProps = {
  vehicles: Vehicle[];
  onSelectVehicle: (id: string) => void;
  onAcknowledgeEmergency?: (id: string) => void;
};

const renderTask = (task: Vehicle['task']): string => {
  if (task === null || task === undefined || task === '') return '未割り当て';
  if (Array.isArray(task)) return task.length > 0 ? task.join(' / ') : '未割り当て';
  return task;
};

const getBatteryColor = (battery: number | null): string => {
  if (battery === null) return '#a1a1aa';
  if (battery <= 20) return '#ff6b6b';
  if (battery <= 40) return '#facc15';
  return '#ffffff';
};

export const VehicleCards: React.FC<VehicleCardsProps> = ({
  vehicles,
  onSelectVehicle,
  onAcknowledgeEmergency,
}) => {
  const navigate = useNavigate();
  return (
    <div className={styles.container}>
      {vehicles.map((v) => {
        const hasEmergency = !!v.emergency;

        return (
          <div key={v.id} className={styles.card}>
            {/* 行1: 車両名+バッテリー / 異常検知 */}
            <div className={styles.headerLeft}>
              <span className={styles.vehicleName}>{v.name}</span>
              <span
                className={styles.batteryText}
                style={{
                  color: getBatteryColor(v.battery),
                  fontWeight: v.battery !== null && v.battery <= 20 ? 700 : 400,
                }}
              >
                バッテリー残量: {v.battery !== null ? `${v.battery}%` : '--'}
              </span>
            </div>

            <div
              className={`${styles.statusBadge} ${
                hasEmergency ? styles.statusEmergency : styles.statusNormal
              }`}
            >
              {hasEmergency ? '緊急事態発生' : '異常なし'}
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
              <div className={styles.emergencyLabel}>緊急詳細</div>
              <div className={styles.emergencyBody}>
                <span>{hasEmergency ? v.emergency : '〜'}</span>
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

            {/* 行3: タスク */}
            <div className={styles.taskText}>{renderTask(v.task)}</div>
          </div>
        );
      })}
    </div>
  );

}; 