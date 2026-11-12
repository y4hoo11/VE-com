// 申請の承認（管理者）：L1〜L3 の設定項目と申請の一覧、承認・不承認、サイン付きの変更、変更の記録
//   /settings/approvals              … 一覧（承認された項目には「変更待ち」の印）
//   /settings/approvals/<申請ID>      … 申請の確認（承認・不承認）。承認がそろい、自分も承認していれば変更画面
//   /settings/approvals/direct-<項目> … 申請なしの変更（管理者・L1/L2 のみ）
import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { approvalsOf, fmtSetting, isOpenReq, needApprovals, RANKS, SETTING_ITEMS, settingItem, valueError, type ChangeRequest, type SettingItem } from '../store/data';
import { applyRequest, demoApproveAs, directChange, nav, reviewRequest, useStore } from '../store/store';
import { Btn, Card, cx, fmtDT, FormRow, inputCls, PersonIcon, RankBadge, RankLegend, ReqChip, Tag, ValueInput } from '../components/ui';

const LIST = '/settings/approvals';
const openFor = (reqs: ChangeRequest[], key: string) => reqs.find((r) => r.key === key && isOpenReq(r));

export function SettingApprovals() {
  const s = useStore();
  const { rid } = useParams();
  if (rid?.startsWith('direct-')) {
    const item = settingItem(rid.slice('direct-'.length));
    if (!item || item.rank > 2) return <NotFound text="この項目は、申請なしでは変更できません（L3 は管理者でも申請と 2 人の承認が必要です）。" />;
    return <ChangeView key={rid} item={item} />;
  }
  if (rid) {
    const r = s.requests.find((x) => x.id === rid);
    const item = r && settingItem(r.key);
    if (!r || !item) return <NotFound text={s.loaded ? '申請が見つかりません。' : '読み込み中です…'} />;
    const iApproved = approvalsOf(r).some((v) => v.name === s.user.name);
    return r.status === 'APPROVED' && iApproved ? <ChangeView key={r.id} item={item} req={r} /> : <ReviewView key={r.id} r={r} item={item} />;
  }
  return <ApprovalList />;
}

function NotFound({ text }: { text: string }) {
  return (
    <Card title="申請の承認" bodyClass="p-8 text-center text-slate-500">
      <div className="mb-4">{text}</div>
      <Btn onClick={() => nav(LIST)}>一覧に戻る</Btn>
    </Card>
  );
}

