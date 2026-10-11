/* 错题分类与列表。沿用全局脚本和现有页面容器，不引入路由或框架。 */
const MISTAKE_TYPES = { knowledge: '知识类', thinking: '思维类', execution: '执行类', unclassified: '待分类' };
let mistakeUi = { courseId: null, type: null, q: '', favorite: '', reviewStatus: '', nodeIds: [] };
let mistakeListRequest = 0;
let mistakeTagRequest = 0;

function mistakeStorageGet(key) {
  try { return typeof localStorage === 'undefined' ? null : JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function mistakeStorageSet(key, value) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value)); } catch { /* 存储不可用仍可正常操作，进度以后端为准。 */ }
}
function ensureMistakeUi() {
  if (mistakeUi.courseId === currentCourseId) return;
  const saved = mistakeStorageGet('mistake-list:' + currentCourseId) || {};
  mistakeUi = {
    courseId: currentCourseId, type: Object.hasOwn(MISTAKE_TYPES, saved.type) ? saved.type : null,
    q: typeof saved.q === 'string' ? saved.q : '',
    favorite: ['true', 'false'].includes(saved.favorite) ? saved.favorite : '',
    reviewStatus: ['reviewed', 'unreviewed'].includes(saved.reviewStatus) ? saved.reviewStatus : '',
    nodeIds: Array.isArray(saved.nodeIds) ? saved.nodeIds.filter(Number.isSafeInteger) : []
  };
}
function rememberMistakeUi() { mistakeStorageSet('mistake-list:' + currentCourseId, mistakeUi); }
function mistakeStatusText(status) { return status === 'reviewed' ? '已复习' : '未复习'; }
function mistakeCreationFields() {
  const mistakeType = document.getElementById('mistakeCreateType').value;
  if (!['knowledge', 'thinking', 'execution'].includes(mistakeType)) throw new Error('请选择错题类型');
  return { mistakeType, answerContent: document.getElementById('mistakeCreateAnswer').value,
    explanation: document.getElementById('mistakeCreateExplanation').value };
}

function renderMistakeCategories(rows = null) {
  const home = !mistakeUi.type;
  document.getElementById('mistakeCategories').style.display = home ? 'grid' : 'none';
  document.getElementById('mistakeFilters').style.display = home ? 'none' : 'block';
  document.getElementById('mistakeCategories').innerHTML = Object.entries(MISTAKE_TYPES).map(([type, name]) =>
    `<button type="button" data-mistake-category="${type}" onclick="openMistakeCategory('${type}')">${name}<small>${rows ? rows.filter(r => r.mistake_type === type).length + ' 道' : '…'}</small></button>`).join('');
  document.getElementById('mistakeCategoryTitle').textContent = MISTAKE_TYPES[mistakeUi.type] || '';
  document.getElementById('mistakeSearch').value = mistakeUi.q;
  document.getElementById('mistakeFavoriteFilter').value = mistakeUi.favorite;
  document.getElementById('mistakeStatusFilter').value = mistakeUi.reviewStatus;
}

async function openMistakeCategory(type) {
  ensureMistakeUi();
  mistakeUi.type = Object.hasOwn(MISTAKE_TYPES, type) ? type : null;
  rememberMistakeUi();
  mistakeStorageSet('mistake-detail:' + currentCourseId, null);
  await loadMistakes();
}

async function loadMistakes() {
  ensureMistakeUi();
  const courseId = currentCourseId;
  const request = ++mistakeListRequest;
  const box = document.getElementById('mistakeList');
  renderMistakeCategories();
  box.innerHTML = '<div class="loading-tip">加载中…</div>';
  const filters = mistakeUi.type ? {
    mistakeType: mistakeUi.type, q: mistakeUi.q, favorite: mistakeUi.favorite,
    reviewStatus: mistakeUi.reviewStatus, nodeIds: mistakeUi.nodeIds.join(',')
  } : {};
  const query = Object.entries(filters).filter(([, value]) => value !== '').map(([key, value]) => key + '=' + encodeURIComponent(value)).join('&');
  if (mistakeUi.type) loadMistakeFilterTags();
  try {
    const rows = await requestList(`${API}/courses/${courseId}/mistakes${query ? '?' + query : ''}`);
    if (request !== mistakeListRequest || courseId !== currentCourseId) return;
    currentMistakes = rows;
    if (!mistakeUi.type) {
      renderMistakeCategories(rows);
      box.innerHTML = `<div class="empty">${rows.length ? '选择一个分类查看错题' : '暂无错题，可上传文件或手动输入'}</div>`;
      return;
    }
    if (!rows.length) { box.innerHTML = '<div class="empty">暂无符合条件的错题</div>'; return; }
    box.innerHTML = rows.map(r => `
      <div class="item-row" data-mistake-id="${r.id}">
        <div class="info">
          <div class="title">${escapeHtml(r.title)}</div>
          <span class="mistake-state ${r.review_status === 'reviewed' ? 'mistake-state-reviewed' : ''}">${mistakeStatusText(r.review_status)}</span>
          <span class="mistake-state">${MISTAKE_TYPES[r.mistake_type] || '待分类'}</span>${r.favorite ? '<span class="mistake-state">★ 已收藏</span>' : ''}
          <div class="meta">${!r.image_url ? '手动输入' : (isImageFile(r.file_type, r.image_url) ? '图片' : '文件')} · ${escapeHtml(r.created_at || '')}</div>
          ${r.content ? `<div class="row-content">${escapeHtml(r.content)}</div>` : ''}
          <div class="mistake-tags">${nodeChipsHtml(r)}</div>
        </div>
        <div class="mistake-actions">
          <button onclick="openMistakeDetail(${r.id})">详情 / 编辑</button>
          ${r.mistake_type !== 'unclassified' ? `<button onclick="openMistakeDetail(${r.id}, true)">复习</button>` : ''}
          <button onclick="toggleMistakeFavorite(${r.id}, ${!r.favorite}, this)">${r.favorite ? '取消收藏' : '收藏'}</button>
          <button onclick="openTagPicker('edit', 'mistake', ${r.id})">标签</button>
          <button onclick="delItem('mistakes', ${r.id}, loadMistakes)">删除</button>
        </div>
      </div>`).join('');
  } catch (err) {
    if (request !== mistakeListRequest || courseId !== currentCourseId) return;
    currentMistakes = [];
    showListError(box, err);
    box.insertAdjacentHTML?.('beforeend', '<button type="button" onclick="loadMistakes()">重试</button>');
  }
}

