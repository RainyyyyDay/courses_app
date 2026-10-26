const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');
const feedback={judgment:'incorrect',summary:'需要补充解释',errors:[{quote:'不会',explanation:'缺少概念解释',correction:'先解释再举例'}],reference_answer:'1+2=3',reference_check:'需人工核实',steps:['代入等式'],suggestions:['再举例'],needs_review:true};
test('item history API keeps snapshots, immutable feedback versions, pagination and original grades',{timeout:90000},async()=>fixture(async({api,ids,snapshot,read,restart,back})=>{
 const c=ids.courseId,p='/courses/'+c;
 for(const type of ['note','material','mistake']){
  const table={note:'notes',material:'materials',mistake:'mistakes'}[type];
  const row=await api('POST',p+'/'+table,{title:'历史 '+type,content:'原始内容',...(type==='mistake'?{answerContent:'参考',mistakeType:'thinking',questionFormat:'open'}:{})},201);
  const base=p+'/review-items/'+type+'/'+row.id;
  assert.equal((await api('GET',base+'/history')).items.length,0);
  await api('PUT',base+'/materials/self_explain',{confirmed:true,expectedVersion:0,material:{prompt:'旧题面',reference:'旧参考',rubric:'概念例子'}});
  let a=await api('POST',base+'/attempts',{modeId:'self_explain',expectedMaterialVersion:1,requestId:type+'-history-1'});
  const key='w:'+a.id,detail=base+'/history/'+encodeURIComponent(key);
  assert.equal((await api('GET',detail)).material.reference,undefined,'question must not leak reference');
  await api('POST',detail+'/feedback',{requestId:'too-early',provider:'mock',model:'',feedback},409);
  a=await api('POST',base+'/attempts/'+a.id+'/events',{action:'submit',answer:'不会',requestId:'submit',expectedVersion:0});
  const protectedBefore=snapshot();
  const body={requestId:'feedback-1',provider:type==='note'?'compatible':'deepseek',model:type==='note'?'vendor/model-v2':'deepseek-flash',feedback};
  const saved=await api('POST',detail+'/feedback',body);
  assert.deepEqual(await api('POST',detail+'/feedback',body),saved,'retry is idempotent');
  await api('POST',detail+'/feedback',{...body,feedback:{...feedback,summary:'changed'}},409);
  await api('POST',detail+'/feedback',{...body,requestId:'secret',api_key:'synthetic-do-not-store'},400);
  await api('POST',detail+'/feedback',{...body,requestId:'wrong-quote',feedback:{...feedback,errors:[{quote:'不是作答',explanation:'错',correction:'改'}]}},400);
  for(let i=2;i<=12;i++)await api('POST',detail+'/feedback',{...body,requestId:'feedback-'+i});
  assert.deepEqual(snapshot(),protectedBefore,'feedback must not mutate grades/progress/session/materials');
  const d=await api('GET',detail);assert.equal(d.feedback.items.length,10);assert.equal(d.feedback.items[0].version,12);
  assert.equal((await api('GET',detail+'?beforeFeedbackId='+d.feedback.nextBeforeId)).feedback.items.length,2);
  assert.equal((await api('GET',base+'/history')).items[0].feedbackCount,12);
  assert.equal((await api('GET',base+'/history')).items[0].stage,'answer');
  a=await api('POST',base+'/attempts/'+a.id+'/events',{action:'judge',grade:2,requestId:'judge',expectedVersion:a.version});
  assert.equal((await api('GET',detail)).grade,2);
  await api('PUT',base+'/materials/self_explain',{confirmed:true,expectedVersion:1,material:{prompt:'新题面',reference:'新参考'}});
  assert.equal((await api('GET',detail)).material.reference,'旧参考','material editing never changes history');
  for(let i=2;i<=23;i++)await api('POST',base+'/attempts',{modeId:'self_explain',expectedMaterialVersion:2,requestId:type+'-history-'+i});
  const first=await api('GET',base+'/history'),second=await api('GET',base+'/history?before='+first.next);
  assert.equal(first.items.length,20);assert.equal(second.items.length,3);assert.equal(new Set([...first.items,...second.items].map(r=>r.key)).size,23);
  await api('GET',base+'/history?before=invalid',undefined,400);
  const other=await api('POST',p+'/'+table,{title:'不同条目',content:'另一题',...(type==='mistake'?{answerContent:'参考',mistakeType:'thinking',questionFormat:'open'}:{})},201);
  await api('GET',p+'/review-items/'+type+'/'+other.id+'/history/'+encodeURIComponent(key),undefined,404);
  if(type==='mistake'){
   let q=await api('GET',p+'/mistakes/'+row.id+'/review');
   q=await api('POST',p+'/mistakes/'+row.id+'/review',{action:'start',requestId:'native-start',expectedVersion:q.version});
   const nk='n:'+q.reviewRevision+':'+q.round,nurl=base+'/history/'+nk;
   assert.equal((await api('GET',nurl)).material.reference,undefined);
   q=await api('POST',p+'/mistakes/'+row.id+'/review/events',{action:'reveal_answer',firstAnswer:'不会',requestId:'native-answer',expectedVersion:q.version});
   await api('POST',nurl+'/feedback',{...body,requestId:'native-feedback'});
   q=await api('POST',p+'/mistakes/'+row.id+'/review/events',{action:'judge',mastered:true,requestId:'native-judge',expectedVersion:q.version});
   assert.equal((await api('GET',nurl)).grade,2);
   await api('POST',p+'/mistakes/'+row.id+'/review',{action:'start',requestId:'native-repeat',expectedVersion:q.version});
   assert.equal((await api('GET',nurl)).firstAnswer,'不会');
   await api('PATCH',p+'/mistakes/'+row.id,{content:'编辑后的新题面'});
   const original=await api('GET',nurl);assert.equal(original.material.prompt,'原始内容');assert.equal(original.material.reference,'参考');assert.equal(original.grade,2,'native edits never rewrite old evidence or grade');
  }else{
   const session=await api('POST',p+'/review-sessions',{sourceType:'total',requestId:'reading-'+type,selectedItems:[{type,id:other.id}]},201);
   const b=p+'/review-items/'+type+'/'+other.id,hkey='r:'+session.items[0].id;
   await api('POST',b+'/history/reading',{sessionItemId:session.items[0].id});await api('POST',b+'/history/reading',{sessionItemId:session.items[0].id});
   assert.equal((await api('GET',b+'/history')).items.length,1);
   await api('PATCH',p+'/'+table+'/'+other.id+'/review?sessionItemId='+session.items[0].id,{reviewStatus:'reviewed'});
   const reading=await api('GET',b+'/history/'+hkey);assert.equal(reading.modeId,'reading');assert.equal(reading.grade,null);assert.equal(reading.material.prompt,'另一题');
   await api('POST',b+'/history/'+hkey+'/feedback',body,409);
   const legacy=await api('POST',p+'/review-sessions',{sourceType:'total',requestId:'legacy-reading-'+type,selectedItems:[{type,id:other.id}]},201);
   await api('PATCH',p+'/'+table+'/'+other.id+'/review?sessionItemId='+legacy.items[0].id,{reviewStatus:'reviewed'});
   const missing=await api('GET',b+'/history/r:'+legacy.items[0].id);assert.equal(missing.material,null);assert.match(missing.note,/没有当时正文快照/);
  }
 }
 const beforeRestart=snapshot();await restart();assert.deepEqual(snapshot(),beforeRestart);
 assert.equal(read(db=>db.prepare('SELECT count(*) n FROM review_ai_feedback').get().n),37);
 assert.equal(read(db=>db.prepare('PRAGMA user_version').get().user_version),26);
 const file=path.join(back,'data/app.db');
 // Local v23: feedback already exists, mindmap_image does not. Preserve all existing feedback rows.
 const historyBefore=read(db=>db.prepare('SELECT * FROM review_ai_feedback ORDER BY id').all());
 let tempDb=new DatabaseSync(file);
 tempDb.exec('ALTER TABLE materials DROP COLUMN mindmap_image; ALTER TABLE notes DROP COLUMN mindmap_image; PRAGMA user_version=23;');tempDb.close();
 await restart();assert.deepEqual(snapshot(),beforeRestart);assert.deepEqual(read(db=>db.prepare('SELECT * FROM review_ai_feedback ORDER BY id').all()),historyBefore);
 assert.equal(read(db=>db.prepare('PRAGMA user_version').get().user_version),26);
 for(const table of ['materials','notes'])assert.ok(read(db=>db.prepare('PRAGMA table_info('+table+')').all().some(c=>c.name==='mindmap_image')));
 // Upstream v23: images exist, feedback tables do not. Preserve image payloads and review evidence.
 tempDb=new DatabaseSync(file);
 tempDb.exec("UPDATE materials SET mindmap_image='synthetic-image-material'; UPDATE notes SET mindmap_image='synthetic-image-note'; DROP TABLE review_ai_feedback; DROP TABLE review_reading_history; DROP INDEX idx_review_attempt_history; DROP INDEX idx_native_review_history; PRAGMA user_version=23;");tempDb.close();
 await restart();assert.deepEqual(snapshot(),beforeRestart);assert.equal(read(db=>db.prepare('PRAGMA user_version').get().user_version),26);
 for(const table of ['materials','notes'])assert.ok(read(db=>db.prepare('SELECT mindmap_image FROM '+table).all().every(r=>r.mindmap_image==='synthetic-image-'+(table==='notes'?'note':'material'))));
 assert.equal(read(db=>db.prepare('SELECT count(*) n FROM review_ai_feedback').get().n),0);
 // v22: neither feature exists. Both migrations must apply, without touching old review evidence.
 tempDb=new DatabaseSync(file);
 tempDb.exec('ALTER TABLE materials DROP COLUMN mindmap_image; ALTER TABLE notes DROP COLUMN mindmap_image; DROP TABLE review_ai_feedback; DROP TABLE review_reading_history; DROP INDEX idx_review_attempt_history; DROP INDEX idx_native_review_history; PRAGMA user_version=22;');tempDb.close();
 await restart();assert.deepEqual(snapshot(),beforeRestart);assert.equal(read(db=>db.prepare('PRAGMA user_version').get().user_version),26);
 await restart();assert.deepEqual(snapshot(),beforeRestart,'v24 restart must not repeat migration writes');
},{legacy:false}));

