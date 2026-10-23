/* Course assessments: explicit completion, editing, and calendar-day deadlines. */
let assessmentRows=[],assessmentCourseId=null,assessmentLoad=0,assessmentEdit=null,assessmentSaving=false;
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
  if(!assessmentRows.length){box.innerHTML='<div class="empty">暂无考核，添加后可查看截止提醒并记录完成状态。</div>';return;}
  const rows=[...assessmentRows].sort((a,b)=>Number(!!a.completed_at)-Number(!!b.completed_at)||(assessmentDays(a.deadline)===null?1:0)-(assessmentDays(b.deadline)===null?1:0)||String(a.deadline||'').localeCompare(String(b.deadline||''))||a.id-b.id);
  box.innerHTML='<p class="assessment-sort-hint">未完成考核按截止日期排序，已完成考核放在最后。</p>'+rows.map(r=>{
    const timing=assessmentTiming(r),busy=assessmentPending.has(r.id);
    return `<article class="item-row assessment-card ${r.completed_at?'assessment-completed':''}"><div class="info"><div class="assessment-card-head"><h3>${escapeHtml(r.title)}</h3><span class="assessment-deadline assessment-${timing.kind}">${timing.text}</span></div><p class="meta">截止日期：${escapeHtml(r.deadline||'未设置')}</p>${r.requirement?`<p class="row-content">${escapeHtml(r.requirement)}</p>`:''}</div><div class="assessment-actions">${r.file_url?`<a class="detail-link" href="${escapeHtml(r.file_url)}" target="_blank" rel="noopener noreferrer">查看附件</a>`:''}<button type="button" onclick="openAssessmentEdit(${r.id})" ${busy?'disabled':''}>编辑</button><button type="button" class="${r.completed_at?'':'ai-primary'}" onclick="toggleAssessmentCompleted(${r.id})" ${busy?'disabled':''}>${r.completed_at?'恢复未完成':'标记已完成'}</button><button type="button" class="assessment-delete" onclick="delItem('assessments',${r.id},loadAssessments)" ${busy?'disabled':''}>删除</button></div></article>`;
  }).join('');
}
async function loadAssessments() {
  const course=currentCourseId,token=++assessmentLoad,box=document.getElementById('assessmentList');
  box.innerHTML='<div class="loading-tip">加载中…</div>';
  try {const rows=await requestList(`${API}/courses/${course}/assessments`);if(token!==assessmentLoad||course!==currentCourseId)return;assessmentRows=rows;assessmentCourseId=course;renderAssessments();}
  catch(err){if(token===assessmentLoad&&course===currentCourseId)showListError(box,err);}
}
function openAssessmentModal(row=null) {
  if(assessmentSaving)return;
  assessmentEdit={id:row?.id||null,courseId:currentCourseId};
  document.getElementById('assessmentModal').classList.add('show');
  document.getElementById('assessModalTitle').textContent=row?'编辑考核':'添加考核';
  document.getElementById('assessTitle').value=row?.title||'';
  document.getElementById('assessDeadline').value=row?.deadline||'';
  document.getElementById('assessReq').value=row?.requirement||'';
  document.getElementById('assessFile').value='';
  document.getElementById('assessAttachment').hidden=!!row;
  document.getElementById('assessFileName').textContent='未选择附件';
  document.getElementById('assessError').textContent='';
  document.getElementById('assessTitle').focus();
}
function openAssessmentEdit(id){const row=assessmentCourseId===currentCourseId&&assessmentRows.find(r=>r.id===id);if(row)openAssessmentModal(row);}
function closeAssessmentModal(){if(assessmentSaving)return;document.getElementById('assessmentModal').classList.remove('show');assessmentEdit=null;}
async function addAssessment() {
  if(assessmentSaving||!assessmentEdit)return;
  const state={...assessmentEdit},title=document.getElementById('assessTitle').value.trim(),deadline=document.getElementById('assessDeadline').value,requirement=document.getElementById('assessReq').value;
  const error=document.getElementById('assessError');error.textContent='';
  if(!title||title.length>200){error.textContent='请输入不超过 200 字的考核名称';return;}
  if(deadline&&assessmentDays(deadline)===null){error.textContent='请选择有效的截止日期';return;}
  if(requirement.length>4000){error.textContent='考核要求最多 4000 字';return;}
  assessmentSaving=true;
  const controls=[...document.querySelectorAll('#assessmentModal button,#assessmentModal input,#assessmentModal textarea')];controls.forEach(n=>n.disabled=true);
  try {
    let url=`${API}/courses/${state.courseId}/assessments`,options;
    if(state.id){url+='/'+state.id;options={method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,deadline,requirement})};}
    else {const fd=new FormData();fd.append('title',title);fd.append('deadline',deadline);fd.append('requirement',requirement);const file=document.getElementById('assessFile').files?.[0];if(file)fd.append('file',file);options={method:'POST',body:fd};}
    await requestApi(url,options);assessmentSaving=false;closeAssessmentModal();showToast(state.id?'考核已更新':'考核已添加');if(currentCourseId===state.courseId)await loadAssessments();
  }catch(err){error.textContent=err.message||'保存失败，请重试';}
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
