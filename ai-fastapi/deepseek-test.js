'use strict';
(() => {
  const el = id => document.getElementById(id);
  const messages = {
    AI_AUTH_FAILED: 'Key 无效或已失效，请检查 DeepSeek 官方控制台。',
    AI_BALANCE_UNAVAILABLE: '账户余额不足或不可用，请检查官方账户。',
    AI_UPSTREAM_RATE_LIMITED: 'DeepSeek 限流，请稍后手动重试。',
    AI_AUTH_NOT_CONFIGURED: '此入口尚未接入授权，请使用本地测试入口或联系管理员。',
    AI_TIMEOUT: '请求超时；上游仍可能计费，不会自动重试。',
    AI_BUSY: '测试正在繁忙，请稍后手动重试。',
    RATE_LIMITED: '本机测试次数过多，请稍后手动重试。',
    INVALID_API_KEY: 'Key 格式不正确，请检查是否有空格或换行。',
    INVALID_RESPONSE: '接口可响应，但建议格式不符合要求，本次未采用。',
    COST_CONFIRMATION_REQUIRED: '请先确认本次请求和可能的费用。',
    INVALID_INPUT: '请检查模型、Key 和题目输入是否完整。',
    AI_UNAVAILABLE: '官方接口请求失败，请检查网络或模型是否可用。'
  };
  let pending = false, controller = null;
  el('testForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || !el('testForm').reportValidity()) return;
    const action=event.submitter?.value || 'connection';
    let body = JSON.stringify({api_key:el('apiKey').value, model:el('model').value,
      action, confirm_cost:el('confirmCost').checked,
      ...(action==='classify'?{input:{question:el('question').value, student_answer:el('studentAnswer').value,
        error_type:el('errorType').value,correct_answer:el('correctAnswer').value,solution_steps:el('solutionSteps').value}}:{})});
    el('apiKey').value=''; el('confirmCost').checked=false;
    el('result').textContent=''; el('status').textContent='正在请求 DeepSeek 官方接口，不会自动重试…';
    pending=true; el('controls').disabled=true;
    controller=new AbortController();
    const timer=setTimeout(()=>controller?.abort(),20000);
    try {
      const response=await fetch('/api/ai/test',{method:'POST',headers:{'Content-Type':'application/json'},
        body,signal:controller.signal,cache:'no-store'});
      body=null;
      const data=await response.json();
      if(!response.ok)throw {userMessage:messages[data.error] || '测试失败，请检查服务状态；不会自动重试。'};
      if(data.ok!==true||data.provider!=='deepseek')throw {userMessage:'测试响应格式不正确。'};
      el('status').textContent='测试成功。Key 已清空；结果没有自动保存或应用到错题。';
      el('result').textContent=JSON.stringify(data,null,2);
    } catch(error) {
      el('status').textContent=error.name==='AbortError'?'请求已取消或超时，上游仍可能计费；不会自动重试。':
        error instanceof TypeError?'无法连接测试接口，请检查服务是否运行。':
          error.userMessage||'测试接口响应异常，请检查服务状态；不会自动重试。';
    } finally {
      body=null;clearTimeout(timer);controller=null;pending=false;el('controls').disabled=false;
    }
  });
  el('clear').addEventListener('click',()=>{
    controller?.abort();el('apiKey').value='';el('confirmCost').checked=false;el('result').textContent='';
    el('status').textContent='Key 和结果已清空；不会发送新请求。';
  });
  addEventListener('pagehide',()=>{controller?.abort();el('apiKey').value='';el('confirmCost').checked=false;});
})();
