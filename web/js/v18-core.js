
'use strict';
const $=id=>document.getElementById(id);let tagRows=[],lastTags=[],existingJson=null,generatedJson='';
let cachedSession=null,cachedModelFile=null,analysisBusy=false,dirty=false,analysisImageFile=null;
function markDirty(){dirty=true;const n=$('dirtyStatus');if(n)n.textContent='未保存の編集があります';}
function clearDirty(){dirty=false;const n=$('dirtyStatus');if(n)n.textContent='変更なし';}
function resetForNewImage(){existingJson=null;lastTags=[];analysisImageFile=null;$('existing').value='';$('existingInfo').textContent='未選択：新規作成モード';$('charName').value='';$('series').value='';$('notes').value='';$('custom').value='';$('confirm').checked=false;$('protect').textContent='';$('editor').textContent='まず画像を解析してください。';$('jpEditor').textContent='解析すると日本語の項目別編集欄が表示されます。';$('tagsOut').textContent='まだ解析していません。';$('export').disabled=true;$('copyjson').disabled=true;$('copy').hidden=true;clearDirty();}

const log=s=>{$('log').textContent+=`\n${s}`;};const resetLog=s=>{$('log').textContent=s;};
const selected=()=>!!($('model').files[0]&&$('csv').files[0]&&$('img').files[0]);
function update(){for(const [id,info] of [['model','modelInfo'],['csv','csvInfo'],['img','imgInfo']]){const f=$(id).files[0];$(info).textContent=f?`${f.name} / ${(f.size/1048576).toFixed(1)} MB`:'未選択';} $('run').disabled=!selected();}
$('model').addEventListener('change',update);$('csv').addEventListener('change',update);
let previousImage=null;
$('img').addEventListener('click',e=>{if(analysisBusy){e.preventDefault();return;}if(dirty&&!confirm('未保存の編集があります。画像を変更すると編集内容が失われます。続けますか？'))e.preventDefault();});
$('img').addEventListener('change',()=>{const f=$('img').files[0];if(f&&f!==previousImage){previousImage=f;resetForNewImage();$('preview').src=URL.createObjectURL(f);$('preview').hidden=false;}update();});
$('model').addEventListener('change',()=>{cachedSession=null;cachedModelFile=null;});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});

function parseCsvLine(line){const fields=[];let current='',quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){current+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){fields.push(current);current='';}else current+=c;}fields.push(current);return fields;}
async function loadTags(file){const lines=(await file.text()).replace(/^\uFEFF/,'').trim().split(/\r?\n/);const header=parseCsvLine(lines.shift());const nameIndex=header.indexOf('name'),categoryIndex=header.indexOf('category');if(nameIndex<0)throw Error('CSVにname列がありません');return lines.map(line=>{const v=parseCsvLine(line);return {name:v[nameIndex],category:categoryIndex>=0?v[categoryIndex]:''};});}
function loadScript(url){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=url;s.onload=resolve;s.onerror=()=>reject(Error('推論エンジンを取得できません。ネット接続・アプリの通信制限を確認してください。'));document.head.appendChild(s);});}
async function loadImage(file){return new Promise((resolve,reject)=>{const image=new Image();const url=URL.createObjectURL(file);image.onload=()=>{URL.revokeObjectURL(url);resolve(image);};image.onerror=()=>{URL.revokeObjectURL(url);reject(Error('画像を読み込めません'));};image.src=url;});}
function makeTensor(image,size,ort){const w=image.naturalWidth,h=image.naturalHeight;const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,size,size);const scale=size/Math.max(w,h);const dw=w*scale,dh=h*scale;ctx.drawImage(image,(size-dw)/2,(size-dh)/2,dw,dh);const rgba=ctx.getImageData(0,0,size,size).data;const bgr=new Float32Array(size*size*3);for(let i=0,j=0;i<rgba.length;i+=4){bgr[j++]=rgba[i+2];bgr[j++]=rgba[i+1];bgr[j++]=rgba[i];}return new ort.Tensor('float32',bgr,[1,size,size,3]);}
$('run').addEventListener('click',async()=>{if(!selected()||analysisBusy)return;if(dirty&&!confirm('未保存の編集があります。再解析すると判定が失われる可能性があります。続けますか？'))return;analysisBusy=true;$('run').disabled=true;$('progress').hidden=false;$('progress').removeAttribute('value');$('tagsOut').textContent='解析中…';$('copy').hidden=true;resetLog('解析開始');let session;try{
log('タグ一覧を読み込み中…');tagRows=await loadTags($('csv').files[0]);log(`タグ数: ${tagRows.length}`);
log('ONNX Runtime Webを読み込み中…（初回は通信が必要）');const version='1.20.1',base=new URL('./vendor/onnxruntime/',document.baseURI).href;if(!window.ort)await loadScript(base+'ort.wasm.min.js');ort.env.wasm.wasmPaths=base;ort.env.wasm.numThreads=1;ort.env.wasm.simd=true;
if(cachedSession&&cachedModelFile===$('model').files[0]){session=cachedSession;log('モデルを再利用しています（再読み込み不要）');}else{log('モデルを読み込み中…（約467MB）');const buffer=await $('model').files[0].arrayBuffer();session=await ort.InferenceSession.create(new Uint8Array(buffer),{executionProviders:['wasm'],graphOptimizationLevel:'all'});cachedSession=session;cachedModelFile=$('model').files[0];log('モデル読み込み成功（次回は再利用）');}
const inputName=session.inputNames[0],outputName=session.outputNames[0];const inputMeta=session.inputMetadata?.[inputName];let size=448;const dims=inputMeta?.dimensions||inputMeta?.dims;if(Array.isArray(dims)&&Number.isInteger(dims[1])&&dims[1]>0)size=dims[1];log(`入力: ${inputName} / 画像サイズ: ${size} × ${size}`);
const image=await loadImage($('img').files[0]);const tensor=makeTensor(image,size,ort);log('画像解析を実行中…');const outputs=await session.run({[inputName]:tensor});const values=outputs[outputName].data;log(`出力数: ${values.length}`);if(values.length!==tagRows.length)throw Error(`タグ数とモデル出力数が一致しません（CSV ${tagRows.length}、出力 ${values.length}）。`);
lastTags=tagRows.map((r,i)=>({...r,score:Number(values[i])})).filter(x=>x.score>=0.35).sort((a,b)=>b.score-a.score);$('tagsOut').textContent=lastTags.length?lastTags.map(x=>`${(x.score*100).toFixed(1)}%  ${translateTag(x.name)}  [${categoryNames[String(x.category)]||'その他'}]`).join('\n'):'35%以上のタグはありませんでした。';$('copy').hidden=!lastTags.length;log('解析完了！');analysisImageFile=$('img').files[0];renderEditor();clearDirty();
}catch(e){log(`エラー: ${e?.message||String(e)}`);$('tagsOut').textContent='解析できませんでした。上のログを確認してください。';}finally{session=undefined;analysisBusy=false;$('progress').hidden=true;$('run').disabled=!selected();}});
$('copy').addEventListener('click',async()=>{const value=lastTags.map(x=>x.name).join(', ');try{await navigator.clipboard.writeText(value);log('タグをコピーしました');}catch(e){log('このアプリではコピーが制限されています');}});

