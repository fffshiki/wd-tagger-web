import { test, expect } from '@playwright/test';

const input = (name, value) => ({name, mimeType:'application/json', buffer:Buffer.from(JSON.stringify(value))});
async function exported(page, button) {
  const pending=page.waitForEvent('download'); await page.locator(button).click();
  const stream=await (await pending).createReadStream();const chunks=[];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function importDictionary(page, value) {
  await page.locator('#v15Import').setInputFiles(input('synthetic-dictionary.json',value));
  await expect(page.locator('#v15Notice')).toContainText('読み込みました');
}
async function importOutfits(page, value) {
  await page.locator('#v16Import').setInputFiles(input('synthetic-outfits.json',value));
  await expect(page.locator('#v16Msg')).toContainText('読み込みました');
}

test.beforeEach(async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.testScriptErrors=errors;
});
test.afterEach(async({page})=>expect(page.testScriptErrors).toEqual([]));

test('dictionary preserves 10382 synthetic entries, exact text and extra metadata on round-trip',async({page})=>{
  await page.goto('/');
  const translations=Object.fromEntries(Array.from({length:10382},(_,i)=>['synthetic_tag_'+i,'架空の訳'+i]));
  translations.synthetic_tag_0='  前後の空白を保持  ';
  translations.synthetic_tag_1='長い訳'.repeat(100);
  translations.synthetic_tag_2='';
  const dictionary={format:'wdtagger_japanese_dictionary',version:1,translations,extension:{keep:true}};
  await importDictionary(page,dictionary);
  expect(await exported(page,'#v15Export')).toEqual(dictionary);
  await page.reload();
  expect(await exported(page,'#v15Export')).toEqual(dictionary);
  await importDictionary(page,dictionary);
  expect(await exported(page,'#v15Export')).toEqual(dictionary);
});

test('manual Japanese translation wins over stale online cache in display and export',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('wdtagger_v17_online_translations',JSON.stringify({long_hair:'古い自動訳'})));
  await page.goto('/');
  const dictionary={format:'wdtagger_japanese_dictionary',version:1,translations:{long_hair:'人が確認した日本語訳'}};
  await importDictionary(page,dictionary);
  expect(await page.evaluate(()=>translateTag('long_hair'))).toBe('人が確認した日本語訳');
  expect(await exported(page,'#v15Export')).toEqual(dictionary);
});

test('outfit round-trip preserves IDs, optional fields, duplicate pairs and unknown fields',async({page})=>{
  await page.goto('/');
  const data={format:'wdtagger_outfit_presets',version:1,extension:{keep:true},outfits:[
    {id:'stable_1',series:'架空シリーズ',character:'架空人物',description:'  原文の空白  ',source_tag:'synthetic_costume',created_at:'2020-01-01',extra:{retain:true}},
    {id:'stable_2',series:'架空シリーズ',character:'架空人物',description:'別の登録'},
    {series:'別シリーズ',character:'別人物'},
  ]};
  await importOutfits(page,data);
  expect(await exported(page,'#v16Export')).toEqual(data);
  await page.reload();expect(await exported(page,'#v16Export')).toEqual(data);
  await importOutfits(page,data);expect(await exported(page,'#v16Export')).toEqual(data);
});

test('translation statuses distinguish English, provisional text, Japanese candidates and symbols',async({page})=>{
  await page.goto('/');
  const dictionary={format:'wdtagger_japanese_dictionary',version:1,translations:{english:'english',provisional:'暫定訳：仮の訳',original:'固有名詞・専門用語（原語）：Name',japanese:'日本語の候補',empty:'',symbol:'★'}};
  await importDictionary(page,dictionary);
  expect(await page.evaluate(()=>getDictionaryStatusCounts())).toEqual({untranslated:2,provisional:2,japanese_present:1,adopted_latin:0,needs_review:1});
  expect(await exported(page,'#v15Export')).toEqual(dictionary);
});

test('catalog covers every CSV row in order, including tags absent from the dictionary',async({page})=>{
  await page.goto('/');
  await importDictionary(page,{format:'wdtagger_japanese_dictionary',version:1,translations:{synthetic_0:'日本語',dictionary_only:'辞書だけの訳'}});
  const result=await page.evaluate(async()=>{
    const text='name,category\n'+Array.from({length:11000},(_,i)=>`synthetic_${i},0`).join('\n');
    const rows=await loadTags(new File([text],'synthetic.csv',{type:'text/csv'}));
    const before=JSON.stringify(rows),catalog=getTranslationCatalog(rows);
    return {length:catalog.length,first:catalog[0],last:catalog.at(-1),unchanged:before===JSON.stringify(rows),inferenceCount:lastTags.length};
  });
  expect(result.length).toBe(11000);expect(result.first.name).toBe('synthetic_0');
  expect(result.first.registeredStatus).toBe('japanese_present');expect(result.last.name).toBe('synthetic_10999');
  expect(result.last.registeredStatus).toBe('untranslated');expect(result.unchanged).toBe(true);expect(result.inferenceCount).toBe(0);
  expect((await exported(page,'#v15Export')).translations.dictionary_only).toBe('辞書だけの訳');
});

