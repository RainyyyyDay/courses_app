// 课程复习中心：历史、总复习选择与薄调度层。内容呈现和判断复用原控制器。
const REVIEW_SOURCE_LABELS={plan:'考前计划复习',total:'总复习',material:'资料复习',note:'笔记复习',mistake:'错题复习'};
let reviewHistoryState=null;
let reviewSessionDetail=null;
let totalReviewState=null;
let centerReview=null;
let reviewCenterRequest=0;
let reviewRecordBusy=false;
function reviewSessionApi(id='',courseId=currentCourseId) {return `${API}/courses/${courseId}/review-sessions${id ? '/'+id : ''}`;}
function reviewRequestId() {return typeof crypto.randomUUID==='function' ? crypto.randomUUID() : Date.now()+'-'+Math.random().toString(36).slice(2);}
async function reviewSessionRequest(id,body={},courseId=currentCourseId) {
  const response=await requestApi(reviewSessionApi(id,courseId),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return response.json();
}
async function createReviewRecord(sourceType,selectedItems,options={}) {
  return reviewSessionRequest('',{sourceType,selectedItems,requestId:options.requestId || reviewRequestId(),
    ...(options.planId ? {sourceId:options.planId,scheduledDate:options.date} : {})});
}
function reviewSessionMap(session) {return Object.fromEntries(session.items.map(item=>[item.item_id,item.id]));}
async function recordedReviewAction(id,action,body={}) {return reviewSessionRequest(id+'/'+action,body);}
async function resumeRecordedReview(id) {
  const response=await requestApi(reviewSessionApi(id)),row=await response.json();
  if(row.status==='paused')await recordedReviewAction(id,'resume');
}
function reviewTime(value) {return value ? new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}) : '尚未完成';}
// 只有全部项目都顺利通过复习模式才算「已完成」；有未通过或跳过只算「过了一遍」。
function reviewSessionBadge(row) {
  if (row.status==='completed') {
    if(row.exposed===row.total)return '已阅读（仅曝光）';
    if (row.skipped===row.total) return '全部跳过';
    if ((row.passed || 0)===row.total) return '已完成';
    return '未全部通过';
  }
  return {active:'进行中',paused:'已暂停，可继续'}[row.status] || row.status;
}
// 进度条拆三段：蓝色=已通过，橙色=未通过，灰色=跳过，空白=待处理。
function reviewProgressHtml(row) {
  const total = Math.max(1, Number(row.total) || 0);
  const width = value => Math.min(100, Math.round((Number(value) || 0) / total * 100));
  return `<div class="review-progress-split" role="img" aria-label="已通过 ${row.passed || 0}，未通过 ${row.failed || 0}，仅曝光 ${row.exposed || 0}，跳过 ${row.skipped || 0}，待处理 ${row.pending || 0}"><span class="is-done" style="width:${width(row.passed)}%"></span><span class="is-failed" style="width:${width(row.failed)}%"></span><span class="is-skipped" style="width:${width(row.exposed)}%"></span><span class="is-skipped" style="width:${width(row.skipped)}%"></span></div>`;
}
function reviewRecordCard(row) {
  return `<article class="detail-card review-record" data-review-session="${row.id}"><h3>${escapeHtml(row.name)} <span class="material-review-badge">${reviewSessionBadge(row)}</span></h3><p>${REVIEW_SOURCE_LABELS[row.source_type]} · ${row.types.map(type=>PLAN_TYPE_LABELS[type]).join(' + ')}</p><p class="detail-meta">开始：${escapeHtml(reviewTime(row.started_at))}<br>最近活动：${escapeHtml(reviewTime(row.updated_at))}</p><p>已完成 ${row.passed || 0} / ${row.total} · 未通过 ${row.failed || 0} · 仅曝光 ${row.exposed || 0} · 跳过 ${row.skipped} · 待处理 ${row.pending}</p>${reviewProgressHtml(row)}<div class="mistake-toolbar">${row.status==='completed' ? `<button onclick="repeatReviewRecord(${row.id})">再次复习</button>` : `<button onclick="resumeReviewRecord(${row.id})">继续复习</button>`}<button onclick="openReviewSessionDetail(${row.id})">查看详情</button></div></article>`;
}
// 首页使用紧凑列表，历史页和记录详情继续保留原有卡片。
function reviewRecentRecord(row) {
  return `<article class="review-recent-record" data-review-session="${row.id}"><div class="review-recent-main"><div class="review-recent-title"><h3>${escapeHtml(row.name)}</h3><span class="review-recent-state">${reviewSessionBadge(row)}</span></div><div class="review-recent-meta"><span>${REVIEW_SOURCE_LABELS[row.source_type]} · ${row.types.map(type=>PLAN_TYPE_LABELS[type]).join(' + ')}</span><span>最近活动：${escapeHtml(reviewTime(row.updated_at || row.started_at))}</span></div><div class="review-recent-progress">${reviewProgressHtml(row)}<span>已完成 ${row.passed || 0} / ${row.total} · 未通过 ${row.failed || 0} · 仅曝光 ${row.exposed || 0} · 跳过 ${row.skipped} · 待处理 ${row.pending}</span></div></div><div class="review-recent-actions">${row.status==='completed' ? `<button type="button" onclick="repeatReviewRecord(${row.id})">再次复习</button>` : `<button type="button" onclick="resumeReviewRecord(${row.id})">继续复习</button>`}<button type="button" onclick="openReviewSessionDetail(${row.id})">查看详情</button></div></article>`;
}
async function loadRecentReviews() {
  const courseId=currentCourseId,box=document.getElementById('reviewRecentList');if(!box)return;
  box.textContent='加载中…';
  try {
    const response=await requestApi(reviewSessionApi('',courseId)+'?limit=5');
    const data=await response.json();if(courseId!==currentCourseId)return;
    box.innerHTML=(data.results.length ? data.results.map(reviewRecentRecord).join('') : '<div class="review-center-empty"><p>暂无复习记录，开始一次复习吧</p><span>复习记录会显示在这里，方便继续或回顾。</span></div>')+legacyReviewResumeHtml();
  } catch(err) {if(courseId===currentCourseId)box.innerHTML=`<p class="material-review-error">${escapeHtml(err.message)}</p><button onclick="loadRecentReviews()">重试</button>`;}
}
function openReviewHistory() {
  clearCenterReviewUi();
  currentView={type:'reviewHistory'};showPageOnly('reviewHistoryPage');rememberReviewCenterLocation({type:'history'});
  return loadReviewHistory();
}
async function loadReviewHistory(append=false) {
  const courseId=currentCourseId,request=++reviewCenterRequest,box=document.getElementById('reviewHistoryList');
  const status=document.getElementById('reviewHistoryStatus').value,sourceType=document.getElementById('reviewHistorySource').value;
  const offset=append && reviewHistoryState?.courseId===courseId ? reviewHistoryState.rows.length : 0;
  if(!append)box.textContent='加载中…';
  document.getElementById('reviewHistoryMore').disabled=true;
  try {
    const response=await requestApi(reviewSessionApi()+`?status=${status}&sourceType=${sourceType}&limit=20&offset=${offset}`),data=await response.json();
    if(courseId!==currentCourseId || request!==reviewCenterRequest)return;
    const rows=append ? [...reviewHistoryState.rows,...data.results] : data.results;
    reviewHistoryState={courseId,rows,total:data.total};
    box.innerHTML=rows.length ? rows.map(reviewRecordCard).join('') : '<p class="empty">暂无复习记录，开始一次复习吧</p>';
    document.getElementById('reviewHistoryMore').hidden=rows.length>=data.total;
  } catch(err) {if(courseId===currentCourseId && request===reviewCenterRequest)box.innerHTML=`<p class="material-review-error">${escapeHtml(err.message)}</p><button onclick="loadReviewHistory()">重试</button>`;}
  finally {document.getElementById('reviewHistoryMore').disabled=false;}
}
async function openReviewSessionDetail(id) {
  clearCenterReviewUi();
  const courseId=currentCourseId,request=++reviewCenterRequest;
  currentView={type:'reviewSessionDetail',id};showPageOnly('reviewSessionDetailPage');rememberReviewCenterLocation({type:'detail',id});
  const box=document.getElementById('reviewSessionDetailBody');box.textContent='加载中…';
  try {
    const response=await requestApi(reviewSessionApi(id)),row=await response.json();
    if(courseId!==currentCourseId || request!==reviewCenterRequest)return;
    reviewSessionDetail=row;
    box.innerHTML=reviewRecordCard(row)+`<p class="detail-meta">完成时间：${escapeHtml(row.completed_at || '尚未完成')}。只有顺利通过复习模式才算完成；未通过（答错/不记得）和跳过都只算看过一遍，不计入完成数量。进度条蓝色=已完成、橙色=未通过、灰色=跳过。</p><section class="detail-card">${row.items.map(item=>{const state=item.exposure_only ? {icon:'◉',label:'已阅读（仅曝光，不评分）'} : item.status==='completed' ? (item.result==='failed' ? {icon:'✗',label:'未通过'} : {icon:'✓',label:'已通过'}) : item.status==='skipped' ? {icon:'—',label:'已跳过'} : {icon:'○',label:'待处理'};return `<div class="plan-task"><span>${state.icon} ${PLAN_TYPE_LABELS[item.item_type]} · ${escapeHtml(item.title_snapshot)}</span><small>${item.source_deleted ? '内容已删除' : state.label}</small></div>`;}).join('')}</section>`;
  } catch(err) {if(courseId===currentCourseId)box.innerHTML=`<p class="material-review-error">${escapeHtml(err.message)}</p><button onclick="openReviewHistory()">返回记录列表</button>`;}
}
function rememberReviewCenterLocation(location) {
  localStorage.setItem('currentTab','reviewPlans');localStorage.setItem('courseTimeStamp',Date.now());
  mistakeStorageSet('review-center-location:'+currentCourseId,location);
}
function clearCenterReviewUi() {
  if(typeof reviewWorkbench!=='undefined'&&reviewWorkbench?.inline)closeReviewWorkbench(false);
  const bar=document.getElementById('centerReviewToolbar');if(bar)bar.style.display='none';
  for(const id of ['mistakeReviewPanel','materialReviewActions','materialReviewContent','materialReviewPreview']){const panel=document.getElementById(id);if(panel)panel.hidden=false;}
}

