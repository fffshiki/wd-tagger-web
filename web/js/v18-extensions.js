
// v13: Historical review reference only. Never changes a review state or model prediction.
const histPanel=document.createElement('section');histPanel.id='historyPanel';
histPanel.innerHTML=`<h2>⑦ 過去の判定履歴を参考表示（v13）</h2>
<p class="muted">⑤で選択した教師データJSONの判定履歴を集計します。現在の解析結果に含まれるタグについて、過去に「正しい」「間違い」と判定された回数を表示します。<strong>過去の判定を現在の画像に自動適用することはありません。</strong></p>
<div class="actions"><button id="histCheck" type="button">履歴を集計・解析結果と照合</button></div>
<p id="histStatus" class="muted">⑤で教師データJSONを選び、画像を解析したあとに押してください。</p>
<div id="histResults" style="overflow-x:auto"></div><details><summary>履歴にある全タグの集計を見る</summary><div id="histAll" style="overflow-x:auto"></div></details>
<p class="muted">過去の頻度はAIの予測確率ではありません。画像が似ていることも保証しません。未確認・学習未承認のタグは集計せず、各画像IDは1件だけ数えます。</p>`;
document.body.appendChild(histPanel);
const histCss=document.createElement('style');histCss.textContent=`#historyPanel table{border-collapse:collapse;width:100%;font-size:14px;min-width:400px}#historyPanel th,#historyPanel td{padding:10px;border-bottom:1px solid #e0e6ed;text-align:left}#historyPanel th{background:#eaf0f7}#historyPanel .hist-warn{color:#9e421e}#historyPanel .hist-sum{padding:12px;background:#eef3fa;border-radius:10px;margin:12px 0}`;document.head.appendChild(histCss);
function histList(a){return [...new Set(Array.isArray(a)?a.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()):[])];}
function histExtract(j){
 if(!j||typeof j!=='object'||Array.isArray(j)||typeof j.image_id!=='string'||!j.image_id.trim())throw Error('画像IDなし');
 const st=j.ai_prediction?.review_states;
 let yes=[],no=[];
 if(Array.isArray(st)&&st.length){yes=st.filter(x=>x?.status==='accepted').map(x=>x.name);no=st.filter(x=>x?.status==='rejected').map(x=>x.name);}
 else {yes=j.review?.accepted_tags||j.ai_prediction?.tag_review?.accepted||[];no=j.review?.rejected_tags||j.ai_prediction?.tag_review?.rejected||[];}
 yes=histList(yes);no=histList(no);
 if(yes.some(x=>no.includes(x)))throw Error('正誤が重複');
 if(!yes.length&&!no.length)throw Error('確認済み判定なし');
 return {id:j.image_id,yes,no};
}
function histTable(target,rows){target.replaceChildren();if(!rows.length){target.textContent='該当するタグはありません。';return;}
 const table=document.createElement('table'),head=document.createElement('tr');
 for(const label of ['タグ','過去：正しい','過去：間違い']){const th=document.createElement('th');th.textContent=label;head.appendChild(th);}table.appendChild(head);
 for(const x of rows){const tr=document.createElement('tr');for(const v of [typeof translateTag==='function'?translateTag(x.tag):x.tag,x.yes,x.no]){const td=document.createElement('td');td.textContent=String(v);tr.appendChild(td);}tr.title=x.tag;table.appendChild(tr);}target.appendChild(table);
}
document.getElementById('histCheck').addEventListener('click',async()=>{
 const status=document.getElementById('histStatus'),out=document.getElementById('histResults'),all=document.getElementById('histAll');out.replaceChildren();all.replaceChildren();
 const files=[...document.getElementById('batchFiles').files];if(!files.length){status.textContent='先に⑤で教師データJSONを選択してください。';return;}
 const history=[],errors=[],seen=new Set();
 for(const f of files){try{const j=JSON.parse(await f.text());const e=histExtract(j);if(seen.has(e.id)){errors.push(`${e.id}：画像ID重複（2件目以降は除外）`);continue;}seen.add(e.id);history.push(e);}catch(err){errors.push(`${f.name}：${err.message}`);}}
 const counts=new Map();for(const h of history){for(const tag of h.yes){if(!counts.has(tag))counts.set(tag,{tag,yes:0,no:0});counts.get(tag).yes++;}for(const tag of h.no){if(!counts.has(tag))counts.set(tag,{tag,yes:0,no:0});counts.get(tag).no++;}}
 const rows=[...counts.values()].sort((a,b)=>b.yes+b.no-(a.yes+a.no)||a.tag.localeCompare(b.tag));histTable(all,rows);
 const current=Array.isArray(lastTags)?lastTags:[];
 const currentRows=[...new Set(current.map(x=>x.name))].filter(tag=>counts.has(tag)).map(tag=>counts.get(tag));histTable(out,currentRows);
 status.textContent=`履歴画像 ${history.length}件 / 確認済みタグ ${counts.size}種類 / 現在の解析と一致 ${currentRows.length}種類 / 除外・注意 ${errors.length}件`+(current.length?'':'（まだ画像を解析していません）');
 if(errors.length){const p=document.createElement('p');p.className='hist-warn';p.textContent=errors.slice(0,4).join(' ／ ');out.appendChild(p);}
});

