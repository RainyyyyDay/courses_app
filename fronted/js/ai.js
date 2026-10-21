/*
 * AI 请求适配层。默认使用网站 API；宿主可在加载脚本前配置 COURSES_AI_API_BASE。
 * 本地开发由 test_app.py 同源注入地址；正式部署沿用宿主配置。
 */
// Suggestion options only; selecting one does not activate its review engine.
const AI_REVIEW_METHODS = Object.freeze({
  choice_reproduction: '重新作答（选择题）', standard: '标准复习', cloze: '挖空回忆',
  self_explain: '自述讲解', reading: '阅读标记', contrast: '对比辨析', retry: '重新作答'
});
// Keep the old engine ID for historical rounds, not as a separate AI choice.
const AI_SELECTABLE_METHODS = Object.freeze(Object.fromEntries(Object.entries(AI_REVIEW_METHODS).filter(([id])=>id!=='choice_reproduction')));
const publicAiReviewMode = mode => mode==='choice_reproduction'?'retry':mode;

function normalizeMistakeAiAnalysis(value) {
  const text=v=>typeof v==='string'&&!!v.trim()&&v.length<=300;
  const texts=(v,max)=>Array.isArray(v)&&v.length<=max&&v.every(text);
  if(!value||!['correct','incorrect','uncertain'].includes(value.answer_status)
    ||!texts(value.observations,4)||!value.observations.length||!texts(value.follow_up_questions,3)
    ||!text(value.reference_check)||!texts(value.material_requirements,1)||!value.material_requirements.length
    ||!Array.isArray(value.possible_causes)||value.possible_causes.length>3
    ||!Array.isArray(value.alternatives)||value.alternatives.length>3)return null;
  const possible_causes=[];
  for(const item of value.possible_causes){
    if(!item||!['knowledge','thinking','execution','unclassified'].includes(item.category)
      ||!['possible','supported'].includes(item.support)||!text(item.explanation)||!text(item.evidence))return null;
    possible_causes.push({category:item.category,support:item.support,explanation:item.explanation.trim(),evidence:item.evidence.trim()});
  }
  const alternatives=[];
  for(const item of value.alternatives){
    if(!item||typeof item.mode_id!=='string'||!Object.hasOwn(AI_REVIEW_METHODS,item.mode_id)||!text(item.reason))return null;
    alternatives.push({mode_id:publicAiReviewMode(item.mode_id),reason:item.reason.trim()});
  }
  if(value.answer_status==='correct'&&possible_causes.length)return null;
  return {answer_status:value.answer_status,observations:value.observations.map(v=>v.trim()),possible_causes,
    follow_up_questions:value.follow_up_questions.map(v=>v.trim()),reference_check:value.reference_check.trim(),
    alternatives,material_requirements:value.material_requirements.map(v=>v.trim())};
}

function mistakeAiError(code, status = 0) {
  const messages = {
    AI_AUTH_NOT_CONFIGURED: 'AI 服务尚未接入网站授权，暂不可用，请等待管理员完成联调。',
    AI_API_NOT_CONFIGURED: '当前打开方式未配置 AI 接口。请启动本地 Node 和 FastAPI 服务，然后打开 http://127.0.0.1:3002/，不要直接双击 HTML 文件。',
    LOCAL_MOCK_UNAVAILABLE: '无法连接本地 AI mock。请确认 FastAPI 在 3002 端口运行，启动后点击“重新获取 / 重试”；输入和已保存选择仍保留。',
    AI_BUSY: 'AI 服务繁忙，请稍后重试。',
    AI_TIMEOUT: 'AI 分类超时，请重试。',
    INVALID_INPUT: '请检查输入：每项最多 4000 字，总请求不能超过 16KB。',
    BODY_TOO_LARGE: '文字总量超过 16KB，请精简后重试。',
    INVALID_RESPONSE: 'AI 返回格式不正确，本次建议未采用，请重试。',
    NETWORK_ERROR: '无法连接 AI 服务，请检查网络后重试。',
    INVALID_API_KEY: '请填写有效的本次 DeepSeek Key，不要包含空格或换行。',
    COST_CONFIRMATION_REQUIRED: '请先勾选本次 DeepSeek 请求和费用确认。',
    AI_AUTH_FAILED: 'DeepSeek Key 无效或已失效，请检查官方控制台；不会回退 Mock。',
    AI_BALANCE_UNAVAILABLE: 'DeepSeek 账户余额不足或不可用，请检查官方账户。',
    AI_UPSTREAM_RATE_LIMITED: 'DeepSeek 暂时限流，请稍后手动重试。',
    AI_TEMP_KEY_ORIGIN: '临时 Key 仅可通过同源 HTTPS 接口或本机 HTTP 使用。请打开本地 3002 网站入口。'
  };
  const message = messages[code] || (status === 401 ? '请先登录后再使用 AI 分类。'
    : status === 403 ? '当前账号无权使用 AI 分类。'
    : status === 429 ? '请求过于频繁，请稍后重试。'
    : status === 404 ? '网站尚未接入 AI 分类接口，请联系管理员。'
    : status === 503 ? 'AI 服务暂不可用，请稍后重试。'
    : 'AI 分类失败，请稍后重试。');
  return Object.assign(new Error(message), { code, status });
}

