// 考前计划只负责选择、排期展示和调度；不读取知识框架，不实现复习步骤。
const PLAN_TYPE_LABELS = {mistake:'错题',material:'资料',note:'笔记'};
let reviewPlanCreate = null;
let reviewPlanDetail = null;
let reviewPlanRequest = 0;
let reviewPlanSurfaceLoading=0;
let planReviewSession = null;
let planReviewStarting = false;
let reviewPlanCarousel = {courseId:null,plans:[],index:0};
let reviewPlanCompletedPreview = null;

function reviewPlanApi(id = '') { return `${API}/courses/${currentCourseId}/review-plans${id ? '/' + id : ''}`; }
function planLocalDate() { return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function planProgressHtml(plan) {
  // 只统计仍然存在的任务；来源删除后总数和成功数立即按有效任务重算。
  // 有完整排期统计时以它为准（含后续多轮），和日历里看到的内容保持一致。
  const stats = plan.scheduleStats && plan.scheduleStats.total ? plan.scheduleStats : null;
  const total = stats ? stats.total : plan.total;
  const completed = stats ? stats.passed : plan.completed;
  const pending = stats ? stats.pending : plan.pending;
  const skipped = stats ? stats.skipped : plan.skipped;
  const rate = stats ? stats.completionRate : plan.completionRate;
  return `<div class="plan-progress"><span class="plan-progress-label">总进度</span><progress max="100" value="${rate}" aria-label="有效任务成功复习进度 ${rate}%"></progress><span class="plan-progress-value">${rate}%</span></div><p class="detail-meta plan-success-count"><strong>成功复习 ${completed} / ${total}</strong> · 待完成 ${pending} · 已跳过 ${skipped}</p>`;
}
// 智能排期预览：后台按记忆状态算好的日程，渲染成月历；请求失败时整块不显示。
let planCalendar = null;
let planDayOpenedAt = 0;
// 当天有真实会话时以会话项目为准（包含已跳过/未通过），否则用排期预估。
function planDayItems(day) {
  if (!day) return [];
  const items = new Map();
  for (const item of day.items || []) items.set(item.type + ':' + item.id, { ...item });
  for (const item of day.sessionItems || []) {
    const key = item.type + ':' + item.id;
    const current = items.get(key);
    if (current) {
      items.set(key, {
        ...current,
        ...(item.title ? { title: item.title } : {}),
        ...(item.status !== undefined ? { status: item.status } : {}),
        ...(item.result !== undefined ? { result: item.result } : {}),
      });
    } else {
      items.set(key, { ...item, minutes: Number(item.minutes) || 5, roundNo: item.roundNo || 1 });
    }
  }
  return [...items.values()];
}
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
    const dayItems = planDayItems(info);
    const count = dayItems.length;
    const passed = dayItems.filter(item => item.status === 'completed' && item.result === 'passed').length;
    const minutes = dayItems.reduce((sum, item) => sum + (Number(item.minutes) || 0), 0);
    const overdue = !!info && date < today && info.state !== 'done';
    const classes = ['plan-calendar-cell'];
    if (!info) classes.push('is-empty');
    else classes.push('has-items');
    if (date === today && info) classes.push('is-today');
    if (info && info.state === 'done') classes.push('is-done');
    if (overdue) classes.push('is-overdue');
    if (date === c.examDate) classes.push('is-exam');
    const mark = date === c.examDate ? '<span class="plan-calendar-mark is-exam-mark">试</span>'
      : info && info.state === 'done' ? '<span class="plan-calendar-mark is-check">✓</span>'
        : overdue ? '<span class="plan-calendar-mark is-overdue-mark">!</span>'
          : info && date === today ? '<span class="plan-calendar-mark is-today-mark">▼</span>' : '';
    const title = info ? `${date} · 成功复习 ${passed}/${count} 项 · 约 ${minutes} 分钟`
      : date === c.examDate ? `${date} · 考试日`
        : date === today ? `${date} · 今天没有安排` : '';
    if (info) {
      cells.push(`<button type="button" class="${classes.join(' ')}" data-plan-date="${date}" ${title ? `title="${escapeHtml(title)}"` : ''}><span class="plan-calendar-day">${day}</span>${mark}<span class="plan-calendar-count">${passed}/${count}项</span></button>`);
    } else {
      cells.push(`<div class="${classes.join(' ')}" ${title ? `title="${escapeHtml(title)}"` : ''}><span class="plan-calendar-day">${day}</span>${mark}</div>`);
    }
  }
  const applyButton = c.hasNewSchedule ? '<button type="button" class="plan-calendar-apply" onclick="applyPlanSchedule()">应用新排期</button>' : '';
  return `<div class="plan-calendar-head"><button type="button" onclick="shiftPlanCalendar(-1)" aria-label="上个月">‹</button><strong>${c.year} 年 ${c.month + 1} 月</strong><div class="plan-calendar-actions"><button type="button" onclick="shiftPlanCalendar(1)" aria-label="下个月">›</button>${applyButton}</div></div>
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
    hasNewSchedule: !!schedule.hasNewSchedule,
  };
  const reasonLabels = {content_deleted:'计划内有内容被删除',completed_early:'提前完成了未来的复习任务',overdue:'有任务未按安排在当天内完成'};
  const reasons = (schedule.rescheduleReasons || []).map(reason => reasonLabels[reason]).filter(Boolean);
  const adjustment = schedule.hasNewSchedule ? `<p class="detail-meta">需要调整：${escapeHtml(reasons.join('；') || '计划执行情况发生变化')}。点击“应用新排期”后生效。</p>` : '';
  const warnings = (feasibility.warnings || []).map(text => `<li>${escapeHtml(text)}</li>`).join('');
  return `<section class="detail-card plan-schedule"><h2>智能排期预览</h2>
    <p class="detail-meta">当前排期共 ${total} 次复习${feasibility.feasible ? '' : '，有内容排不下'}。点击有安排的日期可以查看当天内容，图例见日历下方。</p>
    ${adjustment}
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
async function applyPlanSchedule() {
  const state = reviewPlanDetail;
  if (!state || state.busy) return;
  state.busy = true;
  try {
    await requestApi(reviewPlanApi(state.plan.id + '/schedule/apply'), { method: 'POST' });
    if (state.courseId === currentCourseId) await openReviewPlan(state.plan.id);
  } catch (err) { showToast(err.message); }
  finally { state.busy = false; }
}
// 事件委托：整格（含内部文字、标记）都算点击，不依赖具体子元素。
function bindPlanCalendarClicks() {
  const box = document.getElementById('reviewPlanCalendar');
  if (!box || box.dataset.bound) return;
  box.addEventListener('click', event => {
    const cell = event.target.closest('[data-plan-date]');
    if (cell) openPlanScheduleDay(cell.dataset.planDate);
  });
  box.dataset.bound = '1';
}
function openPlanScheduleDay(date) {
  const day = planCalendar?.dayMap.get(date);
  if (!day) return;
  planDayOpenedAt = Date.now();
  const today = planLocalDate();
  const overdue = date < today && day.state !== 'done';
  const future = date > today;
  // 总量永远按“当天完整排期”算；会话只覆盖其中一部分状态时，不能把其他项目藏掉。
  const source = planDayItems(day);
  const statsTotal = source.length;
  const statsPassed = source.filter(item => item.status === 'completed' && item.result === 'passed').length;
  const statsSkipped = source.filter(item => item.status === 'skipped').length;
  const stats = statsTotal
    ? `<p class="plan-day-stats">成功复习 ${statsPassed} / ${statsTotal} · 待完成 ${statsTotal - statsPassed} · 已跳过 ${statsSkipped}</p>` : '';
  const minutes = source.reduce((sum, item) => sum + (Number(item.minutes) || 0), 0);
  const pending = source.filter(item => !item.status || item.status === 'pending').length;
  const skipped = source.filter(item => item.status === 'skipped').length;
  const failed = source.filter(item => item.status === 'completed' && item.result === 'failed').length;
  const passed = source.filter(item => item.status === 'completed' && item.result === 'passed').length;
  const allPassed = source.length > 0 && passed === source.length;
  const allProcessed = source.length > 0 && source.every(item => item.status === 'completed');
  const hasProgress = passed + failed + skipped > 0;
  const taskHeading = [['material','份资料'],['note','篇笔记'],['mistake','道错题']]
    .map(([type,unit])=>{const count=source.filter(item=>item.type===type).length;return count?`${count} ${unit}`:'';})
    .filter(Boolean).join(' · ');
  // 全部任务按资料 → 笔记 → 错题进入同一个会话；完成状态优先于“继续”。
  const label = allPassed ? '再来一次' : hasProgress ? '继续' : '复习';
  const detail = `${source.length} 项 · 约 ${minutes} 分钟${failed ? ` · 未通过 ${failed}` : ''}${skipped ? ` · 跳过 ${skipped}` : ''}`;
  const dayCard = source.length ? `<article class="review-day-card" data-plan-day-type="all"><div><strong>${taskHeading}</strong><p class="detail-meta">${detail}</p></div><div class="review-day-card-actions">${allProcessed?`<button type="button" class="plan-day-preview" onclick="openPlanDayAnswersPreview(${reviewPlanDetail.plan.id},'${date}')">查看作答</button>`:''}<button type="button" onclick="startPlanScheduleDay('${date}',null,'${label}')">${label}</button></div></article>` : '';
  document.getElementById('reviewPlanDayTitle').textContent = `${date} · ${source.length} 项 · 约 ${minutes} 分钟`;
  document.getElementById('reviewPlanDayBody').innerHTML = `${stats}${day.state === 'done' ? `<p class="plan-day-done">当天已全部通过 ✓${future ? '（提前完成）' : ''}</p>`
    : day.state === 'partial' ? '<p class="plan-day-partial">当天还有未通过或跳过，可以继续。</p>' : ''}${dayCard}`;
  if (future) {
    document.getElementById('reviewPlanDayBody').insertAdjacentHTML('afterbegin',
      '<p class="plan-day-early">提前复习会缩短这道题的间隔收益；完成后会按今天重新计算下次复习。</p>');
  }
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
// 遮罩点击关闭：刚打开 350ms 内的点击视为同一次手势/双击，不关闭。
function closePlanScheduleDayFromMask() {
  if (Date.now() - planDayOpenedAt < 350) return;
  closePlanScheduleDay();
}
async function startPlanScheduleDay(date, type, action = '复习') {
  const state = reviewPlanDetail, day = planCalendar?.dayMap.get(date);
  if (!state || !day || planReviewStarting) return;
  closePlanScheduleDay();
  if (state.plan.status !== 'active') { showToast('计划已归档，请先恢复计划'); return; }
  if (!type && action === '继续' && day.sessionId && ['active', 'paused'].includes(day.sessionStatus)) return resumeReviewRecord(day.sessionId);
  const source = planDayItems(day).filter(item => !item.sourceDeleted);
  const selected = (action === '再来一次'
    ? source
    : action === '继续'
      ? source.filter(item => !(item.status === 'completed' && item.result === 'passed'))
      : source.filter(item => !item.status || item.status === 'pending'))
    .sort((a, b) => ({material:0,note:1,mistake:2}[a.type] ?? 3) - ({material:0,note:1,mistake:2}[b.type] ?? 3));
  if (!selected.length) {
    showToast(action === '继续' ? '这一天没有需要继续的内容' : '这一天没有可复习的任务');
    return;
  }
  await startReviewPlanDay(state.plan.id, date, null, false, selected.map(item => ({type:item.type,id:item.id})));
}
function rememberPlanPage(id = null,fromList=false) {
  mistakeStorageSet('review-center-location:'+currentCourseId,null);
  localStorage.setItem('currentTab','reviewPlans');
  localStorage.setItem('courseTimeStamp',Date.now());
  mistakeStorageSet('review-plan-location:' + currentCourseId,id ? {id,fromList} : null);
}
function setReviewPlanCompletedPreview(planId,date){
  reviewPlanCompletedPreview=Number.isSafeInteger(planId)&&/^\d{4}-\d{2}-\d{2}$/.test(String(date||''))?{courseId:currentCourseId,planId,date}:null;
}
function openReviewPlanCompletedAnswers(){
  const preview=reviewPlanCompletedPreview;
  if(!preview||preview.courseId!==currentCourseId||!reviewPlanDetail||reviewPlanDetail.plan.id!==preview.planId)return;
  return openPlanDayAnswersPreview(preview.planId,preview.date);
}
async function loadReviewPlans() {
  reviewPlanSurfaceLoading++;
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
  } finally {reviewPlanSurfaceLoading--;}
}
let planSurfaceRefreshTimer = null;
function refreshReviewPlanSurface() {
  if (document.visibilityState === 'hidden') return;
  clearTimeout(planSurfaceRefreshTimer);
  planSurfaceRefreshTimer = setTimeout(() => {
    if(reviewPlanSurfaceLoading||reviewPlanCreate)return;
    if (currentView.type === 'reviewPlan') void openReviewPlan(currentView.id);
    else if(currentView.type==='reviewPlanList')void loadAllReviewPlans();
    else if (currentView.type === 'course' && currentView.tab === 'reviewPlans') void loadReviewPlans();
  }, 250);
}
addEventListener('focus', refreshReviewPlanSurface);
addEventListener('pageshow', refreshReviewPlanSurface);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshReviewPlanSurface();
});
function switchReviewPlanCard(delta) {
  const s=reviewPlanCarousel;if(s.courseId!==currentCourseId || !s.plans.length)return;
  s.index=(s.index+delta+s.plans.length)%s.plans.length;
  mistakeStorageSet('review-plan-carousel:'+currentCourseId,s.plans[s.index].id);renderReviewPlanCarousel();
}
function openAllReviewPlans(){
  if(typeof clearCenterReviewUi==='function')clearCenterReviewUi();
  currentView={type:'reviewPlanList'};showPageOnly('reviewPlanListPage');rememberPlanPage();
  mistakeStorageSet('review-plan-location:'+currentCourseId,{view:'list'});
  return loadAllReviewPlans();
}
async function loadAllReviewPlans(){
  reviewPlanSurfaceLoading++;
  const courseId=currentCourseId,request=++reviewPlanRequest,box=document.getElementById('reviewPlanAllList');
  box.textContent='加载中…';document.getElementById('reviewPlanAllCount').textContent='';
  try{
    const plans=await requestList(reviewPlanApi());
    if(courseId!==currentCourseId||request!==reviewPlanRequest||currentView.type!=='reviewPlanList')return;
    document.getElementById('reviewPlanAllCount').textContent=`共 ${plans.length} 个计划（含已归档和已过期计划）`;
    box.innerHTML=plans.length?plans.map(plan=>reviewPlanCardHtml(plan)).join(''):'<p class="empty">暂无复习计划，可点击右上角创建计划。</p>';
  }catch(err){
    if(courseId===currentCourseId&&request===reviewPlanRequest&&currentView.type==='reviewPlanList'){
      showListError(box,err);box.insertAdjacentHTML('beforeend','<button type="button" onclick="loadAllReviewPlans()">重试</button>');
    }
  }finally{reviewPlanSurfaceLoading--;}
}
function renderReviewPlanCarousel() {
  const {plans,index}=reviewPlanCarousel,plan=plans[index],box=document.getElementById('reviewPlanList');
  const toggle=document.getElementById('reviewPlanViewAll');
  toggle.textContent=`查看全部${plans.length?'（'+plans.length+'）':''}`;
  const controls=`<div class="review-plan-controls" role="group" aria-label="切换复习计划">${plans.length>1 ? '<button type="button" aria-label="上一个计划" onclick="switchReviewPlanCard(-1)">←</button>' : ''}<span aria-live="polite">当前计划 ${index+1} / ${plans.length}</span>${plans.length>1 ? '<button type="button" aria-label="下一个计划" onclick="switchReviewPlanCard(1)">→</button>' : ''}</div>`;
  box.innerHTML = plan ? reviewPlanCardHtml(plan,controls) : '<div class="review-center-empty"><p>还没有考前复习计划</p><span>点击右上角「创建计划」，安排每日复习任务。</span></div>';
}
function reviewPlanCardHtml(plan,controls=''){
  return `<article class="detail-card plan-card review-record" data-plan-id="${plan.id}">
      <div class="review-plan-card-top"><h2><button class="plan-title" onclick="openReviewPlan(${plan.id})">${escapeHtml(plan.name)}</button></h2>${controls}</div>
      <span class="material-review-badge">${{active:'进行中',completed:'已完成',expired:'已过期'}[plan.reviewState]}</span>
      <p>考试：${escapeHtml(plan.exam_date)} · ${plan.remainingDays ? `剩余 ${plan.remainingDays} 天` : '已到考试日期'}${plan.status==='archived' ? ' · 已归档' : ''}</p>
      ${planProgressHtml(plan)}<p>今日 ${plan.todayStats.pending} 项待复习</p>
      <div class="mistake-toolbar"><button onclick="openReviewPlan(${plan.id})">查看计划</button><button type="button" onclick="openReviewPlanEdit(${plan.id})">编辑计划</button><button onclick="startReviewPlanDay(${plan.id},'${plan.today}')" ${plan.status!=='active' || !plan.todayStats.pending ? 'disabled' : ''}>开始今日复习</button></div>
    </article>`;
}
function openReviewPlanEdit(id) {return openReviewPlanCreate(id);}
function openReviewPlanCreate(editId=null) {
  if(reviewPlanCreate?.busy)return;
  reviewPlanCreate={courseId:currentCourseId,editId,originalIds:new Set(),rows:[],ids:new Set(),tab:'material',filters:createReviewPickerFilters(),loading:true,busy:false,preview:null,validationTouched:false,returnFocus:document.activeElement};
  document.getElementById('reviewPlanCreateTitle').textContent=editId?'编辑复习计划':'创建考前复习计划';
  document.querySelector('#reviewPlanSelector .total-review-close').setAttribute('aria-label',editId?'关闭编辑计划':'关闭创建计划');
  document.querySelector('#reviewPlanContentPreview .total-review-preview-foot button').textContent=editId?'返回编辑计划':'返回创建计划';
  document.querySelector('#reviewPlanContentPreview .total-review-close').setAttribute('aria-label',editId?'关闭预览，返回编辑计划':'关闭预览，返回创建计划');
  document.getElementById('reviewPlanForm').reset();document.getElementById('reviewPlanStart').value=planLocalDate();
  document.getElementById('reviewPlanBody').scrollTop=0;
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
    // 原计划候选接口仍决定可选范围；现有复习候选补充直接关联标签/OCR，不请求知识树。
    const [rows,tagged,plan,items]=await Promise.all([requestList(reviewPlanApi('candidates')),requestList(reviewSessionApi('candidates',state.courseId)),
      state.editId?requestApi(reviewPlanApi(state.editId)).then(r=>r.json()):null,state.editId?requestList(reviewPlanApi(state.editId+'/items')):[]]);
    if(reviewPlanCreate!==state || currentCourseId!==state.courseId)return;
    const byKey=new Map(tagged.map(row=>[row.type+':'+row.id,row]));
    state.rows=rows.map(row=>({...row,nodes:byKey.get(row.type+':'+row.id)?.nodes || [],ocr_text:byKey.get(row.type+':'+row.id)?.ocr_text || ''}));
    if(plan&&!state.originalPlan){
      state.originalPlan=plan;state.originalIds=new Set(items.map(item=>item.item_type+':'+item.item_id));state.ids=new Set(state.originalIds);
      state.completedCount=items.filter(item=>item.status==='completed').length;
      document.getElementById('reviewPlanName').value=plan.name;document.getElementById('reviewPlanStart').value=plan.start_date;document.getElementById('reviewPlanExam').value=plan.exam_date;
    }
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
  const s=reviewPlanCreate;if(s && !s.preview){
    const body=document.getElementById('reviewPlanBody');
    s.filters[s.tab].scroll=body?body.scrollTop:document.getElementById('reviewPlanCandidates').scrollTop;
  }
}
function switchReviewPlanTab(type) {
  const s=reviewPlanCreate;if(!s || s.busy || s.preview || !Object.hasOwn(s.filters,type) || s.tab===type)return;
  saveReviewPlanFilters();rememberReviewPlanScroll();s.tab=type;restoreReviewPlanFilters();renderReviewPlanSelection();
  const panel=document.getElementById('reviewPlanPanel');panel.classList.remove('tab-enter');void panel.offsetWidth;panel.classList.add('tab-enter');
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
  document.getElementById('reviewPlanModules').style.setProperty('--tab-index',['material','note','mistake'].indexOf(s.tab));
  document.getElementById('reviewPlanPanel').setAttribute('aria-labelledby','reviewPlanTab-'+s.tab);
  document.getElementById('reviewPlanListTitle').textContent=PLAN_TYPE_LABELS[s.tab]+'列表';
  renderReviewPickerTags(s,'reviewPlan','changeReviewPlanTag');
  list.innerHTML=s.loading ? '<p class="loading-tip">加载中…</p>' : rows.length ? rows.map(row=>reviewPickerCard({...row,reviewable:row.reviewable||s.originalIds.has(row.type+':'+row.id)},s.ids.has(row.type+':'+row.id),s.busy,'data-plan-choice','selectReviewPlanItem','openReviewPlanPreview')).join('') : '<p class="empty">没有符合条件的内容。</p>';
  list.scrollTop=scroll;const scrollBody=document.getElementById('reviewPlanBody');if(scrollBody)scrollBody.scrollTop=scroll;
  if(focused)list.querySelector(`[data-plan-choice="${focused}"]`)?.focus({preventScroll:true});
  const eligible=rows.filter(row=>row.reviewable),count=eligible.filter(row=>s.ids.has(row.type+':'+row.id)).length,all=document.getElementById('reviewPlanSelectAll');
  all.checked=!!eligible.length && count===eligible.length;all.indeterminate=count>0 && count<eligible.length;all.disabled=s.loading || s.busy || !eligible.length;
  document.getElementById('reviewPlanCount').textContent=`已选择 ${s.ids.size} 项`;
  document.getElementById('reviewPlanCounts').textContent=['material','note','mistake'].map(type=>`${PLAN_TYPE_LABELS[type]} ${[...s.ids].filter(key=>key.startsWith(type+':')).length}`).join(' · ');
  for(const id of ['reviewPlanName','reviewPlanStart','reviewPlanExam','reviewPlanSearch','reviewPlanFavorite','reviewPlanStatus','reviewPlanMistakeType','reviewPlanTagsToggle'])document.getElementById(id).disabled=s.busy;
  document.getElementById('reviewPlanStart').disabled=s.busy||!!s.editId;
  if(s.editId)document.getElementById('reviewPlanStart').title='开始日期保留原值；编辑只调整剩余任务';else document.getElementById('reviewPlanStart').removeAttribute('title');
  renderReviewPlanPreview();
}
function selectReviewPlanItem(key,checked) {
  const s=reviewPlanCreate;if(!s || s.busy || s.loading || !s.rows.some(row=>row.type+':'+row.id===key && (row.reviewable||s.originalIds.has(key))))return;
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
  if(reviewPlanCreate?.editId&&reviewPlanEditChanges().reschedule&&exam<=planLocalDate())return '调整排期时，考试日期必须晚于今天';
  return '';
}
function reviewPlanEditChanges(){
  const s=reviewPlanCreate;
  if(!s?.originalPlan)return {added:0,removed:0,reschedule:false};
  const added=[...s.ids].filter(key=>!s.originalIds.has(key)).length,removed=[...s.originalIds].filter(key=>!s.ids.has(key)).length;
  return {added,removed,reschedule:!!(added||removed||document.getElementById('reviewPlanExam').value!==s.originalPlan.exam_date)};
}
function renderReviewPlanPreview() {
  const s=reviewPlanCreate;if(!s)return;
  const start=document.getElementById('reviewPlanStart').value,exam=document.getElementById('reviewPlanExam').value,error=reviewPlanInputError();
  const days=(Date.parse(exam+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000,count=s.ids.size;
  document.getElementById('reviewPlanValidation').textContent=s.validationTouched || document.getElementById('reviewPlanName').value || exam ? error : '';
  document.getElementById('reviewPlanGenerate').disabled=s.busy || s.loading || !count || !!error;
  document.getElementById('reviewPlanPreview').textContent=`共选择 ${count} 项。`+(Number.isFinite(days) && days>0 && days<=3660
    ? `复习 ${days} 天，每天约 ${Math.floor(count/days)}～${Math.ceil(count/days)} 项。考试当天不排任务。` : '请选择开始日期和考试日期，考试当天不排任务。');
  if(s.editId){
    const changes=reviewPlanEditChanges();
    document.getElementById('reviewPlanGenerate').textContent=changes.reschedule?'保存并调整剩余排期':'保存修改';
    document.getElementById('reviewPlanGenerate').disabled ||= !s.originalPlan;
    document.getElementById('reviewPlanPreview').textContent=`已选择 ${count} 项；新增 ${changes.added} 项，移除 ${changes.removed} 项。`+(changes.reschedule
      ? `保存后将调整剩余排期；已完成任务 ${s.completedCount||0} 项及历史作答保留。考试当天不排任务。`
      :'仅修改名称不会重新排期，复习进度和历史作答保留。');
  }else document.getElementById('reviewPlanGenerate').textContent='创建计划';
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
    if(state.editId){delete body.startDate;body.expectedVersion=state.originalPlan.editVersion;}
    const response=await requestApi(reviewPlanApi(state.editId||''),{method:state.editId?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),plan=await response.json();
    if(state!==reviewPlanCreate || state.courseId!==currentCourseId)return;
    state.busy=false;closeReviewPlanCreate();if(state.editId)showToast('计划修改已保存');await openReviewPlan(plan.id);
  }catch(err){if(state===reviewPlanCreate)document.getElementById('reviewPlanCreateError').textContent=err.message;}
  finally{state.busy=false;renderReviewPlanSelection();}
}
async function openReviewPlan(id,fromList=null) {
  if(fromList===null)fromList=currentView.type==='reviewPlanList'||(currentView.type==='reviewPlan'&&!!reviewPlanDetail?.fromList);
  reviewPlanSurfaceLoading++;
  const request = ++reviewPlanRequest, courseId = currentCourseId;
  currentView = {type:'reviewPlan',id}; showPageOnly('reviewPlanDetailPage'); rememberPlanPage(id,fromList);
  const box = document.getElementById('reviewPlanDetailBody'); box.innerHTML = '<p class="loading-tip">加载中…</p>';
  try {
    const [response,items,scheduleResponse] = await Promise.all([requestApi(reviewPlanApi(id)),requestList(reviewPlanApi(id+'/items')),
      requestApi(reviewPlanApi(id+'/schedule')).catch(()=>null)]);
    const plan = await response.json();
    const schedule = scheduleResponse ? await scheduleResponse.json().catch(()=>null) : null;
    if (request!==reviewPlanRequest || courseId!==currentCourseId || currentView.type!=='reviewPlan') return;
    reviewPlanDetail = {plan,items,schedule,courseId,fromList}; renderReviewPlanDetail();
  } catch(err) {
    if (request===reviewPlanRequest && courseId===currentCourseId) {
      showListError(box,err); box.insertAdjacentHTML('beforeend',`<button onclick="openReviewPlan(${id})">重试</button><button onclick="backToReviewPlans()">返回计划列表</button>`);
    }
  } finally {reviewPlanSurfaceLoading--;}
}
function backToReviewPlans() { ++reviewPlanRequest; reviewPlanCompletedPreview=null; if(typeof clearCenterReviewUi==='function')clearCenterReviewUi();rememberPlanPage(); currentView={type:'course',tab:'reviewPlans'}; showPageOnly('detailPage'); switchTab('reviewPlans'); }
function backFromReviewPlan(){return reviewPlanDetail?.fromList?openAllReviewPlans():backToReviewPlans();}
function renderReviewPlanDetail() {
  const state = reviewPlanDetail; if (!state || state.courseId!==currentCourseId) return;
  const {plan,items} = state;
  document.getElementById('reviewPlanDetailTitle').textContent = plan.name;
  const today = plan.todayStats;
  const todayText = !today.total ? '今日没有安排复习任务' : today.pending ? `今日 ${today.pending} 项待复习` : today.completed ? '今日复习已完成' : '今日任务均已跳过';
  document.getElementById('reviewPlanDetailBody').innerHTML = `<section class="detail-card"><h2>${escapeHtml(plan.name)}</h2><p>考试日期：${plan.exam_date} · 剩余 ${plan.remainingDays} 天${plan.status==='archived' ? ' · 已归档' : ''}</p>
    ${planProgressHtml(plan)}<p>${todayText}</p><div class="mistake-toolbar"><button type="button" onclick="openReviewPlanEdit(${plan.id})">编辑计划</button><button id="reviewPlanTodayStart" onclick="startReviewPlanDay(${plan.id},'${plan.today}')" ${!today.pending || plan.status!=='active' ? 'disabled' : ''}>开始今日复习</button>${reviewPlanCompletedPreview?.courseId===currentCourseId&&reviewPlanCompletedPreview.planId===plan.id?'<button type="button" onclick="openReviewPlanCompletedAnswers()">查看本轮作答预览</button>':''}</div>
    <p class="detail-meta">错题 → 资料 → 笔记，按类型使用原有复习页面；点日历上的日期可以查看当天安排并开始复习。跳过阅读仍保留待完成任务。</p>
    <details class="plan-settings"><summary>管理计划</summary><div class="mistake-toolbar"><button onclick="changeReviewPlanStatus()">${plan.status==='active' ? '归档计划' : '恢复计划'}</button><button onclick="deleteCurrentReviewPlan()">删除计划</button></div><p class="detail-meta">名称、考试日期和复习内容可通过“编辑计划”修改；已完成任务及历史作答保留。</p></details></section>
    ${planScheduleHtml(state.schedule)}`;
  bindPlanCalendarClicks();
}
async function patchCurrentReviewPlan(body) {
  const state = reviewPlanDetail;
  if (!state || state.busy) return;
  state.busy = true;
  try { await requestApi(reviewPlanApi(state.plan.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); if (state.courseId===currentCourseId) await openReviewPlan(state.plan.id); }
  catch(err) { showToast(err.message); } finally { state.busy = false; }
}
function changeReviewPlanStatus() { return patchCurrentReviewPlan({status:reviewPlanDetail.plan.status==='active' ? 'archived' : 'active'}); }
async function deleteCurrentReviewPlan() {
  const state = reviewPlanDetail; if (!state || state.busy || !await showConfirm('删除计划及其排期任务？原有资料、笔记、错题会保留。','删除复习计划')) return;
  if (state!==reviewPlanDetail || state.courseId!==currentCourseId) return;
  state.busy = true;
  try { await requestApi(reviewPlanApi(state.plan.id),{method:'DELETE'}); backToReviewPlans(); }
  catch(err) { showToast(err.message); } finally { state.busy = false; }
}

// 薄调度层：复用原控制器和原步骤恢复；计划只提供对象映射、存储键和返回来源。
async function startReviewPlanDay(planId,date,type = null, restoring = false, selectedItems = null) {
  if (planReviewStarting || mistakeReviewBusy || activeReadingReview.busy || mistakeQueueLoading) return;
  if(type==='mixed')type=null;
  if(!selectedItems && !type && reviewPlanDetail?.courseId===currentCourseId && reviewPlanDetail.plan?.id===planId){
    const day=reviewPlanDetail.schedule?.days?.find(item=>item.date===date);
    if(day){
      selectedItems=planDayItems(day).filter(item=>!item.sourceDeleted)
        .map(item=>({type:item.type,id:item.id}));
      if(!selectedItems.length)selectedItems=null;
    }
  }
  const unified=type===null;
  const courseId = currentCourseId; planReviewStarting = true;
  try {
    const [response,tasks] = await Promise.all([requestApi(reviewPlanApi(planId)),requestList(reviewPlanApi(`${planId}/items?scheduledDate=${encodeURIComponent(date)}`))]);
    const plan = await response.json();
    if (courseId!==currentCourseId) return;
    if (plan.status!=='active') throw new Error('计划已归档，请先恢复计划');
    const pending = tasks.filter(item=>item.status==='pending');
    let rows;
    if(selectedItems){
      const wanted=new Set(selectedItems.map(item=>item.type+':'+item.id));
      rows=tasks.filter(item=>wanted.has(item.item_type+':'+item.item_id));
      if(rows.length!==wanted.size){
        const allPlanTasks=await requestList(reviewPlanApi(planId+'/items'));
        rows=allPlanTasks.filter(item=>wanted.has(item.item_type+':'+item.item_id));
      }
      if(rows.length!==wanted.size)throw new Error('部分计划任务已不可复习，请重新打开当天任务');
    }else{
      const available=unified?pending:pending.filter(item=>item.item_type===type);
      rows=available;
    }
    rows.sort((a,b)=>({material:0,note:1,mistake:2}[a.item_type]??3)-({material:0,note:1,mistake:2}[b.item_type]??3)
      ||(Number(a.sort_order)||0)-(Number(b.sort_order)||0)||a.item_id-b.item_id);
    if (!rows.length) {
      mistakeStorageSet('review-plan-session:'+courseId,null); planReviewSession=null;
      showToast('该日期的任务已处理，未自动重新排期'); await openReviewPlan(planId); return;
    }
    if (rows.some(item=>!item.reviewable)) throw new Error('有错题缺少题目或答案，请展开日期并先补齐内容');
    const storageKey = `review-plan-queue:${courseId}:${planId}:${date}:${type||'all'}`;
    const context = {courseId,planId,date,type:type||'mixed',storageKey,
      items:Object.fromEntries(rows.map(item=>[unified?item.item_type+':'+item.item_id:item.item_id,item.id]))};
    const saved = mistakeStorageGet(storageKey);
    const pendingIds = new Set(rows.map(item=>item.item_id));
    const reusable = saved && !saved.finished && saved.courseId===courseId && Array.isArray(saved.ids) && saved.ids.length
      && Number.isInteger(saved.index) && saved.index>=0 && saved.index<saved.ids.length
      && saved.ids.slice(saved.index).every(id=>pendingIds.has(id));
    const requestKey='review-plan-session-request:'+storageKey,selectionKey=rows.map(item=>item.item_type+':'+item.item_id).join(',');
    let creation=mistakeStorageGet(requestKey);
    if(!creation || creation.selectionKey!==selectionKey){creation={requestId:reviewRequestId(),selectionKey};mistakeStorageSet(requestKey,creation);}
    const session=reusable && saved.sessionId ? await recordedReviewAction(saved.sessionId,'resume')
      : await createReviewRecord('plan',rows.map(item=>({type:item.item_type,id:item.item_id})),{planId,date,requestId:creation.requestId});
    mistakeStorageSet(requestKey,null);
    context.sessionId=session.id;
    const sessionItems=reviewSessionMap(session);
    planReviewSession = context; mistakeStorageSet('review-plan-session:'+courseId,context); rememberPlanPage(planId);
    if(unified){
      await enterCenterReview(session);
    }else if (type==='mistake') {
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
  let sourceSession=null;
  if(session.sessionId){try{sourceSession=await(await requestApi(`${API}/courses/${session.courseId}/review-sessions/${session.sessionId}`)).json();}catch{}}
  await showCompletedPlanDay(session.planId,session.date,sourceSession);
}
async function showCompletedPlanDay(planId,date,sourceSession=null){
  await openReviewPlan(planId);
  const day=reviewPlanDetail?.schedule?.days?.find(item=>item.date===date);
  const dayItems=day?.items||[];
  const passed=dayItems.filter(item=>item.status==='completed'&&item.result==='passed').length;
  const failed=dayItems.filter(item=>item.status==='completed'&&item.result==='failed').length;
  const exposed=dayItems.filter(item=>item.status==='completed'&&item.result==='exposure').length;
  const skipped=dayItems.filter(item=>item.status==='skipped').length;
  const allPassed=dayItems.length>0&&passed===dayItems.length;
  const allProcessed=dayItems.length>0&&dayItems.every(item=>item.status==='completed');
  setReviewPlanCompletedPreview(planId,allProcessed&&!skipped?date:null);
  if(allPassed&&typeof openReviewCompleteModal==='function'){
    const session={...(sourceSession||{}),status:'completed',source_type:'plan',source_id:planId,source_date:date,
      total:dayItems.length,passed,failed,exposed,skipped,pending:0,
      items:dayItems.map(item=>({item_type:item.type,title:item.title}))};
    await openReviewCompleteModal(session,{type:'plan',planId,date});
  }else if(day){
    openPlanScheduleDay(date);
  }
}
async function restoreReviewPlanLocation(courseId) {
  if (courseId!==currentCourseId) return;
  const saved=mistakeStorageGet('review-plan-location:'+courseId);
  if(saved?.view==='list'){await openAllReviewPlans();return;}
  const session = mistakeStorageGet('review-plan-session:'+courseId);
  if (session && session.courseId===courseId && Number.isSafeInteger(session.planId)
    && (session.type==='mixed'||Object.hasOwn(PLAN_TYPE_LABELS,session.type))
    && /^\d{4}-\d{2}-\d{2}$/.test(session.date)) {
    if(session.sessionId){await resumeReviewRecord(session.sessionId);return;}
    await startReviewPlanDay(session.planId,session.date,session.type==='mixed'?null:session.type,true); return;
  }
  if (Number.isSafeInteger(saved?.id) && saved.id>0) await openReviewPlan(saved.id,!!saved.fromList);
}
