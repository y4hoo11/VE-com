/**
 * @file App.tsx
 * @description アプリケーションのエントリーコンポーネント。
 */

import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './pages/Login';
import { Control } from './pages/Control';
import { TaskOnly } from './pages/Task';
import { SettingCarousel } from './components/setting/SettingCarousel'; // 設定画面コンポーネントをインポート
import './App.css';

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // 下部ナビゲーションバーの開閉状態
  const [isNavOpen, setIsNavOpen] = useState(true);

  return (
    <div className="dashboard-container">
      {/* 簡易トップバー（ユーザー情報のみ） */}
      <header className="app-header">
        <h3>VE-com 管理システム</h3>
        <div className="user-info">
          <span>ログイン: <strong>{user?.username}</strong> ({user?.role})</span>
          <button type="button" onClick={logout} className="logout-button">
            ログアウト
          </button>
        </div>
      </header>

      {/* メイン画面エリア */}
      <main className="app-main">
        <Routes>
          <Route path="/control" element={<Control />} />
          <Route path="/tasks" element={<TaskOnly />} />
          <Route path="/settings" element={<SettingCarousel />} /> {/* 設定画面のルート定義を追加 */}
          <Route path="*" element={<Control />} />
        </Routes>
      </main>

      {/* ==================== 下部：可変ナビゲーションバー ==================== */}
      <div className="bottom-nav-wrapper">
        {/* 開閉トグルボタン */}
        <button
          type="button"
          onClick={() => setIsNavOpen(!isNavOpen)}
          className="nav-toggle-btn"
        >
          {isNavOpen ? '▼ 画面選択を閉じる' : '▲ 画面選択を開く'}
        </button>

        {/* 開閉するパネル本体 */}
        {isNavOpen && (
          <div className="nav-panel">
            <button
              type="button"
              onClick={() => navigate('/control')}
              className={`nav-btn ${location.pathname === '/control' ? 'active' : ''}`}
            >
              🎛️ コントロール画面
            </button>

            <button
              type="button"
              onClick={() => navigate('/tasks')}
              className={`nav-btn ${location.pathname === '/tasks' ? 'active' : ''}`}
            >
              📋 タスク表示専用
            </button>

            {/* タスク表示専用ボタンの下に追加した設定ボタン */}
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className={`nav-btn ${location.pathname === '/settings' ? 'active' : ''}`}
            >
              ⚙️ 設定
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ログイン状態に応じたルーティング切り替え
const AppRoutes: React.FC = () => {
  const { user } = useAuth();
  return user ? <Dashboard /> : <Login />;
};

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}