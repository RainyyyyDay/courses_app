const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {fixture}=require('./temp-backend-fixture.cjs');
const {runBrowser}=require('./browser-driver.cjs');

test('standard recall controls session pass/fail and mistakes always reveal before judging', {timeout:90000}, async()=>{
  await fixture(async({api,ids})=>{
    const c='/courses/'+ids.courseId;
    const material=await api('POST',c+'/materials',{title:'回忆资料',content:'资料正文'},201);
    const note=await api('POST',c+'/notes',{title:'回忆笔记',content:'笔记正文'},201);
    const mistake=await api('POST',c+'/mistakes',{
      title:'回忆错题',content:'1+1=?',answerContent:'2',explanation:'加法',mistakeType:'knowledge',questionFormat:'open'
    },201);
    const session=await api('POST',c+'/review-sessions',{
      requestId:'recall-session',sourceType:'total',
      selectedItems:[{type:'material',id:material.id},{type:'note',id:note.id},{type:'mistake',id:mistake.id}]
    },201);
    const item=type=>session.items.find(row=>row.item_type===type);
    const weak=await api('PATCH',c+'/materials/'+material.id+'/review?sessionItemId='+item('material').id,{recall:'vague'});
    assert.equal(weak.review_status,'unreviewed');
    const clear=await api('PATCH',c+'/notes/'+note.id+'/review?sessionItemId='+item('note').id,{recall:'clear'});
    assert.equal(clear.review_status,'reviewed');
    let progress=await api('POST',c+'/mistakes/'+mistake.id+'/review?sessionItemId='+item('mistake').id,{
      action:'start',requestId:'mistake-start',expectedVersion:0
    });
    progress=await api('POST',c+'/mistakes/'+mistake.id+'/review/events?sessionItemId='+item('mistake').id,{
      action:'recall',recall:'forgotten',firstAnswer:'不记得',requestId:'mistake-forgot',expectedVersion:progress.version
    });
    assert.equal(progress.stage,'answer');
    assert.equal(progress.answerVisible,true);
    assert.ok(progress.allowedActions.includes('judge'));
    progress=await api('POST',c+'/mistakes/'+mistake.id+'/review/events?sessionItemId='+item('mistake').id,{
      action:'judge',correct:false,requestId:'mistake-wrong',expectedVersion:progress.version
    });
    assert.equal(progress.reviewStatus,'unreviewed');
    const finished=await api('POST',c+'/review-sessions/'+session.id+'/finish',{});
    assert.equal(finished.status,'completed');
    assert.equal(finished.passed,1);
    assert.equal(finished.failed,2);
    assert.equal(finished.exposed,0);
    assert.equal(finished.items.find(row=>row.item_type==='material').result,'failed');
    assert.equal(finished.items.find(row=>row.item_type==='note').result,'passed');
    await api('PATCH',c+'/materials/'+material.id+'/review',{recall:'bogus'},400);
  },{legacy:false});
});

