'use strict';

// Import/export adapters preserve the existing v1 file formats and original values.
const dictionaryEnvelopeKey = 'wdtagger_dictionary_envelope_v1';
const outfitEnvelopeKey = 'wdtagger_outfit_envelope_v1';
const dataObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function dataMapping(value) {
  if (!dataObject(value) || Object.values(value).some(x => typeof x !== 'string')) throw Error('translationsは文字列の対応表である必要があります。変更は適用していません。');
  return Object.assign(Object.create(null), value);
}
function dataCanonical(value) {
  if (Array.isArray(value)) return '[' + value.map(dataCanonical).join(',') + ']';
  if (dataObject(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + dataCanonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function dataEnvelope(value, field) { const copy = structuredClone(value); delete copy[field]; return copy; }
async function readDataJson(file) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
  catch { throw Error('UTF-8のJSONとして読めません。ファイルの破損や文字コードを確認し、元アプリから再出力してください。既存登録は変更していません。'); }
  return JSON.parse(text);
}
function mergeEnvelope(previous, incoming) {
  for (const key of Object.keys(incoming)) if (Object.hasOwn(previous, key) && dataCanonical(previous[key]) !== dataCanonical(incoming[key])) throw Error('ファイルの付加情報が既存データと競合しています。変更は適用していません。');
  return { ...previous, ...incoming };
}
function readEnvelope(key, format) {
  try { const value = JSON.parse(localStorage.getItem(key)); if (dataObject(value) && value.format === format && value.version === 1) return value; } catch {}
  return { format, version: 1 };
}
let dictionaryEnvelope = readEnvelope(dictionaryEnvelopeKey, 'wdtagger_japanese_dictionary');
let outfitEnvelope = readEnvelope(outfitEnvelopeKey, 'wdtagger_outfit_presets');
// v18 trimmed values on startup. Restore exact strings from the same storage key.
try { const saved = localStorage.getItem(v15StorageKey); v15Custom = dataMapping(saved ? JSON.parse(saved) : v15Custom); }
catch { $('v15Notice').textContent = '端末内辞書を完全に復元できません。辞書JSONから復元してください。'; }
try { v17Cache = dataMapping(v17Cache); } catch { v17Cache = Object.create(null); }

let dictionaryImportSequence = 0;
$('v15Import').addEventListener('change', async event => {
  event.stopImmediatePropagation();
  const sequence = ++dictionaryImportSequence;
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const raw = await readDataJson(file); if (sequence !== dictionaryImportSequence) return;
    if (!dataObject(raw) || raw.format !== 'wdtagger_japanese_dictionary' || raw.version !== 1) throw Error('辞書形式が違います。');
    const incoming = dataMapping(raw.translations);
    const envelope = mergeEnvelope(dictionaryEnvelope, dataEnvelope(raw, 'translations'));
    v15Custom = Object.assign(Object.create(null), v15Custom, incoming);
    dictionaryEnvelope = envelope;
    let saved = v15Save();
    try { localStorage.setItem(dictionaryEnvelopeKey, JSON.stringify(envelope)); } catch { saved = false; }
    v15Refresh();
    $('v15Notice').textContent = `${Object.keys(incoming).length}件の翻訳を読み込みました。登録合計${Object.keys(v15Custom).length}件。${saved ? '端末にも保存しました。' : '端末保存に失敗したため辞書JSONを保存してください。'}`;
  } catch (error) { if (sequence === dictionaryImportSequence) $('v15Notice').textContent = '読み込み失敗：' + error.message; }
  finally { if (sequence === dictionaryImportSequence) event.target.value = ''; }
}, { capture: true });

v15Export = function () {
  // Cached translations fill missing keys; an imported/manual entry always wins.
  const translations = Object.assign(Object.create(null), v17Cache, v15Custom);
  v16Download('WDTagger_日本語辞書_v18.json', { ...dictionaryEnvelope, translations });
};
$('v15Export').addEventListener('click', event => { event.stopImmediatePropagation(); v15Export(); }, { capture: true });

// Same MyMemory endpoint, opt-in and 30-tag limit. Only protect concurrent manual edits.
let translationBatchBusy = false;
v17TranslateList = async function (tags) {
  if (!$('v17Online').checked) { v17Status('オンライン翻訳を使う場合は、先に許可へチェックしてください。'); return; }
  if (translationBatchBusy) { v17Status('翻訳中です。完了してから実行してください。'); return; }
  const pending = [...new Set(tags)].filter(v17IsPending).slice(0, 30);
  if (!pending.length) { v17Status('今回の対象に未翻訳タグはありません。'); return; }
  translationBatchBusy = true;
  let ok = 0, fail = 0, protectedEdits = 0;
  const persist = () => { try { localStorage.setItem(v17CacheKey, JSON.stringify(v17Cache)); return true; } catch { return false; } };
  try {
    for (let i = 0; i < pending.length; i++) {
      if (!$('v17Online').checked) break;
      const tag = pending[i];
      if (!v17IsPending(tag)) { protectedEdits++; continue; }
      const hadManual = Object.hasOwn(v15Custom, tag), before = v15Custom[tag];
      v17Status(`翻訳中 ${i + 1}/${pending.length}：${tag} （成功${ok}／失敗${fail}）`);
      try {
        const response = await fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(tag.replaceAll('_', ' ')) + '&langpair=en|ja', { method: 'GET', mode: 'cors' });
        if (!response.ok) throw Error('HTTP ' + response.status);
        const data = await response.json();
        const result = String(data?.responseData?.translatedText || '').trim();
        if (!result || v18LooksUntranslated(tag, result) || /<[^>]+>/.test(result) || Number(data.responseStatus) !== 200) throw Error('翻訳結果なし');
        if (Object.hasOwn(v15Custom, tag) !== hadManual || v15Custom[tag] !== before) { protectedEdits++; continue; }
        v17Cache[tag] = result;
        if (hadManual) delete v15Custom[tag]; // Only the unchanged, untranslated entry requested by the user.
        ok++;
      } catch { fail++; }
      if ((i + 1) % 5 === 0) { persist(); v17Refresh(); }
    }
    const savedCache = persist(), savedDictionary = v15Save();
    v17Refresh();
    const remaining = [...new Set(tags)].filter(v17IsPending).length;
    v17Status(`完了：成功${ok}件／失敗${fail}件／未翻訳残り${remaining}件／手動編集保護${protectedEdits}件。${savedCache && savedDictionary ? '' : '端末保存に失敗しました。'}辞書JSONを保存してください。`);
  } finally { translationBatchBusy = false; }
};

