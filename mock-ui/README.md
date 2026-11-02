# mock-ui — フロントエンド全面改修の画面モック

バックエンドなしで動く画面モックです（React + Vite + Tailwind CSS）。
車両の動き・タスクの進捗・異常は `src/mock/store.ts` の中で疑似的に作っています。
PC の画面（横 1280px 以上）だけを想定しています。

```bash
cd mock-ui
npm install
npm run dev      # http://localhost:5180
```

ログインは何を入力しても通ります。左下の「🧪 モック操作」から、障害物での停止・自己位置の喪失・
通信断・MQTT 切断を起こせます。右上の 👤 から権限（ADMIN / OPERATOR / VIEWER）を切り替えられます。

## 画面の構成

| 種類 | 中身 |
|---|---|
| ページ | ログイン / 運行モニター `#/` / 車両詳細 `#/vehicles/:id` / タスク `#/tasks` / 記録 `#/logs` / 地図・地点 `#/map` / 設定 `#/settings/:sub` |
| ドロワー（右から出るパネル） | 車両（状態・操作）/ タスク詳細（状態の変化）/ ログ詳細 |
| モーダル | タスク作成 → そのまま車両の割り当て / 割り当て / パスワード変更 / ユーザー・車両の追加と編集 / 確認ダイアログ |
| ポップオーバー | 地図上の車両・地点 / 通知 🔔 / 接続状態 / ユーザーメニュー |
| 地図の操作モード | 移動先の指定（GOTO）/ 現在地の設定（SET_POSE：位置 → 向きの順にクリック） |
| トースト | 操作の結果 |

## 安全まわりの決めごと

- 「全車停止」と各車両の緊急停止は確認なしで、押したらすぐ送る。VIEWER でも押せる
- ヘッダーと異常のお知らせ帯は、モーダルを開いていても前面に出ていて押せる
- 解除は確認ダイアログで「周りの安全を確認した」にチェックしないと押せない
- 解除の操作が必要な異常（Web緊急停止・車体の非常停止ボタン）と、原因がなくなれば自動で戻る異常（障害物など）で表示を分ける
- モーダルは重ねない（タスク作成 → 割り当ては同じ枠の中身を切り替える）
- モーダルを開いている間に起きた異常は、モーダルの中にも表示する
- 車両詳細ページでは SPACE キーで緊急停止

## 本番化するときに置き換えるところ

`src/mock/store.ts` の各関数が、本番では次のものになります。

- `estop` / `clearEmergency` → Socket.IO の `manual_emergency_stop` / `acknowledge_emergency`（既存）
- `startTask` / `createTask` / `cancelTask` / `updateTask` → `POST /tasks/assign` / `POST /tasks` / `DELETE /tasks/:id` / `PATCH /tasks/:id`（既存）
- `pause` / `resume` / `doGoto` / `askHome` / `mapModeClick`(SET_POSE) / `confirmLoad` / `stopAll` → **バックエンドに追加が必要**（docs/agv_protocol.md 2-1 の命令を送る API）
- タスクの進捗・経路の表示 → **バックエンドに追加が必要**（`agv/{id}/task`・`agv/{id}/path` の受信と Socket.IO への転送。docs/backend_integration.md）
- ユーザー管理・設定の保存 → **API が無いので追加が必要**
- `startSim`（シミュレーション）→ Socket.IO の `vehicle:update` / `log:new` / `tasks:changed` の受信
