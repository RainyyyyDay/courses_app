/*
 * knowledgeTree.js
 * 知识框架：加载与展开、兄弟关系工具、performMove
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ========== 知识框架 ========== */

// 知识树的唯一正式数据源是后端 SQLite（GET /api/courses/:id/knowledge-tree）。
// 这里不再读写 localStorage['tree_*']，节点 id 也一律用后端返回的 id。

// 加载知识树
async function loadTree() {
  // 切换课程时重置展开状态
  if (treeStateCourseId !== currentCourseId) {
    expandedIds = new Set();
    knownNodeIds = new Set();
    treeStateCourseId = currentCourseId;
  }

  const container = document.getElementById('treeContainer');
  container.innerHTML = '<div class="loading-tip">加载中…</div>';

  try {
    const res = await fetch(`${API}/courses/${currentCourseId}/knowledge-tree`);
    if (!res.ok) throw new Error('服务器返回了错误状态');

    const tree = await res.json();
    currentTree = Array.isArray(tree) ? tree : [];
    syncExpandedState(currentTree);
    renderTree();
  } catch (err) {
    console.error('加载知识框架失败:', err);
    currentTree = [];
    container.innerHTML =
      courseTitleHtml() + '<div class="empty">加载失败，请检查后端是否运行。</div>';
    showToast('加载知识框架失败');
  }
}

// 同步展开状态（重新加载后尽量保留仍然存在的节点的展开/折叠状态）：
//   - 之前在 expandedIds 里的 → 保持展开
//   - 第一次见到的 folder（新加的）→ 默认展开
//   - 见过但被用户折叠过的 → 保持折叠
//   - 已经不存在的节点 → 从集合里清掉
function syncExpandedState(nodes) {
  const ids = new Set();
  const folders = new Set();

  (function walk(list) {
    for (const node of list) {
      ids.add(node.id);
      if (node.type === 'folder') folders.add(node.id);
      walk(node.children || []);
    }
  })(nodes);

  const next = new Set();
  for (const id of folders) {
    if (expandedIds.has(id) || !knownNodeIds.has(id)) next.add(id);
  }
  expandedIds = next;
  knownNodeIds = ids;
}

// 按 id 在当前树里找节点（返回后端数据的引用）
function findNodeById(id, list = currentTree) {
  for (const node of list || []) {
    if (node.id === id) return node;
    const found = findNodeById(id, node.children);
    if (found) return found;
  }
  return null;
}

// 展开 / 折叠（纯前端 UI 状态）
function toggleExpand(id) {
  if (expandedIds.has(id)) expandedIds.delete(id);
  else expandedIds.add(id);
  renderTree();
}

// 当前节点的父节点 id（顶层节点返回 null）
function parentIdOfNode(id) {
  const node = findNodeById(id);
  return node ? node.parent_id : null;
}

// 某个父节点下的直接子节点（顺序就是后端返回的树顺序）
//
// 顶层要把“未分类”排除掉：它永远钉在最上面，不算“可以被排序的同级”，
// 否则拖到第一个节点前面时算出来的下标会整体错一位。
function childNodesOf(parentId) {
  if (parentId === null) {
    return Array.isArray(currentTree) ? currentTree.filter(n => !n.is_system) : [];
  }
  const parent = findNodeById(parentId);
  return parent && Array.isArray(parent.children) ? parent.children : [];
}

// 同一层里把某个节点摘掉之后的兄弟 id 顺序
function siblingIdsWithout(parentId, excludeId) {
  return childNodesOf(parentId).filter(n => n.id !== excludeId).map(n => n.id);
}

// otherId 是不是 ancestorId 的后代（用来预判非法拖拽）
function isDescendant(ancestorId, nodeId) {
  let pid = parentIdOfNode(nodeId);
  let guard = 0;
  while (pid !== null && pid !== undefined && guard < 1000) {
    guard += 1;
    if (pid === ancestorId) return true;
    pid = parentIdOfNode(pid);
  }
  return false;
}

// 统一的移动调用：不管成功失败，最后都以后端为准重新拉一次树
async function performMove(id, parentId, position) {
  try {
    const res = await fetch(`${API}/knowledge-nodes/${id}/move`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId: parentId, position: position })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '移动失败');
    }

    // 移进某个 folder 后把它展开，方便看到结果
    if (parentId !== null) expandedIds.add(parentId);
    showToast('已移动');
  } catch (err) {
    console.error('移动节点失败:', err);
    showToast(err.message || '移动失败，请重试'); // 后端 message 直接给用户看
  } finally {
    await loadTree(); // 失败也重拉，恢复成后端的真实状态
  }
}
