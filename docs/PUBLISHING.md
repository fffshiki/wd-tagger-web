# GitHub Pagesへの公開準備

第2-①段階のローカル変更では、全タグ管理用JS・CSSと架空データのテストを追加し、管理対象は33ファイル、配信許可リストは15ファイルとなりました。以下の30ファイル・13配信ファイルという数値は初回公開準備時の記録です。今回のPush・デプロイは実施しません。個人データや実CSVを追加するものではありません。

この段階はローカルでの準備・検証までです。Push、GitHubリポジトリ作成、Pagesの有効化、Actionsの実行はユーザーの確認後に行います。

## 配信構成

- ソースはGitで管理し、npm run buildでdistだけを生成します。
- PagesはGitHub Actionsで生成したdistのみを配信します。リポジトリ全体をPagesへアップロードしません。
- ONNX Runtime Webは1.20.1に固定。必要なJS・MJS・WASMをnpm依存からコピーして同じサイトで配信します。
- モデルとCSVは公式Hugging Faceの同じ固定コミット627aef95638667ddcaa3ac8ae625e88ea5b02f51から取得します。モデル本体はGit・Pagesに含めません。
- 初回は画面のリンクからモデル・CSVをファイルに保存し、従来の入力欄で選択します。大容量モデルの自動メモリ展開や永続キャッシュは今回追加していません。

配信ファイルは13件、11,779,459バイト（約11.8MB）です。ソースリポジトリは30ファイルで、依存パッケージ全体やモデルは含みません。npmのバージョン固定とpackage-lock.jsonでランタイムの取得を再現します。ランタイムのMITライセンスとThirdPartyNoticesも配信します。

モデルのSHA256はe6774bff34d43bd49f75a47db4ef217dce701c9847b546523eb85ff6dbba1db1、CSVのSHA256は298633d94d0031d2081c0893f29c82eab7f0df00b08483ba8f29d1e979441217です。公開準備時に取得したファイルで一致を確認しました。CSVは10,861行のタグとモデルの出力10,861件が対応します。

## ローカルでの確認

```powershell
npm.cmd ci --ignore-scripts
npx.cmd playwright install chromium webkit
npm.cmd test
npm.cmd run build
npm.cmd run audit:release
npm.cmd run preview:pages
```

http://127.0.0.1:4173/wd-tagger-web/ でPagesのプロジェクト配下と同じ相対パス構成を確認できます。自宅PCのこのURLはiPhoneの公開URLではありません。

## 公開時の手順（確認後に一つずつ実行）

1. GitHubで空のwd-tagger-webリポジトリを作成する。自動生成のREADME等は付けない。
2. 返されたURLを使い、確認済みのローカルコミットをmainへPushする。今回はまだ実行しない。
3. リポジトリのSettings → Pages → Build and deploymentでSourceをGitHub Actionsにする。
4. ActionsのDeploy WD Tagger to GitHub Pagesを開き、mainを選んでRun workflowを実行する。
5. 成功したdeploymentに表示されるHTTPS URLを記録する。
6. iPhone SafariでURLを開き、まず表示・モデル選択・CSV選択・1枚の解析を確認する。

ワークフローはworkflow_dispatchのみです。Pushだけでは公開処理は始まりません。build内でテスト・ビルド・Git履歴と配信ファイルの許可リスト検証を行い、それらが成功した後だけdistをアップロードします。deployはgithub-pages環境で実行し、PagesとOIDCに必要な権限だけを付けます。

最初の公開前には、公開予定一覧を確認して了承を伝える操作だけを行ってください。リポジトリ作成以降は、その後一つずつ案内します。

Actions上の実行、Pagesで実際に返されるMIME型・HTTPS・キャッシュ、iPhoneでのメモリと保存動作は公開後に確認します。ローカルのWebKitテストはiPhone実機確認の代わりにはなりません。

## 公開前の一覧確認

npm run audit:releaseは、Git管理対象と全到達可能履歴のファイル名、distの全ファイル、元ソースとの内容一致、リンクの混入を確認します。許可リストはscripts/audit-release.mjsとscripts/build.mjsに明示しています。許可外のパスへプライベートJSONや画像を追加すると監査が失敗します。許可されたソースへデータを直接埋め込む操作はパス監査だけでは判別できないため、公開前に変更内容も確認します。

実データ・検証スクリプト・取得した大容量モデル・バックアップbundle・node_modules・個別報告書はリポジトリへ含めません。公開するソースには独立した架空データのテストだけを含めます。

## 公式資料

- [GitHub Pagesのカスタムワークフロー](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [ONNX Runtime Webの配信ファイル](https://onnxruntime.ai/docs/tutorials/web/deploy.html)
- [モデルの固定リビジョン](https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3/tree/627aef95638667ddcaa3ac8ae625e88ea5b02f51)
