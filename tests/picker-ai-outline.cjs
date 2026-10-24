const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs');
const {runBrowser}=require('./browser-driver.cjs');

test('AI outline uses editable body, preserves edits and saves only on confirmation',{timeout:120000},async()=>{
 await fixture(async({api,ids,temp,serve,base})=>{
  const row=await api('POST','/courses/'+ids.courseId+'/materials',{title:'大纲测试',content:'原始正文',outline:''},201);
  const note=await api('POST','/courses/'+ids.courseId+'/notes',{title:'笔记大纲',content:'笔记正文',outline:''},201);
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const pageUrl=await serve();
  for(const viewport of [[1280,960],[390,844]]){
   const initScript=`window.COURSES_API_BASE=${JSON.stringify(base)};window.COURSES_AI_API_BASE=${JSON.stringify(pageUrl.replace(/\/$/,'')+'/api')};addEventListener('load',async()=>{
    const out=document.createElement('pre');out.id='regressionResult';
    const check=(ok,label)=>{if(!ok)throw Error(label);};
    const wait=async(fn)=>{for(let i=0;i<350;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('wait expired');};
    try{
     await wait(()=>typeof allcourses!=='undefined'&&allcourses.some(c=>c.id===${ids.courseId}));
     await openCourse(${ids.courseId},'测试','materials');await loadMaterials();
     await openTagPicker('edit','material',${row.id});
     const el=id=>document.getElementById(id),button=el('tagPickerOutlineGen'),status=el('tagPickerOutlineStatus'),body=el('tagPickerResourceContent'),outline=el('tagPickerOutline');
     check(button.disabled,'requires AI credentials');
     const configure=()=>coursesAiSettings.configure({provider:'deepseek',preset:'deepseek',model:'deepseek-flash',apiKey:'synthetic-test-only',consent:true,retain:true,auto:false,baseUrl:''});
     configure();check(!button.disabled,'enabled after configuration');
     button.scrollIntoView({block:'center'});const rect=button.getBoundingClientRect();check(rect.left>=0&&rect.right<=innerWidth,'outline action fits viewport');
     const realFetch=fetch;let requests=[],defer=null,fail=false;
     fetch=(url,options={})=>{
      if(!String(url).endsWith('/api/ai/outline-polish'))return realFetch(url,options);
      requests.push(JSON.parse(options.body));
      const response=()=>new Response(JSON.stringify(fail?{error:'AI_UNAVAILABLE'}:{provider:'deepseek',result:{title:'大纲',outline:'- 核心内容\\n  - 重点',needs_review:true}}),{status:fail?502:200,headers:{'Content-Type':'application/json'}});
      if(defer)return new Promise(resolve=>{defer=()=>resolve(response());});
      return Promise.resolve(response());
     };
     window.confirm=()=>true;
     body.value='';await generatePickerOutline();check(requests.length===0&&status.textContent.includes('填写正文'),'empty body blocked');
     body.value='字'.repeat(20001);await generatePickerOutline();check(requests.length===0,'oversized body blocked');
     const before=await (await realFetch(${JSON.stringify(base+'/materials/'+row.id)})).json();
     body.value='当前修改后的正文';outline.value='';
     defer=true;const generating=generatePickerOutline();check(button.disabled&&button.getAttribute('aria-busy')==='true','visible pending state');
     defer();defer=null;await generating;
     check(requests[0].purpose==='outline_draft'&&requests[0].input.text==='当前修改后的正文','uses live editable content');
     check(outline.value.startsWith('- 核心内容')&&status.textContent.includes('保存后生效'),'editable draft and success notice');
     const saved=await (await realFetch(${JSON.stringify(base+'/materials/'+row.id)})).json();
     check(saved.outline===before.outline,'request never saves by itself');
     const count=requests.length;window.confirm=()=>false;await generatePickerOutline();check(requests.length===count,'overwrite can be cancelled');
     window.confirm=()=>true;fail=true;await generatePickerOutline();check(outline.value.startsWith('- 核心内容')&&status.textContent.includes('原大纲已保留'),'failure preserves outline');fail=false;
     defer=true;const edited=generatePickerOutline();outline.value='用户正在修改';defer();defer=null;await edited;check(outline.value==='用户正在修改','does not overwrite concurrent edits');
     defer=true;const closed=generatePickerOutline();closeTagPicker();await openCourse(${ids.courseId},'测试','notes');await loadNotes();await openTagPicker('edit','note',${note.id});outline.value='新弹窗内容';defer();defer=null;await closed;check(outline.value==='新弹窗内容','old response cannot affect reopened dialog');
     outline.value='';await generatePickerOutline();check(requests.at(-1).input.text==='笔记正文','notes supported');
     closeTagPicker();await openTagPicker('upload','note',null);body.value='上传附件后填入的正文';outline.value='';await generatePickerOutline();check(requests.at(-1).input.text===body.value,'upload supported');
     closeTagPicker();pendingManual={content:'旧正文',title:'手动笔记'};await openTagPicker('manual','note',null);body.value='手动编辑最新正文';outline.value='';await generatePickerOutline();check(requests.at(-1).input.text===body.value,'manual uses current body');
     closeTagPicker();await openCourse(${ids.courseId},'测试','materials');await loadMaterials();await openTagPicker('edit','material',${row.id});body.value='原始正文';outline.value='';await generatePickerOutline();await confirmTagPicker();
     const final=await (await realFetch(${JSON.stringify(base+'/materials/'+row.id)})).json();check(final.outline==='- 核心内容\\n  - 重点','confirmation persists generated outline');
     for(const kind of ['material','note']){
      for(const mode of ['manual','upload']){
       const title='保存回显-'+kind+'-'+mode;
       pendingManual={type:kind,title,content:'测试正文'};
       await openTagPicker(mode,kind,null);
       el('tagPickerName').value=title;body.value='测试正文';outline.value='- 保存的大纲';
       pendingMindmapJson=JSON.stringify(outlineToMindmap(outline.value,title));
       await confirmTagPicker();
       check(!tagPickerState,'creation closes only after saving');
       let rows=kind==='note'?currentNotes:currentMaterials;
       let created=rows.find(r=>r.title===title);check(created,'created record');
       const id=created.id;
       await openTagPicker('edit',kind,id);
       check(outline.value==='- 保存的大纲'&&JSON.parse(pendingMindmapJson).nodes.length,'creation reopens with outline and map');
       outline.value='- 编辑后的大纲';pendingMindmapJson=JSON.stringify(outlineToMindmap(outline.value,'新的中心主题'));
       await confirmTagPicker();
       await openTagPicker('edit',kind,id);
       check(outline.value==='- 编辑后的大纲'&&JSON.parse(pendingMindmapJson).title==='新的中心主题','immediate reopen sees new outline and map');
       closeTagPicker();
       if(kind==='note')await loadNotes();else await loadMaterials();
       await openTagPicker('edit',kind,id);
       check(outline.value==='- 编辑后的大纲'&&JSON.parse(pendingMindmapJson).title==='新的中心主题','server reload preserves outline and map');
       closeTagPicker();
      }
     }
     out.dataset.result='passed';
    }catch(e){out.dataset.result='failed';out.textContent=e.stack;}document.body.append(out);
   });`;
   const html=await runBrowser({chrome,profile:path.join(temp,'outline-'+viewport[0]),url:pageUrl,viewport,noSandbox:true,initScript,timeoutMs:55000});
   const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];
   assert.match(result||'',/data-result="passed"/,result||html.slice(-2000));
  }
 });
});
