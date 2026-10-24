// 资料与笔记共用阅读复习控制器和界面；数据、队列与存储键始终独立。
function createReadingReview(kind, label, resumeId, options = {}) {
  const state = {kind, label, selection:null, queue:null, row:null, busy:false, request:0};
  const el = suffix => document.getElementById('materialReview' + suffix);
  const current = () => state.queue?.courseId === currentCourseId && currentView.type === 'readingReview' && currentView.reviewKind === kind;
  const hasCenterNavigation = () => !!(options.sessionId && typeof centerReview !== 'undefined'
    && centerReview?.session?.id === options.sessionId && centerReview.session.course_id === currentCourseId);
  const store = value => {
    try { localStorage.setItem(options.storageKey || (kind === 'materials' ? 'material' : 'note') + '-review-queue:' + currentCourseId, JSON.stringify(value)); }
    catch { /* 当前浏览器禁用存储时仍可完成本轮；实际状态已保存到后端。 */ }
    if(typeof updateLegacyReviewBackup==='function')updateLegacyReviewBackup(value || state.queue,value===null);
  };
  function read() {
    try {
      const saved = JSON.parse(localStorage.getItem(options.storageKey || (kind === 'materials' ? 'material' : 'note') + '-review-queue:' + currentCourseId));
      if (!saved || saved.courseId !== currentCourseId || saved.kind && saved.kind !== kind || !Array.isArray(saved.ids) || !saved.ids.length
        || saved.ids.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(saved.ids).size !== saved.ids.length
        || !Number.isInteger(saved.index) || saved.index < 0 || saved.index > saved.ids.length || !saved.results || typeof saved.results !== 'object') return null;
      saved.kind = kind;
      saved.skipped ||= saved.ids.slice(0,saved.index).filter(id=>!saved.results[id]);
      for (const id of Object.keys(saved.results)) if (!['reviewed','clear','exposed','vague','forgotten'].includes(saved.results[id])) delete saved.results[id];
      if (!['reviewed','clear','exposed','vague','forgotten'].includes(saved.pending?.status)) saved.pending = null;
      if (!['vague','forgotten'].includes(saved.recallAgain?.status)) saved.recallAgain = null;
      return saved;
    } catch { return null; }
  }
  state.renderResume = () => {
    const saved = read(), button = document.getElementById(resumeId);
    if (button) button.style.display = saved && !saved.finished ? 'inline-block' : 'none';
  };
  state.close = () => {
    if (state.busy) return;
    state.selection = null; el('Picker').classList.remove('show'); document.body.classList.remove('material-review-open');
  };
  state.filtered = () => {
    const s = state.selection;
    return s ? s.rows.filter(row => (row.title+'\n'+(row.content||'')).toLowerCase().includes(s.q.toLowerCase())
      && (!s.status || row.review_status === s.status)
      && (!s.favorite || !!row.favorite)
      && (!s.nodeIds.size || (row.nodes||[]).some(node=>s.nodeIds.has(node.id)))) : [];
  };
  state.renderSelection = () => {
    const s = state.selection;
    if (!s || s.courseId !== currentCourseId || activeReadingReview !== state) return;
    const rows = state.filtered();
    el('SelectionList').innerHTML = s.loading ? '<p class="loading-tip">加载中…</p>' : rows.length ? rows.map(row =>
      `<div class="reading-review-select-row"><label class="material-review-option"><input type="checkbox" value="${row.id}" ${s.ids.has(row.id) ? 'checked' : ''} ${state.busy ? 'disabled' : ''} onchange="selectMaterialReview(${row.id},this.checked)" /><span><strong>${escapeHtml(row.title)}</strong><small>${row.review_status === 'reviewed' ? '已复习' : '未复习'}${row.file_url ? ' · 附件' : ''}</small>${row.content ? `<small>${escapeHtml(row.content.slice(0,180))}</small>` : ''}</span></label>${readingFavoriteButton(kind,row)}</div>`).join('') : `<p class="empty">暂无匹配${label}</p>`;
    const count = rows.filter(row=>s.ids.has(row.id)).length, all = el('SelectAll');
    all.checked = !!rows.length && count === rows.length; all.indeterminate = count > 0 && count < rows.length;
    all.disabled = s.loading || state.busy || !rows.length;
    el('SelectedCount').textContent = s.ids.size;
    el('Start').disabled = s.loading || state.busy || !s.ids.size;
  };
  state.loadTags = async () => {
    const s = state.selection;
    if (!s) return;
    el('Tags').textContent = '加载标签…';
    try {
      const tree = await requestList(`${API}/courses/${s.courseId}/knowledge-tree`);
      if (state.selection !== s || s.courseId !== currentCourseId || activeReadingReview !== state) return;
      const nodes = [];
      function visit(children, parents) {
        for (const node of children) {
          if (node.is_system) continue;
          const names = [...parents,node.name]; nodes.push({id:node.id,name:names.join(' / ')}); visit(node.children||[],names);
        }
      }
      visit(tree,[]);
      el('Tags').innerHTML = nodes.length ? nodes.map(node=>`<label class="reading-review-tag"><input type="checkbox" value="${node.id}" ${s.nodeIds.has(node.id) ? 'checked' : ''} onchange="changeReadingReviewTag(${node.id},this.checked)" />${escapeHtml(node.name)}</label>`).join('') : '暂无标签';
    } catch (err) {
      if (state.selection === s && activeReadingReview === state) el('Tags').innerHTML = `<span class="material-review-error">${escapeHtml(err.message)}</span><button onclick="activeReadingReview.loadTags()">重试标签</button>`;
    }
  };
  state.reloadSelection = async () => {
    const s = state.selection;
    if (!s) return;
    s.loading = true; state.renderSelection(); el('SelectionError').textContent = '';
    try {
      const rows = await requestList(`${API}/courses/${s.courseId}/${kind}`);
      if (state.selection !== s || s.courseId !== currentCourseId || activeReadingReview !== state) return;
      s.rows = rows.filter(row=>row.course_id === s.courseId); s.loading = false; state.renderSelection();
    } catch (err) {
      if (state.selection !== s || activeReadingReview !== state) return;
      el('SelectionError').innerHTML = `${escapeHtml(err.message)}<button onclick="activeReadingReview.reloadSelection()">重新加载</button>`;
    }
  };
  state.open = async () => {
    if (state.busy || activeReadingReview.busy) return;
    activeReadingReview.close(); activeReadingReview = state;
    state.selection = {courseId:currentCourseId,rows:[],ids:new Set(),q:'',status:'',favorite:false,nodeIds:new Set(),loading:true};
    el('FavoriteFilter').checked = false;
    el('Search').value = ''; el('Search').placeholder = `${label}标题或正文`; el('StatusFilter').value = '';
    document.getElementById('readingReviewSearchLabel').textContent = `搜索${label}`;
    el('PickerTitle').textContent = `选择复习${label}`;
    el('Picker').classList.add('show'); document.body.classList.add('material-review-open'); el('PickerTitle').focus();
    await Promise.all([state.reloadSelection(),state.loadTags()]);
  };
  state.filter = value => { if (state.selection && !state.busy) { state.selection.q = value.trim(); state.renderSelection(); } };
  state.filterStatus = value => { if (state.selection && !state.busy) { state.selection.status = ['reviewed','unreviewed'].includes(value) ? value : ''; state.renderSelection(); } };
  state.filterFavorite = value => { if (state.selection && !state.busy) { state.selection.favorite = !!value; state.renderSelection(); } };
  state.filterTag = (id,checked) => { if (state.selection && !state.busy) { if (checked) state.selection.nodeIds.add(id); else state.selection.nodeIds.delete(id); state.renderSelection(); } };
  state.select = (id,checked) => {
    const s = state.selection;
    if (!s || s.loading || state.busy || !s.rows.some(row=>row.id === id)) return;
    if (checked) s.ids.add(id); else s.ids.delete(id); state.renderSelection();
  };
  state.selectAll = checked => {
    const s = state.selection; if (!s || s.loading || state.busy) return;
    for (const row of state.filtered()) { if (checked) s.ids.add(row.id); else s.ids.delete(row.id); }
    state.renderSelection();
  };
  state.clear = () => { if (state.selection && !state.busy) { state.selection.ids.clear(); state.renderSelection(); } };
  // 调度层只提供固定对象和存储位置；阅读、提交、跳过及重试仍走同一控制器。
  state.startItems = async ids => {
    if (state.busy || !ids.length) return;
    state.queue = {kind,courseId:currentCourseId,ids:[...ids],index:0,results:{},skipped:[],pending:null,active:true,finished:false,
      sessionId:options.sessionId || null,sessionItems:options.sessionItems || null};
    store(state.queue); await state.show();
  };
  const successes = () => Object.values(state.queue?.results || {}).filter(value=>value==='reviewed'||value==='clear').length;
  state.start = async () => {
    const s = state.selection;
    if (!s || !s.ids.size || s.loading || state.busy) return;
    state.busy = true; state.renderSelection();
    try {
      const rows = await requestList(`${API}/courses/${s.courseId}/${kind}`);
      const selected = rows.filter(row=>row.course_id === s.courseId && s.ids.has(row.id));
      if (selected.length !== s.ids.size) throw new Error(`部分已选${label}已删除，请重新选择`);
      if (state.selection !== s || currentCourseId !== s.courseId) return;
      s.sessionRequestId ||= reviewRequestId();
      const session=await createReviewRecord(kind==='materials' ? 'material' : 'note',selected.map(row=>({type:kind==='materials' ? 'material' : 'note',id:row.id})),{requestId:s.sessionRequestId});
      if (state.selection !== s || currentCourseId !== s.courseId) return;
      preserveLegacyReviewQueue((kind==='materials' ? 'material' : 'note')+'-review-queue:'+s.courseId,kind==='materials' ? 'material' : 'note');
      state.queue = {kind,courseId:s.courseId,ids:selected.map(row=>row.id),index:0,results:{},skipped:[],pending:null,active:true,finished:false,
        sessionId:session.id,sessionItems:reviewSessionMap(session)};
      store(state.queue); state.busy = false; state.close(); await state.show();
    } catch (err) { if (activeReadingReview === state) el('SelectionError').textContent = err.message; }
    finally { state.busy = false; state.renderSelection(); }
  };
  state.resume = async () => {
    if (state.busy || activeReadingReview.busy) return;
    const saved = read(); if (!saved || saved.finished) return;
    if(saved.sessionId)await resumeRecordedReview(saved.sessionId);
    activeReadingReview.close();
    activeReadingReview = state; state.queue = saved; saved.active = true; store(saved); await state.show();
  };
  state.restore = async courseId => {
    const saved = read();
    if (courseId === currentCourseId && saved?.active) { if(saved.sessionId)await resumeRecordedReview(saved.sessionId);activeReadingReview = state; state.queue = saved; await state.show(); }
  };
  const api = async (id,status) => {
    const courseId = state.queue.courseId;
    const params=new URLSearchParams();
    if(status && options.planItems)params.set('planItemId',options.planItems[id]);
    if(status && state.queue.sessionItems?.[id])params.set('sessionItemId',state.queue.sessionItems[id]);
    const context=params.size ? '?'+params : '';
    const exposure=status==='exposure';
    const recall=status==='reviewed'?'clear':status;
    const response = await requestApi(`${API}/courses/${courseId}/${kind}/${id}/review${context}`,
      status ? {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(exposure?{reviewStatus:'reviewed'}:{recall})} : undefined);
    const row = await response.json();
    const expected=(exposure||recall==='clear')?'reviewed':'unreviewed';
    if (row.id !== id || row.course_id !== courseId || !['reviewed','unreviewed'].includes(row.review_status) || status && row.review_status !== expected) throw new Error(`${label}复习响应无效，请重新确认`);
    return row;
  };
  const reviewModeForRow = row => {
    if(!row||typeof workbenchSelection!=='function')return 'standard';
    try{
      const context={courseId:state.queue.courseId,type:kind==='notes'?'note':'material',
        id:row.id,row,sessionId:state.queue.sessionId,sessionItemId:state.queue.sessionItems?.[row.id]};
      return readReviewActive(context)?.mode||workbenchSelection(context).mode;
    }catch{return 'standard';}
  };
  const reviewProgressText = row => {
    const inCenter=hasCenterNavigation();
    const session=inCenter?centerReview.session:null;
    const current=inCenter?centerReview.position+1:state.queue.index+1;
    const total=inCenter?session.total:state.queue.ids.length;
    const processed=inCenter?Math.max(0,session.total-(session.pending||0)):
      new Set([...Object.keys(state.queue.results||{}),...(state.queue.skipped||[])]).size;
    const mode=row?reviewModeForRow(row):null;
    return `第 ${current} / ${total} 条 · 已处理 ${processed} 条 · ${label} · ${mode?(AI_REVIEW_METHODS[mode]||'复习'):'加载中…'}`;
  };
  state.actions = () => {
    if (!current() || state.queue.finished) return;
    // The center owns navigation; this panel only supplies recall/exposure and save retry controls.
    el('Progress').hidden = hasCenterNavigation();
    if(options.readOnly){el('Actions').innerHTML='<p>本项已处理，可使用上方按钮查看其他项目。</p>';return;}
    const queue = state.queue, disabled = !state.row || state.busy || queue.pending ? 'disabled' : '';
    el('Progress').textContent = reviewProgressText(state.row);
    if(queue.recallAgain&&state.row&&queue.recallAgain.id===state.row.id){
      const weak=queue.recallAgain.status==='forgotten'?'不记得':'模糊';
      el('Actions').innerHTML=`<div class="review-recall-again" role="status"><strong>已再次温习</strong><p>你选择了“${weak}”。内容已重新展示，但本次不计成功复习；只有选择“清楚”才算通过。</p><button type="button" id="materialReviewNext" onclick="nextMaterialReview()" ${disabled}>看完，继续下一条</button></div>`;
      if(options.sessionId && typeof renderCenterReviewToolbar==='function')renderCenterReviewToolbar();
      return;
    }
    const mode=reviewModeForRow(state.row);
    const assessment=mode==='reading'
      ? `<p class="mistake-ai-note">当前是阅读标记：只记录曝光，不计成功复习；掌握情况需切换到标准复习再作答。</p><button data-material-review="exposure" onclick="saveMaterialReview('exposure')" ${disabled}>已阅读（仅曝光）</button>`
      : `<div class="review-recall-actions" aria-label="这遍回忆得怎么样"><button data-material-review="reviewed" onclick="saveMaterialReview('reviewed')" ${disabled}>清楚</button><button data-material-review="vague" onclick="saveMaterialReview('vague')" ${disabled}>模糊</button><button data-material-review="forgotten" onclick="saveMaterialReview('forgotten')" ${disabled}>不记得</button></div><p class="mistake-ai-note">“清楚”计为成功复习；“模糊/不记得”会再次展示内容，但不计成功。</p>`;
    const navigation = hasCenterNavigation() ? '' : `<button id="materialReviewNext" onclick="nextMaterialReview()" ${disabled}>跳过此条</button><button onclick="pauseMaterialReview()" ${state.busy ? 'disabled' : ''}>退出，稍后继续</button><button onclick="endMaterialReview()" ${state.busy ? 'disabled' : ''}>结束本轮</button>`;
    el('Actions').innerHTML = `${assessment}${queue.pending ? `<button onclick="retryMaterialReview()" ${state.busy ? 'disabled' : ''}>重试上次保存</button>` : ''}${navigation}`;
    if(options.sessionId && typeof renderCenterReviewToolbar==='function')renderCenterReviewToolbar();
  };
  state.show = async () => {
    const queue = state.queue; if (!queue || queue.courseId !== currentCourseId) return;
    if(typeof resetResourceAi==='function')resetResourceAi();
    const request = ++state.request; activeReadingReview = state;
    currentView = {type:'readingReview',reviewKind:kind}; showPageOnly('materialReviewPage');
    document.getElementById('readingReviewHeading').textContent = `${label}复习`;
    state.row = null; el('Error').textContent = ''; el('Preview').innerHTML = ''; el('Content').textContent = '';
    el('Title').textContent = '加载中…'; el('Status').textContent = ''; el('OpenFile').style.display = 'none';
    el('Complete').style.display = queue.finished ? 'block' : 'none'; el('Item').style.display = queue.finished ? 'none' : 'block';
    if (queue.finished || queue.index === queue.ids.length) {
      if (options.onFinish) { queue.active = false; store(queue); await options.onFinish(); return; }
      const exposures=Object.values(queue.results||{}).filter(value=>value==='exposed').length;
      el('Progress').textContent = `已处理 ${queue.ids.length} / ${queue.ids.length} 条 · 成功复习 ${successes()} 条 · 仅曝光 ${exposures} 条`;
      el('Actions').innerHTML = ''; el('Complete').style.display = 'block';
      el('Complete').innerHTML = `<h2>本轮${label}复习完成</h2><p>成功复习 ${successes()} 条，仅阅读曝光 ${exposures} 条，跳过 ${queue.skipped.length} 条。后两项都不计成功掌握。</p><button onclick="pauseMaterialReview()">返回${label}列表</button>`;
      return;
    }
    state.actions();
    try {
      const row = await api(queue.ids[queue.index]);
      if (request !== state.request || !current() || state.queue !== queue) return;
      state.row = row; el('Title').textContent = row.title;
      if(!options.readOnly&&queue.sessionItems?.[row.id]){
        try{await requestApi(`${API}/courses/${queue.courseId}/review-items/${kind==='notes'?'note':'material'}/${row.id}/history/reading`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionItemId:queue.sessionItems[row.id]})});}
        catch{if(request===state.request&&current())el('Error').textContent='阅读内容快照未保存，重新加载可重试；不影响原复习操作。';}
        if(request!==state.request||!current()||state.queue!==queue)return;
      }
      el('Status').textContent = `当前状态：${row.review_status === 'reviewed' ? '已复习' : '未复习'}`;
      el('Content').textContent = row.content || (row.file_url ? '' : '暂无正文或附件');
      if (row.file_url) {
        const url = API.replace(/\/api\/?$/,'') + row.file_url;
        const type = row.file_type || (isImageFile('',row.file_url) ? 'image/unknown' : /\.pdf$/i.test(row.file_url) ? 'application/pdf' : '');
        renderResourcePreview(type,url,el('Preview')); el('OpenFile').href = url; el('OpenFile').style.display = 'none';
      }
      state.actions();
      if(globalThis.COURSES_SHOW_LEGACY_RESOURCE_AI===true&&!options.readOnly&&typeof mountResourceAi==='function')mountResourceAi(el('Item'),kind==='notes'?'note':'material',row,
        {sessionId:queue.sessionId,sessionItemId:queue.sessionItems?.[row.id]});
    } catch (err) {
      if (request !== state.request || !current()) return;
      el('Error').textContent = err.message;
      el('Actions').innerHTML = '<button onclick="showMaterialReview()">重新加载本条内容</button>'
        + (hasCenterNavigation() ? '' : '<button onclick="pauseMaterialReview()">退出，稍后继续</button>');
    }
  };
  const advance = async () => {
    if(state.queue.sessionId && !options.onFinish && state.queue.index+1<state.queue.ids.length)await recordedReviewAction(state.queue.sessionId,'position',{position:state.queue.index+1});
    if(state.queue.sessionId)await syncCenterReviewCounts(state.queue);
    state.queue.index++; state.queue.finished = state.queue.index === state.queue.ids.length; store(state.queue); await state.show();
  };
  const syncCenterReviewCounts = async queue => {
    if(typeof centerReview==='undefined'||!centerReview||centerReview.session.id!==queue.sessionId)return;
    try{
      const latest=await(await requestApi(reviewSessionApi(queue.sessionId))).json();
      if(centerReview?.session.id===queue.sessionId)centerReview.session=latest;
    }catch{ /* 计数刷新失败不改变已确认的判分；进入下一项后仍可重新同步。 */ }
  };
  state.save = async status => {
    if (!current() || !state.row || state.busy || state.queue.pending || !['reviewed','clear','exposure','vague','forgotten'].includes(status) || options.readOnly) return;
    const savedStatus=status==='clear'?'reviewed':status;
    state.queue.recallAgain=null;
    state.queue.pending = {id:state.row.id,status:savedStatus}; store(state.queue); await state.retry();
  };
  state.retry = async () => {
    const queue = state.queue, pending = queue?.pending;
    if (!current() || !pending || state.busy || pending.id !== queue.ids[queue.index]) return;
    state.busy = true; state.actions(); el('Error').textContent = '';
    try {
      const row = await api(pending.id,pending.status);
      if (!current() || state.queue !== queue) return;
      queue.pending = null;
      if(pending.status==='vague'||pending.status==='forgotten'){
        queue.results[row.id]=pending.status;
        queue.recallAgain={id:row.id,status:pending.status};
        state.row=row;store(queue);await syncCenterReviewCounts(queue);state.actions();
        const recallId=queue.recallAgain.id;
        setTimeout(()=>{
          if(current()&&state.queue===queue&&queue.recallAgain?.id===recallId&&!state.busy)void state.skip();
        },1800);
      }else if(pending.status==='exposure'){
        queue.results[row.id]='exposed';queue.recallAgain=null;
        await advance();
      }else{
        queue.results[row.id] = 'reviewed';queue.recallAgain=null;
        await advance();
      }
    } catch (err) { if (current()) el('Error').textContent = err.message + '；保存未确认，不会自动跳题，可重试。'; }
    finally { state.busy = false; state.actions(); }
  };
  state.skip = async () => {
    if (!current() || !state.row || state.busy || state.queue.pending || options.readOnly) return;
    if(state.queue.recallAgain?.id===state.row.id){state.queue.recallAgain=null;await advance();return;}
    state.busy = true;
    try {
      if(state.queue.sessionId)await recordedReviewAction(`${state.queue.sessionId}/items/${state.queue.sessionItems[state.row.id]}`,'skip');
      if (!state.queue.skipped.includes(state.row.id)) state.queue.skipped.push(state.row.id);
      await advance();
    } catch(err){el('Error').textContent=err.message;}
    finally { state.busy = false; state.actions(); }
  };
  state.pause = async () => {
    if (state.busy) return;
    if(state.queue?.sessionId) {
      try {await recordedReviewAction(state.queue.sessionId,'pause');}catch(err){el('Error').textContent=err.message;return;}
    }
    if (state.queue?.courseId === currentCourseId) { state.queue.active = false; store(state.queue); }
    if (options.onExit) { ++state.request; state.row = null; await options.onExit(); return; }
    ++state.request; state.row = null; currentView = {type:'course',tab:kind}; showPageOnly('detailPage'); switchTab(kind);
  };
  state.end = async () => { if (!state.busy) { if(state.queue?.sessionId){try{await recordedReviewAction(state.queue.sessionId,'pause');}catch(err){el('Error').textContent=err.message;return;}}store(null); state.queue = null; await state.pause(); } };
  return state;
}

