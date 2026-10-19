// Real normal website + isolated Node/SQLite fixtures + actual FastAPI mock.
// No original data/uploads/.env are copied. Uses random loopback ports.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const {runBrowser}=require('./browser-driver.cjs');
const root=path.resolve(__dirname,'..');

async function freePort() {
  const probe=net.createServer();
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  return port;
}
async function stop(child) {
  if(child && child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
}
async function ready(url,child,logs) {
  const deadline=Date.now()+15000;
  while(Date.now()<deadline && child.exitCode===null){
    try{if((await fetch(url,{signal:AbortSignal.timeout(500)})).ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.fail('Service failed: '+logs());
}

function normalWebsiteScenario(courseId,mistakeId,nodePort) {
  return `window.COURSES_API_BASE='http://127.0.0.1:${nodePort}/api';window.addEventListener('load',async()=>{
    const check=(ok,message)=>{if(!ok)throw Error(message);};
    const wait=async(predicate,message)=>{for(let i=0;i<150;i++){if(predicate())return;await new Promise(r=>setTimeout(r,50));}throw Error(message);};
    const el=name=>document.getElementById('mistakeAi'+name);
    const card=()=>document.querySelector('#mistakeList [data-mistake-id="${mistakeId}"]');
    const result=document.createElement('pre');result.id='regressionResult';
    try {
      check(location.pathname==='/' && window.COURSES_AI_LOCAL_MOCK===true,'normal HTTP homepage with local config');
      await wait(()=>typeof allcourses!=='undefined' && allcourses.some(c=>c.id===${courseId}),'normal course API load');
      if(currentCourseId!==${courseId}){
        const courseEntry=document.querySelector('#courseList .course-name[onclick*="openCourse(${courseId},"]');
        check(courseEntry,'normal course entry exists');courseEntry.click();
      }
      switchTab('mistakes');await openMistakeCategory('knowledge');
      await wait(()=>card()?.querySelector('.mistake-ai-entry'),'normal list cards load');
      const before=await (await fetch(API+'/mistakes/${mistakeId}')).json();
      if(sessionStorage.getItem('http-ai-phase')!=='saved'){
        card().querySelector('.mistake-ai-entry').click();
        const dialog=document.getElementById('mistakeAiDialog'),body=document.getElementById('mistakeAiDialogBody');
        const bounds=dialog.getBoundingClientRect();
        check(Math.abs(bounds.left+bounds.width/2-innerWidth/2)<2 && Math.abs(bounds.top+bounds.height/2-innerHeight/2)<2,'real dialog centered');
        check(bounds.bottom<=innerHeight && bounds.right<=innerWidth && bounds.top>=0,'real dialog fits viewport');
        el('Question').style.height='1200px';
        const top=dialog.querySelector('header').getBoundingClientRect().top;
        const foot=document.getElementById('mistakeAiDialogFoot'),footTop=foot.getBoundingClientRect().top;
        body.scrollTop=body.scrollHeight;
        check(body.scrollTop>0 && dialog.querySelector('header').getBoundingClientRect().top===top,'internal scrolling keeps header');
        check(foot.getBoundingClientRect().top===footTop && foot.getBoundingClientRect().bottom<=innerHeight,'footer remains visible');
        el('Question').style.height='';
        el('StudentAnswer').value='3';el('ErrorType').value='careless';
        body.scrollTop=0;await requestMistakeAi();
        check(mistakeAiState.result?.review_method==='retry' && el('Reason').textContent.includes('Mock'),'actual HTTP result and reason shown');
        check(card().textContent.includes('暂无已保存的 AI 复习建议'),'unconfirmed HTTP result not saved');
        el('Method').value='guided';changeMistakeAiSuggestion();el('Confirm').click();
        check(!dialog.open && mistakeAiState===null && card().textContent.includes('引导练习'),'actual panel saves modified final choice and closes');
        resetMistakeAi();
        sessionStorage.setItem('http-ai-phase','saved');location.reload();return;
      }
      check(card().textContent.includes('引导练习'),'actual reload restores card');
      card().querySelector('.mistake-ai-entry').click();
      check(el('Method').value==='guided' && !mistakeAiState.result,'actual reload restores final choice without calling AI');
      resetMistakeAi();document.getElementById('totalReviewOpen').click();
      await wait(()=>totalReviewState && !totalReviewState.loading,'real total review candidates');
      switchTotalReviewTab('mistake');
      check(document.getElementById('totalReviewCandidates').textContent.includes('引导练习'),'real total review reads confirmed method');
      await openTotalReviewPreview('mistake:${mistakeId}');
      check(document.getElementById('totalReviewPreviewBody').textContent.includes('引导练习'),'real total preview includes method');
      closeTotalReviewPreview();closeTotalReview();
      const after=await (await fetch(API+'/mistakes/${mistakeId}')).json();
      check(before.mistake_type===after.mistake_type && before.review_status===after.review_status && before.review_revision===after.review_revision,'classification and progress unchanged');
      check(document.documentElement.scrollWidth<=innerWidth+1,'normal site no horizontal overflow');
      result.dataset.result='passed';result.textContent='normal homepage, real list POST, confirm, reload and total review passed';
    }catch(error){result.dataset.result='failed';result.textContent=error.stack;}
    document.body.append(result);
  });`;
}

test('normal website list to FastAPI over HTTP, confirm/reload/total review at desktop and mobile',{timeout:120000},async()=>{
  const nodePort=await freePort(),aiPort=await freePort();
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  assert.ok(chrome,'Chrome/Edge required');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'courses-real-ai-'));
  let node,python,nodeLog='',aiLog='';
  try {
    const backend=path.join(temp,'back');fs.mkdirSync(backend);
    // Explicit source allowlist; no personal files are traversed or opened.
    for(const file of ['server.js','aiProxy.js','db.js'])fs.copyFileSync(path.join(root,'back',file),path.join(backend,file));
    const serverPath=path.join(backend,'server.js');
    const serverSource=fs.readFileSync(serverPath,'utf8');
    assert.ok(serverSource.includes('app.listen(3000,'),'expected existing listener');
    fs.writeFileSync(serverPath,serverSource.replace('app.listen(3000,',`app.listen(${nodePort}, '127.0.0.1',`));
    for(const folder of ['db','ai'])fs.cpSync(path.join(root,'back',folder),path.join(backend,folder),{recursive:true,filter:source=>fs.statSync(source).isDirectory() || source.endsWith('.js')});
    const env={...process.env,NODE_PATH:path.join(root,'back/node_modules'),AI_PROVIDER:'mock',AI_ENABLE_REAL:'false',PYTHONPATH:path.join(root,'.local-ai-deps')};
    delete env.NODE_OPTIONS;delete env.NPM_CONFIG_NODE_OPTIONS;
    const seed=spawnSync(process.execPath,['-e',`const db=require('./db/index.js');const c=db.createCourse('真实 HTTP 隔离测试');const m=db.createMistake(c.id,'HTTP 测试错题','', '1+1=?','',[],{mistakeType:'knowledge',answerContent:'2',explanation:'虚构题目'});console.log(JSON.stringify({courseId:c.id,mistakeId:m.id}));db.db.close();`],{cwd:backend,env,encoding:'utf8',windowsHide:true});
    assert.equal(seed.status,0,seed.stderr);const fixture=JSON.parse(seed.stdout.trim());
    node=spawn(process.execPath,['server.js'],{cwd:backend,env,windowsHide:true});
    node.stdout.on('data',data=>{nodeLog+=data;});node.stderr.on('data',data=>{nodeLog+=data;});
    node.on('error',error=>{nodeLog+=error;});
    python=spawn('python',['-B','-m','uvicorn','test_app:app','--host','127.0.0.1','--port',String(aiPort),'--no-proxy-headers'],{cwd:path.join(root,'ai-fastapi'),env,windowsHide:true});
    python.stdout.on('data',data=>{aiLog+=data;});python.stderr.on('data',data=>{aiLog+=data;});python.on('error',error=>{aiLog+=error;});
    await Promise.all([ready(`http://127.0.0.1:${nodePort}/api/courses`,node,()=>nodeLog),ready(`http://127.0.0.1:${aiPort}/openapi.json`,python,()=>aiLog)]);
    for(const viewport of [[1280,960],[390,844]]){
      const html=await runBrowser({chrome,profile:path.join(temp,'profile-'+viewport[0]),url:`http://127.0.0.1:${aiPort}/`,viewport,
        blockedUrls:['http://localhost:3000/*','http://127.0.0.1:3000/*'],
        initScript:normalWebsiteScenario(fixture.courseId,fixture.mistakeId,nodePort)});
      const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];
      assert.match(result || '',/data-result="passed"/,result || html.slice(-3000));
    }
    assert.match(aiLog,/POST \/api\/ai\/classify HTTP\/1.1.*200/,'actual uvicorn access log must show successful POST');
  } finally {
    await Promise.all([stop(node),stop(python)]);
    // temp is the exact mkdtemp return value, confined to this test's output.
    fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});