// v15: user-owned, presentation-only Japanese dictionary. Never changes canonical tag keys.
const v15Seed={girl_on_top:'女性が上になる体位',clothed_sex:'着衣での性行為',thigh_boots:'太もも丈のブーツ',straddling:'またがる姿勢',shako_cap:'制帽',white_skirt:'白いスカート',cowgirl_position:'騎乗位',':d':'大きく口を開けた笑顔',red_footwear:'赤い履物',epaulettes:'肩章',white_gloves:'白い手袋',alternate_breast_size:'胸の大きさが異なる',sleeveless:'袖なし',steaming_body:'身体から湯気が出ている',high_heels:'ハイヒール',band_uniform:'楽団の制服',sleeveless_shirt:'袖なしシャツ',happy_sex:'楽しそうな性行為',high_heel_boots:'ヒール付きブーツ'};
const v15StorageKey='wdtagger_custom_jp_dictionary_v15';
let v15Custom={};let v15StorageAvailable=true;
try{const stored=localStorage.getItem(v15StorageKey);if(stored){const obj=JSON.parse(stored);if(obj&&typeof obj==='object'&&!Array.isArray(obj))for(const [k,v] of Object.entries(obj))if(typeof v==='string'&&v.trim())v15Custom[k]=v.trim();}}catch(e){v15StorageAvailable=false;}
const v14TranslateTag=translateTag;
translateTag=function(tag){return v15Custom[tag]||v15Seed[tag]||v14TranslateTag(tag);};
function v15Save(){try{localStorage.setItem(v15StorageKey,JSON.stringify(v15Custom));v15StorageAvailable=true;return true;}catch(e){v15StorageAvailable=false;return false;}}
function v15Refresh(){
 for(const el of document.querySelectorAll('#editor [data-v15-label]')){const tag=el.dataset.v15Label;const t=lastTags.find(x=>x.name===tag);el.textContent=translateTag(tag)+(t?' ('+(t.score*100).toFixed(1)+'%)':'');}
 if(Array.isArray(lastTags)&&lastTags.length){$('tagsOut').textContent=lastTags.map(x=>`${(x.score*100).toFixed(1)}%  ${translateTag(x.name)}  [${categoryNames[String(x.category)]||'その他'}]`).join('\n');}
 const c=document.getElementById('v15Count');if(c)c.textContent=`登録済みの手動翻訳：${Object.keys(v15Custom).length}件`;
}
function v15Export(){const payload={format:'wdtagger_japanese_dictionary',version:1,translations:v15Custom};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='WDTagger_日本語辞書.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);}
const v15Box=document.createElement('section');v15Box.innerHTML=`<strong>⑧ 日本語翻訳辞書（v15）</strong><p class="muted">各タグの「訳を編集」から日本語表現を変更できます。変更は同じ英語タグに適用されます。<b>正誤判定や学習用JSONの英語タグは変更しません。</b></p><p id="v15Count" class="muted"></p><p id="v15Notice" class="muted"></p><div class="actions"><button type="button" id="v15Export">翻訳辞書を保存</button><label style="display:inline-block;flex:1;min-width:160px">翻訳辞書を読み込む<input id="v15Import" type="file" accept=".json,application/json"></label></div><p class="muted">辞書の読み込みは同名の翻訳だけ上書きします。iPhoneのブラウザ保存領域は消える場合があるので、編集後は必ず辞書JSONも保存してください。</p>`;
document.body.insertBefore(v15Box,document.querySelector('script'));
document.getElementById('v15Export').addEventListener('click',v15Export);
document.getElementById('v15Import').addEventListener('change',async e=>{
 const f=e.target.files?.[0];if(!f)return;
 try{const raw=JSON.parse(await f.text());if(raw?.format!=='wdtagger_japanese_dictionary'||raw.version!==1||!raw.translations||typeof raw.translations!=='object'||Array.isArray(raw.translations))throw Error('辞書形式が違います');let n=0;for(const [k,v] of Object.entries(raw.translations)){if(typeof k==='string'&&k.length<160&&typeof v==='string'&&v.trim()&&v.length<200){v15Custom[k]=v.trim();n++;}}const persisted=v15Save();v15Refresh();document.getElementById('v15Notice').textContent=`${n}件の翻訳を読み込みました。${persisted?'端末にも保存しました。':'端末への自動保存は使えません。辞書JSONを保存してください。'}`;}catch(err){document.getElementById('v15Notice').textContent='読み込み失敗：'+err.message;}e.target.value='';
});
const v15PreviousRender=renderEditor;
renderEditor=function(){v15PreviousRender();const root=$('editor');for(const lab of root.querySelectorAll('.tagline')){
 const sel=lab.querySelector('.review-state');if(!sel)continue;const tag=sel.dataset.tag;const label=lab.querySelector('.taglabel')||lab.querySelector('span');if(!label)continue;
 label.dataset.v15Label=tag;const edit=document.createElement('button');edit.type='button';edit.className='v15Edit secondary';edit.textContent='訳を編集';edit.title='日本語表示だけを変更';edit.addEventListener('click',()=>{
  const old=lab.querySelector('.v15Editor');if(old){old.remove();return;}
  const panel=document.createElement('div');panel.className='v15Editor';const name=document.createElement('small');name.textContent='正式タグ：'+tag;
  const input=document.createElement('input');input.className='field';input.value='';input.placeholder='新しい日本語訳を入力（現在：'+translateTag(tag)+'）';input.maxLength=200;
  const save=document.createElement('button');save.type='button';save.textContent='この訳を登録';save.addEventListener('click',()=>{if(!input.value.trim()){alert('日本語訳を入力してください');return;}v15Custom[tag]=input.value.trim();const persisted=v15Save();v15Refresh();panel.remove();document.getElementById('v15Notice').textContent=persisted?'翻訳を更新しました。辞書JSONの保存もおすすめします。':'翻訳を更新しました。端末への自動保存ができないため辞書JSONを保存してください。';});
  const revert=document.createElement('button');revert.type='button';revert.className='secondary';revert.textContent='標準訳に戻す';revert.addEventListener('click',()=>{delete v15Custom[tag];v15Save();v15Refresh();panel.remove();});
  const current=document.createElement('p');current.className='muted';current.textContent='現在の訳：'+translateTag(tag);panel.append(name,current,input,save,revert);lab.appendChild(panel);input.focus();
 });lab.appendChild(edit);
 }v15Refresh();};
const v15Style=document.createElement('style');v15Style.textContent='.tagline .v15Edit{font-size:12px;padding:7px 9px;grid-column:1 / -1;justify-self:start}.tagline .v15Editor{grid-column:1 / -1;width:100%;background:#f1f5fa;border-radius:10px;padding:10px;box-sizing:border-box}.v15Editor button{margin:3px 6px 3px 0;padding:9px;font-size:14px}';document.head.appendChild(v15Style);
v15Refresh();

// v16: optional excluded status, independent outfit preset registry, improved iPhone editor.
const v16CSS=document.createElement('style');v16CSS.textContent=`
.v15Editor{display:block!important;flex:0 0 100%!important;min-width:100%!important;max-width:100%!important;}
.v15Editor .field{display:block!important;width:100%!important;min-width:100%!important;box-sizing:border-box!important;min-height:54px!important;font-size:18px!important;padding:14px!important;background:#fff!important;color:#162237!important;}
.v15Editor .muted{overflow-wrap:anywhere}.outfit-box{background:#f4f7fc;border:1px solid #dce3ee;border-radius:10px;padding:12px;margin:10px 0}
.outfit-box input,.outfit-box select{display:block;width:100%;box-sizing:border-box;min-height:46px;padding:10px;font-size:16px;border:1px solid #c7d2e2;border-radius:8px;margin:6px 0 12px}
.outfit-box button{margin:4px 6px 4px 0}.outfit-row{border-bottom:1px solid #dce3ee;padding:9px 0;overflow-wrap:anywhere}
`;document.head.appendChild(v16CSS);
const v16OldRender=renderEditor;
renderEditor=function(){v16OldRender();for(const sel of document.querySelectorAll('#editor .review-state')){
 if(![...sel.options].some(o=>o.value==='excluded')){const o=document.createElement('option');o.value='excluded';o.textContent='不要';sel.appendChild(o);}
 const old=existingJson?.ai_prediction?.review_states?.find(x=>x.name===sel.dataset.tag&&String(x.category)===sel.dataset.category);
 if(old?.status==='excluded')sel.value='excluded';
 const lab=sel.closest('.tagline');if(lab&&!lab.querySelector('.v16Outfit')){const b=document.createElement('button');b.type='button';b.className='secondary v16Outfit';b.textContent='衣装として登録';b.style.cssText='font-size:12px;padding:7px 9px';b.addEventListener('click',()=>v16OpenOutfit(sel.dataset.tag));lab.appendChild(b);}
 }updateReviewSummary();};
const v16OldSummary=updateReviewSummary;
updateReviewSummary=function(){v16OldSummary();const e=$('reviewSummary');if(e)e.textContent+=' / 不要 '+document.querySelectorAll('#editor .review-state').length+'件中 '+[...document.querySelectorAll('#editor .review-state')].filter(x=>x.value==='excluded').length+'件';};
const v16OldBuild=buildJson;
buildJson=function(){const j=v16OldBuild();const excluded=[...document.querySelectorAll('#editor .review-state')].filter(x=>x.value==='excluded').map(x=>x.dataset.tag);const accepted=[...document.querySelectorAll('#editor .review-state')].filter(x=>x.value==='accepted').map(x=>x.dataset.tag);const rejected=[...document.querySelectorAll('#editor .review-state')].filter(x=>x.value==='rejected').map(x=>x.dataset.tag);const pending=[...document.querySelectorAll('#editor .review-state')].filter(x=>x.value==='pending').map(x=>x.dataset.tag);
 j.ai_prediction.tag_review={accepted,rejected,pending,excluded};j.ai_prediction.review_states=[...document.querySelectorAll('#editor .review-state')].map(x=>({name:x.dataset.tag,category:Number(x.dataset.category),status:x.value,score:Math.round((lastTags.find(t=>t.name===x.dataset.tag)?.score||0)*10000)/10000}));
 if(j.review){j.review.accepted_tags=accepted;j.review.rejected_tags=rejected;j.review.pending_tags=pending;j.review.excluded_tags=excluded;j.review.note='Excluded and pending tags are not used for training.';}
 j.excluded_tags=excluded;
 return j;};
const v16StoreKey='wdtagger_outfits_v16';let v16Outfits=[];
try{const x=JSON.parse(localStorage.getItem(v16StoreKey)||'[]');if(Array.isArray(x))v16Outfits=x;}catch(e){}
function v16Persist(){try{localStorage.setItem(v16StoreKey,JSON.stringify(v16Outfits));return true;}catch(e){return false;}}
function v16Download(name,data){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),3000);}
const v16Section=document.createElement('section');v16Section.innerHTML=`<strong>⑨ 衣装プリセット（v16）</strong><p class="muted">衣装シリーズの中に、登録順でNo.1、No.2…を作ります。別キャラクターに着せるための参考情報として管理します。画像を解析後、タグの「衣装として登録」からも追加できます。</p><div class="outfit-box"><label>衣装シリーズ名<input id="v16Series" placeholder="例：花咲川女子学園の制服"></label><label>衣装の元キャラクター<input id="v16Char" placeholder="例：戸山香澄"></label><label>衣装の特徴・補足<textarea id="v16Desc" class="field" placeholder="例：赤いリボン、紺色の上着"></textarea></label><p id="v16Source" class="muted">元タグ：手動登録</p><button type="button" id="v16Add">この衣装を登録</button><p id="v16Msg" class="muted"></p></div><strong>登録済みの衣装</strong><div id="v16List"></div><div class="actions"><button type="button" id="v16Export">衣装プリセットJSONを保存</button><label>衣装プリセットJSONを読み込む<input type="file" id="v16Import" accept=".json,application/json"></label></div><p class="muted">端末の保存領域は消えることがあります。衣装を登録したらJSONも保存してください。衣装の参考画像本体はJSONには埋め込まず、画像IDとファイル名を記録します。</p>`;
document.body.insertBefore(v16Section,document.querySelector('script'));
let v16SourceTag='';
function v16OpenOutfit(tag){v16SourceTag=tag;$('v16Series').value=translateTag(tag);$('v16Char').value=$('charName').value.trim();$('v16Source').textContent='元タグ：'+tag+' / 元画像：'+($('img').files[0]?.name||'未選択');v16Section.scrollIntoView({behavior:'smooth',block:'start'});}
function v16Render(){const root=$('v16List');root.replaceChildren();if(!v16Outfits.length){root.textContent='まだ登録されていません。';return;}const grouped=new Map();for(const x of v16Outfits){if(!grouped.has(x.series))grouped.set(x.series,[]);grouped.get(x.series).push(x);}for(const [series,entries] of grouped){const box=document.createElement('div');box.className='outfit-box';const h=document.createElement('strong');h.textContent=series+'（'+entries.length+'件）';box.appendChild(h);for(const e of entries){const r=document.createElement('div');r.className='outfit-row';const no=entries.indexOf(e)+1;r.textContent='No.'+no+' '+e.character+' / '+(e.image_id||'画像未設定')+(e.description?' / '+e.description:'');const del=document.createElement('button');del.type='button';del.className='secondary';del.textContent='削除';del.style.cssText='font-size:12px;padding:6px 10px;margin-left:8px';del.addEventListener('click',()=>{if(!confirm('この衣装登録を削除しますか？'))return;v16Outfits=v16Outfits.filter(x=>x.id!==e.id);v16Persist();v16Render();});r.appendChild(del);box.appendChild(r);}root.appendChild(box);}}
$('v16Add').addEventListener('click',()=>{const series=$('v16Series').value.trim(),character=$('v16Char').value.trim();if(!series||!character){$('v16Msg').textContent='衣装シリーズ名と元キャラクター名を入力してください。';return;}const image=$('img').files[0],imageId=image?.name.replace(/\.[^.]+$/,'')||'';const duplicate=v16Outfits.find(x=>x.series===series&&x.character===character);if(duplicate){$('v16Msg').textContent='同じシリーズとキャラクターは登録済みです。重複登録を防止しました。';return;}v16Outfits.push({id:'outfit_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),series,character,description:$('v16Desc').value.trim(),source_tag:v16SourceTag,image_id:imageId,image_filename:image?.name||'',created_at:new Date().toISOString()});const saved=v16Persist();v16Render();$('v16Msg').textContent='登録しました。'+(saved?'':'端末保存に失敗したため、必ずJSONを保存してください。')+' JSONのバックアップもおすすめします。';v16SourceTag='';$('v16Source').textContent='元タグ：手動登録';});
$('v16Export').addEventListener('click',()=>v16Download('WDTagger_衣装プリセット.json',{format:'wdtagger_outfit_presets',version:1,outfits:v16Outfits}));
$('v16Import').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());if(data?.format!=='wdtagger_outfit_presets'||data.version!==1||!Array.isArray(data.outfits))throw Error('衣装プリセットJSONではありません');let added=0;for(const x of data.outfits){if(!x||typeof x.series!=='string'||typeof x.character!=='string'||!x.series.trim()||!x.character.trim())continue;if(v16Outfits.some(y=>y.series===x.series&&y.character===x.character))continue;v16Outfits.push({id:'import_'+Date.now()+'_'+added,series:x.series,character:x.character,description:String(x.description||''),source_tag:String(x.source_tag||''),image_id:String(x.image_id||''),image_filename:String(x.image_filename||''),created_at:String(x.created_at||'')});added++;}v16Persist();v16Render();$('v16Msg').textContent=added+'件の衣装を読み込みました。';}catch(err){$('v16Msg').textContent='読み込み失敗：'+err.message;}e.target.value='';});
v16Render();