test('translation response cannot delete a manual correction made while request is in flight',async({page})=>{
  let releaseRoute; const requested=new Promise(resolve=>releaseRoute=resolve);let held;
  await page.route('https://api.mymemory.translated.net/**',route=>{held=route;releaseRoute();});
  await page.goto('/');
  await importDictionary(page,{format:'wdtagger_japanese_dictionary',version:1,translations:{synthetic_race:'synthetic race'}});
  await page.locator('#v17Online').check();
  await page.evaluate(()=>{window.pendingTranslation=v17TranslateList(['synthetic_race']);});
  await requested;
  await importDictionary(page,{format:'wdtagger_japanese_dictionary',version:1,translations:{synthetic_race:'通信中に手動修正した訳'}});
  await held.fulfill({contentType:'application/json',body:JSON.stringify({responseStatus:200,responseData:{translatedText:'遅れて返ってきた自動訳'}})});
  await page.evaluate(()=>window.pendingTranslation);
  expect((await exported(page,'#v15Export')).translations.synthetic_race).toBe('通信中に手動修正した訳');
  expect(await page.evaluate(()=>translateTag('synthetic_race'))).toBe('通信中に手動修正した訳');
  await expect(page.locator('#v17Status')).toContainText('手動編集保護1件');
});

test('invalid dictionary is rejected atomically and valid prototype-like keys survive',async({page})=>{
  await page.goto('/');
  const valid=JSON.parse('{"format":"wdtagger_japanese_dictionary","version":1,"translations":{"__proto__":"日本語のタグ","constructor":"別の訳"}}');
  await importDictionary(page,valid);
  await page.locator('#v15Import').setInputFiles(input('invalid.json',{format:valid.format,version:1,translations:{new_tag:'新しい訳',bad:12}}));
  await expect(page.locator('#v15Notice')).toContainText('読み込み失敗');
  expect(await exported(page,'#v15Export')).toEqual(valid);
});

test('conflicting outfit ID or invalid encoding cannot alter existing registrations',async({page})=>{
  await page.goto('/');
  const valid={format:'wdtagger_outfit_presets',version:1,outfits:[{id:'same-id',series:'架空',character:'人物',description:'元の説明'}]};
  await importOutfits(page,valid);
  await page.locator('#v16Import').setInputFiles(input('conflict.json',{...valid,outfits:[{...valid.outfits[0],description:'別の説明'}]}));
  await expect(page.locator('#v16Msg')).toContainText('同じ衣装ID');
  expect(await exported(page,'#v16Export')).toEqual(valid);
  await page.locator('#v16Import').setInputFiles({name:'corrupt.json',mimeType:'application/json',buffer:Buffer.from([0xff,0xfe,0x00,0x7b])});
  await expect(page.locator('#v16Msg')).toContainText('UTF-8');
  expect(await exported(page,'#v16Export')).toEqual(valid);
});

test('deleting one imported outfit without an ID cannot delete other entries',async({page})=>{
  await page.goto('/');
  const data={format:'wdtagger_outfit_presets',version:1,outfits:[{series:'架空',character:'A'},{series:'架空',character:'B'}]};
  await importOutfits(page,data);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#v16List button').first().click();
  expect((await exported(page,'#v16Export')).outfits).toEqual([data.outfits[1]]);
});

test('provisional entries cannot mask built-in translations and remain provisional on export',async({page})=>{
  await page.goto('/');
  const dictionary={format:'wdtagger_japanese_dictionary',version:1,translations:{
    light_particles:'固有名詞・専門用語（原語）：light particles',epaulettes:'暫定訳：epaulettes',jeans:'【要確認】jeans',synthetic_untranslated:'暫定訳：synthetic untranslated',
  }};
  await importDictionary(page,dictionary);
  const display=await page.evaluate(()=>Object.fromEntries(['light_particles','epaulettes','jeans','synthetic_untranslated'].map(tag=>[tag,{label:translateTag(tag),pending:v17IsPending(tag)}])));
  expect(display.light_particles).toEqual({label:'光の粒',pending:false});
  expect(display.epaulettes).toEqual({label:'肩章',pending:false});
  expect(display.jeans).toEqual({label:'ジーンズ',pending:false});
  expect(display.synthetic_untranslated).toEqual({label:'synthetic untranslated',pending:true});
  const catalog=await page.evaluate(()=>getTranslationCatalog([{name:'light_particles',category:'0'}])[0]);
  expect(catalog.registeredStatus).toBe('provisional');expect(catalog.displayStatus).toBe('japanese_present');
  expect((await page.evaluate(()=>getDictionaryStatusCounts())).provisional).toBe(4);
  expect(await exported(page,'#v15Export')).toEqual(dictionary);
});

