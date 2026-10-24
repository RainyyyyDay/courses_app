// Real browser/business API; simulated AI responses and synthetic user credentials only.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs'),{runBrowser}=require('./browser-driver.cjs');

test('platform AI and own API: desktop/mobile switching, save reopen refresh, failures and no fallback',{timeout:120000},async()=>fixture(async({api,base,ids,temp,serve})=>{
 const row=await api('POST','/courses/'+ids.courseId+'/materials',{title:'双模式资料',content:'测试正文'},201),url=await serve();
 const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
 for(const [i,viewport] of [[1280,960],[390,844]].entries()){
 const script=`window.COURSES_API_BASE=${JSON.stringify(base)};window.COURSES_AI_API_BASE=location.origin+'/api';const realFetch=fetch;let available=true,fail=false,statusCalls=0,requests=[];fetch=async(u,o)=>{
  if(String(u).endsWith('/ai/platform-status')){statusCalls++;return new Response(JSON.stringify(available?{available:true,provider:'platform',model:'synthetic-model'}:{available:false,provider:'platform'}));}
  if(String(u).includes('/api/ai/')){const p=JSON.parse(o.body);requests.push(p);if(fail)return new Response(JSON.stringify({error:'PLATFORM_AI_UNAVAILABLE'}),{status:503});return new Response(JSON.stringify({provider:p.provider||'deepseek',result:{title:'测试',outline:'- '+(p.provider==='platform'?'平台草稿':'自带草稿'),needs_review:true}}));}
  return realFetch(u,o);
 };addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';const el=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m)},wait=async f=>{for(let n=0;n<300;n++){if(f())return;await new Promise(r=>setTimeout(r,20))}throw Error('UI timeout')};try{
  await wait(()=>typeof allcourses!=='undefined'&&allcourses.some(c=>c.id===${ids.courseId}));await openCourse(${ids.courseId},'双模式测试','materials');await loadMaterials();
  if(sessionStorage.getItem('platform-ai-done')){
   check(!coursesAiSettings.realReady()&&!coursesAiSettings.status().hasKey&&!coursesAiSettings.status().auto,'refresh clears credentials and consent');check(requests.length===0,'refresh never invokes model');await openTagPicker('edit','material',${row.id});check(el('tagPickerOutline').value==='- 自带草稿','saved draft survives real refresh');out.textContent='PASS';document.body.append(out);return;
  }
  coursesAiSettings.open();el('coursesAiProvider').value='platform';el('coursesAiProvider').dispatchEvent(new Event('change'));check(el('coursesAiKey').closest('label').hidden,'platform hides user key');el('coursesAiConsent').checked=true;el('coursesAiApply').click();await wait(()=>coursesAiSettings.realReady());
  check(requests.length===0&&statusCalls===1,'applying platform only reads configuration');check(!coursesAiSettings.status().hasKey,'platform never receives server key');el('coursesAiTest').click();await wait(()=>statusCalls===2&&!el('coursesAiTest').disabled);check(requests.length===0,'platform check is non billable');el('coursesAiClose').click();
  await openTagPicker('edit','material',${row.id});el('tagPickerOutline').value='';window.confirm=()=>true;await generatePickerOutline();check(el('tagPickerOutline').value==='- 平台草稿','platform draft available');check(requests.at(-1).provider==='platform'&&!('api_key' in requests.at(-1))&&!('base_url' in requests.at(-1)),'platform request sends no key or endpoint');await confirmTagPicker();await openTagPicker('edit','material',${row.id});check(el('tagPickerOutline').value==='- 平台草稿','save and immediate reopen');
  fail=true;await generatePickerOutline();check(el('tagPickerOutline').value==='- 平台草稿','failed generation preserves draft');check(coursesAiSettings.status().provider==='platform'&&requests.at(-1).provider==='platform','failure never falls back');fail=false;closeTagPicker();
  coursesAiSettings.open();available=false;el('coursesAiTest').click();await wait(()=>!el('coursesAiTest').disabled&&el('coursesAiMessage').textContent.includes('平台'));check(!coursesAiSettings.realReady(),'unavailable platform disables readiness');
  el('coursesAiProvider').value='deepseek';el('coursesAiProvider').dispatchEvent(new Event('change'));check(!el('coursesAiKey').closest('label').hidden,'own API exposes input');el('coursesAiKey').value='synthetic-own-key';el('coursesAiRetain').checked=true;el('coursesAiConsent').checked=true;el('coursesAiApply').click();await wait(()=>coursesAiSettings.status().provider==='deepseek');el('coursesAiClose').click();
  await openTagPicker('edit','material',${row.id});await generatePickerOutline();check(requests.at(-1).api_key==='synthetic-own-key'&&requests.at(-1).provider==='deepseek','own credential sent only in own mode');check(el('tagPickerOutline').value==='- 自带草稿','own mode still generates');await confirmTagPicker();
  coursesAiSettings.open();el('coursesAiClear').click();check(!coursesAiSettings.status().hasKey,'clear drops own key');el('coursesAiClose').click();check(!JSON.stringify({...localStorage,...sessionStorage}).includes('synthetic-own-key'),'no persistent credential');sessionStorage.setItem('platform-ai-done','1');location.reload();
 }catch(e){out.textContent='FAIL '+e.stack;document.body.append(out)}});`;
 const html=await runBrowser({chrome,profile:path.join(temp,'platform-ai-'+i),url,viewport,initScript:script});assert.match(html.match(/<pre id="regressionResult">[\s\S]*?<\/pre>/)?.[0]||'',/>PASS</);
 }
}));

test('platform status gateway supports GET without credentials and retains origin protection',async t=>{
 const express=require('../back/node_modules/express'),{createLocalAiGateway}=require('../back/localAiGateway');let hits=0;
 const app=express();app.use('/api/ai',createLocalAiGateway({fetchImpl:async(url,init)=>{hits++;assert.equal(url,'http://127.0.0.1:3002/api/ai/platform-status');assert.equal(init.method,'GET');assert.equal(init.body,undefined);return new Response(JSON.stringify({available:true,provider:'platform',model:'synthetic-model'}));}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 let response=await fetch(base+'/api/ai/platform-status');assert.equal(response.status,200);assert.equal((await response.json()).available,true);
 response=await fetch(base+'/api/ai/platform-status',{headers:{Origin:'https://foreign.example'}});assert.equal(response.status,403);assert.equal(hits,1);
});
