import { test, expect, chromium, webkit } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const csv = 'name,category\nworkspace_alpha,0\nworkspace_beta,4\n2026,0\nmanual_protected,0\n';
const upload = (name, value, json = true) => ({ name, mimeType: json ? 'application/json' : 'text/csv', buffer: Buffer.from(json ? JSON.stringify(value) : value) });
async function open(page, value = csv) {
  await page.goto('http://127.0.0.1:4174/'); await expect.poll(() => page.evaluate(() => ({ ready: WDTranslationWorkspace.ready(), error: $('workspaceError').textContent }))).toEqual({ ready: true, error: '' });
  await page.locator('#csv').setInputFiles(upload('synthetic.csv', value, false));
  await expect(page.locator('#catalogLoad')).toContainText('読み込みました');
  await page.locator('#catalogStatus').selectOption('all');
}
async function editor(page, tag) {
  await page.locator('#catalogSearch').fill(tag);
  await expect(page.locator('#catalogList li')).toHaveCount(1);
  await expect(page.locator('#catalogList .catalog-name')).toHaveText(tag);
  await page.locator('#catalogList .candidate-edit').click();
  await expect(page.locator('#workspaceTag')).toHaveText(tag);
}
async function candidate(page, tag, text, mode = 'japanese') {
  await editor(page, tag);
  await page.locator('#workspaceMode').selectOption(mode);
  await page.locator('#workspaceText').fill(text);
  await page.locator('#workspaceSaveCandidate').click();
  await expect.poll(() => page.evaluate(tag => WDTranslationWorkspace.get(tag)?.text, tag)).toBe(text);
  await expect(page.locator('#workspaceSave')).toContainText('自動保存済み');
}
async function downloaded(page, button) {
  const pending = page.waitForEvent('download'); await page.locator(button).click();
  const stream = await (await pending).createReadStream(), parts = [];
  for await (const part of stream) parts.push(part);
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
async function workspace(page) { return page.evaluate(() => WDTranslationWorkspace.export()); }
async function importWorkspace(page, value) {
  await page.locator('#workspaceImport').setInputFiles(upload('synthetic-workspace.json', value));
  await expect(page.locator('#workspaceImportPreview')).toBeVisible();
  await page.locator('#workspaceImportApply').click();
  await expect.poll(() => page.evaluate(() => ({ hidden: $('workspaceImportPreview').hidden, error: $('workspaceError').textContent, saved: $('workspaceSave').textContent.includes('自動保存済み') })), { timeout: 15000 }).toEqual({ hidden: true, error: '', saved: true });
}
async function applyPreview(page) {
  await page.locator('#workspacePreview').click();
  await expect(page.locator('#workspacePreviewBox')).toBeVisible();
  await downloaded(page, '#workspaceDictionaryBackup');
  await page.locator('#workspaceApplyConfirm').check();
}
const backupOf = entries => ({ format: 'wdtagger_translation_workspace', version: 1, entries, history: [], originalBindings: [] });
const record = (tag, text, status = 'unreviewed', mode = 'japanese') => ({ tag, text, status, mode, updatedAt: '2026-01-01T00:00:00.000Z' });

test.beforeEach(async ({ page }) => { page.errors = []; page.on('pageerror', error => page.errors.push(error.message)); });
test.afterEach(async ({ page }) => expect(page.errors).toEqual([]));

test('candidate auto-save, edit, states and deletion retain history without changing display/dictionary', async ({ page }) => {
  await open(page); const before = await page.evaluate(() => ({ custom: { ...v15Custom }, storage: { ...localStorage }, display: translateTag('workspace_alpha') }));
  await editor(page, 'workspace_alpha'); await page.locator('#workspaceText').fill('候補の日本語');
  await expect.poll(() => page.evaluate(() => WDTranslationWorkspace.get('workspace_alpha')?.text)).toBe('候補の日本語');
  for (const [id, state] of [['workspaceAdopt', 'adopted'], ['workspaceHold', 'held'], ['workspaceReject', 'rejected']]) {
    await page.locator('#' + id).click();
    await expect.poll(() => page.evaluate(() => WDTranslationWorkspace.get('workspace_alpha')?.status)).toBe(state);
    expect(await page.evaluate(() => translateTag('workspace_alpha'))).toBe(before.display);
  }
  await page.locator('#workspaceText').fill('修正した候補'); await page.locator('#workspaceSaveCandidate').click();
  await expect.poll(() => page.evaluate(() => WDTranslationWorkspace.get('workspace_alpha')?.status)).toBe('unreviewed');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#workspaceDelete').click();
  await expect.poll(() => page.evaluate(() => WDTranslationWorkspace.get('workspace_alpha'))).toBeNull();
  const data = await workspace(page);
  expect(data.history.map(x => x.action)).toEqual(['create', 'status', 'status', 'status', 'edit', 'delete']);
  expect(await page.evaluate(() => ({ custom: { ...v15Custom }, storage: { ...localStorage }, display: translateTag('workspace_alpha') }))).toEqual(before);
});

test('persistent browser restart restores candidates and statuses independently of dictionary', async ({ browserName }) => {
  // A short path avoids Windows Chromium LevelDB path-length failures.
  const engine = browserName === 'webkit' ? webkit : chromium, profile = await mkdtemp(path.join(tmpdir(), 'wdtagger-profile-'));
  let context = await engine.launchPersistentContext(profile, { headless: true });
  try {
    let page = await context.newPage(); await open(page); await candidate(page, 'workspace_alpha', '再起動で復元する候補');
    await page.locator('#workspaceHold').click(); await expect.poll(() => page.evaluate(() => WDTranslationWorkspace.get('workspace_alpha')?.status)).toBe('held');
    const before = await workspace(page); await context.close();
    context = await engine.launchPersistentContext(profile, { headless: true }); page = await context.newPage(); await open(page);
    expect(await workspace(page)).toEqual(before);
    expect(await page.evaluate(() => translateTag('workspace_alpha'))).toBe('workspace alpha');
  } finally {
    await context.close();
    if (path.dirname(path.resolve(profile)) !== path.resolve(tmpdir()) || !path.basename(profile).startsWith('wdtagger-profile-')) throw Error('Unsafe test profile path');
    await rm(profile, { recursive: true, force: true });
  }
});

test('JSON restore previews replacement, preserves all candidates/history and rejects invalid import atomically', async ({ page }) => {
  await open(page); await candidate(page, 'workspace_alpha', 'バックアップの候補');
  await page.locator('#workspaceAdopt').click(); await expect.poll(() => page.evaluate(() => WDTranslationWorkspace.get('workspace_alpha')?.status)).toBe('adopted');
  const saved = await downloaded(page, '#workspaceExport');
  await candidate(page, 'workspace_beta', '別の候補');
  await page.locator('#workspaceImport').setInputFiles(upload('workspace.json', saved));
  expect((await workspace(page)).entries).toHaveLength(2);
  await page.locator('#workspaceImportApply').click(); await expect(page.locator('#workspaceImportPreview')).toBeHidden();
  expect(await downloaded(page, '#workspaceExport')).toEqual(saved);
  for (const invalid of [{ ...saved, version: 99 }, { ...saved, entries: [...saved.entries, ...saved.entries] }, { ...saved, entries: [record('bad', 'English', 'adopted')] }]) {
    await page.locator('#workspaceImport').setInputFiles(upload('bad.json', invalid));
    await expect(page.locator('#workspaceError')).toContainText('読み込み失敗');
    expect(await workspace(page)).toEqual(saved);
  }
});

test('bulk state changes are limited to 50 visible candidates, clear on navigation and filter/search candidate text', async ({ page }) => {
  const entries = Array.from({ length: 61 }, (_, i) => record('bulk_' + i, `候補第${i}訳`));
  await open(page, 'name,category\n' + entries.map((x, i) => `${x.tag},${i % 2 ? 4 : 0}`).join('\n'));
  await importWorkspace(page, backupOf(entries));
  await page.locator('#workspaceSelectPage').click(); await expect(page.locator('#workspaceSelection')).toContainText('選択50件');
  page.once('dialog', dialog => { expect(dialog.message()).toContain('50件'); return dialog.accept(); });
  await page.locator('#workspaceBulkAdopt').click();
  await expect.poll(async () => (await workspace(page)).entries.filter(x => x.status === 'adopted').length).toBe(50);
  await page.locator('#catalogNext').click(); await expect(page.locator('#workspaceSelection')).toContainText('選択0件');
  await page.locator('#workspaceSelectPage').click();
  page.once('dialog', dialog => dialog.accept()); await page.locator('#workspaceBulkHold').click();
  await expect.poll(async () => (await workspace(page)).entries.filter(x => x.status === 'held').length).toBe(11);
  await page.locator('#workspaceFilter').selectOption('adopted'); await expect(page.locator('#catalogList li')).toHaveCount(50);
  await page.locator('#workspaceSelectPage').click();
  page.once('dialog', dialog => dialog.accept()); await page.locator('#workspaceBulkReject').click();
  await expect(page.locator('#catalogList li')).toHaveCount(0);
  await page.locator('#workspaceFilter').selectOption('held'); await page.locator('#catalogSearch').fill('候補第60訳');
  await expect(page.locator('#catalogList li')).toHaveCount(1);
  expect(await page.evaluate(() => Object.keys(v15Custom))).toHaveLength(0);
});

test('dictionary reflection requires preview and backup, preserves manual translations, round-trips legacy format', async ({ page }) => {
  await open(page, csv + 'manual_latin,0\n');
  const original = { format: 'wdtagger_japanese_dictionary', version: 1, extension: { keep: true }, translations: { manual_protected: '人が直した訳', manual_latin: 'Chosen spelling', workspace_beta: '暫定訳：仮', dictionary_only: 'CSV外も保持' } };
  await page.locator('#v15Import').setInputFiles(upload('dictionary.json', original)); await expect(page.locator('#v15Notice')).toContainText('読み込みました');
  await importWorkspace(page, backupOf([record('workspace_alpha', '新しい訳', 'adopted'), record('workspace_beta', '置き換える訳', 'adopted'), record('manual_protected', '上書き禁止', 'adopted'), record('manual_latin', '原語登録も上書き禁止', 'adopted')]));
  expect(await page.evaluate(() => translateTag('workspace_alpha'))).toBe('workspace alpha');
  await page.locator('#workspacePreview').click(); await expect(page.locator('#workspacePreviewSummary')).toContainText('変更 2件');
  await expect(page.locator('#workspaceDiff')).toContainText('既存の手動訳・登録訳を保護');
  await page.locator('#workspaceApplyConfirm').check(); await expect(page.locator('#workspaceApply')).toBeDisabled();
  expect(await downloaded(page, '#workspaceDictionaryBackup')).toEqual(original);
  await expect(page.locator('#workspaceApply')).toBeEnabled(); await page.locator('#workspaceApply').click();
  await expect.poll(() => page.evaluate(() => translateTag('workspace_alpha'))).toBe('新しい訳');
  const expected = { ...original, translations: { ...original.translations, workspace_alpha: '新しい訳', workspace_beta: '置き換える訳' } };
  expect(await downloaded(page, '#v15Export')).toEqual(expected);
  expect(await page.evaluate(() => translateTag('manual_protected'))).toBe('人が直した訳');
  await page.reload(); await expect.poll(() => page.evaluate(() => WDTranslationWorkspace.ready())).toBe(true);
  expect(await downloaded(page, '#v15Export')).toEqual(expected);
});

test('explicit original adoption works for an unchanged year string and survives restart/workspace export', async ({ page }) => {
  await open(page);
  const original = { format: 'wdtagger_japanese_dictionary', version: 1, translations: { '2026': '2026' } };
  await page.locator('#v15Import').setInputFiles(upload('dictionary.json', original)); await expect(page.locator('#v15Notice')).toContainText('読み込みました');
  await candidate(page, '2026', '2026', 'original'); await page.locator('#workspaceAdopt').click();
  await expect.poll(() => page.evaluate(() => WDTranslationWorkspace.get('2026')?.status)).toBe('adopted');
  expect(await page.evaluate(() => classifyTranslationValue('2026', v15Custom['2026']))).toBe('untranslated');
  await applyPreview(page); await page.locator('#workspaceApply').click();
  await expect.poll(() => page.evaluate(() => classifyTranslationValue('2026', v15Custom['2026']))).toBe('adopted_latin');
  expect(await downloaded(page, '#v15Export')).toEqual(original);
  const saved = await downloaded(page, '#workspaceExport'); expect(saved.originalBindings).toEqual([{ tag: '2026', value: '2026' }]);
  await page.reload(); await expect.poll(() => page.evaluate(() => WDTranslationWorkspace.ready())).toBe(true);
  expect(await page.evaluate(() => v17IsPending('2026'))).toBe(false);
  await importWorkspace(page, saved); expect(await workspace(page)).toEqual(saved);
});

test('preview invalidates on manual edits even when merged cache values are unchanged', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { v17Cache.workspace_alpha = '既存キャッシュ'; });
  await importWorkspace(page, backupOf([record('workspace_alpha', '候補の訳', 'adopted')]));
  await applyPreview(page);
  await page.evaluate(() => { v15Custom.workspace_alpha = '既存キャッシュ'; v15Save(); v15Refresh(); });
  await expect(page.locator('#workspacePreviewBox')).toBeHidden();
  await page.locator('#workspacePreview').click(); await expect(page.locator('#workspacePreviewSummary')).toContainText('変更 0件');
  expect(await page.evaluate(() => v15Custom.workspace_alpha)).toBe('既存キャッシュ');
});