test('adopted Latin labels differ from unreviewed English tags and are not sent for translation',async({page})=>{
  const requests=[];
  await page.route('https://api.mymemory.translated.net/**',async route=>{requests.push(route.request().url());await route.abort();});
  await page.goto('/');
  const dictionary={format:'wdtagger_japanese_dictionary',version:1,translations:{virtual_youtuber:'VTuber',bdsm:'BDSM',synthetic_raw_tag:'synthetic raw tag',synthetic_other:'SF'}};
  await importDictionary(page,dictionary);
  const labels=await page.evaluate(()=>['virtual_youtuber','bdsm','science_fiction'].map(tag=>({tag,label:translateTag(tag),pending:v17IsPending(tag)})));
  expect(labels).toEqual([{tag:'virtual_youtuber',label:'VTuber',pending:false},{tag:'bdsm',label:'BDSM',pending:false},{tag:'science_fiction',label:'SF',pending:false}]);
  expect(await page.evaluate(()=>v17IsPending('synthetic_raw_tag'))).toBe(true);
  expect(await page.evaluate(()=>v17IsPending('synthetic_other'))).toBe(true);
  await page.locator('#v17Online').check();await page.evaluate(()=>v17TranslateList(['virtual_youtuber','bdsm','science_fiction']));
  expect(requests).toEqual([]);
  const stats=await page.evaluate(()=>getDictionaryStatusCounts());expect(stats.adopted_latin).toBe(2);expect(stats.untranslated).toBe(2);
  expect(await exported(page,'#v15Export')).toEqual(dictionary);
});

test('raw lower-case acronym and placeholders are not implicitly adopted',async({page})=>{
  await page.goto('/');
  const dictionary={format:'wdtagger_japanese_dictionary',version:1,translations:{bdsm:'bdsm',virtual_youtuber:'virtual youtuber',synthetic_tag:'暫定訳：SF'}};
  await importDictionary(page,dictionary);
  expect(await page.evaluate(()=>v17IsPending('bdsm'))).toBe(true);
  expect(await page.evaluate(()=>v17IsPending('virtual_youtuber'))).toBe(true);
  expect(await page.evaluate(()=>classifyTranslationValue('synthetic_tag',v15Custom.synthetic_tag))).toBe('provisional');
  expect(await exported(page,'#v15Export')).toEqual(dictionary);
});

test('manual Japanese labels retain priority over adopted Latin, cache and built-in fallbacks',async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>{v17Cache.virtual_youtuber='古い自動訳';v17Cache.light_particles='古いキャッシュ';});
  const dictionary={format:'wdtagger_japanese_dictionary',version:1,translations:{virtual_youtuber:'手動の配信者訳',science_fiction:'手動の空想科学訳',light_particles:'手動の光粒訳'}};
  await importDictionary(page,dictionary);
  for(const [tag,label] of Object.entries(dictionary.translations))expect(await page.evaluate(tag=>translateTag(tag),tag)).toBe(label);
  expect(await exported(page,'#v15Export')).toEqual(dictionary);
});

test('dictionary import, manual editing and reverting refresh both existing history tables without changing counts',async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>{
    histTable($('histResults'),[{tag:'holding',yes:7,no:3}]);histTable($('histAll'),[{tag:'holding',yes:7,no:3}]);
    for(const id of ['histResults','histAll'])document.querySelector('#'+id+' tr[title]').dataset.preserved='yes';
    $('histStatus').textContent='history counters stay unchanged';lastTags=[{name:'holding',category:'0',score:0.9}];renderEditor();
  });
  await importDictionary(page,{format:'wdtagger_japanese_dictionary',version:1,translations:{holding:'辞書で持つ'}});
  for(const id of ['histResults','histAll'])await expect(page.locator('#'+id+' tr[title] td').first()).toHaveText('辞書で持つ');
  await page.locator('details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
  const row=page.locator('.tagline').filter({has:page.locator('.review-state[data-tag="holding"]')});
  await row.getByRole('button',{name:'訳を編集'}).click();await row.locator('.v15Editor input').fill('手動で持つ');await row.getByRole('button',{name:'この訳を登録'}).click();
  for(const id of ['histResults','histAll']){
    await expect(page.locator('#'+id+' tr[title] td').first()).toHaveText('手動で持つ');
    await expect(page.locator('#'+id+' tr[title]')).toHaveAttribute('data-preserved','yes');
    expect(await page.locator('#'+id+' tr[title] td').allTextContents()).toEqual(['手動で持つ','7','3']);
  }
  await row.getByRole('button',{name:'訳を編集'}).click();await row.getByRole('button',{name:'標準訳に戻す'}).click();
  for(const id of ['histResults','histAll'])await expect(page.locator('#'+id+' tr[title] td').first()).toHaveText('holding');
  await expect(page.locator('#histStatus')).toHaveText('history counters stay unchanged');
});

test('online cache updates refresh history labels without reinterpreting historical judgments',async({page})=>{
  await page.route('https://api.mymemory.translated.net/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({responseStatus:200,responseData:{translatedText:'オンラインの仮訳'}})}));
  await page.goto('/');
  await page.evaluate(()=>histTable($('histAll'),[{tag:'synthetic_history',yes:2,no:1}]));
  await page.locator('#v17Online').check();await page.evaluate(()=>v17TranslateList(['synthetic_history']));
  expect(await page.locator('#histAll tr[title] td').allTextContents()).toEqual(['オンラインの仮訳','2','1']);
});
