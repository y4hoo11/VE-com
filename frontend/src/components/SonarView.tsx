// 物理センサー（アラウンドビュー）：車体のまわり 8 方向の障害物までの距離を、近いほど内側まで点く円弧で表す。
// もとは緊急制御画面（otyazuke さん作）にあった表示を、車両詳細ページ用の部品にしたもの。
//
// 距離は LiDAR で見えている物から作る（ラズパイの serial_bridge が 8 方向にまとめて agv/{id}/clearance で送る。
// 1秒に5回。車体の外形からの距離 [cm]、物が見えない方向は null）。docs/agv_protocol.md の 2-7。
// デモモードのときは、見た目を確かめるためのデモの値を動かす。
import { useEffect, useState } from 'react';
import { S, useClearance, useStore } from '../store/store';
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

const STALE_MS = 2000; // これより古い値は使わない（LiDAR や通信が止まったとき）

// 【仮】デモモードのときの値（1.4 秒ごとに変わる）
function useDemoSonar(active: boolean): SonarData | null {
  const random = () => Math.floor(Math.random() * 160) + 20;
  const make = (): SonarData => ({
    frontLeftCorner: random(),
    frontLeftCenter: random(),
    frontRightCenter: random(),
    frontRightCorner: random(),
    rearLeftCorner: random(),
    rearLeftCenter: random(),
    rearRightCenter: random(),
    rearRightCorner: random(),
  });
  const [data, setData] = useState<SonarData>(make);
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

// 届いた距離 → 表示に使う形。物が見えない方向（null）は「遠い」（Infinity）として消灯する
function toSonar(sectors: Record<string, number | null>): SonarData {
  const get = (k: keyof SonarData) => {
    const v = sectors[k];
    return typeof v === 'number' ? v : Infinity;
  };
  return {
    frontLeftCorner: get('frontLeftCorner'),
    frontLeftCenter: get('frontLeftCenter'),
    frontRightCenter: get('frontRightCenter'),
    frontRightCorner: get('frontRightCorner'),
    rearLeftCorner: get('rearLeftCorner'),
    rearLeftCenter: get('rearLeftCenter'),
    rearRightCenter: get('rearRightCenter'),
    rearRightCorner: get('rearRightCorner'),
  };
}

/** online = false（オフライン）のときと、LiDAR の値が届いていないときは消灯して理由を出す */
export function SonarView({ vehicleId, online }: { vehicleId: string; online: boolean }) {
  useStore(); // デモモードの切り替えに合わせて描き直す
  const demo = useDemoSonar(S.demo && online);
  const real = useClearance(vehicleId);
  // 値が古くなったら消灯できるよう、0.5 秒ごとに描き直す
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const fresh = online && real != null && now - real.at < STALE_MS;
  const sonar = S.demo ? demo : fresh ? toSonar(real.sectors) : null;
  const near = sonar ? Math.min(...Object.values(sonar)) : Infinity;
  const nearest = Number.isFinite(near) ? near : null;
  const danger = nearest != null && nearest < DANGER_CM;
  const status = !online
    ? 'データなし（オフライン）'
    : !sonar
      ? 'LiDAR のデータが届いていません'
      : danger
        ? `接近警告（いちばん近い所 ${nearest} cm）`
        : nearest != null
          ? `いちばん近い所 ${nearest} cm`
          : '近くに物はありません';

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
      <div className={cx('text-xs font-semibold', !sonar ? 'text-slate-400' : danger ? 'text-red-600' : 'text-slate-500')}>{status}</div>
    </div>
  );
}
