# 発表の相棒 — MVP

発表の途中で質問に寄り道しても、元の工程とデモの検索・選択状態へ戻れる、ブラウザだけで動く小さい発表ツールです。

**この版は手動操作・固定台本です。** ボタン、キーボード、決まった日本語の入力で操作します。AI・カメラ・マイク・外部APIは接続していません。

- 3工程の台本を確認して開始し、前後に進行。
- 架空データのローカル検索と結果の選択。
- 別の工程への移動は候補を確認して確定。
- 寄り道前の工程・検索語・結果・選択をまとめて復元。
- 直前の1操作の取消し、停止、新しいセッションでの再開始。
- 古い版、古いセッション、重複入力の拒否。

まず [90秒デモと操作手順](docs/mvp-demo.md) の順に試してください。

## 起動

Node.js 24以降とnpmを使用します。

```sh
git clone --branch work/mvp-presenter-20261018 https://github.com/42libft/openai-devday-2026-community-hackathon-tokyo-team.git
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

ビルド後、入力・状態・統合の失敗条件と、開発サーバー／静的出力のHTTP応答・ローカルアセットを検査します。

実ブラウザの確認手順と実行結果は [検証記録](docs/mvp-verification.md) を参照してください。GitHubへのpushと、公開サイトへの配備は別の工程です。

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
