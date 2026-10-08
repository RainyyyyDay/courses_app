/*
 * app.js
 * 入口：全局事件绑定 + 恢复上次浏览位置
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ========== 回车提交 & 点遮罩关闭 ========== */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('courseNameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addCourse();
  });
  document.getElementById('assessTitle').addEventListener('keydown', e => {
    if (e.key === 'Enter') addAssessment();
  });
  document.getElementById('courseModal').addEventListener('click', e => {
    if (e.target.id === 'courseModal') closeCourseModal();
  });
  document.getElementById('assessmentModal').addEventListener('click', e => {
    if (e.target.id === 'assessmentModal') closeAssessmentModal();
  });
  // 点选择器外面的遮罩 = 取消，不提交任何东西
  document.getElementById('tagPickerModal').addEventListener('click', e => {
    if (e.target.id === 'tagPickerModal') closeTagPicker();
  });
  // 点页面任何其它地方，关闭“添加内容”菜单
  document.addEventListener('click', closeAddMenu);
  // 点页面任何其它地方，也关闭排序模式下的“移动”菜单
  document.addEventListener('click', closeMoveMenu);
});

// ========== 初始化 ==========
//
// 分两步，顺序很关键：
//   第一步（立刻、同步）：先把课程列表渲染出来。列表要么显示课程，要么显示"还没有课程"，
//                        绝不会是空白 —— 它不等任何人、不等任何网络请求。
//   第二步（异步）：如果上次是在某门课的详情页关掉的、并且那门课现在还在，再跳回去。
//
// 之前是反过来的（先 await 校验，再 loadCourses），结果只要那个请求慢一点、
// 挂住、或者中间出岔子，列表就永远不渲染 —— 页面看起来就是一片空白。这个顺序不能倒。

// 清掉"上次浏览位置"的记忆
function forgetLastPage() {
  localStorage.removeItem('currentPage');
  localStorage.removeItem('currentCourseId');
  localStorage.removeItem('currentCourseName');
  localStorage.removeItem('currentTab');
  localStorage.removeItem('courseTimeStamp');
}

// —— 第一步：先把列表画出来（不 await、不依赖任何东西）——
loadCourses();

// —— 第二步：再决定要不要回到上次那门课 ——
(async function restoreLastPage() {
  const savedPage = localStorage.getItem('currentPage');
  const savedCourseId = localStorage.getItem('currentCourseId');
  const savedCourseName = localStorage.getItem('currentCourseName');
  const savedTab = localStorage.getItem('currentTab');
  const savedTime = localStorage.getItem('courseTimeStamp');

  // 没记录或过期了：就停在列表页
  if (!savedTime || (Date.now() - Number(savedTime)) > EXPIRE_TIME) {
    forgetLastPage();
    return;
  }
  if (savedPage !== 'detail' || !savedCourseId || !savedCourseName) return;

  try {
    const res = await fetch(`${API}/courses`);
    const list = await res.json();
    const stillThere = Array.isArray(list)
      && list.some(c => String(c.id) === String(savedCourseId));

    if (stillThere) {
      openCourse(Number(savedCourseId), savedCourseName, savedTab || 'materials');
    } else {
      console.warn('上次打开的那门课已经不存在了，留在课程列表');
      forgetLastPage();
    }
  } catch (err) {
    // 后端没起来之类：留在列表页就好，别做任何"危险"操作
    console.warn('恢复上次位置失败，留在课程列表：', err);
  }
})();
