/* Tab-memory credentials only. Host authentication/quotas must still run server-side. */
const coursesAiSettings = (() => {
  let baseUrl='', key='', provider='mock', model='deepseek-flash', retain=false, auto=false, configured=false, epoch=0;
  let selectedPreset='mock', workspaceId='', connectionState='untested';
  const presets=Object.freeze({
    mock:{name:'Mock 演示（非真实 AI）',provider:'mock',models:[]},
    zhipu:{name:'GLM（智谱）',provider:'compatible',baseUrl:'https://open.bigmodel.cn/api/paas/v4',models:['glm-5.3-flash','glm-5.3','glm-5.3-flashx','glm-4.7-flash'],note:'普通 API 按量调用。Coding Plan 需使用套餐专用地址和对应 Key，请按控制台说明修改地址。',docs:'https://docs.bigmodel.cn/cn/guide/develop/openai/introduction'},
    deepseek:{name:'DeepSeek（深度求索）',provider:'deepseek',models:['deepseek-flash','deepseek-v4-pro'],note:'使用 DeepSeek 官方 API Key。'},
    qwen:{name:'通义千问（阿里百炼）',provider:'compatible',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',models:['qwen3.7-plus','qwen3.8-max','qwen3.8-flash','qwen-plus','qwen-flash'],note:'默认中国内地普通 API 地址。Key、模型和地域须匹配；支持按控制台修改为业务空间专属域名或其他地域地址。Coding Plan / Token Plan 不能混用。',docs:'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope'},
    kimi:{name:'Kimi（月之暗面）',provider:'compatible',baseUrl:'https://api.moonshot.cn/v1',models:['kimi-k3','kimi-k2.6'],note:'中国内地开放平台 API；使用开放平台 Key，不使用 Kimi 网页登录或 Kimi Code 订阅凭据。',docs:'https://platform.kimi.com/docs/get-api-key'},
    doubao:{name:'豆包（火山方舟）',provider:'compatible',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',models:['doubao-seed-2-1-pro-260915','doubao-seed-2-1-lite-260915'],note:'默认北京地域。请填已开通的模型 ID，或你自己的 ep- 开头推理接入点 ID；预设型号不代表账号已有权限。',docs:'https://api.volcengine.com/api-docs/view?action=ChatCompletions&serviceCode=ark&version=2024-01-01'},
    siliconflow:{name:'硅基流动（多模型平台）',provider:'compatible',baseUrl:'https://api.siliconflow.cn/v1',models:['deepseek-ai/DeepSeek-V4.1-Flash','zai-org/GLM-5.3-Flash','zai-org/GLM-5.3','Pro/moonshotai/Kimi-K2.6','Qwen/Qwen2.5-72B-Instruct','deepseek-ai/DeepSeek-V3.2'],note:'使用硅基流动平台 Key 和完整模型 ID（含厂商前缀），以该账号可用模型为准。',docs:'https://docs.siliconflow.cn/docs/api/chat-completions-post'},
    openai:{name:'GPT（OpenAI）',provider:'compatible',baseUrl:'https://api.openai.com/v1',models:['gpt-6.1-sol','gpt-6-luna','gpt-6-astra','gpt-5.4-mini'],modelLabels:{'gpt-6.1-sol':'GPT-6.1 Sol（均衡）','gpt-6-luna':'GPT-6 Luna（轻量）','gpt-6-astra':'GPT-6 Astra（旗舰）','gpt-5.4-mini':'GPT-5.4 mini（保留选项）'},note:'使用 OpenAI API 平台的 Key 和可用模型 ID；预设不是你的账号联调结果。',docs:'https://developers.openai.com/api/docs/models'},
    gemini:{name:'Gemini（Google）',provider:'compatible',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',models:['gemini-3.8-flash','gemini-4-argon','gemini-3.5-flash-lite'],note:'使用 Google AI Studio / Gemini API Key。本预设为 Gemini 的兼容接口，不是 Vertex AI。',docs:'https://ai.google.dev/gemini-api/docs/openai'},
    claude:{name:'Claude（Anthropic）',provider:'compatible',baseUrl:'https://api.anthropic.com/v1',models:['claude-sonnet-5-5','claude-opus-5-5','claude-haiku-5-5'],note:'使用 Claude Console 的 API Key。兼容模式不提供原生结构化输出保证，结果仍须通过本网站校验；部分 Key 还需填写工作区 ID。',docs:'https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk'},
    grok:{name:'Grok（xAI）',provider:'compatible',baseUrl:'https://api.x.ai/v1',models:['grok-4.7'],note:'使用 xAI API Console 的 Key。本预设使用仍受支持的 Chat Completions 接口，不包含联网搜索工具。',docs:'https://docs.x.ai/developers/model-capabilities/legacy/chat-completions'},
    compatible:{name:'自定义兼容接口',provider:'compatible',baseUrl:'',models:[],note:'手动填写公网 HTTPS API 地址与模型 ID。'}
  });
  const guessPreset=(kind,url)=>kind==='compatible'?(Object.entries(presets).find(([id,p])=>id!=='compatible'&&p.baseUrl&&p.baseUrl===String(url||'').replace(/\/chat\/completions\/?$/,'').replace(/\/$/,''))?.[0]||'compatible'):kind;
  let applyError='';
  let calls=0, message='尚未配置；原有手动输入和 Mock 演示可继续使用。';
  const active=new Set(), seen=new Set(), drafts=new Map();
  const waiting=new Map();let waitingPanel=null,waitingTimer=null;
  function renderWaiting(){
    if(typeof document.createElement!=='function')return;
    if(!waiting.size){waitingPanel?.remove();waitingPanel=null;clearInterval(waitingTimer);waitingTimer=null;return;}
    if(!waitingPanel){
      waitingPanel=document.createElement('div');waitingPanel.className='ai-request-progress';
      waitingPanel.setAttribute('role','status');waitingPanel.setAttribute('aria-live','polite');
      const spinner=document.createElement('span');spinner.className='ai-request-spinner';spinner.setAttribute('aria-hidden','true');
      const text=document.createElement('span');text.className='ai-request-progress-text';waitingPanel.append(spinner,text);
    }
    const dialogs=[...document.querySelectorAll('dialog[open]')],dialog=dialogs.at(-1);
    const host=dialog?.querySelector('.ai-settings-footer')||dialog||document.body;
    waitingPanel.classList.toggle('ai-request-progress-dialog',!!dialog);
    if(waitingPanel.parentNode!==host)host.prepend(waitingPanel);
    const seconds=Math.max(0,Math.floor((Date.now()-Math.min(...waiting.values()))/1000));
    const text=waitingPanel.querySelector('.ai-request-progress-text');
    text.textContent=`AI 正在处理${waiting.size>1?'（'+waiting.size+' 个请求）':''}，请稍候… 已等待 ${seconds} 秒`;
    // Announce the initial status; elapsed seconds remain visual to avoid repeated screen-reader announcements.
    waitingPanel.setAttribute('aria-live',seconds?'off':'polite');
    if(!waitingTimer)waitingTimer=setInterval(renderWaiting,1000);
  }
  const node=id=>document.getElementById('coursesAi'+id);
  const status=()=>({provider,preset:selectedPreset,model,baseUrl,retain,auto,configured,hasKey:!!key,connectionState,epoch,calls,drafts:drafts.size});
  function serviceName(kind,url){
    if(kind==='mock')return 'Mock 演示';
    if(kind!=='compatible')return presets.deepseek.name;
    let host='';try{host=new URL(url).hostname.toLowerCase();}catch{}
    if(host.endsWith('.maas.aliyuncs.com'))return presets.qwen.name;
    const presetId=({'api.openai.com':'openai','generativelanguage.googleapis.com':'gemini','api.anthropic.com':'claude','api.x.ai':'grok','open.bigmodel.cn':'zhipu','api.deepseek.com':'deepseek','dashscope.aliyuncs.com':'qwen','dashscope-intl.aliyuncs.com':'qwen','api.moonshot.cn':'kimi','api.moonshot.ai':'kimi','ark.cn-beijing.volces.com':'doubao','api.siliconflow.cn':'siliconflow'})[host];
    return presets[presetId]?.name||presets.compatible.name;
  }
  const providerLabel=()=>serviceName(provider,baseUrl);
  const describe=credentials=>credentials?`${serviceName(credentials.provider||'deepseek',credentials.baseUrl).split('（')[0]} / ${credentials.model}`:'Mock 演示';
  const label=()=>provider==='mock'?'共用 AI 设置：Mock 演示':`共用 AI 设置：${providerLabel()} / ${model}（${key?'Key 就绪':'待填写 Key'}）`;
  function invalidate(){epoch++;for(const cancel of active)cancel();active.clear();}
  function refresh(){
    if(!node('Summary'))return;
    node('Summary').textContent=provider==='mock'?'当前：Mock 演示，不调用真实模型。':
      `当前：${providerLabel()} / ${model}；${key?'Key 已在本标签页就绪':'未持有 Key（不会回退 Mock）'}；已发起 ${calls} 次共享请求。`;
    node('Message').textContent=message;
    if(node('Verification'))node('Verification').textContent=provider==='mock'?'Mock 不请求真实模型。':connectionState==='passed'?'当前配置最近一次连接测试已通过；不代表所有生成场景或模型都已验证。':connectionState==='failed'?'当前配置最近一次连接测试未通过，请查看下方具体原因。':'当前配置尚未通过连接测试。预设已按文档适配，不代表你的账号已联调成功。';
    node('Message').classList.toggle('ai-settings-error',!!applyError);
    if(node('Applied'))node('Applied').textContent=provider==='mock'?'已生效：Mock 演示（不调用真实模型）':`已生效：${providerLabel()} / ${model} · ${key?'Key 就绪':'需要填写 Key'}`;
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
    if(!['mock','deepseek','compatible'].includes(value.provider)||(value.provider!=='compatible'&&!['deepseek-flash','deepseek-v4-pro'].includes(value.model)))throw new Error('请选择支持的服务商和模型。');
    let nextUrl='';
    if(value.provider==='compatible'){
      let url;try{url=new URL(value.baseUrl);}catch{throw new Error('请填写有效的 HTTPS API 地址。');}
      if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port&&url.port!=='443')throw new Error('API 地址必须为 HTTPS，不能包含账号、查询参数或片段。');
      if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value.model||''))throw new Error('请填写服务商提供的模型 ID。');
      nextUrl=url.href.replace(/\/$/,'');
    }
    if(value.provider!=='mock'&&!/^[\x21-\x7e]{1,512}$/.test(value.apiKey||''))throw Object.assign(new Error('请填写有效的 API Key，不要包含空格或换行。'),{field:'Key'});
    if(value.provider!=='mock'&&value.consent!==true)throw Object.assign(new Error('请先勾选“同意文字发送及可能产生的费用”，再应用设置。'),{field:'Consent'});
    if(value.auto&&(value.provider==='mock'||!value.retain||value.consent!==true))throw new Error('自动分析需要真实 AI、标签页内保留 Key，并勾选包含自动调用的统一授权。');
    const nextWorkspace=value.workspaceId||'';
    if(typeof nextWorkspace!=='string'||nextWorkspace&&!/^[A-Za-z0-9_-]{1,128}$/.test(nextWorkspace))throw new Error('工作区 ID 格式无效。');
    if(nextWorkspace&&(value.provider!=='compatible'||new URL(nextUrl).hostname!=='api.anthropic.com'))throw new Error('工作区 ID 仅用于 Anthropic 官方接口。');
    workspaceId=nextWorkspace;connectionState='untested';
    selectedPreset=value.preset&&presets[value.preset]?.provider===value.provider?value.preset:guessPreset(value.provider,nextUrl);
    applyError='';invalidate();key=value.provider!=='mock'?value.apiKey:'';provider=value.provider;model=value.model;baseUrl=nextUrl;
    retain=!!value.retain;auto=!!value.auto;configured=true;
    for(const prefix of ['mistakeAi','mistakeCreateAi','mistakeCreateAnswerAi','mistakeEditAnswerAi']){
      const select=document.getElementById(prefix+'Provider');if(select){select.value='shared';changeMistakeAiProvider(prefix);}
    }
    message=provider==='mock'?'已应用 Mock 演示；未启用真实 AI。':`已应用 ${providerLabel()} / ${model}。现在可测试连接${retain?'。':'；Key 仅供下一次请求，测试也会使用这次 Key。'}`;refresh();
  }
  function read(){
    if(provider==='mock')return null;
    if(!key)throw new Error('共享设置中没有 Key，请打开“AI 设置”填写；不会自动切换 Mock。');
    if(calls>=20)throw new Error('本标签页共享调用已达 20 次安全上限，请停止并核对用量；刷新前确认没有重复请求。');
    const value={apiKey:key,model,confirmCost:true,sharedEpoch:epoch,...(provider==='compatible'?{provider,baseUrl,...(workspaceId?{workspaceId}:{})}:{})};calls++;
    if(!retain){key='';auto=false;}refresh();return value;
  }
  function track(credentials,cancel){
    if(credentials?.sharedEpoch!==undefined&&credentials.sharedEpoch!==epoch){cancel();return ()=>{};}
    const id=Symbol();waiting.set(id,Date.now());renderWaiting();
    let finished=false;
    const release=()=>{if(finished)return;finished=true;active.delete(abort);waiting.delete(id);renderWaiting();};
    const abort=()=>{try{cancel();}finally{release();}};
    active.add(abort);return release;
  }
  function valid(credentials){return credentials?.sharedEpoch===undefined||credentials.sharedEpoch===epoch;}
  function clear(){
    applyError='';workspaceId='';connectionState='untested';if(node('Workspace'))node('Workspace').value='';invalidate();key='';auto=false;retain=false;drafts.clear();seen.clear();
    // Keep the selected real provider: a cleared Key must not silently become Mock.
    message='Key、自动调用授权和内存草稿已清除；手工输入不受影响。';
    if(node('Key')){node('Key').value='';node('Retain').checked=false;node('Auto').checked=false;node('Consent').checked=false;}
    for(const prefix of ['mistakeAi','mistakeCreateAi','mistakeCreateAnswerAi','mistakeEditAnswerAi']){
      if(typeof clearMistakeAiKey==='function')clearMistakeAiKey(prefix);
    }
    refresh();
  }
  function open(){
    node('Provider').value=selectedPreset;node('Workspace').value=workspaceId;node('BaseUrl').value=baseUrl;node('CustomModel').value=provider==='compatible'?model:'';node('Model').value=provider==='deepseek'?model:'deepseek-flash';node('Key').value='';node('Retain').checked=retain;
    node('Model').dataset.selectedModel=provider==='deepseek'?model:'deepseek-flash';syncProviderModel(false);
    node('Auto').checked=auto;node('Consent').checked=false;
    refresh();if(!node('Dialog').open)node('Dialog').showModal();
  }
  function syncProviderModel(changed=false){
    const choice=node('Provider').value,preset=presets[choice]||presets.compatible;
    const field=node('Model'),real=choice==='deepseek',custom=preset.provider==='compatible';
    if(field.value)field.dataset.selectedModel=field.value;
    field.disabled=!real;node('Custom').hidden=!custom;node('ModelLabel').hidden=custom;node('ModelPickLabel').hidden=!custom;
    node('Advanced').open=choice==='compatible';node('Advanced').querySelector('summary').textContent=choice==='compatible'?'自定义接口设置':'高级设置（修改 API 地址）';
    field.value=real?(field.dataset.selectedModel||'deepseek-flash'):'';
    if(changed){
      node('Key').value='';node('Workspace').value='';node('Consent').checked=false;applyError='';
      if(custom){node('BaseUrl').value=preset.baseUrl||'';node('CustomModel').value=preset.models[0]||'';}
      message='已选择 '+preset.name+'；请填写该服务的 Key、确认授权并应用设置。';refresh();
    }
    syncWorkspace();
    const suggestions=node('ModelSuggestions');suggestions.replaceChildren(...preset.models.map(id=>new Option(preset.modelLabels?.[id]||id,id)));
    node('ModelPick').replaceChildren(new Option('手动输入模型 / 接入点 ID',''),...preset.models.map(id=>new Option(preset.modelLabels?.[id]||id,id)));
    node('ModelPick').value=preset.models.includes(node('CustomModel').value)?node('CustomModel').value:'';
    node('CustomModelLabel').hidden=!!node('ModelPick').value;
    node('PresetNote').textContent=preset.note||'';
    node('PresetDocs').hidden=!preset.docs;if(preset.docs)node('PresetDocs').href=preset.docs;
  }
  function syncWorkspace(){let host='';try{host=new URL(node('BaseUrl').value).hostname;}catch{}node('WorkspaceGroup').hidden=host!=='api.anthropic.com';}
  function apply(){
    const choice=node('Provider').value,preset=presets[choice];
    if(!preset){message='请选择有效服务商。';refresh();return;}
    try{configure({preset:choice,workspaceId:node('WorkspaceGroup').hidden?'':node('Workspace').value.trim(),provider:preset.provider,model:preset.provider==='compatible'?node('CustomModel').value.trim():(node('Model').value||'deepseek-flash'),baseUrl:node('BaseUrl').value.trim(),apiKey:node('Key').value||(choice===selectedPreset&&(provider!=='compatible'||node('BaseUrl').value.trim().replace(/\/$/,'')===baseUrl)?key:''),
      retain:node('Retain').checked,auto:node('Auto').checked,consent:node('Consent').checked});node('Key').value='';}
    catch(err){applyError='设置未应用：'+err.message;message=applyError;refresh();if(err.field){node(err.field)?.scrollIntoView({block:'center',behavior:'smooth'});node(err.field)?.focus({preventScroll:true});}}
  }
  async function testConnection(){
    if(node('Test').disabled)return;
    if(applyError){message=applyError;refresh();return;}
    let credentials, release=()=>{}, timer, controller, timedOut=false;
    if(provider==='mock'){message='请先应用真实 AI 设置，再测试连接；测试也可能计费。';refresh();return;}
    try{credentials=read();}catch(err){message=err.message;refresh();return;}
    try{
      controller=new AbortController();release=track(credentials,()=>controller.abort());
      const endpoint=new URL((globalThis.COURSES_AI_API_BASE??API).replace(/\/$/,'')+'/ai/test',location.href);
      if(endpoint.origin!==location.origin||endpoint.username||endpoint.password||!(endpoint.protocol==='https:'||endpoint.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)))throw mistakeAiError('AI_TEMP_KEY_ORIGIN');
      node('Test').disabled=true;node('Test').textContent='正在测试连接…';message='正在连接所选 AI 服务，请稍候；不会自动重试。';refresh();timer=setTimeout(()=>{timedOut=true;controller.abort();},100000);
      const pending=fetch(endpoint.href,{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',signal:controller.signal,
        body:JSON.stringify({api_key:credentials.apiKey,model:credentials.model,action:'connection',confirm_cost:true,...(credentials.provider==='compatible'?{provider:'compatible',base_url:credentials.baseUrl,...(credentials.workspaceId?{workspace_id:credentials.workspaceId}:{})}:{})})});
      credentials.apiKey='';
      const response=await pending, body=await response.json().catch(()=>null);
      if(!valid(credentials))return;
      if(!response.ok){const error=mistakeAiError(body?.error,response.status);if(Number.isInteger(body?.upstream_status))error.message+=' 上游 HTTP '+body.upstream_status;if(typeof body?.upstream_code==='string'&&/^[0-9]{1,8}$/.test(body.upstream_code))error.message+='，业务码 '+body.upstream_code;throw error;}
      if(body?.ok!==true||body.provider!==(credentials.provider||'deepseek')||body.model!==credentials.model||body.action!=='connection')throw mistakeAiError('INVALID_RESPONSE');
      connectionState='passed';message=providerLabel()+'连接测试成功（已执行一次测试请求，可能计费）。';
    }catch(err){
      if(!credentials||valid(credentials)){
        connectionState='failed';
        if(err.name==='AbortError')message=timedOut?'连接测试等待已达 100 秒，已停止等待；不会自动重试。':'连接测试已取消；不会自动重试。';
        else if(err.code)message=err.message+(/^[A-Z_]{1,64}$/.test(err.code)?`（${err.code}${err.status?' / HTTP '+err.status:''}）`:'');
        else message='未能完成与本地 AI 接口的通信。请检查服务是否运行，以及浏览器网络面板中的本次请求；不会回退 Mock。';
      }
    }
    finally{if(credentials)credentials.apiKey='';release();clearTimeout(timer);node('Test').disabled=false;node('Test').textContent='测试已应用的连接（可能计费）';refresh();}
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
      <label>服务商<select id="coursesAiProvider">${Object.entries(presets).map(([id,p])=>`<option value="${id}">${p.name}</option>`).join('')}</select></label>
      <label id="coursesAiModelLabel">模型<select id="coursesAiModel" disabled><option value=""></option><option>deepseek-flash</option><option>deepseek-v4-pro</option></select></label><label id="coursesAiModelPickLabel" hidden>模型<select id="coursesAiModelPick"></select></label></div>
      <div id="coursesAiCustom" hidden><label id="coursesAiCustomModelLabel">模型 / 接入点 ID<input list="coursesAiModelSuggestions" id="coursesAiCustomModel" maxlength="200" placeholder="填写完整模型 ID，或 ep- 接入点 ID" autocomplete="off"></label><datalist id="coursesAiModelSuggestions"></datalist>
      <details id="coursesAiAdvanced" class="ai-settings-extras"><summary>高级设置（修改 API 地址）</summary><label>API 地址<input id="coursesAiBaseUrl" type="url" maxlength="2048" placeholder="https://服务商域名/v1" autocomplete="off"></label>

      <p class="ai-help">支持 Chat Completions 兼容协议和文本 JSON 回复。地址可填 API 基础路径或完整 /chat/completions 地址；仅允许公网 HTTPS。其他原生协议需另加适配器。</p></details><label id="coursesAiWorkspaceGroup" hidden>Anthropic 工作区 ID（按 Key 类型需要时填写）<input id="coursesAiWorkspace" maxlength="128" autocomplete="off" placeholder="例如控制台显示的工作区 ID"></label></div>
      <p id="coursesAiPresetNote" class="ai-help"></p><a id="coursesAiPresetDocs" href="#" class="ai-help" target="_blank" rel="noopener noreferrer" hidden>查看该服务商官方接入文档 ↗</a>
      <label>API Key<input id="coursesAiKey" type="password" autocomplete="off" spellcheck="false" maxlength="512" placeholder="输入 Key，不回显已保留的内容"></label>
      <p class="ai-help">Key 不写入浏览器存储或数据库。</p></section>
      <section class="ai-settings-section"><h3>使用偏好与授权</h3>
      <label class="ai-check-row"><input id="coursesAiRetain" type="checkbox"><span>在当前标签页保留 Key<small>供多次操作使用；默认关闭，不勾选则仅下一次请求可用。</small></span></label>
      <label class="ai-check-row"><input id="coursesAiAuto" type="checkbox"><span>保存新错题后自动生成一次分析草稿<small>默认关闭；需要保留 Key，且题干和学生作答齐全。不自动采用或重试。</small></span></label>
      <label class="ai-check-row ai-consent-row"><input id="coursesAiConsent" type="checkbox"><span>同意文字发送及可能产生的费用<small>同意将所选文字发送至当前配置的服务商（自定义地址请先核实）；若开启上方自动分析，本授权同时涵盖该自动调用。</small></span></label>
      <p class="ai-help">学生作答在新增错题的“AI 复习建议”中填写，不根据参考答案猜作答。每标签页最多 20 次共享调用，不代替后端账户配额。</p></section>
      <details class="ai-settings-extras"><summary>自动草稿与测试工具</summary><h3>本标签页的自动分析草稿</h3><div id="coursesAiDrafts"></div>${globalThis.COURSES_AI_LOCAL_MOCK?'<p class="ai-help"><a href="/ai-test" target="_blank" rel="noopener noreferrer">打开独立 AI 测试页 ↗</a><br>仅验证接口，不保存业务结果，也不继承当前标签页的 Key。</p>':''}</details></div>
      <footer class="ai-settings-footer"><p id="coursesAiApplied" class="ai-settings-applied"></p><p id="coursesAiVerification" class="ai-help"></p><p id="coursesAiMessage" role="status"></p><div class="modal-actions"><button type="button" class="ai-primary" id="coursesAiApply">应用设置</button><button type="button" id="coursesAiTest">测试已应用的连接（可能计费）</button><button type="button" class="ai-text-button" id="coursesAiClear">清除 Key 和草稿</button><button type="button" id="coursesAiClose">关闭</button></div></footer>`;
    dialog.addEventListener('close',()=>{node('Key').value='';});document.body.append(dialog);
    node('Apply').onclick=apply;node('Test').onclick=testConnection;node('Clear').onclick=clear;node('Close').onclick=()=>dialog.close();refresh();
    node('Dismiss').onclick=()=>dialog.close();
    node('Provider').onchange=()=>syncProviderModel(true);node('BaseUrl').oninput=syncWorkspace;
    node('ModelPick').onchange=()=>{const chosen=node('ModelPick').value;node('CustomModelLabel').hidden=!!chosen;if(chosen)node('CustomModel').value=chosen;else node('CustomModel').focus();};
    node('CustomModel').oninput=()=>{node('ModelPick').value=presets[node('Provider').value]?.models.includes(node('CustomModel').value)?node('CustomModel').value:'';};syncProviderModel(false);
  }
  document.addEventListener?.('close',()=>queueMicrotask(renderWaiting),true);
  addEventListener('pagehide',clear);
  // Host calls this on verified login/logout/account switch. It supplies no browser-trusted identity.
  addEventListener('courses-ai-identity-changed',clear);
  if(document.readyState==='loading')addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  return Object.freeze({status,label,describe,configure,read,track,valid,clear,open,captureCreation,afterCreated,identityChanged:clear});
})();