const categoryNames={'0':'一般・外見・ポーズ','1':'作者','3':'著作物・作品','4':'キャラクター','5':'メタ情報','9':'レーティング'};
function renderEditor(){const root=$('editor');root.replaceChildren();const groups=new Map();for(const t of lastTags){const k=String(t.category);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(t);}for(const [cat,tags] of groups){const sec=document.createElement('div');sec.className='taggroup';const h=document.createElement('strong');h.textContent=(categoryNames[cat]||'その他')+' ['+cat+']';sec.appendChild(h);for(const t of tags){const lab=document.createElement('label');lab.className='tagline';const check=document.createElement('input');check.type='checkbox';check.checked=true;check.dataset.tag=t.name;check.dataset.category=cat;const span=document.createElement('span');span.textContent=`${t.name} (${(t.score*100).toFixed(1)}%)`;span.dataset.tagLabel=t.name;lab.append(check,span);sec.appendChild(lab);}root.appendChild(sec);}const best=lastTags.find(t=>String(t.category)==='4');if(best&&!$('charName').value)$('charName').value=best.name.replaceAll('_',' ');$('export').disabled=false;$('copyjson').disabled=false;}
$('existing').addEventListener('change',async()=>{existingJson=null;const f=$('existing').files[0];if(!f){$('existingInfo').textContent='未選択：新規作成モード';$('protect').textContent='';return;}try{const j=JSON.parse(await f.text());if(!j||typeof j!=='object'||Array.isArray(j))throw Error('JSONの形式が不正です');if($('img').files[0]&&j.image_id!==$('img').files[0].name.replace(/\.[^.]+$/,''))throw Error('画像IDが一致しません。正しい画像のJSONを選択してください');existingJson=j;$('existingInfo').textContent=`読み込み成功：${f.name} / 状態：${j.label_status||'不明'}`;if(j.label_status==='user_confirmed'){$('protect').textContent='保護：確認済みデータは変更せず、AI予測だけを追加します。';$('confirm').checked=false;}else{$('protect').textContent='既存JSONを基に出力します。元ファイルは自動変更されません。';}const c=Array.isArray(j.characters)?j.characters[0]:null;if(c?.name)$('charName').value=c.name;if(c?.series)$('series').value=c.series;if(j.notes)$('notes').value=j.notes;if(lastTags.length)renderEditor();}catch(e){$('existingInfo').textContent='読み込み失敗：'+e.message;$('existing').value='';existingJson=null;}});
function buildJson(){const file=$('img').files[0];if(!file||!lastTags.length)throw Error('先に画像を解析してください');if(file!==analysisImageFile)throw Error('画像が変更されています。再解析してください');const stem=file.name.replace(/\.[^.]+$/,'');if(existingJson?.image_id&&existingJson.image_id!==stem)throw Error(`画像IDが不一致です：画像 ${stem} / JSON ${existingJson.image_id}`);const picked=[...document.querySelectorAll('#editor input[type=checkbox]:checked')].map(el=>({name:el.dataset.tag,category:Number(el.dataset.category),score:Math.round((lastTags.find(t=>t.name===el.dataset.tag)?.score||0)*10000)/10000}));const custom=$('custom').value.split(',').map(x=>x.trim()).filter(Boolean);const name=$('charName').value.trim();const series=$('series').value.trim();const confirmed=$('confirm').checked;const j=existingJson?structuredClone(existingJson):{schema_version:'1.0',image_id:stem,image_filename:file.name,label_status:'unlabeled',characters:[],background:[],style:[],notes:''};j.ai_prediction={model:'SmilingWolf/wd-swinv2-tagger-v3',source:'local_onnx_wasm',reviewed:confirmed,selected_tags:picked.map(({name,category})=>({name,category})),additional_tags:custom,raw_predictions:lastTags.map(({name,category,score})=>({name,category,score:Math.round(score*10000)/10000}))};if(existingJson?.label_status==='user_confirmed'){j.ai_prediction.reviewed=false;j.ai_prediction.review_note='Existing user_confirmed fields preserved. Proposed edits not applied.';return j;}if(confirmed){j.label_status='user_confirmed';j.characters=name?[{name,series,position:'unknown',hair:[],eyes:[],expression:[],clothing:'',pose:[]}]:[];j.confirmed_tags=[...new Set([...picked.map(x=>x.name),...custom])];j.notes=$('notes').value;}else{j.label_status=existingJson?.label_status||'ai_suggested';}return j;}
function makeJson(){const j=buildJson();generatedJson=JSON.stringify(j,null,2);$('exportInfo').textContent='JSON生成成功。元のJSONは自動上書きしません。';return {j,text:generatedJson};}
$('export').addEventListener('click',()=>{try{const {j,text}=makeJson();const blob=new Blob([text],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${j.image_id}_教師データ_v10.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);$('exportInfo').textContent='JSONのダウンロードを開始しました。保存完了をファイルアプリで確認してください。';clearDirty();}catch(e){$('exportInfo').textContent='エラー：'+e.message;}});
$('copyjson').addEventListener('click',async()=>{try{const {text}=makeJson();await navigator.clipboard.writeText(text);$('exportInfo').textContent='JSONをコピーしました。保存先への貼り付けも忘れずに。';}catch(e){$('exportInfo').textContent='コピーできません：'+e.message;}});

