
// v12: Export only explicitly approved, human-reviewed labels. The index JSON is not an input.
const dsPanel=document.createElement('section');
dsPanel.innerHTML=`<h2>⑥ 学習用データセット作成（v12）</h2>
<p class="muted">⑤で選んだ教師データJSONを使用します。学習承認済みの画像から、正しいタグ（正例）と間違いタグ（負例）のみを出力。未確認・未承認は除外します。元ファイルは変更しません。</p>
<div class="actions"><button type="button" id="dsBuild">学習用データセットを確認</button><button type="button" class="secondary" id="dsSave" disabled>学習用JSONを保存</button></div>
<p id="dsMessage" class="muted">⑤でJSONを選んでから実行してください。</p><div id="dsPreview"></div>
<p class="muted">出力するのはラベル情報のみです。画像本体は含みません。負例は明示的に「間違い」と判定したタグだけです。未確認を負例として扱いません。</p>`;
document.body.appendChild(dsPanel);
let dsData=null;
const dsEl=id=>document.getElementById(id);
function dsUnique(arr){return [...new Set(Array.isArray(arr)?arr.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()):[])];}
function dsMakeEntry(j,filename){
 if(!j||typeof j!=='object'||Array.isArray(j))throw Error('教師データJSONではありません');
 if(typeof j.image_id!=='string'||!/^IMG_[0-9]+$/i.test(j.image_id))throw Error('画像IDが不正です');
 const t=j.training_labels;
 if(!t||!['approved','partially_approved'].includes(t.status)||j.review?.approved_for_training!==true)throw Error('学習未承認');
 if(t.approval_scope!=='reviewed_tags_only')throw Error('承認範囲が不明');
 const positives=dsUnique(t.accepted_tags),negatives=dsUnique(t.rejected_tags);
 const reviewPositive=dsUnique(j.review?.accepted_tags),reviewNegative=dsUnique(j.review?.rejected_tags);
 const rawNames=new Set((j.ai_prediction?.raw_predictions||[]).map(x=>x.name));
 if(!positives.length&&!negatives.length)throw Error('承認済みタグが0件');
 if(positives.some(x=>!reviewPositive.includes(x)||!rawNames.has(x))||negatives.some(x=>!reviewNegative.includes(x)||!rawNames.has(x)))throw Error('判定・予測データとの不整合');
 if(positives.some(x=>negatives.includes(x)))throw Error('正例と負例が重複');
 return {image_id:j.image_id,image_filename:j.image_filename||'',source_json:filename,positive_tags:positives,negative_tags:negatives,unreviewed_tags_excluded:true};
}
dsEl('dsBuild').addEventListener('click',async()=>{
 dsData=null;dsEl('dsSave').disabled=true;dsEl('dsPreview').replaceChildren();
 const files=[...dsEl('batchFiles').files];
 if(!files.length){dsEl('dsMessage').textContent='先に⑤で教師データJSONを選択してください。';return;}
 const candidates=[],skipped=[];const counts=new Map();
 for(const f of files){try{const j=JSON.parse(await f.text());const e=dsMakeEntry(j,f.name);candidates.push(e);counts.set(e.image_id,(counts.get(e.image_id)||0)+1);}catch(err){skipped.push(`${f.name}：${err.message}`);}}
 const duplicates=new Set([...counts].filter(([id,n])=>n>1).map(([id])=>id));
 const entries=candidates.filter(e=>{if(duplicates.has(e.image_id)){skipped.push(`${e.source_json}：画像ID重複のため除外`);return false;}return true;}).sort((a,b)=>a.image_id.localeCompare(b.image_id,undefined,{numeric:true}));
 dsData={schema_version:'training-dataset-1.0',generated_at:new Date().toISOString(),label_policy:'explicit_human_review_only',images:entries};
 const p=entries.reduce((n,e)=>n+e.positive_tags.length,0),n=entries.reduce((n,e)=>n+e.negative_tags.length,0);
 dsEl('dsMessage').textContent=`対象画像 ${entries.length}件 / 正例 ${p}件 / 負例 ${n}件 / 除外ファイル ${skipped.length}件`;
 const div=document.createElement('div');div.className='review-summary';div.textContent=entries.length?entries.map(e=>`${e.image_id}：正例 ${e.positive_tags.length} / 負例 ${e.negative_tags.length}`).join(' ｜ '):'出力対象の承認済み教師データはありません。';dsEl('dsPreview').appendChild(div);
 if(skipped.length){const d=document.createElement('details'),sm=document.createElement('summary'),pre=document.createElement('p');sm.textContent=`除外理由（${skipped.length}件）`;pre.style.overflowWrap='anywhere';pre.textContent=skipped.join('\n');pre.style.whiteSpace='pre-wrap';d.append(sm,pre);dsEl('dsPreview').appendChild(d);}
 dsEl('dsSave').disabled=!entries.length;
});
dsEl('dsSave').addEventListener('click',()=>{if(!dsData?.images?.length)return;v11Download('学習用データセット_v12.json',JSON.stringify(dsData,null,2),'application/json;charset=utf-8');});
