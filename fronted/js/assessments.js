/* Course assessments: explicit completion, editing, and calendar-day deadlines. */
let assessmentRows=[],assessmentCourseId=null,assessmentLoad=0,assessmentEdit=null,assessmentSaving=false,assessmentOcrController=null,assessmentPendingChartSource=null;
const assessmentPending=new Set();
function assessmentDays(deadline,today=new Date()) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(deadline||''))return null;
  const stamp=Date.parse(deadline+'T00:00:00Z');
  if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==deadline)return null;
  return Math.round((stamp-Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()))/86400000);
}
function assessmentTiming(row,today=new Date()) {
  if(row.completed_at)return {text:'已完成',kind:'completed'};
  const days=assessmentDays(row.deadline,today);
  if(days===null)return {text:'未设置日期',kind:'neutral'};
  if(days<0)return {text:'已逾期 '+(-days)+' 天',kind:'overdue'};
  if(days===0)return {text:'今天截止',kind:'urgent'};
  return {text:days===1?'明天截止':'剩余 '+days+' 天',kind:days<=7?'soon':'normal'};
}
function renderAssessments() {
  if(assessmentCourseId!==currentCourseId)return;
  const box=document.getElementById('assessmentList');
  if(!assessmentRows.length){
    if(typeof renderAssessmentCharts==='function')renderAssessmentCharts();
    box.innerHTML='<div class="empty">暂无考核，添加后可查看截止提醒并记录完成状态。</div>';
    return;
  }
  const rows=[...assessmentRows].sort((a,b)=>Number(!!a.completed_at)-Number(!!b.completed_at)||(assessmentDays(a.deadline)===null?1:0)-(assessmentDays(b.deadline)===null?1:0)||String(a.deadline||'').localeCompare(String(b.deadline||''))||a.id-b.id);
  box.innerHTML='<p class="assessment-sort-hint">未完成考核按截止日期排序，已完成考核放在最后。</p>'+rows.map(r=>{
    const timing=assessmentTiming(r),busy=assessmentPending.has(r.id);
    return `<article class="item-row assessment-card ${r.completed_at?'assessment-completed':''}"><div class="info"><div class="assessment-card-head"><h3>${escapeHtml(r.title)}</h3><span class="assessment-deadline assessment-${timing.kind}">${timing.text}</span></div><p class="meta">截止日期：${escapeHtml(r.deadline||'未设置')}</p>${r.requirement?`<p class="row-content">${escapeHtml(r.requirement)}</p>`:''}${typeof assessmentChartCardHtml==='function'?assessmentChartCardHtml(r):''}</div><div class="assessment-actions">${r.file_url?attachmentActionsHtml(r.file_url,r.file_type,r.title||'考核附件'):''}<button type="button" onclick="openAssessmentEdit(${r.id})" ${busy?'disabled':''}>编辑</button><button type="button" class="${r.completed_at?'':'ai-primary'}" onclick="toggleAssessmentCompleted(${r.id})" ${busy?'disabled':''}>${r.completed_at?'恢复未完成':'标记已完成'}</button><button type="button" class="assessment-delete" onclick="delItem('assessments',${r.id},loadAssessments)" ${busy?'disabled':''}>删除</button></div></article>`;
  }).join('');
  if(typeof renderAssessmentCharts==='function')renderAssessmentCharts();
}
async function loadAssessments() {
  const course=currentCourseId,token=++assessmentLoad,box=document.getElementById('assessmentList');
  box.innerHTML='<div class="loading-tip">加载中…</div>';
  try {const rows=await requestList(`${API}/courses/${course}/assessments`);if(token!==assessmentLoad||course!==currentCourseId)return;assessmentRows=rows;assessmentCourseId=course;renderAssessments();}
  catch(err){if(token===assessmentLoad&&course===currentCourseId)showListError(box,err);}
}
function openAssessmentModal(row=null) {
  if(assessmentSaving)return;
  assessmentOcrController?.abort();assessmentOcrController=null;
  assessmentEdit={id:row?.id||null,courseId:currentCourseId,existingFileUrl:row?.file_url||'',existingFileType:row?.file_type||'',removeFile:false};
  document.getElementById('assessmentModal').classList.add('show');
  document.getElementById('assessModalTitle').textContent=row?'编辑考核':'添加考核';
  document.getElementById('assessTitle').value=row?.title||'';
  document.getElementById('assessDeadline').value=row?.deadline||'';
  document.getElementById('assessReq').value=row?.requirement||'';
  document.getElementById('assessFile').value='';
  document.getElementById('assessAttachment').hidden=false;
  document.getElementById('assessFileName').textContent=row?.file_url?'保留现有附件':'未选择附件';
  document.getElementById('assessFilePick').textContent=row?.file_url?'更换附件':'选择附件（可选）';
  const existing=document.getElementById('assessExistingAttachment');
  existing.hidden=!row?.file_url;existing.innerHTML=row?.file_url?attachmentActionsHtml(row.file_url,row.file_type,row.title||'考核附件'):'';
  const removeButton=document.getElementById('assessFileRemove');removeButton.hidden=!row?.file_url;removeButton.disabled=false;removeButton.textContent='删除现有附件';
  setOcrTextResult(document.getElementById('assessOcrText'),null);
  document.getElementById('assessOcrStatus').textContent='';
  document.getElementById('assessChartTransferStatus').textContent='';
  document.getElementById('assessOcrScan').disabled=!(row?.file_url);
  document.getElementById('assessError').textContent='';
  document.getElementById('assessTitle').focus();
}
function openAssessmentEdit(id){const row=assessmentCourseId===currentCourseId&&assessmentRows.find(r=>r.id===id);if(row)openAssessmentModal(row);}
function closeAssessmentModal(){if(assessmentSaving)return;assessmentOcrController?.abort();assessmentOcrController=null;assessmentPendingChartSource=null;document.getElementById('assessmentModal').classList.remove('show');assessmentEdit=null;}