// ---------------------------------------------------------------
// 一覧：L4 以外の全項目。申請の状態と、承認後の「変更待ち」の印
// ---------------------------------------------------------------
function ApprovalList() {
  const s = useStore();
  const me = s.user.name;
  const history = s.requests.filter((r) => !isOpenReq(r)).slice(0, 50);
  return (
    <div className="space-y-3">
      <Card title={<>申請の承認 <span className="text-xs font-normal text-slate-500">申請はすべての管理者に届きます。承認した管理者だけが、サインして変更できます</span></>}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-2">項目</th>
              <th className="py-2">ランク</th>
              <th className="py-2">現在の値</th>
              <th className="py-2">申請</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {SETTING_ITEMS.map((item) => {
              const r = openFor(s.requests, item.key);
              const ok = r ? approvalsOf(r) : [];
              const mine = ok.some((v) => v.name === me);
              const toChange = r?.status === 'APPROVED' && mine;
              return (
                <tr key={item.key} className={cx('border-b border-slate-100 align-top dark:border-slate-800', toChange && 'bg-blue-50/60 dark:bg-blue-950/30')}>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {item.label}
                      {toChange && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white">● 変更してください</span>}
                    </div>
                    <div className="text-xs text-slate-500">影響：{item.scope}</div>
                  </td>
                  <td className="py-2.5">
                    <Tag tone={RANKS[item.rank].tone}>{RANKS[item.rank].short}</Tag>
                  </td>
                  <td className="py-2.5 whitespace-nowrap">{fmtSetting(item.key, s.values[item.key])}</td>
                  <td className="py-2.5 pr-3">
                    {r ? (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <ReqChip status={r.status} />
                          <span className="text-xs text-slate-500">
                            承認 {ok.length}/{needApprovals(r.rank)}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                          {r.requester} さん：→ <b>{fmtSetting(r.key, r.value)}</b>
                        </div>
                        {r.status === 'APPROVED' && !mine && <div className="mt-1 text-xs text-slate-500">承認した管理者（{ok.map((v) => v.name).join('、')}）が変更します</div>}
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-right whitespace-nowrap">
                    {r ? (
                      <Btn size="sm" variant={toChange ? 'pri' : 'default'} onClick={() => nav(`${LIST}/${r.id}`)}>
                        {toChange ? '変更する' : '申請を見る'}
                      </Btn>
                    ) : item.rank <= 2 ? (
                      <Btn size="sm" onClick={() => nav(`${LIST}/direct-${item.key}`)}>
                        変更
                      </Btn>
                    ) : (
                      <span className="text-xs text-slate-400">申請が必要</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card title={<>変更の記録 <span className="text-xs font-normal text-slate-500">だれがサインして変更したか、不承認・取り下げも残ります（新しい順に 50 件）</span></>}>
        {!history.length ? (
          <div className="p-6 text-center text-sm text-slate-400">まだ記録はありません</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-800">
              <tr>
                <th className="px-4 py-2">日時</th>
                <th className="py-2">項目</th>
                <th className="py-2">内容</th>
                <th className="py-2">結果</th>
                <th className="py-2">申請者</th>
                <th className="py-2">承認・不承認</th>
                <th className="py-2 pr-4">変更者（サイン）</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 align-top last:border-b-0 dark:border-slate-800">
                  <td className="px-4 py-2 whitespace-nowrap text-slate-500">{fmtDT(r.appliedAt ?? r.updatedAt)}</td>
                  <td className="py-2 pr-3">
                    <Tag tone={RANKS[r.rank].tone}>{RANKS[r.rank].short}</Tag> {r.label}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {fmtSetting(r.key, r.cur)} → <b>{fmtSetting(r.key, r.appliedValue ?? r.value)}</b>
                  </td>
                  <td className="py-2 pr-3">
                    <ReqChip status={r.status} />
                  </td>
                  <td className="py-2 pr-3">{r.direct ? <span className="text-slate-400">—（直接変更）</span> : r.requester}</td>
                  <td className="py-2 pr-3 text-xs">
                    {r.reviews.length
                      ? r.reviews.map((v) => (
                          <div key={v.name} className={v.decision === 'REJECT' ? 'text-red-600 dark:text-red-400' : ''}>
                            {v.decision === 'APPROVE' ? '承認' : '不承認'}：{v.name}
                            {v.comment && `「${v.comment}」`}
                          </div>
                        ))
                      : '—'}
                  </td>
                  <td className="py-2 pr-4">{r.signature ? <span className="font-semibold">✍ {r.signature}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <RankLegend />
    </div>
  );
}

// ---------------------------------------------------------------
// 申請の確認：承認・不承認
// ---------------------------------------------------------------
function RequestDetail({ r, item }: { r: ChangeRequest; item: SettingItem }) {
  const box = 'rounded-lg bg-slate-50 px-3 py-2 text-sm whitespace-pre-wrap dark:bg-slate-800';
  return (
    <>
      <FormRow label="変更する項目">
        <div className="flex items-center gap-3 pt-1">
          <b>{r.label}</b>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">影響：{item.scope}</span>
        </div>
      </FormRow>
      <FormRow label={item.type === 'number' ? '数値' : '変更内容'} hint="申請したときの値 → 希望する値">
        <ValueInput item={item} cur={r.cur} value={r.value} readOnly />
      </FormRow>
      <FormRow label="理由">
        <div className={box}>{r.reason}</div>
      </FormRow>
      {r.effect && (
        <FormRow label="それがもたらす効果">
          <div className={box}>{r.effect}</div>
        </FormRow>
      )}
      {r.rule && (
        <FormRow label="安全に関するルール案" hint="変更後に守ること">
          <div className={box}>{r.rule}</div>
        </FormRow>
      )}
      {r.pledgedAt && (
        <FormRow label="誓約">
          <div className="pt-1 text-sm">
            ✔ 3 項目すべてに同意済み <span className="text-xs text-slate-500">（{fmtDT(r.pledgedAt)}）</span>
          </div>
        </FormRow>
      )}
      <FormRow label="申請者">
        <div className="pt-1 text-sm">
          {r.requester} <span className="text-xs text-slate-500">（{fmtDT(r.at)}）</span>
        </div>
      </FormRow>
    </>
  );
}

function ReviewView({ r, item }: { r: ChangeRequest; item: SettingItem }) {
  const s = useStore();
  const me = s.user.name;
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = approvalsOf(r);
  const need = needApprovals(r.rank);
  const reviewed = r.reviews.some((v) => v.name === me);
  const canReview = r.status === 'PENDING' && r.requester !== me && !reviewed;

  const decide = async (decision: 'APPROVE' | 'REJECT') => {
    setBusy(true);
    const res = await reviewRequest(r.id, decision, comment.trim());
    setBusy(false);
    if (!res) return;
    // 承認がそろえば、そのまま変更画面へ（URL は同じ。状態が変わると変更画面になる）。それ以外は一覧へ
    if (res.status !== 'APPROVED') nav(LIST);
  };

  let state: ReactNode = null;
  if (r.status === 'PENDING' && r.requester === me) state = '自分の申請は承認・不承認できません。ほかの管理者の承認を待っています。';
  else if (r.status === 'PENDING' && reviewed) state = `承認しました（承認 ${ok.length}/${need}）。ほかの管理者の承認を待っています。`;
  else if (r.status === 'APPROVED') state = `承認がそろいました。承認した管理者（${ok.map((v) => v.name).join('、')}）が変更します。`;
  else if (r.status !== 'PENDING') state = 'この申請の処理は終わっています。';

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_394px] items-start gap-3">
      <Card
        title={
          <>
            申請の確認 <ReqChip status={r.status} />
          </>
        }
        right={<RankBadge rank={r.rank} />}
      >
        <div className="px-5">
          <RequestDetail r={r} item={item} />
          {canReview && (
            <FormRow label="不承認の理由" hint="不承認にするときは必須。申請者に通知されます">
              <textarea rows={2} className={cx(inputCls, 'block resize-none rounded-lg px-3 py-2')} placeholder="例：安全ルール案が具体的でないため" value={comment} onChange={(e) => setComment(e.target.value)} />
            </FormRow>
          )}
          {state && <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">{state}</div>}
        </div>
        <div className="flex items-center gap-3 px-5 py-3.5">
          <Btn variant="ghost" onClick={() => nav(LIST)}>
            一覧に戻る
          </Btn>
          {/* 【仮】デモ中だけ：ほかの管理者の承認を試す */}
          {s.demo && r.status === 'PENDING' && ok.length < need && (
            <Btn size="sm" onClick={() => demoApproveAs(r.id)}>
              【仮】ほかの管理者として承認
            </Btn>
          )}
          <div className="flex-1" />
          {canReview && (
            <>
              <Btn variant="dangerO" className="px-6 py-2" disabled={busy || !comment.trim()} title={!comment.trim() ? '不承認の理由を入力してください' : undefined} onClick={() => decide('REJECT')}>
                不承認
              </Btn>
              <Btn variant="pri" className="px-8 py-2" disabled={busy} onClick={() => decide('APPROVE')}>
                承認する
              </Btn>
            </>
          )}
        </div>
      </Card>
      <SidePanel r={r} rank={r.rank} />
      <div className="col-span-2">
        <RankLegend />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// 変更画面：承認された申請の反映、または申請なしの変更（L1/L2）。どちらもサインが必要
// ---------------------------------------------------------------
function ChangeView({ item, req }: { item: SettingItem; req?: ChangeRequest }) {
  const s = useStore();
  const me = s.user.name;
  const cur = s.values[item.key];
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [sign, setSign] = useState('');
  const [busy, setBusy] = useState(false);
  const open = !req ? openFor(s.requests, item.key) : undefined;
  const newValue = req ? req.value : value;
  const err = req ? null : valueError(item, value, cur);
  const signedOk = sign.trim() === me;
  const now = new Date();

  const run = async () => {
    setBusy(true);
    const r = req ? await applyRequest(req.id, sign.trim()) : await directChange({ key: item.key, value: value.trim(), reason: reason.trim(), signature: sign.trim() });
    setBusy(false);
    if (r) nav(LIST);
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_394px] items-start gap-3">
      <Card
        title={
          <>
            設定の変更
            <span className="text-xs font-normal text-slate-500">{req ? '承認された申請の内容で変更します。サインすると反映されます。' : '申請なしで変更します（管理者のみ・L1/L2）。サインすると反映されます。'}</span>
          </>
        }
        right={<RankBadge rank={item.rank} />}
      >
        <div className="px-5">
          {req ? (
            <RequestDetail r={req} item={item} />
          ) : (
            <>
              <FormRow label="変更する項目">
                <div className="flex items-center gap-3 pt-1">
                  <b>{item.label}</b>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">影響：{item.scope}</span>
                </div>
              </FormRow>
              <FormRow label={item.type === 'number' ? '数値' : '変更内容'} hint="変更前 → 変更後" required>
                <ValueInput item={item} cur={cur} value={value} onChange={setValue} />
              </FormRow>
              <FormRow label="変更の理由" hint="任意。変更の記録に残ります">
                <textarea rows={2} className={cx(inputCls, 'block resize-none rounded-lg px-3 py-2')} placeholder="例：繁忙期のため" value={reason} onChange={(e) => setReason(e.target.value)} />
              </FormRow>
            </>
          )}
          {req && req.cur !== cur && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              申請のあとに値が変わっています（今の値：{fmtSetting(item.key, cur)}）。変更すると {fmtSetting(item.key, req.value)} になります。
            </div>
          )}
          <FormRow label="確認" hint="反映する前の最終確認">
            <div className="rounded-lg border-2 border-blue-200 bg-blue-50 px-4 py-3 text-sm dark:border-blue-900 dark:bg-blue-950/40">
              {item.label}：{fmtSetting(item.key, cur)} → <b className="text-blue-700 dark:text-blue-300">{newValue.trim() ? fmtSetting(item.key, newValue.trim()) : '（未入力）'}</b>
              <div className="mt-1 text-xs text-slate-500">{RANKS[item.rank].reflect}</div>
            </div>
          </FormRow>
          <FormRow label="サイン" hint="確認のため、あなたのユーザー名を入力してください" required>
            <input className={cx(inputCls, 'w-72! py-2', sign && !signedOk && 'border-red-400')} placeholder={me} value={sign} onChange={(e) => setSign(e.target.value)} />
            <div className="mt-1.5 text-xs text-slate-500">
              署名者：{me}（{s.user.role}） / {now.getFullYear()}/{String(now.getMonth() + 1).padStart(2, '0')}/{String(now.getDate()).padStart(2, '0')}
              {sign && !signedOk && <span className="ml-2 text-red-600">ユーザー名と一致しません</span>}
            </div>
          </FormRow>
          {open && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              この項目には処理中の申請があります（{open.requester} さん）。先に申請を処理してください。
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 px-5 py-3.5">
          <div className="text-xs leading-relaxed text-slate-500">
            サインした人の名前と日時が、変更の記録に残ります。
            <br />
            管理者と申請者に、変更したことが通知されます。
          </div>
          <div className="flex-1" />
          <Btn variant="ghost" onClick={() => nav(LIST)}>
            キャンセル
          </Btn>
          <Btn variant="pri" className="px-8 py-2" disabled={busy || !signedOk || !!err || !!open} title={err ?? (!signedOk ? 'サインを入力してください' : undefined)} onClick={run}>
            ✍ サインして変更する
          </Btn>
        </div>
      </Card>
      <SidePanel r={req} rank={item.rank} direct={!req} />
      <div className="col-span-2">
        <RankLegend />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// 右側：承認の進み具合と、反映のしかた
// ---------------------------------------------------------------
function SidePanel({ r, rank, direct }: { r?: ChangeRequest; rank: 1 | 2 | 3; direct?: boolean }) {
  const need = needApprovals(rank);
  const reviews = r?.reviews ?? [];
  const block = 'border-t border-slate-100 py-3 dark:border-slate-800';
  return (
    <Card title="承認のルール" bodyClass="px-5 py-4">
      {direct ? (
        <div className="pb-3 text-sm leading-relaxed">管理者は、L1・L2 の項目を申請なしで変更できます。変更はサインして行い、変更の記録に残ります。</div>
      ) : (
        <div className="pb-3">
          <div className="mb-1 text-xs text-slate-500">必要な承認</div>
          <div className="font-bold">{RANKS[rank].need}</div>
          <div className="mt-2 space-y-2">
            {Array.from({ length: Math.max(need, reviews.length) }, (_, i) => {
              const v = reviews[i];
              return (
                <div key={i} className="flex items-center gap-3 text-sm font-semibold">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400 dark:border-slate-600">
                    <PersonIcon />
                  </span>
                  <span className="min-w-0">
                    {v ? v.name : `承認者 ${i + 1}`}
                    {v?.comment && <span className="block text-xs font-normal text-slate-500">「{v.comment}」</span>}
                  </span>
                  <span className="ml-auto">{!v ? <Tag tone="amber">未承認</Tag> : v.decision === 'APPROVE' ? <Tag tone="green">承認</Tag> : <Tag tone="red">不承認</Tag>}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className={block}>
        <div className="mb-1 text-xs text-slate-500">反映のしかた</div>
        <div className="text-sm leading-relaxed">{RANKS[rank].reflect}</div>
      </div>
      <div className={block}>
        <div className="mb-1 text-xs text-slate-500">変更できる人</div>
        <div className="text-sm leading-relaxed">{direct ? '管理者（サインが必要）' : 'この申請を承認した管理者のうち、だれか 1 人（サインが必要）'}</div>
      </div>
      {!direct && rank === 3 && (
        <div className={block}>
          <div className="mb-1 text-xs text-slate-500">ルール</div>
          <ul className="list-disc space-y-0.5 pl-4 text-sm">
            <li>2 人は同時でなくてかまいません</li>
            <li>1 人でも不承認にすれば不承認になります</li>
          </ul>
        </div>
      )}
    </Card>
  );
}
