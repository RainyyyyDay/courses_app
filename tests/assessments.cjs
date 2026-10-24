const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');

test('assessment deadlines use calendar days and completion overrides urgency',()=>{
 const c=vm.createContext({setInterval:()=>{}});vm.runInContext(fs.readFileSync(path.join(__dirname,'../fronted/js/assessments.js'),'utf8'),c);
 const today=new Date(2026,9,23,23,59);
 for(const [date,days]of [['2026-10-23',0],['2026-10-24',1],['2026-10-22',-1],['2026-11-11',19],['',null],['2026-02-30',null]])assert.equal(c.assessmentDays(date,today),days);
 assert.equal(c.assessmentTiming({deadline:'2026-10-23'},today).text,'今天截止');
 assert.equal(c.assessmentTiming({deadline:'2026-10-24'},today).text,'明天截止');
 assert.equal(c.assessmentTiming({deadline:'2026-10-22'},today).text,'已逾期 1 天');
 assert.equal(c.assessmentTiming({deadline:'2026-10-22',completed_at:'done'},today).text,'已完成');
});

test('assessment API preserves old records and attachments, validates edits and persists completion',{timeout:90000},async()=>fixture(async({api,base,ids,back,restart})=>{
 const p='/courses/'+ids.courseId+'/assessments';
 const fd=new FormData();fd.append('title','旧考核');fd.append('deadline','2026-11-11');fd.append('requirement','保留要求');fd.append('file',new Blob(['fixture attachment'],{type:'text/plain'}),'fixture.txt');
 const response=await fetch(base+p,{method:'POST',body:fd});assert.equal(response.status,201);const old=await response.json();assert.ok(old.file_url);
 const chartUrl=p+'/'+old.id+'/chart';
 assert.equal((await api('GET',chartUrl)).version,0,'assessment starts with an empty chart');
 const chart=await api('PUT',chartUrl,{title:'总评成绩构成',source:'manual',expectedVersion:0,items:[
   {label:'考勤',percent:10,detail:'签到和课堂参与',color:'#7f9298'},
   {label:'期末考试',percent:60,detail:'闭卷考试',color:'#a8b4a3'},
 ]},200);
 assert.equal(chart.version,1);assert.equal(chart.items.reduce((sum,item)=>sum+item.percent,0),70);
 await api('PUT',chartUrl,{title:'旧版本',expectedVersion:0,items:[{label:'考勤',percent:10}]},409);
 await api('PUT',chartUrl,{title:'超过一百',expectedVersion:1,items:[{label:'A',percent:60},{label:'B',percent:50}]},400);
 await api('PUT',chartUrl,{title:'重复名称',expectedVersion:1,items:[{label:'A',percent:30},{label:'A',percent:20}]},400);
 const updatedChart=await api('PUT',chartUrl,{title:'修改后的总评',source:'ai',expectedVersion:1,items:[
   {label:'考勤',percent:15,detail:'更新说明'},
   {label:'期末',percent:60,detail:'考试'},
 ]},200);
 assert.equal(updatedChart.version,2);assert.equal(updatedChart.source,'ai');
 assert.equal((await api('GET',p))[0].chart.title,'修改后的总评','assessment list carries its chart without a second request');
 const attachedResponse=await fetch(base+p,{method:'POST',body:(()=>{const fd=new FormData();fd.append('title','可更换附件');fd.append('requirement','原正文');fd.append('file',new Blob(['考勤10%，期末60%'],{type:'text/plain'}),'initial.txt');return fd;})()});
 assert.equal(attachedResponse.status,201);const attached=await attachedResponse.json();
 const replacement=new FormData();replacement.append('title','可更换附件');replacement.append('deadline','');replacement.append('requirement','保留正文');
 replacement.append('file',new Blob(['考勤15%，期末55%'],{type:'text/plain'}),'replacement.txt');
 const replacedResponse=await fetch(base+p+'/'+attached.id,{method:'PUT',body:replacement});assert.equal(replacedResponse.status,200);const replaced=await replacedResponse.json();
 assert.notEqual(replaced.file_url,attached.file_url,'edit can replace an assessment attachment');
 const cleared=await api('DELETE',p+'/'+attached.id+'/file',undefined,200);
 assert.equal(cleared.file_url,'');assert.equal(cleared.file_type,'');
 await api('DELETE','/assessments/'+attached.id,undefined,200);
 const database=new DatabaseSync(path.join(back,'data/app.db'));database.exec('ALTER TABLE assessments DROP COLUMN completed_at; PRAGMA user_version=24');database.close();await restart();
 let rows=await api('GET',p);assert.equal(rows[0].completed_at,null);assert.equal(rows[0].file_url,old.file_url);assert.equal(rows[0].chart.version,2,'chart survives migration/restart');
 let edited=await api('PUT',p+'/'+old.id,{title:'新名称',deadline:'2026-11-12'});assert.equal(edited.requirement,'保留要求');assert.equal(edited.file_url,old.file_url);assert.equal(edited.file_type,old.file_type);
 for(const body of [{title:''},{deadline:'2026-02-30'},{completed:'false'},{file_url:'replace'},{completed:null},{}])await api('PUT',p+'/'+old.id,body,400);
 const other=await api('POST','/courses',{name:'其他课程'},201);await api('PUT','/courses/'+other.id+'/assessments/'+old.id,{title:'不能改'},404);
 await api('GET','/courses/'+other.id+'/assessments/'+old.id+'/chart',undefined,404);
 edited=await api('PUT',p+'/'+old.id,{completed:true});assert.ok(edited.completed_at);assert.equal((await api('PUT',p+'/'+old.id,{completed:true})).completed_at,edited.completed_at);
 const noDate=await api('POST',p,{title:'无日期'},201),near=await api('POST',p,{title:'临近',deadline:'2026-10-25'},201),past=await api('POST',p,{title:'逾期',deadline:'2026-10-01'},201);
 rows=await api('GET',p);assert.deepEqual(rows.map(r=>r.id),[past.id,near.id,noDate.id,old.id]);await restart();assert.ok((await api('GET',p)).find(r=>r.id===old.id).completed_at);
 assert.equal((await api('PUT',p+'/'+old.id,{completed:false})).completed_at,null);
 await api('POST',p,{title:'无效日期',deadline:'2026-02-30'},400);
},{legacy:false}));

