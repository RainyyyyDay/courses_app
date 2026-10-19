// 真正的详情 DOM + 全部前端脚本（不启动 app.js）；fetch 全部替换，意外请求直接失败。
const {mistakeAiListChecks}=require('./mistake-ai-list-frontend.cjs');
function mistakeAiBrowserScenario() {
  return `
  window.addEventListener('load', async () => {
    const result = document.createElement('pre'); result.id = 'regressionResult';
    const el = name => document.getElementById('mistakeAi' + name);
    const check = (ok, text) => { if (!ok) throw new Error(text); };
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    let calls = [], implementation;
    window.fetch = async (url, options) => {
      check(url === API + '/ai/classify' && options.method === 'POST', 'only classification endpoint may be called');
      calls.push({url, options}); return implementation(options);
    };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json'}});
    const suggestion = {review_method:'retry', reason:'Mock：按已提供的错误类型匹配临时示例规则，未推断错误原因。', needs_review:true};
    const prepare = id => {
      currentCourseId = 42; currentView = {type:'mistake',id};
      const row = {id,course_id:42,title:'虚构测试题',content:'1+1=?',answer_content:'2',explanation:'参考解析',mistake_type:'knowledge',review_status:'unreviewed',knowledge:[],review_revision:1};
      mistakeDetailState = {id,courseId:42,review:false,row};
      showPageOnly('mistakeDetailPage'); renderMistakeDetail(row, false);
      return row;
    };
    const fill = () => { el('StudentAnswer').value='3'; el('ErrorType').value='careless'; };
    try {
      if (sessionStorage.getItem('ai-confirm-reload') === 'yes') {
        prepare(11); el('Toggle').click();
        check(el('Method').value==='guided' && el('Confirmation').textContent.includes('已保存到本浏览器'), 'actual reload restores final confirmed choice');
        check(!mistakeAiState.result && !el('Reason').textContent && !el('StudentAnswer').value, 'only final choice persisted, no fabricated AI result or input');
        check(calls.length===0, 'restore never calls backend');
        el('Method').value='recall'; changeMistakeAiSuggestion(); confirmMistakeAiSuggestion();
        resetMistakeAi(); toggleMistakeAi();
        check(el('Method').value==='recall', 'restored choice can be changed and reconfirmed without AI');
        sessionStorage.removeItem('ai-confirm-reload');
        result.dataset.result='passed'; result.textContent='mock AI interactions and actual reload persistence passed';
        document.body.appendChild(result); return;
      }
      const row = prepare(11), original = JSON.stringify(row);
      const meta = document.getElementById('mistakeDetailMeta').textContent;
      el('Toggle').click();
      check(!el('Panel').hidden && el('Toggle').getAttribute('aria-expanded') === 'true', 'button opens panel');
      check(el('Question').value==='1+1=?' && el('CorrectAnswer').value==='2', 'question/reference answer prefill');
      check(!el('StudentAnswer').value && !el('ErrorType').value, 'never use reference answer or original category as error evidence');
      await requestMistakeAi(); check(calls.length===0 && el('Error').textContent, 'required evidence blocks empty request');
      fill();
      let release;
      implementation = () => new Promise(resolve => {release=resolve;});
      const pending = requestMistakeAi();
      check(el('Submit').disabled && el('Inputs').disabled && el('Status').textContent.includes('正在分类'), 'loading and duplicate-click guard');
      await requestMistakeAi(); check(calls.length===1, 'only one concurrent request');
      const body = JSON.parse(calls[0].options.body);
      check(JSON.stringify(Object.keys(body).sort())===JSON.stringify(['question','student_answer','error_type','correct_answer','context'].sort()), 'exact five-field contract');
      check(body.student_answer==='3' && body.correct_answer==='2' && body.error_type==='careless', 'student and reference answers are distinct');
      release(reply(suggestion)); await pending;
      check(!el('Result').hidden && el('Method').value==='retry' && el('Reason').textContent.includes('Mock：'), 'mock suggestion/reason visible');
      el('Method').value='guided'; el('Method').dispatchEvent(new Event('change')); el('Confirm').click();
      check(el('Confirmation').textContent.includes('引导练习') && el('Confirmation').textContent.includes('已保存到本浏览器'), 'modify and persist without save API');
      check(localStorage.getItem('mistake-ai-method:42:11')===JSON.stringify({version:1,method:'guided'}), 'only final choice and format version stored');
      const priorReason=el('Reason').textContent, priorConfirmation=el('Confirmation').textContent;
      implementation = () => reply({error:'AI_AUTH_NOT_CONFIGURED',message:'SECRET_INTERNAL_PATH'},503);
      await requestMistakeAi();
      check(el('Error').textContent.includes('尚未接入网站授权') && !el('Error').textContent.includes('SECRET'), '503 safe explanation');
      check(el('Reason').textContent===priorReason && el('Method').value==='guided' && el('Confirmation').textContent===priorConfirmation, 'failure preserves previous suggestion/manual choice');
      check(!el('Submit').disabled && el('Submit').textContent.includes('重试'), 'retry enabled');
      implementation = () => {throw new TypeError('SECRET_NETWORK_DETAIL');}; await requestMistakeAi();
      check(el('Error').textContent.includes('无法连接') && el('StudentAnswer').value==='3', 'network error preserves inputs');
      implementation = () => reply({...suggestion, review_method:'knowledge'}); await requestMistakeAi();
      check(el('Error').textContent.includes('格式不正确') && el('Reason').textContent===priorReason, 'invalid response not adopted');
      implementation = () => reply({...suggestion,reason:'<img src=x onerror="window.aiXss=true">'}); await requestMistakeAi();
      check(el('Reason').textContent.includes('<img') && !el('Reason').querySelector('img') && !window.aiXss, 'reason renders as plain text');
      // 使用真实适配层的短超时，只改变测试调用参数，不改变生产配置。
      const adapter=classifyMistakeWithAi;
      classifyMistakeWithAi=(input,options)=>adapter(input,{...options,timeoutMs:20});
      implementation = () => new Promise(() => {}); await requestMistakeAi();
      check(el('Error').textContent.includes('超时') && !el('Submit').disabled, 'timeout releases UI and permits retry');
      classifyMistakeWithAi=adapter;
      implementation=()=>reply(suggestion); el('Submit').click();
      for(let i=0;i<30 && mistakeAiState.busy;i++) await tick();
      check(!mistakeAiState.busy && el('Method').value==='retry', 'actual form submit retries successfully');
      check(JSON.stringify(row)===original && document.getElementById('mistakeDetailMeta').textContent===meta, 'all requests leave original mistake and category untouched');
      el('Question').value='中'.repeat(4000); el('StudentAnswer').value='文'.repeat(4000);
      const before=calls.length; await requestMistakeAi();
      check(calls.length===before && el('Error').textContent.includes('16KB'), 'UTF-8 total body size checked before fetch');
      el('Question').value='1+1=?'; fill();
      implementation=()=>new Promise(resolve=>{release=resolve;});
      const stale=requestMistakeAi(), oldSignal=calls.at(-1).options.signal;
      showPageOnly('detailPage'); check(oldSignal.aborted && el('Panel').hidden, 'leaving page cancels and clears temporary state');
      const second=prepare(12); el('Toggle').click();
      release(reply(suggestion)); await stale; await tick();
      check(!mistakeAiState.result && el('Result').hidden && el('StudentAnswer').value==='', 'late response cannot contaminate another mistake');
      check(second.mistake_type==='knowledge' && !el('Submit').disabled && el('Panel').getAttribute('aria-busy')==='false', 'next page reset cleanly');
      // 也验证通过原详情加载入口切换同页错题时会清理，并忽略陈旧结果。
      implementation=()=>new Promise(resolve=>{release=resolve;}); fill(); const samePage=requestMistakeAi();
      const originalRequestApi=requestApi; requestApi=async()=>({json:async()=>({...second,id:13})});
      currentView={type:'mistake',id:13}; await renderMistakeDetailPage(13,false); requestApi=originalRequestApi;
      release(reply(suggestion)); await samePage;
      check(el('Panel').hidden && mistakeAiState===null, 'detail load hook cancels previous request');
      prepare(11); el('Toggle').click();
      check(el('Method').value==='guided', 'unconfirmed later suggestions do not overwrite saved choice');
      resetMistakeAi(); currentCourseId=43; mistakeDetailState.courseId=43; el('Toggle').click();
      check(el('Result').hidden && !mistakeAiState.confirmedMethod, 'same mistake id in different course stays isolated');
      for (const bad of ['{', JSON.stringify({version:1,method:'knowledge'}), JSON.stringify({version:2,method:'retry'})]) {
        resetMistakeAi(); localStorage.setItem('mistake-ai-method:43:11',bad); el('Toggle').click();
        check(el('Result').hidden && !mistakeAiState.confirmedMethod, 'corrupt/unknown saved records ignored');
      }
      prepare(11); resetMistakeAi(); el('Toggle').click();
      const get=Storage.prototype.getItem, set=Storage.prototype.setItem;
      try {
        Storage.prototype.setItem=function(){throw new Error('quota');};
        el('Method').value='retry'; confirmMistakeAiSuggestion();
        check(el('Confirmation').textContent.includes('本地保存失败') && el('Method').value==='retry', 'failed persistence keeps current choice and reports failure');
        check(readMistakeAiMethod(mistakeDetailState)==='guided', 'failed write leaves last saved choice intact');
        Storage.prototype.getItem=function(){throw new Error('blocked');};
        resetMistakeAi(); el('Toggle').click();
        check(el('Result').hidden, 'unavailable storage does not break opening panel');
      } finally {Storage.prototype.getItem=get; Storage.prototype.setItem=set;}
      resetMistakeAi(); el('Toggle').click();
      el('Method').value='retry'; changeMistakeAiSuggestion();
      check(readMistakeAiMethod(mistakeDetailState)==='guided', 'unconfirmed selection does not persist');
      check(document.documentElement.scrollWidth<=innerWidth+1, 'no horizontal overflow at requested viewport');
      check(!document.getElementById('bootErrorBox'), 'unexpected JavaScript error: '+document.getElementById('bootErrorBox')?.textContent);
      await (${mistakeAiListChecks.toString()})(check,el);
      sessionStorage.setItem('ai-confirm-reload','yes'); location.reload(); return;
    } catch(err) { result.dataset.result='failed'; result.textContent=err.stack; }
    document.body.appendChild(result);
  });`;
}
module.exports = { mistakeAiBrowserScenario };
