const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs');
const {runBrowser}=require('./browser-driver.cjs');
const vm=require('node:vm');

test('completion action mode switches plan and free-review buttons',()=>{
  const elements={
    reviewCompleteReplay:{classList:{values:new Set(),toggle(name,on){on?this.values.add(name):this.values.delete(name);}},textContent:''},
    reviewCompleteStartNew:{hidden:false},
  };
  const context=vm.createContext({document:{getElementById:id=>elements[id]||null}});
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../fronted/js/mistakeQueue.js'),'utf8'),context);
  context.configureReviewCompleteActions('plan');
  assert.equal(elements.reviewCompleteStartNew.hidden,true);
  assert.equal(elements.reviewCompleteReplay.classList.values.has('btn-primary'),true);
  context.configureReviewCompleteActions('total');
  assert.equal(elements.reviewCompleteStartNew.hidden,false);
  assert.equal(elements.reviewCompleteReplay.classList.values.has('btn-primary'),false);
});

test('completion actions stay on one row and plan mode removes free review',{timeout:120000},async()=>{
  await fixture(async({ids,temp,serve,base})=>{
    const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    assert.ok(chrome);
    const url=await serve();
    for(const [index,viewport]of [[1280,960],[390,844]].entries()){
      const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
        const out=document.createElement('pre');out.id='regressionResult';
        const check=(value,message)=>{if(!value)throw Error(message);};
        const visible=()=>[...document.querySelectorAll('#mistakeCompleteModal .modal-actions button')].filter(button=>!button.hidden);
        const session={id:999,status:'completed',total:1,passed:1,failed:0,skipped:0,exposed:0,items:[{item_type:'material'}]};
        try{
          await openCourse(${ids.courseId},'完成弹窗测试','materials');
          await openReviewCompleteModal(session,{type:'total'});
          check(visible().length===3&&new Set(visible().map(button=>Math.round(button.getBoundingClientRect().top))).size===1,'total review actions use one row');
          closeReviewCompleteModal();
          await openReviewCompleteModal(session,{type:'plan',planId:1,date:'2026-10-26'});
          const replay=document.getElementById('reviewCompleteReplay');
          check(visible().length===2&&document.getElementById('reviewCompleteStartNew').hidden,'plan mode removes free review');
          check(replay.classList.contains('btn-primary')&&replay.textContent.trim()==='再来一遍','plan replay is blue');
          check(new Set(visible().map(button=>Math.round(button.getBoundingClientRect().top))).size===1,'plan actions use one row');
          closeReviewCompleteModal();out.textContent='PASS';document.body.append(out);
        }catch(error){out.textContent='FAIL '+error.stack;document.body.append(out);}
      });`;
      const html=await runBrowser({chrome,profile:path.join(temp,'complete-layout-'+index),url,viewport,noSandbox:true,initScript:script});
      const result=html.match(/<pre id="regressionResult">[\s\S]*?<\/pre>/)?.[0];
      assert.match(result||'',/>PASS</,result||html.slice(-2000));
    }
  });
});