test('upload/edit default mode, AI adoption, and total-review weak recall UI', {timeout:90000}, async()=>{
  await fixture(async({api,ids,base,temp,serve})=>{
    const courseId=ids.courseId;
    const editMistake=await api('POST','/courses/'+courseId+'/mistakes',{
      title:'编辑方式测试',content:'1+2=?',answerContent:'3',explanation:'加法',mistakeType:'knowledge',questionFormat:'open'
    },201);
    const standardMistake=await api('POST','/courses/'+courseId+'/mistakes',{
      title:'自动标准错题',content:'2+2=?',answerContent:'4',explanation:'加法',mistakeType:'knowledge',questionFormat:'open'
    },201);
    const progressItems=[];
    for(let index=1;index<=4;index++)progressItems.push(await api('POST','/courses/'+courseId+'/materials',{
      title:'进度测试资料 '+index,content:'进度测试正文 '+index
    },201));
    await api('PUT','/courses/'+courseId+'/review-items/material/'+progressItems[0].id+'/materials/self_explain',{
      expectedVersion:0,confirmed:true,
      material:{prompt:'请讲解这段资料',reference:'概念与原因',rubric:'讲解清楚',blanks:[],objects:[],dimensions:[]}
    });
    const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    assert.ok(chrome);
    const url=await serve();
    const initScript=`window.COURSES_API_BASE=${JSON.stringify(base)};window.COURSES_AI_API_BASE=location.origin+'/api';addEventListener('load',async()=>{
      const out=document.createElement('pre');out.id='regressionResult';
      const check=(value,message)=>{if(!value)throw Error(message);};
      const wait=async(fn,label)=>{for(let i=0;i<250;i++){if(fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('waiting: '+label);};
      const debug=document.createElement('div');debug.id='reviewDebugStage';document.body.append(debug);
      const stage=value=>{debug.textContent=value;};
      try{
        stage('loading courses');
        await wait(()=>typeof allcourses!=='undefined'&&allcourses.some(c=>c.id===${courseId}),'courses');
        await openCourse(${courseId},'题型隔离测试','materials');
        stage('opening resource create');
        await openResourceCreate('material');
        stage('resource create open');
        check(document.getElementById('tagPickerReviewModeHost').style.display==='block','upload review choice visible');
        check(document.getElementById('tagPickerReviewMethod').value==='','new upload has no explicit mode');
        check(document.getElementById('tagPickerReviewMethodStatus').textContent.includes('标准复习'),'default standard is disclosed');
        check(!document.querySelector('#tagPickerReviewMethod option[value="self_explain"]').disabled
          &&!document.querySelector('#tagPickerReviewMethod option[value="contrast"]').disabled
          &&!document.getElementById('tagPickerReviewApiNote').hidden,'manual modes available without real API');
        const adviceButton=document.getElementById('tagPickerReviewModeAdvice');
        check(adviceButton.disabled&&adviceButton.getAttribute('aria-disabled')==='true','AI advice disabled without real API');
        openCreationReviewSuggestion('tagPicker');
        check(!document.getElementById('creationModeAdviceDialog').open,'AI advice cannot open without real API');
        const connectionFetch=window.fetch;
        window.fetch=async(url,options)=>String(url).includes('/ai/test')
          ?new Response(JSON.stringify({ok:true,provider:'deepseek',model:'deepseek-flash',action:'connection'}),{status:200,headers:{'Content-Type':'application/json'}})
          :connectionFetch.call(window,url,options);
        coursesAiSettings.configure({provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-mode-key',retain:true,consent:true,auto:false});
        check(adviceButton.disabled&&getComputedStyle(adviceButton).backgroundColor!=='rgb(74, 108, 247)','saved key alone does not light the AI advice button');
        coursesAiSettings.open();
        document.getElementById('coursesAiTest').click();
        await wait(()=>coursesAiSettings.connectedReady(),'AI connection test');
        document.getElementById('coursesAiClose').click();
        await wait(()=>!adviceButton.disabled&&getComputedStyle(adviceButton).backgroundColor==='rgb(74, 108, 247)','AI advice highlight');
        check(!document.querySelector('#tagPickerReviewMethod option[value="self_explain"]').disabled,'self explanation remains available');
        check(!document.querySelector('#tagPickerReviewMethod option[value="contrast"]').disabled,'contrast remains available');
        check(document.getElementById('tagPickerReviewApiNote').hidden,'AI connection note hides after connection test');
        check(!adviceButton.disabled,'AI advice enables after connection test');
        document.getElementById('tagPickerName').value='上传方式测试';
        document.getElementById('tagPickerResourceContent').value='光合作用把光能转成化学能。';
        pendingUploadFile=new File(['fake image bytes'],'photosynthesis.png',{type:'image/png'});
        renderPickerResourceSummary();
        const realRecognize=recognizeUploadedFile;
        recognizeUploadedFile=async()=>({text:'OCR 自动读取：叶绿体吸收光能。',provider:'mock'});
        stage('installing fake AI response');
        const realFetch=window.fetch;
        window.fetch=async(url,options)=>{
          if(String(url).includes('/ai/review-mode-advice')){
            const body=JSON.parse(options.body);
            window.__reviewAdviceBody=body;
            return new Response(JSON.stringify({provider:'deepseek',result:{review_method:'cloze',reason:'事实需要逐空回忆。',needs_review:true}}),{status:200,headers:{'Content-Type':'application/json'}});
          }
          if(String(url).includes('/ai/material-draft')){
            return new Response(JSON.stringify({provider:'deepseek',mode_id:'cloze',draft:{material:{prompt:'光合作用把光能【ai1】。',reference:'',rubric:'',blanks:[{id:'ai1',answer:'转成化学能',aliases:['转化为化学能'],hint:'能量变化'}],objects:[],dimensions:[]},needs_more_information:false,caveats:['请核对生成空位。'],needs_review:true}}),{status:200,headers:{'Content-Type':'application/json'}});
          }
          return realFetch.call(window,url,options);
        };
        stage('opening recommendation');
        openCreationReviewSuggestion('tagPicker');
        stage('recommendation running');
        await wait(()=>!document.getElementById('creationModeAdviceAnalyze').hidden,'advice context ready');
        document.getElementById('creationModeAdviceGoal').value='remember';
        document.getElementById('creationModeAdviceExtra').value='重点记住叶绿体和光能转换。';
        document.getElementById('creationModeAdviceAnalyze').click();
        await wait(()=>!document.getElementById('creationModeAdviceResult').hidden,'AI result');
        stage('recommendation shown');
        check(window.__reviewAdviceBody?.input.kind==='material'
          &&window.__reviewAdviceBody.input.content.includes('光合作用')
          &&window.__reviewAdviceBody.input.content.includes('OCR 自动读取'),'AI receives typed body and attachment OCR');
        check(window.__reviewAdviceBody.input.goal==='remember'
          &&window.__reviewAdviceBody.input.extra_context.includes('叶绿体')
          &&window.__reviewAdviceBody.input.mistake_type==='','AI receives goal, extra context and item type');
        check(document.getElementById('creationModeAdviceSource').textContent.includes('正文'),'read scope shown');
        check(document.getElementById('creationModeAdviceSource').textContent.includes('附件 OCR'),'OCR read scope shown');
        check(document.getElementById('creationModeAdviceAdopt').textContent.includes('挖空回忆'),'AI recommendation shown');
        check(document.getElementById('tagPickerReviewMethod').value==='','AI result is not auto-adopted');
        document.getElementById('creationModeAdviceAdopt').click();
        check(document.getElementById('tagPickerReviewMethod').value==='cloze','explicit adoption fills manual selector');
        coursesAiSettings.clear();
        coursesAiSettings.configure({provider:'mock',model:'deepseek-flash',retain:false,auto:false});
        check(adviceButton.disabled,'AI advice disables again after the real key is cleared');
        check(!document.getElementById('tagPickerClozeSetup').hidden,'cloze setup button appears after mode selection');
        check(typeof openClozeModeSetup==='function','cloze setup handler exists');
        document.getElementById('tagPickerClozeSetup').click();
        await new Promise(resolve=>setTimeout(resolve,150));
        check(document.getElementById('reviewWbDialog')?.open
          ||document.getElementById('tagPickerReviewMethodStatus').textContent.includes('无法打开'),'cloze button executes handler');
        await wait(()=>document.getElementById('reviewWbDialog')?.open&&document.getElementById('clozeSource'),'existing cloze editor opens');
        check(document.getElementById('reviewWbHeader').textContent.includes('设置挖空回忆'),'cloze setup reuses existing editor');
        check(!document.getElementById('reviewWbReadiness').textContent.includes('1 到 20')
          &&document.getElementById('reviewWbReadiness').textContent.includes('可手动选字挖空'),'cloze hint is concise and has no prescribed count');
        const generatorButton=document.querySelector('[data-material-ai-generate]');
        check(generatorButton.disabled&&!document.getElementById('reviewWbAiUnavailable').hidden,'AI generation disabled without real API');
        coursesAiSettings.configure({provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-cloze-key',retain:true,consent:true,auto:false});
        check(!generatorButton.disabled&&document.getElementById('reviewWbAiUnavailable').hidden,'AI generation enabled with real API');
        wb('Editor').querySelector('.review-ai-generator').open=true;
        generatorButton.click();
        await wait(()=>wb('Draft').textContent.includes('采纳')&&document.getElementById('clozeSource').textContent.includes('光合作用'),'AI cloze draft rendered in manual editor');
        check(wb('Draft').querySelectorAll('button').length===2
          &&wb('Draft').textContent.includes('采纳')&&wb('Draft').textContent.includes('不采纳'),'generated draft only offers adopt or reject');
        await saveWorkbenchMaterial();
        check(wb('Error').textContent.includes('采纳')&&wb('Error').textContent.includes('不采纳'),'unconfirmed AI draft cannot be saved directly');
        [...wb('Draft').querySelectorAll('button')].find(button=>button.textContent==='不采纳').click();
        check(!wb('Blanks').querySelector('.review-blank')&&!document.getElementById('clozeSource').querySelector('[data-cloze-id]'),'reject restores pre-AI cloze');
        generatorButton.click();
        await wait(()=>wb('Draft').textContent.includes('采纳')&&document.getElementById('clozeSource').querySelector('[data-cloze-id="ai1"]'),'AI draft regenerates after rejection');
        wb('Blanks').querySelector('[data-blank="answer"]').value='转成化学能（已修改）';
        adoptWorkbenchGeneratedMaterial();
        check(wb('Draft').textContent.includes('已采纳 AI 生成结果'),'AI-generated cloze can be edited and adopted');
        savePendingCreationCloze();
        check(!document.getElementById('reviewWbDialog').open,'pending cloze setting closes after save');
        recognizeUploadedFile=realRecognize;
        window.__reviewRequests=[];
        window.fetch=async(url,options)=>{
          const entry=String(url)+' '+(options?.method||'GET')+' pending';
          window.__reviewRequests.push(entry);
          try{const response=await realFetch.call(window,url,options);window.__reviewRequests[window.__reviewRequests.length-1]=entry.replace(' pending',' done');return response;}
          catch(error){window.__reviewRequests[window.__reviewRequests.length-1]=entry.replace(' pending',' failed');throw error;}
        };
        await confirmTagPicker();
        stage('upload saved');
        await loadMaterials();
        stage('upload saved host '+(document.getElementById('tagPickerReviewModeHost')?.isConnected===true));
        const created=currentMaterials.find(row=>row.title.startsWith('上传方式测试'));
        check(created&&readResourceAiMethod({courseId:${courseId},type:'material',id:created.id})==='cloze','upload persists adopted mode');
        const clozeArtifact=await(await requestApi(API+'/courses/${courseId}/review-items/material/'+created.id+'/materials/cloze')).json();
        check(clozeArtifact.version===1&&clozeArtifact.material.blanks.some(blank=>blank.answer==='转成化学能（已修改）'),'adopted and edited AI cloze persists after content creation');
        coursesAiSettings.clear();
        coursesAiSettings.configure({provider:'mock',model:'deepseek-flash',retain:false,auto:false});
        await openResourceDetail('material',created.id);
        check(document.getElementById('resourceDetailOpen')&&!document.getElementById('resourceAiPanel'),'legacy resource AI panel removed from detail while attachment link remains');
        await openTagPicker('edit','material',created.id);
        stage('edit open host '+(document.getElementById('tagPickerReviewModeHost')?.isConnected===true));
        check(document.getElementById('tagPickerReviewModeHost').style.display==='block','edit review choice visible');
        check(document.getElementById('tagPickerReviewMethod').value==='cloze','edit restores saved mode');
        check(!document.getElementById('tagPickerClozeSetup').hidden,'saved cloze mode shows setup button');
        document.getElementById('tagPickerClozeSetup').click();
        await wait(()=>document.getElementById('reviewWbDialog')?.open&&document.getElementById('clozeSource')?.textContent.includes('光合作用'),'saved cloze setup reopens');
        closeReviewWorkbench();
        document.getElementById('tagPickerReviewMethod').value='reading';
        changeReviewMethodChoice('tagPicker');
        check(document.getElementById('tagPickerClozeSetup').hidden,'cloze setup button hides for other modes');
        await confirmTagPicker();
        stage('edit saved');
        check(readResourceAiMethod({courseId:${courseId},type:'material',id:created.id})==='reading','edit persists changed mode');
        await openResourceCreate('note');
        document.getElementById('tagPickerName').value='默认标准笔记';
        document.getElementById('tagPickerResourceContent').value='未手动选择模式。';
        await confirmTagPicker();
        await loadNotes();
        const defaultNote=currentNotes.find(row=>row.title==='默认标准笔记');
        check(defaultNote&&readResourceAiMethod({courseId:${courseId},type:'note',id:defaultNote.id})==='standard','unselected upload persists standard fallback');
        await openMistakeDetail(${editMistake.id});
        await openMistakeEdit();
        check(document.getElementById('mistakeEditReviewModeHost').style.display==='block','mistake edit review choice visible');
        check(document.getElementById('mistakeEditReviewMethodStatus').textContent.includes('标准复习'),'mistake edit default disclosed');
        document.getElementById('mistakeEditReviewMethod').value='reading';
        changeReviewMethodChoice('mistakeEdit');
        await saveMistakeDetail();
        check(readMistakeAiMethod({courseId:${courseId},id:${editMistake.id}})==='reading','mistake edit persists changed mode');
        check(saveResourceAiMethod({courseId:${courseId},type:'material',id:created.id},'standard'),'standard fallback selectable');
        await loadMaterials();
        await openCourse(${courseId},'题型隔离测试','materials');
        await openTotalReview();
        await wait(()=>totalReviewState&&!totalReviewState.loading,'mixed progress candidates');
        for(const id of [created.id,...${JSON.stringify(progressItems.map(row=>row.id))}])selectTotalReviewItem('material:'+id,true);
        await startTotalReview();
        await wait(()=>currentView.type==='readingReview'&&activeReadingReview.row?.id===created.id,'mixed progress first item');
        check(document.getElementById('materialReviewProgress').textContent.includes('第 1 / 5 条 · 已处理 0 条 · 资料 · 标准复习'),'progress uses selected total, type and bound mode');
        check(![...document.querySelectorAll('#centerReviewToolbar button')].some(button=>/确认开始|切换原复习|手动材料/.test(button.textContent)),'bound review mode starts without confirmation or switching UI');
        await pauseCenterReview();
        await openCourse(${courseId},'题型隔离测试','materials');
        check(saveResourceAiMethod({courseId:${courseId},type:'material',id:${progressItems[0].id}},'self_explain'),'bound self explanation mode saved');
        await openTotalReview();
        await wait(()=>totalReviewState&&!totalReviewState.loading,'manual mode candidates');
        selectTotalReviewItem('material:${progressItems[0].id}',true);
        await startTotalReview();
        await wait(()=>reviewWorkbench?.inline&&reviewWorkbench.attempt?.modeId==='self_explain','manual mode starts without AI');
        check(!document.querySelector('.review-mode-requirement'),'no whole-mode AI gate');
        closeReviewWorkbench();
        await pauseCenterReview();
        await openCourse(${courseId},'题型隔离测试','materials');
        coursesAiSettings.configure({provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-self-key',retain:true,consent:true,auto:false});
        check(saveResourceAiMethod({courseId:${courseId},type:'material',id:${progressItems[0].id}},'self_explain'),'bound self explanation mode saved');
        await openTotalReview();
        await wait(()=>totalReviewState&&!totalReviewState.loading,'bound AI mode candidates');
        selectTotalReviewItem('material:${progressItems[0].id}',true);
        await startTotalReview();
        await wait(()=>reviewWorkbench?.inline&&reviewWorkbench.attempt?.modeId==='self_explain','bound material auto starts');
        check(![...document.querySelectorAll('#reviewWbPanel button')].some(button=>/确认开始|切换标准复习|返回原阅读/.test(button.textContent)),'ready material has no start or switch confirmation');
        closeReviewWorkbench();
        await pauseCenterReview();
        await openCourse(${courseId},'题型隔离测试','materials');
        check(saveResourceAiMethod({courseId:${courseId},type:'material',id:${progressItems[1].id}},'contrast'),'bound contrast mode saved');
        await openTotalReview();
        await wait(()=>totalReviewState&&!totalReviewState.loading,'bound contrast candidates');
        selectTotalReviewItem('material:${progressItems[1].id}',true);
        await startTotalReview();
        await wait(()=>reviewWorkbench?.inline&&reviewWorkbench.mode==='contrast'&&document.getElementById('reviewWbPrompt'),'missing bound mode opens template directly');
        check(![...document.querySelectorAll('#reviewWbPanel button')].some(button=>/准备材料并开始|切换标准复习|返回原阅读|确认开始/.test(button.textContent)),'missing mode template has no preparation detour or switch');
        closeReviewWorkbench();
        await pauseCenterReview();
        coursesAiSettings.clear();
        coursesAiSettings.configure({provider:'mock',model:'deepseek-flash',retain:false,auto:false});
        await openCourse(${courseId},'题型隔离测试','materials');
        stage('direct row fetch');
        const directRow=await(await requestApi(API+'/courses/${courseId}/materials/'+created.id+'/review')).json();
        check(directRow.id===created.id,'fetch works after fake AI response');
        await openTotalReview();
        stage('total candidates loading');
        await wait(()=>totalReviewState&&!totalReviewState.loading,'total candidates');
        selectTotalReviewItem('material:'+created.id,true);
        await startTotalReview();
        stage('total weak item '+currentView.type+'/'+(currentView.reviewKind||'')+' center='+(currentCenterItem()?.item_id||'')
          +' kind='+activeReadingReview.kind+' row='+(activeReadingReview.row?.id||'')
          +' request='+activeReadingReview.request+' expected='+created.id
          +' mode='+readResourceAiMethod({courseId:${courseId},type:'material',id:created.id}));
        await wait(()=>currentView.type==='readingReview'&&activeReadingReview.row?.id===created.id,'weak recall item');
        check(!document.getElementById('resourceAiPanel'),'legacy resource AI panel absent from review page');
        check(document.querySelector('[data-material-review="reviewed"]')?.textContent==='清楚','clear control');
        check(document.querySelector('[data-material-review="vague"]')?.textContent==='模糊','vague control');
        check(document.querySelector('[data-material-review="forgotten"]')?.textContent==='不记得','forgotten control');
        document.querySelector('[data-material-review="vague"]').click();
        stage('weak saved waiting');
        await wait(()=>document.getElementById('materialReviewActions').textContent.includes('已再次温习'),'reread result');
        check(document.getElementById('materialReviewActions').textContent.includes('不计成功复习'),'weak recall not counted');
        check(centerReview.session.failed===1
          &&document.getElementById('centerReviewToolbar').textContent.includes('未通过 1'),'live session counts refresh before final modal');
        document.getElementById('materialReviewNext').click();
        stage('weak next');
        await wait(()=>document.getElementById('mistakeCompleteModal').classList.contains('show'),'complete modal');
        check(document.getElementById('mistakeCompleteText').textContent.includes('通过 0 项')
          &&document.getElementById('mistakeCompleteText').textContent.includes('未通过 1 项'),'weak recall session reports failed');
        cancelReviewComplete();
        stage('modal cancelled');
        await openCourse(${courseId},'题型隔离测试','materials');
        await openTotalReview();
        stage('second candidates loading');
        await wait(()=>totalReviewState&&!totalReviewState.loading,'second total candidates');
        selectTotalReviewItem('material:'+created.id,true);
        await startTotalReview();
        stage('second item');
        await wait(()=>currentView.type==='readingReview'&&activeReadingReview.row?.id===created.id,'clear recall item');
        document.querySelector('[data-material-review="reviewed"]').click();
        await wait(()=>document.getElementById('mistakeCompleteModal').classList.contains('show'),'clear complete modal');
        check(document.getElementById('mistakeCompleteText').textContent.includes('全部通过'),'clear recall passes');
        cancelReviewComplete();
        check(saveResourceAiMethod({courseId:${courseId},type:'material',id:created.id},'reading'),'reading mode selectable');
        await openCourse(${courseId},'题型隔离测试','materials');
        await openTotalReview();
        await wait(()=>totalReviewState&&!totalReviewState.loading,'reading candidates');
        selectTotalReviewItem('material:'+created.id,true);
        await startTotalReview();
        await wait(()=>currentView.type==='readingReview'&&activeReadingReview.row?.id===created.id,'reading exposure item');
        check(document.querySelector('[data-material-review="exposure"]')?.textContent.includes('仅曝光'),'reading uses exposure control');
        document.querySelector('[data-material-review="exposure"]').click();
        await wait(()=>document.getElementById('mistakeCompleteModal').classList.contains('show'),'reading complete modal');
        check(document.getElementById('mistakeCompleteText').textContent.includes('通过 0 项')
          &&document.getElementById('mistakeCompleteText').textContent.includes('仅阅读曝光 1 项'),'reading exposure not counted as passed');
        cancelReviewComplete();
        check(saveMistakeAiMethod({courseId:${courseId},id:${standardMistake.id}},'standard'),'bound mistake mode saved');
        await openCourse(${courseId},'题型隔离测试','mistakes');
        await openTotalReview();
        await wait(()=>totalReviewState&&!totalReviewState.loading,'mistake bound mode candidates');
        selectTotalReviewItem('mistake:${standardMistake.id}',true);
        await startTotalReview();
        await wait(()=>!reviewWorkbench&&mistakeDetailState?.progress?.stage==='question','bound mistake auto starts');
        check(!document.querySelector('.mistake-mode-switch')
          &&![...document.querySelectorAll('#centerReviewToolbar button')].some(button=>/确认开始|切换/.test(button.textContent)),'mistake review auto renders without mode switch or start confirmation');
        out.dataset.result='passed';out.textContent='passed';
      }catch(error){out.dataset.result='failed';out.textContent=error.stack+' | AI STATUS: '
        +(document.getElementById('creationModeAdviceStatus')?.textContent||'')
        +' | MODE STATUS: '+(document.getElementById('tagPickerReviewMethodStatus')?.textContent||'')
        +' | REVIEW ERROR: '+(document.getElementById('materialReviewError')?.textContent||'')
        +' | TOTAL ERROR: '+(document.getElementById('totalReviewError')?.textContent||'')
        +' | TITLE: '+(document.getElementById('materialReviewTitle')?.textContent||'')
        +' | BUSY: '+activeReadingReview.busy
          +' | QUEUE: '+(activeReadingReview.queue?.ids?.join(',')||'')+' idx='+activeReadingReview.queue?.index
          +' done='+activeReadingReview.queue?.finished
        +' | REQUESTS: '+(window.__reviewRequests?.slice(-4).join(' || ')||'')
        +' | PAGE ERROR: '+(document.getElementById('jsErrorBanner')?.textContent||'');}
      document.body.append(out);
    });`;
    new vm.Script(initScript,{filename:'review-mode-selection-browser-init.js'});
    const html=await runBrowser({chrome,profile:path.join(temp,'mode-selection-browser'),url,viewport:[1280,960],noSandbox:true,
      timeoutMs:15000,returnOnTimeout:true,
      initScript,blockedUrls:['https://api.deepseek.com/*','http://localhost:3000/*','http://127.0.0.1:3000/*'],
      screenshot:path.join(temp,'review-mode-selection.png')});
    await new Promise(resolve=>setTimeout(resolve,800));
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];
    const lastStage=html.match(/id="reviewDebugStage"[^>]*>([^<]*)/)?.[1]||'unknown';
    assert.match(result||'',/data-result="passed"/,`last stage: ${lastStage}\n${result||html.slice(-2500)}`);
  },{legacy:false});
});

