// 設定：左にメニュー。一覧はページ内、追加・編集はモーダル。項目の分類は setting_classification.xlsx に合わせる
import { useState, type ReactNode } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { approvalsOf, fmtSetting, isOpenReq, needApprovals, RANKS, REQ_STATUS, SETTING_ITEMS, settingItem, ST, valueError, type ChangeRequest, type Rank, type SettingItem } from '../store/data';
import { askDeleteUser, askDeleteVehicle, emit, nav, openModal, playAlarm, reqNotes, restartDemo, savePrefs, setDemoMode, setTestOnline, submitChangeRequest, toast, useStore, withdrawRequest } from '../store/store';
import { Btn, Card, cx, fmtDT, fmtT, FormRow, inputCls, Kv, LockIcon, RankBadge, ReqChip, Tag, ValueInput, VChip } from '../components/ui';
import { SettingApprovals } from './SettingApprovals';

// 【仮】デモ中は、サーバーに送る操作（ユーザー管理・パスワード変更）を止める
const DEMO_NA = 'デモモード中は使えません（設定 → デモ で終了してください）';

const MENU: [string, string, boolean][] = [
  ['display', '表示', false],
  ['account', 'アカウント', false],
  ['request', '変更申請', false],
  ['approvals', '申請の承認', true],
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
  const todo = s.user.role === 'ADMIN' ? reqNotes().filter((n) => n.action).length : 0; // 承認・変更を待っている申請
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
            {k === 'approvals' && todo > 0 && <span className="ml-1.5 rounded-full bg-red-600 px-1.5 text-[11px] font-bold text-white">{todo}</span>}
            {admin && <span className="ml-auto text-xs text-slate-400">管理者</span>}
          </NavLink>
        ))}
      </Card>
      <div className="min-h-0 overflow-auto">
        {locked ? (
          <Card title={item[1]} bodyClass="p-8 text-center text-slate-500">
            🔒 この設定は管理者（ADMIN）だけが見られます。
          </Card>
        ) : (
          { display: <Display />, account: <Account />, request: <ChangeRequest />, approvals: <SettingApprovals />, ops: <Ops />, vehicles: <Vehicles />, users: <Users />, system: <System />, demo: <Demo /> }[item[0]]
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

// まだ動かない項目の目印（画面だけ先に用意している）
const Soon = () => <Tag>準備中</Tag>;

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
      <Row label="表示言語">
        <div className="flex items-center gap-2">
          <select disabled className={cx(inputCls, 'w-40!')} value="ja">
            <option value="ja">日本語</option>
          </select>
          <Soon />
        </div>
      </Row>
      <Row label="地図の表示倍率">
        <div className="flex items-center gap-2">
          <select disabled className={cx(inputCls, 'w-40!')} value="100">
            <option value="100">100%</option>
          </select>
          <Soon />
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
      <Row label="受け取る通知" hint="自分の通知欄に出すイベントの種類">
        <div className="flex items-center gap-4 text-sm text-slate-400">
          {['お知らせ', '警告', '異常'].map((k) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="checkbox" disabled checked readOnly />
              {k}
            </label>
          ))}
          <Soon />
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
          ['表示名', <>{s.user.name} <Soon /></>],
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
  // L2 の2項目は、管理者なら申請なしで変えられる（変更画面でサインし、記録を残す）
  const batt = (key: 'battWarn' | 'battMin', label: string, hint: string) => (
    <Row label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input disabled className={cx(inputCls, 'w-24!')} value={s.values[key]} /> %<Tag tone={RANKS[2].tone}>{RANKS[2].short}</Tag>
        <Btn size="sm" onClick={() => nav(`/settings/approvals/direct-${key}`)}>
          変更する…
        </Btn>
      </div>
    </Row>
  );
  const l3 = (key: 'maxSpeed' | 'obstacle', label: string, hint: string) => (
    <Row label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input disabled className={cx(inputCls, 'w-24!')} value={s.values[key]} /> {key === 'maxSpeed' ? 'km/h' : 'm'}
        <Tag tone={RANKS[3].tone}>{RANKS[3].short}</Tag>
        <Btn size="sm" onClick={() => nav('/settings/request')}>
          変更を申請…
        </Btn>
      </div>
    </Row>
  );
  return (
    <Card title={<>運行 <span className="text-xs font-normal text-slate-500">変更にはサインが必要です。だれが変更したかは「申請の承認」の変更の記録に残ります</span></>} bodyClass="px-5">
      {batt('battWarn', 'バッテリー：警告する残量', 'これより少ないと黄色で表示')}
      {batt('battMin', 'バッテリー：割り当てない残量', 'これより少ない車両はタスクの候補から外し、赤で表示')}
      <div className="my-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        最高速度と障害物で止まる距離は、変更しても車両（PC1 の nav2_params.yaml、ラズパイの serial_bridge）へ送る仕組みがまだありません。記録と表示だけが変わります。
        車両へ送るには、先に docs/agv_protocol.md に命令を追加する必要があります。L3 のため、管理者でも申請と 2 人の承認が必要です。
      </div>
      {l3('maxSpeed', '最高速度', 'desired_linear_vel（車両側は m/s。5 km/h ≒ 1.39 m/s）')}
      {l3('obstacle', '障害物で止まる距離', 'ラズパイの serial_bridge')}
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

// ---------------------------------------------------------------
// 設定変更の申請。送信すると、すべての管理者に通知される（承認は「申請の承認」の画面）
// 項目・ランク・承認・反映のしかたは setting_classification.xlsx の内容（store/data.ts の SETTING_ITEMS）
// ---------------------------------------------------------------
const L4_ITEMS: { key: string; label: string; reason: string }[] = [
  { key: 'l4-estop', label: '緊急停止機能の有効・無効', reason: '安全の根幹。無効にはできない' },
  { key: 'l4-obstacle', label: '障害物検知そのものの無効化', reason: '安全の根幹。無効にはできない' },
  { key: 'l4-limit', label: '安全上限（ハードリミット）の値', reason: '承認があっても超えられない線を決める値' },
  { key: 'l4-comm', label: '通信設定（MQTT ブローカー URL、認証キーなど）', reason: '間違うと全車両が止まる。セキュリティにも関わる' },
  { key: 'l4-vehicle', label: '車両の登録・削除、実機との紐づけ', reason: '現地で実機を確認してから行う' },
  { key: 'l4-mapping', label: '地図作成（マッピング走行）と地図の新規登録', reason: '現地作業で、検収と合わせて行う' },
];

const PLEDGES = ['上記の安全ルールを守り、関係者に周知します。', '問題が起きたときは、直ちに報告し、元の値へ戻す申請をします。', '安全上限を超える運用は行いません。'];

function ChangeRequest() {
  const s = useStore();
  const [key, setKey] = useState(SETTING_ITEMS[0].key);
  const [resetCount, setResetCount] = useState(0); // キャンセル・送信のあと、入力欄を空に戻す
  const item = settingItem(key);
  const open = s.requests.find((r) => r.key === key && isOpenReq(r));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_394px] items-start gap-3">
      <div className="flex min-w-0 flex-col gap-3">
        <Card
          title={
            <>
              設定変更の申請
              <span className="text-xs font-normal text-slate-500">{item ? RANKS[item.rank].sub : 'この項目は申請の対象外です。'}</span>
            </>
          }
          right={
            item ? (
              <RankBadge rank={item.rank} />
            ) : (
              <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300">危険度 L4（SHRAGD のみ）</span>
            )
          }
        >
          <div className="px-5">
            <FormRow label="変更する項目" required={!!item}>
              <div className="flex items-center gap-3">
                <div className="relative min-w-0 flex-1">
                  <select aria-label="変更する項目" className={cx(inputCls, 'appearance-none py-2 pr-9', !item && 'bg-slate-100 text-slate-400 dark:bg-slate-800')} value={key} onChange={(e) => setKey(e.target.value)}>
                    {([1, 2, 3] as const).map((r) => (
                      <optgroup key={r} label={RANKS[r].badge}>
                        {SETTING_ITEMS.filter((i) => i.rank === r).map((i) => (
                          <option key={i.key} value={i.key}>
                            {i.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    <optgroup label="危険度 L4（企業からは変更不可）">
                      {L4_ITEMS.map((i) => (
                        <option key={i.key} value={i.key}>
                          {i.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  {item ? (
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-slate-500">▼</span>
                  ) : (
                    <LockIcon className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-slate-400" />
                  )}
                </div>
                {item ? (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">影響：{item.scope}</span>
                ) : (
                  <span className="shrink-0 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300">企業からは変更不可</span>
                )}
              </div>
            </FormRow>
          </div>
          {item ? (
            <RequestFields key={`${key}-${resetCount}`} item={item} cur={s.values[key]} open={open} userName={s.user.name} role={s.user.role} onReset={() => setResetCount((n) => n + 1)} />
          ) : (
            <L4Notice onCancel={() => setKey(SETTING_ITEMS[0].key)} />
          )}
        </Card>
        <MyRequests />
      </div>
      <ApprovalRules rank={item?.rank ?? 4} />
    </div>
  );
}

// 入力が足りないときの文（足りていれば null）
function missingOf(item: SettingItem, cur: string, f: { value: string; reason: string; effect: string; rule: string; pledged: boolean[] }) {
  return (
    valueError(item, f.value, cur) ??
    (!f.reason.trim()
      ? '理由を入力してください'
      : item.rank >= 2 && !f.effect.trim()
        ? 'それがもたらす効果を入力してください'
        : item.rank === 3 && !f.rule.trim()
          ? '安全に関するルール案を入力してください'
          : item.rank === 3 && !f.pledged.every(Boolean)
            ? '誓約の3項目すべてに同意してください'
            : null)
  );
}

function RequestFields({ item, cur, open, userName, role, onReset }: { item: SettingItem; cur: string; open?: ChangeRequest; userName: string; role: string; onReset: () => void }) {
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [effect, setEffect] = useState('');
  const [rule, setRule] = useState('');
  const [pledged, setPledged] = useState(PLEDGES.map(() => false));
  const [sending, setSending] = useState(false);
  const area = cx(inputCls, 'block resize-none rounded-lg px-3 py-2');
  const d = new Date();
  const today = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  const viewer = role === 'VIEWER';

  const submit = async () => {
    const missing = missingOf(item, cur, { value, reason, effect, rule, pledged });
    if (missing) return toast(missing, 'error');
    setSending(true);
    const r = await submitChangeRequest({ key: item.key, value: value.trim(), reason: reason.trim(), effect: effect.trim(), safetyRule: rule.trim(), pledged: pledged.every(Boolean) });
    setSending(false);
    if (r) onReset();
  };

  return (
    <>
      <div className="px-5">
        <FormRow label={item.type === 'number' ? '数値' : '変更内容'} hint="変更前 → 変更後" required>
          <ValueInput item={item} cur={cur} value={value} onChange={setValue} />
        </FormRow>
        <FormRow label="理由" required>
          <textarea rows={2} className={area} placeholder="変更が必要になった理由を書いてください" value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormRow>
        {item.rank >= 2 && (
          <FormRow label="それがもたらす効果" required>
            <textarea rows={2} className={area} placeholder="変更によって見込める効果を書いてください" value={effect} onChange={(e) => setEffect(e.target.value)} />
          </FormRow>
        )}
        {item.rank === 3 && (
          <>
            <FormRow label="安全に関するルール案" hint="変更後に守ること" required>
              <textarea rows={2} className={area} placeholder="変更後に守る安全ルールを書いてください" value={rule} onChange={(e) => setRule(e.target.value)} />
            </FormRow>
            <FormRow label="誓約" hint="3 項目すべてに同意が必要" required>
              <div className="space-y-2.5 text-sm">
                {PLEDGES.map((p, i) => (
                  <label key={p} className="flex items-center gap-2.5">
                    <input type="checkbox" className="h-4 w-4" checked={pledged[i]} onChange={(e) => setPledged(pledged.map((x, j) => (j === i ? e.target.checked : x)))} />
                    {p}
                  </label>
                ))}
                <div className="text-xs text-slate-500">
                  誓約者：{userName}（{role}） / {today}
                </div>
              </div>
            </FormRow>
          </>
        )}
        {open && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            この項目には処理中の申請があります（{open.requester} さん・{REQ_STATUS[open.status].label}）。処理が終わるまで、新しい申請はできません。
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 px-5 py-3.5">
        <div className="text-xs leading-relaxed text-slate-500">
          承認されるまで、設定は変わりません。
          <br />
          承認前なら、申請を取り下げられます。
        </div>
        <div className="flex-1" />
        <Btn variant="ghost" onClick={onReset}>
          キャンセル
        </Btn>
        <Btn className="px-6 py-2" onClick={() => toast('下書きの保存はまだ使えません', 'warn')}>
          下書きを保存
        </Btn>
        <Btn variant="pri" className="px-8 py-2" disabled={!!open || viewer || sending} title={viewer ? '閲覧のみの権限では申請できません' : undefined} onClick={submit}>
          {sending ? '送信中…' : '申請する'}
        </Btn>
      </div>
    </>
  );
}

// 自分が出した申請と、その結果（不承認の理由もここで見られる）
function MyRequests() {
  const s = useStore();
  const mine = s.requests.filter((r) => r.requester === s.user.name && !r.direct);
  return (
    <Card title={<>あなたの申請 <span className="text-xs font-normal text-slate-500">承認待ちのあいだは取り下げられます</span></>}>
      {!mine.length ? (
        <div className="p-6 text-center text-sm text-slate-400">まだ申請はありません</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-2">申請日時</th>
              <th className="py-2">項目</th>
              <th className="py-2">変更内容</th>
              <th className="py-2">状態</th>
              <th className="py-2">承認</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {mine.map((r) => {
              const rej = r.reviews.find((v) => v.decision === 'REJECT');
              return (
                <tr key={r.id} className="border-b border-slate-100 align-top last:border-b-0 dark:border-slate-800">
                  <td className="px-4 py-2 whitespace-nowrap text-slate-500">{fmtDT(r.at)}</td>
                  <td className="py-2 pr-3">
                    <Tag tone={RANKS[r.rank].tone}>{RANKS[r.rank].short}</Tag> {r.label}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {fmtSetting(r.key, r.cur)} → <b>{fmtSetting(r.key, r.value)}</b>
                  </td>
                  <td className="py-2 pr-3">
                    <ReqChip status={r.status} />
                    {rej && (
                      <div className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {rej.name}：{rej.comment}
                      </div>
                    )}
                    {r.status === 'APPLIED' && (
                      <div className="mt-1 text-xs text-slate-500">
                        変更：{r.appliedBy}（{fmtDT(r.appliedAt)}）
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-slate-500">
                    {approvalsOf(r).length} / {needApprovals(r.rank)}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {r.status === 'PENDING' && (
                      <Btn size="sm" onClick={() => withdrawRequest(r.id)}>
                        取り下げ
                      </Btn>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function L4Notice({ onCancel }: { onCancel: () => void }) {
  return (
    <>
      <div className="px-5 py-4">
        <div className="flex gap-4 rounded-xl border border-violet-200 bg-violet-50 p-5 dark:border-violet-800 dark:bg-violet-950/40">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-200">
            <LockIcon />
          </span>
          <div>
            <div className="font-bold text-violet-800 dark:text-violet-200">企業側からは、この項目の変更を申請できません</div>
            <div className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">安全や通信の根幹にあたる項目です。変更が必要な場合は、SHRAGD の運営者へご連絡ください。運営者が現地で確認したうえで実施し、監査ログに残します。</div>
          </div>
        </div>
        <div className="mt-5 mb-2 font-bold">企業側から申請できない項目（{L4_ITEMS.length} 件）</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-800">
            <tr>
              <th className="px-3 py-2 pl-7">項目</th>
              <th className="py-2">理由</th>
            </tr>
          </thead>
          <tbody>
            {L4_ITEMS.map((i) => (
              <tr key={i.key} className="border-b border-slate-100 last:border-b-0 dark:border-slate-800">
                <td className="py-2 pr-3">
                  <span className="flex items-center gap-1.5">
                    <LockIcon className="shrink-0 text-slate-400" />
                    {i.label}
                  </span>
                </td>
                <td className="py-2 text-slate-600 dark:text-slate-300">{i.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 border-t border-slate-200 px-5 py-3.5 dark:border-slate-700">
        <div className="text-xs leading-relaxed text-slate-500">
          申請の対象外の項目です。
          <br />
          変更は SHRAGD の運営者が行います。
        </div>
        <div className="flex-1" />
        <Btn variant="ghost" onClick={onCancel}>
          キャンセル
        </Btn>
        <Btn variant="pri" className="px-8 py-2" disabled>
          申請できません
        </Btn>
      </div>
    </>
  );
}

function RuleBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-slate-100 py-3 dark:border-slate-800">
      <div className="mb-1 text-xs text-slate-500">{label}</div>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function ApprovalRules({ rank }: { rank: Rank | 4 }) {
  if (rank === 4) {
    return (
      <Card title="承認のルール" bodyClass="px-5 py-4">
        <div className="mb-1 text-xs text-slate-500">必要な承認</div>
        <div className="font-bold text-violet-700 dark:text-violet-300">企業からは申請できません</div>
        <div className="my-3 flex items-center gap-3 font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-200">
            <LockIcon />
          </span>
          SHRAGD の運営者のみ
        </div>
        <RuleBlock label="実施のしかた">SHRAGD の運営者が、現地で確認したうえで実施します。</RuleBlock>
        <RuleBlock label="記録">実施した内容は、監査ログに残ります。</RuleBlock>
      </Card>
    );
  }
  const r = RANKS[rank];
  const steps: [string, string][] = [['申請', 'あなた'], ['承認', r.step], ['反映', r.when]];
  return (
    <Card title="承認のルール" bodyClass="px-5 py-4">
      <div className="mb-3 grid grid-cols-3">
        {steps.map(([t, sub], i) => (
          <div key={t} className="relative text-center">
            {i < 2 && <span className="absolute top-3.5 left-1/2 w-full border-t border-slate-300 dark:border-slate-600" />}
            <span className={cx('relative mx-auto flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold', i === 0 ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-500 dark:border-slate-600 dark:bg-slate-900')}>{i + 1}</span>
            <div className="mt-1 text-xs font-bold">{t}</div>
            <div className="text-xs text-slate-500">{sub}</div>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-100 py-3 dark:border-slate-800">
        <div className="mb-1 text-xs text-slate-500">必要な承認</div>
        <div className="font-bold">{r.need}</div>
        <div className="mt-2 space-y-2">
          {Array.from({ length: r.approvers }, (_, i) => (
            <div key={i} className="flex items-center gap-3 text-sm font-semibold">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400 dark:border-slate-600">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-4 w-4">
                  <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6Z" />
                </svg>
              </span>
              承認者 {i + 1}
              <span className="ml-auto">
                <Tag tone="amber">未承認</Tag>
              </span>
            </div>
          ))}
        </div>
      </div>
      <RuleBlock label="反映のしかた">{r.reflect}</RuleBlock>
      {rank >= 2 && <RuleBlock label="承認前の確認">承認の前に、「現在の値 → 新しい値」を確認画面で表示します。</RuleBlock>}
      {rank === 3 && (
        <RuleBlock label="ルール">
          <ul className="list-disc space-y-0.5 pl-4">
            <li>2 人は同時でなくてかまいません</li>
            <li>期限（例：7 日）内にそろわないと期限切れ</li>
            <li>1 人でも却下すれば却下になります</li>
            <li>承認者が値を直すと、承認はやり直し</li>
          </ul>
        </RuleBlock>
      )}
    </Card>
  );
}
