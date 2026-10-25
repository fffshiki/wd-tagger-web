import { test, expect } from '@playwright/test';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const csv = 'name,category\nlong_hair,0\nblue_eyes,0\nsmile,0\nwhite_background,0\n';
const jsonFile = (name, value) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
const sample = () => ({
  schema_version: '1.2', image_id: 'IMG_0001', image_filename: 'IMG_0001.png',
  label_status: 'user_confirmed', characters: [{ name: '互換性テスト', hair: ['test_hair'] }],
  background: ['test_background'], style: ['test_style'], notes: '架空のテストデータ',
  confirmed_tags: ['long_hair'], rejected_tags: ['blue_eyes'], excluded_tags: ['white_background'],
  custom_extension: { untouched: true },
  ai_prediction: { raw_predictions: [], review_states: [
    { name: 'long_hair', category: 0, status: 'accepted', score: 0.9 },
    { name: 'blue_eyes', category: 0, status: 'rejected', score: 0.8 },
    { name: 'smile', category: 0, status: 'pending', score: 0.7 },
    { name: 'white_background', category: 0, status: 'excluded', score: 0.6 },
  ] },
  review: { approved_for_training: true, accepted_tags: ['long_hair'], rejected_tags: ['blue_eyes'], extra: 'retain' },
  training_labels: { status: 'partially_approved', approval_scope: 'reviewed_tags_only', accepted_tags: ['long_hair'], rejected_tags: ['blue_eyes'], extra: 'retain' },
});

