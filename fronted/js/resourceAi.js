/* Materials and notes share suggestions/settings/workbench, never mistake diagnosis. */
let resourceAiState=null;
const resourceAiKey=s=>`resource-ai-method:${s.courseId}:${s.type}:${s.id}`;
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
    <label>学习目标<select id="resourceAiGoal"><option value="">暂不确定</option><option value="remember">记住事实</option><option value="understand">理解讲清</option><option value="compare">辨析比较</option><option value="practice">独立练习</option><option value="read">只想阅读</option></select></label>
    <label>当前回忆／困难（可选）<textarea id="resourceAiRecall" rows="2" maxlength="4000"></textarea></label>
    <p id="resourceAiSource"></p><div class="ai-action-row"><button type="button" onclick="coursesAiSettings.open()">AI 设置</button><button type="button" class="ai-primary" id="resourceAiGet" onclick="requestResourceAi()">获取建议（不采用）</button></div></fieldset>
    <p id="resourceAiStatus" role="status"></p><p id="resourceAiError" role="alert" class="mistake-inline-error"></p>
    <label>本次选择<select id="resourceAiMethod"></select></label><div class="ai-action-row"><button type="button" class="ai-primary" id="resourceAiConfirm" onclick="confirmResourceAi()">确认此复习方式</button>
    <button type="button" onclick="prepareResourceAiMaterial()">准备所选模式材料</button></div><p>重新作答复用已有任务；缺材料时先手动准备。阅读仅记录曝光。</p></details>`;
  host.append(panel);
  const text=row.content||row.ocr_text||'';document.getElementById('resourceAiContent').value=text.length<=4000?text:'';
  document.getElementById('resourceAiMethod').replaceChildren(new Option('请选择',''),...Object.entries(AI_SELECTABLE_METHODS).map(([id,label])=>new Option(label,id)));
  document.getElementById('resourceAiMethod').value=readResourceAiMethod(s)||'';
  document.getElementById('resourceAiStatus').textContent=(readResourceAiMethod(s)?'已确认：'+AI_REVIEW_METHODS[readResourceAiMethod(s)]+'。':'尚未确认建议。')+(text.length>4000?'正文超过4000字，请自行选取片段，不会静默截断。':'');
  updateResourceAiSource();
}
function updateResourceAiSource(){const node=document.getElementById('resourceAiSource');if(node)node.textContent=coursesAiSettings.label();}
function resourceAiCurrent(s){return resourceAiState===s&&currentCourseId===s.courseId&&currentView===s.view&&s.host.isConnected;}
async function fetchResourceAi(input,{signal,deepseek}={}){
  const endpoint=new URL((globalThis.COURSES_AI_API_BASE??API).replace(/\/$/,'')+'/ai/review-suggestion',location.href);
  if(endpoint.origin!==location.origin||endpoint.username||endpoint.password||!(endpoint.protocol==='https:'||endpoint.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)))throw mistakeAiError('AI_TEMP_KEY_ORIGIN');
  let body=JSON.stringify({provider:deepseek?'deepseek':'mock',input,...(deepseek?{api_key:deepseek.apiKey,model:deepseek.model,confirm_cost:deepseek.confirmCost}:{})});
  if(new TextEncoder().encode(body).length>16384)throw mistakeAiError('BODY_TOO_LARGE');
  const controller=new AbortController(),abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const release=coursesAiSettings.track(deepseek,abort),timer=setTimeout(abort,20000);
  try{
    if(controller.signal.aborted)throw Object.assign(new Error('已取消'),{name:'AbortError'});
    const response=await fetch(endpoint.href,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body,signal:controller.signal});
    const data=await response.json().catch(()=>null);
    if(controller.signal.aborted||!coursesAiSettings.valid(deepseek))throw Object.assign(new Error('已取消'),{name:'AbortError'});
    if(!response.ok)throw mistakeAiError(data?.error||data?.detail,response.status);
    const result=data?.result;
    if(data?.provider!==(deepseek?'deepseek':'mock')||!Object.hasOwn(AI_SELECTABLE_METHODS,result?.review_method)||typeof result.reason!=='string'||!result.reason.trim()||result.reason.length>500||result.needs_review!==true)throw mistakeAiError('INVALID_RESPONSE');
    return {review_method:result.review_method,reason:result.reason,needs_review:true};
  }catch(err){if(controller.signal.aborted)throw Object.assign(new Error('请求已取消或超时；可手动重试。'),{name:'AbortError'});throw err.code?err:mistakeAiError('NETWORK_ERROR');}
  finally{body=null;release();clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
async function requestResourceAi(){
  const s=resourceAiState;if(!s||s.busy||!resourceAiCurrent(s))return;
  const el=id=>document.getElementById('resourceAi'+id);el('Error').textContent='';
  const input={kind:s.type,title:s.row.title||'',content:el('Content').value.trim(),goal:el('Goal').value,recall:el('Recall').value.trim()};
  if(!input.content){el('Error').textContent='请先填写或校对待复习的文字片段；不会自动读取附件。';return;}
  let credentials;
  try{
    credentials=coursesAiSettings.read();s.busy=true;s.controller=new AbortController();el('Fields').disabled=true;el('Confirm').disabled=true;
    el('Status').textContent=credentials?'正在请求 DeepSeek 官方（可能计费）；不会自动采用…':'正在获取 Mock 规则演示，不调用真实模型…';
    const pending=fetchResourceAi(input,{signal:s.controller.signal,deepseek:credentials});if(credentials)credentials.apiKey='';
    const result=await pending;if(!resourceAiCurrent(s))return;
    s.result=result;el('Status').textContent=(credentials?'DeepSeek 官方建议：':'Mock 规则演示：')+AI_REVIEW_METHODS[result.review_method]+'；'+result.reason;
    // A response must not replace a choice made before/during this request.
    if(!el('Method').value)el('Method').value=result.review_method;
  }catch(err){if(resourceAiCurrent(s))el('Error').textContent=err.message;}
  finally{if(credentials)credentials.apiKey='';if(resourceAiCurrent(s)){s.busy=false;s.controller=null;el('Fields').disabled=false;el('Confirm').disabled=false;updateResourceAiSource();}}
}
function confirmResourceAi(){
  const s=resourceAiState,method=document.getElementById('resourceAiMethod')?.value;
  if(!s||s.busy||!resourceAiCurrent(s)||!Object.hasOwn(AI_SELECTABLE_METHODS,method))return;
  mistakeStorageSet(resourceAiKey(s),{version:1,method});
  document.getElementById('resourceAiStatus').textContent=readResourceAiMethod(s)===method?'已确认到本浏览器：'+AI_REVIEW_METHODS[method]+'；尚未创建材料或执行复习。':'本地保存失败，请重试；原内容未改变。';
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
