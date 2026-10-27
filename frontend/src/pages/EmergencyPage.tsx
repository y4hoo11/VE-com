/**
 * @file EmergencyPage.tsx
 * @description URL（/emergency/:id）の車両IDから車両情報を取得し、緊急制御画面に渡す。
 * 車両の状態はリアルタイムに更新される。
 */

import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EmergencyBrake } from './EmergencyControl';
import { useVehicles } from '../hooks/useVehicles';

export const EmergencyPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { vehicles, loaded } = useVehicles();

  const vehicle = vehicles.find((v) => v.id === id);
  const goBack = () => navigate('/control');

  if (!vehicle) {
    return (
      <div style={{ padding: '20px' }}>
        <p>{loaded ? `車両「${id}」が見つかりません` : '車両情報を読み込み中...'}</p>
        <button type="button" onClick={goBack}>
          ← 車両管理画面に戻る
        </button>
      </div>
    );
  }

  return (
    <EmergencyBrake
      selectedVehicle={{ id: vehicle.id, name: vehicle.name || vehicle.id, status: vehicle.status }}
      onBack={goBack}
    />
  );
};
