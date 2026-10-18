// 考前计划只负责选择、排期展示和调度；不读取知识框架，不实现复习步骤。
const PLAN_TYPE_LABELS = {mistake:'错题',material:'资料',note:'笔记'};
let reviewPlanCreate = null;
let reviewPlanDetail = null;
let reviewPlanRequest = 0;
let planReviewSession = null;
let planReviewStarting = false;
let reviewPlanCarousel = {courseId:null,plans:[],index:0};

function reviewPlanApi(id = '') { return `${API}/courses/${currentCourseId}/review-plans${id ? '/' + id : ''}`; }
function planLocalDate() { return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function planProgressHtml(plan) {
  return `<div class="plan-progress"><progress max="100" value="${plan.completionRate}" aria-label="完成率 ${plan.completionRate}%"></progress><span>${plan.completionRate}%</span></div><p class="detail-meta">总任务 ${plan.total} · 已完成 ${plan.completed} · 待完成 ${plan.pending} · 已跳过 ${plan.skipped}</p>`;
}
// 智能排期预览：后台按记忆状态算好的日程，渲染成月历；请求失败时整块不显示。
let planCalendar = null;
function planCalendarDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function planCalendarHtml() {
  const c = planCalendar;
  if (!c) return '';
  const first = new Date(Date.UTC(c.year, c.month, 1));
  const offset = (first.getUTCDay() + 6) % 7; // 周一为第一列
  const daysInMonth = new Date(Date.UTC(c.year, c.month + 1, 0)).getUTCDate();
  const today = planLocalDate();
  const cells = [];
  for (let i = 0; i < offset; i += 1) cells.push('<div class="plan-calendar-cell is-blank" aria-hidden="true"></div>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = planCalendarDate(c.year, c.month, day);
    const info = c.dayMap.get(date);
    const count = info ? info.items.length : 0;
    const overdue = !!info && date < today && info.state !== 'done';
    const classes = ['plan-calendar-cell'];
    if (!info) classes.push('is-empty');
    else classes.push('has-items');
    if (date === today) classes.push('is-today');
    if (info && info.state === 'done') classes.push('is-done');
    if (overdue) classes.push('is-overdue');
    if (date === c.examDate) classes.push('is-exam');
    const mark = date === c.examDate ? '<span class="plan-calendar-mark is-exam-mark">试</span>'
      : info && info.state === 'done' ? '<span class="plan-calendar-mark is-check">✓</span>'
        : overdue ? '<span class="plan-calendar-mark is-overdue-mark">!</span>'
          : info && date === today ? '<span class="plan-calendar-mark is-today-mark">▼</span>' : '';
    const title = info ? `${date} · ${count} 项 · 约 ${info.minutes} 分钟` : (date === c.examDate ? `${date} · 考试日` : '');
    cells.push(`<div class="${classes.join(' ')}" ${info ? `onclick="openPlanScheduleDay('${date}')"` : ''} ${title ? `title="${escapeHtml(title)}"` : ''}><span class="plan-calendar-day">${day}</span>${mark}${info ? `<span class="plan-calendar-count">${count} 项</span>` : ''}</div>`);
  }
  return `<div class="plan-calendar-head"><button type="button" onclick="shiftPlanCalendar(-1)" aria-label="上个月">‹</button><strong>${c.year} 年 ${c.month + 1} 月</strong><button type="button" onclick="shiftPlanCalendar(1)" aria-label="下个月">›</button></div>
    <div class="plan-calendar-week"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
    <div class="plan-calendar-grid">${cells.join('')}</div>
    <p class="plan-calendar-legend"><span class="is-today-mark">▼</span> 今天要复习 · <span class="is-check">✓</span> 已全部通过 · <span class="is-overdue-mark">!</span> 已过期未完成 · <span class="is-exam-mark">试</span> 考试日</p>`;
}
function planScheduleHtml(schedule) {
  if (!schedule || !Array.isArray(schedule.days)) return '';
  const feasibility = schedule.feasibility || {};
  const total = Array.isArray(schedule.occurrences) ? schedule.occurrences.length : 0;
  const [year, month] = String(schedule.today || '').split('-').map(Number);
  planCalendar = {
    year: year || new Date().getFullYear(),
    month: (month || 1) - 1,
    dayMap: new Map(schedule.days.map(day => [day.date, day])),
    examDate: schedule.examDate,
  };
  const warnings = (feasibility.warnings || []).map(text => `<li>${escapeHtml(text)}</li>`).join('');
  return `<section class="detail-card plan-schedule"><h2>智能排期预览</h2>
    <p class="detail-meta">按当前记忆状态估算：到考试前共 ${total} 次复习${feasibility.feasible ? '' : '，有内容排不下'}。点击有安排的日期可以查看当天内容，图例见日历下方。</p>
    <div id="reviewPlanCalendar">${planCalendarHtml()}</div>
    ${warnings ? `<ul class="plan-schedule-warnings">${warnings}</ul>` : ''}</section>`;
}
function shiftPlanCalendar(delta) {
  const c = planCalendar;
  if (!c) return;
  const date = new Date(Date.UTC(c.year, c.month + delta, 1));
  c.year = date.getUTCFullYear();
  c.month = date.getUTCMonth();
  const box = document.getElementById('reviewPlanCalendar');
  if (box) box.innerHTML = planCalendarHtml();
}
function openPlanScheduleDay(date) {
  const day = planCalendar?.dayMap.get(date);
  if (!day) return;
  const overdue = date < planLocalDate() && day.state !== 'done';
  const rows = ['mistake', 'material', 'note'].map(type => {
    const items = day.items.filter(item => item.type === type);
    if (!items.length) return ''; // 没有内容的类型不显示
    const minutes = items.reduce((sum, item) => sum + (Number(item.minutes) || 0), 0);
    return `<article class="review-day-card" data-plan-day-type="${type}"><div><strong>${PLAN_TYPE_LABELS[type]}</strong><p class="detail-meta">${items.length} 项 · 约 ${minutes} 分钟</p></div><button type="button" onclick="startPlanScheduleDay('${date}','${type}')">${day.state === 'done' ? '再复习一次' : '复习'}</button></article>`;
  }).join('');
  document.getElementById('reviewPlanDayTitle').textContent = `${date} · ${day.items.length} 项 · 约 ${day.minutes} 分钟`;
  document.getElementById('reviewPlanDayBody').innerHTML = `${day.state === 'done' ? '<p class="plan-day-done">当天已全部通过 ✓</p>'
    : day.state === 'partial' ? '<p class="plan-day-partial">当天还有未通过或跳过，可以继续。</p>' : ''}${rows}`;
  if (overdue) {
    const movedTo = Array.isArray(day.movedTo) ? day.movedTo.slice(0, 2) : [];
    document.getElementById('reviewPlanDayBody').insertAdjacentHTML('afterbegin',
      `<p class="plan-day-overdue">这一天的复习期限已过${movedTo.length ? `，未完成的项目已往后排到 ${movedTo.map(escapeHtml).join('、')}` : ''}。现在也可以继续补做。</p>`);
  }
  document.getElementById('reviewPlanDayModal').classList.add('show');
  document.body.classList.add('plan-day-open');
}
function closePlanScheduleDay() {
  document.getElementById('reviewPlanDayModal').classList.remove('show');
  document.body.classList.remove('plan-day-open');
}
async function startPlanScheduleDay(date, type) {
  const state = reviewPlanDetail, day = planCalendar?.dayMap.get(date);
  if (!state || !day || planReviewStarting) return;
  closePlanScheduleDay();
  const pending = state.items.filter(item => item.scheduled_date === date && item.item_type === type && item.status === 'pending');
  if (pending.length) return startReviewPlanDay(state.plan.id, date, type);
  const items = day.items.filter(item => item.type === type).map(item => ({ type: item.type, id: item.id }));
  if (!items.length) return;
  planReviewStarting = true;
  try {
    const session = await createReviewRecord('total', items, { requestId: reviewRequestId() });
    await enterCenterReview(session);
  } catch (err) { showToast(err.message); }
  finally { planReviewStarting = false; }
}
function rememberPlanPage(id = null) {
  mistakeStorageSet('review-center-location:'+currentCourseId,null);
  localStorage.setItem('currentTab','reviewPlans');
  localStorage.setItem('courseTimeStamp',Date.now());
  mistakeStorageSet('review-plan-location:' + currentCourseId,id ? {id} : null);
}
async function loadReviewPlans() {
  if (typeof loadRecentReviews==='function') loadRecentReviews();
  const request = ++reviewPlanRequest, courseId = currentCourseId;
  const box = document.getElementById('reviewPlanList'); box.innerHTML = '<p class="loading-tip">加载中…</p>';
  try {
    const plans = await requestList(reviewPlanApi());
    if (request!==reviewPlanRequest || courseId!==currentCourseId) return;
    const selected=mistakeStorageGet('review-plan-carousel:'+courseId);
    reviewPlanCarousel={courseId,plans,index:Math.max(0,plans.findIndex(plan=>plan.id===selected))};
    renderReviewPlanCarousel();
  } catch(err) {
    if (request===reviewPlanRequest && courseId===currentCourseId) {
      showListError(box,err); box.insertAdjacentHTML('beforeend','<button onclick="loadReviewPlans()">重试</button>');
    }
  }
}
function switchReviewPlanCard(delta) {
  const s=reviewPlanCarousel;if(s.courseId!==currentCourseId || !s.plans.length)return;
  s.index=(s.index+delta+s.plans.length)%s.plans.length;
  mistakeStorageSet('review-plan-carousel:'+currentCourseId,s.plans[s.index].id);renderReviewPlanCarousel();
}
function renderReviewPlanCarousel() {
  const {plans,index}=reviewPlanCarousel,plan=plans[index],box=document.getElementById('reviewPlanList');
  box.innerHTML = plan ? `<article class="detail-card plan-card" data-plan-id="${plan.id}">
      <div class="review-plan-card-top"><h2><button class="plan-title" onclick="openReviewPlan(${plan.id})">${escapeHtml(plan.name)}</button></h2><div class="review-plan-controls" role="group" aria-label="切换复习计划">${plans.length>1 ? '<button type="button" aria-label="上一个计划" onclick="switchReviewPlanCard(-1)">←</button>' : ''}<span aria-live="polite">当前计划 ${index+1} / ${plans.length}</span>${plans.length>1 ? '<button type="button" aria-label="下一个计划" onclick="switchReviewPlanCard(1)">→</button>' : ''}</div></div>
      <span class="material-review-badge">${{active:'进行中',completed:'已完成',expired:'已过期'}[plan.reviewState]}</span>
      <p>考试：${escapeHtml(plan.exam_date)} · ${plan.remainingDays ? `剩余 ${plan.remainingDays} 天` : '已到考试日期'}${plan.status==='archived' ? ' · 已归档' : ''}</p>
      ${planProgressHtml(plan)}<p>今日 ${plan.todayStats.pending} 项待复习</p>
      <div class="mistake-toolbar"><button onclick="openReviewPlan(${plan.id})">查看计划</button><button onclick="startReviewPlanDay(${plan.id},'${plan.today}')" ${plan.status!=='active' || !plan.todayStats.pending ? 'disabled' : ''}>开始今日复习</button></div>
    </article>` : '<div class="review-center-empty"><p>还没有考前复习计划</p><span>点击右上角「创建计划」，安排每日复习任务。</span></div>';
}
function openReviewPlanCreate() {
  if(reviewPlanCreate?.busy)return;
  reviewPlanCreate={courseId:currentCourseId,rows:[],ids:new Set(),tab:'material',filters:createReviewPickerFilters(),loading:true,busy:false,preview:null,validationTouched:false,returnFocus:document.activeElement};
  document.getElementById('reviewPlanForm').reset();document.getElementById('reviewPlanStart').value=planLocalDate();
  document.getElementById('reviewPlanCreateError').textContent='';
  document.getElementById('reviewPlanSelector').hidden=false;document.getElementById('reviewPlanContentPreview').hidden=true;
  restoreReviewPlanFilters();
  document.getElementById('reviewPlanModal').classList.add('show');document.body.classList.add('plan-modal-open');
  document.getElementById('reviewPlanName').focus();renderReviewPlanSelection();return loadReviewPlanCandidates();
}
function closeReviewPlanCreate() {
  if(reviewPlanCreate?.busy)return;
  const focus=reviewPlanCreate?.returnFocus;reviewPlanCreate=null;
  document.getElementById('reviewPlanContentPreviewBody').replaceChildren();
  document.getElementById('reviewPlanModal').classList.remove('show');document.body.classList.remove('plan-modal-open');
  if(focus?.isConnected)focus.focus({preventScroll:true});
}
async function loadReviewPlanCandidates() {
  const state=reviewPlanCreate;if(!state)return;state.loading=true;renderReviewPlanSelection();
  try {
    // 原计划候选接口仍决定可选范围；现有总复习候选补充直接关联标签/OCR，不请求知识树。
    const [rows,tagged]=await Promise.all([requestList(reviewPlanApi('candidates')),requestList(reviewSessionApi('candidates',state.courseId))]);
    if(reviewPlanCreate!==state || currentCourseId!==state.courseId)return;
    const byKey=new Map(tagged.map(row=>[row.type+':'+row.id,row]));
    state.rows=rows.map(row=>({...row,nodes:byKey.get(row.type+':'+row.id)?.nodes || [],ocr_text:byKey.get(row.type+':'+row.id)?.ocr_text || ''}));
    state.loading=false;document.getElementById('reviewPlanCreateError').textContent='';renderReviewPlanSelection();
  }catch(err){if(reviewPlanCreate===state){state.loading=false;renderReviewPlanSelection();document.getElementById('reviewPlanCreateError').innerHTML=`${escapeHtml(err.message)}<button type="button" onclick="loadReviewPlanCandidates()">重试加载</button>`;}}
}
function saveReviewPlanFilters() {
  const s=reviewPlanCreate;if(!s)return;
  Object.assign(s.filters[s.tab],{q:document.getElementById('reviewPlanSearch').value,favorite:document.getElementById('reviewPlanFavorite').checked,
    status:document.getElementById('reviewPlanStatus').value,category:document.getElementById('reviewPlanMistakeType').value});
}
function restoreReviewPlanFilters() {
  const s=reviewPlanCreate,f=s.filters[s.tab];
  document.getElementById('reviewPlanSearch').value=f.q;document.getElementById('reviewPlanFavorite').checked=f.favorite;
  document.getElementById('reviewPlanStatus').value=f.status;document.getElementById('reviewPlanMistakeType').value=f.category;
  document.getElementById('reviewPlanMistakeType').hidden=s.tab!=='mistake';
}
function rememberReviewPlanScroll() {
  const s=reviewPlanCreate;if(s && !s.preview)s.filters[s.tab].scroll=document.getElementById('reviewPlanCandidates').scrollTop;
}
function switchReviewPlanTab(type) {
  const s=reviewPlanCreate;if(!s || s.busy || s.preview || !Object.hasOwn(s.filters,type) || s.tab===type)return;
  saveReviewPlanFilters();rememberReviewPlanScroll();s.tab=type;restoreReviewPlanFilters();renderReviewPlanSelection();
}
function toggleReviewPlanTags() {const s=reviewPlanCreate;if(!s || s.busy)return;s.filters[s.tab].tagsOpen=!s.filters[s.tab].tagsOpen;renderReviewPickerTags(s,'reviewPlan','changeReviewPlanTag');}
function changeReviewPlanTag(id,checked) {const s=reviewPlanCreate;if(!s || s.busy)return;const tags=s.filters[s.tab].tags;if(checked)tags.add(id);else tags.delete(id);renderReviewPlanSelection();}
function filteredReviewPlanCandidates() {
  const s=reviewPlanCreate;if(!s)return [];saveReviewPlanFilters();
  const f=s.filters[s.tab],q=f.q.trim().toLowerCase();
  return s.rows.filter(row=>row.type===s.tab && (!f.category || row.type!=='mistake' || row.mistake_type===f.category)
    && (!f.status || row.review_status===f.status) && (!f.favorite || !!row.favorite)
    && (!q || `${row.title}\n${row.content}\n${row.ocr_text || ''}`.toLowerCase().includes(q))
    && (!f.tags.size || row.nodes.some(tag=>f.tags.has(tag.id))));
}
function renderReviewPlanSelection() {
  const s=reviewPlanCreate;if(!s)return;
  const rows=filteredReviewPlanCandidates(),list=document.getElementById('reviewPlanCandidates'),scroll=s.filters[s.tab].scroll,focused=document.activeElement?.dataset.planChoice;
  document.querySelectorAll('#reviewPlanModules [role=tab]').forEach(button=>{const selected=button.id==='reviewPlanTab-'+s.tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected ? 0 : -1;button.disabled=s.busy;});
  document.getElementById('reviewPlanPanel').setAttribute('aria-labelledby','reviewPlanTab-'+s.tab);
  document.getElementById('reviewPlanListTitle').textContent=PLAN_TYPE_LABELS[s.tab]+'列表';
  renderReviewPickerTags(s,'reviewPlan','changeReviewPlanTag');
  list.innerHTML=s.loading ? '<p class="loading-tip">加载中…</p>' : rows.length ? rows.map(row=>reviewPickerCard(row,s.ids.has(row.type+':'+row.id),s.busy,'data-plan-choice','selectReviewPlanItem','openReviewPlanPreview')).join('') : '<p class="empty">没有符合条件的内容。</p>';
  list.scrollTop=scroll;if(focused)list.querySelector(`[data-plan-choice="${focused}"]`)?.focus({preventScroll:true});
  const eligible=rows.filter(row=>row.reviewable),count=eligible.filter(row=>s.ids.has(row.type+':'+row.id)).length,all=document.getElementById('reviewPlanSelectAll');
  all.checked=!!eligible.length && count===eligible.length;all.indeterminate=count>0 && count<eligible.length;all.disabled=s.loading || s.busy || !eligible.length;
  document.getElementById('reviewPlanCount').textContent=`已选择 ${s.ids.size} 项`;
  document.getElementById('reviewPlanCounts').textContent=['material','note','mistake'].map(type=>`${PLAN_TYPE_LABELS[type]} ${[...s.ids].filter(key=>key.startsWith(type+':')).length}`).join(' · ');
  for(const id of ['reviewPlanName','reviewPlanStart','reviewPlanExam','reviewPlanSearch','reviewPlanFavorite','reviewPlanStatus','reviewPlanMistakeType','reviewPlanTagsToggle'])document.getElementById(id).disabled=s.busy;
  renderReviewPlanPreview();
}
function selectReviewPlanItem(key,checked) {
  const s=reviewPlanCreate;if(!s || s.busy || s.loading || !s.rows.some(row=>row.type+':'+row.id===key && row.reviewable))return;
  rememberReviewPlanScroll();if(checked)s.ids.add(key);else s.ids.delete(key);renderReviewPlanSelection();
}
function selectAllReviewPlanItems(checked) {
  const s=reviewPlanCreate;if(!s || s.busy || s.loading)return;rememberReviewPlanScroll();
  for(const row of filteredReviewPlanCandidates().filter(row=>row.reviewable)){const key=row.type+':'+row.id;if(checked)s.ids.add(key);else s.ids.delete(key);}
  renderReviewPlanSelection();
}
function clearReviewPlanItems() {if(reviewPlanCreate && !reviewPlanCreate.busy){rememberReviewPlanScroll();reviewPlanCreate.ids.clear();renderReviewPlanSelection();}}
function reviewPlanInputError() {
  const name=document.getElementById('reviewPlanName').value.trim(),start=document.getElementById('reviewPlanStart').value,exam=document.getElementById('reviewPlanExam').value;
  if(!name)return '请填写计划名称';if(name.length>100)return '计划名称不能超过 100 字';
  if(!start)return '请选择开始日期';if(!exam)return '请选择考试日期';
  const valid=value=>/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(Date.parse(value+'T00:00:00Z')).toISOString().slice(0,10)===value;
  if(!valid(start) || !valid(exam))return '请选择有效日期';
  const days=(Date.parse(exam+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000;
  if(days<=0)return '考试日期必须晚于开始日期，考试当天不安排复习';
  if(days>3660)return '复习计划不能超过 3660 天';
  return '';
}
function renderReviewPlanPreview() {
  const s=reviewPlanCreate;if(!s)return;
  const start=document.getElementById('reviewPlanStart').value,exam=document.getElementById('reviewPlanExam').value,error=reviewPlanInputError();
  const days=(Date.parse(exam+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000,count=s.ids.size;
  document.getElementById('reviewPlanValidation').textContent=s.validationTouched || document.getElementById('reviewPlanName').value || exam ? error : '';
  document.getElementById('reviewPlanGenerate').disabled=s.busy || s.loading || !count || !!error;
  document.getElementById('reviewPlanPreview').textContent=`共选择 ${count} 项。`+(Number.isFinite(days) && days>0 && days<=3660
    ? `复习 ${days} 天，每天约 ${Math.floor(count/days)}～${Math.ceil(count/days)} 项。考试当天不排任务。` : '请选择开始日期和考试日期，考试当天不排任务。');
}
async function openReviewPlanPreview(key,trigger=document.activeElement) {
  const s=reviewPlanCreate;if(!s || s.busy || s.loading)return;
  const row=s.rows.find(row=>row.type+':'+row.id===key);if(!row)return;saveReviewPlanFilters();rememberReviewPlanScroll();
  return openReviewPickerPreview(s,row,trigger,REVIEW_PICKER_PREVIEWS.plan,()=>reviewPlanCreate===s,'openReviewPlanPreview');
}
function closeReviewPlanPreview() {if(reviewPlanCreate)closeReviewPickerPreview(reviewPlanCreate,REVIEW_PICKER_PREVIEWS.plan,'reviewPlanTab-'+reviewPlanCreate.tab);}
function handleReviewPlanPickerKey(event) {
  const s=reviewPlanCreate;if(!s)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(s.preview)closeReviewPlanPreview();else closeReviewPlanCreate();return;}
  const tabs=[...document.querySelectorAll('#reviewPlanModules [role=tab]')],index=tabs.indexOf(event.target);
  if(index>=0 && !s.busy && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
    event.preventDefault();const next=event.key==='Home' ? 0 : event.key==='End' ? 2 : (index+(event.key==='ArrowRight' ? 1 : 2))%3;
    switchReviewPlanTab(['material','note','mistake'][next]);tabs[next].focus();
  }
  trapReviewPickerFocus(event,'reviewPlanModal');
}
async function createReviewPlan() {
  const state=reviewPlanCreate;if(!state || state.busy || state.loading || state.preview)return;
  const error=reviewPlanInputError();if(error || !state.ids.size){state.validationTouched=true;renderReviewPlanPreview();document.getElementById('reviewPlanCreateError').textContent=error || '请至少选择一项复习内容';return;}
  const body={name:document.getElementById('reviewPlanName').value.trim(),startDate:document.getElementById('reviewPlanStart').value,
    examDate:document.getElementById('reviewPlanExam').value,selectedItems:[...state.ids].map(key=>{const [type,id]=key.split(':');return {type,id:Number(id)};})};
  state.busy=true;renderReviewPlanSelection();document.getElementById('reviewPlanCreateError').textContent='';
  try {
    const response=await requestApi(reviewPlanApi(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),plan=await response.json();
    if(state!==reviewPlanCreate || state.courseId!==currentCourseId)return;
    state.busy=false;closeReviewPlanCreate();await openReviewPlan(plan.id);
  }catch(err){if(state===reviewPlanCreate)document.getElementById('reviewPlanCreateError').textContent=err.message;}
  finally{state.busy=false;renderReviewPlanSelection();}
}
async function openReviewPlan(id) {
  const request = ++reviewPlanRequest, courseId = currentCourseId;
  currentView = {type:'reviewPlan',id}; showPageOnly('reviewPlanDetailPage'); rememberPlanPage(id);
  const box = document.getElementById('reviewPlanDetailBody'); box.innerHTML = '<p class="loading-tip">加载中…</p>';
  try {
    const [response,items,scheduleResponse] = await Promise.all([requestApi(reviewPlanApi(id)),requestList(reviewPlanApi(id+'/items')),
      requestApi(reviewPlanApi(id+'/schedule')).catch(()=>null)]);
    const plan = await response.json();
    const schedule = scheduleResponse ? await scheduleResponse.json().catch(()=>null) : null;
    if (request!==reviewPlanRequest || courseId!==currentCourseId || currentView.type!=='reviewPlan') return;
    reviewPlanDetail = {plan,items,schedule,courseId}; renderReviewPlanDetail();
  } catch(err) {
    if (request===reviewPlanRequest && courseId===currentCourseId) {
      showListError(box,err); box.insertAdjacentHTML('beforeend',`<button onclick="openReviewPlan(${id})">重试</button><button onclick="backToReviewPlans()">返回计划列表</button>`);
    }
  }
}
function backToReviewPlans() { ++reviewPlanRequest; if(typeof clearCenterReviewUi==='function')clearCenterReviewUi();rememberPlanPage(); currentView={type:'course',tab:'reviewPlans'}; showPageOnly('detailPage'); switchTab('reviewPlans'); }
function renderReviewPlanDetail() {
  const state = reviewPlanDetail; if (!state || state.courseId!==currentCourseId) return;
  const {plan,items} = state;
  document.getElementById('reviewPlanDetailTitle').textContent = plan.name;
  const today = plan.todayStats;
  const todayText = !today.total ? '今日没有安排复习任务' : today.pending ? `今日 ${today.pending} 项待复习` : today.completed ? '今日复习已完成' : '今日任务均已跳过';
  document.getElementById('reviewPlanDetailBody').innerHTML = `<section class="detail-card"><h2>${escapeHtml(plan.name)}</h2><p>考试日期：${plan.exam_date} · 剩余 ${plan.remainingDays} 天${plan.status==='archived' ? ' · 已归档' : ''}</p>
    ${planProgressHtml(plan)}<p>${todayText}</p><button id="reviewPlanTodayStart" onclick="startReviewPlanDay(${plan.id},'${plan.today}')" ${!today.pending || plan.status!=='active' ? 'disabled' : ''}>开始今日复习</button>
    <p class="detail-meta">错题 → 资料 → 笔记，按类型使用原有复习页面；也可在日期下分别进入。跳过阅读仍保留待完成任务。</p>
    <details class="plan-settings"><summary>管理计划</summary><label>计划名称<input id="reviewPlanRename" maxlength="100" value="${escapeHtml(plan.name)}" /></label><div class="mistake-toolbar"><button onclick="saveReviewPlanName()">保存名称</button><button onclick="changeReviewPlanStatus()">${plan.status==='active' ? '归档计划' : '恢复计划'}</button><button onclick="deleteCurrentReviewPlan()">删除计划</button></div><p class="detail-meta">日期和复习范围创建后固定；需要调整时请重新生成计划。</p></details></section>
    ${planScheduleHtml(state.schedule)}
    <div id="reviewPlanDays">${plan.days.map(day=>{
      const rows = items.filter(item=>item.scheduled_date===day.date);
      const label = day.date===plan.today ? '今天' : day.date===new Date(Date.parse(plan.today+'T00:00:00Z')+86400000).toISOString().slice(0,10) ? '明天' : '';
      return `<details class="detail-card plan-day" data-plan-date="${day.date}" ${day.date===plan.today ? 'open' : ''}><summary>${label ? label+' · ' : ''}${day.date} <span>已完成 ${day.completed} / ${day.total-day.skipped} · 待完成 ${day.pending} · 已跳过 ${day.skipped}</span></summary>
        <div class="plan-day-types">${Object.entries(PLAN_TYPE_LABELS).map(([type,name])=>`<div><span>${name} ${day.types[type].total} 项 · 完成 ${day.types[type].completed}</span><button data-plan-start="${type}" onclick="startReviewPlanDay(${plan.id},'${day.date}','${type}')" ${!day.types[type].pending || plan.status!=='active' ? 'disabled' : ''}>复习${name}</button></div>`).join('')}</div>
        ${rows.length ? rows.map(item=>`<div class="plan-task" data-plan-item="${item.id}"><span>${item.status==='completed' ? '✓' : item.status==='skipped' ? '—' : '○'} ${PLAN_TYPE_LABELS[item.item_type]} · ${escapeHtml(item.title_snapshot)}</span><small>${item.source_deleted ? '内容已删除' : item.status==='completed' ? '已完成' : item.status==='skipped' ? '已跳过' : !item.reviewable ? '请先补齐题目或答案' : '待复习'}</small>${!item.source_deleted && item.item_type==='mistake' && !item.reviewable ? `<button onclick="openMistakeDetail(${item.item_id},false)">补齐内容</button>` : ''}</div>`).join('') : '<p class="empty">这一天没有安排任务。</p>'}
      </details>`;
    }).join('')}</div>`;
}
async function patchCurrentReviewPlan(body) {
  const state = reviewPlanDetail;
  if (!state || state.busy) return;
  state.busy = true;
  try { await requestApi(reviewPlanApi(state.plan.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); if (state.courseId===currentCourseId) await openReviewPlan(state.plan.id); }
  catch(err) { showToast(err.message); } finally { state.busy = false; }
}
function saveReviewPlanName() { return patchCurrentReviewPlan({name:document.getElementById('reviewPlanRename').value}); }
function changeReviewPlanStatus() { return patchCurrentReviewPlan({status:reviewPlanDetail.plan.status==='active' ? 'archived' : 'active'}); }
async function deleteCurrentReviewPlan() {
  const state = reviewPlanDetail; if (!state || state.busy || !await showConfirm('删除计划及其排期任务？原有资料、笔记、错题会保留。','删除复习计划')) return;
  if (state!==reviewPlanDetail || state.courseId!==currentCourseId) return;
  state.busy = true;
  try { await requestApi(reviewPlanApi(state.plan.id),{method:'DELETE'}); backToReviewPlans(); }
  catch(err) { showToast(err.message); } finally { state.busy = false; }
}

// 薄调度层：复用原控制器和原步骤恢复；计划只提供对象映射、存储键和返回来源。
async function startReviewPlanDay(planId,date,type = null, restoring = false) {
  if (planReviewStarting || mistakeReviewBusy || activeReadingReview.busy || mistakeQueueLoading) return;
  const courseId = currentCourseId; planReviewStarting = true;
  try {
    const [response,tasks] = await Promise.all([requestApi(reviewPlanApi(planId)),requestList(reviewPlanApi(`${planId}/items?scheduledDate=${encodeURIComponent(date)}`))]);
    const plan = await response.json();
    if (courseId!==currentCourseId) return;
    if (plan.status!=='active') throw new Error('计划已归档，请先恢复计划');
    const pending = tasks.filter(item=>item.status==='pending');
    type ||= ['mistake','material','note'].find(kind=>pending.some(item=>item.item_type===kind));
    const rows = pending.filter(item=>item.item_type===type);
    if (!rows.length) {
      mistakeStorageSet('review-plan-session:'+courseId,null); planReviewSession=null;
      showToast('该日期的任务已处理，未自动重新排期'); await openReviewPlan(planId); return;
    }
    if (rows.some(item=>!item.reviewable)) throw new Error('有错题缺少题目或答案，请展开日期并先补齐内容');
    const storageKey = `review-plan-queue:${courseId}:${planId}:${date}:${type}`;
    const context = {courseId,planId,date,type,storageKey,items:Object.fromEntries(rows.map(item=>[item.item_id,item.id]))};
    const saved = mistakeStorageGet(storageKey);
    const pendingIds = new Set(rows.map(item=>item.item_id));
    const reusable = saved && !saved.finished && saved.courseId===courseId && Array.isArray(saved.ids) && saved.ids.length
      && Number.isInteger(saved.index) && saved.index>=0 && saved.index<saved.ids.length
      && saved.ids.slice(saved.index).every(id=>pendingIds.has(id));
    const requestKey='review-plan-session-request:'+storageKey,selectionKey=rows.map(item=>item.id).join(',');
    let creation=mistakeStorageGet(requestKey);
    if(!creation || creation.selectionKey!==selectionKey){creation={requestId:reviewRequestId(),selectionKey};mistakeStorageSet(requestKey,creation);}
    const session=reusable && saved.sessionId ? await recordedReviewAction(saved.sessionId,'resume')
      : await createReviewRecord('plan',rows.map(item=>({type:item.item_type,id:item.item_id})),{planId,date,requestId:creation.requestId});
    mistakeStorageSet(requestKey,null);
    context.sessionId=session.id;
    const sessionItems=reviewSessionMap(session);
    planReviewSession = context; mistakeStorageSet('review-plan-session:'+courseId,context); rememberPlanPage(planId);
    if (type==='mistake') {
      mistakeQueue = reusable ? readMistakeQueue(storageKey) : null;
      mistakeQueue ||= {courseId,type:'mixed',types:Object.fromEntries(rows.map(item=>[item.item_id,item.mistake_type])),ids:rows.map(item=>item.item_id),index:0,rounds:{},finished:false};
      mistakeQueue.storageKey=storageKey; mistakeQueue.planContext=context; saveMistakeQueue();
      mistakeQueue.sessionId=session.id;mistakeQueue.sessionItems=sessionItems;saveMistakeQueue();
      await openMistakeDetail(mistakeQueue.ids[mistakeQueue.index],true);
    } else {
      const controller = createReadingReview(type==='material' ? 'materials' : 'notes',PLAN_TYPE_LABELS[type],null,
        {storageKey,planItems:context.items,sessionId:session.id,sessionItems,onExit:returnFromPlanReview,onFinish:returnFromPlanReview});
      if (reusable && saved.active) await controller.restore(courseId);
      else if (reusable) await controller.resume();
      else await controller.startItems(rows.map(item=>item.item_id));
    }
  } catch(err) {
    showToast(err.message);
    if (restoring && courseId===currentCourseId) { mistakeStorageSet('review-plan-session:'+courseId,null); planReviewSession=null; await openReviewPlan(planId); }
  } finally { planReviewStarting=false; }
}
async function returnFromPlanReview() {
  const session = planReviewSession || mistakeQueue?.planContext;
  if (!session || session.courseId!==currentCourseId) return;
  if(session.sessionId)await recordedReviewAction(session.sessionId,'pause');
  mistakeStorageSet('review-plan-session:'+currentCourseId,null);
  if (mistakeQueue?.planContext) mistakeQueue=null;
  planReviewSession=null; activeReadingReview=materialReadingReview; navStack=[];
  await openReviewPlan(session.planId);
}
async function restoreReviewPlanLocation(courseId) {
  if (courseId!==currentCourseId) return;
  const session = mistakeStorageGet('review-plan-session:'+courseId);
  if (session && session.courseId===courseId && Number.isSafeInteger(session.planId) && Object.hasOwn(PLAN_TYPE_LABELS,session.type) && /^\d{4}-\d{2}-\d{2}$/.test(session.date)) {
    await startReviewPlanDay(session.planId,session.date,session.type,true); return;
  }
  const saved=mistakeStorageGet('review-plan-location:'+courseId);
  if (Number.isSafeInteger(saved?.id) && saved.id>0) await openReviewPlan(saved.id);
}
