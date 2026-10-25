'use strict';

// Public upstream artifacts only. No user images, labels or dictionaries are requested.
const wdModelSource = Object.freeze({
  repository: 'SmilingWolf/wd-swinv2-tagger-v3',
  revision: '627aef95638667ddcaa3ac8ae625e88ea5b02f51',
  modelBytes: 467460978,
  modelSha256: 'e6774bff34d43bd49f75a47db4ef217dce701c9847b546523eb85ff6dbba1db1',
  csvSha256: '298633d94d0031d2081c0893f29c82eab7f0df00b08483ba8f29d1e979441217',
});
function wdModelUrl(filename) {
  if (!['model.onnx', 'selected_tags.csv'].includes(filename)) throw Error('配布ファイル名が不正です');
  return `https://huggingface.co/${wdModelSource.repository}/resolve/${wdModelSource.revision}/${filename}?download=true`;
}
const sourcePanel = document.createElement('section');
sourcePanel.id = 'modelSources';
const sourceHeading = document.createElement('strong');
sourceHeading.textContent = '初回のモデル・CSVの準備';
const sourceHelp = document.createElement('p');
sourceHelp.textContent = '下の公式ファイルを「ファイル」へ保存し、①②で選択してください。モデルは約467MBです。保存済みのファイルを引き続き選ぶこともできます。画像解析は端末内で行います。';
const sourceActions = document.createElement('div');
sourceActions.className = 'actions';
for (const [filename, label] of [['model.onnx', 'モデルをダウンロード（約467MB）'], ['selected_tags.csv', 'CSVをダウンロード（約308KB）']]) {
  const link = document.createElement('a');
  link.href = wdModelUrl(filename); link.textContent = label; link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.style.cssText = 'display:inline-block;padding:12px;background:#155fbb;color:white;border-radius:10px;text-decoration:none;overflow-wrap:anywhere';
  sourceActions.appendChild(link);
}
const sourceLicense = document.createElement('p');
const licenseLink = document.createElement('a');
licenseLink.href = `https://huggingface.co/${wdModelSource.repository}/blob/${wdModelSource.revision}/README.md`;
licenseLink.textContent = 'モデル配布元・ライセンス（Apache-2.0）'; licenseLink.target = '_blank'; licenseLink.rel = 'noopener noreferrer';
sourceLicense.appendChild(licenseLink);
sourcePanel.append(sourceHeading, sourceHelp, sourceActions, sourceLicense);
$('model').closest('section').before(sourcePanel);