// v4: Japanese field editor. The original ONNX inference and v2 export logic are retained.
const fieldDefs=[
 ['hair_style','髪型',['long_hair','short_hair','medium_hair','very_long_hair','straight_hair','wavy_hair','curly_hair','twintails','ponytail','braid','straight_bangs','blunt_bangs','hair_between_eyes','ahoge']],
 ['hair_color','髪色',['blonde_hair','black_hair','brown_hair','pink_hair','blue_hair','white_hair','silver_hair','red_hair','green_hair','purple_hair']],
 ['eye_color','目の色',['yellow_eyes','blue_eyes','green_eyes','red_eyes','brown_eyes','purple_eyes','pink_eyes','black_eyes']],
 ['eye_details','目元・視線',['closed_eyes','half_closed_eyes','looking_at_viewer','looking_away']],
 ['expression','表情・口元',['smile','smiling','grin','laughing','blush','embarrassed','tongue_out','tongue','closed_mouth','open_mouth','frown','crying','tears','angry','surprised',':q']],
 ['clothing','服装・装飾',['school_uniform','dress','shirt','skirt','jacket','sweater','hat','ribbon','bow','necklace','nude','completely_nude','bare_shoulders']],
 ['pose','ポーズ・構図',['solo','1girl','2girls','upper_body','full_body','portrait','sitting','standing','lying','arms_up','front_view','from_above','from_below']],
 ['background','背景・小物',['white_background','simple_background','outdoors','indoors','heart','pink_heart','flower','sky','cloud','bed','room','window']],
 ['style','画風・仕上げ',['anime_coloring','anime_screencap','illustration','sketch','monochrome','watercolor','pixel_art']]
];
const jpNames={long_hair:'ロングヘア',short_hair:'ショートヘア',medium_hair:'ミディアムヘア',very_long_hair:'非常に長い髪',blonde_hair:'金髪',black_hair:'黒髪',brown_hair:'茶髪',pink_hair:'ピンク髪',blue_hair:'青髪',white_hair:'白髪',silver_hair:'銀髪',red_hair:'赤髪',green_hair:'緑髪',purple_hair:'紫髪',straight_hair:'ストレートヘア',wavy_hair:'ウェーブヘア',curly_hair:'巻き髪',twintails:'ツインテール',ponytail:'ポニーテール',braid:'三つ編み',straight_bangs:'まっすぐな前髪',blunt_bangs:'ぱっつん前髪',hair_between_eyes:'目の間に髪',ahoge:'アホ毛',yellow_eyes:'黄色い目',blue_eyes:'青い目',green_eyes:'緑の目',red_eyes:'赤い目',brown_eyes:'茶色い目',purple_eyes:'紫の目',pink_eyes:'ピンクの目',black_eyes:'黒い目',closed_eyes:'閉じた目',half_closed_eyes:'半目',looking_at_viewer:'こちらを見る',looking_away:'視線を外す',smile:'笑顔',smiling:'微笑み',grin:'にっこり',laughing:'笑う',blush:'赤面',embarrassed:'照れ',tongue_out:'舌を出す',tongue:'舌が見える',closed_mouth:'口を閉じる',open_mouth:'口を開ける',frown:'しかめ面',crying:'泣く',tears:'涙',angry:'怒り',surprised:'驚き',':q':'舌を少し出した表情',school_uniform:'制服',dress:'ドレス',shirt:'シャツ',skirt:'スカート',jacket:'ジャケット',sweater:'セーター',hat:'帽子',ribbon:'リボン',bow:'蝶結び',necklace:'ネックレス',nude:'衣服なし',completely_nude:'全裸',bare_shoulders:'肩が露出',solo:'単独', '1girl':'女性1人','2girls':'女性2人',upper_body:'上半身',full_body:'全身',portrait:'ポートレート',sitting:'座る',standing:'立つ',lying:'横になる',arms_up:'腕を上げる',front_view:'正面',from_above:'俯瞰',from_below:'あおり',white_background:'白い背景',simple_background:'シンプルな背景',outdoors:'屋外',indoors:'室内',heart:'ハート',pink_heart:'ピンクのハート',flower:'花',sky:'空',cloud:'雲',bed:'ベッド',room:'部屋',window:'窓',anime_coloring:'アニメ塗り',anime_screencap:'アニメの場面',illustration:'イラスト',sketch:'スケッチ',monochrome:'モノクロ',watercolor:'水彩',pixel_art:'ドット絵'};
let jpTouched=false;
function guessFields(){const r={};for(const [key,,tags] of fieldDefs){r[key]=lastTags.filter(x=>tags.includes(x.name)&&String(x.category)==='0').map(x=>x.name);}return r;}
function getFieldValues(){const r={};for(const [key] of fieldDefs){const el=$('jp_'+key);r[key]=el?el.value.split(/[,、\n]/).map(v=>v.trim()).filter(Boolean):[];}return r;}
function uniqueValues(values){return [...new Set(values.filter(Boolean))];}
function existingValues(key){if(!existingJson||existingJson.label_status!=='user_confirmed')return null;const c=Array.isArray(existingJson.characters)?existingJson.characters[0]:null;
  if(key==='background'||key==='style')return Array.isArray(existingJson[key])?existingJson[key]:[];
  if(!c)return [];
  if(key==='hair_style')return (c.hair||[]).filter(x=>!/(blonde|black|brown|pink|blue|white|silver|red|green|purple|金髪|黒髪|茶髪|ピンク髪|青髪|白髪|銀髪|赤髪|緑髪|紫髪)/i.test(x));
  if(key==='hair_color')return (c.hair||[]).filter(x=>/(blonde|black|brown|pink|blue|white|silver|red|green|purple|金髪|黒髪|茶髪|ピンク髪|青髪|白髪|銀髪|赤髪|緑髪|紫髪)/i.test(x));
  if(key==='eye_color')return (c.eyes||[]).filter(x=>!/(looking|closed|視線|目元)/i.test(x));
  if(key==='eye_details')return (c.eyes||[]).filter(x=>/(looking|closed|視線|目元)/i.test(x));
  const old=c[key];return Array.isArray(old)?old:typeof old==='string'&&old?[old]:[];
}
const equivalentTags={tongue:['tongue_out',':q'],tongue_out:[':q'],smiling:['smile'],grin:['smile'],completely_nude:['nude']};
function compactSuggestions(tags){const set=new Set(tags);return tags.filter(t=>!((equivalentTags[t]||[]).some(other=>set.has(other))));}
function renderJapanese(){const root=$('jpEditor');root.replaceChildren();if(!lastTags.length)return;const suggestions=guessFields();const protectedData=existingJson?.label_status==='user_confirmed';
const intro=document.createElement('p');intro.className='edit-note';intro.textContent=protectedData?'確認済みの値を表示中。AI候補は参考情報です。編集した値は別の提案欄に保存し、元の正解ラベルを変更しません。':'AI候補を日本語で表示中。内容を確認・修正してください。';root.appendChild(intro);
const im=$('preview');if(im.src){const preview=document.createElement('img');preview.className='mini-preview';preview.alt='確認用画像';preview.src=im.src;root.appendChild(preview);}
for(const [key,label] of fieldDefs){const group=document.createElement('div');group.className='jpitem';const title=document.createElement('label');title.htmlFor='jp_'+key;title.textContent=label;const inp=document.createElement('textarea');inp.className='field';inp.id='jp_'+key;inp.rows=2;inp.placeholder='カンマ区切りで編集';const aiTags=compactSuggestions(suggestions[key]);const aiValues=uniqueValues(aiTags.map(x=>jpNames[x]||x));const confirmedValues=existingValues(key);inp.value=(confirmedValues===null?aiValues:confirmedValues).join('、');inp.addEventListener('input',()=>{jpTouched=true;markDirty();});const hint=document.createElement('div');hint.className='hint';hint.textContent='AI候補: '+(aiTags.length?aiTags.map(x=>`${jpNames[x]||x} ${Math.round((lastTags.find(t=>t.name===x)?.score||0)*100)}%`).join(' / '):'該当なし（手動入力可）');group.append(title,inp,hint);root.appendChild(group);}}
const originalRenderEditor=renderEditor;
renderEditor=function(){originalRenderEditor();renderJapanese();};
// Existing JSON refresh occurs after its async file read completes, inside the main change handler.
const originalBuildJson=buildJson;
buildJson=function(){const j=originalBuildJson();const fields=getFieldValues();if(!lastTags.length)return j;
const protectedData=existingJson?.label_status==='user_confirmed';
j.ai_prediction.structured_suggestions={...fields,character_name:$('charName').value.trim(),series:$('series').value.trim()};
j.ai_prediction.structured_suggestions_source='Japanese editing screen; review required';
if(protectedData){j.ai_prediction.reviewed=false;j.ai_prediction.review_note='Original user-confirmed labels preserved. Japanese field edits stored as suggestions only.';return j;}
if($('confirm').checked){const c=j.characters?.[0]||{name:$('charName').value.trim(),series:$('series').value.trim(),position:'unknown'};c.hair=[...fields.hair_style,...fields.hair_color];c.eyes=[...fields.eye_color,...fields.eye_details];c.expression=fields.expression;c.clothing=fields.clothing.join('、');c.pose=fields.pose;j.characters=[c];j.background=fields.background;j.style=fields.style;j.ai_prediction.reviewed=true;}
return j;};

