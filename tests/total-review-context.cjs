// Normal website, real local HTTP and temporary fictional DB. No real AI/user data.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');
test('total review follows the current large tab without preselecting items or mistake categories',{timeout:90000},async()=>fixture(async({base,api,ids,temp,serve,snapshot})=>{
  const c=ids.courseId,rows={};
  for(const [type,plural]of [['material','materials'],['note','notes'],['mistake','mistakes']])rows[type]=await api('POST',`/courses/${c}/${plural}`,
    {title:type+'导航测试',content:'测试正文',answerContent:'参考答案',mistakeType:'execution',questionFormat:'open'},201);
  const before=snapshot(),url=await serve();
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
  for(const [index,viewport]of [[1280,960],[390,844]].entries()){
    const initScript=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
 const out=document.createElement('pre');out.id='regressionResult';const rows=${JSON.stringify(rows)},el=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('waiting for total review');};
 try{
  const tabs=[...document.querySelectorAll('#detailPage .dtab')],expectedTabs=[['materials','资料'],['notes','笔记'],['mistakes','错题'],['reviewPlans','复习'],['assessments','考核'],['knowledge','知识框架']];
  check(JSON.stringify(tabs.map(t=>t.textContent.trim()))===JSON.stringify(expectedTabs.map(t=>t[1])),'agreed six-tab order');
  await openCourse(${c},'页签顺序测试');
  for(const [i,[tab,label]]of expectedTabs.entries()){tabs[i].click();check(currentView.tab===tab&&tabs[i].classList.contains('active')&&el('pane-'+tab).classList.contains('active')&&localStorage.getItem('currentTab')===tab,'original navigation and page memory remain correct: '+label);}
  await openCourse(${c},'页签恢复测试','mistakes');check(currentView.tab==='mistakes'&&tabs[2].classList.contains('active'),'restored tab uses identity, not old position');
  for(const [source,expected]of [['mistakes','mistake'],['materials','material'],['notes','note'],['mistakes','mistake']]){
   await openCourse(${c},'总复习导航测试',source);
   if(source==='mistakes')await openMistakeCategory('execution');
   // A stale storage value must not override the actual page the user is on.
   localStorage.setItem('currentTab',source==='materials'?'notes':'materials');
   const view=currentView;el('totalReviewOpen').click();await wait(()=>totalReviewState&&!totalReviewState.loading);
   check(totalReviewState.tab===expected,'correct default tab from '+source);
   check(el('totalReviewTab-'+expected).getAttribute('aria-selected')==='true','visible selected tab matches state');
   check(totalReviewState.ids.size===0&&el('totalReviewStart').disabled&&!totalReviewState.preview,'nothing selected, previewed or started');
   check(currentView===view&&!centerReview,'source page unchanged and no session started');
   check(totalReviewState.filters.mistake.category===''&&el('totalReviewMistakeType').value==='','does not inherit specific mistake category');
   check(totalReviewState.filters[expected].q===''&&!totalReviewState.filters[expected].favorite,'does not copy browse filters');
   const key=expected+':'+rows[expected].id,checkbox=document.querySelector('[data-total-choice="'+key+'"]');check(checkbox,'correct content list visible');checkbox.click();
   check(totalReviewState.ids.has(key),'manual selection still works');const other=expected==='material'?'note':'material';el('totalReviewTab-'+other).click();
   check(totalReviewState.tab===other&&totalReviewState.ids.has(key),'manual module switch preserves explicit selection');el('totalReviewTab-'+expected).click();
   check(document.querySelector('[data-total-choice="'+key+'"]').checked,'returning preserves explicit checkbox');
   closeTotalReview();check(currentView===view&&!totalReviewState,'close returns to unchanged large page');
  }
  switchTab('assessments');el('totalReviewOpen').click();await wait(()=>totalReviewState&&!totalReviewState.loading);
  check(totalReviewState.tab==='material'&&totalReviewState.ids.size===0,'other pages retain original material fallback');closeTotalReview();
  switchTab('notes');el('totalReviewOpen').click();await wait(()=>totalReviewState&&!totalReviewState.loading);
  check(totalReviewState.tab==='note'&&totalReviewState.ids.size===0,'reopening uses latest page, not last total-review tab or selection');
  check(document.documentElement.scrollWidth<=innerWidth+1,'fits mobile viewport');out.dataset.result='passed';out.textContent='passed';
 }catch(e){out.dataset.result='failed';out.textContent=e.stack;}document.body.append(out);
});`;
    const html=await runBrowser({chrome,profile:path.join(temp,'context-'+index),url,viewport,initScript,
      blockedUrls:['https://api.deepseek.com/*','http://localhost:3000/*','http://127.0.0.1:3000/*'],screenshot:path.join(os.tmpdir(),'courses-total-review-context-'+viewport.join('x')+'.png')});
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-2000));
  }
  assert.deepEqual(snapshot(),before,'opening/switching total review creates no sessions, grades, progress or plans');
},{legacy:false}));