test('IndexedDB write failure is visible, atomic, and unsaved candidate can still be exported', async ({ page }) => {
  await open(page); await candidate(page, 'workspace_alpha', '保存済みの候補');
  await page.evaluate(() => {
    const previous = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { if (this.name === 'entries') throw new DOMException('synthetic full disk', 'QuotaExceededError'); return previous.apply(this, args); };
  });
  await page.locator('#workspaceText').fill('未保存の候補'); await page.locator('#workspaceSaveCandidate').click();
  await expect(page.locator('#workspaceError')).toContainText('保存・更新に失敗');
  await expect(page.locator('#workspaceSave')).toContainText('未保存');
  expect((await page.evaluate(() => WDTranslationWorkspace.get('workspace_alpha'))).text).toBe('保存済みの候補');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#workspaceDelete').click();
  await expect(page.locator('#workspaceText')).toHaveValue('未保存の候補');
  const saved = await downloaded(page, '#workspaceExport');
  expect(saved.entries[0].text).toBe('未保存の候補'); expect(saved.history.at(-1).action).toBe('unsaved_draft_export');
  expect(await page.evaluate(() => translateTag('workspace_alpha'))).toBe('workspace alpha');
});

test('dictionary storage failure never activates original binding or changes existing data', async ({ page }) => {
  await open(page); await candidate(page, '2026', '2026', 'original'); await page.locator('#workspaceAdopt').click();
  await expect.poll(() => page.evaluate(() => WDTranslationWorkspace.get('2026')?.status)).toBe('adopted');
  await applyPreview(page); await page.evaluate(() => { v15Save = () => false; }); await page.locator('#workspaceApply').click();
  await expect(page.locator('#workspaceError')).toContainText('辞書への変更を取り消しました');
  expect(await page.evaluate(() => Object.hasOwn(v15Custom, '2026'))).toBe(false);
  expect(await page.evaluate(() => v17IsPending('2026'))).toBe(true);
  expect((await workspace(page)).originalBindings).toEqual([]);
});

