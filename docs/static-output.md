# 静的出力の受け渡し

`npm run build` で作成した `dist/` を使用します。

| 公開先 | 渡す内容・設定 |
| --- | --- |
| ChatGPT Sites | `dist/` の内容を、`index.html` がルートにある静的ファイル一式として対応ワークフローへ渡す。 |
| Vercel | ルートの `vercel.json` を使用。Build Commandは `npm run build`、Output Directoryは `dist`。 |
| Cloudflare Workers | `wrangler.json` の `name` を使用するWorker名に合わせる。Static Assetsは `./dist`。 |
| Cloudflare Pages | Build Commandは `npm run build`、Build Output Directoryは `dist`。 |

- [Viteの静的サイト出力](https://vite.dev/guide/static-deploy)
- [ChatGPT Sitesの作成](https://learn.chatgpt.com/docs/sites/creating-a-site)
- [Vercelのビルド設定](https://vercel.com/docs/builds/configure-a-build)
- [Cloudflare Static Assets](https://developers.cloudflare.com/workers/static-assets/)