document.querySelectorAll('#charName,#series,#notes,#custom,#confirm').forEach(el=>el.addEventListener('input',markDirty));
// v5: explicit tri-state review of AI tags; unreviewed predictions are never ground truth.
const v4RenderEditor=renderEditor;
renderEditor=function(){
  v4RenderEditor();
  const root=$('editor');
  const info=document.createElement('p');info.className='review-help';
  info.textContent='初期状態はすべて「未確認」です。正しいものだけ「正しい」、誤りは「間違い」に変更してください。';
  root.prepend(info);
  for(const check of root.querySelectorAll('input[type=checkbox][data-tag]')){
    const lab=check.closest('label');
    const sel=document.createElement('select');sel.className='review-state';
    sel.dataset.tag=check.dataset.tag;sel.dataset.category=check.dataset.category;const label=lab.querySelector('.taglabel')||lab.querySelector('span');if(label){label.textContent=`${translateTag(check.dataset.tag)} (${(lastTags.find(t=>t.name===check.dataset.tag)?.score*100||0).toFixed(1)}%)`;label.title=check.dataset.tag;}
    for(const [value,label] of [['pending','未確認'],['accepted','正しい'],['rejected','間違い']]){
      const opt=document.createElement('option');opt.value=value;opt.textContent=label;sel.appendChild(opt);
    }
    check.checked=false;check.hidden=true;
    lab.appendChild(sel);
  }
  restoreReviewStates();
  updateReviewSummary();
   // Delegated handler is installed once, not every time the editor is redrawn.
  if(!root.dataset.reviewListener){
     root.addEventListener('change',e=>{if(e.target.matches('.review-state')){updateReviewSummary();markDirty();}});
     root.dataset.reviewListener='1';
   }
};
 // Restore decisions only for tags belonging to the current inference result.
 // Match both tag name and category to avoid accidental collisions.
 function restoreReviewStates(){
   const ai=existingJson?.ai_prediction;
   if(!ai)return;
   const states=new Map();
   const key=(name,category)=>String(category)+'\u0000'+String(name);
   if(Array.isArray(ai.review_states)){
     for(const item of ai.review_states){
       if(item&&['pending','accepted','rejected'].includes(item.status))
         states.set(key(item.name,item.category),item.status);
     }
   }else if(ai.tag_review){
     // Compatibility with JSON containing only the three tag lists.
     const categories=new Map(lastTags.map(t=>[t.name,t.category]));
     for(const [group,status] of [['accepted','accepted'],['rejected','rejected'],['pending','pending']]){
       for(const name of (Array.isArray(ai.tag_review[group])?ai.tag_review[group]:[])){
         if(categories.has(name))states.set(key(name,categories.get(name)),status);
       }
     }
   }
   for(const el of document.querySelectorAll('#editor .review-state')){
     el.value=states.get(key(el.dataset.tag,el.dataset.category))||'pending';
   }
 }
function updateReviewSummary(){
  let summary=$('reviewSummary');
  if(!summary){summary=document.createElement('div');summary.id='reviewSummary';summary.className='review-summary';$('editor').prepend(summary);}
  const states=[...document.querySelectorAll('#editor .review-state')].map(x=>x.value);
  summary.textContent=`判定：正しい ${states.filter(x=>x==='accepted').length}件 / 間違い ${states.filter(x=>x==='rejected').length}件 / 未確認 ${states.filter(x=>x==='pending').length}件`;
}
const v4BuildJson=buildJson;
buildJson=function(){
  const j=v4BuildJson();
  const states=[...document.querySelectorAll('#editor .review-state')].map(el=>({name:el.dataset.tag,category:Number(el.dataset.category),status:el.value,score:Math.round((lastTags.find(t=>t.name===el.dataset.tag)?.score||0)*10000)/10000}));
  const accepted=states.filter(x=>x.status==='accepted').map(x=>x.name);
  const rejected=states.filter(x=>x.status==='rejected').map(x=>x.name);
  const pending=states.filter(x=>x.status==='pending').map(x=>x.name);
  const protectedData=existingJson?.label_status==='user_confirmed';
  j.ai_prediction.tag_review={accepted,rejected,pending};
  j.ai_prediction.review_states=states;
  j.ai_prediction.reviewed=Boolean($('confirm').checked&&!protectedData);
  if(protectedData){
    // Never mutate previously confirmed labels; keep reviewed proposals separate.
    j.ai_prediction.reviewed=false;
    j.ai_prediction.review_note='Existing user-confirmed labels preserved. Tag decisions and edited fields are proposals only.';
  }else if($('confirm').checked){
    const custom=$('custom').value.split(',').map(x=>x.trim()).filter(Boolean);
    j.confirmed_tags=[...new Set([...accepted,...custom])];
    j.rejected_tags=rejected;
    j.label_status='user_confirmed';
  }else{
    // A provisional export cannot turn predictions into ground-truth tags.
    delete j.confirmed_tags;
    delete j.rejected_tags;
  }
  return j;
};

