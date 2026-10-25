'use strict';

// A small, isolated migration layer. The three original v18 scripts remain byte-identical.
const migrationBox = document.createElement('section');
migrationBox.id = 'migrationProtection';
const migrationTitle = document.createElement('strong');
migrationTitle.textContent = '既存JSONの学習情報を保護';
const migrationHelp = document.createElement('p');
migrationHelp.className = 'muted';
migrationHelp.textContent = '既存JSONを読み込んだ場合、通常の保存ではAI予測だけを更新し、元のreview・training_labelsを含む他の項目を保持します。判定結果から学習情報を作り直す場合のみ、下のチェックを有効にしてください。元のファイルは自動上書きされません。';
const migrationLabel = document.createElement('label');
const regenerateReview = document.createElement('input');
regenerateReview.type = 'checkbox';
regenerateReview.id = 'regenerateReview';
migrationLabel.append(regenerateReview, ' 今回の判定で既存JSONのreview・training_labelsを再生成する');
const migrationStatus = document.createElement('p');
migrationStatus.id = 'migrationStatus';
migrationStatus.className = 'muted';
migrationBox.append(migrationTitle, migrationHelp, migrationLabel, migrationStatus);
$('existingInfo').after(migrationBox);

function updateMigrationProtection() {
  const loaded = Boolean(existingJson);
  regenerateReview.disabled = !loaded;
  $('trainingApprove').disabled = loaded && !regenerateReview.checked;
  if (loaded && !regenerateReview.checked) $('trainingApprove').checked = false;
  migrationStatus.textContent = !loaded
    ? '新規作成：従来どおり、編集確認と学習用承認を分けて保存します。'
    : regenerateReview.checked
      ? '再生成を選択中。学習用ラベルの出力には、編集確認と学習用承認の両方が必要です。未確認・不要・未判定の手動追加は学習対象外です。'
      : '保護中：元のreview・training_labelsは、項目が存在しない場合も含めて保持します。新しい判定はai_prediction内の提案として保存します。';
}
regenerateReview.addEventListener('change', () => { updateMigrationProtection(); markDirty(); });
const migrationRenderEditor = renderEditor;
renderEditor = function () { migrationRenderEditor(); updateMigrationProtection(); };
const migrationResetForNewImage = resetForNewImage;
resetForNewImage = function () {
  migrationResetForNewImage();
  regenerateReview.checked = false;
  updateMigrationProtection();
};
$('existing').addEventListener('change', () => {
  // v18 reads the file asynchronously. Reset permission immediately; refresh after its read settles.
  regenerateReview.checked = false;
  updateMigrationProtection();
});
new MutationObserver(updateMigrationProtection).observe($('existingInfo'), { childList: true, characterData: true, subtree: true });

const migrationBuildJson = buildJson;
buildJson = function () {
  const proposed = migrationBuildJson();
  if (!existingJson) return proposed;
  // Clone first: importing, rendering and exporting must never mutate the source object.
  const output = structuredClone(existingJson);
  output.ai_prediction = structuredClone(proposed.ai_prediction);
  if (regenerateReview.checked) {
    // This is the only existing-record path that replaces review/training metadata.
    output.schema_version = proposed.schema_version;
    output.review = structuredClone(proposed.review);
    output.training_labels = structuredClone(proposed.training_labels);
    output.excluded_tags = structuredClone(proposed.excluded_tags);
  }
  return output;
};
updateMigrationProtection();