function assessmentFileChanged(){
  if(assessmentEdit)assessmentEdit.removeFile=false;
  const remove=document.getElementById('assessFileRemove');
  if(remove&&assessmentEdit?.existingFileUrl){remove.hidden=true;remove.disabled=false;remove.textContent='删除现有附件';}
  const existing=document.getElementById('assessExistingAttachment');
  if(existing)existing.hidden=true;
  clearAssessmentOcrResult();
  document.getElementById('assessOcrScan').disabled=!document.getElementById('assessFile').files?.length;
}

function clearAssessmentOcrResult(){
  const text=document.getElementById('assessOcrText'),status=document.getElementById('assessOcrStatus');
  setOcrTextResult(text,null);if(status)status.textContent='';
}

function removeAssessmentFile(){
  const state=assessmentEdit;
  if(!state?.existingFileUrl&&!state?.removeFile)return;
  if(state.removeFile){
    state.removeFile=false;
    document.getElementById('assessFileName').textContent='保留现有附件';
    document.getElementById('assessFilePick').textContent='更换附件';
    document.getElementById('assessExistingAttachment').hidden=false;
    document.getElementById('assessFileRemove').textContent='删除现有附件';
    document.getElementById('assessFileRemove').disabled=false;
    document.getElementById('assessOcrScan').disabled=false;
    return;
  }
  state.removeFile=true;
  document.getElementById('assessFile').value='';
  document.getElementById('assessFileName').textContent='保存后将删除现有附件';
  document.getElementById('assessFilePick').textContent='取消删除并保留';
  document.getElementById('assessExistingAttachment').hidden=true;
  document.getElementById('assessFileRemove').textContent='将删除（点击取消）';
  document.getElementById('assessFileRemove').disabled=false;
  clearAssessmentOcrResult();
  document.getElementById('assessOcrScan').disabled=true;
}

