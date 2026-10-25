'use strict';

// Read-only projection of CSV + existing translations. No dictionary/storage writes.
// Candidate generation and human confirmation belong to a separate future workspace,
// never to v15Custom or teacher review/training_labels.
(() => {
  const labels = Object.freeze({
    japanese_present: '日本語訳あり', adopted_latin: '採用済み略語',
    provisional: '暫定訳', untranslated: '未翻訳', needs_review: '表記の要確認',
  });
  const sources = Object.freeze({ registered: '登録辞書', cache: 'オンラインキャッシュ', local_rule: '端末内ルール', builtin: '内蔵辞書', raw: '原語表示' });
  const categoryGroups = new Map([['0', 'general'], ['4', 'character'], ['9', 'rating']]);
  const groupOf = category => categoryGroups.get(String(category)) || 'other';
  const groups = Object.freeze({ general: '一般', character: 'キャラクター', rating: 'レーティング', other: 'その他' });
  const statusCounts = () => Object.fromEntries(Object.keys(labels).map(key => [key, 0]));
  let rows = [], entries = [], sequence = 0, pageNumber = 1, searchTimer, refreshTimer;
  const pageSize = 50;

  function project(input) {
    return getTranslationCatalog(input).map(row => {
      const unresolved = row.source === 'raw';
      const status = unresolved ? row.registeredStatus : row.displayStatus;
      return Object.freeze({ ...row, status, unresolved, group: groupOf(row.category),
        protectedExisting: row.registeredStatus === 'japanese_present' || row.registeredStatus === 'adopted_latin',
        // A suggestion is not permission to accept the original spelling.
        originalSuggestion: /^[\d\s\p{P}\p{S}]+$/u.test(row.name) ? 'symbol_or_number' : null,
        // Kept separate from dictionary fields; no inferred human confirmation.
        workflow: Object.freeze({ confirmation: 'unreviewed', candidate: null,
          displayPolicy: row.displayStatus === 'adopted_latin' ? 'adopted_spelling' : 'legacy',
          provenance: 'not_recorded' }),
        searchText: [row.name, row.displayed, row.registered || ''].join('\n').toLowerCase(),
      });
    });
  }
  function summarize(input) {
    const counts = statusCounts(), registered = statusCounts(), categories = { general: 0, character: 0, rating: 0, other: 0 };
    let unresolved = 0, protectedExisting = 0, originalSuggestions = 0;
    for (const entry of input) {
      counts[entry.status]++; registered[entry.registeredStatus]++; categories[entry.group]++;
      unresolved += Number(entry.unresolved); protectedExisting += Number(entry.protectedExisting);
      originalSuggestions += Number(Boolean(entry.originalSuggestion));
    }
    return { total: input.length, counts, registered, categories, unresolved, protectedExisting, originalSuggestions };
  }
  function filter(input, options = {}) {
    const query = String(options.query || '').trim().toLowerCase();
    return input.filter(entry => (!query || entry.searchText.includes(query)) &&
      (!options.group || options.group === 'all' || entry.group === options.group) &&
      (!options.status || options.status === 'all' || (options.status === 'unresolved' ? entry.unresolved : entry.status === options.status)) &&
      (!options.source || options.source === 'all' || entry.source === options.source) &&
      (!options.originalOnly || Boolean(entry.originalSuggestion)));
  }

  const panel = document.createElement('section'); panel.id = 'tagCatalog';
  panel.setAttribute('aria-labelledby', 'tagCatalogHeading');
  panel.innerHTML = `<h2 id="tagCatalogHeading">全タグの翻訳状況</h2>
    <p>②のCSVを選ぶと、画像解析なしで全タグを確認できます。辞書の読み込み後は自動で再集計します。この一覧は辞書・教師データを変更しません。</p>
    <p id="catalogLoad" role="status">②でselected_tags.csvを選択してください。</p>
    <div id="catalogSummary"></div>
    <p class="muted">「日本語訳あり」は人による確認済みを意味しません。暫定登録と表示に使われた訳は別に管理します。候補生成・承認は今後追加します。</p>
    <div class="catalog-filters">
      <label>検索（英語・表示名・登録値）<input id="catalogSearch" class="field" type="search" placeholder="例：hair、髪" disabled></label>
      <label>分類<select id="catalogGroup" class="field" disabled><option value="all">すべての分類</option><option value="general">一般</option><option value="character">キャラクター</option><option value="rating">レーティング</option><option value="other">その他</option></select></label>
      <label>翻訳状態<select id="catalogStatus" class="field" disabled><option value="unresolved">原語表示が残る（暫定を含む）</option><option value="all">すべての状態</option>${Object.entries(labels).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
      <label>表示の出典<select id="catalogSource" class="field" disabled><option value="all">すべての出典</option>${Object.entries(sources).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
    </div>
    <label><input id="catalogOriginal" type="checkbox" disabled> 記号・数字のみのタグを抽出（原語採用は未確認）</label>
    <p id="catalogResult" role="status"></p>
    <nav class="actions" aria-label="タグ一覧のページ"><button id="catalogPrev" type="button" disabled>前の50件</button><button id="catalogNext" type="button" disabled>次の50件</button></nav>
    <ul id="catalogList" aria-label="翻訳タグ一覧"></ul>
    <nav class="actions" aria-label="タグ一覧のページ（下部）"><button id="catalogPrevBottom" type="button" disabled>前の50件</button><button id="catalogNextBottom" type="button" disabled>次の50件</button></nav>`;
  $('csv').closest('section').after(panel);
  const controls = ['catalogSearch', 'catalogGroup', 'catalogStatus', 'catalogSource', 'catalogOriginal'];
  function options() {
    return { query: $('catalogSearch').value, group: $('catalogGroup').value, status: $('catalogStatus').value,
      source: $('catalogSource').value, originalOnly: $('catalogOriginal').checked };
  }
  function addText(parent, tag, text, className) {
    const element = document.createElement(tag); element.textContent = text;
    if (className) element.className = className;
    parent.appendChild(element); return element;
  }
  function renderPage() {
    const matching = filter(entries, options()), pages = Math.max(1, Math.ceil(matching.length / pageSize));
    pageNumber = Math.min(Math.max(1, pageNumber), pages);
    const start = (pageNumber - 1) * pageSize;
    $('catalogResult').textContent = `該当 ${matching.length}件 / 全 ${entries.length}件 ｜ ${pageNumber}/${pages}ページ` +
      (matching.length ? ` ｜ ${start + 1}～${Math.min(start + pageSize, matching.length)}件目` : ' ｜ 該当するタグはありません');
    $('catalogPrev').disabled = pageNumber <= 1; $('catalogNext').disabled = pageNumber >= pages;
    $('catalogPrevBottom').disabled = pageNumber <= 1; $('catalogNextBottom').disabled = pageNumber >= pages;
    const fragment = document.createDocumentFragment();
    for (const entry of matching.slice(start, start + pageSize)) {
      const item = document.createElement('li'); item.dataset.index = entry.index;
      addText(item, 'strong', entry.name, 'catalog-name');
      addText(item, 'p', `表示：${entry.displayed}`);
      addText(item, 'p', `${groups[entry.group]}（category ${entry.category || '未指定'}） / ${labels[entry.status]} / ${sources[entry.source]}`);
      addText(item, 'p', `辞書登録：${entry.registered === undefined ? 'なし' : entry.registered}（${labels[entry.registeredStatus]}）`, 'muted');
      if (entry.protectedExisting) addText(item, 'small', '既存訳を保護・人による確認履歴なし');
      if (entry.originalSuggestion) addText(item, 'small', '記号・数字の候補：原語の正式採用は未確認');
      fragment.appendChild(item);
    }
    $('catalogList').replaceChildren(fragment);
  }
  function rebuild() {
    entries = project(rows);
    const summary = summarize(entries), target = $('catalogSummary'); target.replaceChildren();
    addText(target, 'p', `全 ${summary.total}件 ｜ 一般 ${summary.categories.general}件 / キャラクター ${summary.categories.character}件 / レーティング ${summary.categories.rating}件 / その他 ${summary.categories.other}件`);
    addText(target, 'p', Object.entries(summary.counts).map(([key, value]) => `${labels[key]} ${value}件`).join(' / '));
    addText(target, 'p', `原語表示が残る ${summary.unresolved}件 / 既存の暫定登録 ${summary.registered.provisional}件（有効な補完訳で表示できるタグも含む）`);
    const progress = document.createElement('progress'); progress.max = Math.max(1, summary.total);
    progress.value = summary.counts.japanese_present + summary.counts.adopted_latin;
    progress.setAttribute('aria-label', '日本語または採用済み略語の表示件数（確認済み率ではありません）');
    target.appendChild(progress); renderPage();
  }
  function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(rebuild, 0); }
  const previousRefresh = v15Refresh;
  v15Refresh = function () { previousRefresh(); scheduleRefresh(); };

  $('csv').addEventListener('change', async () => {
    const request = ++sequence, file = $('csv').files?.[0];
    clearTimeout(refreshTimer); clearTimeout(searchTimer);
    panel.removeAttribute('aria-busy');
    rows = []; pageNumber = 1; rebuild();
    controls.forEach(id => { $(id).disabled = true; });
    if (!file) { $('catalogLoad').textContent = '②でselected_tags.csvを選択してください。'; return; }
    $('catalogLoad').textContent = '全タグを読み込み中…'; panel.setAttribute('aria-busy', 'true');
    try {
      const next = await loadTags(file);
      if (request !== sequence) return;
      if (!next.length || next.some(row => typeof row.name !== 'string' || !row.name.trim())) throw Error('空のタグ名またはデータのないCSVです。');
      rows = next; rebuild();
      controls.forEach(id => { $(id).disabled = false; });
      const duplicates = rows.length - new Set(rows.map(row => row.name)).size;
      $('catalogLoad').textContent = `${file.name}：${rows.length}件を読み込みました。` +
        (duplicates ? ` 同名タグが${duplicates}行あります。CSVの行順と全行を保持しています。` : '');
    } catch (error) {
      if (request === sequence) $('catalogLoad').textContent = `読み込み失敗：${error.message} 一覧をクリアしました。辞書は変更していません。`;
    } finally { if (request === sequence) panel.removeAttribute('aria-busy'); }
  });
  $('catalogSearch').addEventListener('input', () => {
    clearTimeout(searchTimer); searchTimer = setTimeout(() => { pageNumber = 1; renderPage(); }, 150);
  });
  for (const id of controls.slice(1)) $(id).addEventListener('change', () => { pageNumber = 1; renderPage(); });
  $('catalogPrev').addEventListener('click', () => { pageNumber--; renderPage(); });
  $('catalogNext').addEventListener('click', () => { pageNumber++; renderPage(); });
  $('catalogPrevBottom').addEventListener('click', () => { pageNumber--; renderPage(); $('catalogResult').scrollIntoView({ block: 'start' }); });
  $('catalogNextBottom').addEventListener('click', () => { pageNumber++; renderPage(); $('catalogResult').scrollIntoView({ block: 'start' }); });

  // Read-only API for later candidate/review modules. Snapshots never expose mutable state.
  window.WDTagCatalog = Object.freeze({
    version: 1, pageSize,
    snapshot: () => structuredClone(entries), summary: () => summarize(entries),
    query: options => structuredClone(filter(entries, options)),
  });
  rebuild();
})();
