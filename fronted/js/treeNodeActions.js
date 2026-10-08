/*
 * treeNodeActions.js
 * 知识节点的增删改：添加内容菜单、新建、删除、重命名
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ---------- 添加内容菜单 ---------- */


// 打开“添加内容”菜单：课程顶部 ＋ 和 folder 的 ＋ 用的是同一个菜单
function openAddMenu(parentId, ev) {
  if (ev) {
    ev.stopPropagation();
    const menu = document.getElementById('addMenu');
    menu.style.left = Math.min(ev.clientX, window.innerWidth - 160) + 'px';
    menu.style.top = Math.min(ev.clientY, window.innerHeight - 100) + 'px';
  }
  addMenuParentId = parentId;
  document.getElementById('addMenu').classList.add('show');
}

function closeAddMenu() {
  addMenuParentId = null;
  const menu = document.getElementById('addMenu');
  if (menu) menu.classList.remove('show');
}

function chooseAddType(type) {
  const parentId = addMenuParentId;
  closeAddMenu();
  createNode(parentId, type);
}

// 新建节点：先 POST，成功后再重新拉一次树（节点 id 由后端分配，前端不伪造）
async function createNode(parentId, type) {
  const label = type === 'folder' ? '分类' : '知识点';
  const input = prompt('请输入' + label + '名称：');
  if (input === null) return; // 用户点了取消

  const name = input.trim();
  if (!name) {
    showToast('名称不能为空');
    return;
  }

  try {
    const res = await fetch(`${API}/courses/${currentCourseId}/knowledge-nodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId: parentId, name: name, type: type })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '新建失败');
    }

    // 让新建的节点能被看见：把它的父节点展开
    if (parentId !== null) expandedIds.add(parentId);

    showToast(type === 'folder' ? '已新建分类' : '已新建知识点');
    await loadTree();
  } catch (err) {
    console.error('新建节点失败:', err);
    showToast(err.message || '新建失败，请重试');
  }
}

/* ---------- 删除节点 ---------- */

async function removeNode(id) {
  const node = findNodeById(id);
  if (!node) return;

  const isFolder = node.type === 'folder';
  const msg = isFolder
    ? '删除该分类会同时删除其下所有子分类和知识点，但不会删除关联的错题。确定继续吗？'
    : '确定删除知识点「' + node.name + '」吗？错题本身不会被删除。';

  const ok = await showConfirm(msg, isFolder ? '删除分类' : '删除知识点');
  if (!ok) return;

  try {
    const res = await fetch(`${API}/knowledge-nodes/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '删除失败');
    }
    showToast('已删除');
    await loadTree(); // 整棵子树由后端一起删掉，前端不自己递归删
  } catch (err) {
    console.error('删除节点失败:', err);
    showToast(err.message || '删除失败，请重试');
  }
}

/* ---------- 重命名节点（点 ✎ 才进入编辑态） ---------- */

function startRename(id) {
  renamingNodeId = id;
  renderTree();

  const input = document.querySelector('#treeContainer .tree-input');
  if (input) {
    input.focus();
    input.select();
  }
}

// 取消改名：直接重渲染，恢复成可点击的名称
function cancelRename() {
  renamingNodeId = null;
  renderTree();
}

// 只在失焦或回车时提交；名字为空 / 没变化都不发请求
async function commitRename(id, input) {
  if (renamingNodeId !== id) return; // 已经被 Esc 取消过了

  const node = findNodeById(id);
  if (!node) return;

  const newName = input.value.trim();
  const originalName = node.name;

  if (!newName) {
    showToast('名称不能为空');
    cancelRename(); // 恢复原名称
    return;
  }
  if (newName === originalName) {
    cancelRename(); // 没变化，不发请求
    return;
  }

  try {
    const res = await fetch(`${API}/knowledge-nodes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '重命名失败');
    }

    const updated = await res.json();
    node.name = updated.name; // 同步本地缓存，避免下次比较出错
    renamingNodeId = null;
    showToast('已重命名');
    await loadTree();
  } catch (err) {
    console.warn('重命名失败:', err.message);
    renamingNodeId = null;
    renderTree(); // 请求失败恢复原名称
    showToast(err.message || '重命名失败，请重试');
  }
}

function onRenameKey(ev, id, input) {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    input.blur(); // 失焦会触发 commitRename
  } else if (ev.key === 'Escape') {
    ev.preventDefault();
    cancelRename(); // 取消，不提交
  }
}
