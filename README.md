# WD Tagger Web — v18互換移行版

2026-10-25：原本保全・ローカルWeb版への移行に続き、教師JSONと翻訳辞書の読み込み・保存往復を検証しました。衣装は架空データで検証済みで、正常な実ファイルの提供待ちです。GitHub Pagesへの公開と追加機能は次段階です。

## 今回の変更

- 原本を `baseline/v18-original.html` にバイト単位で保全。Gitの `v18-baseline` タグから復旧できます。
- 既存のCSSと3つのJavaScriptブロックを、その内容と実行順を保って外部ファイルへ分離。
- 既存JSONの保護処理だけを `web/js/compatibility.js` に追加。
- 公開ファイルを7件の許可リストに限定するビルドと、ローカル専用HTTPサーバーを追加。
- 辞書・衣装用の互換処理を `web/js/data-compatibility.js` に追加。手動訳をキャッシュより優先し、文字列・衣装ID・追加項目を保持します。
- Chromium・WebKitの回帰テストを追加。テストの画像・JSON・辞書・衣装は架空のデータです。

モデル選択・CSV選択・画像解析・4種類の判定・日本語項目編集・教師JSON保存／コピー・複数JSON管理・データセット出力・履歴・辞書・衣装・オンライン翻訳の既存処理を残しています。

## 起動

このREADMEがあるフォルダで実行します。Node.jsが必要です。

```powershell
npm.cmd start
```

表示された `http://127.0.0.1:4173/` をPCのブラウザで開いてください。サーバーはローカルPCからだけアクセスできます。iPhone用の公開URLではありません。終了はターミナルのCtrl+Cです。

現段階では従来どおりモデル・CSV・画像を選びます。推論エンジンは従来どおりjsDelivrからONNX Runtime Web 1.20.1を取得します。実モデルによる推論はまだ検証していません。

## 既存JSONを開いたとき

JSONだけで保存済みの判定と学習承認状態を表示できます。画像・モデル・CSVの選択や再解析は不要です。

未編集の通常保存では `ai_prediction` を含めた全項目を保持します。項目の欠落、独自項目、旧 `schema_version`、配列順も保持します。判定や項目を編集した場合だけ `ai_prediction` 内の該当する提案を更新し、元の `review`・`training_labels` は保持します。JSONの空白・改行は保存時に整形されます。

既存の学習情報を更新したい場合のみ「今回の判定で既存JSONのreview・training_labelsを再生成する」をチェックします。学習ラベルの出力にはさらに「編集内容を確認済みとして保存」と「判定済みタグだけを学習用に承認」の両方が必要です。

再生成の条件と互換性上の注意は `docs/COMPATIBILITY.md` を参照してください。読み込み・表示・JSON生成のどの処理も、読み込んだ元オブジェクトや元ファイルを変更しません。

## 復旧

原本のSHA256:

```text
3b8eefa13cd38dbd0a497c08c3169933f8e669a70252004216bcd85439e52f76
```

```powershell
git archive --format=zip --output=v18-recovery.zip v18-baseline baseline/
```

これで元のv18をZIPへ取り出せます。現在の作業を消す `git reset --hard` は不要です。Desktopにある元HTMLにも変更を加えていません。

同梱の `wd-tagger-web-recovery.bundle` は別フォルダへ次のように復元できます。

```powershell
git clone <bundleの絶対パス> wd-tagger-web-restored
```

## テストと公開用ファイル

```powershell
npm.cmd ci
npx.cmd playwright install chromium webkit
npm.cmd test
npm.cmd run build
```

`dist/` の7ファイルだけを将来GitHub Pagesの公開成果物として使用します。モデル、ユーザー画像、教師JSON、個人辞書、衣装プリセット、baseline、テスト、node_modulesは入りません。`dist/` に想定外のファイルがあればビルドは中断します。

`.gitignore` は既定でファイルを除外し、アプリソースとテストだけを明示的に許可しています。ただし `git add -f` で除外を回避したり、許可済みソースへ個人データを埋め込んだりしないでください。公開前にも追跡ファイルを確認します。

## 次の作業

1. 辞書・衣装の検証結果を報告した時点で停止。衣装の再出力版が提供されたら実データの往復を確認。
2. 固定リビジョンのモデルとCSVを用い、PCで本物の推論を確認。
3. その検証後、モデル自動取得、作業保存・復元、翻訳管理を段階的に追加。
4. GitHub Pagesへ公開し、公開URLでiPhoneの実機確認。

既存処理の未修正事項とテスト範囲は `docs/TESTING.md` に記載しています。