// v8: Presentation-only translation. Machine-readable tag names remain unchanged.
const v8Translations={breasts:'胸',nipples:'乳首',large_breasts:'大きな胸',collarbone:'鎖骨',sweat:'汗',breasts_squeezed_together:'胸を寄せる',tsurumaki_kokoro:'鶴巻こころ',hanasakigawa_school_uniform:'花咲川女子学園の制服',censored:'修正あり',mosaic_censoring:'モザイク修正',hetero:'男女',penis:'男性器', '1boy':'男性1人',questionable:'成人向け判定（要確認）',sweatdrop:'汗のしずく',long_sleeves:'長袖',short_sleeves:'半袖',open_clothes:'服が開いている',hair_ornament:'髪飾り',hairclip:'ヘアピン',hair_ribbon:'髪のリボン',bangs:'前髪',eyebrows_visible_through_hair:'髪越しに見える眉',open_eyes:'目を開ける',parted_lips:'唇が開いている',saliva:'唾液',looking_down:'下を見る',looking_up:'上を見る',simple_background:'シンプルな背景',white_background:'白い背景',blue_background:'青い背景',pink_background:'ピンクの背景',brown_hair:'茶髪',blonde_hair:'金髪',yellow_eyes:'黄色い目',solo:'単独'};
const v14Translations={"oral":"口を使った性的行為","pov":"主観視点","clothed_female_nude_male":"着衣の女性と裸の男性","fellatio":"フェラチオ","squatting":"しゃがむ姿勢","medium_breasts":"中くらいの胸","solo_focus":"1人を中心に描く構図","erection":"勃起","licking_penis":"男性器を舐める","gradient_background":"グラデーション背景","sailor_collar":"セーラー襟","upper_teeth_only":"上の歯だけ見える","teeth":"歯","black_socks":"黒い靴下","explicit":"露骨な成人向け表現","open_mouth":"口を開ける","tongue":"舌","tongue_out":"舌を出す","looking_at_viewer":"こちらを見る","blush":"赤面","closed_mouth":"口を閉じる","smile":"笑顔","nude":"衣服なし","completely_nude":"全裸","upper_body":"上半身","heart":"ハート","pink_hearts":"ピンクのハート","straight_bangs":"ぱっつん前髪","1girl":"女性1人","2girls":"女性2人","3girls":"女性3人","multiple_girls":"女性複数","1boy":"男性1人","2boys":"男性2人","multiple_boys":"男性複数","1other":"その他の人物1人","solo":"単独","couple":"カップル","group":"集団","male_focus":"男性中心","female_focus":"女性中心","portrait":"肖像構図","full_body":"全身","cowboy_shot":"太ももまでの構図","close-up":"クローズアップ","face":"顔","head":"頭","from_above":"上からの視点","from_below":"下からの視点","from_side":"横からの視点","from_behind":"後ろからの視点","looking_back":"振り返る","looking_away":"視線をそらす","looking_to_the_side":"横を見る","eye_contact":"視線が合う","facing_viewer":"正面を向く","profile":"横顔","dutch_angle":"斜めの構図","long_hair":"ロングヘア","short_hair":"ショートヘア","medium_hair":"ミディアムヘア","very_long_hair":"非常に長い髪","hair_over_one_eye":"片目にかかる髪","hair_between_eyes":"目の間にかかる髪","hair_over_eyes":"目を覆う髪","hair_intakes":"髪のハネ","ahoge":"アホ毛","ponytail":"ポニーテール","twintails":"ツインテール","braid":"三つ編み","single_braid":"一本の三つ編み","side_ponytail":"サイドポニーテール","bob_cut":"ボブカット","hime_cut":"姫カット","wavy_hair":"ウェーブヘア","curly_hair":"巻き髪","straight_hair":"ストレートヘア","messy_hair":"乱れた髪","hair_bun":"お団子ヘア","hairband":"ヘアバンド","hair_flower":"髪の花飾り","hair_bow":"髪のリボン飾り","black_hair":"黒髪","white_hair":"白髪","silver_hair":"銀髪","grey_hair":"灰色の髪","gray_hair":"灰色の髪","pink_hair":"ピンク髪","purple_hair":"紫髪","blue_hair":"青髪","green_hair":"緑髪","red_hair":"赤髪","orange_hair":"オレンジ髪","multicolored_hair":"多色の髪","two-tone_hair":"ツートンカラーの髪","blue_eyes":"青い目","red_eyes":"赤い目","green_eyes":"緑の目","purple_eyes":"紫の目","pink_eyes":"ピンクの目","brown_eyes":"茶色い目","black_eyes":"黒い目","grey_eyes":"灰色の目","gray_eyes":"灰色の目","heterochromia":"オッドアイ","closed_eyes":"目を閉じる","one_eye_closed":"片目を閉じる","wink":"ウインク","half-closed_eyes":"半目","tears":"涙","crying":"泣く","happy":"嬉しそう","embarrassed":"恥ずかしそう","surprised":"驚いた表情","angry":"怒った表情","sad":"悲しい表情","expressionless":"無表情","grin":"にっこり笑う","open_lips":"唇を開く","parted_lips":"唇が少し開く","fang":"八重歯","fangs":"八重歯","upper_teeth":"上の歯","lower_teeth":"下の歯","drooling":"よだれ","saliva":"唾液","sweat":"汗","sweatdrop":"汗のしずく","sitting":"座る","standing":"立つ","lying":"横になる","lying_on_back":"仰向け","lying_on_stomach":"うつ伏せ","kneeling":"ひざまずく","all_fours":"四つんばい","on_bed":"ベッドの上","on_floor":"床の上","leaning_forward":"前かがみ","arms_up":"両腕を上げる","arm_up":"片腕を上げる","arms_behind_back":"背中に手を回す","hand_on_hip":"腰に手を当てる","hands_on_hips":"両手を腰に当てる","hand_on_own_face":"自分の顔に手を当てる","hand_to_mouth":"口元に手を当てる","spread_legs":"脚を開く","crossed_legs":"脚を組む","legs_together":"脚を揃える","barefoot":"裸足","feet":"足","hands":"手","looking_up":"上を見る","looking_down":"下を見る","school_uniform":"学校制服","serafuku":"セーラー服","sailor_uniform":"セーラー服","collared_shirt":"襟付きシャツ","shirt":"シャツ","white_shirt":"白いシャツ","blouse":"ブラウス","skirt":"スカート","pleated_skirt":"プリーツスカート","miniskirt":"ミニスカート","dress":"ワンピース","sundress":"サンドレス","jacket":"ジャケット","cardigan":"カーディガン","sweater":"セーター","hoodie":"パーカー","t-shirt":"Tシャツ","shorts":"ショートパンツ","pants":"ズボン","jeans":"ジーンズ","black_legwear":"黒い脚衣","thighhighs":"ニーハイソックス","kneehighs":"ハイソックス","socks":"靴下","white_socks":"白い靴下","pantyhose":"パンティーストッキング","shoes":"靴","loafers":"ローファー","boots":"ブーツ","ribbon":"リボン","necktie":"ネクタイ","bowtie":"蝶ネクタイ","gloves":"手袋","hat":"帽子","glasses":"眼鏡","earrings":"イヤリング","necklace":"ネックレス","bracelet":"ブレスレット","bare_shoulders":"肩出し","off_shoulder":"オフショルダー","cleavage":"胸の谷間","underwear":"下着","bra":"ブラジャー","panties":"パンティー","bikini":"ビキニ","swimsuit":"水着","one-piece_swimsuit":"ワンピース水着","naked_shirt":"シャツだけを着ている","partially_undressed":"一部脱衣","clothes_lift":"服を持ち上げる","clothes_pull":"服を引っ張る","bed":"ベッド","pillow":"枕","bedroom":"寝室","indoors":"屋内","outdoors":"屋外","room":"部屋","classroom":"教室","window":"窓","curtains":"カーテン","wall":"壁","floor":"床","sky":"空","cloud":"雲","clouds":"雲","night":"夜","day":"昼","sunlight":"日光","sunset":"夕焼け","stars":"星","flower":"花","flowers":"花","tree":"木","trees":"木々","grass":"草","water":"水","beach":"浜辺","ocean":"海","city":"街","street":"通り","park":"公園","dark_background":"暗い背景","black_background":"黒い背景","grey_background":"灰色の背景","red_background":"赤い背景","purple_background":"紫の背景","yellow_background":"黄色い背景","green_background":"緑の背景","transparent_background":"透明背景","blurry_background":"ぼかした背景","abstract_background":"抽象的な背景","patterned_background":"模様入り背景","sparkles":"きらめき","shiny":"光沢","light_particles":"光の粒","shadow":"影","shading":"陰影","depth_of_field":"被写界深度","bokeh":"玉ボケ","monochrome":"モノクロ","greyscale":"グレースケール","grayscale":"グレースケール","comic":"漫画風","sketch":"スケッチ","lineart":"線画","watercolor":"水彩風","traditional_media":"アナログ画材風","digital_art":"デジタルイラスト","simple_background":"シンプルな背景","censored":"修正あり","mosaic_censoring":"モザイク修正","bar_censor":"帯状の修正","convenient_censoring":"物による隠蔽","uncensored":"無修正","questionable":"成人向け判定（要確認）","sensitive":"センシティブ判定","safe":"一般向け判定","general":"一般向け判定","nsfw":"成人向け","hetero":"男女","yuri":"女性同士の恋愛表現","yaoi":"男性同士の恋愛表現","kiss":"キス","kissing":"キスをする","hug":"抱擁","hugging":"抱きしめる","topless":"上半身裸","bottomless":"下半身裸","breasts":"胸","small_breasts":"小さな胸","large_breasts":"大きな胸","huge_breasts":"非常に大きな胸","nipples":"乳首","navel":"へそ","stomach":"お腹","midriff":"腹部","thighs":"太もも","ass":"尻","buttocks":"尻","penis":"男性器","testicles":"睾丸","vagina":"女性器","pubic_hair":"陰毛","cum":"精液","sex":"性行為","masturbation":"自慰行為","handjob":"手を使った性的行為","paizuri":"胸を使った性的行為","deepthroat":"深い口腔性交"};
function translateTag(tag){return v14Translations[tag]||jpNames[tag]||v8Translations[tag]||tag;}
// Keep the selector on the right even when the Japanese label is long.
const v8Style=document.createElement('style');v8Style.textContent=`.tagline{display:grid!important;grid-template-columns:minmax(0,1fr) auto;align-items:center;flex-wrap:nowrap!important;gap:10px}.tagline .taglabel,.tagline span{min-width:0!important;overflow-wrap:anywhere}.tagline select{flex-shrink:0;max-width:115px}.bulk-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.bulk-actions button{padding:8px 10px;font-size:14px}.bulk-actions .secondary{background:#526579}.tagline input[type=checkbox][hidden]{display:none}`;document.head.appendChild(v8Style);
const v8RenderEditor=renderEditor;
renderEditor=function(){v8RenderEditor();const root=$('editor');for(const section of root.querySelectorAll('.taggroup')){const h=section.querySelector('strong');const bulk=document.createElement('div');bulk.className='bulk-actions';for(const [status,label] of [['accepted','全て正しい'],['rejected','全て間違い'],['pending','全て未確認']]){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;b.addEventListener('click',()=>{for(const select of section.querySelectorAll('.review-state'))select.value=status;updateReviewSummary();markDirty();});bulk.appendChild(b);}h.after(bulk);}};