test('review mode browser smoke', {timeout:60000}, async()=>{
  await fixture(async({ids,temp,serve,base})=>{
    const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    assert.ok(chrome);
    const html=await runBrowser({chrome,profile:path.join(temp,'smoke-browser'),url:await serve(),viewport:[390,844],
      noSandbox:true,initScript:`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{
        const out=document.createElement('pre');out.id='regressionResult';
        try{for(let i=0;i<250;i++){if(typeof allcourses!=='undefined'&&allcourses.some(c=>c.id===${ids.courseId}))break;await new Promise(r=>setTimeout(r,30));}
          await openCourse(${ids.courseId},'题型隔离测试','materials');
          await openResourceCreate('material');
          if(document.getElementById('resourceAiPanel'))throw Error('legacy resource AI panel absent');
          document.getElementById('tagPickerName').value='smoke';
          document.getElementById('tagPickerResourceContent').value='正文';
          const realFetch=window.fetch;
          window.fetch=async(url,options)=>{if(String(url).includes('/ai/review-mode-advice'))return new Response(JSON.stringify({provider:'mock',result:{review_method:'cloze',reason:'ok',needs_review:true}}),{status:200,headers:{'Content-Type':'application/json'}});return realFetch(url,options);};
          openCreationReviewSuggestion('tagPicker');
          await new Promise(r=>setTimeout(r,1000));
          if(document.documentElement.scrollWidth>innerWidth+1)throw Error('mobile overflow');
          out.dataset.result='passed';out.textContent='ai '+document.getElementById('creationModeAdviceStatus').textContent+' hidden '+document.getElementById('creationModeAdviceResult').hidden;}catch(e){out.dataset.result='failed';out.textContent=e.stack;}
        document.body.append(out);
      });`});
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];
    assert.match(result||'',/data-result="passed"/,result||html.slice(-2000));
  },{legacy:false});
});
