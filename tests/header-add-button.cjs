const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');
test('header add icons remain centered and open the correct controls',{timeout:90000},async()=>fixture(async({ids,temp,serve,base})=>{
 const url=await serve(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);assert.ok(chrome);
 for(const [i,viewport]of [[1280,960],[390,844]].entries()){
  const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';const check=(v,m)=>{if(!v)throw Error(m);};const centered=b=>{const r=b.getBoundingClientRect(),s=b.querySelector('svg').getBoundingClientRect();check(r.width===r.height&&r.width>=36,'square add target');check(Math.abs(r.x+r.width/2-s.x-s.width/2)<1&&Math.abs(r.y+r.height/2-s.y-s.height/2)<1,'plus exactly centered');check(getComputedStyle(b).padding==='0px','no text-button padding');};try{
   const home=document.querySelector('#listPage .add-btn');centered(home);home.click();check(document.getElementById('courseModal').classList.contains('show'),'home opens add course');closeCourseModal();
   await openCourse(${ids.courseId},'加号测试','knowledge');const tree=document.getElementById('treeBtn');centered(tree);const r=tree.getBoundingClientRect();tree.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));check(document.getElementById('addMenu').classList.contains('show'),'tree opens content menu');closeAddMenu();
   await switchTab('notes');check(!tree.getClientRects().length,'tree add absent in other tabs');await switchTab('knowledge');centered(tree);check(document.documentElement.scrollWidth<=innerWidth+1,'no horizontal overflow');out.textContent='PASS';
  }catch(e){out.textContent='FAIL '+e.stack;}document.body.append(out);});`;
  const html=await runBrowser({chrome,profile:path.join(temp,'header-add-'+i),url,viewport,noSandbox:true,initScript:script});const result=html.match(/<pre id="regressionResult">[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/>PASS</,result||'no result');
 }
},{legacy:false}));
