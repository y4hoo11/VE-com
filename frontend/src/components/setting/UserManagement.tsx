import React from 'react';

export const UserManagement: React.FC = () => {
  return (
    <div>
      <h3 style={{ borderBottom: '1px solid #ddd', paddingBottom: '8px' }}>
        ユーザー・権限管理
      </h3>
      <p style={{ color: '#666' }}>
        操作ユーザーの追加・削除、およびロール（管理者/作業者）ごとのアクセス権限設定を行います。
      </p>
      <ul>
        <li>ユーザー一覧・新規登録</li>
        <li>ロール・アクセス権限割り当て</li>
        <li>パスワード変更・リセット</li>
      </ul>
    </div>
  );
};

export default UserManagement;