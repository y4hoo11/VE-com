# mock/ui ブランチ（UI モック・参照用）

フロントエンド全面改修の画面モックを置いているブランチです。**main へはマージしません。**
モック本体は [`mock-ui/`](mock-ui/) にあり、バックエンド・Docker・MQTT なしで単体で動きます。

## 動かし方

```bash
git fetch origin
git switch mock/ui
cd mock-ui
npm install
npm run dev      # http://localhost:5180
```

ログインは何を入力しても通ります。左下の「🧪 モック操作」で異常を起こせて、右上の 👤 で権限を切り替えられます。

画面の構成、安全まわりの決めごと、本番化するときに置き換える箇所は [`mock-ui/README.md`](mock-ui/README.md) にまとめています。