test('item history real browser shows all three details, versions and paging after refresh without AI',{timeout:90000},async()=>fixture(async({api,base,ids,temp,serve,snapshot})=>{
 const c=ids.courseId,p='/courses/'+c,rows=[];
 for(const type of ['note','material','mistake']){
  const table={note:'notes',material:'materials',mistake:'mistakes'}[type],row=await api('POST',p+'/'+table,{title:'浏览器历史 '+type,content:'旧正文',...(type==='mistake'?{answerContent:'参考',mistakeType:'thinking',questionFormat:'open'}:{})},201);
  if(type!=='mistake'){
   const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5V8AAAAASUVORK5CYII=';
   const updated=await api('PUT',p+'/'+table+'/'+row.id+'/mindmap',{outline:'导图主题\n  导图子项',mindmapJson:'{"topic":"synthetic"}',mindmapImage:image});
   assert.equal(updated.content,'旧正文');assert.equal(updated.mindmap_image,image,'upstream image return endpoint survives integration');assert.equal(updated.mindmap_json,'{"topic":"synthetic"}');
  }
  const b=p+'/review-items/'+type+'/'+row.id;
  await api('PUT',b+'/materials/self_explain',{confirmed:true,expectedVersion:0,material:{prompt:'当时题面',reference:'当时参考',rubric:'解释和例子'}});
  let attempt=await api('POST',b+'/attempts',{modeId:'self_explain',expectedMaterialVersion:1,requestId:'browser-'+type});
  attempt=await api('POST',b+'/attempts/'+attempt.id+'/events',{action:'submit',answer:'不会',requestId:'submit',expectedVersion:0});
  await api('POST',b+'/history/'+encodeURIComponent('w:'+attempt.id)+'/feedback',{requestId:'version-1',provider:'deepseek',model:'deepseek-flash',feedback:{...feedback,summary:'<img src=x onerror=alert(1)> 已保存批改'}});
  await api('POST',b+'/history/'+encodeURIComponent('w:'+attempt.id)+'/feedback',{requestId:'version-2',provider:'mock',model:'',feedback});
  await api('POST',b+'/attempts/'+attempt.id+'/events',{action:'judge',grade:2,requestId:'judge',expectedVersion:attempt.version});
  if(type==='note')for(let i=0;i<21;i++)await api('POST',b+'/attempts',{modeId:'self_explain',expectedMaterialVersion:1,requestId:'page-'+i});
  rows.push({type,id:row.id,key:'w:'+attempt.id});
 }
 const stable=snapshot(),url=await serve(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
 for(const [index,viewport]of [[1280,960],[390,844]].entries()){
  const script=`window.COURSES_API_BASE=${JSON.stringify(base)};localStorage.removeItem('currentPage');addEventListener('load',async()=>{
const out=document.createElement('pre');out.id='regressionResult';const check=(v,m)=>{if(!v)throw Error(m);},wait=async(fn)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('wait timed out');};
try{
 await openCourse(${c},'历史查看测试','notes');
 let aiCalls=0;const originalFetch=window.fetch;window.fetch=(url,options)=>{if(String(url).includes('/ai/'))aiCalls++;return originalFetch(url,options);};
 for(const row of ${JSON.stringify(rows)}){
  if(row.type==='mistake')await openMistakeDetail(row.id,false);else await openResourceDetail(row.type,row.id);
  const root=document.getElementById('itemReviewHistory');check(root,'history appears in original detail '+row.type);root.querySelector('details').open=true;await wait(()=>itemReviewHistoryState?.loaded);
  if(row.type!=='mistake')check(document.querySelector('#resourceDetailOutlineMap img')?.getAttribute('src').startsWith('data:image/png;base64,'),'upstream mindmap image and local review history coexist');
  if(row.type==='note'){check(root.querySelectorAll('[data-history-key]').length===20&&!root.querySelector('[data-history-more]').hidden,'history list paginates');root.querySelector('[data-history-more]').click();await wait(()=>root.querySelectorAll('[data-history-key]').length===22);}
  const entry=[...root.querySelectorAll('[data-history-key]')].find(n=>n.dataset.historyKey===row.key);check(entry,'correct round');entry.open=true;await wait(()=>entry.dataset.loaded);
  check(entry.textContent.includes('不会')&&entry.textContent.includes('当时参考')&&entry.textContent.includes('基本掌握'),'saved answer, snapshot and original grade visible');
  check(entry.querySelectorAll('[data-history-feedback-version]').length===2&&entry.textContent.includes('Mock 演示'),'versions and source are distinct');check(!entry.querySelector('img'),'history output is escaped');
 }
 check(aiCalls===0,'opening or expanding historical results never requests AI');check(document.documentElement.scrollWidth<=innerWidth+1,'desktop/mobile fits');
 if(!sessionStorage.getItem('history-refresh-${index}')){sessionStorage.setItem('history-refresh-${index}','1');location.reload();return;}
 out.dataset.result='passed';out.textContent='passed';
}catch(e){out.dataset.result='failed';out.textContent=e.stack;}document.body.append(out);
});`;
  const html=await runBrowser({chrome,profile:path.join(temp,'item-history-'+index),url,viewport,initScript:script,blockedUrls:['https://api.deepseek.com/*','http://localhost:3000/*','http://127.0.0.1:3000/*']});
  const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-2000));
 }
 assert.deepEqual(snapshot(),stable,'viewing history never changes original evidence or progress');
},{legacy:false}));
