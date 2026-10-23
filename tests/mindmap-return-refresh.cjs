const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs');
const {runBrowser}=require('./browser-driver.cjs');

test('returning from the mindmap refreshes the open resource without navigation', {timeout:60000}, async()=>{
  await fixture(async({api,ids,temp,serve,base})=>{
    const row=await api('POST','/courses/'+ids.courseId+'/materials',{
      title:'导图自动刷新测试',content:'正文',outline:'- 旧节点'
    },201);
    const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    assert.ok(chrome);
    const initScript=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
      const out=document.createElement('pre');out.id='regressionResult';
      const check=(value,message)=>{if(!value)throw Error(message);};
      const wait=async(fn,label)=>{for(let i=0;i<250;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('waiting: '+label);};
      try{
        await wait(()=>typeof allcourses!=='undefined'&&allcourses.some(course=>course.id===${ids.courseId}),'courses');
        await openCourse(${ids.courseId},'复习方式测试','materials');
        await openResourceDetail('material',${row.id});
        window.open=()=>null;
        await wait(()=>window.__mindmapTarget?.baseline,'mindmap target baseline');
        const navigationDepth=navStack.length;
        const map={id:'courses-return-test',title:'导图自动刷新测试',nodes:[{id:'n1',text:'更新后的根节点',children:[{id:'n2',text:'自动刷新成功',children:[]}]}],pos:{},size:{},edges:[],v:3};
        await requestApi(API+'/courses/${ids.courseId}/materials/${row.id}/mindmap',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({mindmapJson:JSON.stringify(map),mindmapImage:''})});
        window.dispatchEvent(new Event('focus'));
        await wait(()=>OUTLINE_MAP.current.includes('自动刷新成功'),'updated map rendered');
        check(currentView.type==='resource'&&currentView.id===${row.id},'focus refresh keeps the current resource page');
        check(navStack.length===navigationDepth,'focus refresh does not push navigation history');
        check([...document.querySelectorAll('.toast')].some(node=>node.textContent.includes('导图已自动更新')),'automatic update is visible');
        out.dataset.result='passed';out.textContent='passed';
      }catch(error){out.dataset.result='failed';out.textContent=error.stack;}
      document.body.append(out);
    });`;
    const html=await runBrowser({chrome,profile:path.join(temp,'mindmap-return-refresh'),url:await serve(),viewport:[1280,960],noSandbox:true,initScript,
      blockedUrls:['https://api.deepseek.com/*','http://localhost:3000/*','http://127.0.0.1:3000/*']});
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];
    assert.match(result||'',/data-result="passed"/,result||html.slice(-2500));
  });
});