test('multi-tab concurrent edits are rejected without overwriting newer persisted work', async ({ page, context }) => {
  await open(page); const other = await context.newPage(); await open(other);
  await candidate(page, 'workspace_alpha', '先に保存された候補');
  await editor(other, 'workspace_beta'); await other.locator('#workspaceText').fill('競合した候補'); await other.locator('#workspaceSaveCandidate').click();
  await expect(other.locator('#workspaceError')).toContainText('別タブ');
  expect(await other.evaluate(() => WDTranslationWorkspace.get('workspace_beta'))).toBeNull();
  await other.close({ runBeforeUnload: false });
  expect((await workspace(page)).entries.map(x => x.tag)).toEqual(['workspace_alpha']);
});

test('unavailable storage disables workspace with explicit warning and leaves original features usable', async ({ page }) => {
  await page.addInitScript(() => { IDBFactory.prototype.open = () => { throw Error('synthetic storage blocked'); }; });
  await page.goto('/'); await expect(page.locator('#workspaceError')).toContainText('自動保存を開始できません');
  await expect(page.locator('#workspaceImport')).toBeDisabled();
  await page.locator('#csv').setInputFiles(upload('synthetic.csv', csv, false));
  await expect(page.locator('#catalogLoad')).toContainText('4件');
  expect(await downloaded(page, '#v15Export')).toEqual({ format: 'wdtagger_japanese_dictionary', version: 1, translations: {} });
});

