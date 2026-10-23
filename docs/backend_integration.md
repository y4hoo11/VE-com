# PC2（backend）に追加するもの

PC1・ラズパイとつなぐために、`backend/` に**少しだけ**足してください。
既存のトピック（`agv/{id}/command` `telemetry` `emergency`）はそのまま使えるので、**足さなくても走行はできます**。
ただ、次の2つは足さないと困ります。

| 追加 | 足さないとどうなるか |
|---|---|
| ① 緊急停止の「確認」ボタンで、車両にも解除を送る | Web で「確認」を押しても、車が止まったまま動かない |
| ② `agv/{id}/task`（タスクの進捗）を受け取る | タスクが ASSIGNED のまま、COMPLETED にならない |

---

## 0. 依存パッケージ（今の package.json に無いもの）

`backend/package.json` の dependencies に `mqtt` `socket.io` `dotenv` が入っていません
（ルートの node_modules にたまたま入っていれば動きますが、他の人の PC で動かないことがあります）。

```bash
cd backend
npm install mqtt socket.io dotenv
```

---

## ① 緊急停止の解除を車両に送る

`backend/src/services/socketService.ts` の `acknowledge_emergency` に1行足します。

```ts
      socket.on('acknowledge_emergency', async (data: { vehicleId: string }) => {
        // ★追加: 車両（ラズパイ・PC1）に解除を送る
        mqttService.sendVehicleCommand(data.vehicleId, { action: 'CLEAR_EMERGENCY' });

        await prisma.vehicle.update({
          ...（既存のまま）
```

あわせて、進捗を画面に送るメソッドも足します（②で使います）。

```ts
  // ★追加: タスクの進捗をフロントエンドへ
  broadcastTaskProgress(payload: { taskId: string; vehicleId: string; status: string; phase?: string; progress?: number; message?: string }) {
    if (this.io) {
      this.io.emit('task:progress', payload);
    }
  }
```

---

## ② タスクの進捗を受け取る

### 新しいファイル `backend/src/services/taskProgressService.ts`

```ts
// taskProgressService.ts
// PC1 から届く agv/{id}/task を DB（tasks / task_histories / vehicle_logs）に反映する
import { prisma } from '../config/database';
import { socketService } from './socketService';
import { TaskStatus, LogLevel } from '@prisma/client';

type TaskProgressMessage = {
  taskId?: string;
  status?: string;     // IN_PROGRESS / COMPLETED / FAILED / CANCELLED
  phase?: string;      // TO_START / LOADING / TO_TARGET / UNLOADING
  progress?: number;   // 0〜100
  message?: string;
};

const lastState = new Map<string, string>(); // taskId → "status:phase"（同じ内容を何度も記録しないため）

class TaskProgressService {
  async handle(vehicleId: string, msg: TaskProgressMessage) {
    if (!msg.taskId) return;
    const valid = Object.values(TaskStatus) as string[];
    const status = valid.includes(msg.status ?? '') ? (msg.status as TaskStatus) : TaskStatus.IN_PROGRESS;

    const task = await prisma.task.findUnique({ where: { id: msg.taskId } });
    if (!task) return; // DB に無いタスク（テストツールから送ったもの等）は無視

    // 画面には毎回（進捗バー用）
    socketService.broadcastTaskProgress({ taskId: task.id, vehicleId, status, phase: msg.phase, progress: msg.progress, message: msg.message });

    const key = `${status}:${msg.phase ?? ''}`;
    if (lastState.get(task.id) === key) return; // 状態が変わったときだけ DB に書く
    lastState.set(task.id, key);

    const finished = status === TaskStatus.COMPLETED || status === TaskStatus.FAILED || status === TaskStatus.CANCELLED;
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status,
        ...(status === TaskStatus.IN_PROGRESS && !task.startedAt ? { startedAt: new Date() } : {}),
        ...(finished ? { completedAt: new Date() } : {}),
      },
    });
    await prisma.taskHistory.create({
      data: { taskId: task.id, status, note: `[${msg.phase ?? ''}] ${msg.message ?? ''}` },
    });

    const level = status === TaskStatus.FAILED ? LogLevel.ERROR : LogLevel.INFO;
    const log = await prisma.vehicleLog.create({
      data: { vehicleId, logLevel: level, message: `${task.title}: ${msg.message ?? status}`, details: JSON.parse(JSON.stringify(msg)) },
    });
    socketService.broadcastLog({
      id: log.id.toString(), vehicleId, level, message: log.message, timestamp: log.timestamp.toISOString(),
    });

    if (finished) lastState.delete(task.id);
  }
}

export const taskProgressService = new TaskProgressService();
```

### `backend/src/services/mqttService.ts` に追加

```ts
import { taskProgressService } from './taskProgressService';   // ★追加

  init() {
    // ★ 'agv/+/task' を追加
    mqttClient.subscribe(['agv/+/telemetry', 'agv/+/emergency', 'agv/+/task'], (err) => {
    ...
        } else if (topic.endsWith('/task')) {          // ★追加（emergency の else if の後ろに）
          await taskProgressService.handle(agvId, message);
        }
```

---

## ③（任意）マップに現在地・経路を描く

- 現在地: すでに `vehicle:update` で `currentX` / `currentY` / `currentTheta`（m, rad）が届いています。
  `FactoryMap.tsx` で描くときは、地図の画素に変換します（demo_map: 解像度 0.05, 原点 (-5,-5), 200x200px）。

  ```ts
  const px = (x - originX) / resolution;
  const py = heightPx - (y - originY) / resolution;   // 画像は上が 0 なので反転
  ```

- 計画した経路: PC1 が `agv/{id}/path` に `{"points":[[x,y],...],"goal":{...}}` を送っています。
  表示したい場合は mqttService で購読して `socketService` から `vehicle:path` などで流してください。

- カメラ映像（マーカー解析つき）: `<img src="http://<PC1のIP>:5000/video" />` で表示できます
  （PC1 の marker_localizer が配信。1台につき1つ。複数台のときはポートを分ける）。

---

## 気づいた点（既存コード）

- `mqttService.ts` の emergency 受信で `prisma.vehicle.update` を使っていますが、
  まだ DB に無い車両 ID だとエラーになります。`upsert` にするか、先に telemetry が届くのを待つ形にすると安全です。
- `seed.ts` の地点名（`A13` → `2`）は PC1 の `waypoints.yaml` に登録済みです（`2` は Station-2 の別名）。
  TaskPanel の既定値 `Dock-A` → `Station-1` も登録済みです。
