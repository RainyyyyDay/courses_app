/* Tab-memory credentials only. Host authentication/quotas must still run server-side. */
const coursesAiSettings = (() => {
  let key='', provider='mock', model='deepseek-flash', retain=false, auto=false, configured=false, epoch=0;
  let calls=0, message='尚未配置；原有手动输入和 Mock 演示可继续使用。';
  const active=new Set(), seen=new Set(), drafts=new Map();
  const node=id=>document.getElementById('coursesAi'+id);
  const status=()=>({provider,model,retain,auto,configured,hasKey:!!key,epoch,calls,drafts:drafts.size});
  const label=()=>provider==='mock'?'共用 AI 设置：Mock 演示':`共用 AI 设置：DeepSeek 官方 / ${model}（${key?'Key 就绪':'待填写 Key'}）`;
  function invalidate(){epoch++;for(const cancel of active)cancel();active.clear();}
  function refresh(){
    if(!node('Summary'))return;
    node('Summary').textContent=provider==='mock'?'当前：Mock 演示，不调用真实模型。':
      `当前：DeepSeek 官方 / ${model}；${key?'Key 已在本标签页就绪':'未持有 Key（不会回退 Mock）'}；已发起 ${calls} 次共享请求。`;
    node('Message').textContent=message;
    node('Open').textContent='AI 设置'+(drafts.size?` · 草稿 ${drafts.size}`:'');
    if(typeof updateResourceAiSource==='function')updateResourceAiSource();
    for(const prefix of ['mistakeAi','mistakeCreateAi','mistakeCreateAnswerAi','mistakeEditAnswerAi']){
      const option=document.getElementById(prefix+'Provider')?.querySelector('option[value="shared"]');if(option)option.textContent=label();
    }
    node('Drafts').replaceChildren();
    if(!drafts.size){const empty=document.createElement('p');empty.className='ai-empty-note';empty.textContent='暂无自动分析草稿，手动生成不受影响。';node('Drafts').append(empty);}
    for(const [id,draft] of drafts){
      const item=document.createElement('div'),title=document.createElement('p'),view=document.createElement('button'),discard=document.createElement('button');
      title.textContent=draft.title+' · '+draft.message;item.append(title);
      if(draft.result){view.type='button';view.textContent='查看草稿（不自动采用）';view.onclick=()=>viewDraft(id);item.append(view);}
      discard.type='button';discard.textContent='删除此草稿';discard.onclick=()=>{drafts.delete(id);refresh();};item.append(discard);node('Drafts').append(item);
    }
  }
  function configure(value){
    if(!['mock','deepseek'].includes(value.provider)||!['deepseek-flash','deepseek-v4-pro'].includes(value.model))throw new Error('请选择支持的服务商和模型。');
    if(value.provider==='deepseek'&&(!/^[\x21-\x7e]{1,512}$/.test(value.apiKey||'')||value.consent!==true))throw new Error('请填写 Key，并确认文字发送及可能产生的费用。');
    if(value.auto&&(value.provider!=='deepseek'||!value.retain||value.consent!==true))throw new Error('自动分析需要 DeepSeek、标签页内保留 Key，并勾选包含自动调用的统一授权。');
    invalidate();key=value.provider==='deepseek'?value.apiKey:'';provider=value.provider;model=value.model;
    retain=!!value.retain;auto=!!value.auto;configured=true;
    for(const prefix of ['mistakeAi','mistakeCreateAi','mistakeCreateAnswerAi','mistakeEditAnswerAi']){
      const select=document.getElementById(prefix+'Provider');if(select){select.value='shared';changeMistakeAiProvider(prefix);}
    }
    message='已应用。仅当前标签页有效；刷新、关闭或清除设置后失效。';refresh();
  }
  function read(){
    if(provider==='mock')return null;
    if(!key)throw new Error('共享设置中没有 Key，请打开“AI 设置”填写；不会自动切换 Mock。');
    if(calls>=20)throw new Error('本标签页共享调用已达 20 次安全上限，请停止并核对用量；刷新前确认没有重复请求。');
    const value={apiKey:key,model,confirmCost:true,sharedEpoch:epoch};calls++;
    if(!retain){key='';auto=false;}refresh();return value;
  }
  function track(credentials,cancel){
    if(credentials?.sharedEpoch!==undefined&&credentials.sharedEpoch!==epoch){cancel();return ()=>{};}
    active.add(cancel);return ()=>active.delete(cancel);
  }
  function valid(credentials){return credentials?.sharedEpoch===undefined||credentials.sharedEpoch===epoch;}
  function clear(){
    invalidate();key='';auto=false;retain=false;drafts.clear();seen.clear();
    // Keep the selected real provider: a cleared Key must not silently become Mock.
    message='Key、自动调用授权和内存草稿已清除；手工输入不受影响。';
    if(node('Key')){node('Key').value='';node('Retain').checked=false;node('Auto').checked=false;node('Consent').checked=false;}
    for(const prefix of ['mistakeAi','mistakeCreateAi','mistakeCreateAnswerAi','mistakeEditAnswerAi']){
      if(typeof clearMistakeAiKey==='function')clearMistakeAiKey(prefix);
    }
    refresh();
  }
  function open(){
    node('Provider').value=provider;node('Model').value=model;node('Key').value='';node('Retain').checked=retain;
    node('Model').dataset.selectedModel=model;syncProviderModel();
    node('Auto').checked=auto;node('Consent').checked=false;
    refresh();if(!node('Dialog').open)node('Dialog').showModal();
  }
  function syncProviderModel(){
    const field=node('Model'),real=node('Provider').value==='deepseek';
    if(field.value)field.dataset.selectedModel=field.value;
    field.disabled=!real;
    field.value=real?(field.dataset.selectedModel||model):'';
  }
  function apply(){
    try{configure({provider:node('Provider').value,model:node('Model').value||model,apiKey:node('Key').value||key,
      retain:node('Retain').checked,auto:node('Auto').checked,consent:node('Consent').checked});}
    catch(err){message=err.message;refresh();}finally{node('Key').value='';}
  }
  async function testConnection(){
    let credentials, release=()=>{}, timer, controller;
    try{
      if(provider!=='deepseek')throw new Error('请先应用 DeepSeek 设置，再测试连接；测试也可能计费。');
      credentials=read();controller=new AbortController();release=track(credentials,()=>controller.abort());
      const endpoint=new URL((globalThis.COURSES_AI_API_BASE??API).replace(/\/$/,'')+'/ai/test',location.href);
      if(endpoint.origin!==location.origin||endpoint.username||endpoint.password||!(endpoint.protocol==='https:'||endpoint.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)))throw mistakeAiError('AI_TEMP_KEY_ORIGIN');
      node('Test').disabled=true;timer=setTimeout(()=>controller.abort(),20000);
      const pending=fetch(endpoint.href,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',signal:controller.signal,
        body:JSON.stringify({api_key:credentials.apiKey,model:credentials.model,action:'connection',confirm_cost:true})});
      credentials.apiKey='';
      const response=await pending, body=await response.json().catch(()=>null);
      if(!valid(credentials))return;
      if(!response.ok)throw mistakeAiError(body?.error,response.status);
      if(body?.ok!==true||body.provider!=='deepseek'||body.model!==credentials.model||body.action!=='connection')throw mistakeAiError('INVALID_RESPONSE');
      message='DeepSeek 官方连接测试成功（已执行一次测试请求，可能计费）。';
    }catch(err){if(!credentials||valid(credentials))message=err.name==='AbortError'?'连接测试已取消或超时；不会自动重试。':(err.code?err.message:'连接测试失败，请检查设置和本地 AI 服务；不会回退 Mock。');}
    finally{if(credentials)credentials.apiKey='';release();clearTimeout(timer);node('Test').disabled=false;refresh();}
  }
  function captureCreation(){
    if(!auto)return null;
    const field=id=>document.getElementById(id)?.value?.trim()||'';
    return {epoch,input:{question:field('mistakeCreateContent'),student_answer:field('mistakeCreateAiStudentAnswer'),
      error_type:field('mistakeCreateAiErrorType'),solution_steps:field('mistakeCreateAiSteps'),
      correct_answer:field('mistakeCreateFormat')==='choice'?readMistakeChoiceAnswerIds('Create').join(','):field('mistakeCreateAnswer'),
      context:field('mistakeCreateExplanation'),mistake_category:field('mistakeCreateType')||'unclassified',
      question_format:field('mistakeCreateFormat')==='choice'?'choice':'open'}};
  }
  async function afterCreated(row,captured){
    if(!auto||captured?.epoch!==epoch||!Number.isSafeInteger(row?.id)||!Number.isSafeInteger(row?.course_id))return;
    const input=captured.input;
    const id=row.course_id+':'+row.id;if(seen.has(id))return;seen.add(id);
    // No invented student answers, no refresh/navigation trigger, no automatic retry.
    if(!input.question||!input.student_answer){message='错题已保存；缺少题干或学生作答，未自动调用 AI。可在详情页手动补充分析。';refresh();return;}
    if(drafts.size>=10){message='内存草稿已达 10 条，未自动调用；请先查看或删除草稿。';refresh();return;}
    const draft={title:row.title||'新错题',row,message:'正在生成分析草稿…',result:null};drafts.set(id,draft);refresh();
    let credentials;
    try{
      credentials=read();const pending=classifyMistakeWithAi(input,{deepseek:credentials});credentials.apiKey='';
      const result=await pending;if(!valid(credentials)||drafts.get(id)!==draft)return;
      draft.result=result;draft.message='待人工核对，未采用、未修改分类';
    }catch(err){if(drafts.get(id)===draft){draft.message='分析未完成；不会自动重试，请到详情页手动操作。';}}
    finally{if(credentials)credentials.apiKey='';refresh();}
  }
  function viewDraft(id){
    const draft=drafts.get(id);if(!draft?.result)return;
    if(typeof tagPickerState!=='undefined'&&tagPickerState||typeof mistakeEditPending!=='undefined'&&mistakeEditPending||typeof mistakeDetailState!=='undefined'&&mistakeDetailState?.review){message='请先关闭编辑表单或退出本轮复习，再查看分析草稿，避免打断作答。';refresh();return;}
    // Display in the existing AI panel. Adoption still uses its original confirm button.
    if(currentCourseId!==draft.row.course_id){message='请先打开该草稿所属课程，再查看；未切换页面或修改内容。';refresh();return;}
    node('Dialog').close();resetMistakeAi();
    const dialog=document.getElementById('mistakeAiDialog');
    document.getElementById('mistakeAiDialogBody').append(mistakeAiElement('Panel'));
    document.getElementById('mistakeAiDialogFoot').append(mistakeAiElement('Actions'));
    startMistakeAi({courseId:draft.row.course_id,id:draft.row.id,row:draft.row,review:false},{source:'list',view:currentView});
    mistakeAiState.result=draft.result;mistakeAiElement('Suggested').textContent=mistakeAiSuggestionText(draft.result);
    mistakeAiElement('Reason').textContent=draft.result.reason;renderMistakeAiAnalysis('mistakeAi',draft.result);
    mistakeAiElement('Method').value=readMistakeAiMethod(mistakeAiState.detail)||draft.result.review_method;
    mistakeAiElement('Result').hidden=false;mistakeAiElement('Status').textContent='保存后生成的分析草稿，未自动采用；已有手动选择优先。';
    document.getElementById('mistakeAiDialogQuestionTitle').textContent=draft.title;updateMistakeAiConfirm();dialog.showModal();
  }
  function mount(){
    const button=document.createElement('button');button.id='coursesAiOpen';button.type='button';button.className='courses-ai-open';button.onclick=open;document.body.append(button);
    const dialog=document.createElement('dialog');dialog.id='coursesAiDialog';dialog.className='courses-ai-settings';
    dialog.setAttribute('aria-labelledby','coursesAiTitle');
    dialog.innerHTML=`<header class="ai-settings-head"><div><h2 id="coursesAiTitle">AI 设置</h2><p>当前标签页共用 · 刷新或关闭后失效</p></div><button type="button" id="coursesAiDismiss" aria-label="关闭 AI 设置">×</button></header>
      <div class="ai-settings-body"><p id="coursesAiSummary" class="ai-settings-status" role="status"></p>
      <p class="ai-help">用于资料、笔记和错题的复习建议、材料草稿、答案解析及作答后的可选批改。手动填写不受影响，AI 批改不自动修改评分，其余生成结果需确认后采用。</p>
      <section class="ai-settings-section"><h3>服务与凭据</h3><div class="ai-settings-fields">
      <label>来源<select id="coursesAiProvider"><option value="mock">Mock 演示（非真实 AI）</option><option value="deepseek">DeepSeek 官方</option></select></label>
      <label>模型<select id="coursesAiModel" disabled><option value=""></option><option>deepseek-flash</option><option>deepseek-v4-pro</option></select></label></div>
      <label>API Key<input id="coursesAiKey" type="password" autocomplete="off" spellcheck="false" maxlength="512" placeholder="输入 Key，不回显已保留的内容"></label>
      <p class="ai-help">Key 不写入浏览器存储或数据库。</p></section>
      <section class="ai-settings-section"><h3>使用偏好与授权</h3>
      <label class="ai-check-row"><input id="coursesAiRetain" type="checkbox"><span>在当前标签页保留 Key<small>供多次操作使用；默认关闭，不勾选则仅下一次请求可用。</small></span></label>
      <label class="ai-check-row"><input id="coursesAiAuto" type="checkbox"><span>保存新错题后自动生成一次分析草稿<small>默认关闭；需要保留 Key，且题干和学生作答齐全。不自动采用或重试。</small></span></label>
      <label class="ai-check-row ai-consent-row"><input id="coursesAiConsent" type="checkbox"><span>同意文字发送及可能产生的费用<small>同意将所选文字发送至 DeepSeek 官方；若开启上方自动分析，本授权同时涵盖该自动调用。</small></span></label>
      <p class="ai-help">学生作答在新增错题的“AI 复习建议”中填写，不根据参考答案猜作答。每标签页最多 20 次共享调用，不代替后端账户配额。</p></section>
      <details class="ai-settings-extras"><summary>自动草稿与测试工具</summary><h3>本标签页的自动分析草稿</h3><div id="coursesAiDrafts"></div>${globalThis.COURSES_AI_LOCAL_MOCK?'<p class="ai-help"><a href="/ai-test" target="_blank" rel="noopener noreferrer">打开独立 AI 测试页 ↗</a><br>仅验证接口，不保存业务结果，也不继承当前标签页的 Key。</p>':''}</details></div>
      <footer class="ai-settings-footer"><p id="coursesAiMessage" role="status"></p><div class="modal-actions"><button type="button" class="ai-primary" id="coursesAiApply">应用设置</button><button type="button" id="coursesAiTest">测试已应用的连接（可能计费）</button><button type="button" class="ai-text-button" id="coursesAiClear">清除 Key 和草稿</button><button type="button" id="coursesAiClose">关闭</button></div></footer>`;
    dialog.addEventListener('close',()=>{node('Key').value='';});document.body.append(dialog);
    node('Apply').onclick=apply;node('Test').onclick=testConnection;node('Clear').onclick=clear;node('Close').onclick=()=>dialog.close();refresh();
    node('Dismiss').onclick=()=>dialog.close();
    node('Provider').onchange=syncProviderModel;syncProviderModel();
  }
  addEventListener('pagehide',clear);
  // Host calls this on verified login/logout/account switch. It supplies no browser-trusted identity.
  addEventListener('courses-ai-identity-changed',clear);
  if(document.readyState==='loading')addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  return Object.freeze({status,label,configure,read,track,valid,clear,open,captureCreation,afterCreated,identityChanged:clear});
})();