// v13 前没有可信的开始时间/完整事件，旧浏览器队列只备份导航，不伪造历史。
function preserveLegacyReviewQueue(key,type) {
  const queue=mistakeStorageGet(key);
  if(!queue || queue.courseId!==currentCourseId || queue.sessionId || queue.finished || queue.legacyBackupId || !Array.isArray(queue.ids) || !queue.ids.length)return;
  const storageKey='legacy-review-backups:'+currentCourseId,entries=mistakeStorageGet(storageKey) || [],fingerprint=JSON.stringify(queue);
  if(entries.some(entry=>entry.fingerprint===fingerprint))return;
  const id=reviewRequestId();entries.push({id,type,fingerprint,queue:{...queue,legacyBackupId:id}});mistakeStorageSet(storageKey,entries);
}
function updateLegacyReviewBackup(queue,remove=false) {
  if(!queue?.legacyBackupId)return;
  const key='legacy-review-backups:'+queue.courseId,entries=mistakeStorageGet(key) || [];
  mistakeStorageSet(key,entries.filter(entry=>!(entry.id===queue.legacyBackupId && (remove || queue.finished))).map(entry=>entry.id===queue.legacyBackupId ? {...entry,queue} : entry));
}
function legacyReviewResumeHtml() {
  const entries=[...(mistakeStorageGet('legacy-review-backups:'+currentCourseId) || [])];
  for(const type of ['material','note','mistake']) {
    const key=(type==='mistake' ? 'mistake-queue:' : type+'-review-queue:')+currentCourseId,queue=mistakeStorageGet(key);
    if(queue && queue.courseId===currentCourseId && !queue.sessionId && !queue.finished && !queue.legacyBackupId && Array.isArray(queue.ids) && queue.ids.length
      && !entries.some(entry=>entry.fingerprint===JSON.stringify(queue)))entries.push({id:'head:'+type,type,queue});
  }
  return entries.length ? `<div class="detail-card"><p>还有升级前保存在本浏览器的复习，可继续原队列；不会补造历史记录。</p><div class="mistake-toolbar">${entries.map(entry=>`<button onclick="resumeLegacyReview('${entry.id}')">继续旧${PLAN_TYPE_LABELS[entry.type]}复习（${entry.queue.ids.length} 项）</button>`).join('')}</div></div>` : '';
}
async function resumeLegacyReview(id) {
  const entries=mistakeStorageGet('legacy-review-backups:'+currentCourseId) || [],entry=entries.find(row=>row.id===id);
  const type=entry?.type || (id.startsWith('head:') ? id.slice(5) : null);if(!Object.hasOwn(PLAN_TYPE_LABELS,type))return;
  const key=(type==='mistake' ? 'mistake-queue:' : type+'-review-queue:')+currentCourseId;
  if(entry){preserveLegacyReviewQueue(key,type);mistakeStorageSet(key,entry.queue);}
  try {
    switchTab(type==='material' ? 'materials' : type==='note' ? 'notes' : 'mistakes');
    if(type==='material')await resumeMaterialReview();else if(type==='note')await resumeNoteReview();else await resumeMistakeQueue();
  }catch(err){showToast(err.message);}
}

