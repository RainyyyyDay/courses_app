/* Optional feedback on immutable answers; separate history writes never change grades. */
let reviewFeedbackState=null;
function resetReviewFeedback(owner){const s=reviewFeedbackState;if(owner&&s?.owner!==owner)return;s?.controller?.abort();reviewFeedbackState=null;}
function mountReviewFeedback(host,owner,key,input){
  if(!input){resetReviewFeedback();return;}
  const fingerprint=JSON.stringify(input);
  if(reviewFeedbackState?.key!==key||reviewFeedbackState?.fingerprint!==fingerprint||reviewFeedbackState?.view!==currentView){resetReviewFeedback();reviewFeedbackState={key,input,fingerprint,courseId:currentCourseId,busy:false,result:null,error:''};}
  const s=reviewFeedbackState;s.owner=owner;s.view=currentView;
  let section=host.querySelector('[data-review-feedback]');if(!section){section=document.createElement('section');section.dataset.reviewFeedback='';section.className='review-feedback';host.append(section);}
  s.host=section;renderReviewFeedback();
}
function renderReviewFeedback(){
  const s=reviewFeedbackState;if(!s?.host?.isConnected)return;
  const labels={correct:'基本正确',partial:'部分正确 / 有遗漏',incorrect:'需要修正',uncertain:'信息不足，暂不能判断'},r=s.result;
  const lines=(title,values)=>values.length?'<h4>'+title+'</h4><ol>'+values.map(v=>'<li>'+escapeHtml(v)+'</li>').join('')+'</ol>':'';
  s.host.innerHTML='<details class="review-ai-generator" '+(s.open?'open':'')+'><summary>AI 批改与错误解析<span class="ai-optional-tag">可选</span></summary><p class="ai-help">仅发送本轮题面、已提交的首次作答及参考要点，不读取附件。使用共用 AI 设置，DeepSeek 可能计费；不自动改写作答、评分、进度或排期。</p>'
    +'<div class="ai-action-row"><button type="button" onclick="coursesAiSettings.open()">AI 设置</button><button type="button" class="ai-primary" data-feedback-generate onclick="requestReviewFeedback()" '+(s.busy?'disabled':'')+'>'+(s.busy?'正在批改…':r?'重新获取批改（可能计费）':'AI 帮我批改与解析')+'</button>'+(s.busy?'<button type="button" onclick="reviewFeedbackState?.controller?.abort()">取消请求</button>':'')+'</div>'
    +'<p role="alert" class="mistake-inline-error">'+escapeHtml(s.error)+'</p>'
    +(s.result?'<p class="ai-help" data-feedback-save-status>'+escapeHtml(s.savedVersion?'批改已保存到本轮历史 · 版本 '+s.savedVersion:s.saveError||'正在保存本轮批改…')+'</p>':'')
    +(s.savePayload&&s.saveError?'<button type="button" data-feedback-retry-save onclick="saveReviewFeedbackHistory()" '+(s.saving?'disabled':'')+'>重试保存（不调用 AI）</button><p class="ai-help">保存前请勿离开页面，以免丢失这份批改。</p>':'')
    +(r?'<div class="review-ai-draft"><p class="ai-help">'+(s.provider==='mock'?'Mock 演示，未实际批改。':'AI 参考意见，可能有误，请人工核对；不是最终评分。')+'</p><h4>'+labels[r.judgment]+'</h4><p>'+escapeHtml(r.summary)+'</p>'
      +(s.input.objective_result?'<p class="ai-help">本题已有客观核对：'+labels[s.input.objective_result]+'。AI 仅补充解释，不覆盖原判分。</p>':'')
      +(r.errors.length?'<h4>错误与遗漏</h4>'+r.errors.map(e=>'<div class="review-feedback-error">'+(e.quote?'<blockquote>你的作答：'+escapeHtml(e.quote)+'</blockquote>':'')+'<p>'+escapeHtml(e.explanation)+'</p><p>如何修正：'+escapeHtml(e.correction)+'</p></div>').join(''):'')
      +(r.reference_answer?'<h4>参考解答 / 要点</h4><p>'+escapeHtml(r.reference_answer)+'</p>':'')+lines('解析步骤',r.steps)+lines('改进建议',r.suggestions)
      +(r.reference_check?'<p class="ai-help">参考核验：'+escapeHtml(r.reference_check)+'</p>':'')+'</div>':'')+'</details>';
  s.host.querySelector('details').addEventListener('toggle',event=>{if(reviewFeedbackState===s)s.open=event.target.open;});
}
function feedbackCurrent(s){return reviewFeedbackState===s&&s.courseId===currentCourseId&&s.view===currentView&&s.host.isConnected&&(s.owner===reviewWorkbench||s.owner===mistakeDetailState&&currentView.type==='mistake'&&currentView.review===true);}
function validateReviewFeedback(r,input){
  if(!r||!['correct','partial','incorrect','uncertain'].includes(r.judgment)||r.needs_review!==true)return false;
  for(const [key,max]of [['summary',1000],['reference_answer',2000],['reference_check',600]])if(typeof r[key]!=='string'||r[key].length>max)return false;
  if(!r.summary.trim())return false;
  for(const key of ['steps','suggestions'])if(!Array.isArray(r[key])||r[key].length>6||r[key].some(v=>typeof v!=='string'||!v.trim()||v.length>600))return false;
  return Array.isArray(r.errors)&&r.errors.length<=6&&r.errors.every(e=>e&&['quote','explanation','correction'].every(k=>typeof e[k]==='string'&&e[k].length<=600)&&(e.quote===''||input.student_answer.includes(e.quote))&&e.explanation.trim()&&e.correction.trim());
}
async function requestReviewFeedback(){
  const s=reviewFeedbackState;if(!s||s.busy||s.saving||!feedbackCurrent(s))return;
  if(s.savePayload){s.error='上次批改尚未保存，请先重试保存；无需重新请求 AI。';renderReviewFeedback();return;}
  let credentials,body,timer,networkStarted=false,release=()=>{};s.error='';
  try{
    if(!s.input.question.trim()||!s.input.student_answer.trim()||Object.values(s.input).some(v=>typeof v!=='string'||v.length>4000)||new TextEncoder().encode(JSON.stringify(s.input)).length>15000)throw new Error('题面或首次作答缺失，或本轮文字超过长度限制；不会猜测附件或静默截断，仍可手动核对。');
    const endpoint=new URL((globalThis.COURSES_AI_API_BASE??API).replace(/\/$/,'')+'/ai/review-feedback',location.href);
    if(endpoint.origin!==location.origin||endpoint.username||endpoint.password||!(endpoint.protocol==='https:'||endpoint.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)))throw mistakeAiError('AI_TEMP_KEY_ORIGIN');
    credentials=coursesAiSettings.read();
    body=JSON.stringify({provider:credentials?'deepseek':'mock',...(credentials?{api_key:credentials.apiKey,model:credentials.model,confirm_cost:credentials.confirmCost}:{}),input:s.input});
    if(credentials)credentials.apiKey='';
    s.busy=true;s.open=true;s.controller=new AbortController();renderReviewFeedback();
    release=coursesAiSettings.track(credentials,()=>s.controller.abort());timer=setTimeout(()=>s.controller.abort(),20000);
    networkStarted=true;const response=await fetch(endpoint.href,{method:'POST',headers:{'Content-Type':'application/json'},body,cache:'no-store',signal:s.controller.signal});const data=await response.json().catch(()=>null);
    if(!feedbackCurrent(s))return;
    if(s.controller.signal.aborted||!coursesAiSettings.valid(credentials))throw Object.assign(new Error('已取消'),{name:'AbortError'});
    if(!response.ok)throw mistakeAiError(data?.error||data?.detail,response.status);
    if(data?.provider!==(credentials?'deepseek':'mock')||!validateReviewFeedback(data.feedback,s.input))throw mistakeAiError('INVALID_RESPONSE');
    s.result=data.feedback;s.provider=data.provider;s.savedVersion=null;s.saveError='';
    s.savePayload={requestId:reviewRequestId(),provider:data.provider,model:credentials?credentials.model:'',feedback:data.feedback};
    await saveReviewFeedbackHistory(s);
  }catch(err){if(feedbackCurrent(s))s.error=s.controller?.signal.aborted?'批改已取消或超时，不自动重试；可继续手动核对。':err.code?err.message:!networkStarted?err.message:'批改网络请求不可用，请检查服务；不会回退 Mock。';}
  finally{body=null;if(credentials)credentials.apiKey='';release();clearTimeout(timer);s.busy=false;s.controller=null;if(feedbackCurrent(s))renderReviewFeedback();}
}
async function saveReviewFeedbackHistory(s=reviewFeedbackState){
  if(!s?.savePayload||s.saving)return;
  s.saving=true;s.saveError='';if(feedbackCurrent(s))renderReviewFeedback();
  try{
    const response=await requestApi(s.historyUrl+'/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s.savePayload)}),saved=await response.json();
    if(saved.saved!==true||!Number.isSafeInteger(saved.version)||!Number.isSafeInteger(saved.id))throw Error('保存响应无效');
    s.savedVersion=saved.version;s.savePayload=null;
  }catch{ s.saveError='批改尚未保存：请检查业务后端并重试保存；不会重复调用 AI。'; }
  finally{s.saving=false;if(feedbackCurrent(s))renderReviewFeedback();}
}
function bindReviewFeedbackHistory(owner,key,type,id){
  const s=reviewFeedbackState;if(!s||s.owner!==owner)return;
  s.historyUrl=`${API}/courses/${s.courseId}/review-items/${type}/${id}/history/${encodeURIComponent(key)}`;
  if(s.historyLoaded)return;s.historyLoaded=true;
  void(async()=>{try{
    const data=await(await requestApi(s.historyUrl)).json(),latest=data.feedback?.items?.[0];
    if(feedbackCurrent(s)&&!s.busy&&!s.result&&latest&&validateReviewFeedback(latest.feedback,s.input)){
      s.result=latest.feedback;s.provider=latest.provider;s.savedVersion=latest.version;renderReviewFeedback();
    }
  }catch{/* The user can still request feedback; a later save will show its own actionable failure. */}})();
}
function mountWorkbenchFeedback(s){
  const p=s.attempt,m=p.material;
  if(p.stage==='question'||p.modeId==='reading'){mountReviewFeedback(wb('Attempt'),s,null,null);return;}
  const input={mode_id:p.modeId,question:m.prompt+(p.modeId==='contrast'?'\n比较对象：'+m.objects.join(' / ')+'\n比较维度：'+m.dimensions.join('、'):''),student_answer:typeof p.firstAnswer==='string'?p.firstAnswer:JSON.stringify(p.firstAnswer),reference:p.modeId==='cloze'?JSON.stringify(m.blanks):m.reference||'',rubric:m.rubric||'',objective_result:p.modeId==='cloze'?(p.grade===3?'correct':'incorrect'):''};
  mountReviewFeedback(wb('Attempt'),s,'workbench:'+s.courseId+':'+p.id,input);
  bindReviewFeedbackHistory(s,'w:'+p.id,s.type,s.id);
}
function mountMistakeFeedback(s,answerVisible=s.progress.answerVisible){
  const p=s.progress;
  if(!['answer','completed'].includes(p.stage)||!p.firstAnswer||!answerVisible){mountReviewFeedback(document.getElementById('mistakeReviewPanel'),s,null,null);return;}
  const question=(p.question.content||p.question.ocrText||'')+(p.choice?'\n'+p.choice.options.map(o=>o.id+'：'+o.text).join('\n'):'');
  const input={mode_id:p.mode.id,question,student_answer:p.firstAnswer,reference:(p.answer?.content||'')+'\n'+(p.answer?.explanation||'')+(p.choice?'\n正确选项：'+JSON.stringify(p.choice.correctOption):''),rubric:'',objective_result:p.choice?(p.choice.correct?'correct':'incorrect'):''};
  mountReviewFeedback(document.getElementById('mistakeReviewPanel'),s,'mistake:'+s.courseId+':'+s.id+':'+p.reviewRevision+':'+p.round,input);
  bindReviewFeedbackHistory(s,'n:'+p.reviewRevision+':'+p.round,'mistake',s.id);
}
addEventListener('pagehide',()=>resetReviewFeedback());
