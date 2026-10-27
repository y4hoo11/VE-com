// useVehicles.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { useSocketEvent } from './useSocketEvent';
import type { VehicleUpdatePayload } from '../types';

export interface VehicleItem {
  id: string;
  name: string;
  status: string;
  batteryLevel: number | null;
  currentX: number;
  currentY: number;
  currentTheta?: number | null;
  emergencyReason?: string | null;
}

/**
 * 車両一覧を取得し、サーバーから届く変化（vehicle:update）をリアルタイムに反映するフック
 * 車両カードとマップの両方で使う
 */
export function useVehicles() {
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [loaded, setLoaded] = useState(false); // 最初の取得が終わったか
  const vehiclesRef = useRef<VehicleItem[]>([]);
  useEffect(() => {
    vehiclesRef.current = vehicles;
  }, [vehicles]);

  const fetchVehicles = useCallback(async () => {
    try {
      const res = await api.get<VehicleItem[]>('/vehicles');
      setVehicles(res.data);
    } catch (err) {
      console.error('車両一覧の取得に失敗しました:', err);
    } finally {
      setLoaded(true);
    }
  }, []);

  // 最初に一覧を取得
  useEffect(() => {
    fetchVehicles();
  }, [fetchVehicles]);

  // 再接続したら、切断中の変化を取りこぼさないよう取り直す
  useSocketEvent('connect', fetchVehicles);

  // 届いた項目だけを上書きする（届かなかった項目は今の値のまま）
  useSocketEvent<VehicleUpdatePayload>('vehicle:update', (update) => {
    if (!vehiclesRef.current.some((v) => v.id === update.id)) {
      // 知らない車両（新しく接続した車両など）なら一覧ごと取り直す
      fetchVehicles();
      return;
    }
    const changes = Object.fromEntries(
      Object.entries(update).filter(([, value]) => value !== undefined)
    ) as Partial<VehicleItem>;
    setVehicles((prev) => prev.map((v) => (v.id === update.id ? { ...v, ...changes } : v)));
  });

  return { vehicles, loaded, refetch: fetchVehicles };
}
