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
function reviewRecordCard(row) {
  const state={active:'进行中',paused:'已暂停，可继续',completed:'已完成'}[row.status];
  return `<article class="detail-card review-record" data-review-session="${row.id}"><h3>${escapeHtml(row.name)} <span class="material-review-badge">${state}</span></h3><p>${REVIEW_SOURCE_LABELS[row.source_type]} · ${row.types.map(type=>PLAN_TYPE_LABELS[type]).join(' + ')}</p><p class="detail-meta">开始：${escapeHtml(reviewTime(row.started_at))}<br>最近活动：${escapeHtml(reviewTime(row.updated_at))}</p><p>已完成 ${row.completed} / ${row.total} · 已跳过 ${row.skipped} · 待处理 ${row.pending}</p><progress max="100" value="${row.progress}" aria-label="处理进度 ${row.progress}%"></progress><div class="mistake-toolbar">${row.status==='completed' ? `<button onclick="repeatReviewRecord(${row.id})">再次复习</button>` : `<button onclick="resumeReviewRecord(${row.id})">继续复习</button>`}<button onclick="openReviewSessionDetail(${row.id})">查看详情</button></div></article>`;
}
async function loadRecentReviews() {
  const courseId=currentCourseId,box=document.getElementById('reviewRecentList');if(!box)return;
  box.textContent='加载中…';
  try {
    const response=await requestApi(reviewSessionApi('',courseId)+'?limit=5');
    const data=await response.json();if(courseId!==currentCourseId)return;
    box.innerHTML=(data.results.length ? data.results.map(reviewRecordCard).join('') : '<p class="empty">暂无复习记录，开始一次复习吧</p>')+legacyReviewResumeHtml();
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
    box.innerHTML=reviewRecordCard(row)+`<p class="detail-meta">完成时间：${escapeHtml(row.completed_at || '尚未完成')}。进度包含已完成和已跳过，跳过不计入完成数量。</p><section class="detail-card">${row.items.map(item=>`<div class="plan-task"><span>${item.status==='completed' ? '✓' : item.status==='skipped' ? '—' : '○'} ${PLAN_TYPE_LABELS[item.item_type]} · ${escapeHtml(item.title_snapshot)}</span><small>${item.source_deleted ? '内容已删除' : {pending:'待处理',completed:'已完成',skipped:'已跳过'}[item.status]}</small></div>`).join('')}</section>`;
  } catch(err) {if(courseId===currentCourseId)box.innerHTML=`<p class="material-review-error">${escapeHtml(err.message)}</p><button onclick="openReviewHistory()">返回记录列表</button>`;}
}
function rememberReviewCenterLocation(location) {
  localStorage.setItem('currentTab','reviewPlans');localStorage.setItem('courseTimeStamp',Date.now());
  mistakeStorageSet('review-center-location:'+currentCourseId,location);
}
function clearCenterReviewUi() {
  const bar=document.getElementById('centerReviewToolbar');if(bar)bar.style.display='none';
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
  const filters=Object.fromEntries(['material','note','mistake'].map(type=>[type,{q:'',favorite:false,status:'',category:'',tags:new Set(),tagsOpen:false,scroll:0}]));
  totalReviewState={courseId:currentCourseId,rows:[],ids:new Set(),tab:'material',filters,loading:true,busy:false,preview:null,returnFocus:document.activeElement,requestId:reviewRequestId()};
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
  const s=totalReviewState,f=s.filters[s.tab],tags=new Map();
  s.rows.filter(row=>row.type===s.tab).forEach(row=>row.nodes.forEach(tag=>tags.set(tag.id,tag.name)));
  const host=document.getElementById('totalReviewTags'),toggle=document.getElementById('totalReviewTagsToggle');
  host.hidden=!f.tagsOpen;toggle.setAttribute('aria-expanded',String(f.tagsOpen));
  toggle.querySelector('span').textContent='知识点标签'+(f.tags.size ? ` (${f.tags.size})` : '');
  const focused=document.activeElement?.dataset.totalTag;
  host.innerHTML=tags.size ? [...tags].map(([id,name])=>`<label class="reading-review-tag"><input data-total-tag="${id}" type="checkbox" ${f.tags.has(id) ? 'checked' : ''} ${s.busy ? 'disabled' : ''} onchange="changeTotalReviewTag(${id},this.checked)" />${escapeHtml(name)}</label>`).join('') : '暂无标签';
  if(focused)host.querySelector(`[data-total-tag="${focused}"]`)?.focus({preventScroll:true});
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
    return `<article class="total-review-card"><input data-total-choice="${key}" aria-label="选择${escapeHtml(row.title)}" type="checkbox" ${s.ids.has(key) ? 'checked' : ''} ${s.busy || !row.reviewable ? 'disabled' : ''} onchange="selectTotalReviewItem('${key}',this.checked)" /><button type="button" class="total-review-item-title" onclick="openTotalReviewPreview('${key}',this)">${escapeHtml(row.title || '（无标题）')}</button><button type="button" class="total-review-item-preview" onclick="openTotalReviewPreview('${key}',this)" aria-label="预览${escapeHtml(row.title)}"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>预览</button><small class="total-review-item-meta">${PLAN_TYPE_LABELS[row.type]} · ${mistakeStatusText(row.review_status)}${row.favorite ? ' · ★ 收藏' : ''}${!row.reviewable ? ' · 请先补齐题目或答案' : ''}</small></article>`;
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
// 只读详情沿用模块详情接口、正文/标签组件与附件预览器，不切换页面或触碰复习状态。
async function openTotalReviewPreview(key,trigger=document.activeElement) {
  const s=totalReviewState;if(!s || s.busy || s.loading)return;
  const candidate=s.rows.find(row=>row.type+':'+row.id===key);if(!candidate)return;
  saveTotalReviewFilters();rememberTotalReviewScroll();
  const preview={key,trigger};s.preview=preview;
  const isCurrent=()=>totalReviewState===s && s.courseId===currentCourseId && s.preview===preview;
  document.getElementById('totalReviewSelector').hidden=true;document.getElementById('totalReviewPreview').hidden=false;
  const title=document.getElementById('totalReviewPreviewTitle'),body=document.getElementById('totalReviewPreviewBody');
  title.textContent=PLAN_TYPE_LABELS[candidate.type]+'预览';title.focus();body.textContent='加载中…';body.scrollTop=0;
  try {
    const plural={material:'materials',note:'notes',mistake:'mistakes'}[candidate.type];
    const response=await requestApi(`${API}/${plural}/${candidate.id}`),row=await response.json();if(!isCurrent())return;
    if(row.course_id!==s.courseId)throw new Error('这条内容不属于当前课程');
    const tags=rowNodes(row);
    body.innerHTML=`<h3>${escapeHtml(row.title || '（无标题）')}</h3><p class="detail-meta">${PLAN_TYPE_LABELS[candidate.type]} · ${mistakeStatusText(row.review_status)}${candidate.type==='mistake' ? ' · '+(MISTAKE_TYPES[row.mistake_type] || '待分类') : ''}${row.favorite ? ' · ★ 收藏' : ''}</p><div>${tags.map(tag=>tagChipHtml(tag,false,false)).join('')}</div>`;
    const section=(label,content,fileUrl,fileType)=>{
      const heading=document.createElement('h4');heading.textContent=label;body.appendChild(heading);
      if(content){const text=document.createElement('div');text.className='detail-content';text.textContent=content;body.appendChild(text);}
      if(fileUrl){const url=API.replace(/\/api\/?$/,'')+fileUrl,box=document.createElement('div');body.appendChild(box);renderResourcePreview(fileType || (isImageFile(fileType,fileUrl) ? 'image/*' : /\.pdf$/i.test(fileUrl) ? 'application/pdf' : ''),url,box);
        const link=document.createElement('a');link.className='detail-link';link.textContent='打开'+label+'附件';link.href=url;link.target='_blank';link.rel='noopener';body.appendChild(link);}
      if(!content && !fileUrl){const empty=document.createElement('p');empty.className='detail-meta';empty.textContent='暂无内容';body.appendChild(empty);}
    };
    section(candidate.type==='mistake' ? '题目' : '正文',row.content || row.ocr_text,row.file_url || row.image_url,row.file_type);
    if(candidate.type==='mistake'){section('参考答案',row.answer_content,row.answer_image_url,row.answer_file_type);section('解析 / 错误原因',row.explanation);}
  }catch(err){if(isCurrent()){body.innerHTML=`<p class="material-review-error">${escapeHtml(err.message)}</p><button type="button" onclick="openTotalReviewPreview('${key}')">重试预览</button>`;}}
}
function closeTotalReviewPreview() {
  const s=totalReviewState;if(!s?.preview)return;
  const {trigger}=s.preview;s.preview=null;
  document.getElementById('totalReviewPreview').hidden=true;document.getElementById('totalReviewSelector').hidden=false;
  document.getElementById('totalReviewPreviewBody').replaceChildren();
  document.getElementById('totalReviewCandidates').scrollTop=s.filters[s.tab].scroll;
  if(trigger?.isConnected && !trigger.closest('[hidden]'))trigger.focus({preventScroll:true});else document.getElementById('totalReviewTab-'+s.tab).focus({preventScroll:true});
}
function handleTotalReviewKey(event) {
  if(!totalReviewState)return;
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(totalReviewState.preview)closeTotalReviewPreview();else closeTotalReview();return;}
  const tabs=[...document.querySelectorAll('#totalReviewModules [role=tab]')],index=tabs.indexOf(event.target);
  if(index>=0 && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
    event.preventDefault();const next=event.key==='Home' ? 0 : event.key==='End' ? 2 : (index+(event.key==='ArrowRight' ? 1 : 2))%3;
    switchTotalReviewTab(['material','note','mistake'][next]);tabs[next].focus();
  }
  if(event.key==='Tab'){
    const nodes=[...document.querySelectorAll('#totalReviewModal button:not(:disabled), #totalReviewModal input:not(:disabled), #totalReviewModal select:not(:disabled), #totalReviewModal a[href], #totalReviewModal iframe')].filter(node=>node.getClientRects().length && node.tabIndex>=0);
    if(!nodes.length)return;
    if(event.shiftKey && (event.target===nodes[0] || !nodes.includes(event.target))){event.preventDefault();nodes.at(-1).focus();}
    else if(!event.shiftKey && (event.target===nodes.at(-1) || !nodes.includes(event.target))){event.preventDefault();nodes[0].focus();}
  }
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
  if(centerReview===s)renderCenterReviewToolbar();
}
function renderCenterReviewToolbar() {
  const item=currentCenterItem(),bar=document.getElementById('centerReviewToolbar');if(!item || !bar)return;
  const host=document.querySelector((currentView.type==='mistake' ? '#mistakeDetailPage' : '#materialReviewPage')+' .tab-content');host.prepend(bar);bar.style.display='block';
  const s=centerReview,busy=s.busy || mistakeReviewBusy || activeReadingReview.busy,blocked=busy || centerReviewHasPendingSave();
  bar.innerHTML=`<strong>${escapeHtml(s.session.name)} · 第 ${s.position+1} / ${s.session.total} 项</strong><p>已完成 ${s.session.completed} · 已跳过 ${s.session.skipped}</p><div class="mistake-toolbar"><button onclick="moveCenterReview(-1)" ${blocked || s.position===0 ? 'disabled' : ''}>上一项</button><button onclick="moveCenterReview(1)" ${blocked ? 'disabled' : ''}>下一项</button><button onclick="skipCenterReviewItem()" ${blocked || item.status!=='pending' ? 'disabled' : ''}>跳过</button><button onclick="pauseCenterReview()" ${busy ? 'disabled' : ''}>暂停，稍后继续</button></div>`;
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
      centerReview=null;if(mistakeQueue?.centerContext)mistakeQueue=null;activeReadingReview=materialReadingReview;
      clearCenterReviewUi();await openReviewSessionDetail(s.session.id);return;
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
    clearCenterReviewUi();await openReviewSessionDetail(s.session.id);
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