async function sendAssessmentChartSource(source,label){
  const text=String(source||'').trim();
  const status=document.getElementById('assessChartTransferStatus');
  if(!text){status.textContent=`${label}为空，未更新图表提取来源。`;return;}
  if(text.length>20000){status.textContent='图表提取来源最多 20000 字，请精简后再传入。';return;}
  status.textContent=`正在保存考核，并把最新${label}传入图表编辑器的“提取来源文字”…`;
  assessmentPendingChartSource=text;
  await addAssessment();
}

async function assessmentAttachmentBlob(){
  const state=assessmentEdit;
  const selected=document.getElementById('assessFile').files?.[0];
  if(selected)return {file:selected,type:selected.type||'',name:selected.name||'考核附件'};
  if(!state?.existingFileUrl||state.removeFile)throw new Error('请先选择或保留一个附件。');
  const url=attachmentUrl(state.existingFileUrl);
  if(!url)throw new Error('附件地址不可用。');
  assessmentOcrController?.abort();assessmentOcrController=new AbortController();
  const response=await fetch(url,{signal:assessmentOcrController.signal});
  if(!response.ok)throw new Error('附件读取失败，请确认文件仍存在。');
  const blob=await response.blob(),ext=extname(state.existingFileUrl),title=document.getElementById('assessTitle').value.trim()||'考核附件';
  const name=ext&&!title.toLowerCase().endsWith(ext.toLowerCase())?title+ext:title;
  return {file:new File([blob],name,{type:state.existingFileType||blob.type||''}),type:state.existingFileType||blob.type||'',name};
}

