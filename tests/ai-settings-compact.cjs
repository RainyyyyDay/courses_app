const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');
test('compact AI settings hide low-frequency tools and clear credentials independently from drafts',{timeout:90000},async()=>fixture(async({base,ids,temp,serve})=>{
 const url=await serve(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
 for(const [i,viewport]of [[1280,960],[390,844]].entries()){
 const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';const el=id=>document.getElementById('coursesAi'+id),check=(v,m)=>{if(!v)throw Error(m);};try{
  await openCourse(${ids.courseId},'精简设置','mistakes');coursesAiSettings.open();const dialog=el('Dialog');
  check(!el('Advanced').open&&!dialog.querySelector('a[href="/ai-test"]')&&!dialog.querySelector('#coursesAiDrafts'),'advanced collapsed and test/draft tools absent');check(dialog.querySelectorAll('button[aria-label="关闭 AI 设置"]').length===1,'one close action');check(!el('Summary'),'no duplicate top summary');
  el('Provider').value='claude';el('Provider').dispatchEvent(new Event('change'));check(!el('Advanced').open&&!el('WorkspaceGroup').hidden&&el('WorkspaceGroup').closest('details')===el('Advanced'),'workspace in advanced');
  el('Provider').value='compatible';el('Provider').dispatchEvent(new Event('change'));check(el('Advanced').open&&!el('EndpointGroup').hidden&&!el('CustomModelLabel').hidden,'custom fields directly available');
  el('Provider').value='deepseek';el('Provider').dispatchEvent(new Event('change'));check(!el('Advanced').open&&el('EndpointGroup').hidden,'DeepSeek has same advanced preferences without custom endpoint');
  classifyMistakeWithAi=async()=>({review_method:'standard',reason:'synthetic',needs_review:true});
  const config={provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-compact-key',retain:true,consent:true,auto:true};coursesAiSettings.configure(config);
  const seed=async id=>coursesAiSettings.afterCreated({id,course_id:${ids.courseId},title:'测试草稿'},{epoch:coursesAiSettings.status().epoch,input:{question:'1+1=?',student_answer:'3'}});
  await seed(123);check(coursesAiSettings.status().drafts===1&&!el('DraftOpen').hidden,'drafts have separate entry');
  el('Advanced').open=true;el('Clear').click();check(!coursesAiSettings.status().hasKey&&!coursesAiSettings.status().auto&&coursesAiSettings.status().drafts===1,'clearing Key keeps draft');
  coursesAiSettings.configure(config);el('ClearDrafts').click();check(coursesAiSettings.status().hasKey&&coursesAiSettings.status().drafts===0&&el('DraftOpen').hidden,'clearing drafts keeps Key');
  await seed(124);el('Close').click();el('DraftOpen').click();check(el('DraftDialog').open&&el('Drafts').textContent.includes('测试草稿'),'separate draft dialog is usable');el('DraftClose').click();
  coursesAiSettings.open();check(!el('Advanced').open,'normal reopening is compact');check(el('Apply').getBoundingClientRect().bottom<=innerHeight,'apply visible');check(el('Consent').getBoundingClientRect().width===16,'compact checkbox');check(document.documentElement.scrollWidth<=innerWidth+1,'no horizontal overflow');await new Promise(r=>setTimeout(r,250));out.textContent='PASS';
 }catch(e){out.textContent='FAIL '+e.stack;}document.body.append(out);});`;
 const html=await runBrowser({chrome,profile:path.join(temp,'compact-'+i),url,viewport,initScript:script,screenshot:path.join(os.tmpdir(),'courses-ai-compact-'+viewport.join('x')+'.png')});const result=html.match(/<pre id="regressionResult">[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/>PASS</,result||'no result');
 }
},{legacy:false}));