async function classifyMistakeWithAi(input, { signal, timeoutMs = 20000, deepseek = null } = {}) {
  const configured = globalThis.COURSES_AI_API_BASE;
  if ((configured === undefined && globalThis.location?.protocol === 'file:')
    || (configured !== undefined && (typeof configured !== 'string' || !configured.trim()))) {
    throw mistakeAiError('AI_API_NOT_CONFIGURED');
  }
  const base = (configured ?? API).trim().replace(/\/$/, '');
  const fields = ['question', 'student_answer', 'error_type', 'correct_answer', 'context', 'solution_steps', 'mistake_category', 'question_format'];
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !fields.includes(key))
    || Object.values(input).some(value => typeof value !== 'string' || value.length > 4000)) {
    throw mistakeAiError('INVALID_INPUT');
  }
  let endpoint=`${base}/ai/classify`, payload=input;
  if (deepseek) {
    // Never send a user credential to a cross-origin configured API or an insecure remote site.
    let url;
    try { url=new URL(`${base}/ai/test`,globalThis.location?.href); } catch { throw mistakeAiError('AI_TEMP_KEY_ORIGIN'); }
    const localHttp=url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if(url.origin!==globalThis.location?.origin||(!localHttp&&url.protocol!=='https:')||url.username||url.password)throw mistakeAiError('AI_TEMP_KEY_ORIGIN');
    if(typeof deepseek.apiKey!=='string'||! /^[\x21-\x7e]{1,512}$/.test(deepseek.apiKey))throw mistakeAiError('INVALID_API_KEY');
    if(deepseek.confirmCost!==true)throw mistakeAiError('COST_CONFIRMATION_REQUIRED');
    if(!['deepseek-flash','deepseek-v4-pro'].includes(deepseek.model))throw mistakeAiError('INVALID_INPUT');
    endpoint=url.href;payload={api_key:deepseek.apiKey,model:deepseek.model,action:'classify',confirm_cost:true,input};
  }
  let body = JSON.stringify(payload);payload=null;
  if (new TextEncoder().encode(body).length > 16384) throw mistakeAiError('BODY_TOO_LARGE');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw mistakeAiError('INVALID_INPUT');
  const controller = new AbortController();
  let timer, onAbort;
  // 总超时包含读取响应体；即使测试替身忽略 abort，也不会一直占住界面。
  const cancelled = new Promise((_, reject) => {
    onAbort = () => {
      controller.abort();
      reject(Object.assign(new Error('请求已取消'), { name: 'AbortError' }));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(mistakeAiError('AI_TIMEOUT', 504));
    }, timeoutMs);
  });
  const request = async () => {
    if (signal?.aborted || controller.signal.aborted) throw Object.assign(new Error('请求已取消'), { name: 'AbortError' });
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body, signal: controller.signal, cache: 'no-store'
      });
    } catch (err) {
      if (controller.signal.aborted) throw err;
      throw mistakeAiError(!deepseek&&globalThis.COURSES_AI_LOCAL_MOCK ? 'LOCAL_MOCK_UNAVAILABLE' : 'NETWORK_ERROR');
    }
    let data = await res.json().catch(() => null);
    if (!res.ok) {
      // 不展示上游 message/detail/异常正文，以免泄露路径、凭据或内部信息。
      throw mistakeAiError(typeof data?.error === 'string' ? data.error : data?.detail==='AI_AUTH_NOT_CONFIGURED'?'AI_AUTH_NOT_CONFIGURED':'HTTP_ERROR', res.status);
    }
    if(deepseek){
      if(data?.ok!==true||data.provider!=='deepseek'||data.action!=='classify'||data.model!==deepseek.model)throw mistakeAiError('INVALID_RESPONSE');
      data=data.result;
    }
    if (!data || typeof data.review_method !== 'string'
      || (!Object.hasOwn(AI_REVIEW_METHODS, data.review_method) && data.review_method !== 'unclassified')
      || typeof data.reason !== 'string' || !data.reason.trim() || data.reason.length > 500
      || data.needs_review !== true) throw mistakeAiError('INVALID_RESPONSE');
    const result={review_method:publicAiReviewMode(data.review_method),reason:data.reason.trim(),needs_review:true};
    if(data.analysis!==undefined||deepseek){
      const analysis=normalizeMistakeAiAnalysis(data.analysis);
      if(!analysis)throw mistakeAiError('INVALID_RESPONSE');
      result.analysis=analysis;
    }
    return result;
  };
  let release=()=>{};
  try {
    if(typeof coursesAiSettings!=='undefined')release=coursesAiSettings.track(deepseek,onAbort);
    const result=await Promise.race([cancelled, request()]);
    if(typeof coursesAiSettings!=='undefined'&&!coursesAiSettings.valid(deepseek))throw Object.assign(new Error('请求已取消'),{name:'AbortError'});
    return result;
  }
  finally {
    release();
    body=null;
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
