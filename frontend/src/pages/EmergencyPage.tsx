/**
 * @file EmergencyPage.tsx
 * @description URL（/emergency/:id）の車両IDから車両情報を取り出し、緊急制御画面に渡す。
 * 車両の一覧はアプリ共通のストア（store.ts）が持っていて、Socket.IO で届いた変化もそこに入るので、
 * 状態はリアルタイムに更新される。
 */

import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EmergencyBrake } from './EmergencyControl';
import { closeDrawer, useStore } from '../store/store';
import { ST } from '../store/data';

export function EmergencyPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const s = useStore();

  // 横から出るパネル（ドロワー）から来たときは閉じる。開いたままだと画面の右側が隠れる
  useEffect(() => {
    closeDrawer();
  }, []);

  const vehicle = s.vehicles.find((v) => v.id === id);
  const goBack = () => navigate('/'); // 運行モニター（車両一覧のある画面）へ

  if (!vehicle) {
    return (
      <div style={{ padding: '20px' }}>
        <p>{s.loaded ? `車両「${id}」が見つかりません` : '車両情報を読み込み中...'}</p>
        <button type="button" onClick={goBack}>
          ← 運行モニターに戻る
        </button>
      </div>
    );
  }

  return (
    <EmergencyBrake
      selectedVehicle={{
        id: vehicle.id,
        name: vehicle.name || vehicle.id,
        status: vehicle.online ? ST[vehicle.status] : ST.OFFLINE,
        streamUrl: vehicle.camera || undefined,
      }}
      onBack={goBack}
    />
  );
}
