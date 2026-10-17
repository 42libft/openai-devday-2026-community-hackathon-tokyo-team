# OpenAI DevDay 2026 Community Hackathon Tokyo チーム開発環境

## 起動

Node.js 24以降とnpmを使用します。

```sh
git clone https://github.com/42libft/openai-devday-2026-community-hackathon-tokyo-team.git
cd openai-devday-2026-community-hackathon-tokyo-team
npm ci
npm run dev
```

http://127.0.0.1:5173 を開きます。
`index.html` と `src/` の変更が開発画面へ反映されます。

## ビルド

```sh
npm run build
npm run preview
```

静的ファイルを `dist/` へ出力します。
http://127.0.0.1:4173 で確認できます。
公開先ごとの設定は [docs/static-output.md](docs/static-output.md) を参照してください。

## テスト

```sh
npm test
```

ビルド後、開発サーバーと静的出力のHTTP応答・CSS/JavaScriptの取得・確認ボタンの処理を検査します。

## 参加方法

1. リポジトリへ参加後、上の起動手順を実行します。
2. 担当を決め、最新の `main` から作業ブランチを作ります。

   ```sh
   git switch main
   git pull --ff-only
   git switch -c work/your-task
   ```

3. `index.html` と `src/` を編集し、`npm test` を実行します。
4. 作業ブランチをpushし、変更内容と確認結果を添えてPull Requestを作ります。
5. レビュー後に `main` へ統合します。
