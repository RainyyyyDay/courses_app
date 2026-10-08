/*
 * dropPreview.js
 * 三种落点的视觉预览（同级让位 / 往上挪 / 挪进下一级）
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */


function rowElOf(id) {
  return document.querySelector('#treeContainer .tree-node-row[data-id="' + id + '"]');
}

function siblingListOf(id) {
  const node = findNodeById(id);
  if (!node) return [];
  return childNodesOf(node.parent_id === undefined ? null : node.parent_id);
}

function prevSiblingIdOf(id) {
  const list = siblingListOf(id);
  const i = list.findIndex(n => n.id === id);
  return i > 0 ? list[i - 1].id : null;
}

function nextSiblingIdOf(id) {
  const list = siblingListOf(id);
  const i = list.findIndex(n => n.id === id);
  return (i >= 0 && i < list.length - 1) ? list[i + 1].id : null;
}

// 节点在第几层（顶层 = 0），用来区分“同级”和“往上挪到更上面一层”
function levelOf(id) {
  let pid = parentIdOfNode(id);
  let depth = 0;
  let guard = 0;
  while (pid !== null && pid !== undefined && guard < 1000) {
    guard += 1;
    depth += 1;
    pid = parentIdOfNode(pid);
  }
  return depth;
}

function moveKindFor(targetId, mode) {
  if (mode === 'into') return 'into';
  return levelOf(targetId) < levelOf(dragNodeId) ? 'up' : 'same';
}

function shiftRow(id, dy) {
  const row = rowElOf(id);
  if (!row) return;
  row.style.transform = `translateY(${dy}px)`;
  previewTouchedRows.push(row);
}

function resetPreviewTransforms() {
  previewTouchedRows.forEach(row => { row.style.transform = ''; });
  previewTouchedRows = [];
  intoCenterY = null;
}

function clearDropPreview() {
  resetPreviewTransforms();
  if (dragGhostInner) {
    dragGhostInner.style.transform = '';
    dragGhostInner.style.opacity = '';
  }
  document
    .querySelectorAll('#treeContainer .drop-before, #treeContainer .drop-after, #treeContainer .drop-into, #treeContainer .drop-invalid, #treeContainer .drop-level-up')
    .forEach(el => el.classList.remove('drop-before', 'drop-after', 'drop-into', 'drop-invalid', 'drop-level-up'));
  const zone = document.getElementById('rootDropZone');
  if (zone) zone.classList.remove('drop-into');
  dropPreview = null;
}

function applyDropPreview(targetId, mode) {
  // 落点没变就别重复动 DOM，否则过渡会被一直打断
  if (dropPreview && dropPreview.targetId === targetId && dropPreview.mode === mode) return;
  clearDropPreview();
  dropPreview = { targetId: targetId, mode: mode };

  if (mode === 'root') {
    const zone = document.getElementById('rootDropZone');
    if (zone) zone.classList.add('drop-into');
    return;
  }

  const row = rowElOf(targetId);
  if (!row) return;

  if (mode === 'invalid') {
    row.classList.add('drop-invalid');
    return;
  }

  if (mode === 'into') {
    row.classList.add('drop-into');
    const rect = row.getBoundingClientRect();
    intoCenterY = rect.top + rect.height / 2;
    return; // 卡片的吸附交给 moveGhost
  }

  const kind = moveKindFor(targetId, mode);

  if (kind === 'up') {
    // 效果二：只有落点下方的那一个向下沉
    row.classList.add('drop-level-up');
    const belowId = mode === 'before' ? targetId : nextSiblingIdOf(targetId);
    if (belowId !== null) shiftRow(belowId, 8);
    return;
  }

  // 效果一：上一半往上、下一半往下，两侧同时让位
  row.classList.add('drop-' + mode);
  const aboveId = mode === 'before' ? prevSiblingIdOf(targetId) : targetId;
  const belowId = mode === 'before' ? targetId : nextSiblingIdOf(targetId);
  if (aboveId !== null) shiftRow(aboveId, -6);
  if (belowId !== null) shiftRow(belowId, 6);
}
