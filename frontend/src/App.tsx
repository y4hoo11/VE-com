/**
 * @file App.tsx
 * @description アプリケーションのエントリーコンポーネント。
 */

import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { EmergencyPage } from './pages/EmergencyPage';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './pages/Login';
import { Control } from './pages/Control';
import { TaskOnly } from './pages/Task';
import { SettingCarousel } from './components/setting/SettingCarousel';
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

      {/* ★開閉ボタン（左上のサイドボタンの下に配置） */}
      {/* 開閉ボタン（サイドボタンの下） */}
<button
  type="button"
  className="nav-side-toggle"
  onClick={() => setIsNavOpen(!isNavOpen)}
  aria-expanded={isNavOpen}
>
  {isNavOpen ? '閉じる' : '画面選択'}
</button>
      {/* メイン画面エリア */}
      <main className="app-main">
        <Routes>
          <Route path="/control" element={<Control />} />
          <Route path="/tasks" element={<TaskOnly />} />
          <Route path="/settings" element={<SettingCarousel />} /> {/* 設定画面のルート定義 */}
          
          {/* ★追加：緊急制御画面へのルーティング定義 */}
          {/* URLの車両IDから実際の車両情報を取得して表示する */}
          <Route path="/emergency/:id" element={<EmergencyPage />} />

          <Route path="*" element={<Control />} />
        </Routes>
      </main>

      {/* ==================== 下部：ナビゲーションバー ==================== */}
      <div className="bottom-nav-wrapper">
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

            <button
              type="button"
              onClick={() => navigate('/settings')}
              className={`nav-btn ${location.pathname === '/settings' ? 'active' : '' }`}
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
