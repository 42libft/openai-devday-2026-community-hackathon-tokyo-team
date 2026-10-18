# MVPの引継ぎ

## 現在の範囲

- 2026-10-18、MVPの実装とteamリポジトリへの反映を再開。
- 既存のVite / JavaScript最小版を土台に、3工程の手動操作・固定台本を実装。
- ローカル検索、結果選択、確認後の1段の寄り道、直前取消し、元の工程・検索語・結果・選択への復帰。
- キーボードと定型句入力に対応。説明文を操作と推定しない。
- mainの直接更新・merge・配備、実センサー、外部API、採点・正式提出は未実施。

## 編集と統合

- 状態: `src/state/` と `test/state.test.mjs`。
- 入力: `src/input/` と `test/input.test.mjs`。
- 画面: `src/ui/view.js`、`src/style.css`、`index.html`。
- 統合: `src/main.js`、controller、テスト、説明資料。
- 別checkoutで担当を分け、統合時に変更ファイルを限定して取り込む。
- package/lock/公開設定は元構成を維持。

## 次の判断

まず `docs/mvp-demo.md` の一巡をメンバーが操作し、要件・リスク担当からの再現条件付きフィードバックを確認する。AI・実入力・台本生成を追加するかは、その後に接続範囲と受入条件を決める。

実際の検証と限界は `docs/mvp-verification.md` を参照。