async function loadMistakeFilterTags() {
  const courseId = currentCourseId;
  const request = ++mistakeTagRequest;
  const box = document.getElementById('mistakeFilterTags');
  box.innerHTML = '<div class="loading-tip">加载标签…</div>';
  try {
    const tree = await requestList(`${API}/courses/${courseId}/knowledge-tree`);
    if (courseId !== currentCourseId || request !== mistakeTagRequest) return;
    const nodes = [];
    function visit(children, path) {
      for (const node of children) {
        if (node.is_system) continue;
        const name = [...path, node.name];
        nodes.push({ id: node.id, name: name.join(' / ') });
        visit(node.children || [], name);
      }
    }
    visit(tree, []);
    // 已删除标签不再作为筛选参数发送，避免列表一直返回 400。
    const valid = new Set(nodes.map(n => n.id));
    const old = mistakeUi.nodeIds.length;
    mistakeUi.nodeIds = mistakeUi.nodeIds.filter(id => valid.has(id));
    rememberMistakeUi();
    box.innerHTML = nodes.length ? nodes.map(n => `<label class="mistake-filter-tag"><input type="checkbox" value="${n.id}" ${mistakeUi.nodeIds.includes(n.id) ? 'checked' : ''} onchange="changeMistakeTagFilter(${n.id}, this.checked)" />${escapeHtml(n.name)}</label>`).join('') : '<span class="tag-none">暂无可选标签</span>';
    if (old !== mistakeUi.nodeIds.length) loadMistakes();
  } catch (err) {
    if (courseId !== currentCourseId || request !== mistakeTagRequest) return;
    box.innerHTML = `<div class="mistake-inline-error">${escapeHtml(err.message)}</div><button type="button" onclick="loadMistakeFilterTags()">重试标签</button>`;
  }
}

async function applyMistakeFilters() {
  mistakeUi.q = document.getElementById('mistakeSearch').value.trim();
  mistakeUi.favorite = document.getElementById('mistakeFavoriteFilter').value;
  mistakeUi.reviewStatus = document.getElementById('mistakeStatusFilter').value;
  rememberMistakeUi();
  await loadMistakes();
}
async function changeMistakeTagFilter(id, checked) {
  mistakeUi.nodeIds = checked ? [...new Set([...mistakeUi.nodeIds, id])] : mistakeUi.nodeIds.filter(value => value !== id);
  await applyMistakeFilters();
}
async function clearMistakeFilters() {
  Object.assign(mistakeUi, { q: '', favorite: '', reviewStatus: '', nodeIds: [] });
  rememberMistakeUi();
  await loadMistakes();
}
async function toggleMistakeFavorite(id, favorite, button) {
  const courseId = currentCourseId;
  if (button) button.disabled = true;
  try {
    await requestApi(`${API}/courses/${courseId}/mistakes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite }) });
    if (courseId === currentCourseId) await loadMistakes();
  } catch (err) { showToast(err.message); } finally { if (button) button.disabled = false; }
}

async function uploadMistake() {
  const input = document.getElementById('mistakeFile');
  const file = input.files[0];
  if (!file) return;
  pendingUploadFile = file;
  input.value = '';
  await openTagPicker('upload', 'mistake', null);
}
async function doUploadMistake(file, knowledgeIds, title) {
  const options = mistakeCreationFields();
  const uploadBtn = document.querySelector('#pane-mistakes .upload-btn');
  const originalText = uploadBtn.textContent;
  uploadBtn.textContent = '上传中…'; uploadBtn.disabled = true;
  const fd = new FormData();
  fd.append('file', file);
  if (title) fd.append('title', title);
  fd.append('knowledgeIds', JSON.stringify(knowledgeIds));
  for (const [key, value] of Object.entries(options)) fd.append(key, value);
  try {
    await requestApi(`${API}/courses/${currentCourseId}/mistakes`, { method: 'POST', body: fd });
    showToast('上传成功');
    await loadMistakes();
    return true;
  } catch (err) { showToast(err.message); return false; }
  finally { uploadBtn.textContent = originalText; uploadBtn.disabled = false; }
}
