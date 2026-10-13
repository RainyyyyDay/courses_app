// 资料/笔记共用浏览筛选与收藏保存；与错题业务独立。
const readingBrowse = {};
const readingFavoritePending = new Set();
function ensureReadingBrowse(kind) {
  const host = document.getElementById(kind + 'BrowseFilters');
  if (readingBrowse[kind]?.courseId === currentCourseId) return readingBrowse[kind];
  const state = readingBrowse[kind] = {courseId:currentCourseId,q:'',favorite:false,status:'',nodeIds:new Set()};
  host.innerHTML = `<div class="reading-browse-controls"><input aria-label="搜索标题或正文" placeholder="搜索标题或正文" oninput="changeReadingBrowse('${kind}','q',this.value)" /><label><input type="checkbox" onchange="changeReadingBrowse('${kind}','favorite',this.checked)" />收藏</label><select aria-label="复习状态" onchange="changeReadingBrowse('${kind}','status',this.value)"><option value="">全部复习状态</option><option value="reviewed">已复习</option><option value="unreviewed">未复习</option></select></div><details><summary>知识点标签（可多选）</summary><div class="reading-browse-tags">加载标签…</div></details><div class="material-review-error" role="alert"></div>`;
  loadReadingBrowseTags(kind,state);
  return state;
}
async function loadReadingBrowseTags(kind,state = readingBrowse[kind]) {
  const host = document.getElementById(kind + 'BrowseFilters');
  try {
    const tree = await requestList(`${API}/courses/${state.courseId}/knowledge-tree`);
    if (readingBrowse[kind] !== state || state.courseId !== currentCourseId) return;
    const nodes = [];
    function visit(items,parents) {
      for (const node of items) {
        if (node.is_system) continue;
        const path = [...parents,node.name]; nodes.push({id:node.id,name:path.join(' / ')}); visit(node.children || [],path);
      }
    }
    visit(tree,[]);
    host.querySelector('.reading-browse-tags').innerHTML = nodes.length ? nodes.map(node=>`<label class="reading-review-tag"><input type="checkbox" ${state.nodeIds.has(node.id) ? 'checked' : ''} onchange="changeReadingBrowseTag('${kind}',${node.id},this.checked)" />${escapeHtml(node.name)}</label>`).join('') : '暂无标签';
  } catch (err) {
    if (readingBrowse[kind] === state && currentCourseId === state.courseId) host.querySelector('.reading-browse-tags').innerHTML = `${escapeHtml(err.message)}<button onclick="loadReadingBrowseTags('${kind}')">重试标签</button>`;
  }
}
function readingBrowseQuery(kind) {
  const state = ensureReadingBrowse(kind), params = new URLSearchParams();
  if (state.q.trim()) params.set('q',state.q.trim());
  if (state.favorite) params.set('favorite','true');
  if (state.status) params.set('reviewStatus',state.status);
  if (state.nodeIds.size) params.set('nodeIds',[...state.nodeIds].join(','));
  return params.size ? '?' + params : '';
}
function reloadReadingBrowse(kind) { return kind === 'notes' ? loadNotes() : loadMaterials(); }
function changeReadingBrowse(kind,key,value) {
  const state = ensureReadingBrowse(kind); state[key] = value; return reloadReadingBrowse(kind);
}
function changeReadingBrowseTag(kind,id,checked) {
  const state = ensureReadingBrowse(kind);
  if (checked) state.nodeIds.add(id); else state.nodeIds.delete(id);
  return reloadReadingBrowse(kind);
}
function readingFavoriteButton(kind,row) {
  const pending = readingFavoritePending.has(`${currentCourseId}:${kind}:${row.id}`);
  return `<button class="reading-favorite ${row.favorite ? 'is-favorite' : ''}" data-reading-favorite="${row.id}" aria-label="${row.favorite ? '取消收藏' : '收藏'}" aria-pressed="${!!row.favorite}" ${pending ? 'disabled' : ''} onclick="event.stopPropagation();toggleReadingFavorite('${kind}',${row.id},${!row.favorite},this)">${row.favorite ? '★' : '☆'}</button>`;
}
async function toggleReadingFavorite(kind,id,favorite,button) {
  const courseId = currentCourseId, key = `${courseId}:${kind}:${id}`;
  if (readingFavoritePending.has(key)) return;
  readingFavoritePending.add(key); button.disabled = true;
  const error = document.querySelector(`#${kind}BrowseFilters [role=alert]`);
  if (error) error.textContent = '';
  if (activeReadingReview.kind === kind && activeReadingReview.selection) document.getElementById('materialReviewSelectionError').textContent = '';
  try {
    const response = await requestApi(`${API}/courses/${courseId}/${kind}/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite})});
    const row = await response.json();
    if (row.id !== id || row.course_id !== courseId || !!row.favorite !== favorite) throw new Error('收藏保存响应无效，请重试');
    if (courseId !== currentCourseId) return;
    const controller = kind === 'notes' ? noteReadingReview : materialReadingReview;
    if (controller.selection?.courseId === courseId) {
      controller.selection.rows = controller.selection.rows.map(item=>item.id === id ? {...item,favorite:row.favorite} : item);
    }
    await reloadReadingBrowse(kind);
  } catch (err) {
    if (courseId === currentCourseId) {
      if (error) error.textContent = err.message + '；可点击星标重试。';
      if (activeReadingReview.kind === kind && activeReadingReview.selection) document.getElementById('materialReviewSelectionError').textContent = err.message + '；可点击星标重试。';
    }
  } finally {
    readingFavoritePending.delete(key);
    if (button.isConnected) button.disabled = false;
    if (courseId === currentCourseId) {
      const listId = kind === 'notes' ? 'noteList' : 'materialList';
      document.querySelectorAll(`#${listId} [data-reading-favorite="${id}"]`).forEach(star=>star.disabled = false);
    }
    if (courseId === currentCourseId && activeReadingReview.kind === kind) activeReadingReview.renderSelection();
  }
}
