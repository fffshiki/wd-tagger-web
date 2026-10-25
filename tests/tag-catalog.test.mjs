import { test, expect } from '@playwright/test';

// Synthetic fixtures only. Real CSV/dictionary validation stays outside Git.
const names = ['virtual_youtuber', 'bdsm', 'science_fiction', 'long_hair', '2026'];
const rows = Array.from({ length: 10861 }, (_, i) => ({ name: names[i] || `synthetic_catalog_${i}`, category: i < 9000 ? '0' : i < 10857 ? '4' : '9' }));
const csv = 'name,category\n' + rows.map(row => `${row.name},${row.category}`).join('\n');
const dictionary = { format: 'wdtagger_japanese_dictionary', version: 1, extension: { retain: true }, translations: {
  virtual_youtuber: 'VTuber', bdsm: 'BDSM', science_fiction: 'SF', long_hair: '手動の長い髪',
  synthetic_catalog_6: '暫定訳：仮の訳', synthetic_catalog_7: 'synthetic catalog 7',
  synthetic_catalog_8: '架空の日本語', synthetic_catalog_9: '手動優先の訳', dictionary_only: 'CSV外も保持',
} };
const file = (name, text, mimeType = 'text/csv') => ({ name, mimeType, buffer: Buffer.from(text) });
async function loadCsv(page, text = csv) {
  await page.locator('#csv').setInputFiles(file('synthetic.csv', text));
  await expect(page.locator('#catalogLoad')).toContainText('読み込みました');
}
async function loadDictionary(page) {
  await page.locator('#v15Import').setInputFiles(file('synthetic.json', JSON.stringify(dictionary), 'application/json'));
  await expect(page.locator('#v15Notice')).toContainText('読み込みました');
  await expect.poll(() => page.evaluate(() => WDTagCatalog.summary().counts.adopted_latin)).toBe(3);
}
async function downloadJson(page, button) {
  const pending = page.waitForEvent('download'); await page.locator(button).click();
  const stream = await (await pending).createReadStream(), parts = [];
  for await (const part of stream) parts.push(part);
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
test.beforeEach(async ({ page }) => {
  page.scriptErrors = []; page.on('pageerror', error => page.scriptErrors.push(error.message));
  await page.goto('/');
});
test.afterEach(async ({ page }) => expect(page.scriptErrors).toEqual([]));

test('all 10861 CSV rows are available without image or ONNX; classifications and totals are exclusive', async ({ page }) => {
  await loadCsv(page); await loadDictionary(page);
  const summary = await page.evaluate(() => WDTagCatalog.summary());
  expect(summary.total).toBe(10861);
  expect(summary.categories).toEqual({ general: 9000, character: 1857, rating: 4, other: 0 });
  expect(summary.counts).toEqual({ japanese_present: 3, adopted_latin: 3, provisional: 1, untranslated: 10854, needs_review: 0 });
  expect(summary.unresolved).toBe(10855);
  expect(summary.originalSuggestions).toBe(1);
  const snapshot = await page.evaluate(() => WDTagCatalog.snapshot());
  expect(snapshot.map(row => ({ name: row.name, category: row.category }))).toEqual(rows);
  expect(snapshot.every(row => row.workflow.confirmation === 'unreviewed' && row.workflow.candidate === null)).toBe(true);
  expect(await page.evaluate(() => tagRows)).toEqual([]); // No effect on image inference ordering/state.
  await expect(page.locator('#run')).toBeDisabled();
});

test('search and intersected filters cover English, Japanese, provisional entries and categories', async ({ page }) => {
  await loadCsv(page); await loadDictionary(page);
  await page.locator('#catalogStatus').selectOption('all');
  await page.locator('#catalogSearch').fill('VTUBER');
  await expect(page.locator('#catalogList li')).toHaveCount(1);
  await expect(page.locator('#catalogList')).toContainText('virtual_youtuber');
  await page.locator('#catalogSearch').fill('仮の訳');
  await expect(page.locator('#catalogList li')).toHaveCount(1);
  await page.locator('#catalogStatus').selectOption('provisional');
  await expect(page.locator('#catalogList')).toContainText('synthetic_catalog_6');
  await page.locator('#catalogGroup').selectOption('character');
  await expect(page.locator('#catalogList li')).toHaveCount(0);
  await page.locator('#catalogSearch').fill('');
  await page.locator('#catalogStatus').selectOption('unresolved');
  await expect(page.locator('#catalogResult')).toContainText('該当 1857件');
  await page.locator('#catalogSource').selectOption('registered');
  await expect(page.locator('#catalogList li')).toHaveCount(0);
  await page.locator('#catalogGroup').selectOption('general');
  await page.locator('#catalogSource').selectOption('all');
  await page.locator('#catalogOriginal').check();
  await expect(page.locator('#catalogList li')).toHaveCount(1);
  await expect(page.locator('#catalogList')).toContainText('原語の正式採用は未確認');
  expect(await page.evaluate(() => WDTagCatalog.query({ originalOnly: true })[0].workflow.confirmation)).toBe('unreviewed');
});

test('pagination bounds DOM to 50 rows and clamps after filtering', async ({ page }) => {
  await loadCsv(page);
  await expect(page.locator('#catalogList li')).toHaveCount(50);
  const first = await page.locator('#catalogList li').first().getAttribute('data-index');
  await page.locator('#catalogNextBottom').click();
  await expect(page.locator('#catalogResult')).toContainText('2/');
  expect(await page.locator('#catalogList li').first().getAttribute('data-index')).not.toBe(first);
  await page.locator('#catalogPrev').click();
  expect(await page.locator('#catalogList li').first().getAttribute('data-index')).toBe(first);
  await page.locator('#catalogNext').click();
  await page.locator('#catalogGroup').selectOption('rating');
  await page.locator('#catalogStatus').selectOption('all');
  await expect(page.locator('#catalogList li')).toHaveCount(4);
  await expect(page.locator('#catalogResult')).toContainText('1/1ページ');
  await expect(page.locator('#catalogNext')).toBeDisabled();
  await expect(page.locator('#catalogPrev')).toBeDisabled();
  await expect(page.locator('#catalogNextBottom')).toBeDisabled();
  await expect(page.locator('#catalogPrevBottom')).toBeDisabled();
});

test('dictionary refresh protects manual text, distinguishes provisional fallback and never writes review state', async ({ page }) => {
  await loadCsv(page); await loadDictionary(page);
  const before = await page.evaluate(() => ({ dictionary: structuredClone(v15Custom), cache: structuredClone(v17Cache), storage: { ...localStorage } }));
  await page.evaluate(() => { v17Cache.long_hair = 'キャッシュ側'; v15Custom.fellatio = '暫定訳：原語'; v15Refresh(); });
  await page.evaluate(() => { v15Custom.synthetic_catalog_8 = '変更された手動訳'; v15Refresh(); });
  await expect.poll(() => page.evaluate(() => WDTagCatalog.query({ query: '変更された手動訳' }).length)).toBe(1);
  await loadCsv(page, 'name,category\nlong_hair,0\nfellatio,0\n');
  const entries = await page.evaluate(() => WDTagCatalog.snapshot());
  expect(entries[0].displayed).toBe('手動の長い髪');
  expect(entries[0].protectedExisting).toBe(true);
  expect(entries[1].registeredStatus).toBe('provisional');
  expect(entries[1].status).toBe('japanese_present');
  expect(entries[1].source).toBe('builtin');
  await page.locator('#catalogStatus').selectOption('all');
  await expect(page.locator('#catalogList')).toContainText('既存訳を保護');
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual(before.storage);
  // API snapshots cannot mutate either the catalog or the registered dictionary.
  await page.evaluate(() => { const copy = WDTagCatalog.snapshot(); copy[0].name = 'changed'; copy[0].workflow.confirmation = 'confirmed'; });
  expect(await page.evaluate(() => WDTagCatalog.snapshot()[0].name)).toBe('long_hair');
  expect(await page.evaluate(() => v15Custom.long_hair)).toBe(before.dictionary.long_hair);
});

test('dictionary export/reload keeps unknown fields, CSV-external entries and provisional strings intact', async ({ page }) => {
  await loadCsv(page); await loadDictionary(page);
  const before = await page.evaluate(() => ({ ...localStorage }));
  await page.locator('#catalogStatus').selectOption('all');
  await page.locator('#catalogSearch').fill('髪');
  await expect(page.locator('#catalogList li')).toHaveCount(1);
  expect(await downloadJson(page, '#v15Export')).toEqual(dictionary);
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual(before);
  await page.reload();
  expect(await downloadJson(page, '#v15Export')).toEqual(dictionary);
  await loadCsv(page);
  expect((await page.evaluate(() => WDTagCatalog.summary())).counts.provisional).toBe(1);
});

test('CSV replacement, duplicate names and invalid input never retain stale entries or alter IDs', async ({ page }) => {
  await loadCsv(page);
  await loadCsv(page, 'name,category\nCase_Tag,4\nCase_Tag,4\n3:,0\nunknown,__proto__\n');
  await expect(page.locator('#catalogLoad')).toContainText('同名タグが1行');
  expect(await page.evaluate(() => WDTagCatalog.snapshot().map(row => row.name))).toEqual(['Case_Tag', 'Case_Tag', '3:', 'unknown']);
  expect((await page.evaluate(() => WDTagCatalog.summary())).categories).toEqual({ general: 1, character: 2, rating: 0, other: 1 });
  await page.locator('#csv').setInputFiles(file('bad.csv', 'wrong,category\nx,0'));
  await expect(page.locator('#catalogLoad')).toContainText('読み込み失敗');
  expect(await page.evaluate(() => WDTagCatalog.summary().total)).toBe(0);
  await expect(page.locator('#catalogList li')).toHaveCount(0);
  await expect(page.locator('#catalogSearch')).toBeDisabled();
});

test('late CSV reads cannot replace the newer selection; clear while loading removes busy state', async ({ page }) => {
  await page.evaluate(() => {
    const previous = File.prototype.text;
    File.prototype.text = function () {
      if (this.name === 'slow.csv') return new Promise(resolve => { window.resolveSlowCsv = () => resolve('name,category\nold,0'); });
      return previous.call(this);
    };
  });
  await page.locator('#csv').setInputFiles(file('slow.csv', 'unused'));
  await expect(page.locator('#tagCatalog')).toHaveAttribute('aria-busy', 'true');
  await loadCsv(page, 'name,category\nnew,4');
  await page.evaluate(() => resolveSlowCsv());
  expect(await page.evaluate(() => WDTagCatalog.snapshot().map(row => row.name))).toEqual(['new']);
  await page.locator('#csv').setInputFiles(file('slow.csv', 'unused'));
  await page.locator('#csv').setInputFiles([]);
  await page.evaluate(() => resolveSlowCsv());
  await expect(page.locator('#tagCatalog')).not.toHaveAttribute('aria-busy');
  expect(await page.evaluate(() => WDTagCatalog.summary().total)).toBe(0);
});

test('narrow iPhone-sized viewport renders safe text and no external requests or confirmation side effects', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const external = []; page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4174/')) external.push(request.url()); });
  await loadCsv(page, 'name,category\n<img src=x onerror=alert(1)>,4\n');
  await expect(page.locator('#catalogList li')).toHaveCount(1);
  await expect(page.locator('#catalogList img')).toHaveCount(0);
  expect(await page.locator('#tagCatalog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.catalog-filters')).gridTemplateColumns.split(' ').length)).toBe(1);
  expect(external).toEqual([]);
  expect(await page.evaluate(() => existingJson)).toBeNull();
  expect(await page.evaluate(() => Object.keys(localStorage).some(key => /catalog|workspace/.test(key)))).toBe(false);
});
