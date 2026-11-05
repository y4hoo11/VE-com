/**
 * @file App.tsx
 * @description アプリの入口。ログイン前はログイン画面、ログイン後は運行管理の画面を出す。
 */
import { useEffect } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './pages/Login';
import { cancelMapMode, closeDrawer, closeModal, closePop, endSession, estop, S, startSession, useStore } from './store/store';
import { AlertBanner, Header, PopoverHost, Toasts } from './components/Shell';
import { DrawerHost } from './components/Drawer';
import { ModalHost } from './components/Modals';
import { Monitor } from './pages/Monitor';
import { VehicleDetail } from './pages/VehicleDetail';
import { Tasks } from './pages/Tasks';
import { Logs } from './pages/Logs';
import { MapPage } from './pages/MapPage';
import { Settings } from './pages/Settings';

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}

// ログイン状態に合わせて、データの読み込みを始める・やめる
function Root() {
  const { user, logout } = useAuth();
  const s = useStore();

  useEffect(() => {
    if (user) startSession(user, logout);
    else endSession();
    // logout は毎回作り直されるので、ログインしている人が変わったときだけ動かす
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.username, user?.role]);

  // テーマ（ライト／ダーク）。ログイン画面にも効く（login-dark.css が html.dark を見る）
  useEffect(() => {
    document.documentElement.classList.toggle('dark', s.theme === 'dark');
  }, [s.theme]);

  return user ? <Main /> : <Login />;
}

function Main() {
  const s = useStore();

  // Esc は「いちばん手前のもの」から閉じる。車両詳細ページでは SPACE で緊急停止
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (S.popover) closePop();
        else if (S.mapMode) cancelMapMode();
        else if (S.modal) closeModal();
        else if (S.drawer) closeDrawer();
        return;
      }
      const m = window.location.hash.match(/^#\/vehicles\/([^/]+)/);
      const typing = (e.target as Element).closest('input, textarea, select, button');
      if (e.code === 'Space' && m && !e.repeat && !typing && !S.modal) {
        e.preventDefault();
        estop(decodeURIComponent(m[1]));
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <HashRouter>
      <div className="flex h-full flex-col bg-slate-100 text-slate-800 dark:bg-slate-950 dark:text-slate-100">
        <Header />
        <AlertBanner />
        <main className="relative min-h-0 flex-1 overflow-hidden">
          {/* ドロワーを開いている間はページを縮めて、ボタンが隠れないようにする */}
          <div className={`h-full transition-[padding] duration-200 ${s.drawer ? 'pr-[400px]' : ''}`}>
            <Routes>
              <Route path="/" element={<Monitor />} />
              <Route path="/vehicles/:id" element={<VehicleDetail />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/map" element={<MapPage />} />
              <Route path="/settings/:sub?" element={<Settings />} />
              <Route path="*" element={<Monitor />} />
            </Routes>
          </div>
          <DrawerHost />
        </main>
      </div>
      <ModalHost />
      <PopoverHost />
      <Toasts />
    </HashRouter>
  );
}
