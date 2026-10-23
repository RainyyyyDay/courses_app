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
 const database=new DatabaseSync(path.join(back,'data/app.db'));database.exec('ALTER TABLE assessments DROP COLUMN completed_at; PRAGMA user_version=24');database.close();await restart();
 let rows=await api('GET',p);assert.equal(rows[0].completed_at,null);assert.equal(rows[0].file_url,old.file_url);
 let edited=await api('PUT',p+'/'+old.id,{title:'新名称',deadline:'2026-11-12'});assert.equal(edited.requirement,'保留要求');assert.equal(edited.file_url,old.file_url);assert.equal(edited.file_type,old.file_type);
 for(const body of [{title:''},{deadline:'2026-02-30'},{completed:'false'},{file_url:'replace'},{completed:null},{}])await api('PUT',p+'/'+old.id,body,400);
 const other=await api('POST','/courses',{name:'其他课程'},201);await api('PUT','/courses/'+other.id+'/assessments/'+old.id,{title:'不能改'},404);
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
  const script=`window.COURSES_API_BASE=${JSON.stringify(base)};addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';const check=(v,m)=>{if(!v)throw Error(m);};try{
   await openCourse(${ids.courseId},'考核测试','assessments');await loadAssessments();check(document.getElementById('assessmentList').textContent.includes('已逾期'),'overdue badge');
   openAssessmentEdit(${row.id});check(document.getElementById('assessTitle').value==='待编辑${i}'&&document.getElementById('assessAttachment').hidden,'edit restores fields and preserves attachment');
   document.getElementById('assessTitle').value='修改后的考核${i}';document.getElementById('assessDeadline').value='2099-11-11';await addAssessment();check(!document.getElementById('assessmentModal').classList.contains('show')&&document.getElementById('assessmentList').textContent.includes('修改后的考核${i}'),'edit updates list');
   await toggleAssessmentCompleted(${row.id});let rows=await requestList(API+'/courses/'+${ids.courseId}+'/assessments');check(rows.find(r=>r.id===${row.id}).completed_at,'completion persisted');check(document.getElementById('assessmentList').textContent.includes('恢复未完成'),'reversible action');
   await toggleAssessmentCompleted(${row.id});rows=await requestList(API+'/courses/'+${ids.courseId}+'/assessments');check(!rows.find(r=>r.id===${row.id}).completed_at,'reopen persisted');
   openAssessmentModal();document.getElementById('assessTitle').value='';await addAssessment();check(document.getElementById('assessError').textContent&&document.getElementById('assessmentModal').classList.contains('show'),'invalid name preserves editor');closeAssessmentModal();
   check(document.documentElement.scrollWidth<=innerWidth+1,'no horizontal overflow');check([...document.querySelectorAll('.assessment-actions button')].every(b=>b.getBoundingClientRect().width>0),'actions visible');out.textContent='PASS';
  }catch(e){out.textContent='FAIL '+e.stack;}document.body.append(out);});`;
  const html=await runBrowser({chrome,profile:path.join(temp,'assessment-'+i),url,viewport,noSandbox:true,initScript:script,screenshot:path.join(os.tmpdir(),'courses-assessments-'+viewport.join('x')+'.png')});const result=html.match(/<pre id="regressionResult">[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/>PASS</,result||'no result');
 }
},{legacy:false}));
