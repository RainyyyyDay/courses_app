const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');
test('material preparation saves close all content dialogs only after success',{timeout:90000},async()=>fixture(async({base,ids,temp,serve,snapshot})=>{
  const before=snapshot(),url=await serve(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
  for(const [index,viewport]of [[1280,960],[390,844]].entries()){
    const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
 const out=document.createElement('pre');out.id='regressionResult';const check=(v,m)=>{if(!v)throw Error(m);};
 const api=async(method,url,body)=>(await requestApi(API+'/courses/'+${ids.courseId}+url,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})})).json();
 try{
  await openCourse(${ids.courseId},'保存反馈测试','notes');
  for(const type of ['note','material','mistake']){
   const row=await api('POST','/'+({note:'notes',material:'materials',mistake:'mistakes'}[type]),{title:'保存测试 '+type+'${index}',content:'北京是首都',...(type==='mistake'?{answerContent:'北京',questionFormat:'open',mistakeType:'thinking'}:{})});
   const context={row,sourceText:row.content,mode:'self_explain'};await openReviewWorkbench(type,row.id,context);
   const draftKey=reviewWorkbenchKey()+':draft';await saveWorkbenchMaterial();check(reviewWorkbench&&wb('Dialog').open&&wb('Error').textContent.includes('补齐'),'invalid form stays open');
   wb('Reference').value='北京是首都';const originalRequest=requestApi;
   try{requestApi=async(url,options)=>{if(options?.method==='PUT')throw Error('模拟保存失败');return originalRequest(url,options);};await saveWorkbenchMaterial();}finally{requestApi=originalRequest;}
   check(wb('Dialog').open&&wb('Reference').value==='北京是首都'&&wb('Error').textContent.includes('输入已保留'),'request failure keeps window and inputs');
   await Promise.all([saveWorkbenchMaterial(),saveWorkbenchMaterial()]);
   check(!reviewWorkbench&&!wb('Dialog').open&&[...document.querySelectorAll('.toast')].some(n=>n.textContent==='保存成功'),'successful save closes modal and shows a small success message');
   check(mistakeStorageGet(draftKey)===null,'successful close does not recreate an unsaved draft');
   const saved=await api('GET','/review-items/'+type+'/'+row.id+'/materials/self_explain');check(saved.version===1&&saved.material.reference==='北京是首都','double click saves exactly one version');
   await openReviewWorkbench(type,row.id,context);check(wb('Reference').value==='北京是首都'&&reviewWorkbench.version===1,'reopen restores saved material');closeReviewWorkbench();
  }
  check(document.documentElement.scrollWidth<=innerWidth+1,'mobile fits');out.dataset.result='passed';out.textContent='passed';
 }catch(e){out.dataset.result='failed';out.textContent=e.stack;}document.body.append(out);
});`;
    const html=await runBrowser({chrome,profile:path.join(temp,'material-save-'+index),url,viewport,initScript:script,blockedUrls:['https://api.deepseek.com/*','http://localhost:3000/*','http://127.0.0.1:3000/*']});
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-1800));
  }
  assert.deepEqual(snapshot(),before,'preparation cannot change grades, progress, sessions or plans');
},{legacy:false}));
