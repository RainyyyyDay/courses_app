/*
 * page.js
 * 页面切换与导航：showPageOnly、返回上一页
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ========== 页面切换（列表 / 课程详情 / 节点详情 / 错题详情） ========== */

// 只显示其中一个页面容器，其余隐藏。沿用原有 SPA 的 display 切换方式，不引入路由。
function showPageOnly(pageId) {
  ['listPage', 'detailPage', 'nodeDetailPage', 'mistakeDetailPage', 'resourceDetailPage'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === pageId) ? 'block' : 'none';
  });
}

// 详情页的返回：回到进入这一页之前的页面
async function backFromDetail() {
  const prev = navStack.pop();

  if (!prev) {
    currentView = { type: 'list' };
    backToList();
    return;
  }

  if (prev.type === 'node') {
    currentView = { type: 'node', id: prev.id };
    await renderNodeDetailPage(prev.id);
  } else if (prev.type === 'mistake') {
    currentView = { type: 'mistake', id: prev.id };
    await renderMistakeDetailPage(prev.id);
  } else if (prev.type === 'resource') {
    currentView = { type: 'resource', resourceType: prev.resourceType, id: prev.id };
    await renderResourceDetailPage(prev.resourceType, prev.id);
  } else if (prev.type === 'course') {
    currentView = { type: 'course', tab: prev.tab };
    showPageOnly('detailPage');
    switchTab(prev.tab); // 回到课程详情，并保持原来那个 Tab
  } else {
    currentView = { type: 'list' };
    backToList();
  }
}
