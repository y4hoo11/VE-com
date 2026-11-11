import React, { useEffect, useRef, useState } from 'react';

const TUNA_RATE = 1 / 50;   // マグロを載せる確率（1周ごとに抽選）。確認するときは 1 にする
const LAP_SECONDS = 24;     // 1周の秒数

/** 1台分の AGV。1周するたびにマグロを載せるか抽選する。 */
const AgvCar: React.FC<{ begin: number }> = ({ begin }) => {
  const [hasTuna, setHasTuna] = useState(() => Math.random() < TUNA_RATE);
  const motionRef = useRef<SVGElement>(null);

  useEffect(() => {
    const el = motionRef.current;
    if (!el) return;
    // アニメーションが1周して最初に戻るたびに抽選し直す
    const onRepeat = () => setHasTuna(Math.random() < TUNA_RATE);
    el.addEventListener('repeatEvent', onRepeat);
    return () => el.removeEventListener('repeatEvent', onRepeat);
  }, []);

  return (
    <g>
      <use href="#agv" />
      {hasTuna && <use href="#tuna" />}
      <animateMotion
        ref={motionRef}
        dur={`${LAP_SECONDS}s`}
        begin={`${begin}s`}
        repeatCount="indefinite"
        rotate="auto"
      >
        <mpath href="#agv-route" />
      </animateMotion>
    </g>
  );
};

/** ログイン画面の背景を走る AGV（SVG アニメーション）。装飾専用。 */
export const LoginBackground: React.FC = () => (
  <svg
    className="login-background"
    style={{
      position: 'absolute',
      left: '50%',
      bottom: 0,
      width: 1280,
      height: 800,
      transform: 'translateX(-50%)',
      overflow: 'visible',
      pointerEvents: 'none',
    }}
    viewBox="0 0 1280 800"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="agv-beam" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.4" />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>

      {/* AGV 本体（原点が中心、前方が +x 方向） */}
      <g id="agv">
        <polygon points="36,-10 74,-24 74,24 36,10" fill="url(#agv-beam)" />
        <rect x="-26" y="-22" width="12" height="5" rx="1.5" fill="#1b1c20" />
        <rect x="14" y="-22" width="12" height="5" rx="1.5" fill="#1b1c20" />
        <rect x="-26" y="17" width="12" height="5" rx="1.5" fill="#1b1c20" />
        <rect x="14" y="17" width="12" height="5" rx="1.5" fill="#1b1c20" />
        <rect x="-36" y="-16" width="72" height="32" rx="8" fill="#3a3d45" stroke="#4d505a" strokeWidth="1.5" />
        <rect x="-27" y="-11" width="40" height="22" rx="4" fill="#2b2d33" stroke="#4d505a" />
        <rect x="30" y="-12" width="5" height="24" rx="2" fill="#6fcf43" />
        <circle cx="22" cy="0" r="2.5" fill="#6fcf43" />
      </g>

      {/* マグロ寿司（荷台に載る。頭が前方 +x） */}
<g id="tuna">
  <rect x="-26" y="-8" width="38" height="16" rx="7" fill="#f3efe6" />
  <rect x="-23" y="-9.5" width="32" height="19" rx="8" fill="#d6454f" />
  <path d="M -18 -4 C -10 -6 0 -6 6 -3" stroke="#f08a90" strokeWidth="1.2" fill="none" />
  <path d="M -18 3 C -10 1 0 1 6 4" stroke="#f08a90" strokeWidth="1.2" fill="none" />
</g>
    </defs>

    {/* 走行ライン */}
    <path
      id="agv-route"
      d="M -1200 700 H 300 C 380 700 400 740 480 740 H 800 C 880 740 900 700 980 700 H 2480"
      fill="none"
      stroke="#6fcf43"
      strokeOpacity="0.22"
      strokeWidth="4"
    />

    {/* 3 台を等間隔にずらして走らせる */}
    <g opacity="12">
      {[0, -8, -16].map((begin) => (
        <AgvCar key={begin} begin={begin} />
      ))}
    </g>
  </svg>
);