async function openTotalReview() {
  if(totalReviewState?.busy)return;
  const filters=createReviewPickerFilters();
  // Match only the current large tab, never inherit its search/category/item selection.
  const tab=currentView.type==='course'?({materials:'material',notes:'note',mistakes:'mistake'}[currentView.tab]||'material'):'material';
  totalReviewState={courseId:currentCourseId,rows:[],ids:new Set(),tab,filters,loading:true,busy:false,preview:null,returnFocus:document.activeElement,requestId:reviewRequestId()};
  restoreTotalReviewFilters();document.getElementById('totalReviewError').textContent='';
  document.getElementById('totalReviewSelector').hidden=false;document.getElementById('totalReviewPreview').hidden=true;
  document.getElementById('totalReviewModal').classList.add('show');document.body.classList.add('plan-modal-open');document.getElementById('totalReviewTitle').focus();
  renderTotalReview();return loadTotalReviewCandidates();
}
async function loadTotalReviewCandidates() {
  const s=totalReviewState;if(!s)return;s.loading=true;renderTotalReview();
  try {
    const rows=await requestList(reviewSessionApi('candidates'));if(totalReviewState!==s || s.courseId!==currentCourseId)return;
    s.rows=rows;s.loading=false;document.getElementById('totalReviewError').textContent='';
    renderTotalReview();
  } catch(err) {if(totalReviewState===s){s.loading=false;renderTotalReview();document.getElementById('totalReviewError').innerHTML=`${escapeHtml(err.message)}<button type="button" onclick="loadTotalReviewCandidates()">重试</button>`;}}
}
function closeTotalReview() {
  if(totalReviewState?.busy)return;
  const focus=totalReviewState?.returnFocus;totalReviewState=null;
  document.getElementById('totalReviewPreviewBody').replaceChildren();
  document.getElementById('totalReviewModal').classList.remove('show');document.body.classList.remove('plan-modal-open');
  if(focus?.isConnected)focus.focus({preventScroll:true});
}
function saveTotalReviewFilters() {
  const s=totalReviewState;if(!s)return;
  Object.assign(s.filters[s.tab],{q:document.getElementById('totalReviewSearch').value,favorite:document.getElementById('totalReviewFavorite').checked,
    status:document.getElementById('totalReviewStatus').value,category:document.getElementById('totalReviewMistakeType').value});
}
function restoreTotalReviewFilters() {
  const s=totalReviewState,f=s.filters[s.tab];
  document.getElementById('totalReviewSearch').value=f.q;document.getElementById('totalReviewFavorite').checked=f.favorite;
  document.getElementById('totalReviewStatus').value=f.status;document.getElementById('totalReviewMistakeType').value=f.category;
  document.getElementById('totalReviewMistakeType').hidden=s.tab!=='mistake';
}
function rememberTotalReviewScroll() {
  const s=totalReviewState;if(s && !s.preview)s.filters[s.tab].scroll=document.getElementById('totalReviewCandidates').scrollTop;
}
function switchTotalReviewTab(type) {
  const s=totalReviewState;if(!s || s.busy || s.preview || !Object.hasOwn(s.filters,type) || s.tab===type)return;
  saveTotalReviewFilters();rememberTotalReviewScroll();s.tab=type;restoreTotalReviewFilters();renderTotalReview();
}
function toggleTotalReviewTags() {
  const s=totalReviewState;if(!s || s.busy)return;
  const f=s.filters[s.tab];f.tagsOpen=!f.tagsOpen;renderTotalReviewTags();
}
function renderTotalReviewTags() {
  if(totalReviewState)renderReviewPickerTags(totalReviewState,'totalReview','changeTotalReviewTag');
}
function filteredTotalReview() {
  const s=totalReviewState;if(!s)return [];
  saveTotalReviewFilters();const f=s.filters[s.tab],{favorite,status,category}=f,q=f.q.trim().toLowerCase();
  return s.rows.filter(row=>row.type===s.tab && (!q || `${row.title}\n${row.content}\n${row.ocr_text || ''}`.toLowerCase().includes(q))
    && (!favorite || !!row.favorite) && (!status || row.review_status===status) && (!category || row.type!=='mistake' || row.mistake_type===category)
    && (!f.tags.size || row.nodes.some(tag=>f.tags.has(tag.id))));
}
function renderTotalReview() {
  const s=totalReviewState;if(!s)return;
  const rows=filteredTotalReview();
  document.querySelectorAll('#totalReviewModules [role=tab]').forEach(button=>{const selected=button.id==='totalReviewTab-'+s.tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected ? 0 : -1;button.disabled=s.busy;});
  document.getElementById('totalReviewPanel').setAttribute('aria-labelledby','totalReviewTab-'+s.tab);
  document.getElementById('totalReviewListTitle').textContent=PLAN_TYPE_LABELS[s.tab]+'列表';renderTotalReviewTags();
  const list=document.getElementById('totalReviewCandidates'),scroll=s.filters[s.tab].scroll,focused=document.activeElement?.dataset.totalChoice;
  list.innerHTML=s.loading ? '<p class="loading-tip">加载中…</p>' : rows.length ? rows.map(row=>{
    const key=row.type+':'+row.id;
    return reviewPickerCard(row,s.ids.has(key),s.busy,'data-total-choice','selectTotalReviewItem','openTotalReviewPreview',s.courseId);
  }).join('') : '<p class="empty">暂无匹配内容</p>';
  list.scrollTop=scroll;
  if(focused)list.querySelector(`[data-total-choice="${focused}"]`)?.focus({preventScroll:true});
  const eligible=rows.filter(row=>row.reviewable),count=eligible.filter(row=>s.ids.has(row.type+':'+row.id)).length,all=document.getElementById('totalReviewSelectAll');
  all.checked=!!eligible.length && count===eligible.length;all.indeterminate=count>0 && count<eligible.length;all.disabled=s.loading || s.busy || !eligible.length;
  const counts=['material','note','mistake'].map(type=>`${PLAN_TYPE_LABELS[type]} ${[...s.ids].filter(key=>key.startsWith(type+':')).length}`);
  document.getElementById('totalReviewCount').textContent=`已选择 ${s.ids.size} 项`;document.getElementById('totalReviewCounts').textContent=counts.join(' · ');
  document.getElementById('totalReviewStart').disabled=s.loading || s.busy || !s.ids.size;
}
function selectTotalReviewItem(key,checked) {const s=totalReviewState;if(!s || s.busy || s.loading || !s.rows.some(row=>row.type+':'+row.id===key && row.reviewable))return;rememberTotalReviewScroll();if(checked)s.ids.add(key);else s.ids.delete(key);renderTotalReview();}
function selectTotalReviewVisible(checked) {const s=totalReviewState;if(!s || s.busy || s.loading)return;for(const row of filteredTotalReview().filter(row=>row.reviewable)){const key=row.type+':'+row.id;if(checked)s.ids.add(key);else s.ids.delete(key);}renderTotalReview();}
function selectTotalReviewCourse() {const s=totalReviewState;if(!s || s.busy || s.loading)return;for(const row of s.rows.filter(row=>row.reviewable))s.ids.add(row.type+':'+row.id);renderTotalReview();}
function clearTotalReviewSelection() {if(totalReviewState && !totalReviewState.busy){totalReviewState.ids.clear();renderTotalReview();}}
function changeTotalReviewTag(id,checked) {const s=totalReviewState;if(!s || s.busy)return;const tags=s.filters[s.tab].tags;if(checked)tags.add(id);else tags.delete(id);renderTotalReview();}
// 两个弹窗共用只读预览器；导航与复习执行状态不受影响。
async function openTotalReviewPreview(key,trigger=document.activeElement) {
  const s=totalReviewState;if(!s || s.busy || s.loading)return;
  const candidate=s.rows.find(row=>row.type+':'+row.id===key);if(!candidate)return;
  saveTotalReviewFilters();rememberTotalReviewScroll();
  return openReviewPickerPreview(s,candidate,trigger,REVIEW_PICKER_PREVIEWS.total,()=>totalReviewState===s,'openTotalReviewPreview');
}
function closeTotalReviewPreview() {
  if(totalReviewState)closeReviewPickerPreview(totalReviewState,REVIEW_PICKER_PREVIEWS.total,'totalReviewTab-'+totalReviewState.tab);
}
function handleTotalReviewKey(event) {
  if(!totalReviewState)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(totalReviewState.preview)closeTotalReviewPreview();else closeTotalReview();return;}
  const tabs=[...document.querySelectorAll('#totalReviewModules [role=tab]')],index=tabs.indexOf(event.target);
  if(index>=0 && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
    event.preventDefault();const next=event.key==='Home' ? 0 : event.key==='End' ? 2 : (index+(event.key==='ArrowRight' ? 1 : 2))%3;
    switchTotalReviewTab(['material','note','mistake'][next]);tabs[next].focus();
  }
  trapReviewPickerFocus(event,'totalReviewModal');
}
async function startTotalReview() {
  const s=totalReviewState;if(!s || s.busy || s.loading || !s.ids.size)return;s.busy=true;renderTotalReview();
  try {
    const items=[...s.ids].map(key=>{const [type,id]=key.split(':');return {type,id:Number(id)};});
    const session=await createReviewRecord('total',items,{requestId:s.requestId});if(s.courseId!==currentCourseId || s!==totalReviewState)return;
    s.busy=false;closeTotalReview();await enterCenterReview(session);
  } catch(err) {if(totalReviewState===s)document.getElementById('totalReviewError').textContent=err.message;}
  finally {s.busy=false;renderTotalReview();}
}
async function resumeReviewRecord(id) {
  if(reviewRecordBusy || mistakeReviewBusy || activeReadingReview.busy)return;reviewRecordBusy=true;
  try {const session=await recordedReviewAction(id,'resume');await enterCenterReview(session);}
  catch(err){showToast(err.message);}finally{reviewRecordBusy=false;}
}
async function repeatReviewRecord(id) {
  if(reviewRecordBusy)return;reviewRecordBusy=true;
  const key=mistakeStorageGet('review-repeat-request:'+id) || reviewRequestId();mistakeStorageSet('review-repeat-request:'+id,key);
  try {
    const session=await reviewSessionRequest(id+'/repeat',{requestId:key});mistakeStorageSet('review-repeat-request:'+id,null);
    if(session.excluded.length)showToast(`已排除 ${session.excluded.length} 项已删除或无法复习的内容`);
    await enterCenterReview(session);
  } catch(err){showToast(err.message);}finally{reviewRecordBusy=false;}
}
async function enterCenterReview(session) {
  if(session.course_id!==currentCourseId)return;
  if(session.status==='completed'){await openReviewSessionDetail(session.id);return;}
  centerReview={session,position:session.current_position,busy:false};
  rememberReviewCenterLocation({type:'running',id:session.id});return renderCenterReviewItem();
}
function currentCenterItem() {return centerReview?.session.course_id===currentCourseId ? centerReview.session.items[centerReview.position] : null;}
function centerReviewHasPendingSave() {
  const item=currentCenterItem();if(!item)return false;
  return !!(currentView.type==='readingReview' && activeReadingReview.queue?.sessionId===centerReview.session.id && activeReadingReview.queue.pending)
    || !!(mistakeDetailState?.sessionItemId===item.id && (mistakeStorageGet(mistakePendingKey(mistakeDetailState)) || mistakeDetailState.pending));
}
async function renderCenterReviewItem() {
  const s=centerReview,item=currentCenterItem();if(!item)return;
  s.quickMode=null;
  clearCenterReviewUi();
  if(mistakeQueue?.centerContext)mistakeQueue=null;
  if(item.source_deleted || !item.reviewable) {
    currentView={type:'sessionUnavailable'};showPageOnly('materialReviewPage');
    document.getElementById('readingReviewHeading').textContent='总复习';document.getElementById('materialReviewTitle').textContent=item.title_snapshot;
    document.getElementById('materialReviewItem').style.display='block';document.getElementById('materialReviewComplete').style.display='none';
    document.getElementById('materialReviewContent').textContent=item.source_deleted ? '内容已删除，历史队列保留原身份。' : '题目或答案不完整，请先补齐内容，或跳过此项。';
    for(const id of ['materialReviewPreview','materialReviewActions','materialReviewError','materialReviewStatus','materialReviewProgress'])document.getElementById(id).textContent='';
    document.getElementById('materialReviewOpenFile').style.display='none';renderCenterReviewToolbar();return;
  }
  if(item.item_type==='mistake') {
    const storageKey=`review-session-queue:${s.session.id}:${item.position}`;
    const saved=readMistakeQueue(storageKey);
    mistakeQueue={courseId:currentCourseId,type:'mixed',ids:[item.item_id],types:{[item.item_id]:item.mistake_type},index:0,rounds:saved?.rounds || {},finished:false,
      storageKey,sessionId:s.session.id,sessionItems:{[item.item_id]:item.id},centerContext:true};
    saveMistakeQueue();await openMistakeDetail(item.item_id,item.status==='pending');
  } else {
    const storageKey=`review-session-queue:${s.session.id}:${item.position}`;
    const controller=createReadingReview(item.item_type==='material' ? 'materials' : 'notes',PLAN_TYPE_LABELS[item.item_type],null,
      {storageKey,sessionId:s.session.id,sessionItems:{[item.item_id]:item.id},
        readOnly:item.status!=='pending',onFinish:centerReviewItemFinished,onExit:pauseCenterReview});
    const saved=mistakeStorageGet(storageKey);
    if(item.status==='pending' && !saved?.finished && saved?.ids?.length===1 && saved.ids[0]===item.item_id)await controller.resume();
    else await controller.startItems([item.item_id]);
  }
  if(centerReview===s){
    await prepareCenterQuickMode(item,s.session);
    if(centerReview!==s)return;
    renderCenterReviewToolbar();
    await routeCenterReviewMode(item,s.session);
  }
}
function renderCenterReviewToolbar() {
  const item=currentCenterItem(),bar=document.getElementById('centerReviewToolbar');if(!item || !bar)return;
  const host=document.querySelector((currentView.type==='mistake' ? '#mistakeDetailPage' : '#materialReviewPage')+' .tab-content');host.prepend(bar);bar.style.display='block';
  const s=centerReview,busy=s.busy || s.quickMode?.busy || mistakeReviewBusy || activeReadingReview.busy || reviewWorkbench?.busy,blocked=busy || centerReviewHasPendingSave();
  bar.innerHTML=`<strong>${escapeHtml(s.session.name)} · 第 ${s.position+1} / ${s.session.total} 项</strong><p>已完成 ${s.session.passed || 0} · 未通过 ${s.session.failed || 0} · 仅曝光 ${s.session.exposed || 0} · 跳过 ${s.session.skipped}</p><div class="mistake-toolbar"><button onclick="moveCenterReview(-1)" ${blocked || s.position===0 ? 'disabled' : ''}>上一项</button><button onclick="moveCenterReview(1)" ${blocked ? 'disabled' : ''}>下一项</button><button onclick="skipCenterReviewItem()" ${blocked || item.status!=='pending' ? 'disabled' : ''}>跳过</button><button onclick="pauseCenterReview()" ${busy ? 'disabled' : ''}>暂停，稍后继续</button></div>`;
  const context=centerWorkbenchContext(item,s.session),selection=workbenchSelection(context);
  const active=readReviewActive(context);
  const workbenchActive=item.status==='pending'&&!!active?.mode;
  const inlineVisible=!!(reviewWorkbench?.inline&&reviewWorkbench.sessionItemId===item.id&&!wb('Inline')?.hidden);
  const q=s.quickMode?.itemId===item.id?s.quickMode:null;
  const nativePanel=document.getElementById(item.item_type==='mistake'?'mistakeReviewPanel':'materialReviewActions');
  if(nativePanel)nativePanel.hidden=inlineVisible||workbenchActive||!!q?.busy||!!(q&&q.modeId!==(item.item_type==='mistake'?mistakeDetailState?.progress?.mode?.id:'reading')&&q.modeId!=='retry');
  const aiPanel=document.getElementById('resourceAiPanel');if(aiPanel)aiPanel.hidden=inlineVisible||workbenchActive;
  if(item.item_type!=='mistake')for(const id of ['materialReviewContent','materialReviewPreview']){const original=document.getElementById(id);if(original)original.hidden=inlineVisible||workbenchActive;}
  if(workbenchActive){
    bar.insertAdjacentHTML('afterbegin',`<p>当前实际执行：${escapeHtml(AI_REVIEW_METHODS[active.mode])} · 在本页直接作答</p>`);
    if(item.item_type==='mistake'&&mistakeDetailState?.progress){const p=mistakeDetailState.progress;document.getElementById('mistakeDetailMeta').textContent=`${MISTAKE_TYPES[p.mistakeType]} · ${AI_REVIEW_METHODS[active.mode]} · ${mistakeStatusText(p.reviewStatus)}`;}
  }
  const modeButton=document.createElement('button');modeButton.type='button';modeButton.textContent='复习模式 / 手动材料 · '+({user:'本次选择',ai:'已确认建议',rule:'默认推荐'}[selection.source])+'：'+AI_REVIEW_METHODS[selection.mode];modeButton.disabled=blocked||item.status!=='pending';
  modeButton.onclick=openCenterReviewSettings;bar.querySelector('.mistake-toolbar').append(modeButton);
  if(q){
    const selectedAi=!!q.aiMode&&q.modeId===q.aiMode;
    const quick=document.createElement('div');quick.className='mistake-toolbar';quick.dataset.quickMode=q.modeId;
    quick.innerHTML=`<button type="button" data-quick-toggle aria-pressed="${selectedAi}" onclick="toggleCenterQuickMode()" ${blocked||q.busy||!q.aiMode?'disabled':''}>${selectedAi?'AI 建议模式：'+escapeHtml(AI_REVIEW_METHODS[q.aiMode])+'（切换原复习）':'原复习：'+escapeHtml(AI_REVIEW_METHODS[q.modeId])+'（切回 AI 建议）'}</button><button type="button" data-quick-start onclick="confirmCenterQuickMode()" ${blocked||q.busy?'disabled':''}>${q.busy?'正在确认…':'确认开始：'+escapeHtml(AI_REVIEW_METHODS[q.modeId])}</button><small data-quick-reason>${escapeHtml(q.reason)}</small>`;
    if(active?.mode===q.modeId||mistakeStorageGet(reviewSelectionKey(context)+':native-mode')===q.modeId){quick.querySelector('[data-quick-start]').hidden=true;}
    if(q.aiMode&&!q.ready){const prepare=document.createElement('button');prepare.type='button';prepare.dataset.prepareSuggestion='';prepare.textContent='就地准备建议材料（手动）';prepare.disabled=blocked;prepare.onclick=prepareCenterSuggestedMaterial;quick.append(prepare);}
    bar.append(quick);
  }
}
async function moveCenterReview(delta) {
  const s=centerReview;if(!s || s.busy || mistakeReviewBusy || activeReadingReview.busy || centerReviewHasPendingSave())return;
  const next=s.position+delta;if(next<0 || next>=s.session.items.length){showToast('请完成或跳过待处理项目');return;}
  s.busy=true;
  try {s.session=await recordedReviewAction(s.session.id,'position',{position:next});s.position=next;await renderCenterReviewItem();}
  catch(err){showToast(err.message);}finally{s.busy=false;renderCenterReviewToolbar();}
}
async function centerReviewItemFinished() {
  const s=centerReview;if(!s)return;
  try {
    const response=await requestApi(reviewSessionApi(s.session.id));s.session=await response.json();
    if(s.session.status==='completed') {
      const planId=s.session.source_type==='plan' ? s.session.source_id : null;
      centerReview=null;if(mistakeQueue?.centerContext)mistakeQueue=null;activeReadingReview=materialReadingReview;
      clearCenterReviewUi();
      // 计划来源的复习完成后直接回计划，让日历按新记忆状态重新排布并立即呈现。
      if(planId && typeof openReviewPlan==='function'){await openReviewPlan(planId);return;}
      if(s.session.source_type==='total' && typeof openReviewCompleteModal==='function') {
        if(typeof backToReviewPlans==='function') backToReviewPlans();
        await openReviewCompleteModal(s.session);
        return;
      }
      await openReviewSessionDetail(s.session.id);return;
    }
    s.position=s.session.current_position;await renderCenterReviewItem();
  } catch(err){showToast(err.message);}
}
async function skipCenterReviewItem() {
  const s=centerReview,item=currentCenterItem();if(!item || s.busy || mistakeReviewBusy || activeReadingReview.busy || centerReviewHasPendingSave() || item.status!=='pending')return;
  s.busy=true;
  try {await recordedReviewAction(`${s.session.id}/items/${item.id}`,'skip');await centerReviewItemFinished();}
  catch(err){showToast(err.message);}finally{s.busy=false;renderCenterReviewToolbar();}
}
async function pauseCenterReview() {
  const s=centerReview;if(!s || s.busy || mistakeReviewBusy || activeReadingReview.busy)return;
  s.busy=true;
  try {
    await recordedReviewAction(s.session.id,'pause');centerReview=null;
    if(mistakeQueue?.centerContext)mistakeQueue=null;activeReadingReview=materialReadingReview;
    const planId=s.session.source_type==='plan' ? s.session.source_id : null;
    clearCenterReviewUi();
    if(planId && typeof openReviewPlan==='function'){await openReviewPlan(planId);return;}
    await openReviewSessionDetail(s.session.id);
  } catch(err){showToast(err.message);}finally{s.busy=false;}
}
async function restoreReviewCenterLocation(courseId) {
  const saved=mistakeStorageGet('review-center-location:'+courseId);
  if(!saved || courseId!==currentCourseId)return false;
  if(saved.type==='history'){await openReviewHistory();return true;}
  if(Number.isSafeInteger(saved.id) && saved.id>0) {
    if(saved.type==='running')await resumeReviewRecord(saved.id);else await openReviewSessionDetail(saved.id);
    return true;
  }
  return false;
}
