// 物理センサー（アラウンドビュー）：車体のまわり 8 方向の障害物までの距離を、近いほど内側まで点く円弧で表す。
// もとは緊急制御画面（otyazuke さん作）にあった表示を、車両詳細ページ用の部品にしたもの。
//
// 値は telemetry の scan8（LiDAR を 8 方向に分けた、それぞれの一番近い距離）と usFront（前の超音波）。
// どちらも PC1 の mqtt_bridge が送る（ROS 側に追加をお願いしている項目）。届いていないときは「データなし」。
import { useEffect, useState } from 'react';
import type { Vehicle } from '../store/data';
import { cx } from './uiUtils';

const DANGER_CM = 40; // これより近いと「接近警告」（赤）
const CAUTION_CM = 70; // これより近いと注意（黄）
const STALE_MS = 3000; // これより長く値が届かなければ「データなし」

// scan8 の並び [前, 左前, 左, 左後, 後, 右後, 右, 右前] と、画面での向き（真上 = 前が 0°、時計回り）
const NAMES = ['前', '左前', '左', '左後', '後', '右後', '右', '右前'];
const SECTORS = NAMES.map((_, i) => -45 * i);
const HALF = 18; // 1 方向の円弧の半分の幅 [度]

// 距離 → 点ける円弧の本数（0 = 消灯、4 = いちばん近い）。null（その方向に何もない）は消灯
const levelOf = (cm: number | null) => (cm == null ? 0 : cm < DANGER_CM ? 4 : cm < CAUTION_CM ? 3 : cm < 100 ? 2 : cm < 140 ? 1 : 0);
const colorOf = (cm: number) => (cm < DANGER_CM ? '#ef4444' : cm < CAUTION_CM ? '#f59e0b' : '#38bdf8');
const toCm = (m: number | null | undefined) => (m == null ? null : Math.round(m * 100));

// 中心 (150,150)・半径 r で、角度 a0〜a1 の円弧
function arc(r: number, a0: number, a1: number) {
  const pt = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(150 + r * Math.cos(rad)).toFixed(1)} ${(150 + r * Math.sin(rad)).toFixed(1)}`;
  };
  return `M ${pt(a0)} A ${r} ${r} 0 0 1 ${pt(a1)}`;
}

// 1 秒ごとに描き直す（値が途絶えたことに気づけるように）
function useNow() {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

export function SonarView({ v }: { v: Vehicle }) {
  const t = useNow();
  const fresh = v.online && v.sensorAt > 0 && t - v.sensorAt < STALE_MS;
  const cms = fresh && v.scan8 ? v.scan8.map(toCm) : null;
  const us = fresh ? toCm(v.usFront) : null;
  const all = [...(cms ?? []), us].filter((x): x is number => x != null);
  const nearest = all.length ? Math.min(...all) : null;
  const danger = nearest != null && nearest < DANGER_CM;
  const nearestDir = cms && nearest != null ? (us === nearest ? '前（超音波）' : NAMES[cms.indexOf(nearest)]) : null;

  const status = !v.online
    ? 'データなし（オフライン）'
    : !fresh
      ? 'データなし（センサーの値が届いていません）'
      : nearest == null
        ? '近くに障害物はありません'
        : `${danger ? '接近警告 ' : ''}いちばん近い所：${nearestDir ?? ''} ${nearest} cm`;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-3">
      <svg viewBox="30 30 240 240" className="w-full max-w-[280px] flex-1" role="img" aria-label="車体のまわりのセンサー表示">
        {/* 消灯している円弧（ガイド） */}
        <g fill="none" strokeWidth={6} strokeLinecap="round" className="stroke-slate-200 dark:stroke-slate-700">
          {SECTORS.map((a, k) => [0, 1, 2, 3].map((i) => <path key={`${k}-${i}`} d={arc(65 + i * 10, a - HALF, a + HALF)} />))}
        </g>
        {/* 点いている円弧（近いほど内側まで点く） */}
        {cms && (
          <g fill="none" strokeWidth={6} strokeLinecap="round">
            {SECTORS.map((a, k) => {
              const cm = cms[k];
              const level = levelOf(cm);
              return [0, 1, 2, 3].map((i) =>
                cm != null && level >= 4 - i ? (
                  <path key={`${k}-${i}`} d={arc(65 + i * 10, a - HALF, a + HALF)} stroke={colorOf(cm)} className={cx(cm < DANGER_CM && i === 0 && 'animate-pulse')} />
                ) : null,
              );
            })}
          </g>
        )}
        {/* 車体（上が前） */}
        <rect x={128} y={110} width={44} height={80} rx={10} className={cx('stroke-2', danger ? 'fill-red-100 stroke-red-500 dark:fill-red-950' : 'fill-slate-100 stroke-slate-400 dark:fill-slate-800 dark:stroke-slate-500')} />
        <rect x={134} y={120} width={32} height={12} rx={3} className="fill-slate-400 dark:fill-slate-500" />
        <rect x={134} y={170} width={32} height={9} rx={3} className="fill-slate-300 dark:fill-slate-600" />
        {/* 前の超音波（車体の前の点。近いほど色が変わる） */}
        <circle cx={150} cy={106} r={4} fill={us == null ? 'none' : colorOf(us)} className={cx(us == null && 'stroke-slate-400')} />
      </svg>
      <div className={cx('text-xs font-semibold', !fresh ? 'text-slate-400' : danger ? 'text-red-600' : 'text-slate-500')}>{status}</div>
      {fresh && <div className="text-[11px] text-slate-400">前の超音波：{us == null ? '—（範囲外）' : `${us} cm`}・円弧は LiDAR</div>}
    </div>
  );
}
