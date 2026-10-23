const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs');
const {runBrowser}=require('./browser-driver.cjs');

test('all tag dialogs start fully collapsed and expand one level at a time',{timeout:120000},async()=>{
  await fixture(async({api,base,ids,temp,serve})=>{
    const coursePath='/courses/'+ids.courseId;
    const root=await api('POST',coursePath+'/knowledge-nodes',{name:'根分类',type:'folder'},201);
    const nested=await api('POST',coursePath+'/knowledge-nodes',{name:'二级分类',type:'folder',parentId:root.id},201);
    const leaf=await api('POST',coursePath+'/knowledge-nodes',{name:'深层知识点',type:'knowledge',parentId:nested.id},201);
    await api('POST',coursePath+'/knowledge-nodes',{name:'一级知识点',type:'knowledge',parentId:root.id},201);
    await api('POST',coursePath+'/knowledge-nodes',{name:'另一根节点',type:'knowledge'},201);
    const material=await api('POST',coursePath+'/materials',{title:'折叠树资料',content:'正文'},201);
    const form=new FormData();
    form.append('title','折叠树错题');
    form.append('content','题目');
    form.append('mistakeType','knowledge');
    form.append('knowledgeIds','[]');
    const mistakeResponse=await fetch(base+coursePath+'/mistakes',{method:'POST',body:form});
    if(mistakeResponse.status!==201)throw new Error('mistake fixture failed: '+mistakeResponse.status+' '+await mistakeResponse.text());
    const mistake=await mistakeResponse.json();
    const browser=['C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    assert.ok(browser);
    const pageUrl=await serve();

    for(const viewport of [[1280,960],[390,844]]){
      const initScript=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
        const out=document.createElement('pre');out.id='regressionResult';
        const check=(value,message)=>{if(!value)throw Error(message);};
        const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('waiting: '+label);};
        const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>resolve()));
        try{
          await wait(()=>typeof allcourses!=='undefined'&&allcourses.some(course=>course.id===${ids.courseId}),'courses');
          await openCourse(${ids.courseId},'折叠树测试','materials');
          await loadMaterials();
          await openTagPicker('edit','material',${material.id});
          const shared=document.getElementById('tagPickerTree');
          check(shared.querySelector('.tag-tree-root-toggle')&&!shared.querySelector('.tag-label'),'shared picker starts with one collapsed bar');
          shared.querySelector('.tag-tree-root-toggle').click();
          check(shared.textContent.includes('根分类')&&shared.textContent.includes('另一根节点')
            &&!shared.textContent.includes('二级分类')&&!shared.textContent.includes('深层知识点'),'root shows all first-level nodes only');
          shared.querySelector('.tag-toggle[data-tag-id="${root.id}"]').click();
          check(shared.textContent.includes('二级分类')&&shared.textContent.includes('一级知识点')
            &&!shared.textContent.includes('深层知识点'),'folder shows its immediate children only');
          shared.querySelector('.tag-toggle[data-tag-id="${nested.id}"]').click();
          check(!!document.getElementById('tagchk-${leaf.id}'),'nested folder reveals deeper knowledge point');
          closeTagPicker();

          await openTagPicker('edit','material',${material.id});
          check(document.querySelector('#tagPickerTree .tag-tree-root-toggle')&&!document.querySelector('#tagPickerTree .tag-label'),'shared picker resets to fully collapsed on reopen');
          const search=document.getElementById('tagPickerSearch');
          search.value='深层知识点';search.dispatchEvent(new Event('input'));
          await nextFrame();
          check(!!document.getElementById('tagchk-${leaf.id}'),'search auto expands the matching path');
          closeTagPicker();

          await loadMistakes();
          await editMistakeFromList(${mistake.id});
          await wait(()=>document.querySelector('#mistakeEditTagTree .edit-tag-root-toggle'),'mistake edit tree');
          const editTree=document.getElementById('mistakeEditTagTree');
          check(!editTree.querySelector('.edit-tag-name'),'mistake editor starts with one collapsed bar');
          check(!document.querySelector('[onclick="toggleAllMistakeEditTags(true)"]'),'old expand-all control is removed');
          editTree.querySelector('.edit-tag-root-toggle').click();
          check(editTree.textContent.includes('根分类')&&editTree.textContent.includes('另一根节点')
            &&!editTree.textContent.includes('二级分类'),'mistake root expands first level only');
          editTree.querySelector('.edit-tag-toggle[data-tag-id="${root.id}"]').click();
          check(editTree.textContent.includes('二级分类')&&!document.getElementById('mistake-edit-tagchk-${leaf.id}'),'mistake folder expands one more level only');
          editTree.querySelector('.edit-tag-toggle[data-tag-id="${nested.id}"]').click();
          check(!!document.getElementById('mistake-edit-tagchk-${leaf.id}'),'mistake nested folder reveals leaf');
          closeMistakeEdit();
          await editMistakeFromList(${mistake.id});
          await wait(()=>document.querySelector('#mistakeEditTagTree .edit-tag-root-toggle'),'mistake edit reopen');
          check(!document.querySelector('#mistakeEditTagTree .edit-tag-name'),'mistake editor resets to fully collapsed on reopen');
          closeMistakeEdit();
          out.dataset.result='passed';
        }catch(error){out.dataset.result='failed';out.textContent=error.stack;}
        document.body.append(out);
      });`;
      const html=await runBrowser({
        chrome:browser,
        profile:path.join(temp,'tag-tree-'+viewport.join('x')),
        url:pageUrl,
        viewport,
        noSandbox:true,
        initScript,
      });
      const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];
      assert.match(result||'',/data-result="passed"/,result||html.slice(-3000));
    }
  });
});
