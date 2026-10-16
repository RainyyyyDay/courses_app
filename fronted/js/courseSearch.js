// 仅对接课程搜索 API；搜索摘要不加载附件，不修改各模块列表或复习状态。
const COURSE_SEARCH_LABELS = { material: '资料', note: '笔记', mistake: '错题' };
const COURSE_SEARCH_PLURALS = { material: 'materials', note: 'notes', mistake: 'mistakes' };
const COURSE_SEARCH_PAGE_SIZE = 20;
let courseSearchState = null;

function cancelCourseSearchRequest(state = courseSearchState) {
  if (!state) return;
  clearTimeout(state.timer);
  state.timer = null;
  state.controller?.abort();
  state.controller = null;
  state.request++;
  state.loading = false;
}

function resetCourseSearch() {
  cancelCourseSearchRequest();
  courseSearchState = null;
}

function openCourseSearch() {
  if (!currentCourseId || currentView.type !== 'course') return;
  if (courseSearchState?.courseId !== currentCourseId) {
    resetCourseSearch();
    courseSearchState = { courseId: currentCourseId, q: '', types: new Set(Object.values(COURSE_SEARCH_PLURALS)),
      rows: [], total: 0, offset: 0, loaded: false, loading: false, request: 0, timer: null,
      controller: null, error: '', errorAppend: false, scrollY: 0, composing: false };
  }
  navStack.push(currentView);
  currentView = { type: 'courseSearch', courseId: currentCourseId };
  renderCourseSearchPage();
  document.getElementById('courseSearchQuery').focus({ preventScroll: true });
}

function renderCourseSearchPage() {
  const state = courseSearchState;
  if (!state || state.courseId !== currentCourseId) return;
  showPageOnly('courseSearchPage');
  document.getElementById('courseSearchCourse').textContent = currentCourseName;
  document.getElementById('courseSearchQuery').value = state.q;
  document.querySelectorAll('.course-search-types input').forEach(input => { input.checked = state.types.has(input.value); });
  renderCourseSearchResults();
  window.scrollTo(0, state.scrollY);
  if (!state.loaded && !state.loading && !state.error && state.q.trim() && state.types.size) requestCourseSearch();
}

function changeCourseSearchQuery(value, composing = false) {
  if (!courseSearchState) return;
  courseSearchState.q = value;
  courseSearchState.composing = composing;
  scheduleCourseSearch();
}
function changeCourseSearchType(type, checked) {
  if (!courseSearchState || !Object.values(COURSE_SEARCH_PLURALS).includes(type)) return;
  if (checked) courseSearchState.types.add(type); else courseSearchState.types.delete(type);
  scheduleCourseSearch();
}
function scheduleCourseSearch() {
  const state = courseSearchState;
  cancelCourseSearchRequest(state); // 输入发生时立即使旧响应失效，不等防抖结束。
  Object.assign(state, { rows: [], total: 0, offset: 0, loaded: false, error: '', errorAppend: false, scrollY: 0 });
  if (!state.composing && state.q.trim() && state.types.size) {
    state.timer = setTimeout(() => { state.timer = null; requestCourseSearch(); }, 300);
  }
  renderCourseSearchResults();
}

function courseSearchIsCurrent(state, request) {
  return courseSearchState === state && state.courseId === currentCourseId && state.request === request;
}