async function scanAssessmentAttachment(){
  const state=assessmentEdit,button=document.getElementById('assessOcrScan'),status=document.getElementById('assessOcrStatus');
  if(!state||button.disabled)return;
  button.disabled=true;const original=button.textContent;button.textContent='识别中…';status.textContent='正在读取附件…';
  assessmentOcrController?.abort();assessmentOcrController=new AbortController();
  try{
    const info=await assessmentAttachmentBlob();
    const file=info.file;
    let text='',warnings=[],ocrResult=null;
    if(/^text\//i.test(info.type||file.type||'')||/\.(txt|md|csv)$/i.test(file.name||''))text=await file.text();
    else{
      const result=await recognizeUploadedFile(file,message=>{status.textContent=message;},{signal:assessmentOcrController.signal});
      ocrResult=result;
      if(result.provider==='mock')throw new Error('当前 OCR 返回模拟结果，未填入；请检查识别服务。');
      text=result.text||'';warnings=result.warnings||[];
    }
    if(!text.trim())throw new Error('没有识别到文字。');
    if(assessmentEdit!==state)return;
    setOcrTextResult(document.getElementById('assessOcrText'),ocrResult||{text});
    status.textContent=warnings.join('；')||'识别完成，请校对后使用。';
  }catch(err){if(err.name!=='AbortError')status.textContent=err.message;}
  finally{if(assessmentEdit===state){button.disabled=!(document.getElementById('assessFile').files?.length||state.existingFileUrl&&!state.removeFile);button.textContent=original;}}
}

async function applyAssessmentOcrText(mode){
  const text=document.getElementById('assessOcrText').value.trim();
  const body=document.getElementById('assessReq'),status=document.getElementById('assessOcrStatus');
  if(!text){status.textContent='附件识别内容为空，正文未改变。';return;}
  if(mode==='replace'&&body.value.trim()&&!await showConfirm('用附件识别内容替换当前考核正文？原附件不会被修改。','替换考核正文'))return;
  const next=mode==='append'&&body.value.trim()?body.value.replace(/\s+$/,'')+'\n\n'+text:text;
  if(next.length>20000){status.textContent='合并后的考核正文超过 20000 字，正文未改变。';return;}
  body.value=next;status.textContent=mode==='append'?'识别内容已追加到考核正文，保存考核后生效。':'识别内容已填入考核正文，保存考核后生效。';
}

function bindAssessmentTools(){
  const scan=document.getElementById('assessOcrScan');
  if(!scan||scan.dataset.bound)return;
  scan.dataset.bound='1';
  scan.onclick=()=>void scanAssessmentAttachment();
  document.getElementById('assessFileRemove').onclick=removeAssessmentFile;
  document.getElementById('assessBodyToChartReference').onclick=()=>void sendAssessmentChartSource(document.getElementById('assessReq').value,'考核正文');
  document.getElementById('assessOcrToChartReference').onclick=()=>void sendAssessmentChartSource(document.getElementById('assessOcrText').value,'附件识别内容');
  document.getElementById('assessOcrAppend').onclick=()=>void applyAssessmentOcrText('append');
  document.getElementById('assessOcrReplace').onclick=()=>void applyAssessmentOcrText('replace');
}
if(typeof document!=='undefined'){
  if(document.readyState==='loading')addEventListener('DOMContentLoaded',bindAssessmentTools,{once:true});else bindAssessmentTools();
}
async function addAssessment() {
  if(assessmentSaving||!assessmentEdit)return;
  const state={...assessmentEdit},title=document.getElementById('assessTitle').value.trim(),deadline=document.getElementById('assessDeadline').value,requirement=document.getElementById('assessReq').value;
  const error=document.getElementById('assessError');error.textContent='';
  if(!title||title.length>200){error.textContent='请输入不超过 200 字的考核名称';return;}
  if(deadline&&assessmentDays(deadline)===null){error.textContent='请选择有效的截止日期';return;}
  if(requirement.length>20000){error.textContent='考核要求最多 20000 字';return;}
  assessmentSaving=true;
  const controls=[...document.querySelectorAll('#assessmentModal button,#assessmentModal input,#assessmentModal textarea')];controls.forEach(n=>n.disabled=true);
  try {
    let url=`${API}/courses/${state.courseId}/assessments`,options;
    const file=document.getElementById('assessFile').files?.[0];
    if(state.id&&!file&&!state.removeFile){url+='/'+state.id;options={method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,deadline,requirement})};}
    else {
      if(state.id)url+='/'+state.id;
      const fd=new FormData();fd.append('title',title);fd.append('deadline',deadline);fd.append('requirement',requirement);if(file)fd.append('file',file);if(state.id&&state.removeFile)fd.append('removeFile','true');
      options={method:state.id?'PUT':'POST',body:fd};
    }
    const response=await requestApi(url,options),saved=await response.json(),chartSource=assessmentPendingChartSource;
    assessmentPendingChartSource=null;assessmentSaving=false;closeAssessmentModal();showToast(state.id?'考核已更新':'考核已添加');
    if(currentCourseId===state.courseId)await loadAssessments();
    if(chartSource&&currentCourseId===state.courseId)openAssessmentChartEditor(saved.id,chartSource);
  }catch(err){assessmentPendingChartSource=null;error.textContent=err.message||'保存失败，请重试';}
  finally{assessmentSaving=false;controls.forEach(n=>n.disabled=false);}
}
async function toggleAssessmentCompleted(id) {
  const course=currentCourseId,row=assessmentCourseId===course&&assessmentRows.find(r=>r.id===id);
  if(!row||assessmentPending.has(id))return;
  const completed=!row.completed_at;assessmentPending.add(id);renderAssessments();
  try {await requestApi(`${API}/courses/${course}/assessments/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({completed})});showToast(completed?'已标记完成':'已恢复为未完成');if(currentCourseId===course)await loadAssessments();}
  catch(err){showToast(err.message||'更新失败，请重试');}
  finally{assessmentPending.delete(id);if(currentCourseId===course)renderAssessments();}
}
// Refresh date labels across midnight without issuing a network request.
setInterval(()=>{if(currentView?.type==='course'&&document.getElementById('pane-assessments')?.classList.contains('active'))renderAssessments();},60000);