const materialReadingReview = createReadingReview('materials','资料','materialReviewResume');
let activeReadingReview = materialReadingReview;
function openMaterialReviewPicker() { return materialReadingReview.open(); }
function renderMaterialReviewResume() { materialReadingReview.renderResume(); }
function resumeMaterialReview() { return materialReadingReview.resume(); }
function restoreMaterialReviewLocation(courseId) { return materialReadingReview.restore(courseId); }
function closeMaterialReviewPicker() { activeReadingReview.close(); }
function filterMaterialReview(value) { activeReadingReview.filter(value); }
function filterReadingReviewStatus(value) { activeReadingReview.filterStatus(value); }
function filterReadingReviewFavorite(value) { activeReadingReview.filterFavorite(value); }
function changeReadingReviewTag(id,checked) { activeReadingReview.filterTag(id,checked); }
function selectMaterialReview(id,checked) { activeReadingReview.select(id,checked); }
function selectAllMaterialReview(checked) { activeReadingReview.selectAll(checked); }
function clearMaterialReviewSelection() { activeReadingReview.clear(); }
function startMaterialReview() { return activeReadingReview.start(); }
function showMaterialReview() { return activeReadingReview.show(); }
function saveMaterialReview(status) { return activeReadingReview.save(status); }
function retryMaterialReview() { return activeReadingReview.retry(); }
function nextMaterialReview() { return activeReadingReview.skip(); }
function pauseMaterialReview() { return activeReadingReview.pause(); }
function endMaterialReview() { return activeReadingReview.end(); }
