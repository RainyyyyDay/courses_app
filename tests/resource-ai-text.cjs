// Real website and Chrome, synthetic temporary database only; no AI requests.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');
test('saved resource review snippets restore independently of body and mode',{timeout:90000},async()=>fixture(async({base,ids,temp,serve,snapshot})=>{
 const before=snapshot(),url=await serve(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
 for(const [index,viewport]of [[1280,960],[390,844]].entries()){
  // Disable unrelated automatic navigation in this synthetic browser; retain all snippet storage across reload.
  const script=`window.COURSES_API_BASE=${JSON.stringify(base)};localStorage.removeItem('currentPage');addEventListener('load',async()=>{
const out=document.createElement('pre');out.id='regressionResult';const el=id=>document.getElementById('resourceAi'+id),check=(v,m)=>{if(!v)throw Error(m);},c=${ids.courseId};
const api=async(method,url,body)=>(await requestApi(API+'/courses/'+c+url,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})})).json();
const change=text=>{el('Content').value=text;el('Content').dispatchEvent(new Event('input',{bubbles:true}));};
try{
 await openCourse(c,'保存片段测试','notes');
 const phase=sessionStorage.getItem('snippet-test-${index}');
 if(phase){
  const rows=JSON.parse(phase);
  for(const [type,row]of rows){await openResourceDetail(type,row.id);check(el('Content').value==='  已校对 '+type+' <b>片段</b>\\n第二行  ','reload restores exact saved text, including whitespace');check(el('TextStatus').textContent.includes('已保存')&&el('SaveText').disabled,'saved status restored');check(readResourceAiMethod(resourceAiState)==='reading','confirmed mode remains separate');}
  for(const [type,row]of rows){await openResourceDetail(type,row.id);check(el('Goal').value==='compare'&&el('Recall').value==='  分不清 '+type+' 的概念  ','goal and recall survive reload exactly');check(el('ContextStatus').textContent.includes('已保存')&&el('SaveContext').disabled,'context saved status restored');}
  check(document.documentElement.scrollWidth<=innerWidth+1,'mobile fits');out.dataset.result='passed';out.textContent='passed';document.body.append(out);return;
 }
 const rows=[];
 for(const type of ['note','material']){
  const endpoint=type==='note'?'notes':'materials',row=await api('POST','/'+endpoint,{title:'片段测试${index}',content:'原始正文 '+type});rows.push([type,row]);
  await openResourceDetail(type,row.id);el('Panel').querySelector('details').open=true;
  check(el('Content').value===row.content&&el('TextStatus').textContent.includes('未保存'),'initial original body is not mistaken for saved snippet');
  check(el('Goal').value===''&&el('Recall').value===''&&el('ContextStatus').textContent.includes('未保存'),'no invented saved context');
  const originalFetch=window.fetch;let writes=0;window.fetch=(url,options)=>{if(options?.method&&!['GET','HEAD'].includes(options.method))writes++;return originalFetch(url,options);};
  const text='  已校对 '+type+' <b>片段</b>\\n第二行  ';change(text);check(el('TextStatus').textContent.includes('未保存'),'editing indicates unsaved');el('SaveText').click();
  check(el('TextStatus').textContent.includes('已保存')&&el('SaveText').disabled,'explicit save succeeds and prevents repeat saves');check(writes===0,'saving never sends AI or database requests');
  el('Goal').value='compare';el('Goal').dispatchEvent(new Event('change',{bubbles:true}));el('Recall').value='  分不清 '+type+' 的概念  ';el('Recall').dispatchEvent(new Event('input',{bubbles:true}));el('SaveContext').click();
  check(el('ContextStatus').textContent.includes('已保存')&&el('SaveContext').disabled&&writes===0,'context saved explicitly without requests');
  window.fetch=originalFetch;check(!readResourceAiMethod(resourceAiState),'saving text does not confirm mode');
  check((await(await requestApi(API+'/'+endpoint+'/'+row.id)).json()).content===row.content,'original body unchanged');
  check(readResourceAiText({...resourceAiState,courseId:c+100})===null,'course keys are isolated');
  check(readResourceAiContext({...resourceAiState,courseId:c+100})===null,'context course keys isolated');
  const other=type==='note'?'material':'note';check(type!=='note'||readResourceAiText({...resourceAiState,type:other})===null,'same numeric ids cannot share a snippet');
  check(type!=='note'||readResourceAiContext({...resourceAiState,type:other})===null,'context type keys isolated');
  await openResourceDetail(type,row.id);check(el('Content').value===text,'direct view restores saved snippet');
  change('未保存的新内容');el('Method').value='reading';confirmResourceAi();await openResourceDetail(type,row.id);check(el('Content').value===text,'mode confirmation never silently saves edited text');
  check(el('Goal').value==='compare'&&el('Recall').value.includes(type),'direct view restores context');
  el('Goal').value='read';el('Goal').dispatchEvent(new Event('change',{bubbles:true}));el('Recall').value='未保存的困难';el('Recall').dispatchEvent(new Event('input',{bubbles:true}));check(!el('SaveContext').disabled&&el('ContextStatus').textContent.includes('未保存'),'context edits mark dirty');confirmResourceAi();await openResourceDetail(type,row.id);
  check(el('Goal').value==='compare'&&el('Recall').value==='  分不清 '+type+' 的概念  ','mode confirmation does not save context');
  const setContext=Storage.prototype.setItem;el('Recall').value='失败的修改';
  try{Storage.prototype.setItem=function(){throw Error('test quota');};saveResourceAiContext();check(el('ContextStatus').textContent.includes('保存失败')&&el('Recall').value==='失败的修改','context failure preserves input');}finally{Storage.prototype.setItem=setContext;}
  await openResourceDetail(type,row.id);check(el('Recall').value==='  分不清 '+type+' 的概念  ','context failure preserves saved value');
  el('Recall').value='a'.repeat(4001);saveResourceAiContext();check(el('ContextStatus').textContent.includes('4000'),'overlong context rejected');
  el('Goal').value='';el('Recall').value='';saveResourceAiContext();await openResourceDetail(type,row.id);check(el('Goal').value===''&&el('Recall').value===''&&el('SaveContext').disabled,'optional context can be cleared and saved');
  el('Goal').value='compare';el('Recall').value='  分不清 '+type+' 的概念  ';saveResourceAiContext();check(readResourceAiMethod(resourceAiState)==='reading'&&readResourceAiText(resourceAiState)===text,'context does not change confirmed mode or saved snippet');
  change('保存失败时保留输入');const originalSet=Storage.prototype.setItem;
  try{Storage.prototype.setItem=function(){throw Error('test quota');};saveResourceAiText();check(el('TextStatus').textContent.includes('保存失败')&&el('Content').value==='保存失败时保留输入','failure is visible and preserves input');}finally{Storage.prototype.setItem=originalSet;}
  await openResourceDetail(type,row.id);check(el('Content').value===text,'failed save preserves prior saved text');
  change('   ');saveResourceAiText();check(el('TextStatus').textContent.includes('未保存'),'blank rejected');
  change('a'.repeat(4001));saveResourceAiText();check(el('TextStatus').textContent.includes('4000'),'too long rejected without truncation');
 }
 sessionStorage.setItem('snippet-test-${index}',JSON.stringify(rows));location.reload();
}catch(e){out.dataset.result='failed';out.textContent=e.stack;document.body.append(out);}
});`;
  const html=await runBrowser({chrome,profile:path.join(temp,'snippet-'+index),url,viewport,initScript:script,blockedUrls:['https://api.deepseek.com/*','http://localhost:3000/*','http://127.0.0.1:3000/*']});
  const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-1800));
 }
 assert.deepEqual(snapshot(),before,'saving snippets never changes review evidence, materials, modes, sessions or plans in the database');
},{legacy:false}));
