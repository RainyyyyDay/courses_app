'use strict';
// Read the shared encrypted installation settings only on the server.
exports.createService=({read=()=>require('../../../back/localAiSettings').readForServer()}={})=>{
  const fail=()=>Object.assign(Error('请在课程顶栏的 AI 设置中保存模型和 Key'),{status:503});
  function current(){const value=read();if(!value?.apiKey || !value.model)throw fail();return {
    provider:value.provider==='deepseek'?'deepseek':'custom',
    baseURL:(value.provider==='deepseek'?'https://api.deepseek.com':value.baseUrl).replace(/\/+$/,'').replace(/\/chat\/completions$/,''),
    model:value.model,maxOutputTokens:value.outputTokens || 32768,apiKey:value.apiKey
  };}
  return {active:current,status(){try{const {provider,model,maxOutputTokens}=current();return {available:true,provider,model,maxOutputTokens,shared:true};}catch{return {available:false,shared:true};}},async handle(req,res){
    if(req.url!=='/api/ai/config' && req.url!=='/api/ai/test')return false;
    const status=req.method==='GET'&&req.url==='/api/ai/config'?200:409;
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify(status===200?{shared:true,...this.status()}:{error:'请使用课程顶栏的统一 AI 设置与连接测试'}));return true;
  }};
};