// v9: explicit separation of machine predictions, review decisions and approved training labels.
// Do not silently convert structured AI suggestions to ground truth.
const v8BuildJsonFinal=buildJson;
buildJson=function(){
  const j=v8BuildJsonFinal();
  const states=[...document.querySelectorAll('#editor .review-state')].map(el=>({
    name:el.dataset.tag,category:Number(el.dataset.category),status:el.value,
    score:Math.round((lastTags.find(t=>t.name===el.dataset.tag)?.score||0)*10000)/10000
  }));
  const accepted=states.filter(x=>x.status==='accepted').map(x=>x.name);
  const rejected=states.filter(x=>x.status==='rejected').map(x=>x.name);
  const pending=states.filter(x=>x.status==='pending').map(x=>x.name);
  const custom=$('custom').value.split(',').map(x=>x.trim()).filter(Boolean);
  const approved=$('confirm').checked;
  const protectedLegacy=existingJson?.label_status==='user_confirmed';
  const suggestions={...(j.ai_prediction.structured_suggestions||{}),
    character_name:$('charName').value.trim(),series:$('series').value.trim()};
  j.schema_version='1.1';
  j.ai_prediction.review_states=states;
  j.ai_prediction.tag_review={accepted,rejected,pending};
  j.ai_prediction.reviewed=pending.length===0&&states.length>0;
  j.ai_prediction.structured_suggestions=suggestions;
  j.ai_prediction.structured_suggestions_source='AI-derived and manually editable proposals; not training ground truth';
  j.review={
    status:pending.length===0?'complete':(accepted.length||rejected.length?'partial':'not_started'),
    approved_for_training:approved,
    accepted_tags:accepted,
    rejected_tags:rejected,
    pending_tags:pending,
    manual_additions:custom,
    note:'A prediction score is not a human confirmation. Pending tags are excluded from training.'
  };
  // Ground truth is derived exclusively from explicit per-tag review, never from field suggestions.
  j.training_labels={
    status:approved?(pending.length?'partially_reviewed':'reviewed'):'not_approved',
    source:'human_tag_review',
    accepted_tags:approved?[...new Set([...accepted,...custom])]:[],
    rejected_tags:approved?rejected:[],
    pending_count:pending.length,
    structured_fields_status:'unverified_suggestions'
  };
  // The old confirmed_tags is not reliable for migrated v6-v8 files; do not modify it
  // when an existing confirmed record is protected.
  if(protectedLegacy){
    j.label_status=existingJson.label_status;
    j.characters=structuredClone(existingJson.characters||[]);
    j.background=structuredClone(existingJson.background||[]);
    j.style=structuredClone(existingJson.style||[]);
    j.notes=existingJson.notes||'';
    if('confirmed_tags' in existingJson)j.confirmed_tags=structuredClone(existingJson.confirmed_tags);
    if('rejected_tags' in existingJson)j.rejected_tags=structuredClone(existingJson.rejected_tags);
    j.training_labels.legacy_fields_protected=true;
  }else{
    if(approved){
      j.confirmed_tags=[...new Set([...accepted,...custom])];
      j.rejected_tags=[...rejected];
      j.label_status='user_confirmed';
    }else{
      delete j.confirmed_tags;
      delete j.rejected_tags;
      j.label_status='ai_suggested';
    }
    // Structured fields are suggestions, even when the tag review is approved.
    j.characters=[];j.background=[];j.style=[];
  }
  return j;
};
const v8MakeJsonFinal=makeJson;
// Existing download/export handlers call makeJson dynamically and receive v9 format.
const v9Help=document.createElement('p');
v9Help.className='review-help';
v9Help.textContent='v9：AI候補・タグごとの正誤・学習用確定タグをJSON内で分離します。未確認タグと自動入力された外見項目は学習用確定タグに入りません。旧JSONの確定欄は保護します。';
$('existingInfo').before(v9Help);

