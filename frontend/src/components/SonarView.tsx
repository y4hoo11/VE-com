// 物理センサー（アラウンドビュー）：車体のまわり 8 方向の距離を、近いほど内側まで点く円弧で表す。
// もとは緊急制御画面（otyazuke さん作）にあった表示を、車両詳細ページ用の部品にしたもの。
//
// 【仮】実機のセンサーの値はまだ Web に届いていないので、いまは見た目を確かめるためのデモの値を動かしている。
// 実データが届くようになったら、useDemoSonar を telemetry の値に置き換える。
import { useEffect, useState } from 'react';
import { cx } from './uiUtils';

// 8 方向の距離 [cm]
export type SonarData = {
  frontLeftCorner: number;
  frontLeftCenter: number;
  frontRightCenter: number;
  frontRightCorner: number;
  rearLeftCorner: number;
  rearLeftCenter: number;
  rearRightCenter: number;
  rearRightCorner: number;
};

const DANGER_CM = 40; // これより近いと「接近警告」（赤）
const CAUTION_CM = 70; // これより近いと注意（黄）

// 各方向の円弧を描く角度（真上 = 前が 0°、時計回り）
const SECTORS: [keyof SonarData, number, number][] = [
  ['frontLeftCorner', -65, -35],
  ['frontLeftCenter', -30, -5],
  ['frontRightCenter', 5, 30],
  ['frontRightCorner', 35, 65],
  ['rearRightCorner', 115, 145],
  ['rearRightCenter', 150, 175],
  ['rearLeftCenter', -175, -150],
  ['rearLeftCorner', -145, -115],
];

// 距離 → 点ける円弧の本数（0 = 消灯、4 = いちばん近い）
const levelOf = (cm: number) => (cm < DANGER_CM ? 4 : cm < CAUTION_CM ? 3 : cm < 100 ? 2 : cm < 140 ? 1 : 0);
const colorOf = (cm: number) => (cm < DANGER_CM ? '#ef4444' : cm < CAUTION_CM ? '#f59e0b' : '#38bdf8');

// 中心 (150,150)・半径 r で、角度 a0〜a1 の円弧
function arc(r: number, a0: number, a1: number) {
  const pt = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(150 + r * Math.cos(rad)).toFixed(1)} ${(150 + r * Math.sin(rad)).toFixed(1)}`;
  };
  return `M ${pt(a0)} A ${r} ${r} 0 0 1 ${pt(a1)}`;
}

// 【仮】デモの値（1.4 秒ごとに変わる）
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
    if (!active) return;
    const t = setInterval(() => setData(make()), 1400);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return active ? data : null;
}

/** online = false（オフライン）のときは消灯して「データなし」と出す */
export function SonarView({ online }: { online: boolean }) {
  const sonar = useDemoSonar(online);
  const nearest = sonar ? Math.min(...Object.values(sonar)) : null;
  const danger = nearest != null && nearest < DANGER_CM;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-3">
      <svg viewBox="30 30 240 240" className="w-full max-w-[280px] flex-1" role="img" aria-label="車体のまわりのセンサー表示">
        {/* 消灯している円弧（ガイド） */}
        <g fill="none" strokeWidth={6} strokeLinecap="round" className="stroke-slate-200 dark:stroke-slate-700">
          {SECTORS.map(([key, a0, a1]) => [0, 1, 2, 3].map((i) => <path key={key + i} d={arc(65 + i * 10, a0, a1)} />))}
        </g>
        {/* 点いている円弧（近いほど内側まで点く） */}
        {sonar && (
          <g fill="none" strokeWidth={6} strokeLinecap="round">
            {SECTORS.map(([key, a0, a1]) => {
              const cm = sonar[key];
              const level = levelOf(cm);
              return [0, 1, 2, 3].map((i) =>
                level >= 4 - i ? <path key={key + i} d={arc(65 + i * 10, a0, a1)} stroke={colorOf(cm)} className={cx(cm < DANGER_CM && i === 0 && 'animate-pulse')} /> : null,
              );
            })}
          </g>
        )}
        {/* 車体（上が前） */}
        <rect x={128} y={110} width={44} height={80} rx={10} className={cx('stroke-2', danger ? 'fill-red-100 stroke-red-500 dark:fill-red-950' : 'fill-slate-100 stroke-slate-400 dark:fill-slate-800 dark:stroke-slate-500')} />
        <rect x={134} y={120} width={32} height={12} rx={3} className="fill-slate-400 dark:fill-slate-500" />
        <rect x={134} y={170} width={32} height={9} rx={3} className="fill-slate-300 dark:fill-slate-600" />
        <text x={150} y={104} textAnchor="middle" fontSize={11} className="fill-slate-400">
          前
        </text>
      </svg>
      <div className={cx('text-xs font-semibold', !sonar ? 'text-slate-400' : danger ? 'text-red-600' : 'text-slate-500')}>
        {!sonar ? 'データなし（オフライン）' : danger ? `接近警告（いちばん近い所 ${nearest} cm）` : `いちばん近い所 ${nearest} cm`}
      </div>
    </div>
  );
}
