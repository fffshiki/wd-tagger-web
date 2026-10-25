'use strict';

// Keep the original v18 scripts unchanged. All migration behavior lives here.
const migrationBox = document.createElement('section');
migrationBox.id = 'migrationProtection';
migrationBox.innerHTML = '<strong>既存JSONの学習情報を保護</strong><p class="muted">JSONだけで保存済みの判定を確認できます。未編集の保存では全項目を保持します。判定や項目を編集した場合も、通常はAI提案欄だけを更新し、元のreview・training_labelsは保持します。</p><p id="storedTrainingStatus" role="status"></p><label><input type="checkbox" id="regenerateReview"> 今回の判定で既存JSONのreview・training_labelsを再生成する</label><p id="migrationStatus" class="muted"></p>';
$('existingInfo').after(migrationBox);
const regenerateReview = $('regenerateReview');
const migrationStatuses = ['accepted', 'rejected', 'pending', 'excluded'];
let migrationInitialView = null;
let migrationNewPredictions = null;
let migrationImporting = false;
let migrationLoadSequence = 0;

function migrationList(value) { return Array.isArray(value) ? value.filter(x => typeof x === 'string') : []; }
function migrationRows(json) {
  const rows = new Map();
  const add = item => {
    if (!item || typeof item.name !== 'string' || !item.name.trim()) return;
    const category = item.category ?? 'unknown';
    const key = String(category) + '\u0000' + item.name;
    if (!rows.has(key)) rows.set(key, { name: item.name, category, score: Number.isFinite(item.score) ? item.score : undefined });
  };
  for (const item of Array.isArray(json.ai_prediction?.raw_predictions) ? json.ai_prediction.raw_predictions : []) add(item);
  for (const item of Array.isArray(json.ai_prediction?.review_states) ? json.ai_prediction.review_states : []) {
    const known = [...rows.values()].filter(x => x.name === item?.name);
    add({ ...item, category: item?.category ?? (known.length === 1 ? known[0].category : undefined) });
  }
  const addNames = values => {
    for (const name of migrationList(values)) if (![...rows.values()].some(x => x.name === name)) add({ name });
  };
  for (const status of migrationStatuses) {
    addNames(json.ai_prediction?.tag_review?.[status]);
    addNames(json.review?.[status + '_tags']);
  }
  // Old confirmed_tags can contain automatic suggestions; display them, never infer approval.
  addNames(json.confirmed_tags); addNames(json.rejected_tags); addNames(json.excluded_tags);
  return [...rows.values()];
}

function migrationReviewStatus(name, category) {
  const json = existingJson;
  if (!json) return 'pending';
  const candidates = (Array.isArray(json.ai_prediction?.review_states) ? json.ai_prediction.review_states : [])
    .filter(x => x?.name === name && (x.category == null || String(x.category) === String(category)) && migrationStatuses.includes(x.status));
  const explicit = [...new Set(candidates.map(x => x.status))];
  if (explicit.length) return explicit.length === 1 ? explicit[0] : 'pending';
  for (const source of [json.ai_prediction?.tag_review, json.review]) {
    const found = migrationStatuses.filter(status => migrationList(source?.[status] ?? source?.[status + '_tags']).includes(name));
    if (found.length) return found.length === 1 ? found[0] : 'pending';
  }
  return migrationList(json.excluded_tags).includes(name) ? 'excluded' : 'pending';
}

restoreReviewStates = function () {
  for (const element of document.querySelectorAll('#editor .review-state')) {
    element.value = migrationReviewStatus(element.dataset.tag, element.dataset.category);
  }
};

function migrationCurrentView() {
  return {
    states: [...document.querySelectorAll('#editor .review-state')].map(el => ({ name: el.dataset.tag, category: el.dataset.category, status: el.value })),
    fields: getFieldValues(), character_name: $('charName').value.trim(), series: $('series').value.trim(),
    notes: $('notes').value, custom: $('custom').value.split(',').map(x => x.trim()).filter(Boolean),
  };
}
function migrationEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function updateMigrationProtection() {
  const loaded = Boolean(existingJson);
  regenerateReview.disabled = !loaded;
  $('trainingApprove').disabled = loaded && !regenerateReview.checked;
  if (loaded && !regenerateReview.checked) $('trainingApprove').checked = false;
  const training = existingJson?.training_labels;
  const flag = existingJson?.review?.approved_for_training;
  const statusApproved = ['approved', 'partially_approved'].includes(training?.status);
  const savedState = statusApproved && flag === true ? '学習承認済み'
    : statusApproved || flag === true ? '承認情報の組み合わせを要確認（元の値を保持）'
      : training || existingJson?.review ? '学習未承認' : '承認情報なし（旧形式）';
  $('storedTrainingStatus').textContent = loaded
    ? `保存済み：${savedState} / training_labels.status: ${training?.status ?? 'なし'} / review.approved_for_training: ${flag ?? 'なし'}` : '';
  $('migrationStatus').textContent = !loaded
    ? '新規作成：編集確認と学習用承認を分けて保存します。'
    : regenerateReview.checked
      ? '再生成を選択中。下の確認・承認チェックは今回作り直す情報に対する操作です。学習用ラベルの出力には両方のチェックが必要です。'
      : '保護中：保存済みの承認状態は上に表示しています。下の学習用承認チェックは再生成用で、元の承認を解除する操作ではありません。';
}
regenerateReview.addEventListener('change', () => { updateMigrationProtection(); markDirty(); });