// v10: partial training approval is a distinct, explicit user action.
const approveBox=document.createElement('label');
approveBox.style.cssText='padding:12px;border:1px solid #c7d2e2;border-radius:10px;background:#f3f7ff;margin:10px 0;';
approveBox.innerHTML='<input type="checkbox" id="trainingApprove"> 判定済みタグだけを学習用に承認する（未確認タグは除外）';
const approveHelp=document.createElement('p');
approveHelp.className='review-help';
approveHelp.textContent='「編集内容を確認済みとして保存」とは別の承認です。正しい・間違いの判定を1件以上付けた場合のみ使用できます。未確認タグは学習用ラベルに含めません。';
approveBox.appendChild(approveHelp);
$('confirm').closest('label').after(approveBox);
const priorResetForNewImage=resetForNewImage;
resetForNewImage=function(){priorResetForNewImage();$('trainingApprove').checked=false;};
const v9BuildJsonFinal=buildJson;
buildJson=function(){
  const j=v9BuildJsonFinal();
  const approval=$('trainingApprove').checked;
  const reviewed=j.ai_prediction.review_states||[];
  const accepted=reviewed.filter(x=>x.status==='accepted').map(x=>x.name);
  const rejected=reviewed.filter(x=>x.status==='rejected').map(x=>x.name);
  const pending=reviewed.filter(x=>x.status==='pending');
  if(approval&&!$('confirm').checked)throw Error('学習用に承認する前に「編集内容を確認済みとして保存」をチェックしてください。');
  if(approval&&accepted.length+rejected.length===0)throw Error('少なくとも1件のタグを正しい・間違いに判定してください。');
  const custom=($('custom').value||'').split(',').map(x=>x.trim()).filter(Boolean);
  // Manual additions are not part of the verified prediction review; never approve automatically.
  const approvedAccepted=approval?[...new Set(accepted)]:[];
  const approvedRejected=approval?[...new Set(rejected)]:[];
  j.schema_version='1.2';
  j.review.approved_for_training=approval;
  j.review.approval_scope=approval?'reviewed_tags_only':'none';
  j.review.note='Only explicitly accepted/rejected prediction tags are eligible for training. Pending tags and unreviewed manual additions are excluded.';
  j.training_labels={
    status:approval?(pending.length?'partially_approved':'approved'):'not_approved',
    source:'human_tag_review',
    accepted_tags:approvedAccepted,
    rejected_tags:approvedRejected,
    pending_count:pending.length,
    structured_fields_status:'unverified_suggestions',
    manual_additions_status:custom.length?'not_approved':'none',
    approval_scope:approval?'reviewed_tags_only':'none'
  };
  if(existingJson?.label_status==='user_confirmed')j.training_labels.legacy_fields_protected=true;
  // The old top-level confirmed_tags are kept for compatibility, but only training_labels
  // expresses explicit training authorization.
  return j;
};
const oldExistingChangeHandler=()=>{$('trainingApprove').checked=false;};
$('existing').addEventListener('change',oldExistingChangeHandler);
$('trainingApprove').addEventListener('change',markDirty);
$('confirm').addEventListener('change',()=>{if(!$('confirm').checked)$('trainingApprove').checked=false;});
const v10Help=document.createElement('p');v10Help.className='review-help';
v10Help.textContent='v11：複数JSONの進捗管理に対応。学習用に承認しても未確認タグは除外されます。';
approveBox.after(v10Help);

