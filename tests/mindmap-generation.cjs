const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs');
const {runBrowser}=require('./browser-driver.cjs');

test('mind-map generation separates always-available basic splitting from real-AI polishing',{timeout:90000},async()=>{
  await fixture(async({api,ids,temp,serve,base})=>{
    const originalOutline='第一章 函数\n一、极限\n1. 定义';
    const row=await api('POST','/courses/'+ids.courseId+'/materials',{
      title:'导图生成测试',content:'正文',outline:originalOutline,
    },201);
    const browser=['C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    assert.ok(browser);
    const pageUrl=await serve();
    const initScript=`window.COURSES_API_BASE=${JSON.stringify(base)};window.COURSES_AI_API_BASE=${JSON.stringify(pageUrl.replace(/\/$/,'')+'/api')};addEventListener('load',async()=>{
      const out=document.createElement('pre');out.id='regressionResult';
      const check=(value,message)=>{if(!value)throw Error(message);};
      const wait=async(fn,label)=>{for(let i=0;i<350;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('waiting: '+label);};
      const opened=[];
      const readHandoff=async()=>{
        const target=new URL(opened.shift());
        const bridge=target.searchParams.get('bridge');
        const token=target.hash.replace(/^#handoff=/,'');
        const response=await fetch(bridge+'/'+encodeURIComponent(token));
        check(response.ok,'handoff response');return response.json();
      };
      try{
        await wait(()=>typeof allcourses!=='undefined'&&allcourses.some(course=>course.id===${ids.courseId}),'courses');
        await openCourse(${ids.courseId},'导图生成测试','materials');
        await openResourceDetail('material',${row.id});
        window.open=url=>{
          const editor={closed:false,close(){this.closed=true;},location:{replace(value){opened.push(value);}}};
          if(url)editor.location.replace(url);
          return editor;
        };
        const basic=document.querySelector('.open-mindmap-btn'),ai=document.querySelector('[data-mindmap-generate="ai"]');
        check(basic&&basic.textContent.includes('基础生成'),'basic button');
        check(ai&&ai.disabled,'AI disabled without a real API');

        basic.click();
        await wait(()=>opened.length===1,'basic handoff');
        const basicData=await readHandoff();
        check(basicData.outline==='- 第一章 函数\\n  - 极限\\n    - 定义','deterministic hierarchy');
        check(basicData.map===null,'basic generation opens a new map from a temporary outline');

        coursesAiSettings.configure({provider:'deepseek',preset:'deepseek',model:'deepseek-flash',
          apiKey:'synthetic-outline-key',consent:true,retain:true,auto:false,baseUrl:''});
        check(!ai.disabled,'AI enabled after real API settings');
        const nativeFetch=fetch;let aiRequest=null;
        fetch=(url,options={})=>{
          if(String(url).endsWith('/api/ai/outline-polish')){
            aiRequest=JSON.parse(options.body);
            return Promise.resolve(new Response(JSON.stringify({provider:'deepseek',result:{
              title:'函数复习',outline:'- 函数核心\\n  - 极限\\n    - 定义\\n  - 连续',needs_review:true,
            }}),{status:200,headers:{'Content-Type':'application/json'}}));
          }
          return nativeFetch(url,options);
        };
        ai.click();
        await wait(()=>opened.length===1||[...document.querySelectorAll('.toast')].some(node=>/AI|失败|无法|需要/.test(node.textContent)),'AI response');
        if(!opened.length)throw Error('AI handoff missing: '+[...document.querySelectorAll('.toast')].map(node=>node.textContent).join(' | '));
        const aiData=await readHandoff();
        check(aiData.outline==='- 函数核心\\n  - 极限\\n    - 定义\\n  - 连续','AI-polished outline forwarded');
        check(aiData.map===null,'AI generation opens a new map');
        check(aiRequest&&aiRequest.input.text===${JSON.stringify(originalOutline)},'AI receives the editable outline');
        check(aiRequest.provider==='deepseek'&&aiRequest.input.title==='导图生成测试','real provider request');

        await openTagPicker('edit','material',${row.id});
        await wait(()=>document.getElementById('tagPickerModal').classList.contains('show'),'edit dialog');
        check(!document.getElementById('tagPickerMindmapAi').disabled,'AI enabled in edit dialog');
        document.getElementById('tagPickerMindmapBasic').click();
        await wait(()=>document.getElementById('tagPickerMindmapSummary').textContent.includes('基础规则切分'),'edit dialog basic draft');
        check(document.getElementById('tagPickerOutline').value.startsWith('- 第一章 函数'),'edit dialog keeps generated outline editable');
        const previewHost=document.getElementById('tagPickerMindmapPreview');
        const previewSvg=previewHost.querySelector('svg');
        check(previewSvg&&previewSvg.style.width==='100%'&&previewSvg.style.height==='180px','compact preview scales the full map to the panel');
        check(previewHost.scrollWidth<=previewHost.clientWidth+1,'compact preview has no horizontal clipping');
        closeTagPicker();
        out.dataset.result='passed';
      }catch(error){
        out.dataset.result='failed';out.textContent=error.stack;
      }
      document.body.append(out);
    });`;
    const html=await runBrowser({
      chrome:browser,
      profile:path.join(temp,'mindmap-generation'),
      url:pageUrl,
      viewport:[1280,960],
      noSandbox:true,
      initScript,
      blockedUrls:['https://api.deepseek.com/*','http://localhost:3000/*','http://127.0.0.1:3000/*'],
    });
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];
    assert.match(result||'',/data-result="passed"/,result||html.slice(-3000));
    const saved=await api('GET','/materials/'+row.id);
    assert.equal(saved.outline,originalOutline,'generation does not overwrite the saved outline');
    assert.equal(saved.mindmap_json,'','generation does not save until the mind-map editor returns');
  });
});
