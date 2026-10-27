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
// Upload/edit advice never chooses the deterministic standard fallback.
const AI_SUGGESTABLE_METHODS = Object.freeze(Object.fromEntries(Object.entries(AI_SELECTABLE_METHODS).filter(([id])=>id!=='standard')));
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
    AI_DNS_FAKE_IP: '代理 DNS 返回了虚拟 IP，尚未连接模型。请关闭 TUN/Fake-IP，或将该服务商域名加入 Fake-IP 排除列表后重试。',
    AI_CONNECT_TIMEOUT: '连接 AI 服务超时，尚未收到模型响应。请检查代理、DNS 和服务商地址。',
    AI_MODEL_NOT_FOUND: '服务商明确返回：模型不存在。请核对该平台支持的模型 ID。',
    AI_MODEL_PERMISSION: '服务商拒绝访问此模型，请检查账户和套餐权限。',
    AI_KEY_PRODUCT_MISMATCH: '此 Key 的产品类型与接口不匹配，请核对普通 API 或 Coding Plan 的专用接口。',
    AI_ENDPOINT_NOT_FOUND: '服务商接口不存在或已下线，请核对 API 基础地址。',
    AI_REQUEST_REJECTED: '服务商拒绝了请求参数，请根据上游业务错误码排查。',
    AI_CONTENT_REJECTED: '服务商内容检查拒绝了本次请求。',
    MINDMAP_FORMAT_INVALID: 'AI 已返回内容，但导图中有无法识别的节点行；原大纲和导图已保留。',
    MINDMAP_HIERARCHY_INVALID: 'AI 返回的导图层级跳级或超过六层；原大纲和导图已保留。',
    OUTLINE_FORMAT_INVALID: '模型回复中缺少可读取的大纲文字，本次未填入。',
    OUTLINE_EMPTY: '模型返回的大纲为空，本次未填入。',
    OUTLINE_TOO_LONG: '模型返回的大纲超过 12000 字或 160 行，请分段生成。',
    AI_UNAVAILABLE: 'AI 服务未能完成请求，请根据上游 HTTP 状态或稍后重试；这不一定是 Key 错误。',
    AI_VISION_UNSUPPORTED: '当前模型不支持图片输入，请切换为 deepseek-flash 或支持视觉的兼容模型；没有回退到本地 OCR。',
    AI_OCR_IMAGE_TOO_LARGE: '页面图片过大，请裁剪或缩小后重试；未发送模型请求。',
    AI_OCR_IMAGE_FORMAT: '页面图片格式无效，请使用图片或 PDF 重新识别。',
    AI_OCR_INCOMPLETE: '模型回复缺少所选页面，未取得完整转录；原正文保留。请增加输出容量或缩小文档范围。',
    LOCAL_SETTINGS_CHANGED: '本机 AI 配置已改变或清除，请重新打开页面或应用当前配置。',
    AI_UPSTREAM_ERROR: '服务商返回错误，具体状态见上游 HTTP 状态。',
    AI_OUTPUT_LIMIT: '模型输出达到 token 上限后被截断，尚未取得完整结果；不会自动重试。',
    AI_EMPTY_RESPONSE: '模型请求已返回，但没有最终回答内容。',
    AI_RESPONSE_FORMAT: '服务商响应不符合 Chat Completions 格式。',
    AI_INVALID_JSON: '模型已回答，但没有按要求返回 JSON。',
    AI_CONNECTION_FAILED: '未能建立到服务商的连接，请检查网络、TLS 或代理配置。',
    AI_TIMEOUT: 'AI 请求超时，本次未取得结果；请检查网络或模型响应速度后手动重试。',
    INVALID_INPUT: '请检查输入：每项最多 4000 字，总请求不能超过 16KB。',
    BODY_TOO_LARGE: '输入内容过多，请精简正文或补充说明后重试。',
    INVALID_RESPONSE: 'AI 返回格式不正确，本次建议未采用，请重试。',
    NETWORK_ERROR: '无法连接 AI 服务，请检查网络后重试。',
    INVALID_API_URL: 'API 地址不可用：仅支持公网 HTTPS，禁止内网、特殊地址和重定向。',
    INVALID_API_KEY: '请填写有效的本次 AI Key，不要包含空格或换行。',
    PLATFORM_AI_UNAVAILABLE: '平台 AI 尚未配置或暂不可用，请联系平台负责人，或手动选择自己的 API。',
    COST_CONFIRMATION_REQUIRED: '请先勾选本次 AI 请求和费用确认。',
    AI_AUTH_FAILED: 'API Key 无效或已失效，请检查服务商控制台；不会回退 Mock。',
    AI_BALANCE_UNAVAILABLE: 'AI 服务账户余额不足或不可用，请检查服务商账户。',
    AI_UPSTREAM_RATE_LIMITED: 'AI 服务暂时限流，请稍后手动重试。',
    LOCAL_AI_UNAVAILABLE: '本机 AI 服务尚未启动。请重新运行启动课程网站，并查看启动提示或 local-ai.stderr.log 后重试。',
    LOCAL_AI_INCOMPATIBLE: '本机 AI 服务版本不匹配，缺少当前网站需要的接口。请重新运行启动课程网站；若网站后端已运行，请先停止后端再启动。',
    AI_LOCAL_ONLY: '本机 AI 接口仅允许本机页面访问，请使用 http://127.0.0.1:3000/。',
    AI_TEMP_KEY_ORIGIN: '页面与 AI 接口地址不一致。localhost 与 127.0.0.1、不同端口均属于不同来源；请从同一网站入口使用。'
  };
  const message = messages[code] || (status === 401 ? '请先登录后再使用 AI 分类。'
    : status === 403 ? '当前账号无权使用 AI 分类。'
    : status === 429 ? '请求过于频繁，请稍后重试。'
    : status === 404 ? '网站尚未接入 AI 分类接口，请联系管理员。'
    : status === 503 ? 'AI 服务暂不可用，请稍后重试。'
    : 'AI 分类失败，请稍后重试。');
  return Object.assign(new Error(message), { code, status });
}

async function classifyMistakeWithAi(input, { signal, timeoutMs = 100000, deepseek = null } = {}) {
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
    if(deepseek.provider!=='platform'&&(typeof deepseek.apiKey!=='string'||! /^[\x21-\x7e]{1,512}$/.test(deepseek.apiKey)))throw mistakeAiError('INVALID_API_KEY');
    if(deepseek.confirmCost!==true)throw mistakeAiError('COST_CONFIRMATION_REQUIRED');
    if(['compatible','platform'].includes(deepseek.provider)?!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(deepseek.model):!['deepseek-flash','deepseek-v4-pro'].includes(deepseek.model))throw mistakeAiError('INVALID_INPUT');
    endpoint=url.href;payload={...(deepseek.provider==='platform'?{provider:'platform'}:{api_key:deepseek.apiKey}),model:deepseek.model,action:'classify',confirm_cost:true,input,...(deepseek.provider==='compatible'?{provider:'compatible',base_url:deepseek.baseUrl,...(deepseek.workspaceId?{workspace_id:deepseek.workspaceId}:{})}:{})};
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
      if(data?.ok!==true||data.provider!==(deepseek.provider||'deepseek')||data.action!=='classify'||data.model!==deepseek.model)throw mistakeAiError('INVALID_RESPONSE');
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
