const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');
test('answer and explanation share one confirmation per draft and show adoption success',{timeout:90000},async()=>fixture(async({base,ids,temp,serve,api,snapshot})=>{
 const url=await serve(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
 const row=await api('POST','/courses/'+ids.courseId+'/mistakes',{title:'填入测试',content:'1+1=?',answerContent:'旧答案',explanation:'旧解析',questionFormat:'open',mistakeType:'thinking'},201),before=snapshot();
 for(const [index,viewport]of [[1280,960],[390,844]].entries()){
 const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';const check=(v,m)=>{if(!v)throw Error(m);};try{
  await openCourse(${ids.courseId},'填入测试','mistakes');
  fetchMistakeAnswerDraft=async()=>({answer:'2',explanation:'相加得到2',choice_answer:[],caveats:[],needs_more_information:false,needs_review:true});
  coursesAiSettings.configure({provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-adoption-key',retain:true,consent:true});
  for(const p of ['Create','Edit']){
   if(p==='Create')await openMistakeCreate();else {await openMistakeDetail(${row.id},false);await openMistakeEdit();}
   const field=n=>document.getElementById('mistake'+p+n),ai=n=>answerAiNode(p,n);
   field('Content').value='1+1=?';field('Format').value='open';field('Answer').value='旧答案';field('Explanation').value='旧解析';toggleMistakeAnswerAi(p);await generateMistakeAnswerAi(p);
   check(!ai('Accept').checked,'new draft requires confirmation');applyMistakeAnswerAi(p,'answer');check(field('Answer').value==='旧答案','unconfirmed draft cannot overwrite');
   ai('Accept').checked=true;applyMistakeAnswerAi(p,'answer');check(field('Answer').value==='2'&&field('Explanation').value==='旧解析'&&ai('Accept').checked,'answer replacement keeps consent and other field');
   check(ai('ApplyStatus').textContent.includes('已替换答案')&&ai('ApplyStatus').textContent.includes('保存'),'answer success visible beside controls');
   applyMistakeAnswerAi(p,'explanation');check(field('Explanation').value==='相加得到2'&&ai('Accept').checked,'explanation adopts without another check');check(ai('ApplyStatus').textContent.includes('已替换解析'),'explanation success visible');check(document.getElementById('toastBox').textContent.includes('已替换解析'),'success toast shown');
   applyMistakeAnswerAi(p,'undo');check(field('Explanation').value==='旧解析'&&field('Answer').value==='2','undo restores only last fill');
   await generateMistakeAnswerAi(p);check(!ai('Accept').checked&&!ai('ApplyStatus').textContent,'regeneration resets consent and success');applyMistakeAnswerAi(p,'explanation');check(field('Explanation').value==='旧解析','new draft cannot reuse old consent');
   if(p==='Create')closeTagPicker();else closeMistakeEdit();
  }
  out.textContent='PASS';
 }catch(e){out.textContent='FAIL '+e.stack;}document.body.append(out);});`;
 const html=await runBrowser({chrome,profile:path.join(temp,'adoption-'+index),url,viewport,initScript:script});const result=html.match(/<pre id="regressionResult">[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/>PASS</,result||'no result');
 }
 assert.deepEqual(snapshot(),before,'adoption never saves business data');
},{legacy:false}));