const migrationRenderEditor = renderEditor;
renderEditor = function () {
  if (existingJson && analysisBusy && !migrationImporting) migrationNewPredictions = structuredClone(lastTags);
  migrationRenderEditor();
  if (existingJson) {
    // v16 restores excluded after the old three-state restorer. Apply the complete policy last.
    restoreReviewStates(); updateReviewSummary();
    for (const label of document.querySelectorAll('#editor [data-v15-label]')) {
      const row = lastTags.find(x => x.name === label.dataset.v15Label);
      if (row && !Number.isFinite(row.score)) label.textContent = translateTag(row.name) + '（保存スコアなし）';
    }
  }
  updateMigrationProtection();
};

const migrationResetForNewImage = resetForNewImage;
resetForNewImage = function () {
  ++migrationLoadSequence;
  migrationResetForNewImage();
  migrationInitialView = null; migrationNewPredictions = null;
  regenerateReview.checked = false;
  updateMigrationProtection();
};

// Capture replaces v18's asynchronous import handler, so there is one owner of import state.
$('existing').addEventListener('change', async event => {
  event.stopImmediatePropagation();
  const sequence = ++migrationLoadSequence;
  const file = event.target.files[0];
  if (analysisBusy) { $('existingInfo').textContent = '解析中はJSONを読み込めません。解析完了後に選び直してください。'; return; }
  if (dirty && !confirm('未保存の編集があります。別のJSONを読み込むと編集内容が失われます。続けますか？')) {
    event.target.value = ''; return;
  }
  regenerateReview.checked = false; $('trainingApprove').checked = false; $('confirm').checked = false;
  existingJson = null; migrationInitialView = null; migrationNewPredictions = null;
  lastTags = [];
  $('export').disabled = true; $('copyjson').disabled = true; $('copy').hidden = true;
  $('editor').textContent = 'JSONを読み込み中…'; $('jpEditor').replaceChildren();
  $('charName').value = ''; $('series').value = ''; $('notes').value = ''; $('custom').value = '';
  $('protect').textContent = '';
  updateMigrationProtection();
  try {
    if (!file) { $('existingInfo').textContent = '未選択：新規作成モード'; $('editor').textContent = 'まず画像を解析してください。'; clearDirty(); return; }
    const json = JSON.parse(await file.text());
    if (sequence !== migrationLoadSequence) return;
    if (!json || typeof json !== 'object' || Array.isArray(json) || typeof json.image_id !== 'string' || !json.image_id.trim()) throw Error('image_idを持つ教師JSONではありません');
    const image = $('img').files[0];
    if (image && json.image_id !== image.name.replace(/\.[^.]+$/, '')) throw Error('画像IDが一致しません。正しい画像のJSONを選択してください');
    existingJson = json;
    lastTags = migrationRows(json);
    const character = Array.isArray(json.characters) ? json.characters[0] : null;
    const suggestions = json.ai_prediction?.structured_suggestions || {};
    $('charName').value = character?.name || suggestions.character_name || '';
    $('series').value = character?.series || suggestions.series || '';
    $('notes').value = typeof json.notes === 'string' ? json.notes : '';
    $('custom').value = migrationList(json.ai_prediction?.additional_tags ?? json.review?.manual_additions).join(', ');
    migrationImporting = true;
    try { renderEditor(); } finally { migrationImporting = false; }
    for (const [key] of fieldDefs) if (Array.isArray(suggestions[key]) && $('jp_' + key)) $('jp_' + key).value = suggestions[key].join('、');
    migrationInitialView = migrationCurrentView();
    $('tagsOut').textContent = 'JSONに保存されたタグを表示中です。新たな画像解析は実行していません。';
    $('protect').textContent = '保護：未編集の保存では全項目を保持します。通常の編集ではAI提案欄のみを更新します。';
    $('existingInfo').textContent = `読み込み成功：${file.name} / 状態：${json.label_status || '不明'} / 保存タグ ${lastTags.length}件`;
    clearDirty(); updateMigrationProtection();
  } catch (error) {
    if (sequence !== migrationLoadSequence) return;
    existingJson = null; lastTags = []; migrationInitialView = null;
    $('existingInfo').textContent = '読み込み失敗：' + error.message;
    $('existing').value = ''; $('editor').textContent = '教師JSONを選び直してください。';
    $('export').disabled = true; $('copyjson').disabled = true;
    clearDirty(); updateMigrationProtection();
  }
}, { capture: true });

