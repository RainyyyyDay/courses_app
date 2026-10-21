// Normal website DOM; fictional records in a temporary DB, no real AI or user files.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');
test('unified content cards open details without duplicate View or AI buttons',{timeout:90000},async()=>fixture(async({base,api,ids,temp,serve,snapshot})=>{
  const course=ids.courseId,rows={};
  for(const [type,plural]of [['material','materials'],['note','notes'],['mistake','mistakes']]){
    rows[type]=await api('POST',`/courses/${course}/${plural}`,{title:'统一卡片 '+type+' 较长标题用于验证手机自动换行与操作区域保持独立',content:'学习内容摘要。\n用于点击、键盘和按钮互不干扰测试。',answerContent:'参考答案',mistakeType:'knowledge',questionFormat:'open'},201);
  }
  const before=snapshot(),url=await serve(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
  for(const [index,viewport]of [[1280,960],[390,844]].entries()){
    const initScript=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
 const rows=${JSON.stringify(rows)},out=document.createElement('pre');out.id='regressionResult';
 const check=(v,m)=>{if(!v)throw Error(m);},el=id=>document.getElementById(id);
 const wait=async(fn)=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('waiting for card UI');};
 const card=type=>document.querySelector('[data-'+type+'-id="'+rows[type].id+'"].content-card');
 const show=async type=>{await openCourse(${course},'统一卡片测试',type==='material'?'materials':type==='note'?'notes':'mistakes');
   if(type==='mistake')await openMistakeCategory('knowledge');else if(type==='material')await loadMaterials();else await loadNotes();await wait(()=>card(type));return card(type);};
 const detail=async type=>{await wait(()=>type==='mistake'?currentView.type==='mistake'&&mistakeDetailState?.id===rows[type].id&&mistakeDetailState.row?.content===rows[type].content:
   currentView.type==='resource'&&resourceAiState?.type===type&&resourceAiState.id===rows[type].id);};
 try{
  const styles=[];
  for(const type of ['material','note','mistake']){
   let row=await show(type);const actions=row.querySelector('.mistake-actions');
   check(row.classList.contains('card-openable')&&row.getAttribute('role')==='link'&&row.tabIndex===0,'whole card is keyboard-accessible: '+type);
   check(actions.querySelectorAll('button').length===3&&!actions.textContent.includes('AI')&&!actions.textContent.includes('查看'),'only favorite, edit, delete on card: '+type);
   const css=getComputedStyle(row),title=getComputedStyle(row.querySelector('.title')),buttons=getComputedStyle(actions);
   styles.push(JSON.stringify([css.padding,css.borderRadius,css.alignItems,title.fontSize,title.fontWeight,buttons.gap,buttons.justifyContent]));
   check(document.documentElement.scrollWidth<=innerWidth+1,'long cards fit screen: '+type);
   row.click();await detail(type);
   if(type==='mistake'){el('mistakeAiToggle').click();check(!el('mistakeAiPanel').hidden&&el('mistakeAiToggle').textContent==='AI 复习建议','mistake AI remains in detail');resetMistakeAi();}
   else {const details=el('resourceAiPanel').querySelector('details');details.querySelector('summary').click();check(details.open,'resource AI remains in detail: '+type);}
   row=await show(type);row.focus();row.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await detail(type);
   row=await show(type);row.focus();const space=new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true});row.dispatchEvent(space);check(space.defaultPrevented,'Space does not scroll');await detail(type);
   row=await show(type);const view=currentView,edit=[...row.querySelectorAll('.mistake-actions button')].find(b=>b.textContent==='编辑');
   edit.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));check(currentView===view,'child key does not open card: '+type);edit.click();
   await wait(()=>type==='mistake'?el('mistakeEditModal').classList.contains('show'):el('tagPickerModal').classList.contains('show'));
   check(currentView===view,'edit does not navigate: '+type);if(type==='mistake')closeMistakeEdit();else closeTagPicker();
   row=await show(type);const previous=currentView;
   [...row.querySelectorAll('.mistake-actions button')].find(b=>b.textContent==='删除').click();await wait(()=>el('confirmModal').classList.contains('show'));
   check(currentView===previous,'delete opens confirmation, not card: '+type);el('confirmModal').querySelector('.btn-cancel').click();
   row=await show(type);const browsing=currentView,star=row.querySelector('.reading-favorite');const wanted=star.getAttribute('aria-pressed')!=='true';star.click();
   await wait(()=>card(type)?.querySelector('.reading-favorite').getAttribute('aria-pressed')===String(wanted));check(currentView===browsing,'favorite never opens detail: '+type);
  }
  check(styles.every(s=>s===styles[0]),'shared spacing, type and mobile action layout across all three lists');
  await show('mistake');const browsing=currentView;await enterMistakeReviewFromHome();await openMistakeReviewCategory('knowledge');
  let selected=card('mistake');check(selected.classList.contains('mistake-selectable')&&!selected.classList.contains('card-openable'),'review selection does not become navigation');
  selected.click();check(mistakeSelection.ids.has(rows.mistake.id)&&currentView===browsing,'selection card still selects');
  selected.querySelector('input[type=checkbox]').click();check(!mistakeSelection.ids.has(rows.mistake.id)&&currentView===browsing,'checkbox changes selection once');
  await closeMistakeReviewPicker();mistakeSelection=null;await show('mistake');
  out.dataset.result='passed';out.textContent='passed';
 }catch(e){out.dataset.result='failed';out.textContent=e.stack;}document.body.append(out);
});`;
    const html=await runBrowser({chrome,profile:path.join(temp,'cards-'+index),url,viewport,initScript,
      blockedUrls:['https://api.deepseek.com/*','http://localhost:3000/*','http://127.0.0.1:3000/*'],screenshot:path.join(os.tmpdir(),'courses-content-cards-'+viewport.join('x')+'.png')});
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-2000));
  }
  assert.deepEqual(snapshot(),before,'card navigation/actions do not alter review grades, sessions or plans');
},{legacy:false}));
