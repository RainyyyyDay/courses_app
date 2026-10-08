/*
 * treeMenus.js
 * 知识框架的两个小菜单：⇅ 上移 / 下移 / 移动到…
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ----- 触屏 / 键盘替代：上移 / 下移 / 移动到… ----- */

function openMoveMenu(id, ev) {
  if (ev) {
    ev.stopPropagation();
    const menu = document.getElementById('moveMenu');
    menu.style.left = Math.min(ev.clientX, window.innerWidth - 160) + 'px';
    menu.style.top = Math.min(ev.clientY, window.innerHeight - 110) + 'px';
  }
  moveMenuNodeId = id;
  document.getElementById('moveMenu').classList.add('show');
}

function closeMoveMenu() {
  moveMenuNodeId = null;
  const menu = document.getElementById('moveMenu');
  if (menu) menu.classList.remove('show');
}

function moveNodeUp() {
  const id = moveMenuNodeId;
  closeMoveMenu();
  if (id === null || id === undefined) return;

  const parentId = parentIdOfNode(id);
  const siblings = childNodesOf(parentId);
  const idx = siblings.findIndex(n => n.id === id);
  if (idx <= 0) { showToast('已经在最前面了'); return; }

  performMove(id, parentId, idx - 1);
}

function moveNodeDown() {
  const id = moveMenuNodeId;
  closeMoveMenu();
  if (id === null || id === undefined) return;

  const parentId = parentIdOfNode(id);
  const siblings = childNodesOf(parentId);
  const idx = siblings.findIndex(n => n.id === id);
  if (idx < 0 || idx >= siblings.length - 1) { showToast('已经在最后面了'); return; }

  performMove(id, parentId, idx + 1);
}

/* ----- “移动到…”目标选择（只列 folder，排除自己和自己的后代）----- */

function openMoveTargetPicker() {
  const id = moveMenuNodeId;
  closeMoveMenu();
  if (id === null || id === undefined) return;

  const node = findNodeById(id);
  if (!node) return;
  moveTargetNodeId = id;

  const rows = [];
  // 课程顶层
  rows.push(moveTargetRowHtml(null, '课程顶层', 0, node.parent_id === null));

  (function walk(nodes, depth) {
    for (const n of nodes || []) {
      if (n.type !== 'folder') continue;      // knowledge 不能当父节点
      if (n.is_system) continue;              // “未分类”也不能当父节点
      if (n.id === id) continue;              // 不能选自己
      if (isDescendant(id, n.id)) continue;   // 不能选自己的后代（整棵子树都跳过）
      rows.push(moveTargetRowHtml(n.id, n.name, depth, node.parent_id === n.id));
      walk(n.children, depth + 1);
    }
  })(currentTree, 0);

  document.getElementById('moveTargetList').innerHTML = rows.join('');
  document.getElementById('moveTargetModal').classList.add('show');
}

function moveTargetRowHtml(parentId, name, depth, isCurrent) {
  const click = parentId === null ? 'chooseMoveTarget(null)' : 'chooseMoveTarget(' + parentId + ')';
  return `<div class="move-target${isCurrent ? ' current' : ''}" onclick="${click}">
      <span class="move-target-name" style="padding-left:${depth * 14}px">▣ ${escapeHtml(name)}</span>
      ${isCurrent ? '<span class="move-target-cur">当前所在</span>' : ''}
    </div>`;
}

function closeMoveTargetPicker() {
  moveTargetNodeId = null;
  const modal = document.getElementById('moveTargetModal');
  if (modal) modal.classList.remove('show');
}

function chooseMoveTarget(parentId) {
  const id = moveTargetNodeId;
  closeMoveTargetPicker();
  if (id === null || id === undefined) return;
  performMove(id, parentId, null); // 放到目标层的末尾
}
