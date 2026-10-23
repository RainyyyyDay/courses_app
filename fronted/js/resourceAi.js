/* Materials and notes share suggestions/settings/workbench, never mistake diagnosis. */
let resourceAiState=null;
const resourceAiKey=s=>`resource-ai-method:${s.courseId}:${s.type}:${s.id}`;
const resourceAiTextKey=s=>`resource-ai-text:${s.courseId}:${s.type}:${s.id}`;
const resourceAiContextKey=s=>`resource-ai-context:${s.courseId}:${s.type}:${s.id}`;
const resourceAiGoals=['','remember','understand','compare','practice','read'];
function readResourceAiContext(s){
  const saved=mistakeStorageGet(resourceAiContextKey(s));
  return saved?.version===1&&resourceAiGoals.includes(saved.goal)&&typeof saved.recall==='string'&&saved.recall.length<=4000?{goal:saved.goal,recall:saved.recall}:null;
}
function resourceAiContextInput(){return {goal:document.getElementById('resourceAiGoal').value,recall:document.getElementById('resourceAiRecall').value};}
function updateResourceAiContextStatus(message=''){
  const s=resourceAiState;if(!s||!resourceAiCurrent(s))return;
  const saved=readResourceAiContext(s),input=resourceAiContextInput(),same=!!saved&&saved.goal===input.goal&&saved.recall===input.recall;
  document.getElementById('resourceAiContextStatus').textContent=message||(same?'已保存到本浏览器。':'未保存：学习目标或当前回忆／困难尚未保存。');
  document.getElementById('resourceAiSaveContext').disabled=s.busy||same;
}
function saveResourceAiContext(){
  const s=resourceAiState;if(!s||s.busy||!resourceAiCurrent(s))return;
  const input=resourceAiContextInput();
  if(!resourceAiGoals.includes(input.goal)||input.recall.length>4000){updateResourceAiContextStatus('未保存：请选择有效的学习目标，回忆／困难最多4000字。');return;}
  mistakeStorageSet(resourceAiContextKey(s),{version:1,...input});
  const saved=readResourceAiContext(s);
  if(!saved||saved.goal!==input.goal||saved.recall!==input.recall){updateResourceAiContextStatus('保存失败：浏览器存储不可用或空间不足；当前输入仍保留，请复制备份后重试。');return;}
  updateResourceAiContextStatus();showToast('学习目标与回忆保存成功');
}
function readResourceAiText(s){
  const saved=mistakeStorageGet(resourceAiTextKey(s));
  return saved?.version===1&&typeof saved.content==='string'&&saved.content.trim()&&saved.content.length<=4000?saved.content:null;
}
function updateResourceAiTextStatus(message=''){
  const s=resourceAiState;if(!s||!resourceAiCurrent(s))return;
  const text=document.getElementById('resourceAiContent').value,saved=readResourceAiText(s);
  document.getElementById('resourceAiTextStatus').textContent=message||(saved===text?'已保存到本浏览器。':'未保存'+(saved===null?'：当前片段尚未单独保存。':'：文字已修改，请保存。'));
  document.getElementById('resourceAiSaveText').disabled=s.busy||saved===text;
}
function saveResourceAiText(){
  const s=resourceAiState;if(!s||s.busy||!resourceAiCurrent(s))return;
  const content=document.getElementById('resourceAiContent').value;
  if(!content.trim()||content.length>4000){updateResourceAiTextStatus('未保存：请填写1至4000字的复习片段。');return;}
  mistakeStorageSet(resourceAiTextKey(s),{version:1,content});
  if(readResourceAiText(s)!==content){updateResourceAiTextStatus('保存失败：浏览器存储不可用或空间不足；当前输入仍保留，请复制备份后重试。');return;}
  updateResourceAiTextStatus();showToast('复习片段保存成功');
}
function readResourceAiMethod(s){
  const saved=mistakeStorageGet(resourceAiKey(s));
  return saved?.version===1&&Object.hasOwn(AI_SELECTABLE_METHODS,saved.method)?saved.method:null;
}
function readReviewAiMethod(s){return s.type==='mistake'?readMistakeAiMethod(s):readResourceAiMethod(s);}
function resetResourceAi(){resourceAiState?.controller?.abort();resourceAiState=null;document.getElementById('resourceAiPanel')?.remove();}
function mountResourceAi(host,type,row,context={}){
  resetResourceAi();
  const s={courseId:currentCourseId,type,id:row.id,row,host,view:currentView,...context};resourceAiState=s;
  const panel=document.createElement('section');panel.id='resourceAiPanel';panel.className='detail-card mistake-create-ai';
  panel.innerHTML=`<details><summary>AI 复习建议（${type==='note'?'笔记':'资料'}）</summary><p>建议和正式材料分别确认，不修改正文、评分或计划；文件不会自动上传给 AI，请提供已校对文字片段。</p>
    <fieldset id="resourceAiFields"><label>待复习文字片段<textarea id="resourceAiContent" rows="5" maxlength="4000"></textarea></label>
    <div class="ai-action-row"><button type="button" id="resourceAiSaveText" onclick="saveResourceAiText()">保存复习片段</button><span id="resourceAiTextStatus" role="status" aria-live="polite"></span></div>
    <p class="ai-help">仅保存此片段到当前浏览器，不修改正文或正式复习材料，也不请求 AI；同一浏览器、同一网站地址可恢复，清理浏览器数据后会丢失，不跨设备同步。</p>
    <label>学习目标<select id="resourceAiGoal"><option value="">暂不确定</option><option value="remember">记住事实</option><option value="understand">理解讲清</option><option value="compare">辨析比较</option><option value="practice">独立练习</option><option value="read">只想阅读</option></select></label>
    <label>当前回忆／困难（可选）<textarea id="resourceAiRecall" rows="2" maxlength="4000"></textarea></label>
    <div class="ai-action-row"><button type="button" id="resourceAiSaveContext" onclick="saveResourceAiContext()">保存学习目标与回忆</button><span id="resourceAiContextStatus" role="status" aria-live="polite"></span></div>
    <p class="ai-help">可选保存到当前浏览器，重新进入时恢复；可留空或清空后保存。不请求 AI，不改变已确认的复习方式。</p>
    <p id="resourceAiSource"></p><div class="ai-action-row"><button type="button" onclick="coursesAiSettings.open()">AI 设置</button><button type="button" class="ai-primary" id="resourceAiGet" onclick="requestResourceAi()">获取建议（不采用）</button></div></fieldset>
    <p id="resourceAiStatus" role="status"></p><button type="button" class="ai-primary" id="resourceAiAdopt" hidden onclick="adoptResourceAiSuggestion()">一键采用此建议</button><p id="resourceAiError" role="alert" class="mistake-inline-error"></p>
    <label>本次选择<select id="resourceAiMethod"></select></label><div class="ai-action-row"><button type="button" class="ai-primary" id="resourceAiConfirm" onclick="confirmResourceAi()">确认此复习方式</button>
    <button type="button" id="resourceAiPrepare" hidden onclick="prepareResourceAiMaterial()">准备所选模式材料</button><button type="button" id="resourceAiEditMaterial" hidden onclick="prepareResourceAiMaterial()">查看 / 编辑材料</button></div><p id="resourceAiMaterialStatus" role="status"></p><p>重新作答复用已有任务；缺材料时先手动准备。阅读仅记录曝光。</p></details>`;
  host.append(panel);
  const text=row.content||row.ocr_text||'';document.getElementById('resourceAiContent').value=readResourceAiText(s)??(text.length<=4000?text:'');
  document.getElementById('resourceAiContent').addEventListener('input',()=>updateResourceAiTextStatus());
  updateResourceAiTextStatus();
  const savedContext=readResourceAiContext(s);
  if(savedContext){document.getElementById('resourceAiGoal').value=savedContext.goal;document.getElementById('resourceAiRecall').value=savedContext.recall;}
  document.getElementById('resourceAiGoal').addEventListener('change',()=>updateResourceAiContextStatus());
  document.getElementById('resourceAiRecall').addEventListener('input',()=>updateResourceAiContextStatus());
  updateResourceAiContextStatus();
  document.getElementById('resourceAiMethod').replaceChildren(new Option('请选择',''),...Object.entries(AI_SELECTABLE_METHODS).map(([id,label])=>new Option(label,id)));
  document.getElementById('resourceAiMethod').value=readResourceAiMethod(s)||'';
  document.getElementById('resourceAiStatus').textContent=(readResourceAiMethod(s)?'已确认：'+AI_REVIEW_METHODS[readResourceAiMethod(s)]+'。':'尚未确认建议。')+(text.length>4000?'正文超过4000字，请自行选取片段，不会静默截断。':'');
  updateResourceAiSource();
  document.getElementById('resourceAiMethod').onchange=()=>void updateResourceAiActions();
  for(const event of ['input','change'])document.getElementById('resourceAiFields').addEventListener(event,()=>updateResourceAiAdopt());
  void updateResourceAiActions();
}
function resourceAiInput(s){
  return {kind:s.type,title:s.row.title||'',content:document.getElementById('resourceAiContent').value.trim(),goal:document.getElementById('resourceAiGoal').value,recall:document.getElementById('resourceAiRecall').value.trim()};
}
function resourceAiSuggestion(s){
  const mode=s.result?.review_method;
  return s.resultUsable&&Object.hasOwn(AI_SELECTABLE_METHODS,mode)&&s.resultInput===JSON.stringify(resourceAiInput(s))?mode:null;
}
function updateResourceAiAdopt(){
  const s=resourceAiState;if(!s||!resourceAiCurrent(s))return;
  const mode=resourceAiSuggestion(s),button=document.getElementById('resourceAiAdopt');
  button.hidden=!mode||(readResourceAiMethod(s)===mode&&document.getElementById('resourceAiMethod').value===mode);
  button.disabled=s.busy;button.textContent=mode?'一键采用建议：'+AI_REVIEW_METHODS[mode]:'一键采用此建议';
}
function adoptResourceAiSuggestion(){
  const s=resourceAiState;if(!s||s.busy||!resourceAiCurrent(s))return;
  const mode=resourceAiSuggestion(s);
  if(!mode){document.getElementById('resourceAiError').textContent='建议已失效或内容已修改，请重新获取建议。';return;}
  document.getElementById('resourceAiMethod').value=mode;
  document.getElementById('resourceAiError').textContent='';confirmResourceAi();
  if(readResourceAiMethod(s)===mode)showToast('已采用建议：'+AI_REVIEW_METHODS[mode]);
}
async function updateResourceAiActions(){
  const s=resourceAiState;if(!s||!resourceAiCurrent(s))return;
  const el=name=>document.getElementById('resourceAi'+name),method=el('Method').value,valid=Object.hasOwn(AI_SELECTABLE_METHODS,method);
  updateResourceAiAdopt();
  el('Confirm').hidden=!valid||readResourceAiMethod(s)===method;el('Confirm').disabled=s.busy;
  el('Prepare').hidden=true;el('EditMaterial').hidden=true;el('MaterialStatus').textContent='';
  const check=(s.materialCheck||0)+1;s.materialCheck=check;
  if(!valid)return;
  if(method==='reading'&&(s.row.content||s.row.ocr_text||s.row.file_url)){
    el('MaterialStatus').textContent='可直接使用原文或附件阅读，无需另行准备材料。';return;
  }
  el('MaterialStatus').textContent='正在检查材料…';
  try{
    const target=method==='retry'?(readReviewActive(s)?.mode||'standard'):method;
    const data=await(await requestApi(reviewWorkbenchBase(s)+'/materials/'+target+'?view=practice')).json();
    if(!resourceAiCurrent(s)||s.materialCheck!==check||el('Method').value!==method)return;
    const ready=!!(data.version&&data.material);el('Prepare').hidden=ready;el('EditMaterial').hidden=!ready;
    el('MaterialStatus').textContent=ready?'材料已就绪，无需重复准备；如需修改可查看 / 编辑。':'尚缺所选模式的正式材料，可在此准备。';
  }catch{
    if(!resourceAiCurrent(s)||s.materialCheck!==check||el('Method').value!==method)return;
    el('EditMaterial').hidden=false;el('MaterialStatus').textContent='暂时无法确认材料状态，可打开检查；不会自动创建或覆盖材料。';
  }
}
function updateResourceAiSource(){const node=document.getElementById('resourceAiSource');if(node)node.textContent=coursesAiSettings.label();}
function resourceAiCurrent(s){return resourceAiState===s&&currentCourseId===s.courseId&&currentView===s.view&&s.host.isConnected;}
async function fetchResourceAi(input,{signal,deepseek}={}){
  const endpoint=new URL((globalThis.COURSES_AI_API_BASE??API).replace(/\/$/,'')+'/ai/review-suggestion',location.href);
  if(endpoint.origin!==location.origin||endpoint.username||endpoint.password||!(endpoint.protocol==='https:'||endpoint.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)))throw mistakeAiError('AI_TEMP_KEY_ORIGIN');
  let body=JSON.stringify({provider:deepseek?(deepseek.provider||'deepseek'):'mock',input,...(deepseek?{api_key:deepseek.apiKey,model:deepseek.model,confirm_cost:deepseek.confirmCost,...(deepseek.provider==='compatible'?{base_url:deepseek.baseUrl}:{})}:{})});
  if(new TextEncoder().encode(body).length>16384)throw mistakeAiError('BODY_TOO_LARGE');
  const controller=new AbortController(),abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const release=coursesAiSettings.track(deepseek,abort),timer=setTimeout(abort,100000);
  try{
    if(controller.signal.aborted)throw Object.assign(new Error('已取消'),{name:'AbortError'});
    const response=await fetch(endpoint.href,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body,signal:controller.signal});
    const data=await response.json().catch(()=>null);
    if(controller.signal.aborted||!coursesAiSettings.valid(deepseek))throw Object.assign(new Error('已取消'),{name:'AbortError'});
    if(!response.ok)throw mistakeAiError(data?.error||data?.detail,response.status);
    const result=data?.result;
    if(data?.provider!==(deepseek?(deepseek.provider||'deepseek'):'mock')||!Object.hasOwn(AI_SELECTABLE_METHODS,result?.review_method)||typeof result.reason!=='string'||!result.reason.trim()||result.reason.length>500||result.needs_review!==true)throw mistakeAiError('INVALID_RESPONSE');
    return {review_method:result.review_method,reason:result.reason,needs_review:true};
  }catch(err){if(controller.signal.aborted)throw Object.assign(new Error('请求已取消或超时；可手动重试。'),{name:'AbortError'});throw err.code?err:mistakeAiError('NETWORK_ERROR');}
  finally{body=null;release();clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
async function requestResourceAi(){
  const s=resourceAiState;if(!s||s.busy||!resourceAiCurrent(s))return;
  const el=id=>document.getElementById('resourceAi'+id);el('Error').textContent='';
  s.resultUsable=false;updateResourceAiAdopt();const input=resourceAiInput(s);
  if(!input.content){el('Error').textContent='请先填写或校对待复习的文字片段；不会自动读取附件。';return;}
  let credentials;
  try{
    credentials=coursesAiSettings.read();s.busy=true;s.controller=new AbortController();el('Fields').disabled=true;el('Confirm').disabled=true;
    el('Status').textContent=credentials?'正在请求 '+coursesAiSettings.describe(credentials)+'（可能计费）；不会自动采用…':'正在获取 Mock 规则演示，不调用真实模型…';
    const pending=fetchResourceAi(input,{signal:s.controller.signal,deepseek:credentials});if(credentials)credentials.apiKey='';
    const result=await pending;if(!resourceAiCurrent(s))return;
    s.result=result;s.resultUsable=true;s.resultInput=JSON.stringify(input);el('Status').textContent=(credentials?coursesAiSettings.describe(credentials)+' 建议：':'Mock 规则演示：')+AI_REVIEW_METHODS[result.review_method]+'；'+result.reason;
    // A response must not replace a choice made before/during this request.
    if(!el('Method').value)el('Method').value=result.review_method;
  }catch(err){if(resourceAiCurrent(s))el('Error').textContent=err.message;}
  finally{if(credentials)credentials.apiKey='';if(resourceAiCurrent(s)){s.busy=false;s.controller=null;el('Fields').disabled=false;updateResourceAiSource();void updateResourceAiActions();}}
}
function confirmResourceAi(){
  const s=resourceAiState,method=document.getElementById('resourceAiMethod')?.value;
  if(!s||s.busy||!resourceAiCurrent(s)||!Object.hasOwn(AI_SELECTABLE_METHODS,method))return;
  mistakeStorageSet(resourceAiKey(s),{version:1,method});
  document.getElementById('resourceAiStatus').textContent=readResourceAiMethod(s)===method?'已确认到本浏览器：'+AI_REVIEW_METHODS[method]+'；本次确认不会自动创建材料或执行复习。':'本地保存失败，请重试；原内容未改变。';
  void updateResourceAiActions();
  if(typeof centerReview!=='undefined'&&s.sessionItemId&&currentCenterItem()?.id===s.sessionItemId){
    // Existing explicit session choice stays ahead of this newly confirmed recommendation.
    void prepareCenterQuickMode(currentCenterItem(),centerReview.session).then(()=>renderCenterReviewToolbar());
  }
}
function prepareResourceAiMaterial(){
  const s=resourceAiState,method=document.getElementById('resourceAiMethod')?.value;if(!s||s.busy||!resourceAiCurrent(s)||!Object.hasOwn(AI_SELECTABLE_METHODS,method))return;
  const item=typeof currentCenterItem==='function'?currentCenterItem():null;
  const context=item&&item.id===s.sessionItemId?centerWorkbenchContext(item,centerReview.session):{courseId:s.courseId,row:s.row};
  void openReviewWorkbench(s.type,s.id,{...context,mode:method,sourceText:document.getElementById('resourceAiContent').value});
}
addEventListener('pagehide',resetResourceAi);