test('assessment edit and completion work in desktop and mobile pages',{timeout:90000},async()=>fixture(async({api,base,ids,temp,serve})=>{
 const url=await serve(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);assert.ok(chrome);
 for(const [i,viewport]of [[1280,960],[390,844]].entries()){
  const row=await api('POST','/courses/'+ids.courseId+'/assessments',{title:'待编辑'+i,deadline:'2020-01-01',requirement:'原要求'},201);
  const attachedForm=new FormData();attachedForm.append('title','带附件考核'+i);attachedForm.append('requirement','考核正文参考');attachedForm.append('file',new Blob(['附件识别内容：考勤10%，期末60%'],{type:'text/plain'}),'assessment-'+i+'.txt');
  const attachedResponse=await fetch(base+'/courses/'+ids.courseId+'/assessments',{method:'POST',body:attachedForm});assert.equal(attachedResponse.status,201);const attached=await attachedResponse.json();
  const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';const check=(v,m)=>{if(!v)throw Error(m);};const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('waiting: '+label);};try{
   await openCourse(${ids.courseId},'考核测试','assessments');await loadAssessments();check(document.getElementById('assessmentList').textContent.includes('已逾期'),'overdue badge');
   openAssessmentModal();document.getElementById('assessTitle').value='上传页识别${i}';document.getElementById('assessReq').value='上传页正文';
   const uploadInput=document.getElementById('assessFile'),transfer=new DataTransfer();transfer.items.add(new File(['上传页附件：平时20%，期末70%'],'upload-${i}.txt',{type:'text/plain'}));uploadInput.files=transfer.files;uploadInput.dispatchEvent(new Event('change',{bubbles:true}));
   await scanAssessmentAttachment();check(document.getElementById('assessOcrText').value.includes('平时20%'),'upload page recognizes a newly selected attachment');
   document.getElementById('assessOcrAppend').click();check(document.getElementById('assessReq').value.includes('上传页正文')&&document.getElementById('assessReq').value.includes('平时20%'),'recognized text can append to the assessment body before save');
   document.getElementById('assessOcrToChartReference').click();
   await wait(()=>document.getElementById('assessmentChartEditor').open&&document.getElementById('assessmentChartSource').value.includes('期末70%'),'upload page OCR enters chart source');
   check(document.getElementById('assessmentChartSource').value.includes('平时20%'),'upload page sends OCR text to the chart editor source');
   closeAssessmentChartEditor();
   const uploadRows=await requestList(API+'/courses/'+${ids.courseId}+'/assessments'),uploadSaved=uploadRows.find(r=>r.title==='上传页识别${i}');
   check(uploadSaved?.file_url,'upload-page attachment saved with the new assessment');
   await requestApi(API+'/assessments/'+uploadSaved.id,{method:'DELETE'});await loadAssessments();
   openAssessmentEdit(${row.id});check(document.getElementById('assessTitle').value==='待编辑${i}'&&!document.getElementById('assessAttachment').hidden&&document.getElementById('assessOcrScan').disabled,'edit exposes attachment controls and disables OCR without a file');
   document.getElementById('assessTitle').value='修改后的考核${i}';document.getElementById('assessDeadline').value='2099-11-11';await addAssessment();check(!document.getElementById('assessmentModal').classList.contains('show')&&document.getElementById('assessmentList').textContent.includes('修改后的考核${i}'),'edit updates list');
   openAssessmentChartEditor(${row.id});
   check(document.getElementById('assessmentChartEditor').open,'dedicated chart editor opens');
   check(document.getElementById('assessmentChartAiBody').disabled&&document.getElementById('assessmentChartAiEdit').disabled,'AI-only actions are unlit without a real API');
   coursesAiSettings.configure({provider:'deepseek',model:'deepseek-flash',apiKey:'synthetic-assessment-key',retain:true,consent:true,auto:false});
   refreshAssessmentChartAiAvailability();
   check(!document.getElementById('assessmentChartAiBody').disabled,'real API configuration lights the AI extraction action');
   coursesAiSettings.clear();refreshAssessmentChartAiAvailability();
   check(document.getElementById('assessmentChartAiBody').disabled,'clearing the key turns AI-only actions off again');
   const chartTitle=document.getElementById('assessmentChartTitle');chartTitle.value='考核构成预览';chartTitle.dispatchEvent(new Event('input',{bubbles:true}));
   assessmentChartField(0,'label','考勤');assessmentChartField(0,'percent','10');assessmentChartField(0,'detail','课堂签到');
   assessmentChartAddRow();assessmentChartField(1,'label','期末');assessmentChartField(1,'percent','80');assessmentChartField(1,'detail','闭卷测试');
   check(document.getElementById('assessmentChartSum').textContent.includes('未说明')&&document.getElementById('assessmentChartSum').textContent.includes('10%'),'under-100 draft explains the automatic unknown remainder');
   await saveAssessmentChartEditor();
   const chartRow=assessmentRows.find(item=>item.id===${row.id});
   check(chartRow.chart?.items?.length===2&&!document.getElementById('assessmentChartEditor').open,'manual chart saves through its editor');
   const chartCanvas=document.getElementById('assessmentChartCanvas${row.id}');
   check(!!chartCanvas&&document.getElementById('assessmentList').textContent.includes('未说明'),'saved chart renders with its accessible detail list');
   let tooltipVisible=false;const rect=chartCanvas.getBoundingClientRect(),tip=chartCanvas.parentElement.querySelector('.assessment-chart-tooltip');
   for(let radius=28;radius<=Math.min(rect.width,rect.height)*.38&&!tooltipVisible;radius+=8){
     for(let angle=0;angle<Math.PI*2&&!tooltipVisible;angle+=Math.PI/16){
       chartCanvas.dispatchEvent(new MouseEvent('mousemove',{clientX:rect.left+rect.width/2+Math.cos(angle)*radius,clientY:rect.top+rect.height*.42+Math.sin(angle)*radius,bubbles:true}));
       await new Promise(r=>setTimeout(r,8));
       tooltipVisible=tip&&Number(tip.style.opacity)>0;
     }
   }
   check(tooltipVisible&&tip.textContent.includes('%'),'hover reveals the segment detail branch');
   openAssessmentEdit(${attached.id});
   await scanAssessmentAttachment();
   check(document.getElementById('assessOcrText').value.includes('考勤10%'),'edit page recognizes the existing attachment');
   document.getElementById('assessBodyToChartReference').click();
   await wait(()=>document.getElementById('assessmentChartEditor').open&&document.getElementById('assessmentChartSource').value==='考核正文参考','body source enters chart editor');
   check(document.getElementById('assessmentChartSource').value==='考核正文参考','body button sends its latest text to the chart editor source');
   closeAssessmentChartEditor();
   openAssessmentEdit(${attached.id});
   await scanAssessmentAttachment();
   document.getElementById('assessOcrToChartReference').click();
   await wait(()=>document.getElementById('assessmentChartEditor').open&&document.getElementById('assessmentChartSource').value.includes('期末60%'),'OCR source replaces chart source');
   check(document.getElementById('assessmentChartSource').value.includes('期末60%'),'later OCR send replaces the previous source text');
   closeAssessmentChartEditor();
   openAssessmentEdit(${attached.id});
   document.getElementById('assessFileRemove').click();
   check(document.getElementById('assessFileName').textContent.includes('删除'),'edit page can mark its existing attachment for deletion');
   await addAssessment();
   const attachedRows=await requestList(API+'/courses/'+${ids.courseId}+'/assessments');const attachedSaved=attachedRows.find(r=>r.id===${attached.id});
   check(attachedSaved&&!attachedSaved.file_url,'attachment deletion persists from the edit page');
   await toggleAssessmentCompleted(${row.id});let rows=await requestList(API+'/courses/'+${ids.courseId}+'/assessments');check(rows.find(r=>r.id===${row.id}).completed_at,'completion persisted');check(document.getElementById('assessmentList').textContent.includes('恢复未完成'),'reversible action');
   await toggleAssessmentCompleted(${row.id});rows=await requestList(API+'/courses/'+${ids.courseId}+'/assessments');check(!rows.find(r=>r.id===${row.id}).completed_at,'reopen persisted');
   openAssessmentModal();document.getElementById('assessTitle').value='';await addAssessment();check(document.getElementById('assessError').textContent&&document.getElementById('assessmentModal').classList.contains('show'),'invalid name preserves editor');closeAssessmentModal();
   check(document.documentElement.scrollWidth<=innerWidth+1,'no horizontal overflow');check([...document.querySelectorAll('.assessment-actions button')].every(b=>b.getBoundingClientRect().width>0),'actions visible');out.textContent='PASS';
  }catch(e){out.textContent='FAIL '+e.stack;}document.body.append(out);});`;
  const html=await runBrowser({chrome,profile:path.join(temp,'assessment-'+i),url,viewport,noSandbox:true,initScript:script,screenshot:path.join(os.tmpdir(),'courses-assessments-'+viewport.join('x')+'.png')});const result=html.match(/<pre id="regressionResult">[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/>PASS</,result||'no result');
 }
},{legacy:false}));
