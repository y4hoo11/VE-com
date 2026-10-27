/**
 * @file Control.tsx
 * @description AGV（無人搬送車）の操作・監視を行うメインコントロール画面。
 * 各子コンポーネント（TaskPanel, VehicleCards, LogPanel, FactoryMap）を統括します。
 */

import React, { useState, useEffect } from 'react';
import type { LogEntry } from '../types';
import { api } from '../services/api';
import { emitWithAck } from '../services/socket';
import { useSocketEvent } from '../hooks/useSocketEvent';
import { useVehicles } from '../hooks/useVehicles';
import { TaskPanel } from '../components/dashboard/TaskPanel';
import { FactoryMap } from '../components/map/FactoryMap';
import { VehicleCards } from '../components/dashboard/VehicleCards';
import { LogPanel } from '../components/dashboard/LogPanel';

// ログの形式（GET /api/logs のレスポンスと、Socket の log:new で共通）
interface ApiLog {
  id: string;
  vehicleId?: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  timestamp: string;
}

// 表示件数の上限
const MAX_LOGS = 30;

// サーバーのログを LogPanel の表示形式に変換する
const toLogEntry = (log: ApiLog): LogEntry => ({
  id: log.id,
  message: log.vehicleId ? `[${log.vehicleId}] ${log.message}` : log.message,
  // LogPanel は 'emergency' を赤表示するため、ERROR はそちらに寄せる
  level: log.level === 'ERROR' ? 'emergency' : log.level === 'WARN' ? 'warn' : 'info',
  time: new Date(log.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
});

export const Control: React.FC = () => {
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(false);

  // マップ（FactoryMap）用の車両データ（サーバーからの更新がリアルタイムに反映される）
  const { vehicles: mapVehicles } = useVehicles();

  // 通知・ログ
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const fetchLogs = async () => {
    try {
      const res = await api.get<ApiLog[]>('/logs', { params: { limit: MAX_LOGS } });
      setLogs(res.data.map(toLogEntry));
    } catch (err) {
      console.error('ログの取得に失敗しました:', err);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  // 新しいログが届いたら先頭に追加する
  useSocketEvent<ApiLog>('log:new', (log) => {
    setLogs((prev) => [toLogEntry(log), ...prev.filter((l) => l.id !== log.id)].slice(0, MAX_LOGS));
  });
  // 再接続したら、切断中のログを取り直す
  useSocketEvent('connect', fetchLogs);

  const handleSelectVehicle = (vehicleId: string) => {
    console.log(`車両 ${vehicleId} がクリックされました`);
  };

  // 緊急状態の「確認」ボタン：サーバーに解除を依頼する（結果は vehicle:update で画面に反映される）
  const handleAcknowledgeEmergency = async (vehicleId: string) => {
    const res = await emitWithAck('acknowledge_emergency', { vehicleId });
    if (!res.ok) {
      alert(`緊急状態を解除できませんでした: ${res.error}`);
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
