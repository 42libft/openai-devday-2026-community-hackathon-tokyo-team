# 静的出力の受け渡し

`npm run build` で作成した `dist/` を使用します。
現行版のカメラによるAI判定には、これに加えて同一originの `/api/decide` とサーバー側の `OPENAI_API_KEY` が必要です。
`dist/` を静的配信するだけでは、このAPIは提供されません。

## 現行版の全機能を配備する場合

このリポジトリには、Vercel Functionsとして動く `api/decide.js` と `vercel.json` があります。
Vercelにはリポジトリのソースを渡し、サーバー側の環境変数を設定してビルド・配備します。
キーは公開クライアントへ渡さず、`VITE_` で始まる変数にも設定しません。
`dist/` のみを渡す方式とは異なります。

## 静的ファイルの受け渡し先

| 公開先 | 渡す内容・設定 |
| --- | --- |
| ChatGPT Sites | `dist/` の内容を、`index.html` がルートにある静的ファイル一式として対応ワークフローへ渡す。 |
| Vercel | ルートの `vercel.json` を使用。Build Commandは `npm run build`、Output Directoryは `dist`。 |
| Cloudflare Workers | `wrangler.json` の `name` を使用するWorker名に合わせる。Static Assetsは `./dist`。 |
| Cloudflare Pages | Build Commandは `npm run build`、Build Output Directoryは `dist`。 |

上表は画面の静的配信の設定です。
Vercel以外の各環境で、このリポジトリの `api/decide.js` がそのまま実行されることは確認していません。
カメラのAI判定も提供する場合は、対応するサーバー処理と秘密の環境変数の管理が別途必要です。
ボタンによる進行・検索・寄り道復帰と、カメラのAI判定の受入は分けて確認してください。

- [Viteの静的サイト出力](https://vite.dev/guide/static-deploy)
- [ChatGPT Sitesの作成](https://learn.chatgpt.com/docs/sites/creating-a-site)
- [Vercelのビルド設定](https://vercel.com/docs/builds/configure-a-build)
- [Cloudflare Static Assets](https://developers.cloudflare.com/workers/static-assets/)
