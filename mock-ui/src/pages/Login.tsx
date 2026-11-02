import { useState } from 'react';
import { emit, S } from '../mock/store';
import { Btn, Field, inputCls } from '../components/ui';

export function Login() {
  const [name, setName] = useState('matsukawa');
  const [pw, setPw] = useState('');
  const login = () => {
    S.loggedIn = true;
    S.user.name = name || 'matsukawa';
    window.location.hash = '#/';
    emit();
  };
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-900 to-slate-700">
      <div className="w-96 rounded-2xl bg-white p-8 shadow-2xl dark:bg-slate-900">
        <div className="mb-1 text-2xl font-extrabold">VE-con</div>
        <div className="mb-6 text-sm text-slate-500">AGV 運行管理システム</div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            login();
          }}
        >
          <Field label="ユーザー名">
            <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="パスワード">
            <input type="password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Btn variant="pri" className="w-full py-2" type="submit">
            ログイン
          </Btn>
        </form>
        <div className="mt-4 rounded bg-amber-50 p-2 text-xs text-amber-800">モック：何を入力してもログインできます</div>
      </div>
    </div>
  );
}
