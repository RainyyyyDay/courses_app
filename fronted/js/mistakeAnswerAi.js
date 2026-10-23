/* Optional editor-only answer drafts. No persistence or automatic adoption. */
const mistakeAnswerAiStates={Create:null,Edit:null};
const answerAiNode=(prefix,name)=>document.getElementById('mistake'+prefix+'AnswerAi'+name);
function resetMistakeAnswerAi(prefix){
  mistakeAnswerAiStates[prefix]?.controller?.abort();mistakeAnswerAiStates[prefix]=null;
  const host=answerAiNode(prefix,'Host');if(host){host.replaceChildren();host.hidden=true;}
}
function answerAiOwner(prefix){return prefix==='Create'?tagPickerState:mistakeEditPending;}
function answerAiCurrent(prefix,state){return mistakeAnswerAiStates[prefix]===state&&answerAiOwner(prefix)===state.owner
  &&currentView===state.view&&state.owner?.courseId===currentCourseId&&!state.owner.saving;}
function answerAiInput(prefix){
  const field=name=>document.getElementById('mistake'+prefix+name);
  const format=field('Format').value;
  const values=format==='choice'?readMistakeChoiceOptionValues(prefix):[];
  return {question:field('Content').value.trim(),question_format:format,
    choice_type:field('ChoiceType').value,options:values.map((text,i)=>({id:String.fromCharCode(65+i),text:text.trim()})),
    existing_answer:format==='choice'?readMistakeChoiceAnswerIds(prefix).join(','):field('Answer').value,
    existing_explanation:field('Explanation').value};
}
function answerAiFingerprint(input){return JSON.stringify([input.question,input.question_format,input.choice_type,input.options]);}
function toggleMistakeAnswerAi(prefix){
  const owner=answerAiOwner(prefix);if(!owner||owner.saving)return;
  const host=answerAiNode(prefix,'Host');
  if(!host.hidden){resetMistakeAnswerAi(prefix);return;}
  const state={owner,view:currentView,busy:false,controller:null,draft:null};mistakeAnswerAiStates[prefix]=state;
  const id='mistake'+prefix+'AnswerAi';
  host.innerHTML=`<p>可选功能：不影响手工输入。先校对题干和选项；不上传附件、不自动保存或判分。</p>
    <fieldset id="${id}Controls"><label>生成来源<select id="${id}Provider" onchange="changeMistakeAiProvider('${id}')"><option value="shared">共用 AI 设置（右下角可配置）</option><option value="default">Mock 演示（不生成真实答案）</option><option value="deepseek">DeepSeek 官方（临时 Key）</option></select></label>
    <div id="${id}KeySettings" class="mistake-ai-key-settings" hidden><label>本次 Key<input id="${id}ApiKey" type="password" autocomplete="off" spellcheck="false" maxlength="512"></label>
    <label>模型<select id="${id}Model"><option>deepseek-flash</option><option>deepseek-v4-pro</option></select></label>
    <label><input id="${id}Cost" type="checkbox">同意本次文字发送至 DeepSeek 官方，知晓可能产生费用。</label><small>Key 发送后清空，不保存；不自动重试或回退 Mock。</small></div>
    <button type="button" onclick="coursesAiSettings.open()">打开共用 AI 设置</button>
    <button type="button" id="${id}Generate" onclick="generateMistakeAnswerAi('${prefix}')">生成草稿（不保存）</button></fieldset>
    <p id="${id}Status" role="status"></p><p id="${id}Error" class="mistake-inline-error" role="alert"></p>
    <section id="${id}Preview" hidden><h4>AI 参考草稿 · 待人工核实，不是客观判分依据</h4><p id="${id}Caveats"></p>
    <label id="${id}AnswerLabel">可编辑参考答案<textarea id="${id}Answer" maxlength="4000" rows="3"></textarea></label>
    <label>可编辑解析<textarea id="${id}Explanation" maxlength="4000" rows="5"></textarea></label>
    <label><input id="${id}Accept" type="checkbox">我已核实／修改所选内容，确认填入当前表单（仍需手动保存）。</label>
    <div class="modal-actions"><button type="button" onclick="applyMistakeAnswerAi('${prefix}','empty')">仅填空白字段</button><button type="button" onclick="applyMistakeAnswerAi('${prefix}','answer')">替换答案</button><button type="button" onclick="applyMistakeAnswerAi('${prefix}','explanation')">替换解析</button><button type="button" onclick="applyMistakeAnswerAi('${prefix}','undo')">撤回上次填入</button><button type="button" onclick="resetMistakeAnswerAi('${prefix}')">放弃草稿</button></div></section>`;
  host.hidden=false;
  clearMistakeAiKey(id,true);
}
async function fetchMistakeAnswerDraft(input,{signal,deepseek=null}={}){
  const base=(globalThis.COURSES_AI_API_BASE??API).replace(/\/$/,'');
  let endpoint;try{endpoint=new URL(base+'/ai/answer-draft',location.href);}catch{throw mistakeAiError('AI_TEMP_KEY_ORIGIN');}
  if(endpoint.origin!==location.origin||endpoint.username||endpoint.password||!(endpoint.protocol==='https:'||
    (endpoint.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))))throw mistakeAiError('AI_TEMP_KEY_ORIGIN');
  let body=JSON.stringify({provider:deepseek?(deepseek.provider||'deepseek'):'mock',...(deepseek?{api_key:deepseek.apiKey,model:deepseek.model,confirm_cost:deepseek.confirmCost,...(deepseek.provider==='compatible'?{base_url:deepseek.baseUrl,...(deepseek.workspaceId?{workspace_id:deepseek.workspaceId}:{})}:{})}:{}),input});
  if(new TextEncoder().encode(body).length>16384)throw mistakeAiError('BODY_TOO_LARGE');
  const controller=new AbortController(),abort=()=>controller.abort();
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,100000);
  let release=()=>{};
  try{
    if(typeof coursesAiSettings!=='undefined')release=coursesAiSettings.track(deepseek,abort);
    if(controller.signal.aborted)throw Object.assign(new Error('已取消'),{name:'AbortError'});
    const response=await fetch(endpoint.href,{method:'POST',headers:{'Content-Type':'application/json'},body,signal:controller.signal,cache:'no-store'});
    const data=await response.json().catch(()=>null);
    if(controller.signal.aborted||typeof coursesAiSettings!=='undefined'&&!coursesAiSettings.valid(deepseek))throw Object.assign(new Error('已取消'),{name:'AbortError'});
    if(!response.ok)throw mistakeAiError(data?.error||data?.detail,response.status);
    const d=data?.draft;
    if(data?.provider!==(deepseek?(deepseek.provider||'deepseek'):'mock')||!d||d.needs_review!==true||typeof d.answer!=='string'||d.answer.length>4000
      ||typeof d.explanation!=='string'||!d.explanation.trim()||d.explanation.length>4000||typeof d.needs_more_information!=='boolean'
      ||!Array.isArray(d.caveats)||d.caveats.length>3||d.caveats.some(x=>typeof x!=='string'||x.length>300)
      ||!Array.isArray(d.choice_answer)||d.choice_answer.some(x=>typeof x!=='string'||!input.options.some(o=>o.id===x)))throw mistakeAiError('INVALID_RESPONSE');
    return d;
  }catch(err){
    if(controller.signal.aborted){if(signal?.aborted)throw Object.assign(new Error('已取消'),{name:'AbortError'});throw mistakeAiError('AI_TIMEOUT');}
    throw err.code?err:mistakeAiError('NETWORK_ERROR');
  }finally{body=null;release();clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
async function generateMistakeAnswerAi(prefix){
  const state=mistakeAnswerAiStates[prefix];if(!state||!answerAiCurrent(prefix,state)||state.busy)return;
  const node=name=>answerAiNode(prefix,name);node('Error').textContent='';
  let input,deepseek;
  try{
    input=answerAiInput(prefix);if(!input.question)throw new Error('请先填写或校对题干文字；不会自动读取附件。');
    if(input.question_format==='choice'&&(input.options.length<2||input.options.some(x=>!x.text)))throw new Error('请先补齐并校对至少两个选择题选项。');
    deepseek=readMistakeAiKey('mistake'+prefix+'AnswerAi');
  }catch(err){node('Error').textContent=err.message;return;}
  state.busy=true;state.controller=new AbortController();node('Controls').disabled=true;
  node('Status').textContent=deepseek?'正在请求 '+coursesAiSettings.describe(deepseek)+' 生成参考草稿（可能计费），不会自动填入…':'正在生成 Mock 流程演示…';
  try{
    const pending=fetchMistakeAnswerDraft(input,{signal:state.controller.signal,deepseek});
    clearMistakeAiKey('mistake'+prefix+'AnswerAi');if(deepseek)deepseek.apiKey='';
    const draft=await pending;if(!answerAiCurrent(prefix,state))return;
    state.draft=draft;state.undo=null;state.fingerprint=answerAiFingerprint(input);node('Preview').hidden=false;node('Accept').checked=false;
    node('Answer').value=input.question_format==='choice'?draft.choice_answer.join(','):draft.answer;
    node('AnswerLabel').firstChild.textContent=input.question_format==='choice'?'候选正确选项（逗号分隔，人工核对）':'可编辑参考答案';
    node('Explanation').value=draft.explanation;node('Caveats').textContent=(deepseek?'AI 草稿，尚未验证正确。':'Mock 演示，不是本题解答。')+
      (draft.needs_more_information?'题意或条件不足，请先补充核实。':'')+draft.caveats.join('；');
    node('Status').textContent='草稿已生成，原答案和解析未改动；请核实后选择填入方式。';
  }catch(err){if(answerAiCurrent(prefix,state)&&err.name!=='AbortError'){node('Error').textContent=err.message;node('Status').textContent='生成失败，原输入和已有草稿保留，不自动重试。';}}
  finally{if(mistakeAnswerAiStates[prefix]===state){state.busy=false;state.controller=null;node('Controls').disabled=false;}}
}
function applyMistakeAnswerAi(prefix,target){
  const state=mistakeAnswerAiStates[prefix];if(!state?.draft||state.busy||!answerAiCurrent(prefix,state))return;
  const node=name=>answerAiNode(prefix,name),field=name=>document.getElementById('mistake'+prefix+name);
  node('Error').textContent='';
  const input=answerAiInput(prefix);
  if(answerAiFingerprint(input)!==state.fingerprint){node('Error').textContent='题干、题型或选项已改变，这份草稿已过期；请重新生成。';return;}
  if(target==='undo'){
    if(!state.undo){node('Error').textContent='没有可撤回的填入操作。';return;}
    if(input.existing_answer!==state.undo.after.existing_answer||input.existing_explanation!==state.undo.after.existing_explanation){
      node('Error').textContent='填入后你又修改了答案或解析，为保护输入不自动撤回。';return;
    }
    if(input.question_format==='choice')renderMistakeChoiceAnswerOptions(prefix,state.undo.before.existing_answer.split(',').filter(Boolean));
    else field('Answer').value=state.undo.before.existing_answer;
    field('Explanation').value=state.undo.before.existing_explanation;state.undo=null;
    if(prefix==='Edit')refreshMistakeEditDirty();else{updateMistakeCreateAnswerClear();updateMistakeCreateExplanationClear();}
    node('Status').textContent='已撤回上次填入，仍未保存。';return;
  }
  if(!node('Accept').checked){node('Error').textContent='请先核实或编辑草稿，并勾选确认；不会自动填入。';return;}
  const answer=node('Answer').value.trim(),explanation=node('Explanation').value.trim();
  const fillAnswer=target==='answer'||(target==='empty'&&!input.existing_answer.trim());
  const fillExplanation=target==='explanation'||(target==='empty'&&!input.existing_explanation.trim());
  if(fillAnswer){
    if(!answer){node('Error').textContent='草稿尚无可用答案，请手工补齐核实，或只替换解析。';return;}
    if(input.question_format==='choice'){
      const ids=[...new Set(answer.toUpperCase().split(/[,，、\s]+/).filter(Boolean))];
      if(!ids.length||ids.some(id=>!input.options.some(o=>o.id===id))||(input.choice_type==='single'&&ids.length!==1)){
        node('Error').textContent='请核对选项编号和单选／多选类型，不能用草稿改写选项。';return;
      }
      renderMistakeChoiceAnswerOptions(prefix,ids);
    }else field('Answer').value=answer;
  }
  if(fillExplanation)field('Explanation').value=explanation;
  if(fillAnswer||fillExplanation)state.undo={before:input,after:answerAiInput(prefix)};
  if(prefix==='Edit')refreshMistakeEditDirty();else{updateMistakeCreateAnswerClear();updateMistakeCreateExplanationClear();}
  node('Accept').checked=false;node('Status').textContent=fillAnswer||fillExplanation?'已按你的确认填入表单，尚未保存；请继续核对后点击原保存按钮。':'答案和解析均已有内容，未覆盖任何字段。';
}
addEventListener('pagehide',()=>{resetMistakeAnswerAi('Create');resetMistakeAnswerAi('Edit');});
