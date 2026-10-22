const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');
test('review record rename persists only its name with validation and course isolation',{timeout:60000},async()=>fixture(async({api,ids,snapshot,restart})=>{
  const c=ids.courseId,p='/courses/'+c,note=await api('POST',p+'/notes',{title:'重命名测试',content:'正文'},201);
  let session=await api('POST',p+'/review-sessions',{requestId:'rename-session',sourceType:'total',selectedItems:[{type:'note',id:note.id}]},201);
  const other=await api('POST','/courses',{name:'隔离课程'},201),url=p+'/review-sessions/'+session.id+'/name';
  await api('PATCH','/courses/'+other.id+'/review-sessions/'+session.id+'/name',{name:'越权',expectedName:session.name},404);
  for(const name of ['', '   ', 'a'.repeat(101), '跨\n行'])await api('PATCH',url,{name,expectedName:session.name},400);
  await api('PATCH',url,{name:'正常',expectedName:session.name,status:'completed'},400);
  for(const status of ['active','paused','completed']){
    if(status==='paused')session=await api('POST',p+'/review-sessions/'+session.id+'/pause',{});
    if(status==='completed'){await api('POST',p+'/review-sessions/'+session.id+'/items/'+session.items[0].id+'/skip',{});session=await api('POST',p+'/review-sessions/'+session.id+'/finish',{});}
    const before=snapshot(),renamed=await api('PATCH',url,{name:'  自定义 '+status+'  ',expectedName:session.name});
    assert.equal(renamed.name,'自定义 '+status);assert.deepEqual({...renamed,name:session.name},session);
    const after=snapshot();after.review_sessions.find(r=>r.id===session.id).name=before.review_sessions.find(r=>r.id===session.id).name;assert.deepEqual(after,before,'only name changes; timestamps, grades, events and plans remain identical');
    await api('PATCH',url,{name:'过期覆盖',expectedName:session.name},409);session=renamed;
  }
  await restart();assert.equal((await api('GET',p+'/review-sessions/'+session.id)).name,session.name);
},{legacy:false}));

test('review history rename works in real desktop and mobile lists',{timeout:90000},async()=>fixture(async({base,ids,temp,serve,snapshot})=>{
  const url=await serve(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
  for(const [index,viewport]of [[1280,960],[390,844]].entries()){
    const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
 const out=document.createElement('pre');out.id='regressionResult';const el=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};
 try{
  await openCourse(${ids.courseId},'重命名测试','notes');
  const row=await(await requestApi(API+'/courses/'+${ids.courseId}+'/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'记录${index}',content:'正文'})})).json();
  const record=await createReviewRecord('total',[{type:'note',id:row.id}]);await openReviewHistory();
  const button=el('reviewHistoryList').querySelector('[data-review-rename="'+record.id+'"]');check(button,'history has rename entry');button.focus();await openReviewRename(record.id);
  check(el('reviewRenameInput').value===record.name,'current name prefilled');el('reviewRenameInput').value='取消不保存';closeReviewRename();
  check(document.activeElement===button&&el('reviewHistoryList').textContent.includes(record.name),'cancel keeps name and returns focus');
  await openReviewRename(record.id);el('reviewRenameInput').value=' ';await saveReviewRename();check(el('reviewRenameDialog').open&&el('reviewRenameError').textContent,'blank rejected without closing');
  el('reviewRenameInput').value='我的阶段复习${index}';const original=requestApi;
  try{requestApi=async(url,options)=>{if(options?.method==='PATCH')throw Error('模拟失败');return original(url,options);};await saveReviewRename();}finally{requestApi=original;}
  check(el('reviewRenameDialog').open&&el('reviewRenameInput').value==='我的阶段复习${index}','failure keeps edited name');
  await Promise.all([saveReviewRename(),saveReviewRename()]);check(!el('reviewRenameDialog').open&&el('reviewHistoryList').textContent.includes('我的阶段复习${index}'),'save closes and updates original list');
  await loadReviewHistory();check(el('reviewHistoryList').textContent.includes('我的阶段复习${index}'),'name persists on reload');
  await openReviewSessionDetail(record.id);check(el('reviewSessionDetailBody').textContent.includes('我的阶段复习${index}')&&el('reviewSessionDetailBody').querySelector('[data-review-rename]'),'detail uses same name and supports rename');
  await openReviewRename(record.id);el('reviewRenameInput').value='<img src=x>复习';await saveReviewRename();check(!el('reviewSessionDetailBody').querySelector('h3 img')&&el('reviewSessionDetailBody').textContent.includes('<img src=x>复习'),'custom title is text, not HTML');
  await openCourse(${ids.courseId},'重命名测试','reviewPlans');await loadRecentReviews();check(el('reviewRecentList').textContent.includes('<img src=x>复习')&&el('reviewRecentList').querySelector('[data-review-rename]'),'recent records also reflect persisted rename');
  check(document.documentElement.scrollWidth<=innerWidth+1,'mobile fits');out.dataset.result='passed';out.textContent='passed';
 }catch(e){out.dataset.result='failed';out.textContent=e.stack;}document.body.append(out);
});`;
    const html=await runBrowser({chrome,profile:path.join(temp,'rename-'+index),url,viewport,initScript:script,blockedUrls:['https://api.deepseek.com/*','http://localhost:3000/*','http://127.0.0.1:3000/*']});
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-1800));
  }
  const state=snapshot();assert.equal(state.review_item_events.length,0);assert.equal(state.review_plan_items.length,0);
},{legacy:false}));
