import React, { useState } from 'react';
import { GeneralSettings } from './GeneralSettings';
import { AGVSettings } from './AGVSettings';
import { SystemSettings } from './SystemSettings';
import { UserManagement } from './UserManagement';

export const SettingCarousel: React.FC = () => {
  const [currentIndex, setCurrentIndex] = useState(0);

  // 表示する設定画面のリスト定義
  const slides = [
    { id: 'general', title: '基本設定', component: <GeneralSettings /> },
    { id: 'agv', title: 'AGV・運行パラメータ設定', component: <AGVSettings /> },
    { id: 'system', title: '通信・MQTT/DB接続設定', component: <SystemSettings /> },
    { id: 'user', title: 'ユーザー・権限管理', component: <UserManagement /> },
  ];

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev === 0 ? slides.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev === slides.length - 1 ? 0 : prev + 1));
  };

  const styles = {
    container: {
      maxWidth: '700px',
      margin: '0 auto',
      padding: '20px',
      position: 'relative' as const,
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '20px',
      borderBottom: '2px solid #ccc',
      paddingBottom: '10px',
    },
    title: {
      fontSize: '20px',
      fontWeight: 'bold',
      margin: 0,
    },
    navButton: {
      padding: '8px 16px',
      fontSize: '14px',
      cursor: 'pointer',
      backgroundColor: '#007bff',
      color: '#fff',
      border: 'none',
      borderRadius: '4px',
    },
    contentArea: {
      minHeight: '300px',
      padding: '20px',
      backgroundColor: '#f9f9f9',
      borderRadius: '8px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    },
    indicatorContainer: {
      display: 'flex',
      justifyContent: 'center',
      gap: '8px',
      marginTop: '16px',
    },
    dot: (active: boolean) => ({
      width: '12px',
      height: '12px',
      borderRadius: '50%',
      backgroundColor: active ? '#007bff' : '#ccc',
      cursor: 'pointer',
    }),
  };

  return (
    <div style={styles.container}>
      {/* 上部ヘッダー & ナビゲーションボタン */}
      <div style={styles.header}>
        <button type="button" onClick={handlePrev} style={styles.navButton}>
          ◀ 前へ
        </button>
        <h2 style={styles.title}>
          [{currentIndex + 1} / {slides.length}] {slides[currentIndex].title}
        </h2>
        <button type="button" onClick={handleNext} style={styles.navButton}>
          次へ ▶
        </button>
      </div>

      {/* スライド本体表示エリア */}
      <div style={styles.contentArea}>
        {slides[currentIndex].component}
      </div>

      {/* ドットインジケーター（直接クリック移動可能） */}
      <div style={styles.indicatorContainer}>
        {slides.map((slide, idx) => (
          <div
            key={slide.id}
            style={styles.dot(idx === currentIndex)}
            onClick={() => setCurrentIndex(idx)}
            title={slide.title}
          />
        ))}
      </div>
    </div>
  );
};

export default SettingCarousel;