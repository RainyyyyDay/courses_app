/*
 * courses.js
 * 课程列表页：加载、搜索过滤、渲染、双击改名、添加 / 删除 / 置顶
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ========== 课程列表 ========== */

// 1. 负责向后端要数据
async function loadCourses() {
  const list = document.getElementById('courseList');
  // 兜底：万一 index.html 不是配套的那一份，至少报个明确的错，而不是白屏
  if (!list) {
    console.error('#courseList 不存在：index.html 和这套 js 不是同一份，请对照 index.html 检查。');
    return;
  }
  list.innerHTML = '<div class="loading-tip">加载中…</div>';

  let responseReceived = false;
  try {
    const res = await fetch(`${API}/courses`);
    responseReceived = true;
    if (!res.ok) throw new Error(`服务器返回 HTTP ${res.status}`);
    
    // 把请求回来的数据存进全局缓存
    const courses = await res.json();
    if (!Array.isArray(courses)) throw new Error('服务器返回的课程数据格式不正确');
    allcourses = courses;
    
    // 拿到数据后，立即交给 filterCourses 去处理（如果有搜索词会自动过滤）
    filterCourses(); 
  } catch (err) {
    const message = !responseReceived && err instanceof TypeError
      ? '无法连接课程服务，请检查后端是否已在 3000 端口启动。'
      : `课程加载失败：${err.message}`;
    const error = document.createElement('div');
    error.className = 'empty';
    error.textContent = message;
    list.replaceChildren(error);
    console.error('请求失败:', err);
  }
}

// 2. 负责根据搜索框内容过滤
function filterCourses() {
  const searchInput = document.getElementById('searchInput');
  const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
  
  let result = allcourses;

  if (keyword) {
    // 只要课程名里包含关键词，就显示
    result = allcourses.filter(c => c.name.toLowerCase().includes(keyword));
  }

  // 把过滤后的结果交给 renderCourses
  renderCourses(result);
}

// 3. 负责把数据画在页面上
function renderCourses(courses) {
  const list = document.getElementById('courseList');
  
  if (courses.length === 0) {
    // 判断是“搜索没结果”还是“真的一门课都没有”
    const searchInput = document.getElementById('searchInput');
    const isSearching = searchInput && searchInput.value.trim() !== '';
    
    list.innerHTML = isSearching
      ? '<div class="empty">没有找到匹配的课程</div>'
      : '<div class="empty">还没有课程，点右上角＋添加</div>';
    return;
  }

  list.innerHTML = courses.map(c => `
    <div class="course-item ${c.pinned ? 'pinned' : ''}">
      <span class="course-name" onclick="openCourse(${c.id}, '${c.name.replace(/'/g, "\\'")}')" ondblclick="editCourseName(${c.id}, this)">
        ${c.pinned ? '📌 ' : ''}${c.name}
      </span>
      <div class="actions">
        <button class="pin" onclick="event.stopPropagation();togglePin(${c.id}, ${c.pinned})">
          ${c.pinned ? '取消置顶' : '置顶'}
        </button>
        <button class="del" onclick="event.stopPropagation();deleteCourse(${c.id})">删除</button>
      </div>
    </div>
  `).join('');
}

/* ========== 双击编辑课程名 ========== */
async function editCourseName(id, el) {
  event.stopPropagation();
  const oldName = el.textContent.replace('📌 ', '').trim();
  const newName = prompt('修改课程名：', oldName);
  if (!newName || newName === oldName) return;
  try {
    await requestApi(`${API}/courses/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });
    showToast('已修改');
    await loadCourses();
  } catch (err) { showToast(err.message || '修改失败'); }
}

/* ========== 添加课程 ========== */
function openCourseModal() {
  document.getElementById('courseModal').classList.add('show');
  document.getElementById('courseNameInput').value = '';
  document.getElementById('courseNameInput').focus();
}
function closeCourseModal() {
  document.getElementById('courseModal').classList.remove('show');
}
async function addCourse() {
  const name = document.getElementById('courseNameInput').value.trim();
  if (!name) { showToast('请输入课程名'); return; }
  try {
    await requestApi(`${API}/courses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    closeCourseModal();
    showToast('添加成功');
    await loadCourses();
  } catch (err) { showToast(err.message || '添加失败'); }
}
async function deleteCourse(id) {
  const ok = await showConfirm('确定删除这门课？删除后无法恢复。');
  if (!ok) return;
  try {
    await requestApi(`${API}/courses/${id}`, { method: 'DELETE' });
    showToast('已删除');
    await loadCourses();
  } catch (err) { showToast(err.message || '删除失败'); }
}
async function togglePin(id, pinned) {
  try {
    await requestApi(`${API}/courses/${id}/pin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !pinned })
    });
    await loadCourses();
  } catch (err) { showToast(err.message || '置顶操作失败'); }
}
