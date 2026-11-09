// 設定：左にメニュー。一覧はページ内、追加・編集はモーダル
import { useState, type ReactNode } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { ST } from '../store/data';
import { askDeleteUser, askDeleteVehicle, emit, openModal, playAlarm, restartDemo, saveOps, savePrefs, setDemoMode, setTestOnline, toast, useStore } from '../store/store';
import { Btn, Card, cx, fmtT, inputCls, Kv, Tag, VChip } from '../components/ui';

// 【仮】デモ中は、サーバーに送る操作（ユーザー管理・パスワード変更）を止める
const DEMO_NA = 'デモモード中は使えません（設定 → デモ で終了してください）';

const MENU: [string, string, boolean][] = [
  ['display', '表示', false],
  ['account', 'アカウント', false],
  ['ops', '運行', true],
  ['vehicles', '車両', true],
  ['users', 'ユーザー', true],
  ['system', 'システム情報', false],
  ['demo', 'デモ（期間限定）', false], // 【仮】デモモード
];

export function Settings() {
  const s = useStore();
  const { sub = 'display' } = useParams();
  const item = MENU.find((m) => m[0] === sub) ?? MENU[0];
  const locked = item[2] && s.user.role !== 'ADMIN';
  return (
    <div className="grid h-full grid-cols-[220px_1fr] gap-3 p-3">
      <Card title="設定" bodyClass="p-2">
        {MENU.map(([k, label, admin]) => (
          <NavLink
            key={k}
            to={`/settings/${k}`}
            className={() => cx('flex items-center rounded-md px-3 py-2 text-sm', item[0] === k ? 'bg-blue-50 font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}
          >
            {label}
            {admin && <span className="ml-auto text-xs text-slate-400">{s.user.role === 'ADMIN' ? '管理者' : '🔒'}</span>}
          </NavLink>
        ))}
      </Card>
      <div className="min-h-0 overflow-auto">
        {locked ? (
          <Card title={item[1]} bodyClass="p-8 text-center text-slate-500">
            🔒 この設定は管理者（ADMIN）だけが見られます。
          </Card>
        ) : (
          { display: <Display />, account: <Account />, ops: <Ops />, vehicles: <Vehicles />, users: <Users />, system: <System />, demo: <Demo /> }[item[0]]
        )}
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[260px_1fr] items-start gap-6 border-b border-slate-100 py-4 last:border-b-0 dark:border-slate-800">
      <div>
        <div className="font-semibold">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Display() {
  const s = useStore();
  const set = (fn: () => void) => {
    fn();
    savePrefs();
    emit();
  };
  return (
    <Card title={<>表示 <span className="text-xs font-normal text-slate-500">この端末のブラウザに保存されます</span></>} bodyClass="px-5">
      <Row label="テーマ">
        <div className="flex gap-4 text-sm">
          {(['light', 'dark'] as const).map((t) => (
            <label key={t} className="flex items-center gap-1.5">
              <input type="radio" checked={s.theme === t} onChange={() => set(() => (s.theme = t))} />
              {t === 'light' ? 'ライト' : 'ダーク'}
            </label>
          ))}
        </div>
      </Row>
      <Row label="地図に表示するもの">
        <div className="flex gap-4 text-sm">
          {(['path', 'labels', 'grid'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="checkbox" checked={s.view[k]} onChange={(e) => set(() => (s.view[k] = e.target.checked))} />
              {{ path: '予定の経路', labels: '地点名', grid: '方眼（1m）' }[k]}
            </label>
          ))}
        </div>
      </Row>
      <Row label="異常のときに音を鳴らす" hint="ERROR のログ（緊急停止など）が届いたときに鳴らします">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={s.sound} onChange={(e) => set(() => (s.sound = e.target.checked))} />
            鳴らす
          </label>
          <Btn size="sm" onClick={() => playAlarm(true)}>
            🔊 試しに鳴らす
          </Btn>
        </div>
      </Row>
    </Card>
  );
}

// 【仮】デモモードの切り替え。実機で確認できるようになったら消す（services/demo.ts と一緒に）
function Demo() {
  const s = useStore();
  return (
    <Card title={<>デモ <Tag tone="amber">期間限定</Tag> <span className="text-xs font-normal text-slate-500">この端末のブラウザに保存されます</span></>} bodyClass="px-5">
      <Row label="デモデータを使う" hint="実機がなくても、車両の動きや操作を試せます。サーバー・DB・実機には何も送りません">
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={s.demo} onChange={(e) => setDemoMode(e.target.checked)} />
          デモモードにする
        </label>
      </Row>
      {s.demo && (
        <Row label="デモをやり直す" hint="車両・タスク・ログを最初の状態に戻します">
          <Btn size="sm" onClick={restartDemo}>
            最初に戻す
          </Btn>
        </Row>
      )}
      <Row label="試せること">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
          <li>地図の車両の移動と、進行方向を示す矢印の向き</li>
          <li>🏠 ホームへ戻る、📍 地点へ移動、🎯 現在地を設定（車両をクリックして詳細から）</li>
          <li>⏸ 一時停止・再開、✓ 積み降ろし完了</li>
          <li>タスクの作成・割り当て・進捗・完了・中止（電池不足やオフラインの車両は断られます）</li>
          <li>緊急停止と解除、異常の音、記録の絞り込み</li>
        </ul>
      </Row>
      <Row label="知っておくこと">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
          <li>データはメモリにあるだけで、再読み込みすると最初に戻ります</li>
          <li>ほかの端末やタブとは共有されません</li>
          <li>走る速さや作業時間は、見やすいように実機とは変えています</li>
        </ul>
      </Row>
    </Card>
  );
}

function Account() {
  const s = useStore();
  const u = s.users.find((x) => x.name === s.user.name);
  return (
    <Card title="アカウント" bodyClass="p-5 space-y-4">
      <Kv
        rows={[
          ['ユーザー名', s.user.name],
          ['メールアドレス', u?.email ?? '—'],
          ['権限', s.user.role],
          ['登録日', u?.created ?? '—'],
        ]}
      />
      <Btn disabled={s.demo} title={s.demo ? DEMO_NA : undefined} onClick={() => openModal({ kind: 'password' })}>
        パスワードを変更…
      </Btn>
    </Card>
  );
}

function Ops() {
  const s = useStore();
  const [warn, setWarn] = useState(s.ops.battWarn);
  const [min, setMin] = useState(s.ops.battMin);

  // ほかの端末で保存されたら、入力欄も新しい値に合わせる（古い値で上書きしないように）
  const savedKey = `${s.ops.battWarn}/${s.ops.battMin}`;
  const [prevSavedKey, setPrevSavedKey] = useState(savedKey);
  if (savedKey !== prevSavedKey) {
    setPrevSavedKey(savedKey);
    setWarn(s.ops.battWarn);
    setMin(s.ops.battMin);
  }

  return (
    <Card
      title="運行"
      right={
        <Btn
          variant="pri"
          onClick={() => {
            if (min >= warn) return toast('「割り当てない残量」は「警告する残量」より小さくしてください', 'error');
            saveOps({ battWarn: warn, battMin: min });
          }}
        >
          保存
        </Btn>
      }
      bodyClass="px-5"
    >
      <Row label="バッテリー：警告する残量" hint="これより少ないと黄色で表示">
        <div className="flex items-center gap-2">
          <input type="number" min={5} max={90} className={cx(inputCls, 'w-24')} value={warn} onChange={(e) => setWarn(Number(e.target.value))} />%
        </div>
      </Row>
      <Row label="バッテリー：割り当てない残量" hint="これより少ない車両はタスクの候補から外し、赤で表示">
        <div className="flex items-center gap-2">
          <input type="number" min={0} max={80} className={cx(inputCls, 'w-24')} value={min} onChange={(e) => setMin(Number(e.target.value))} />%
        </div>
      </Row>
      <div className="my-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        下の項目は車両側（PC1 の nav2_params.yaml など）の設定です。Web から変える仕組みがまだ無いので、表示だけしています。
        変えられるようにするには、先に docs/agv_protocol.md に命令を追加する必要があります。
      </div>
      <Row label="最高速度" hint="desired_linear_vel">
        <div className="flex items-center gap-2">
          <input disabled className={cx(inputCls, 'w-24')} value={s.ops.maxSpeed} /> m/s <Tag>表示のみ</Tag>
        </div>
      </Row>
      <Row label="障害物で止まる距離" hint="ラズパイの serial_bridge">
        <div className="flex items-center gap-2">
          <input disabled className={cx(inputCls, 'w-24')} value={s.ops.obstacle} /> m <Tag>表示のみ</Tag>
        </div>
      </Row>
      <Row label="荷積み・荷降ろしの完了" hint="wait_mode">
        <div className="flex items-center gap-2 text-sm">
          時間で自動／「積み降ろし完了」ボタンで早められる（ボタンは未対応） <Tag>表示のみ</Tag>
        </div>
      </Row>
    </Card>
  );
}

function Vehicles() {
  const s = useStore();
  return (
    <Card title="車両" right={<Btn variant="pri" onClick={() => openModal({ kind: 'vehicle' })}>＋ 車両を登録</Btn>}>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-800">
          <tr>
            <th className="px-4 py-2">ID</th>
            <th className="py-2">表示名</th>
            <th className="py-2">状態</th>
            {/* 【仮】テスト用 */}
            <th className="py-2">
              テスト用 <Tag tone="amber">仮</Tag>
            </th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {s.vehicles.map((v) => (
            <tr key={v.id} className="border-b border-slate-100 dark:border-slate-800">
              <td className="px-4 py-2 font-mono text-xs">{v.id}</td>
              <td className="py-2 font-medium">{v.name}</td>
              <td className="py-2">
                <VChip v={v} />
              </td>
              {/* 【仮】テスト用：実機なしでオンライン時の動きを確かめる */}
              <td className="py-2">
                <Btn
                  size="sm"
                  disabled={v.status === 'ERROR'}
                  title={v.status === 'ERROR' ? '異常中は切り替えられません' : 'telemetry が無くてもオンライン扱いにします（サーバー再起動で元に戻ります）'}
                  onClick={() => setTestOnline(v.id, !v.online)}
                >
                  {v.online ? 'オフラインにする' : 'オンラインにする'}
                </Btn>
              </td>
              <td className="space-x-2 py-2 pr-4 text-right">
                <Btn size="sm" onClick={() => openModal({ kind: 'vehicle', vehicleId: v.id })}>
                  編集
                </Btn>
                <Btn size="sm" variant="dangerO" onClick={() => askDeleteVehicle(v.id)}>
                  削除
                </Btn>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Users() {
  const s = useStore();
  return (
    <Card
      title={<>ユーザー {s.demo && <span className="text-xs font-normal text-slate-500">{DEMO_NA}</span>}</>}
      right={
        <Btn variant="pri" disabled={s.demo} title={s.demo ? DEMO_NA : undefined} onClick={() => openModal({ kind: 'user' })}>
          ＋ ユーザーを追加
        </Btn>
      }
    >
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-800">
          <tr>
            <th className="px-4 py-2">ユーザー名</th>
            <th className="py-2">メールアドレス</th>
            <th className="py-2">権限</th>
            <th className="py-2">登録日</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {s.users.map((u) => (
            <tr key={u.id} className="border-b border-slate-100 dark:border-slate-800">
              <td className="px-4 py-2 font-medium">
                {u.name} {u.name === s.user.name && <Tag tone="blue">あなた</Tag>}
              </td>
              <td className="py-2 text-slate-600 dark:text-slate-300">{u.email}</td>
              <td className="py-2">
                <Tag tone={u.role === 'ADMIN' ? 'red' : u.role === 'OPERATOR' ? 'blue' : 'gray'}>{u.role}</Tag>
              </td>
              <td className="py-2 text-slate-500">{u.created}</td>
              <td className="space-x-2 py-2 pr-4 text-right">
                <Btn size="sm" disabled={s.demo} title={s.demo ? DEMO_NA : undefined} onClick={() => openModal({ kind: 'user', userId: u.id })}>
                  編集
                </Btn>
                <Btn
                  size="sm"
                  variant="dangerO"
                  disabled={s.demo || u.name === s.user.name}
                  title={s.demo ? DEMO_NA : u.name === s.user.name ? '自分自身は削除できません' : undefined}
                  onClick={() => askDeleteUser(u.id)}
                >
                  削除
                </Btn>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function System() {
  const s = useStore();
  const ok = (b: boolean, t = '正常', f = '切断') => <span className={b ? 'text-green-600' : 'font-bold text-red-600'}>● {b ? t : f}</span>;
  return (
    <div className="space-y-3">
      <Card title={<>接続 <span className="text-xs font-normal text-slate-500">接続先の変更はサーバーの .env で行います（画面からは変えません）</span></>} bodyClass="px-5">
        <Row label="ブラウザ ⇔ サーバー" hint="Socket.IO">{ok(s.server, '接続中')}</Row>
        <Row label="サーバー ⇔ MQTTブローカー" hint="mqtt://localhost:1883（Mosquitto）">{ok(s.mqtt, '接続中')}</Row>
        <Row label="データベース" hint="PostgreSQL agv_warehouse">{ok(s.loaded, '正常', '取得できません')}</Row>
      </Card>
      <Card title="車両との通信">
        <table className="w-full text-sm">
          <tbody>
            {s.vehicles.map((v) => (
              <tr key={v.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="px-5 py-2 font-medium">
                  {v.name} <span className="text-xs text-slate-500">{v.id}</span>
                </td>
                <td className="py-2">{ok(v.online && s.mqtt, 'オンライン', 'データなし')}</td>
                <td className="py-2 text-slate-500">{ST[v.status]}</td>
                <td className="py-2 pr-5 text-right text-xs text-slate-500">最終受信 {v.lastHb ? fmtT(v.lastHb) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="バージョン" bodyClass="p-5">
        <Kv
          rows={[
            ['画面', 'frontend（React + Vite + Tailwind CSS）'],
            ['サーバー', 'backend（Express + Socket.IO + Prisma）'],
            ['通信仕様', 'docs/agv_protocol.md'],
          ]}
        />
      </Card>
    </div>
  );
}
