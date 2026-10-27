/**
 * @file FactoryMap.tsx
 * @description 工場内の2Dマップおよび稼働中の車両数・配置を表示するコンポーネント。
 */

import React, { useEffect, useRef, useState } from 'react';
import type { Vehicle } from '../../types';
import styles from '../../styles/FactoryMap.module.css';
// 表示する地図（倉庫レイアウト 16m x 10m。元データと作り直し用スクリプトは map/ フォルダ）
import mapPgmUrl from './warehouse_map.pgm?url';

type FactoryMapProps = {
  vehicles: Vehicle[];
};

export const FactoryMap: React.FC<FactoryMapProps> = ({ vehicles }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [debugMsg, setDebugMsg] = useState<string>('');

  useEffect(() => {
    const loadMap = async () => {
      try {
        const pgmRes = await fetch(mapPgmUrl);
        if (!pgmRes.ok) throw new Error(`HTTP Error ${pgmRes.status}`);

        // P5(バイナリ)対応のため ArrayBuffer として取得
        const arrayBuffer = await pgmRes.arrayBuffer();
        const byteArray = new Uint8Array(arrayBuffer);

        // ヘッダー情報の解析（テキスト部分を取り出す）
        let headerText = '';
        let headerOffset = 0;
        let newlinesCount = 0;

        // PGMのヘッダー（マジックナンバー、幅、高さ、最大値）を取得
        while (headerOffset < byteArray.length && newlinesCount < 3) {
          const char = String.fromCharCode(byteArray[headerOffset]);
          headerText += char;
          if (char === '\n') {
            // コメント行（#）はカウントしない
            if (!headerText.trim().split('\n').pop()?.startsWith('#')) {
              newlinesCount++;
            }
          }
          headerOffset++;
        }

        // コメント行を除外してトークン化
        const tokens = headerText
          .replace(/#.*/g, '')
          .trim()
          .split(/\s+/);

        const magicNumber = tokens[0];
        if (magicNumber !== 'P5' && magicNumber !== 'P2') {
          throw new Error(`未対応の形式です: ${magicNumber}`);
        }

        const width = parseInt(tokens[1], 10);
        const height = parseInt(tokens[2], 10);
        const maxValue = parseInt(tokens[3], 10);

        setDebugMsg(`${magicNumber} 形式 | ${width}x${height}`);

        // ピクセルデータの開始位置を取得
        // ヘッダー直後の改行コード分のオフセット調整
        let dataOffset = headerText.length;

        // ピクセル配列の抽出
        let pixelValues: Uint8Array | number[];
        if (magicNumber === 'P5') {
          // バイナリデータの読み込み
          pixelValues = byteArray.subarray(dataOffset, dataOffset + width * height);
        } else {
          // P2 テキストデータの読み込み
          const textDecoder = new TextDecoder();
          const textData = textDecoder.decode(byteArray.subarray(dataOffset));
          pixelValues = textData.trim().split(/\s+/).map((v) => parseInt(v, 10));
        }

        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const imgData = ctx.createImageData(width, height);
        for (let i = 0; i < width * height; i++) {
          const rawVal = pixelValues[i] ?? 0;
          const val = Math.floor((rawVal / maxValue) * 255);
          const idx = i * 4;
          imgData.data[idx] = val;     // R
          imgData.data[idx + 1] = val; // G
          imgData.data[idx + 2] = val; // B
          imgData.data[idx + 3] = 255; // Alpha
        }

        ctx.putImageData(imgData, 0, 0);
        setLoading(false);
      } catch (err: any) {
        console.error('マップ読み込みエラー:', err);
        setDebugMsg(`エラー: ${err.message}`);
        setLoading(false);
      }
    };

    loadMap();
  }, []);

  return (
    <div
      className={styles.mapContainer}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, padding: '8px', boxSizing: 'border-box' }}
    >
      <p className={styles.mapText}>
        🗺️ 2Dマップエリア - 稼働車両数: {vehicles.length}台
      </p>

      <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
        {loading ? 'マップ画像を読み込み中...' : debugMsg}
      </div>

      {/* 地図の縦横比を保ったまま、空いている場所いっぱいに表示する */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            imageRendering: 'pixelated',
          }}
        />
      </div>
    </div>
  );
};