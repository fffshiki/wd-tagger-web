'use strict';

// Private on-device workspace. Legacy dictionary/teacher/outfit formats stay unchanged.
(() => {
  const format = 'wdtagger_translation_workspace', dbName = 'wdtagger_translation_workspace_v1';
  const states = Object.freeze({ unreviewed: '未確認', adopted: '採用', held: '保留', rejected: '却下' });
  let db, records = new Map(), bindings = new Map(), revision = 0, nextId = 1, ready = false;
  let baseHistoryByTag = new Map();
  let queue = Promise.resolve(), pending = 0, dirty = false, saveFailure = false, draftTimer, editorTag = '', preview = null, imported = null;
  let dictionaryBackup = '', historySequence = 0, importSequence = 0, importedRevision = 0;
  const selected = new Set();
  const panel = document.createElement('section'); panel.id = 'translationWorkspace';
  panel.innerHTML = `<h2>翻訳候補の管理・確認</h2>
    <p>一覧の「候補を編集」から登録します。「採用」と辞書への反映は別操作です。未確認・保留・却下の候補は表示訳を変更しません。</p>
    <p id="workspaceSave" role="status">端末内の作業データを読み込み中…</p><p id="workspaceError" role="alert"></p>
    <p id="workspaceSummary"></p><p id="workspaceNotice" role="status"></p>
    <label>候補の状態で絞り込む<select id="workspaceFilter" class="field" disabled><option value="all">すべて</option><option value="none">候補なし</option>${Object.entries(states).map(([key, value]) => `<option value="${key}">${value}</option>`).join('')}</select></label>
    <div class="workspace-actions"><button id="workspaceSelectPage" type="button" disabled>表示中の候補を選択</button><button id="workspaceClearSelection" type="button" disabled>選択解除</button></div>
    <p id="workspaceSelection">選択0件（ページ・絞り込み変更で解除）</p>
    <div class="workspace-actions"><button id="workspaceBulkAdopt" type="button" disabled>選択候補を採用</button><button id="workspaceBulkHold" type="button" disabled>選択候補を保留</button><button id="workspaceBulkReject" type="button" disabled>選択候補を却下</button></div>
    <div id="workspaceEditor" class="workspace-box" hidden>
      <h3>候補の編集</h3><p>英語タグ：<code id="workspaceTag"></code></p>
      <label>表示方針<select id="workspaceMode" class="field"><option value="japanese">日本語訳を採用する</option><option value="original">原語・記号・正式略語を採用する</option></select></label>
      <label>候補の表示名<textarea id="workspaceText" class="field" maxlength="1000"></textarea></label>
      <p id="workspaceDraft" role="status"></p><p id="workspaceEditorStatus"></p>
      <div class="workspace-actions"><button id="workspaceSaveCandidate" type="button">候補を保存</button><button id="workspaceAdopt" type="button">採用</button><button id="workspaceHold" type="button">保留</button><button id="workspaceReject" type="button">却下</button><button id="workspaceDelete" type="button" class="secondary">候補を削除</button><button id="workspaceClose" type="button" class="secondary">編集を閉じる</button></div>
      <p class="muted">編集した候補は未確認に戻ります。候補の削除・保留・却下は、既に辞書へ反映した訳を取り消しません。</p>
      <details><summary>このタグの編集履歴（最新20件）</summary><ul id="workspaceHistory"></ul></details>
    </div>
    <div class="workspace-actions"><button id="workspaceExport" type="button" disabled>翻訳作業JSONを保存</button><label>翻訳作業JSONを読み込む<input id="workspaceImport" type="file" accept=".json,application/json" disabled></label></div>
    <p class="muted">作業JSONは辞書と別形式です。Safariの保存領域が消える場合に備え「ファイル」に保存してください。原語採用の情報を移す際は辞書JSONと作業JSONの両方が必要です。</p>
    <div id="workspaceImportPreview" class="workspace-box" hidden><p id="workspaceImportSummary"></p><button id="workspaceImportApply" type="button">現在の作業データを置き換えて復元</button></div>
    <div class="workspace-actions"><button id="workspaceDictionaryBackup" type="button" disabled>既存辞書のバックアップを保存</button><button id="workspacePreview" type="button" disabled>採用候補の辞書反映を確認</button></div>
    <div id="workspacePreviewBox" class="workspace-box" hidden><h3>辞書への反映プレビュー</h3><p id="workspacePreviewSummary"></p><ul id="workspaceDiff" class="workspace-preview"></ul>
      <label><input id="workspaceApplyConfirm" type="checkbox"> 既存辞書のバックアップを「ファイル」に保存し、上の変更内容を確認しました</label><button id="workspaceApply" type="button" disabled>確認した変更を辞書へ反映</button></div>`;
  // Keep save warnings and bulk controls above the long paginated list on iPhone.
  $('tagCatalog').before(panel);
  const jump = document.createElement('a'); jump.href = '#translationWorkspace'; jump.textContent = '候補の状態・一括操作・保存へ';
  $('catalogResult').before(jump);
  const byId = id => $(id);
  const error = message => { byId('workspaceError').textContent = message; };
  const req = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const done = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || Error('保存処理が中断されました')); tx.onerror = () => {}; });
  const fingerprint = () => dataCanonical({ envelope: dictionaryEnvelope, registered: v15Custom, cache: v17Cache });
  const now = () => new Date().toISOString();
  function indexBaseHistory(history) {
    baseHistoryByTag = new Map();
    for (const event of history) {
      if (!baseHistoryByTag.has(event.tag)) baseHistoryByTag.set(event.tag, []);
      baseHistoryByTag.get(event.tag).push(event);
    }
  }
  async function readSnapshot() {
    const tx = db.transaction(['entries', 'history', 'bindings', 'meta']);
    const [delta, events, bindingDelta, baseRecord, savedRevision] = await Promise.all([
      req(tx.objectStore('entries').getAll()), req(tx.objectStore('history').getAll()), req(tx.objectStore('bindings').getAll()),
      req(tx.objectStore('meta').get('base')), req(tx.objectStore('meta').get('revision')),
    ]);
    const base = baseRecord?.value || { entries: [], history: [], originalBindings: [] };
    const entries = new Map(base.entries.map(x => [x.tag, x])), originals = new Map(base.originalBindings.map(x => [x.tag, x]));
    for (const item of delta) {
      const record = Object.hasOwn(item, 'record') ? item.record : item;
      record ? entries.set(item.tag, record) : entries.delete(item.tag);
    }
    for (const item of bindingDelta) originals.set(item.tag, item);
    const ordered = map => [...map.values()].sort((a, b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0);
    return { data: { format, version: 1, entries: ordered(entries), history: [...base.history, ...events].sort((a, b) => a.id - b.id), originalBindings: ordered(originals) },
      revision: savedRevision?.value || 0, baseHistory: base.history };
  }
  function invalidate() { preview = null; byId('workspacePreviewBox').hidden = true; byId('workspaceApply').disabled = true; byId('workspaceApplyConfirm').checked = false; }
  function statusText() {
    byId('workspaceSave').textContent = !ready ? '端末内保存を利用できません。再読み込み後に再試行してください。' :
      dirty || pending ? '未保存の変更があります／保存処理中…画面を閉じずにお待ちください。' : saveFailure ? '保存に失敗した操作があります。警告を確認し、作業JSONで保全してください。' : '端末内に自動保存済み。作業JSONのバックアップも保存してください。';
    byId('workspaceDraft').textContent = dirty ? '候補を保存中…（まだ画面を閉じないでください）' : '';
  }
  function enqueue(operation) {
    pending++; statusText();
    const task = queue.then(operation);
    queue = task.catch(() => {});
    return task.catch(e => { saveFailure = true; error(`保存・更新に失敗：${e.message} 未保存の編集は作業JSONまたは候補のコピーで保全し、再試行してください。`); throw e; })
      .finally(() => { pending--; statusText(); });
  }
  async function commit(changes = [], events = [], bindingChanges = [], replacement = null) {
    if (!ready) throw Error('端末内保存を利用できません');
    const tx = db.transaction(['entries', 'history', 'bindings', 'meta'], 'readwrite'), completion = done(tx);
    let conflict = false, storageError;
    tx.objectStore('meta').get('revision').onsuccess = event => {
      try {
      if ((event.target.result?.value || 0) !== revision) { conflict = true; tx.abort(); return; }
      if (replacement) {
        for (const name of ['entries', 'history', 'bindings']) tx.objectStore(name).clear();
        // One atomic checkpoint avoids thousands of individual WebKit IDB writes.
        // Later edits use small per-tag deltas and append-only history records.
        tx.objectStore('meta').put({ key: 'base', value: replacement });
      } else {
        for (const [tag, value] of changes) tx.objectStore('entries').put({ tag, record: value });
        for (const event of events) tx.objectStore('history').put(event);
        for (const binding of bindingChanges) tx.objectStore('bindings').put(binding);
      }
      tx.objectStore('meta').put({ key: 'revision', value: revision + 1 });
      } catch (e) { storageError = e; tx.abort(); }
    };
    try { await completion; } catch (e) { throw conflict ? Error('別タブで作業データが更新されています。このタブの候補をコピーしてから再読み込みしてください。') : storageError || e; }
    revision++; saveFailure = false; error('');
    if (replacement) {
      records = new Map(replacement.entries.map(x => [x.tag, x])); bindings = new Map(replacement.originalBindings.map(x => [x.tag, x]));
      indexBaseHistory(replacement.history);
      nextId = replacement.history.reduce((max, event) => Math.max(max, event.id), 0) + 1;
    } else {
      for (const [tag, value] of changes) value ? records.set(tag, value) : records.delete(tag);
      for (const binding of bindingChanges) bindings.set(binding.tag, binding);
      nextId += events.length;
    }
    invalidate(); refresh();
  }
  function eventFor(action, tag, detail, offset = 0) { return { id: nextId + offset, time: now(), action, tag, detail }; }
  function validCandidate(record) {
    if (!record?.text?.trim() || v17Bad.test(record.text)) return false;
    return record.mode === 'original' || /[\u3040-\u30ff\u3400-\u9fff]/.test(record.text);
  }
  function edit(tag, text, mode) {
    return enqueue(async () => {
      const before = records.get(tag) || null;
      if (!text.trim()) throw Error('候補が空です。消す場合は「候補を削除」を使ってください。');
      if (text.length > 1000 || !['japanese', 'original'].includes(mode)) throw Error('候補の入力が不正です');
      if (before?.text === text && before.mode === mode) return;
      const after = { ...before, tag, text, mode, status: 'unreviewed', updatedAt: now() };
      await commit([[tag, after]], [eventFor(before ? 'edit' : 'create', tag, { before, after })]);
    });
  }
  function setStates(tags, state) {
    return enqueue(async () => {
      if (!Object.hasOwn(states, state)) throw Error('状態が不正です');
      const changes = [], events = [];
      for (const tag of new Set(tags)) {
        const before = records.get(tag); if (!before) throw Error('候補がないタグは状態を変更できません');
        if (state === 'adopted' && !validCandidate(before)) throw Error(`${tag}：日本語候補を入力するか、原語・正式略語の方針を選んでください`);
        if (before.status === state) continue;
        const after = { ...before, status: state, updatedAt: now() };
        changes.push([tag, after]); events.push(eventFor('status', tag, { before, after }, events.length));
      }
      await commit(changes, events);
    });
  }
  async function historyFor(tag) {
    const requestId = ++historySequence, tx = db.transaction('history');
    const index = tx.objectStore('history').index('tag'), cursor = index.openCursor(IDBKeyRange.only(tag), 'prev'), items = [];
    await new Promise((resolve, reject) => {
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => { const entry = cursor.result; if (!entry || items.length >= 20) return resolve(); items.push(entry.value); entry.continue(); };
    });
    if (requestId !== historySequence || editorTag !== tag) return;
    const combined = [...items, ...(baseHistoryByTag.get(tag) || [])].sort((a, b) => b.id - a.id).slice(0, 20);
    byId('workspaceHistory').replaceChildren(...combined.map(item => {
      const li = document.createElement('li'); li.textContent = `${item.time} ${item.action}：${JSON.stringify(item.detail)}`; return li;
    }));
  }
  function refresh() {
    const counts = Object.fromEntries(Object.keys(states).map(key => [key, 0])); for (const record of records.values()) counts[record.status]++;
    byId('workspaceSummary').textContent = `作業候補 ${records.size}件 ｜ ` + Object.entries(counts).map(([key, value]) => `${states[key]} ${value}件`).join(' / ') + '（CSV外の保管候補も含む）';
    WDTagCatalog.refreshView();
    if (editorTag) {
      byId('workspaceEditorStatus').textContent = `状態：${records.has(editorTag) ? states[records.get(editorTag).status] : '候補なし'}`;
      historyFor(editorTag).catch(e => error('履歴の読み込みに失敗：' + e.message));
    }
  }
  function selectionText() { byId('workspaceSelection').textContent = `選択${selected.size}件（ページ・絞り込み変更で解除）`; }
  function decorate() {
    selected.clear(); selectionText();
    const visible = WDTagCatalog.visible();
    for (const item of byId('catalogList').children) {
      const entry = visible.find(x => x.index === Number(item.dataset.index)); if (!entry) continue;
      const record = records.get(entry.name), label = document.createElement('label'); label.className = 'candidate-select';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.candidateTag = entry.name;
      checkbox.disabled = !ready || !record;
      checkbox.addEventListener('change', () => {
        checkbox.checked ? selected.add(entry.name) : selected.delete(entry.name);
        for (const duplicate of byId('catalogList').querySelectorAll('input[data-candidate-tag]')) if (duplicate.dataset.candidateTag === entry.name) duplicate.checked = checkbox.checked;
        selectionText();
      });
      label.append(checkbox, document.createTextNode('一括操作の対象に選択')); item.appendChild(label);
      const status = document.createElement('p'); status.className = 'candidate-status';
      status.textContent = record ? `候補：${record.text} / ${states[record.status]} / ${record.mode === 'original' ? '原語・略語' : '日本語'}` : '候補なし'; item.appendChild(status);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'candidate-edit'; button.disabled = !ready; button.textContent = '候補を編集';
      button.addEventListener('click', () => openEditor(entry.name).catch(() => {})); item.appendChild(button);
    }
  }
  async function openEditor(tag) {
    await flushDraft(); editorTag = tag;
    const record = records.get(tag);
    byId('workspaceTag').textContent = tag; byId('workspaceText').value = record?.text || '';
    byId('workspaceMode').value = record?.mode || 'japanese'; byId('workspaceEditor').hidden = false;
    refresh(); byId('workspaceEditor').scrollIntoView({ block: 'start' });
  }
  async function flushDraft() {
    clearTimeout(draftTimer); if (!dirty || !editorTag) return;
    const tag = editorTag, text = byId('workspaceText').value, mode = byId('workspaceMode').value;
    await edit(tag, text, mode);
    if (editorTag === tag && byId('workspaceText').value === text && byId('workspaceMode').value === mode) dirty = false;
    statusText();
  }
  function draftChanged() {
    dirty = true; invalidate(); statusText(); clearTimeout(draftTimer);
    draftTimer = setTimeout(() => flushDraft().catch(() => {}), 250);
  }
  async function backup() {
    let draft = null;
    try { await flushDraft(); } catch {
      if (dirty && editorTag && byId('workspaceText').value.trim()) draft = { tag: editorTag, text: byId('workspaceText').value, mode: byId('workspaceMode').value, status: 'unreviewed', updatedAt: now() };
      else throw Error('未保存の候補をコピーしてください');
    }
    await queue;
    if (!db) throw Error('作業データを開けません');
    const { data: { entries, history, originalBindings } } = await readSnapshot();
    if (draft) {
      const position = entries.findIndex(x => x.tag === draft.tag);
      if (position < 0) entries.push(draft); else entries[position] = draft;
      entries.sort((a, b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0);
      history.push({ id: history.reduce((max, event) => Math.max(max, event.id), 0) + 1, time: now(), action: 'unsaved_draft_export', tag: draft.tag, detail: { after: draft } });
      error('端末内には未保存ですが、入力中の候補を作業JSONに含めました。「ファイル」への保存を確認してください。');
    }
    return { format, version: 1, entries, history, originalBindings };
  }
  function validateBackup(raw) {
    const object = x => x && typeof x === 'object' && !Array.isArray(x);
    if (!object(raw) || raw.format !== format || raw.version !== 1 || Object.keys(raw).some(key => !['format', 'version', 'entries', 'history', 'originalBindings'].includes(key))) throw Error('対応していない作業JSONです');
    const tagValid = tag => typeof tag === 'string' && Boolean(tag.trim()) && tag.length <= 500;
    for (const field of ['entries', 'history', 'originalBindings']) if (!Array.isArray(raw[field])) throw Error('作業JSONの配列が不正です');
    for (const entry of raw.entries) if (!object(entry) || !tagValid(entry.tag) || typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 1000 || !['japanese', 'original'].includes(entry.mode) || !Object.hasOwn(states, entry.status) || typeof entry.updatedAt !== 'string' || (entry.status === 'adopted' && !validCandidate(entry))) throw Error('候補データが不正です');
    for (const event of raw.history) if (!object(event) || !Number.isSafeInteger(event.id) || event.id < 1 || !tagValid(event.tag) || typeof event.action !== 'string' || typeof event.time !== 'string' || !object(event.detail)) throw Error('履歴データが不正です');
    for (const binding of raw.originalBindings) if (!object(binding) || !tagValid(binding.tag) || typeof binding.value !== 'string' || !binding.value.trim() || v17Bad.test(binding.value)) throw Error('原語採用の記録が不正です');
    for (const [field, key] of [['entries', 'tag'], ['history', 'id'], ['originalBindings', 'tag']]) if (new Set(raw[field].map(x => x[key])).size !== raw[field].length) throw Error('作業JSONに重複した識別子があります');
    return structuredClone(raw);
  }
  function makePreview() {
    const csvTags = new Set(WDTagCatalog.snapshot().map(x => x.name)), changes = [], skipped = [];
    for (const record of records.values()) {
      if (record.status !== 'adopted') continue;
      const tag = record.tag, value = record.text.trim(), current = Object.hasOwn(v15Custom, tag) ? v15Custom[tag] : undefined;
      let reason = '';
      if (!csvTags.has(tag)) reason = '現在のCSVにないため保管のみ';
      else if (current === value && !(record.mode === 'original' && !isAdoptedLatinTranslation(tag, value))) reason = '同じ登録値のため変更なし';
      // Legacy JSON has no manual-edit provenance. Conservatively protect every
      // nonempty, non-provisional registered spelling, including unclassified Latin.
      else if (current !== undefined && current !== value && current.trim() && classifyTranslationValue(tag, current) !== 'provisional') reason = '既存の手動訳・登録訳を保護';
      if (reason) skipped.push({ tag, reason });
      else changes.push({ tag, value, mode: record.mode, before: current ?? null });
    }
    return { revision, fingerprint: fingerprint(), changes, skipped };
  }
  function showPreview() {
    preview = makePreview(); byId('workspacePreviewBox').hidden = false; byId('workspaceApplyConfirm').checked = false;
    byId('workspacePreviewSummary').textContent = `変更 ${preview.changes.length}件 / 保護・変更なし・CSV外 ${preview.skipped.length}件。既存訳は上書きしません。全変更は翻訳作業JSONにも履歴を残します。`;
    byId('workspaceDiff').replaceChildren();
    // Bound the preview DOM too. Full change data is included in the downloadable review file.
    for (const change of [...preview.changes.map(x => `${x.tag}：${x.before === null ? '未登録' : x.before} → ${x.value}`), ...preview.skipped.map(x => `${x.tag}：${x.reason}`)].slice(0, 100)) {
      const li = document.createElement('li'); li.textContent = change; byId('workspaceDiff').appendChild(li);
    }
    if (preview.changes.length + preview.skipped.length > 100) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '全件の差分JSONを保存（画面は先頭100件）';
      button.addEventListener('click', () => v16Download('WDTagger_辞書反映差分.json', { changes: preview.changes, skipped: preview.skipped })); byId('workspaceDiff').appendChild(button);
    }
    applyEnabled();
  }
  function applyEnabled() { byId('workspaceApply').disabled = !preview?.changes.length || !byId('workspaceApplyConfirm').checked || dictionaryBackup !== fingerprint(); }
  async function reflect() {
    await flushDraft();
    return enqueue(async () => {
      const plan = preview;
      if (!plan || plan.revision !== revision || plan.fingerprint !== fingerprint() || dictionaryBackup !== fingerprint() || !byId('workspaceApplyConfirm').checked) throw Error('候補または辞書が更新されました。バックアップとプレビューをやり直してください');
      const newBindings = plan.changes.filter(x => x.mode === 'original').map(x => ({ tag: x.tag, value: x.value }));
      // Journal the request first, but only activate original spellings after both
      // dictionary storage and the completion transaction have succeeded.
      await commit([], plan.changes.map((x, i) => eventFor('dictionary_reflection_requested', x.tag, { before: x.before, after: x.value, mode: x.mode }, i)));
      if (plan.fingerprint !== fingerprint()) throw Error('反映直前に辞書が変わりました。反映していません');
      const previous = v15Custom;
      v15Custom = Object.assign(Object.create(null), previous, Object.fromEntries(plan.changes.map(x => [x.tag, x.value])));
      if (!v15Save()) { v15Custom = previous; throw Error('辞書の端末保存に失敗しました。辞書への変更を取り消しました。反映要求履歴だけを保存しています'); }
      dictionaryBackup = '';
      try { await commit([], plan.changes.map((x, i) => eventFor('dictionary_reflection_completed', x.tag, { value: x.value }, i)), newBindings); }
      catch (e) { v15Refresh(); throw Error('辞書の文字列は保存済みですが、原語採用・完了履歴を保存できませんでした。作業JSONと辞書を保存し、反映を再確認してください：' + e.message); }
      v15Refresh();
      byId('workspaceNotice').textContent = `${plan.changes.length}件を辞書に反映しました。辞書JSONと翻訳作業JSONを保存してください。`;
    });
  }
  const previousAdopted = isAdoptedLatinTranslation;
  isAdoptedLatinTranslation = function (tag, value) {
    return previousAdopted(tag, value) || (ready && bindings.has(tag) && bindings.get(tag).value === value && Object.hasOwn(v15Custom, tag) && v15Custom[tag] === value);
  };
  const previousRefresh = v15Refresh;
  v15Refresh = function () { previousRefresh(); invalidate(); if (dictionaryBackup !== fingerprint()) dictionaryBackup = ''; };
  window.addEventListener('wdtagcatalogrender', decorate);
  byId('workspaceFilter').addEventListener('change', () => { WDTagCatalog.setViewAdapter(adapter); });
  const adapter = { search: (tag, query) => Boolean(records.get(tag)?.text.toLowerCase().includes(query)), includes: tag => {
    const state = byId('workspaceFilter').value; return state === 'all' || (state === 'none' ? !records.has(tag) : records.get(tag)?.status === state);
  } };
  byId('workspaceText').addEventListener('input', draftChanged); byId('workspaceMode').addEventListener('change', () => {
    if (byId('workspaceMode').value === 'original' && !byId('workspaceText').value.trim()) byId('workspaceText').value = editorTag;
    draftChanged();
  });
  byId('workspaceText').addEventListener('blur', () => flushDraft().catch(() => {}));
  byId('workspaceSaveCandidate').onclick = () => flushDraft().catch(() => {});
  for (const [id, state] of [['workspaceAdopt', 'adopted'], ['workspaceHold', 'held'], ['workspaceReject', 'rejected']]) byId(id).onclick = async () => { const tag = editorTag; try { await flushDraft(); await setStates([tag], state); } catch {} };
  byId('workspaceDelete').onclick = async () => {
    if (!confirm('この候補を削除しますか？編集履歴と反映済み辞書は保持します。')) return;
    const tag = editorTag;
    clearTimeout(draftTimer);
    try { await enqueue(async () => { const before = records.get(tag); if (before) await commit([[tag, null]], [eventFor('delete', tag, { before })]); }); if (editorTag === tag) { byId('workspaceText').value = ''; dirty = false; } statusText(); } catch {}
  };
  byId('workspaceClose').onclick = async () => { try { await flushDraft(); const tag = editorTag; editorTag = ''; byId('workspaceEditor').hidden = true;
    const index = WDTagCatalog.visible().find(x => x.name === tag)?.index;
    const row = [...byId('catalogList').children].find(x => Number(x.dataset.index) === index);
    (row || byId('catalogResult')).scrollIntoView({ block: 'start' });
  } catch {} };
  byId('workspaceSelectPage').onclick = () => {
    for (const checkbox of byId('catalogList').querySelectorAll('input[data-candidate-tag]:not(:disabled)')) { checkbox.checked = true; selected.add(checkbox.dataset.candidateTag); } selectionText();
  };
  byId('workspaceClearSelection').onclick = () => { selected.clear(); for (const checkbox of byId('catalogList').querySelectorAll('input[data-candidate-tag]')) checkbox.checked = false; selectionText(); };
  for (const [id, state] of [['workspaceBulkAdopt', 'adopted'], ['workspaceBulkHold', 'held'], ['workspaceBulkReject', 'rejected']]) byId(id).onclick = async () => {
    const tags = [...selected]; if (!tags.length) { error('候補のあるタグを選択してください'); return; }
    if (!confirm(`表示中に選択した${tags.length}件を「${states[state]}」にしますか？辞書への反映は行いません。`)) return;
    try { await flushDraft(); await setStates(tags, state); } catch {}
  };
  byId('workspaceExport').onclick = async () => { try { v16Download('WDTagger_翻訳作業_v1.json', await backup()); } catch (e) { error('書き出し失敗：' + e.message); } };
  byId('workspaceImport').onchange = async event => {
    const request = ++importSequence;
    imported = null; byId('workspaceImportPreview').hidden = true;
    try { const file = event.target.files?.[0]; if (!file) return; const value = validateBackup(await readDataJson(file));
      await flushDraft(); await queue; if (request !== importSequence) return; imported = value; importedRevision = revision;
      byId('workspaceImportSummary').textContent = `候補${value.entries.length}件・履歴${value.history.length}件・原語反映記録${value.originalBindings.length}件を復元します。現在の作業データを置き換えます。先に作業JSONを保存してください。辞書の内容は変更しません。`;
      byId('workspaceImportPreview').hidden = false;
    } catch (e) { if (request === importSequence) error('読み込み失敗：' + e.message); } finally { if (request === importSequence) event.target.value = ''; }
  };
  byId('workspaceImportApply').onclick = async () => {
    if (!imported) return;
    try { await flushDraft(); const value = imported, expected = importedRevision;
      await enqueue(() => { if (revision !== expected) throw Error('読み込み確認後に作業データが更新されました。JSONを読み込み直してください'); return commit([], [], [], value); });
      imported = null; byId('workspaceImportPreview').hidden = true; editorTag = ''; byId('workspaceEditor').hidden = true; v15Refresh(); } catch {}
  };
  byId('workspaceDictionaryBackup').onclick = async () => {
    try { await flushDraft(); const contents = { ...dictionaryEnvelope, translations: Object.assign(Object.create(null), v17Cache, v15Custom) };
      v16Download('WDTagger_日本語辞書_反映前バックアップ.json', contents); dictionaryBackup = fingerprint(); applyEnabled();
    } catch (e) { error('辞書バックアップ失敗：' + e.message); }
  };
  byId('workspacePreview').onclick = async () => { try { await flushDraft(); await queue; showPreview(); } catch {} };
  byId('workspaceApplyConfirm').onchange = applyEnabled; byId('workspaceApply').onclick = () => reflect().catch(() => {});
  window.addEventListener('beforeunload', event => { if (dirty || pending) { event.preventDefault(); event.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushDraft().catch(() => {}); });
  window.addEventListener('pagehide', () => flushDraft().catch(() => {}));
  window.WDTranslationWorkspace = Object.freeze({
    ready: () => ready, get: tag => structuredClone(records.get(tag) || null), export: backup,
  });
  (async () => {
    try {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore('entries', { keyPath: 'tag' });
        database.createObjectStore('history', { keyPath: 'id' }).createIndex('tag', 'tag');
        database.createObjectStore('bindings', { keyPath: 'tag' }); database.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onblocked = () => error('保存領域が別タブで使用中です。他のWD Taggerタブを閉じて再読み込みしてください');
      db = await req(request);
      db.onversionchange = () => { ready = false; db.close(); error('保存領域が別タブで更新されました。候補をコピーして再読み込みしてください'); };
      const snapshot = await readSnapshot(), saved = snapshot.data;
      records = new Map(saved.entries.map(x => [x.tag, x])); bindings = new Map(saved.originalBindings.map(x => [x.tag, x]));
      indexBaseHistory(snapshot.baseHistory); revision = snapshot.revision;
      nextId = saved.history.reduce((max, event) => Math.max(max, event.id), 0) + 1; ready = true;
      for (const element of panel.querySelectorAll('[disabled]')) element.disabled = false;
      byId('workspaceApply').disabled = true; WDTagCatalog.setViewAdapter(adapter); refresh(); statusText(); v15Refresh();
    } catch (e) { ready = false; error('端末内の自動保存を開始できません：' + e.message + '。候補を登録せず、保存領域を確認して再読み込みしてください。'); statusText(); }
  })();
})();
