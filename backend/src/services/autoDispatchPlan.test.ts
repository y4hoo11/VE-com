// services/autoDispatchPlan.test.ts（npm test -w backend）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VehicleStatus } from '@prisma/client';
import { planAssignments, vehicleBlocker, type PlanContext, type PlanTask, type PlanVehicle } from './autoDispatchPlan';

const NOW = new Date('2026-11-26T10:00:00Z');
const POINTS: Record<string, { x: number; y: number }> = {
  'Dock-A': { x: 0, y: 0 },
  'Dock-B': { x: 10, y: 0 },
  'Station-1': { x: 5, y: 5 },
};

const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  now: NOW,
  battMin: 20,
  battWarn: 30,
  activeMapId: 'demo_map',
  busyVehicleIds: new Set(),
  manualVehicleIds: new Set(),
  emergencyVehicleIds: new Set(),
  movingVehicleIds: new Set(),
  heartbeatMaxAgeMs: 3000,
  resolve: (n) => (n ? POINTS[n] ?? null : null),
  ...over,
});

const veh = (id: string, x: number, y: number, over: Partial<PlanVehicle> = {}): PlanVehicle => ({
  id,
  status: VehicleStatus.IDLE,
  batteryLevel: 80,
  currentX: x,
  currentY: y,
  currentMapId: 'demo_map',
  lastHeartbeat: new Date(NOW.getTime() - 500),
  ...over,
});

let seq = 0;
const task = (over: Partial<PlanTask> = {}): PlanTask => ({
  id: `T${++seq}`,
  priority: 3,
  startLocation: 'Dock-A',
  targetLocation: 'Station-1',
  scheduledAt: null,
  createdAt: new Date(NOW.getTime() - 60_000 + seq),
  ...over,
});

test('出発地に一番近い空き車両に割り当てる', () => {
  const t = task({ startLocation: 'Dock-B' });
  const r = planAssignments([t], [veh('near-A', 1, 0), veh('near-B', 9, 0)], ctx());
  assert.deepEqual(r.assignments.map((a) => a.vehicleId), ['near-B']);
  assert.equal(r.assignments[0].distance, 1);
});

test('優先度の高いタスクから、近い車両を取っていく。1台に1タスクまで', () => {
  const low = task({ priority: 1 });
  const high = task({ priority: 5 });
  const r = planAssignments([low, high], [veh('far', 9, 0), veh('near', 1, 0)], ctx());
  assert.deepEqual(
    r.assignments.map((a) => [a.taskId, a.vehicleId]),
    [
      [high.id, 'near'],
      [low.id, 'far'],
    ],
  );
});

test('車両が足りないタスクは「空いている車両がありません」で待つ', () => {
  const a = task({ priority: 5 });
  const b = task({ priority: 1 });
  const r = planAssignments([a, b], [veh('only', 0, 0)], ctx());
  assert.equal(r.assignments.length, 1);
  assert.equal(r.waiting.get(b.id), '空いている車両がありません');
});

test('予定日時がまだのタスクは割り当てない', () => {
  const later = task({ scheduledAt: new Date(NOW.getTime() + 60_000) });
  const due = task({ scheduledAt: new Date(NOW.getTime() - 1) });
  const r = planAssignments([later, due], [veh('v1', 0, 0), veh('v2', 1, 1)], ctx());
  assert.deepEqual(r.assignments.map((a) => a.taskId), [due.id]);
  assert.equal(r.waiting.get(later.id), '予定日時になったら割り当てます');
});

test('同じ優先度なら、予定日時の早い順 → 作成の古い順', () => {
  const plain = task();
  const scheduled = task({ scheduledAt: new Date(NOW.getTime() - 1000) });
  const r = planAssignments([plain, scheduled], [veh('v1', 0, 0)], ctx());
  assert.equal(r.assignments[0].taskId, scheduled.id);
});

test('地図に無い地点のタスクは理由を付けて待つ', () => {
  const t = task({ startLocation: 'Nowhere' });
  const r = planAssignments([t], [veh('v1', 0, 0)], ctx());
  assert.equal(r.assignments.length, 0);
  assert.match(r.waiting.get(t.id)!, /出発地「Nowhere」/);
});

test('距離が同じなら電池の多い車両', () => {
  const r = planAssignments([task()], [veh('low', 1, 0, { batteryLevel: 40 }), veh('high', -1, 0, { batteryLevel: 90 })], ctx());
  assert.equal(r.assignments[0].vehicleId, 'high');
});

test('自動割り当てでは使わない車両', () => {
  const c = ctx({ busyVehicleIds: new Set(['busy']), manualVehicleIds: new Set(['manual']), movingVehicleIds: new Set(['goto']), emergencyVehicleIds: new Set(['estop']) });
  const cases: [PlanVehicle, RegExp][] = [
    [veh('off', 0, 0, { status: VehicleStatus.OFFLINE }), /オフライン/],
    [veh('err', 0, 0, { status: VehicleStatus.ERROR }), /異常/],
    [veh('busy', 0, 0), /別のタスク/],
    [veh('manual', 0, 0), /手動操縦/],
    [veh('goto', 0, 0), /移動中/],
    [veh('run', 0, 0, { status: VehicleStatus.RUNNING }), /移動中/],
    [veh('empty', 0, 0, { batteryLevel: 19 }), /電池残量が 20%/],
    [veh('charging', 0, 0, { status: VehicleStatus.CHARGING, batteryLevel: 25 }), /充電中/],
    [veh('other-map', 0, 0, { currentMapId: 'warehouse_a' }), /別の地図/],
    [veh('estop', 0, 0), /緊急停止中/], // Web から止めた直後（DB はまだ IDLE）
    [veh('silent', 0, 0, { lastHeartbeat: new Date(NOW.getTime() - 4000) }), /通信が途切れている/],
    [veh('never', 0, 0, { lastHeartbeat: null }), /通信が途切れている/],
  ];
  for (const [v, why] of cases) assert.match(vehicleBlocker(v, c, c) ?? '', why, v.id);
});

test('充電中でも警告のしきい値以上なら使う。地図を知らせてこない車両も使う', () => {
  const c = ctx();
  assert.equal(vehicleBlocker(veh('c', 0, 0, { status: VehicleStatus.CHARGING, batteryLevel: 30 }), c, c), null);
  assert.equal(vehicleBlocker(veh('nomap', 0, 0, { currentMapId: null }), c, c), null);
});

test('手動の割り当てでも、緊急停止中の車両には割り当てない', () => {
  const c = ctx({ emergencyVehicleIds: new Set(['estop']) });
  assert.equal(vehicleBlocker(veh('estop', 0, 0), c), '緊急停止中');
});

test('手動の割り当て（auto なし）では、走行中・充電中・別の地図・telemetry の途切れは止めない', () => {
  const c = ctx();
  assert.equal(vehicleBlocker(veh('silent', 0, 0, { lastHeartbeat: null }), c), null);
  assert.equal(vehicleBlocker(veh('run', 0, 0, { status: VehicleStatus.RUNNING }), c), null);
  assert.equal(vehicleBlocker(veh('charging', 0, 0, { status: VehicleStatus.CHARGING, batteryLevel: 25 }), c), null);
  assert.equal(vehicleBlocker(veh('other-map', 0, 0, { currentMapId: 'warehouse_a' }), c), null);
});
