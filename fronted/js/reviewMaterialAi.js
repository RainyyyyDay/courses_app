/* Uses the existing tab-memory credentials and official JSON provider; never saves materials. */
async function fetchReviewMaterialDraft(input,credentials,signal){
  const endpoint=new URL((globalThis.COURSES_AI_API_BASE??API).replace(/\/$/,'')+'/ai/material-draft',location.href);
  if(endpoint.origin!==location.origin||endpoint.username||endpoint.password||!(endpoint.protocol==='https:'||endpoint.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)))throw mistakeAiError('AI_TEMP_KEY_ORIGIN');
  let body=JSON.stringify({provider:credentials.provider||'deepseek',api_key:credentials.apiKey,model:credentials.model,confirm_cost:credentials.confirmCost,...(credentials.provider==='compatible'?{base_url:credentials.baseUrl,...(credentials.workspaceId?{workspace_id:credentials.workspaceId}:{})}:{}),input});
  if(new TextEncoder().encode(body).length>16384)throw mistakeAiError('BODY_TOO_LARGE');
  const controller=new AbortController(),abort=()=>controller.abort();
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,100000),release=coursesAiSettings.track(credentials,abort);
  try{
    if(controller.signal.aborted)throw Object.assign(new Error('已取消'),{name:'AbortError'});
    const response=await fetch(endpoint.href,{method:'POST',headers:{'Content-Type':'application/json'},body,signal:controller.signal,cache:'no-store'});
    const data=await response.json().catch(()=>null);
    if(controller.signal.aborted||!coursesAiSettings.valid(credentials))throw Object.assign(new Error('已取消'),{name:'AbortError'});
    if(!response.ok)throw mistakeAiError(data?.error||data?.detail,response.status);
    const draft=data?.draft;
    if(data?.provider!==(credentials.provider||'deepseek')||data.mode_id!==input.mode_id||draft?.needs_review!==true||typeof draft.needs_more_information!=='boolean'||!Array.isArray(draft.caveats)||draft.caveats.length>3||draft.caveats.some(v=>typeof v!=='string'||v.length>300)
      ||(draft.material===null?(!draft.needs_more_information||!draft.caveats.length):!validReviewMaterialDraft(input.mode_id,draft.material)))throw mistakeAiError('INVALID_RESPONSE');
    return draft;
  }catch(err){
    if(controller.signal.aborted){if(signal?.aborted||!coursesAiSettings.valid(credentials))throw Object.assign(new Error('已取消'),{name:'AbortError'});throw mistakeAiError('AI_TIMEOUT');}
    throw err.code?err:mistakeAiError('NETWORK_ERROR');
  }finally{body=null;release();clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function validReviewMaterialDraft(mode,m){
  if(!m||['prompt','reference','rubric'].some(k=>typeof m[k]!=='string'||m[k].length>4000))return false;
  for(const key of ['objects','dimensions'])if(!Array.isArray(m[key])||m[key].length>20||m[key].some(v=>typeof v!=='string'||!v.trim()||v.length>1000))return false;
  if(!Array.isArray(m.blanks)||m.blanks.length>20||m.blanks.some(b=>!b||typeof b.id!=='string'||typeof b.answer!=='string'||typeof b.hint!=='string'||b.answer.length>2000||b.hint.length>2000||!Array.isArray(b.aliases)||b.aliases.length>20||b.aliases.some(v=>typeof v!=='string'||!v.trim()||v.length>2000)))return false;
  return !workbenchMaterialMissing(mode,m).length&&(mode==='cloze'||!m.blanks.length);
}
function renderEditableReviewDraft(s,draft){
  const m=draft.material;
  wb('Draft').innerHTML='<p>'+escapeHtml(s.aiDraftReal?(s.aiDraftSource||'AI')+' 草稿，尚未验证正确；原材料未改变。':'Mock 演示草稿，不代表真实分析；参考要点请人工核对。')+'</p><p>'+escapeHtml((draft.caveats||[]).join('；'))+'</p>';
  if(!m)return;
  const input=(label,id,value,rows=3)=>wbInput(label,'Draft'+id,value,rows);
  wb('Draft').insertAdjacentHTML('beforeend',input('草稿题面 / 正文','Prompt',m.prompt,5)
    +(s.mode==='cloze'?'<div id="reviewWbDraftBlanks">'+m.blanks.map(b=>`<div class="review-blank"><label>空位 ${escapeHtml(b.id)} 的答案<input data-draft-id="${escapeHtml(b.id)}" value="${escapeHtml(b.answer)}"></label><label>别名（每行一个）<textarea data-draft-aliases="${escapeHtml(b.id)}">${escapeHtml(b.aliases.join('\n'))}</textarea></label><label>提示<input data-draft-hint="${escapeHtml(b.id)}" value="${escapeHtml(b.hint)}"></label></div>`).join('')+'</div>':s.mode==='reading'?'':input('草稿参考要点','Reference',m.reference)+input('草稿核对量规','Rubric',m.rubric))
    +(s.mode==='contrast'?input('草稿比较对象（每行一个）','Objects',m.objects.join('\n'))+input('草稿比较维度（每行一个）','Dimensions',m.dimensions.join('\n')):'')
    +(s.aiDraftReal?'<label class="ai-check-row"><input type="checkbox" id="reviewWbDraftAccept"><span>我已核实或修改草稿，确认填入表单<small>仅按下方所选方式填入，仍需确认保存。</small></span></label>':'')
    +'<div class="ai-action-row"><button type="button" class="ai-primary" onclick="adoptWorkbenchDraft(false)">仅补充空白字段</button><button type="button" onclick="adoptWorkbenchDraft(true)">替换表单（可撤回）</button><button type="button" class="ai-text-button" onclick="discardReviewMaterialDraft()">放弃草稿</button></div>');
}
function readEditedReviewDraft(s){
  const m=s.aiDraft;if(!m||!wb('DraftPrompt'))return m;
  const lines=name=>(wb('Draft'+name)?.value||'').split('\n').map(v=>v.trim()).filter(Boolean);
  return {prompt:wb('DraftPrompt').value,reference:wb('DraftReference')?.value??m.reference,rubric:wb('DraftRubric')?.value??m.rubric,
    objects:s.mode==='contrast'?lines('Objects'):m.objects,dimensions:s.mode==='contrast'?lines('Dimensions'):m.dimensions,
    blanks:m.blanks.map(b=>({...b,answer:wb('DraftBlanks').querySelector('[data-draft-id="'+b.id+'"]').value,
      aliases:wb('DraftBlanks').querySelector('[data-draft-aliases="'+b.id+'"]').value.split('\n').map(v=>v.trim()).filter(Boolean),hint:wb('DraftBlanks').querySelector('[data-draft-hint="'+b.id+'"]').value}))};
}
function discardReviewMaterialDraft(){const s=reviewWorkbench;if(!s||s.busy)return;s.aiDraft=null;s.aiDraftReal=false;wb('Draft').replaceChildren();}
addEventListener('pagehide',()=>reviewWorkbench?.draftController?.abort());
