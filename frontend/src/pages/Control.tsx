/**
 * @file Control.tsx
 * @description AGV（無人搬送車）の操作・監視を行うメインコントロール画面。
 * 各子コンポーネント（TaskPanel, VehicleCards, LogPanel, FactoryMap）を統括します。
 */

import React, { useState, useEffect } from 'react';
import type { LogEntry } from '../types';
import { api } from '../services/api';
import { VehicleStatus } from '@prisma/client';
import { TaskPanel } from '../components/dashboard/TaskPanel';
import { FactoryMap } from '../components/map/FactoryMap';
import { VehicleCards } from '../components/dashboard/VehicleCards';
import { LogPanel } from '../components/dashboard/LogPanel';

// マップ表示用の車両型（VehicleCards側のVehicleItemと合わせる）
interface MapVehicle {
  id: string;
  name: string;
  status: VehicleStatus | string;
  batteryLevel: number | null;
  currentX: number;
  currentY: number;
  emergencyReason?: string | null;
}

export const Control: React.FC = () => {
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(false);

  // マップ（FactoryMap）用に定期的に車両データを取得するステート
  const [mapVehicles, setMapVehicles] = useState<MapVehicle[]>([]);

  // ログ用ステート（必要に応じてAPIやSocket.ioから取得可能）
  const [logs] = useState<LogEntry[]>([
    { id: 1, message: 'AGVシステムが起動しました', level: 'info', time: '10:00' },
  ]);

  // マップ描画用の車両位置データを定期取得
  const fetchMapVehicles = async () => {
    try {
      const res = await api.get<MapVehicle[]>('/vehicles');
      setMapVehicles(res.data);
    } catch (err) {
      console.error('マップ用車両データの取得に失敗しました:', err);
    }
  };

  useEffect(() => {
    fetchMapVehicles();
    const interval = setInterval(fetchMapVehicles, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleSelectVehicle = (vehicleId: string) => {
    console.log(`車両 ${vehicleId} がクリックされました`);
  };

  const handleAcknowledgeEmergency = async (vehicleId: string) => {
    try {
      // 緊急状態の解除API、またはSocket経由の処理
      console.log(`車両 ${vehicleId} の緊急状態を確認・解除します`);
      fetchMapVehicles();
    } catch (err) {
      console.error('緊急解除に失敗しました:', err);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '10px', gap: '10px', boxSizing: 'border-box', backgroundColor: '#f0f2f5' }}>
      {/* 上部エリア（サイドボタン + パネル + マップ） */}
      <div style={{ display: 'flex', flex: 1, border: '2px solid #333', background: '#fff', position: 'relative', overflow: 'hidden' }}>
        
        {/* 開閉ボタン */}
        <div
          onClick={() => setIsTaskPanelOpen(!isTaskPanelOpen)}
          style={{ width: '32px', height: '90px', background: '#000', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '10px', cursor: 'pointer', zIndex: 10, userSelect: 'none' }}
        >
          <span style={{ writingMode: 'vertical-rl', letterSpacing: '2px', fontWeight: 'bold', fontSize: '12px' }}>サイド</span>
        </div>

        {/* タスク管理パネル（内部でDBから直接取得・追加・削除を行う） */}
        {isTaskPanelOpen && <TaskPanel />}

        {/* マップ表示エリア */}
        <FactoryMap vehicles={mapVehicles as any} />
      </div>

      {/* 下部エリア（車両情報 + ログ） */}
      <div style={{ height: '180px', display: 'flex', gap: '10px' }}>
        
        {/* 車両カード（内部でDBから直接取得） */}
        <VehicleCards
          onSelectVehicle={handleSelectVehicle}
          onAcknowledgeEmergency={handleAcknowledgeEmergency}
        />

        {/* 通知・ログパネル */}
        <LogPanel logs={logs} />
      </div>
    </div>
  );
};