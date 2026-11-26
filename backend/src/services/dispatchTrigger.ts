// services/dispatchTrigger.ts
// 「自動割り当てをやり直して」と頼むための窓口。タスクの作成・終了、車両が空いた、設定が変わった…などで呼ぶ。
// autoDispatchService を直接 import すると mqttService などと循環するので、ここは何も import しない。
// 呼び忘れても、自動割り当ては数秒ごとに見回るので、そのうち拾われる（呼ぶと早くなるだけ）
type Listener = (reason: string) => void;

let listener: Listener | null = null;

export function onDispatchRequest(fn: Listener) {
  listener = fn;
}

export function requestDispatch(reason: string) {
  listener?.(reason);
}