test('iPhone-sized layout and explicit spelling use safe text without teacher side effects or external requests', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 }); const external = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4174/')) external.push(request.url()); });
  await open(page); await candidate(page, 'workspace_alpha', '<img src=x onerror=alert(1)>日本語');
  await expect(page.locator('#catalogList img')).toHaveCount(0);
  expect(await page.locator('#translationWorkspace').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await page.locator('#workspaceSaveCandidate').evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => existingJson)).toBeNull(); expect(external).toEqual([]);
});

test('7659 synthetic candidates and histories retain 50-row rendering and complete backup', async ({ page }) => {
  const entries = Array.from({ length: 7659 }, (_, i) => record('scale_' + i, '負荷検証の候補' + i));
  const history = entries.map((entry, i) => ({ id: i + 1, tag: entry.tag, action: 'create', time: entry.updatedAt, detail: { after: entry } }));
  const fullCsv = 'name,category\n' + Array.from({ length: 10861 }, (_, i) => `scale_${i},${i % 3 ? 0 : 4}`).join('\n');
  await open(page, fullCsv);
  const saved = { ...backupOf(entries), history }; await importWorkspace(page, saved);
  await expect(page.locator('#workspaceSummary')).toContainText('作業候補 7659件');
  await page.locator('#workspaceFilter').selectOption('unreviewed');
  await expect(page.locator('#catalogResult')).toContainText('該当 7659件');
  await expect(page.locator('#catalogList li')).toHaveCount(50);
  const actual = await downloaded(page, '#workspaceExport');
  expect(actual.entries).toEqual([...entries].sort((a, b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  expect(actual.history).toEqual(history);
  await page.reload(); await expect.poll(() => page.evaluate(() => WDTranslationWorkspace.ready())).toBe(true);
  expect((await workspace(page)).entries).toHaveLength(7659);
  await open(page, fullCsv); await candidate(page, 'scale_0', '差分で修正した候補');
  await expect(page.locator('#workspaceHistory')).toContainText('create');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#workspaceDelete').click();
  await expect.poll(() => page.evaluate(() => WDTranslationWorkspace.get('scale_0'))).toBeNull();
  const changed = await downloaded(page, '#workspaceExport');
  expect(changed.entries).toHaveLength(7658); expect(changed.history.slice(-2).map(x => x.action)).toEqual(['edit', 'delete']);
  await page.reload(); await expect.poll(() => page.evaluate(() => WDTranslationWorkspace.ready())).toBe(true);
  expect(await workspace(page)).toEqual(changed);
});

test('raw English cannot be adopted as Japanese and invalid bulk changes are atomic', async ({ page }) => {
  await open(page); await importWorkspace(page, backupOf([record('workspace_alpha', '有効な候補'), record('workspace_beta', 'unreviewed English')]));
  await page.locator('#workspaceSelectPage').click(); page.once('dialog', dialog => dialog.accept()); await page.locator('#workspaceBulkAdopt').click();
  await expect(page.locator('#workspaceError')).toContainText('日本語候補');
  expect((await workspace(page)).entries.every(x => x.status === 'unreviewed')).toBe(true);
});

test('original metadata completion failure is explicit and can be retried without losing the dictionary', async ({ page }) => {
  await open(page); await candidate(page, 'workspace_alpha', 'WTA', 'original'); await page.locator('#workspaceAdopt').click();
  await expect.poll(() => page.evaluate(() => WDTranslationWorkspace.get('workspace_alpha')?.status)).toBe('adopted');
  await applyPreview(page);
  await page.evaluate(() => {
    window.previousBindingPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { if (this.name === 'bindings') throw Error('synthetic metadata full'); return previousBindingPut.apply(this, args); };
  });
  await page.locator('#workspaceApply').click(); await expect(page.locator('#workspaceError')).toContainText('辞書の文字列は保存済み');
  expect(await page.evaluate(() => v15Custom.workspace_alpha)).toBe('WTA');
  expect(await page.evaluate(() => v17IsPending('workspace_alpha'))).toBe(true);
  await page.evaluate(() => { IDBObjectStore.prototype.put = previousBindingPut; });
  await applyPreview(page); await page.locator('#workspaceApply').click();
  await expect.poll(() => page.evaluate(() => translateTag('workspace_alpha'))).toBe('WTA');
});
