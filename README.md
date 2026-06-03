# 勤務表Googleカレンダー登録アプリ

新里 康平さんの勤務表PDFを読み取り、PDF内のシフト凡例も自動抽出してGoogleカレンダーへ登録するローカルWebアプリです。空欄と `H` は休みとして扱い、未登録の記号や時間なしの記号は画面で強調します。

## 起動

```powershell
.\.venv\Scripts\python app.py
```

ブラウザで `http://127.0.0.1:5000` を開きます。

## スマホから使うクラウド化

このアプリはクラウド用の `Dockerfile` / `Procfile` / `wsgi.py` を含んでいます。Render、Railway、Fly.io、Google Cloud Run など、PythonまたはDockerに対応したサービスへ配置できます。

クラウド公開時は必ず環境変数でパスワードを設定してください。

```text
APP_USERNAME=admin
APP_PASSWORD=自分だけが知っているパスワード
FLASK_SECRET_KEY=十分長いランダム文字列
HOST=0.0.0.0
PORT=8080
```

デプロイ後はスマホで `https://デプロイ先URL/` を開き、ユーザー名とパスワードを入力して使います。

### Google OAuth設定

クラウドでは `credentials.json` を置く代わりに、以下のどちらかを環境変数に入れられます。

```text
GOOGLE_CLIENT_SECRET_JSON=GoogleのOAuthクライアントJSON全文
```

または

```text
GOOGLE_CLIENT_SECRET_BASE64=GoogleのOAuthクライアントJSONをBase64化した値
```

Google Cloud側のOAuthリダイレクトURIには、デプロイ先URLに `/google/callback` を付けたURLを登録します。

```text
https://デプロイ先URL/google/callback
```

Google認証トークンを再起動後も残したい場合は、クラウドサービスの永続ディスクを使い、次のように保存先を指定します。

```text
GOOGLE_TOKEN_PATH=/data/token.json
```

## Googleカレンダー連携

1. Google CloudでCalendar APIを有効にします。
2. OAuthクライアントのJSONをダウンロードします。
3. このフォルダー直下に `credentials.json` という名前で置きます。
4. アプリ右上の `Google認証` から認証します。

Google登録前に `ICS保存` もできます。ICSファイルはGoogleカレンダーへ手動インポートできます。

## 使い方

1. 画面で勤務表PDFを選びます。
2. `読み取る` を押します。
3. PDFから読み取った勤務表とシフト時間帯を確認します。
4. `Google登録` または `ICS保存` を実行します。

## 読み取り仕様

- 対象者の初期値は `新里 康平` です。
- PDF表内の名前は空白を除いて照合します。
- ファイル名が `2026.06勤務表.pdf` のような形式なら年月を推定します。
- シフト記号と時間帯はPDF下段の凡例から自動抽出します。
- ファイル名から年月を推定できない場合は、現在の年月で組み立てて画面に警告します。
- Google登録時は、同じ月のこのアプリ作成分を削除してから登録できます。
