import React, { useState, useRef } from 'react';
import './SettingForm.css'; // 共通デザインスタイル

// --- 型定義 ---
// ER図 (db_design.md) および Prisma 生成型に準拠したロール定義
export type RoleType = 'ADMIN' | 'OPERATOR' | 'VIEWER';

// ユーザー管理用テーブルの要素型
export interface UserItem {
  id: string;
  username: string;
  role: RoleType;
  lastLogin?: string;
}

export const UserManagement: React.FC = () => {
  // 1. システム登録済みユーザー一覧の状態管理（ダミーデータ）
  const [users, setUsers] = useState<UserItem[]>([
    { id: '1', username: 'admin_user', role: 'ADMIN', lastLogin: '2026-10-23 12:00' },
    { id: '2', username: 'operator_01', role: 'OPERATOR', lastLogin: '2026-10-22 18:30' },
    { id: '3', username: 'guest_viewer', role: 'VIEWER', lastLogin: '2026-10-20 09:15' },
  ]);

  // 2. ログイン中ユーザーのパスワード変更フォーム状態
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');     // バリデーションエラーメッセージ
  const [passwordSuccess, setPasswordSuccess] = useState(false); // 更新成功表示フラグ

  // 3. 一括設定保存の完了バナー状態
  const [isSaved, setIsSaved] = useState(false);

  // 4. ドラッグスクロール（パン操作）用の参照と座標状態
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  // --- ドラッグ制御イベントハンドラー ---
  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // フォーム入力やテーブルセルをクリックした場合はドラッグを発動させない
    if (['INPUT', 'SELECT', 'BUTTON', 'LABEL', 'TABLE', 'TD', 'TH'].includes(target.tagName)) return;
    if (!scrollRef.current) return;

    setIsDragging(true);
    setStartX(e.pageX - scrollRef.current.offsetLeft);
    setStartY(e.pageY - scrollRef.current.offsetTop);
    setScrollLeft(scrollRef.current.scrollLeft);
    setScrollTop(scrollRef.current.scrollTop);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollRef.current) return;
    e.preventDefault();

    const x = e.pageX - scrollRef.current.offsetLeft;
    const y = e.pageY - scrollRef.current.offsetTop;
    scrollRef.current.scrollLeft = scrollLeft - (x - startX) * 1.5;
    scrollRef.current.scrollTop = scrollTop - (y - startY) * 1.5;
  };

  // --- ログイン中アカウントのパスワード変更処理 ---
  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess(false);

    if (!currentPassword) {
      setPasswordError('現在のパスワードを入力してください');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('新しいパスワードは6文字以上で入力してください');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('新しいパスワードと確認用パスワードが一致しません');
      return;
    }

    // 更新成功処理（モック）
    console.log('パスワード更新リクエストを送信しました');
    setPasswordSuccess(true);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setTimeout(() => setPasswordSuccess(false), 3000);
  };

  // --- ユーザーロール（権限）の変更処理 ---
  const handleRoleChange = (id: string, role: RoleType) => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
    setIsSaved(false);
  };

  // --- ユーザーアカウントの無効化処理 ---
  const handleDeleteUser = (id: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== id));
    setIsSaved(false);
  };

  // --- 一括保存処理（モック） ---
  const handleSave = () => {
    console.log('ユーザー・権限設定を保存しました:', users);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div
      ref={scrollRef}
      className={`setting-scroll-wrapper ${isDragging ? 'is-dragging' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseLeave={() => setIsDragging(false)}
      onMouseUp={() => setIsDragging(false)}
      onMouseMove={handleMouseMove}
    >
      <div className="setting-container">
       
        <div className="setting-advice">
          ※管理者を想定した設計※
        </div>

        {/* --- セクション1: パスワードの変更 --- */}
        <section className="setting-section">
          <h3 className="setting-section-title">パスワードの変更（ログイン中のアカウント）</h3>
          <form onSubmit={handlePasswordChange}>
            <div className="setting-row">
              <label className="setting-label" htmlFor="current-password">
                現在のパスワード入力
              </label>
              <input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="setting-input-text"
                placeholder="現在のパスワード"
              />
            </div>

            <div className="setting-row">
              <label className="setting-label" htmlFor="new-password">
                新しいパスワード設定
                <span className="setting-sub-label">6文字以上で入力してください</span>
              </label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="setting-input-text"
                placeholder="新しいパスワード"
              />
            </div>

            <div className="setting-row">
              <label className="setting-label" htmlFor="confirm-password">
                新しいパスワード確認設定
                <span className="setting-sub-label">誤入力防止のため再度入力してください</span>
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="setting-input-text"
                placeholder="再入力"
              />
            </div>

            {/* バリデーションエラーメッセージ */}
            {passwordError && (
              <p style={{ color: '#dc3545', fontSize: '12px', marginTop: '8px', marginBottom: '0', textAlign: 'left' }}>
                ⚠️ {passwordError}
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
              {passwordSuccess && <span className="setting-success-badge">✓ パスワードを変更しました</span>}
              <button type="submit" className="setting-add-button" style={{ backgroundColor: '#1890ff' }}>
                パスワード更新
              </button>
            </div>
          </form>
        </section>

        {/* --- セクション2: ユーザー一覧 & ロール権限の設定 --- */}
        <section className="setting-section">
          <h3 className="setting-section-title">ユーザー一覧 & ロール権限の設定</h3>
          <p style={{ fontSize: '11px', color: '#666', margin: '0 0 12px 0', textAlign: 'left' }}>
            ※ システム設定（system_settings）の変更履歴には更新操作を行ったユーザーIDが自動適用されます。
          </p>
          <table className="setting-table">
            <thead>
              <tr>
                <th>ユーザー名</th>
                <th>ロール権限の設定</th>
                <th>最終ログイン</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td><strong>{user.username}</strong></td>
                  <td>
                    {/* ロール選択ドロップダウン（Prisma Role Enum 対応） */}
                    <select
                      value={user.role}
                      onChange={(e) => handleRoleChange(user.id, e.target.value as RoleType)}
                      className="setting-select"
                    >
                      <option value="ADMIN">管理者 (ADMIN) - 全操作可[cite: 15, 19]</option>
                      <option value="OPERATOR">作業者 (OPERATOR) - 運行操作可[cite: 15, 19]</option>
                      <option value="VIEWER">閲覧専用 (VIEWER) - 参照のみ[cite: 15, 19]</option>
                    </select>
                  </td>
                  <td>{user.lastLogin}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => handleDeleteUser(user.id)}
                      className="setting-delete-button"
                    >
                      無効化
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* 一括保存ボタン */}
        <div className="setting-button-container">
          {isSaved && <span className="setting-success-badge">✓ ユーザー権限設定を保存しました</span>}
          <button type="button" onClick={handleSave} className="setting-save-button">
            権限設定を保存
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserManagement;