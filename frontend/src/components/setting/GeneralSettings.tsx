import React, { useState } from 'react';

// 型定義
type ThemeOption = 'light' | 'dark' | 'system';
type LanguageOption = 'ja' | 'en' | 'zh';

export const GeneralSettings: React.FC = () => {
  // 設定状態（UI確認用のダミー状態）
  const [theme, setTheme] = useState<ThemeOption>('light');
  const [language, setLanguage] = useState<LanguageOption>('ja');

  // インラインスタイル
  const styles = {
    container: {
      padding: '8px',
      fontFamily: 'sans-serif',
      color: '#333',
    },
    section: {
      marginBottom: '20px',
    },
    sectionTitle: {
      fontSize: '16px',
      fontWeight: '600',
      marginBottom: '8px',
      borderBottom: '1px solid #ddd',
      paddingBottom: '4px',
    },
    row: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 0',
    },
    label: {
      fontSize: '14px',
    },
    select: {
      padding: '6px 10px',
      fontSize: '14px',
      borderRadius: '4px',
      border: '1px solid #ccc',
      backgroundColor: '#fff',
      cursor: 'pointer',
    },
  };

  return (
    <div style={styles.container}>
      {/* テーマ設定セクション */}
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>表示・テーマ</h3>
        <div style={styles.row}>
          <label style={styles.label} htmlFor="theme-select">
            テーマ
          </label>
          <select
            id="theme-select"
            value={theme}
            onChange={(e) => setTheme(e.target.value as ThemeOption)}
            style={styles.select}
          >
            <option value="light">ライトモード</option>
            <option value="dark">ダークモード</option>
            <option value="system">システム設定に従う</option>
          </select>
        </div>
      </section>

      {/* 言語設定セクション */}
      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>言語</h3>
        <div style={styles.row}>
          <label style={styles.label} htmlFor="language-select">
            表示言語
          </label>
          <select
            id="language-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value as LanguageOption)}
            style={styles.select}
          >
            <option value="ja">日本語</option>
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </div>
      </section>
    </div>
  );
};

export default GeneralSettings;