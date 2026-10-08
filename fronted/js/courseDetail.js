/*
 * courseDetail.js
 * 课程详情页：进入课程、返回列表、切换 Tab
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ========== 课程详情 ========== */
function openCourse(id, name, restoreTab = 'materials') {
  currentCourseId = id;
  currentCourseName = name;
  closeTagPicker(); // 切课程时关掉知识点选择器，避免残留上一门课程的选择
  exitSortMode();   // 切课程时退出排序模式
  localStorage.setItem('currentPage', 'detail');
  localStorage.setItem('currentCourseId', id);
  localStorage.setItem('currentCourseName', name);
  localStorage.setItem('currentTab', restoreTab);
  localStorage.setItem('courseTimeStamp', Date.now());
  document.getElementById('detailTitle').textContent = name;
  showPageOnly('detailPage');
  navStack = []; // 进入课程详情时清空来源栈
  
  switchTab(restoreTab); 
}

function backToList() {
  localStorage.setItem('currentPage', 'list');
  localStorage.removeItem('currentCourseId');
  localStorage.removeItem('currentCourseName');
  localStorage.removeItem('currentTab');
  localStorage.removeItem('courseTimeStamp');
  showPageOnly('listPage');
  navStack = [];
  currentView = { type: 'list' };
  loadCourses();
}

function switchTab(tab, el = null) {
  if (!el) {
    el = document.querySelector(`.dtab[onclick*="${tab}"]`);
  }
  if (!el) return;

  document.querySelectorAll('.dtab').forEach(e => e.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('pane-' + tab).classList.add('active');
  localStorage.setItem('currentTab', tab);
  localStorage.setItem('currentPage', 'detail'); // 确保在详情页
  localStorage.setItem('courseTimeStamp', Date.now());
  currentView = { type: 'course', tab: tab }; // 记下当前所在页面，供详情页返回
  if (tab === 'materials') loadMaterials();
  if (tab === 'notes') loadNotes();
  if (tab === 'assessments') loadAssessments();
  if (tab === 'mistakes') loadMistakes();
  if (tab === 'knowledge') loadTree();

  // 只有切到“知识框架”时，右上角才显示 ➕
  const treeBtn = document.getElementById('treeBtn');
  if (treeBtn) {
  treeBtn.style.display = (tab === 'knowledge') ? 'block' : 'none';
  }
}