// Inspection-only foundation: no translation requests, no schema changes, no automatic edits.
function classifyTranslationValue(tag, value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return 'untranslated';
  if (v17Bad.test(text)) return 'provisional';
  if (v18LooksUntranslated(tag, text)) return 'untranslated';
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(text) ? 'japanese_present' : 'needs_review';
}
function getTranslationCatalog(rows = tagRows) {
  return rows.map((row, index) => {
    const tag = row.name, registered = Object.hasOwn(v15Custom, tag) ? v15Custom[tag] : undefined;
    const displayed = translateTag(tag);
    return { index, name: tag, category: row.category, registered, registeredStatus: classifyTranslationValue(tag, registered), displayed, displayStatus: classifyTranslationValue(tag, displayed) };
  });
}
function getDictionaryStatusCounts() {
  const counts = { untranslated: 0, provisional: 0, japanese_present: 0, needs_review: 0 };
  for (const [tag, value] of Object.entries(v15Custom)) counts[classifyTranslationValue(tag, value)]++;
  return counts;
}

function validateOutfits(value) {
  if (!Array.isArray(value) || value.some(x => !dataObject(x) || typeof x.series !== 'string' || !x.series.trim() || typeof x.character !== 'string' || !x.character.trim())) throw Error('衣装のseries・characterが不正です。変更は適用していません。');
}
function mergeOutfits(current, incoming) {
  const available = new Map();
  for (const item of current) { const key = dataCanonical(item); available.set(key, (available.get(key) || 0) + 1); }
  const additions = [];
  for (const item of incoming) {
    const key = dataCanonical(item), remaining = available.get(key) || 0;
    if (remaining) { available.set(key, remaining - 1); continue; }
    if (item.id != null && current.some(old => old.id === item.id && dataCanonical(old) !== key)) throw Error('同じ衣装IDに異なる内容があります。変更は適用していません。');
    additions.push(structuredClone(item));
  }
  return [...current, ...additions];
}
let outfitImportSequence = 0;
$('v16Import').addEventListener('change', async event => {
  event.stopImmediatePropagation();
  const sequence = ++outfitImportSequence;
  const file = event.target.files?.[0]; if (!file) return;
  try {
    const raw = await readDataJson(file); if (sequence !== outfitImportSequence) return;
    if (!dataObject(raw) || raw.format !== 'wdtagger_outfit_presets' || raw.version !== 1) throw Error('衣装プリセットJSONではありません。');
    validateOutfits(raw.outfits);
    const envelope = mergeEnvelope(outfitEnvelope, dataEnvelope(raw, 'outfits'));
    const next = mergeOutfits(v16Outfits, raw.outfits), added = next.length - v16Outfits.length;
    v16Outfits = next; outfitEnvelope = envelope;
    let saved = v16Persist();
    try { localStorage.setItem(outfitEnvelopeKey, JSON.stringify(envelope)); } catch { saved = false; }
    v16Render(); $('v16Msg').textContent = `${added}件の衣装を読み込みました。完全一致の既存登録は追加していません。${saved ? '' : '端末保存に失敗したためJSONを保存してください。'}`;
  } catch (error) { if (sequence === outfitImportSequence) $('v16Msg').textContent = '読み込み失敗：' + error.message; }
  finally { if (sequence === outfitImportSequence) event.target.value = ''; }
}, { capture: true });
$('v16Export').addEventListener('click', event => {
  event.stopImmediatePropagation();
  v16Download('WDTagger_衣装プリセット.json', { ...outfitEnvelope, outfits: v16Outfits });
}, { capture: true });

// Original deletion used id equality, which could remove several imported entries at once.
const dataOriginalOutfitRender = v16Render;
v16Render = function () {
  dataOriginalOutfitRender();
  const grouped = new Map();
  for (const item of v16Outfits) { if (!grouped.has(item.series)) grouped.set(item.series, []); grouped.get(item.series).push(item); }
  const ordered = [...grouped.values()].flat();
  [...$('v16List').querySelectorAll('.outfit-row button')].forEach((button, index) => {
    button.addEventListener('click', event => {
      event.stopImmediatePropagation();
      if (!confirm('この衣装登録を削除しますか？')) return;
      const item = ordered[index], position = v16Outfits.indexOf(item);
      if (position >= 0) v16Outfits.splice(position, 1);
      const saved = v16Persist(); v16Render();
      if (!saved) $('v16Msg').textContent = '端末保存に失敗したためJSONを保存してください。';
    }, { capture: true });
  });
};
v15Refresh(); v16Render();