async function openApp(page, url = '/') {
  await page.addInitScript(() => {
    window.testSessionCreates = 0;
    window.ort = {
      env: { wasm: {} },
      Tensor: class { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } },
      InferenceSession: { create: async () => {
        window.testSessionCreates++;
        return { inputNames: ['input'], outputNames: ['output'], inputMetadata: { input: { dimensions: [1,448,448,3] } }, run: async feeds => {
          window.testTensor = { dims: feeds.input.dims, type: feeds.input.type, length: feeds.input.data.length };
          return { output: { data: new Float32Array([0.9,0.8,0.7,0.6]) } };
        } };
      } },
    };
  });
  await page.goto(url);
}
async function analyze(page) {
  await page.locator('#model').setInputFiles({ name: 'synthetic.onnx', mimeType: 'application/octet-stream', buffer: Buffer.from('mock, not an ONNX model') });
  await page.locator('#csv').setInputFiles({ name: 'selected_tags.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.locator('#img').setInputFiles({ name: 'IMG_0001.png', mimeType: 'image/png', buffer: png });
  await page.locator('#run').click();
  await expect(page.locator('#log')).toContainText('解析完了');
  await page.locator('details').evaluateAll(nodes => nodes.forEach(n => n.open = true));
}
async function setStates(page) {
  for (const [name, status] of [['long_hair','accepted'], ['blue_eyes','rejected'], ['white_background','excluded']]) {
    await page.locator(`.review-state[data-tag="${name}"]`).selectOption(status);
  }
}
async function readDownload(download) {
  const stream = await download.createReadStream();
  const parts = [];
  for await (const chunk of stream) parts.push(chunk);
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

test('all v18 panels render with no script errors or unsolicited requests', async ({ page }) => {
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4174/')) external.push(request.url()); });
  await openApp(page);
  for (const id of ['model','csv','img','existing','batchPanel','dsBuild','historyPanel','v15Import','v16Import','v17Translate','regenerateReview']) await expect(page.locator('#'+id)).toBeAttached();
  await expect(page.locator('#run')).toBeDisabled();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('new record equals v18 output, excludes pending and excluded tags, reuses session', async ({ page, context }) => {
  await openApp(page);
  await analyze(page);
  await setStates(page);
  await page.locator('#custom').fill('manual_unreviewed');
  await page.locator('#confirm').check();
  await page.locator('#trainingApprove').check();
  const result = await page.evaluate(() => buildJson());
  expect(result.training_labels.accepted_tags).toEqual(['long_hair']);
  expect(result.training_labels.rejected_tags).toEqual(['blue_eyes']);
  expect(result.training_labels.pending_count).toBe(1);
  expect(result.training_labels.manual_additions_status).toBe('not_approved');
  expect(await page.evaluate(() => testTensor)).toEqual({ dims: [1,448,448,3], type:'float32', length:448*448*3 });

  const baseline = await context.newPage();
  await openApp(baseline, '/baseline.html');
  await analyze(baseline);
  await setStates(baseline);
  await baseline.locator('#custom').fill('manual_unreviewed');
  await baseline.locator('#confirm').check();
  await baseline.locator('#trainingApprove').check();
  expect(result).toEqual(await baseline.evaluate(() => buildJson()));
  await baseline.close();

  page.once('dialog', dialog => dialog.accept());
  await page.locator('#run').click();
  await expect(page.locator('#log')).toContainText('モデルを再利用');
  await expect(page.locator('#log')).toContainText('解析完了');
  expect(await page.evaluate(() => testSessionCreates)).toBe(1);
});

test('existing JSON survives load, rendering and export with all non-AI fields intact', async ({ page }) => {
  await openApp(page); await analyze(page);
  const record = sample();
  await page.locator('#existing').setInputFiles(jsonFile('IMG_0001_教師データ_v10.json', record));
  await expect(page.locator('#existingInfo')).toContainText('読み込み成功');
  await expect(page.locator('#trainingApprove')).toBeDisabled();
  expect(await page.evaluate(() => existingJson)).toEqual(record);
  await page.locator('.review-state[data-tag="long_hair"]').selectOption('rejected');
  await page.locator('#notes').fill('元のメモを上書きしない');
  const promise = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await promise;
  expect(download.suggestedFilename()).toBe('IMG_0001_教師データ_v10.json');
  const output = await readDownload(download);
  for (const [key,value] of Object.entries(record)) if (key !== 'ai_prediction') expect(output[key]).toEqual(value);
  expect(output.ai_prediction.tag_review.rejected).toContain('long_hair');
  expect(await page.evaluate(() => existingJson)).toEqual(record);
});

test('legacy absent metadata stays absent; non-confirmed records also retain metadata', async ({ page }) => {
  await openApp(page); await analyze(page);
  for (const confirmed of [true,false]) {
    const record = sample();
    if (confirmed) { record.schema_version = '1.0'; delete record.review; delete record.training_labels; delete record.excluded_tags; }
    else record.label_status = 'ai_suggested';
    await page.locator('#existing').setInputFiles(jsonFile('legacy.json', record));
    await expect(page.locator('#existingInfo')).toContainText('読み込み成功');
    const output = await page.evaluate(() => buildJson());
    for (const key of ['review','training_labels','schema_version','excluded_tags']) {
      expect(Object.hasOwn(output,key)).toBe(Object.hasOwn(record,key));
      expect(output[key]).toEqual(record[key]);
    }
    expect(await page.evaluate(() => existingJson)).toEqual(record);
  }
});

test('explicit regeneration requires separate training approval and never mutates source', async ({ page }) => {
  await openApp(page); await analyze(page);
  const record=sample();
  await page.locator('#existing').setInputFiles(jsonFile('record.json',record));
  await expect(page.locator('#existingInfo')).toContainText('読み込み成功');
  await page.locator('#regenerateReview').check();
  await page.locator('.review-state[data-tag="long_hair"]').selectOption('rejected');
  expect((await page.evaluate(() => buildJson())).training_labels.status).toBe('not_approved');
  await page.locator('#confirm').check(); await page.locator('#trainingApprove').check();
  const output=await page.evaluate(() => buildJson());
  expect(output.training_labels.rejected_tags).toEqual(['long_hair','blue_eyes']);
  expect(output.training_labels.accepted_tags).toEqual([]);
  expect(output.confirmed_tags).toEqual(record.confirmed_tags);
  expect(await page.evaluate(() => existingJson)).toEqual(record);
  await page.locator('#existing').setInputFiles(jsonFile('record-again.json',record));
  await expect(page.locator('#regenerateReview')).not.toBeChecked();
  await expect(page.locator('#trainingApprove')).toBeDisabled();
});

test('mismatched image ID is rejected and new image clears regeneration consent', async ({ page }) => {
  await openApp(page); await analyze(page);
  const record=sample(); record.image_id='IMG_9999';
  await page.locator('#existing').setInputFiles(jsonFile('wrong.json',record));
  await expect(page.locator('#existingInfo')).toContainText('画像IDが一致しません');
  expect(await page.evaluate(() => existingJson)).toBeNull();
  await page.locator('#existing').setInputFiles(jsonFile('right.json',sample()));
  await expect(page.locator('#existingInfo')).toContainText('読み込み成功');
  await page.locator('#regenerateReview').check();
  await page.locator('#img').setInputFiles({ name:'IMG_0002.png',mimeType:'image/png',buffer:png });
  await expect(page.locator('#regenerateReview')).not.toBeChecked();
  await expect(page.locator('#regenerateReview')).toBeDisabled();
  await expect(page.locator('#export')).toBeDisabled();
});

test('dictionary imports, edits and exports canonical IDs and persists across reload', async ({ page }) => {
  await openApp(page); await analyze(page);
  const dictionary={ format:'wdtagger_japanese_dictionary',version:1,translations:{long_hair:'辞書の長髪',blue_eyes:'辞書の青い目'} };
  await page.locator('#v15Import').setInputFiles(jsonFile('dictionary.json',dictionary));
  await expect(page.locator('#v15Notice')).toContainText('2件');
  const row=page.locator('.tagline').filter({has:page.locator('.review-state[data-tag="long_hair"]')});
  await expect(row).toContainText('辞書の長髪');
  await row.getByRole('button',{name:'訳を編集'}).click();
  await row.locator('.v15Editor input').fill('手動修正した長髪');
  await row.getByRole('button',{name:'この訳を登録'}).click();
  await page.locator('.review-state[data-tag="long_hair"]').selectOption('accepted');
  await page.locator('#confirm').check(); await page.locator('#trainingApprove').check();
  expect((await page.evaluate(() => buildJson())).training_labels.accepted_tags).toEqual(['long_hair']);
  const pending=page.waitForEvent('download'); await page.locator('#v15Export').click();
  const output=await readDownload(await pending);
  expect(output.format).toBe(dictionary.format); expect(output.translations.long_hair).toBe('手動修正した長髪');
  page.once('dialog', d=>d.accept()); await page.reload();
  expect(await page.evaluate(() => translateTag('long_hair'))).toBe('手動修正した長髪');
});

test('outfit import/export and registration preserve v1 format and reject duplicates', async ({ page }) => {
  await openApp(page);
  const outfit={series:'架空制服',character:'テスト人物',description:'試験用',source_tag:'school_uniform',image_id:'IMG_0001',image_filename:'IMG_0001.png',created_at:'2026-01-01T00:00:00Z'};
  await page.locator('#v16Import').setInputFiles(jsonFile('outfits.json',{format:'wdtagger_outfit_presets',version:1,outfits:[outfit]}));
  await expect(page.locator('#v16Msg')).toContainText('1件');
  await page.locator('#v16Series').fill(outfit.series); await page.locator('#v16Char').fill(outfit.character); await page.locator('#v16Add').click();
  await expect(page.locator('#v16Msg')).toContainText('重複登録を防止');
  const pending=page.waitForEvent('download'); await page.locator('#v16Export').click();
  const output=await readDownload(await pending);
  expect(output.format).toBe('wdtagger_outfit_presets'); expect(output.version).toBe(1); expect(output.outfits).toHaveLength(1);
  expect(output.outfits[0]).toMatchObject(outfit);
  await page.reload(); await expect(page.locator('#v16List')).toContainText('架空制服');
});

test('batch, approved dataset and history remain available; unsafe labels are rejected', async ({ page }) => {
  await openApp(page); await analyze(page); await setStates(page);
  await page.locator('#confirm').check(); await page.locator('#trainingApprove').check();
  const approved=await page.evaluate(()=>buildJson());
  const pending=structuredClone(approved); pending.image_id='IMG_0002'; pending.review.approved_for_training=false; pending.training_labels.status='not_approved';
  await page.locator('#batchFiles').setInputFiles([jsonFile('approved.json',approved),jsonFile('pending.json',pending)]);
  await page.locator('#batchRead').click(); await expect(page.locator('#batchMessage')).toContainText('読み込み 2件');
  await page.locator('#dsBuild').click(); await expect(page.locator('#dsMessage')).toContainText('対象画像 1件');
  const download=page.waitForEvent('download'); await page.locator('#dsSave').click();
  const dataset=await readDownload(await download);
  expect(dataset.schema_version).toBe('training-dataset-1.0');
  expect(dataset.images[0].positive_tags).toEqual(['long_hair']); expect(dataset.images[0].negative_tags).toEqual(['blue_eyes']);
  const invalid=structuredClone(approved); invalid.training_labels.accepted_tags.push('smile');
  expect(await page.evaluate(j=>{try{dsMakeEntry(j,'invalid.json');return '';}catch(e){return e.message;}},invalid)).toContain('不整合');
  await page.locator('#histCheck').click();
  await expect(page.locator('#histResults tr[title="long_hair"]')).toContainText('長い髪');
});

test('online translation remains opt-in and sends only tag text (mock service)', async ({ page }) => {
  const requests=[];
  await page.route('https://api.mymemory.translated.net/**',async route=>{
    requests.push(route.request().url());
    await route.fulfill({contentType:'application/json',body:JSON.stringify({responseStatus:200,responseData:{translatedText:'テスト用の訳'}})});
  });
  await openApp(page);
  await page.evaluate(()=>v17TranslateList(['synthetic_untranslated_tag']));
  expect(requests).toEqual([]);
  await page.locator('#v17Online').check();
  await page.evaluate(()=>v17TranslateList(['synthetic_untranslated_tag']));
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0]).searchParams.get('q')).toBe('synthetic untranslated tag');
  expect(await page.evaluate(()=>translateTag('synthetic_untranslated_tag'))).toBe('テスト用の訳');
});

test('mobile-width form fits and the four review choices remain reachable', async ({ page },testInfo) => {
  await page.setViewportSize({width:390,height:844});
  await openApp(page); await analyze(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect(await page.locator('.review-state').first().locator('option').allTextContents()).toEqual(['未確認','正しい','間違い','不要']);
  await page.locator('#migrationProtection').scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath('mobile-protection.png')});
});
