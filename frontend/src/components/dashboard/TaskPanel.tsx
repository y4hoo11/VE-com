/**
 * @file TaskPanel.tsx
 * @description バックエンドDBと連携するタスク表示・管理パネルコンポーネント。
 */

import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import styles from '../../styles/TaskPanel.module.css';

export interface TaskItem {
  id: string;
  title: string;
  startLocation?: string;
  targetLocation?: string;
  quantity?: number;
  priority: number;
  status: string;
  scheduledAt?: string;
  createdByUserId?: string;
  createdAt: string;
}

type PanelMode = 'normal' | 'add' | 'delete';

export const TaskPanel: React.FC = () => {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [iconPosition, setIconPosition] = useState<'top' | 'bottom'>('top');
  const [mode, setMode] = useState<PanelMode>('normal');
  const [showSettings, setShowSettings] = useState<boolean>(false);

  // フォーム用ステート
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskQuantity, setNewTaskQuantity] = useState<number>(1);
  const [newTaskPriority, setNewTaskPriority] = useState<number>(1);
  const [newTaskDueDate, setNewTaskDueDate] = useState('');

  // ログインユーザーID（認証機能やコンテキスト等から取得するイメージです）
  const currentUserId = 'usr-001'; 

  // データベースからタスク一覧を取得 (GET)
  const fetchTasks = async () => {
    try {
      const response = await api.get<TaskItem[]>('/tasks');
      setTasks(response.data);
    } catch (error) {
      console.error('タスクの取得に失敗しました:', error);
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, []);

  // 追加処理 (POST)
  const handleCreateTask = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newTaskName.trim()) return;

    try {
      await api.post('/tasks', {
        title: newTaskName,
        startLocation: 'Dock-A',
        targetLocation: 'Station-1',
        priority: newTaskPriority,
        scheduledAt: newTaskDueDate ? new Date(newTaskDueDate).toISOString() : null, // 期限
        createdByUserId: currentUserId, // 実行ユーザーID
      });

      // フォームリセット
      setNewTaskName('');
      setNewTaskQuantity(1);
      setNewTaskPriority(1);
      setNewTaskDueDate('');
      setMode('normal');
      fetchTasks();
    } catch (error) {
      console.error('タスクの作成に失敗しました:', error);
      alert('タスクの保存に失敗しました');
    }
  };

  // 削除処理 (DELETE)
  const handleDeleteTask = async (id: string) => {
    if (!window.confirm('本当にこのタスクを削除しますか？')) return;

    try {
      // 削除実行ユーザーをクエリパラメータやリクエストデータ等で送信
      await api.delete(`/tasks/${id}`, {
        data: { userId: currentUserId },
      });
      fetchTasks();
    } catch (error) {
      console.error('タスクの削除に失敗しました:', error);
      alert('タスクの削除に失敗しました');
    }
  };

  return (
    <div
      className={`${styles.container} ${
        iconPosition === 'top' ? styles.positionTop : styles.positionBottom
      }`}
    >
      {/* アイコンバー */}
      <div
        className={`${styles.iconBar} ${
          iconPosition === 'bottom' ? styles.iconBarBottom : styles.iconBarTop
        }`}
      >
        <button
          type="button"
          onClick={() => setShowSettings(!showSettings)}
          title="設定"
          className={styles.iconButton}
        >
          ⚙️
        </button>
        <span title="アナウンス" className={styles.iconButton}>📢</span>
        <span title="通知" className={styles.iconButton}>🔔</span>
        <span className={styles.iconText}>その他</span>

        {mode === 'add' && (
          <span className={`${styles.modeBadge} ${styles.badgeAdd}`}>追加モード</span>
        )}
        {mode === 'delete' && (
          <span className={`${styles.modeBadge} ${styles.badgeDelete}`}>削除モード</span>
        )}
      </div>

      {/* 設定モーダル */}
      {showSettings && (
        <div
          className={`${styles.settingsModal} ${
            iconPosition === 'top' ? styles.settingsModalTop : styles.settingsModalBottom
          }`}
        >
          <div className={styles.settingsHeader}>⚙️ パネル設定</div>

          <div className={styles.settingGroup}>
            <label className={styles.settingLabel}>アイコン配置位置:</label>
            <select
              value={iconPosition}
              onChange={(e) => setIconPosition(e.target.value as 'top' | 'bottom')}
              className={styles.settingSelect}
            >
              <option value="top">上部（デフォルト）</option>
              <option value="bottom">下部</option>
            </select>
          </div>

          <div className={styles.settingGroup}>
            <label className={styles.settingLabel}>操作モード選択:</label>
            <div className={styles.radioGroup}>
              <label className={styles.radioOption}>
                <input
                  type="radio"
                  name="panelMode"
                  value="normal"
                  checked={mode === 'normal'}
                  onChange={() => setMode('normal')}
                />
                通常（閲覧のみ）
              </label>

              <label className={styles.radioOption}>
                <input
                  type="radio"
                  name="panelMode"
                  value="add"
                  checked={mode === 'add'}
                  onChange={() => setMode('add')}
                />
                ➕ 追加モード
              </label>

              <label className={styles.radioOption}>
                <input
                  type="radio"
                  name="panelMode"
                  value="delete"
                  checked={mode === 'delete'}
                  onChange={() => setMode('delete')}
                />
                🗑️ 削除モード
              </label>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowSettings(false)}
            className={styles.closeButton}
          >
            閉じる
          </button>
        </div>
      )}

      {/* メイン表示エリア */}
      <div className={styles.mainContent}>
        <h3 className={styles.title}>タスク管理 (DB連携)</h3>

        {/* 追加モード */}
        {mode === 'add' && (
          <form onSubmit={handleCreateTask} className={styles.addForm}>
            <div className={styles.formRow}>
              <input
                type="text"
                placeholder="タスク名"
                value={newTaskName}
                onChange={(e) => setNewTaskName(e.target.value)}
                className={styles.inputTask}
              />
              <div className={styles.quantityInputGroup}>
                <input
                  type="number"
                  placeholder="個数"
                  value={newTaskQuantity}
                  min={1}
                  onChange={(e) => setNewTaskQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className={styles.inputQuantity}
                />
                <span className={styles.unitText}>個</span>
              </div>
            </div>

            <div className={styles.formMetaRow}>
              <label className={styles.metaLabel}>優先度:</label>
              <input
                type="number"
                value={newTaskPriority}
                min={1}
                max={5}
                onChange={(e) => setNewTaskPriority(Number(e.target.value))}
                className={styles.inputPriority}
              />
              <label className={styles.metaLabelRight}>期限:</label>
              <input
                type="date"
                value={newTaskDueDate}
                onChange={(e) => setNewTaskDueDate(e.target.value)}
                className={styles.inputDate}
              />
            </div>

            <button type="submit" className={styles.addButton}>
              データベースにタスクを追加
            </button>
          </form>
        )}

        {/* タスクリスト */}
        <div className={styles.taskList}>
          {tasks.map((t) => (
            <div key={t.id} className={styles.taskItem}>
              <div>
                <div className={styles.taskTitle}>
                  {t.title} <span className={styles.taskCode}>(ID: {t.id.slice(0, 6)})</span>
                </div>
                <div className={styles.taskMeta}>
                  <span>ステータス: {t.status}</span>
                  {t.priority && <span>優先度: {t.priority}</span>}
                  {t.scheduledAt && (
                    <span>期限: {new Date(t.scheduledAt).toLocaleDateString()}</span>
                  )}
                </div>
              </div>

              {/* 削除モード */}
              {mode === 'delete' && (
                <button
                  type="button"
                  onClick={() => handleDeleteTask(t.id)}
                  className={styles.deleteButton}
                  title="タスクを削除"
                >
                  ✕ 削除
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};