function migrationReviewData(view) {
  const groups = Object.fromEntries(migrationStatuses.map(status => [status, view.states.filter(x => x.status === status).map(x => x.name)]));
  const states = view.states.map(item => {
    const row = lastTags.find(x => x.name === item.name && String(x.category) === item.category);
    const state = { name: item.name, status: item.status };
    if (item.category !== '' && Number.isFinite(Number(item.category))) state.category = Number(item.category);
    if (Number.isFinite(row?.score)) state.score = Math.round(row.score * 10000) / 10000;
    return state;
  });
  return { groups, states };
}

const migrationBuildJson = buildJson;
buildJson = function () {
  if (!existingJson) return migrationBuildJson();
  const view = migrationCurrentView();
  const output = structuredClone(existingJson);
  const changed = !migrationEqual(view, migrationInitialView);
  if (!changed && !migrationNewPredictions && !regenerateReview.checked) return output;
  const { groups, states } = migrationReviewData(view);
  const ai = output.ai_prediction && typeof output.ai_prediction === 'object' && !Array.isArray(output.ai_prediction) ? output.ai_prediction : {};
  if (!migrationEqual(view.states, migrationInitialView?.states) || migrationNewPredictions || regenerateReview.checked) {
    ai.review_states = states; ai.tag_review = groups;
    ai.reviewed = states.length > 0 && groups.pending.length === 0;
  }
  if (migrationNewPredictions) {
    ai.raw_predictions = migrationNewPredictions.map(({ name, category, score }) => ({ name, category, score: Math.round(score * 10000) / 10000 }));
    ai.model = 'SmilingWolf/wd-swinv2-tagger-v3'; ai.source = 'local_onnx_wasm';
  }
  const fieldView = x => ({ fields: x?.fields, character_name: x?.character_name, series: x?.series, notes: x?.notes });
  if (!migrationEqual(fieldView(view), fieldView(migrationInitialView))) {
    ai.structured_suggestions = { ...ai.structured_suggestions, ...view.fields, character_name: view.character_name, series: view.series };
    if (view.notes !== migrationInitialView?.notes) ai.structured_suggestions.notes = view.notes;
  }
  if (!migrationEqual(view.custom, migrationInitialView?.custom)) ai.additional_tags = view.custom;
  output.ai_prediction = ai;
  if (regenerateReview.checked) {
    const approval = $('trainingApprove').checked;
    if (approval && !$('confirm').checked) throw Error('学習用に承認する前に「編集内容を確認済みとして保存」をチェックしてください。');
    if (approval && !groups.accepted.length && !groups.rejected.length) throw Error('少なくとも1件のタグを正しい・間違いに判定してください。');
    output.schema_version = '1.2';
    output.review = {
      status: !states.length ? 'not_started' : !groups.pending.length ? 'complete' : groups.accepted.length || groups.rejected.length || groups.excluded.length ? 'partial' : 'not_started',
      approved_for_training: approval, accepted_tags: groups.accepted, rejected_tags: groups.rejected,
      pending_tags: groups.pending, excluded_tags: groups.excluded, manual_additions: view.custom,
      approval_scope: approval ? 'reviewed_tags_only' : 'none', note: 'Excluded and pending tags are not used for training.',
    };
    output.training_labels = {
      status: approval ? groups.pending.length ? 'partially_approved' : 'approved' : 'not_approved',
      source: 'human_tag_review', accepted_tags: approval ? [...new Set(groups.accepted)] : [], rejected_tags: approval ? [...new Set(groups.rejected)] : [],
      pending_count: groups.pending.length, structured_fields_status: 'unverified_suggestions',
      manual_additions_status: view.custom.length ? 'not_approved' : 'none', approval_scope: approval ? 'reviewed_tags_only' : 'none',
    };
    if (existingJson.label_status === 'user_confirmed') output.training_labels.legacy_fields_protected = true;
    output.excluded_tags = groups.excluded;
  }
  return output;
};
updateMigrationProtection();

// v18's batch index counted every state other than accepted/rejected as pending.
// Keep its output shape, but exclude the explicitly excluded status from that count.
const migrationBatchAnalyze = v11Analyze;
v11Analyze = function (json, file) {
  const result = migrationBatchAnalyze(json, file);
  const states = json.ai_prediction?.review_states;
  if (Array.isArray(states) && states.length) {
    const decided = new Set(states.filter(x => x && ['accepted', 'rejected'].includes(x.status)).map(x => x.name));
    result.pending = v11Unique(states.filter(x => x && !['accepted', 'rejected', 'excluded'].includes(x.status)).map(x => x.name)).filter(name => !decided.has(name)).length;
  }
  return result;
};