// v17: Hybrid dictionary + explicit online fallback. Canonical tags and teacher JSON unchanged.
const v17Bad=/^(?:固有名詞・専門用語（原語）\s*[:：]|暫定訳\s*[:：]|【要確認】)/;
const v17SavedTranslate=translateTag;
const v17CacheKey='wdtagger_v17_online_translations';
let v17Cache={};try{v17Cache=JSON.parse(localStorage.getItem(v17CacheKey)||'{}')||{}}catch(e){}
const v17Words={drooling:'よだれを垂らす',multiple_tails:'複数の尻尾',hooded_jacket:'フード付きジャケット',armband:'腕章',foreshortening:'遠近短縮法',hakama:'袴',steam:'湯気',casual:'普段着',gauntlets:'籠手',rope:'縄',china_dress:'チャイナドレス',couch:'ソファ',beard:'ひげ',corset:'コルセット',tentacles:'触手',eyeshadow:'アイシャドウ',science_fiction:'SF',reverse_suspended_congress:'逆吊り性交位',reverse_suspended_congress_position:'逆吊り性交位'};
const v17Parts={black:'黒い',white:'白い',red:'赤い',blue:'青い',green:'緑の',pink:'ピンクの',yellow:'黄色い',purple:'紫の',brown:'茶色い',grey:'灰色の',orange:'オレンジ色の',long:'長い',short:'短い',multiple:'複数の',single:'片方の',striped:'縞模様の',frilled:'フリル付き',hair:'髪',eyes:'目',skirt:'スカート',dress:'ドレス',shirt:'シャツ',jacket:'ジャケット',socks:'靴下',gloves:'手袋',ribbon:'リボン',bow:'蝶結び',ears:'耳',tail:'尻尾',wings:'翼',background:'背景',flower:'花',hat:'帽子',pants:'ズボン',shoes:'靴'};
function v17Local(tag){if(v17Words[tag])return v17Words[tag];const parts=tag.split('_');if(parts.length===2&&v17Parts[parts[0]]&&v17Parts[parts[1]])return v17Parts[parts[0]]+v17Parts[parts[1]];return '';}
function v17Resolved(tag){const manual=v15Custom[tag];if(manual&&!v17Bad.test(manual))return manual;if(v17Cache[tag])return v17Cache[tag];const local=v17Local(tag);if(local)return local;const seed=v17SavedTranslate(tag);return seed&&!v17Bad.test(seed)?seed:tag.replaceAll('_',' ');}
translateTag=function(tag){return v17Resolved(tag)};
function v18LooksUntranslated(tag,value){
 const v=String(value||'').trim();
 if(!v||v17Bad.test(v))return true;
 const raw=tag.replaceAll('_',' ').toLowerCase();
 const clean=v.replace(/^固有名詞・専門用語（原語）\s*[:：]\s*/,'').trim().toLowerCase();
 if(clean===raw||clean===tag.toLowerCase())return true;
 // A Japanese dictionary entry consisting solely of Latin words is not considered translated.
 return !/[\u3040-\u30ff\u3400-\u9fff]/.test(v) && /[a-zA-Z]/.test(v);
}
function v17IsPending(tag){
 const manual=v15Custom[tag];
 if(manual&&!v18LooksUntranslated(tag,manual))return false;
 const cache=v17Cache[tag];
 if(cache&&!v18LooksUntranslated(tag,cache))return false;
 const local=v17Local(tag);
 if(local&&!v18LooksUntranslated(tag,local))return false;
 const seed=v17SavedTranslate(tag);
 if(seed&&!v18LooksUntranslated(tag,seed))return false;
 return true;
}
// Preserve good translations, but never show a known placeholder as a valid translation.
function v18Resolved(tag){
 const manual=v15Custom[tag];if(manual&&!v18LooksUntranslated(tag,manual))return manual;
 const cache=v17Cache[tag];if(cache&&!v18LooksUntranslated(tag,cache))return cache;
 const local=v17Local(tag);if(local&&!v18LooksUntranslated(tag,local))return local;
 const seed=v17SavedTranslate(tag);if(seed&&!v18LooksUntranslated(tag,seed))return seed;
 return tag.replaceAll('_',' ');
}
translateTag=v18Resolved;