async function requestCourseSearch(append = false) {
  const state = courseSearchState;
  if (!state || state.composing || state.courseId !== currentCourseId || currentView.type !== 'courseSearch' || (append && state.loading)) return;
  cancelCourseSearchRequest(state);
  const q = state.q.trim();
  if (!q || !state.types.size) { renderCourseSearchResults(); return; }
  if (q.length > 500 || q.includes('\0')) {
    state.error = '关键词最多 500 字，不能包含空字符'; renderCourseSearchResults(); return;
  }
  if (append && (!state.loaded || state.offset >= state.total)) return;
  const offset = append ? state.offset : 0;
  const request = state.request;
  const types = [...state.types];
  state.controller = new AbortController();
  state.loading = true;
  state.error = '';
  state.errorAppend = append;
  if (!append) { state.rows = []; state.total = 0; state.offset = 0; state.loaded = false; }
  renderCourseSearchResults();
  try {
    const params = new URLSearchParams({ q, types: types.join(','), limit: COURSE_SEARCH_PAGE_SIZE, offset });
    const response = await requestApi(`${API}/courses/${state.courseId}/search?${params}`, { signal: state.controller.signal });
    const data = await response.json();
    if (!courseSearchIsCurrent(state, request)) return;
    if (!data || data.query !== q || !Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.results)
      || data.results.length > COURSE_SEARCH_PAGE_SIZE || (data.results.length && data.total < offset + data.results.length)
      || data.results.some(row => !row || !Object.hasOwn(COURSE_SEARCH_LABELS, row.type)
        || !types.includes(COURSE_SEARCH_PLURALS[row.type]) || row.courseId !== state.courseId
        || !Number.isSafeInteger(row.id) || row.id < 1 || typeof row.title !== 'string' || typeof row.snippet !== 'string')) {
      throw new Error('搜索结果格式或课程归属不正确，请重试');
    }
    const rows = append ? state.rows : [];
    const seen = new Set(rows.map(row => row.type + ':' + row.id));
    for (const row of data.results) {
      const key = row.type + ':' + row.id;
      if (!seen.has(key)) { rows.push(row); seen.add(key); }
    }
    state.rows = rows;
    state.total = data.total;
    // 依据 API 原始页长度推进偏移；去重不会造成重复请求同一页。
    state.offset = data.results.length ? offset + data.results.length : data.total;
    state.loaded = true;
  } catch (err) {
    if (courseSearchIsCurrent(state, request)) state.error = err.message || '搜索失败，请重试';
  } finally {
    if (courseSearchIsCurrent(state, request)) {
      state.loading = false;
      state.controller = null;
      renderCourseSearchResults();
    }
  }
}

function retryCourseSearch() { return requestCourseSearch(!!courseSearchState?.errorAppend); }

function renderCourseSearchResults() {
  const state = courseSearchState;
  if (!state || state.courseId !== currentCourseId || currentView.type !== 'courseSearch') return;
  const box = document.getElementById('courseSearchResults');
  const count = document.getElementById('courseSearchCount');
  const more = document.getElementById('courseSearchMore');
  box.replaceChildren();
  box.setAttribute('aria-busy', String(state.loading));
  count.textContent = state.loaded ? `共 ${state.total} 条结果，已加载 ${state.rows.length} 条` : (state.loading ? '正在搜索…' : '');
  document.getElementById('courseSearchError').textContent = state.error;
  document.getElementById('courseSearchRetry').hidden = !state.error;
  more.hidden = !state.loaded || state.offset >= state.total || !!state.error;
  more.disabled = state.loading;
  more.textContent = state.loading ? '加载中…' : '加载更多';
  let message = '';
  if (!state.types.size) message = '请至少选择一种内容类型';
  else if (!state.q.trim()) message = '输入关键词，搜索本课程的资料、笔记和错题';
  else if (!state.loading && !state.error && state.loaded && !state.rows.length) message = '没有找到匹配的内容，请试试其他关键词';
  else if (state.timer) message = '等待搜索…';
  else if (state.composing) message = '输入完成后自动搜索';
  if (message) {
    const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = message; box.appendChild(empty);
  }
  for (const row of state.rows) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'course-search-result'; button.dataset.searchKey = row.type + ':' + row.id;
    const head = document.createElement('span'); head.className = 'course-search-result-head';
    const title = document.createElement('span'); title.className = 'course-search-result-title'; title.textContent = row.title || '（无标题）';
    const badge = document.createElement('span'); badge.className = 'material-review-badge'; badge.textContent = COURSE_SEARCH_LABELS[row.type];
    const snippet = document.createElement('span'); snippet.className = 'course-search-snippet'; snippet.textContent = row.snippet || '暂无文字摘要';
    head.append(title, badge); button.append(head, snippet);
    button.addEventListener('click', () => openCourseSearchResult(row)); box.appendChild(button);
  }
}

async function openCourseSearchResult(row) {
  const state = courseSearchState;
  if (!state || state.courseId !== currentCourseId || currentView.type !== 'courseSearch'
    || row.courseId !== state.courseId || !state.rows.includes(row)) return;
  state.scrollY = window.scrollY;
  cancelCourseSearchRequest(state);
  if (row.type === 'mistake') await openMistakeDetail(row.id, false);
  else await openResourceDetail(row.type, row.id);
}
