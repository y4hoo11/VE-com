// モーダル。重ねて開かない（1つの枠の中で中身を切り替える）。
// 背景は暗くなるが、ヘッダーの「全車停止」と異常のお知らせ帯はモーダルより前に出ている
import { useState, type ReactNode } from 'react';
import { WAYPOINTS, type Role } from '../store/data';
import {
  candidates,
  closeModal,
  createTask,
  openModal,
  S,
  saveUser,
  saveVehicle,
  startTask,
  task,
  toast,
  updateTask,
  useStore,
  veh,
  type ModalState,
} from '../store/store';
import { Battery, Btn, cx, Field, inputCls, Tag, VChip } from './ui';

export function ModalHost() {
  const s = useStore();
  const m = s.modal;
  if (!m) return null;
  // kind と開いた時刻で key を変え、中身が切り替わったら入力欄を初期化する
  return <ModalSwitch key={m.kind + m.openedAt} m={m} />;
}

function ModalSwitch({ m }: { m: NonNullable<ModalState> }) {
  switch (m.kind) {
    case 'confirm':
      return <ConfirmModal m={m} />;
    case 'taskForm':
      return <TaskFormModal mode={m.mode} taskId={m.taskId} />;
    case 'assign':
      return <AssignModal taskId={m.taskId} fromCreate={m.fromCreate} />;
    case 'password':
      return <PasswordModal />;
    case 'user':
      return <UserModal userId={m.userId} />;
    case 'vehicle':
      return <VehicleModal vehicleId={m.vehicleId} />;
  }
}