const v17Box=document.createElement('section');v17Box.innerHTML=`<strong>⑨ 未翻訳タグの自動翻訳（v18・C方式）</strong><p class="muted">辞書→端末内ルール→オンライン翻訳の順に使用。オンライン翻訳は明示的に実行した時だけ英語タグを外部サービス（MyMemory）へ送信します。画像・教師JSONは送信しません。無料APIは通信・CORS・回数制限や成人向け語句の翻訳失敗があります。</p><label><input type="checkbox" id="v17Online"> オンライン翻訳を許可する（英語タグのみ外部送信）</label><div class="actions"><button type="button" id="v17Translate">現在の画像の未翻訳タグを翻訳（最大30件ずつ）</button><button type="button" id="v17All" class="secondary">辞書の未翻訳タグをまとめて翻訳（最大30件/回）</button><button type="button" id="v17Clean" class="secondary">暫定訳・原語表示を一括除去</button></div><p id="v17Status" class="muted">準備完了。オフライン時は原語を表示します。</p><p class="muted">オンライン翻訳の結果は端末に一時保存され、辞書JSON保存時にも含まれます。誤訳は従来の「訳を編集」で修正してください。</p>`;
document.body.insertBefore(v17Box,document.querySelector('script'));
function v17Status(t){document.getElementById('v17Status').textContent=t;}
function v17Refresh(){v15Refresh();}
function v17Clean(){let n=0;for(const [k,v] of Object.entries(v15Custom)){if(v17Bad.test(v)){delete v15Custom[k];n++;}}v15Save();v17Refresh();v17Status(`${n}件の暫定表示を削除。元の英語タグは変更していません。修正後の辞書を保存してください。`);}
document.getElementById('v17Clean').addEventListener('click',()=>{if(confirm('「固有名詞・専門用語（原語）」と「暫定訳」の登録だけを辞書から削除します。よろしいですか？'))v17Clean()});
async function v17TranslateList(tags){if(!document.getElementById('v17Online').checked){v17Status('オンライン翻訳を使う場合は、先に許可へチェックしてください。');return;}const allPending=[...new Set(tags)].filter(v17IsPending);const pending=allPending.slice(0,30);if(!pending.length){v17Status('今回の対象に未翻訳タグはありません。');return;}let ok=0,fail=0;for(let i=0;i<pending.length;i++){const tag=pending[i];v17Status(`翻訳中 ${i+1}/${pending.length}：${tag} （成功${ok}／失敗${fail}）`);try{const url='https://api.mymemory.translated.net/get?q='+encodeURIComponent(tag.replaceAll('_',' '))+'&langpair=en|ja';const response=await fetch(url,{method:'GET',mode:'cors'});if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();const result=String(data?.responseData?.translatedText||'').trim();if(!result||v18LooksUntranslated(tag,result)||/<[^>]+>/.test(result)||Number(data.responseStatus)!==200)throw Error('翻訳結果なし');v17Cache[tag]=result;delete v15Custom[tag];ok++;}catch(e){fail++;}if((i+1)%5===0){try{localStorage.setItem(v17CacheKey,JSON.stringify(v17Cache))}catch(e){}v17Refresh();}}
try{localStorage.setItem(v17CacheKey,JSON.stringify(v17Cache))}catch(e){}v15Save();v17Refresh();const remaining=[...new Set(tags)].filter(v17IsPending).length;v17Status(`完了：成功${ok}件／失敗${fail}件／未翻訳残り${remaining}件。残りがある場合はもう一度押してください。英語を返した翻訳は失敗扱いです。辞書JSONを保存してください。`);}
document.getElementById('v17Translate').addEventListener('click',()=>v17TranslateList(lastTags.map(x=>x.name)));
document.getElementById('v17All').addEventListener('click',()=>v17TranslateList(Object.keys(v15Custom)));
const v17OldExport=v15Export;
v15Export=function(){const translations={...v15Custom,...v17Cache};const payload={format:'wdtagger_japanese_dictionary',version:1,translations};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='WDTagger_日本語辞書_v18.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);};
// Existing event listener captured old function; rebind export button to the v17 format.
const v17ExportBtn=document.getElementById('v15Export');const v17NewBtn=v17ExportBtn.cloneNode(true);v17ExportBtn.replaceWith(v17NewBtn);v17NewBtn.addEventListener('click',v15Export);