// v11: standalone local batch JSON index. No model inference or file modification.
const v11Panel=document.createElement('section');
v11Panel.id='batchPanel';
v11Panel.innerHTML=`<h2>⑤ 教師データ管理（複数JSON）</h2>
<p class="muted">複数の教師データJSONをまとめて選択し、確認・学習承認の進捗を一覧表示します。ファイルは端末内で読み取り、外部送信しません。元のJSONは変更しません。</p>
<label for="batchFiles">教師データJSONをまとめて選択</label>
<input id="batchFiles" type="file" accept=".json,application/json" multiple>
<div class="actions"><button id="batchRead" type="button">一覧を更新</button><button id="batchCsv" type="button" class="secondary" disabled>一覧CSVを保存</button><button id="batchJson" type="button" class="secondary" disabled>一覧JSONを保存</button></div>
<p id="batchMessage" class="muted">まだファイルを読み込んでいません。</p>
<div id="batchStats"></div><div id="batchTable" style="overflow-x:auto"></div>`;
document.querySelector('main')?.appendChild(v11Panel) || document.body.insertBefore(v11Panel,document.querySelector('script'));
const v11Css=document.createElement('style');v11Css.textContent=`#batchPanel{margin:20px auto;padding:20px;max-width:900px;background:white;border:1px solid #d8e1ee;border-radius:18px}#batchPanel input[type=file]{display:block;margin:12px 0;max-width:100%}#batchPanel .actions{flex-wrap:wrap}#batchPanel table{border-collapse:collapse;width:100%;font-size:14px;min-width:590px}#batchPanel th,#batchPanel td{padding:10px;border-bottom:1px solid #e0e6ed;text-align:left;white-space:nowrap}#batchPanel th{background:#eaf0f7}#batchPanel .v11warn{color:#ad452c}#batchPanel .v11summary{font-weight:bold;padding:12px;background:#eef3fa;border-radius:10px;margin:12px 0}`;document.head.appendChild(v11Css);
let v11Rows=[];
function v11Unique(v){return [...new Set(Array.isArray(v)?v.filter(x=>typeof x==='string'):[])];}
function v11Analyze(obj,file){
 if(!obj||typeof obj!=='object'||Array.isArray(obj)||typeof obj.image_id!=='string'||!obj.image_id.trim())throw Error('image_idがありません');
 const ai=obj.ai_prediction||{};
 const states=Array.isArray(ai.review_states)?ai.review_states:[];
 const review=obj.review||{};
 const legacy=ai.tag_review||{};
 let a=[],r=[],u=[];
 if(states.length){for(const x of states){if(!x||typeof x.name!=='string')continue;if(x.status==='accepted')a.push(x.name);else if(x.status==='rejected')r.push(x.name);else u.push(x.name);}}
 else{a=review.accepted_tags||legacy.accepted||obj.confirmed_tags||[];r=review.rejected_tags||legacy.rejected||obj.rejected_tags||[];u=review.pending_tags||legacy.pending||[];}
 a=v11Unique(a);r=v11Unique(r);u=v11Unique(u).filter(x=>!a.includes(x)&&!r.includes(x));
 const training=obj.training_labels||{};
 const approved=training.status==='partially_approved'||training.status==='approved'||review.approved_for_training===true;
 const ta=v11Unique(training.accepted_tags),tr=v11Unique(training.rejected_tags);
 const issues=[];
 if(a.some(x=>r.includes(x)))issues.push('正誤の重複');
 if(approved&&(!ta.every(x=>a.includes(x))||!tr.every(x=>r.includes(x))))issues.push('承認タグの不整合');
 if(approved&&!ta.length&&!tr.length)issues.push('承認済みだが対象0件');
 if(!states.length&&!Array.isArray(review.accepted_tags)&&!Array.isArray(legacy.accepted))issues.push('判定情報が不足');
 return {id:obj.image_id,file:file.name,schema:obj.schema_version||'不明',accepted:a.length,rejected:r.length,pending:u.length,approved,trainingPositive:ta.length,trainingNegative:tr.length,issues};
}
function v11Cell(tr,s){const td=document.createElement('td');td.textContent=String(s);tr.appendChild(td);}
function v11Render(){const stats=document.getElementById('batchStats'),out=document.getElementById('batchTable');stats.replaceChildren();out.replaceChildren();if(!v11Rows.length)return;
 const approved=v11Rows.filter(r=>r.approved).length,partial=v11Rows.filter(r=>r.pending>0).length;
 const sum=document.createElement('div');sum.className='v11summary';sum.textContent=`画像 ${v11Rows.length}件 / 学習承認済み ${approved}件 / 未確認タグあり ${partial}件 / 学習用正例 ${v11Rows.reduce((n,r)=>n+r.trainingPositive,0)}件 / 負例 ${v11Rows.reduce((n,r)=>n+r.trainingNegative,0)}件`;stats.appendChild(sum);
 const table=document.createElement('table'),head=document.createElement('tr');for(const h of ['画像ID','判定:正','判定:誤','未確認','学習承認','学習:正/負','注意']){const th=document.createElement('th');th.textContent=h;head.appendChild(th);}table.appendChild(head);
 for(const r of v11Rows){const tr=document.createElement('tr');for(const val of [r.id,r.accepted,r.rejected,r.pending,r.approved?'承認済み':'未承認',`${r.trainingPositive}/${r.trainingNegative}`,r.issues.join('、')||'—'])v11Cell(tr,val);table.appendChild(tr);}out.appendChild(table);
}
document.getElementById('batchRead').addEventListener('click',async()=>{
 const files=[...document.getElementById('batchFiles').files];const message=document.getElementById('batchMessage');if(!files.length){message.textContent='JSONを選択してください。';return;}
 const rows=[],errors=[];for(const file of files){try{const obj=JSON.parse(await file.text());rows.push(v11Analyze(obj,file));}catch(e){errors.push(`${file.name}: ${e.message}`);}}
 const byId=new Map();for(const row of rows){if(byId.has(row.id)){row.issues.push('画像ID重複');byId.get(row.id).issues.push('画像ID重複');}else byId.set(row.id,row);}
 v11Rows=rows.sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));v11Render();message.textContent=`読み込み ${rows.length}件 / エラー ${errors.length}件`+(errors.length?' — '+errors.slice(0,4).join(' / '):'');
 document.getElementById('batchCsv').disabled=!rows.length;document.getElementById('batchJson').disabled=!rows.length;
});
function v11Download(filename,content,mime){const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
document.getElementById('batchCsv').addEventListener('click',()=>{const keys=['id','file','schema','accepted','rejected','pending','approved','trainingPositive','trainingNegative','issues'];const quote=x=>'"'+String(x??'').replaceAll('"','""')+'"';const lines=[keys.join(','),...v11Rows.map(r=>keys.map(k=>quote(k==='issues'?r.issues.join(';'):r[k])).join(','))];v11Download('教師データ管理一覧_v11.csv','\uFEFF'+lines.join('\r\n'),'text/csv;charset=utf-8');});
document.getElementById('batchJson').addEventListener('click',()=>v11Download('教師データ管理一覧_v11.json',JSON.stringify({schema_version:'index-1.0',generated_at:new Date().toISOString(),images:v11Rows},null,2),'application/json'));