function Frame({ title, children, footer, error, wide }: { title: ReactNode; children: ReactNode; footer: ReactNode; error?: string; wide?: boolean }) {
  const s = useStore();
  const openedAt = s.modal?.openedAt ?? 0;
  // モーダルを開いている間に起きた異常は、モーダルの中でも知らせる
  const newErr = s.vehicles.filter((v) => v.err && v.err.at > openedAt);
  return (
    <>
      <div className="fixed inset-0 z-[200] bg-slate-900/45" />
      <div role="dialog" aria-modal="true" className={cx('fixed top-1/2 left-1/2 z-[210] flex max-h-[80vh] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-900', wide ? 'w-[640px]' : 'w-[520px]')}>
        <div className="flex items-center border-b border-slate-200 px-5 py-3 dark:border-slate-700">
          <div className="text-base font-bold">{title}</div>
          <div className="flex-1" />
          <button type="button" className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={closeModal} aria-label="閉じる">
            ✕
          </button>
        </div>
        {newErr.length > 0 && (
          <div className="border-b border-red-200 bg-red-50 px-5 py-2 text-sm font-semibold text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            ⚠ {newErr.map((v) => v.name).join('、')} で異常が発生しました（画面上部の帯を確認してください）
          </div>
        )}
        <div className="flex-1 space-y-4 overflow-auto px-5 py-4">{children}</div>
        {error && <div className="px-5 pb-2 text-sm font-semibold text-red-600">{error}</div>}
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700">{footer}</div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------
// 確認ダイアログ
// ---------------------------------------------------------------
function ConfirmModal({ m }: { m: Extract<NonNullable<ModalState>, { kind: 'confirm' }> }) {
  const [checked, setChecked] = useState(false);
  return (
    <Frame
      title={m.title}
      footer={
        <>
          <Btn onClick={closeModal}>キャンセル</Btn>
          <Btn
            variant={m.danger ? 'danger' : 'pri'}
            disabled={!!m.check && !checked}
            onClick={() => {
              closeModal();
              m.onOk();
            }}
          >
            {m.ok}
          </Btn>
        </>
      }
    >
      <p className="m-0 text-sm leading-relaxed">{m.body}</p>
      {m.detail && (
        <ul className="m-0 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
          {m.detail.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      {m.check && (
        <label className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold dark:border-amber-800 dark:bg-amber-950">
          <input type="checkbox" className="h-4 w-4" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          {m.check}
        </label>
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------
// タスクの作成・編集（作成後、そのまま割り当てに進める）
// ---------------------------------------------------------------
const toLocalInput = (ts: number | null) => {
  if (!ts) return '';
  const d = new Date(ts - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

function TaskFormModal({ mode, taskId }: { mode: 'create' | 'edit'; taskId?: string }) {
  const t = taskId ? task(taskId) : undefined;
  const [title, setTitle] = useState(t?.title ?? '');
  const [start, setStart] = useState(t?.start ?? 'Dock-A');
  const [target, setTarget] = useState(t?.target ?? 'Station-1');
  const [priority, setPriority] = useState(t?.priority ?? 3);
  const [sched, setSched] = useState(toLocalInput(t?.scheduledAt ?? null));
  const [assignNext, setAssignNext] = useState(true);
  const [error, setError] = useState('');

  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    if (!title.trim()) return setError('タイトルを入力してください');
    if (start === target) return setError('出発地と目的地が同じです');
    const d = { title: title.trim(), start, target, priority, scheduledAt: sched ? new Date(sched).getTime() : null };
    if (mode === 'edit' && taskId) {
      closeModal();
      await updateTask(taskId, d);
      return;
    }
    setBusy(true);
    try {
      const nt = await createTask(d);
      if (assignNext) openModal({ kind: 'assign', taskId: nt.id, fromCreate: true });
      else {
        toast(`${nt.no} を作成しました（未割当）`, 'ok');
        closeModal();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'タスクの作成に失敗しました');
      setBusy(false);
    }
  };

  const wpOpts = WAYPOINTS.map((w) => (
    <option key={w.name} value={w.name}>
      {w.name}（{w.label}）
    </option>
  ));

  return (
    <Frame
      title={mode === 'edit' ? `タスクの編集（${t?.no ?? ''}）` : '新しいタスク'}
      error={error}
      footer={
        <>
          <Btn onClick={closeModal}>キャンセル</Btn>
          <Btn variant="pri" disabled={busy} onClick={submit}>
            {mode === 'edit' ? '保存' : assignNext ? '作成して割り当てへ →' : '作成'}
          </Btn>
        </>
      }
    >
      <Field label="タイトル">
        <input autoFocus className={inputCls} value={title} placeholder="例: 部品トレイ搬送" onChange={(e) => { setTitle(e.target.value); setError(''); }} />
      </Field>
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <Field label="出発地">
          <select className={inputCls} value={start} onChange={(e) => { setStart(e.target.value); setError(''); }}>
            {wpOpts}
          </select>
        </Field>
        <div className="pb-2 text-lg text-slate-400">→</div>
        <Field label="目的地">
          <select className={inputCls} value={target} onChange={(e) => { setTarget(e.target.value); setError(''); }}>
            {wpOpts}
          </select>
        </Field>
      </div>
      <Field label="優先度" hint="5 がいちばん急ぎ。一覧は優先度の高い順に並びます">
        <div className="flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-600">
          {[1, 2, 3, 4, 5].map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => setPriority(p)}
              className={cx('flex-1 border-r border-slate-300 py-1.5 text-sm last:border-r-0 dark:border-slate-600', priority === p ? 'bg-blue-600 font-bold text-white' : 'hover:bg-slate-50 dark:hover:bg-slate-800')}
            >
              {p}
              {p === 1 ? ' 低' : p === 5 ? ' 高' : ''}
            </button>
          ))}
        </div>
      </Field>
      <Field label="予定日時" opt>
        <input type="datetime-local" className={inputCls} value={sched} onChange={(e) => setSched(e.target.value)} />
      </Field>
      {mode === 'create' && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={assignNext} onChange={(e) => setAssignNext(e.target.checked)} />
          作成したら、続けて車両を割り当てる
        </label>
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------
// 車両の割り当て
// ---------------------------------------------------------------
function AssignModal({ taskId, fromCreate }: { taskId: string; fromCreate?: boolean }) {
  useStore();
  const t = task(taskId);
  const [initRec] = useState(() => candidates(taskId).rec);
  const [vid, setVid] = useState<string | null>(initRec);
  const [error, setError] = useState('');
  if (!t) return null;
  const { list, rec } = candidates(taskId);

  return (
    <Frame
      title="車両の割り当て"
      wide
      error={error}
      footer={
        <>
          <Btn onClick={closeModal}>{fromCreate ? 'あとで割り当てる' : 'キャンセル'}</Btn>
          <Btn
            variant="pri"
            onClick={() => {
              const c = list.find((x) => x.v.id === vid);
              if (!c) return setError('車両を選んでください');
              if (c.ng) return setError(`${c.v.name} は割り当てできません（${c.ng}）`);
              closeModal();
              startTask(taskId, c.v.id);
            }}
          >
            割り当てる
          </Btn>
        </>
      }
    >
      {fromCreate && <div className="rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-800 dark:bg-green-950 dark:text-green-300">✓ タスク {t.no} を作成しました。続けて車両を選んでください。</div>}
      <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
        <div className="font-bold">
          {t.no} {t.title}
        </div>
        <div className="text-sm text-slate-500">
          {t.start} → {t.target} ・ 優先度 {t.priority}
        </div>
      </div>
      <div className="space-y-2">
        {list.map(({ v, ng, dist }) => (
          <label
            key={v.id}
            className={cx(
              'flex gap-3 rounded-lg border p-3',
              ng ? 'cursor-not-allowed border-slate-200 opacity-55 dark:border-slate-700' : 'cursor-pointer hover:border-blue-400',
              vid === v.id && !ng ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200 dark:bg-blue-950 dark:ring-blue-900' : 'border-slate-200 dark:border-slate-700',
            )}
          >
            <input type="radio" name="vid" className="mt-1" disabled={!!ng} checked={vid === v.id} onChange={() => { setVid(v.id); setError(''); }} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <b>{v.name}</b>
                <span className="text-xs text-slate-500">{v.id}</span>
                <VChip v={v} />
                {v.id === rec && <Tag tone="blue">おすすめ（いちばん近い）</Tag>}
              </div>
              <div className="mt-1 flex gap-3 text-xs text-slate-600 dark:text-slate-300">
                <Battery v={v} />
                {v.online && dist != null && <span>出発地まで約 {dist.toFixed(1)} m</span>}
                {v.status === 'CHARGING' && <span>充電を中断して出発します</span>}
              </div>
              {ng && <div className="mt-1 text-xs font-semibold text-red-600">割り当てできません：{ng}</div>}
            </div>
          </label>
        ))}
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------
// パスワード変更
// ---------------------------------------------------------------
function PasswordModal() {
  const [cur, setCur] = useState('');
  const [n1, setN1] = useState('');
  const [n2, setN2] = useState('');
  const [error, setError] = useState('');
  return (
    <Frame
      title="パスワードの変更"
      error={error}
      footer={
        <>
          <Btn onClick={closeModal}>キャンセル</Btn>
          <Btn
            variant="pri"
            onClick={() => {
              if (!cur) return setError('今のパスワードを入力してください');
              if (n1.length < 8) return setError('新しいパスワードは 8 文字以上にしてください');
              if (n1 !== n2) return setError('確認用のパスワードが一致しません');
              return setError('パスワード変更のAPIがまだ無いため、変更できません');
            }}
          >
            変更する
          </Btn>
        </>
      }
    >
      <Field label="今のパスワード">
        <input autoFocus type="password" className={inputCls} value={cur} onChange={(e) => setCur(e.target.value)} />
      </Field>
      <Field label="新しいパスワード" hint="8 文字以上">
        <input type="password" className={inputCls} value={n1} onChange={(e) => setN1(e.target.value)} />
      </Field>
      <Field label="新しいパスワード（確認）">
        <input type="password" className={inputCls} value={n2} onChange={(e) => setN2(e.target.value)} />
      </Field>
    </Frame>
  );
}

// ---------------------------------------------------------------
// ユーザーの追加・編集
// ---------------------------------------------------------------
const ROLE_LABEL: Record<Role, string> = {
  ADMIN: '管理者 — すべて操作できる',
  OPERATOR: '作業者 — 運行とタスクを操作できる',
  VIEWER: '閲覧のみ — 見るだけ（緊急停止は押せる）',
};

function UserModal({ userId }: { userId?: string }) {
  const u = S.users.find((x) => x.id === userId);
  const [name, setName] = useState(u?.name ?? '');
  const [email, setEmail] = useState(u?.email ?? '');
  const [role, setRole] = useState<Role>(u?.role ?? 'OPERATOR');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  return (
    <Frame
      title={u ? `ユーザーの編集（${u.name}）` : 'ユーザーの追加'}
      error={error}
      footer={
        <>
          <Btn onClick={closeModal}>キャンセル</Btn>
          <Btn
            variant="pri"
            onClick={() => {
              if (!name.trim()) return setError('ユーザー名を入力してください');
              if (S.users.some((x) => x.name === name.trim() && x.id !== userId)) return setError('そのユーザー名は使われています');
              if (!/^\S+@\S+$/.test(email)) return setError('メールアドレスの形が正しくありません');
              if (!u && pw.length < 8) return setError('初期パスワードは 8 文字以上にしてください');
              closeModal();
              saveUser({ id: userId, name: name.trim(), email, role });
            }}
          >
            {u ? '保存' : '追加'}
          </Btn>
        </>
      }
    >
      <Field label="ユーザー名">
        <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="メールアドレス">
        <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="権限">
        <div className="space-y-1.5">
          {(['ADMIN', 'OPERATOR', 'VIEWER'] as Role[]).map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm">
              <input type="radio" checked={role === r} onChange={() => setRole(r)} />
              <b className="w-20">{r}</b>
              <span className="text-slate-500">{ROLE_LABEL[r]}</span>
            </label>
          ))}
        </div>
      </Field>
      {u ? (
        <div className="text-xs text-slate-500">パスワードは本人が「パスワードの変更」から変えます。</div>
      ) : (
        <Field label="初期パスワード" hint="8 文字以上。最初のログイン後に本人が変更します">
          <input type="password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------
// 車両の登録・編集
// ---------------------------------------------------------------
function VehicleModal({ vehicleId }: { vehicleId?: string }) {
  const v = veh(vehicleId);
  const [id, setId] = useState(v?.id ?? `AGV-0${S.vehicles.length + 1}`);
  const [name, setName] = useState(v?.name ?? `${S.vehicles.length + 1}号機`);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!v && !/^AGV-\d{2}$/.test(id)) return setError('車両IDは「AGV-数字2桁」の形にしてください（例: AGV-05）');
    if (!v && veh(id)) return setError('その車両IDはすでに登録されています');
    if (!name.trim()) return setError('名前を入力してください');
    setBusy(true);
    try {
      await saveVehicle({ id, name: name.trim() }, !v);
      closeModal();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
      setBusy(false);
    }
  };
  return (
    <Frame
      title={v ? `車両の編集（${v.id}）` : '車両の登録'}
      error={error}
      footer={
        <>
          <Btn onClick={closeModal}>キャンセル</Btn>
          <Btn variant="pri" disabled={busy} onClick={submit}>
            {v ? '保存' : '登録'}
          </Btn>
        </>
      }
    >
      <Field label="車両ID" hint="MQTT のトピック agv/{ID}/… に使われます。登録後は変えられません">
        <input autoFocus={!v} className={inputCls} value={id} disabled={!!v} onChange={(e) => setId(e.target.value.toUpperCase())} />
      </Field>
      <Field label="表示名">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="text-xs text-slate-500">カメラ映像のURLは、保存する仕組みがまだ無いため登録できません。</div>
    </Frame>
  );
}
