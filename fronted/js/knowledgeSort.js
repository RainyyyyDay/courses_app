/*
 * knowledgeSort.js
 * 排序模式与拖拽：指针拖拽、落点判定、松手提交 / 取消
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ---------- 排序模式（更改排序 / 完成排序） ---------- */
// 只有点了“更改排序”才允许拖拽；平时节点是拖不动的。
// 这些都是纯前端状态，不入库、不写 localStorage。


function toggleSortMode() {
  sortMode = !sortMode;
  clearDragState();
  renderTree();
  showToast(sortMode ? '已进入排序模式' : '已退出排序模式');
}

// 切课程时退出排序模式
function exitSortMode() {
  sortMode = false;
  clearDragState();
}

function clearDragState() {
  endDrag(); // 拆浮层、还原让位位移、摘掉事件监听
  closeMoveMenu();
  closeMoveTargetPicker();
}

/* ----- 拖拽（Pointer Events 自己实现，为的是能做动效）----- */
//
// 为什么不用原生 HTML5 Drag & Drop：拖动时跟着鼠标的那个“残影”是浏览器渲染的，
// 只能用 setDragImage 塞一张静态图，没法缩放、没法加毛玻璃、更没法做“被目标含住”
// 的形变。所以这里改成 pointer 事件：浮层由我们自己创建，全程可控。
//
// 落点判定（computeDropModeAt）和提交后端（dropTargetToPlacement / performMove）都没变，
// 换掉的只是“怎么跟指针”和“怎么画反馈”这两层。



/* --- 起手 --- */

function onNodePointerDown(ev, id) {
  if (!sortMode || ev.button !== 0) return;
  // 点展开箭头 / ⇅ 按钮时不启动拖拽
  if (ev.target.closest('.tree-toggle, .tree-move-btn')) return;

  dragNodeId = id;
  dragPointerId = ev.pointerId;
  dragStartX = ev.clientX;
  dragStartY = ev.clientY;
  dragStarted = false;

  dragSourceRow = ev.currentTarget;
  const rect = dragSourceRow.getBoundingClientRect();
  dragOffsetX = ev.clientX - rect.left;
  dragOffsetY = ev.clientY - rect.top;

  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);
  document.addEventListener('keydown', onDragKeyDown);
}

/* --- 拖动中 --- */

function onPointerMove(ev) {
  if (ev.pointerId !== dragPointerId) return;

  if (!dragStarted) {
    if (Math.hypot(ev.clientX - dragStartX, ev.clientY - dragStartY) < DRAG_THRESHOLD) return;
    startDragVisual();
  }

  ev.preventDefault();
  // 先算落点、再挪浮层：这样刚进入“含住”区域的那一帧，卡片就已经开始被吸进去了
  updateDropPreview(ev.clientX, ev.clientY);
  moveGhost(ev.clientX, ev.clientY);
}

// 造出跟手浮层：把被拖的节点做成一张“浮起来的卡片”
function startDragVisual() {
  const node = findNodeById(dragNodeId);
  if (!node) return;

  dragStarted = true;
  if (dragSourceRow) dragSourceRow.classList.add('drag-source');

  const v = tagVisual(node.type);
  dragGhost = document.createElement('div');
  dragGhost.className = 'drag-ghost';
  dragGhostInner = document.createElement('div');
  dragGhostInner.className = 'drag-ghost-inner';
  dragGhostInner.innerHTML =
    `<span class="tree-name ${node.type === 'folder' ? 'tree-name-folder' : 'tree-name-knowledge'}">` +
    `<span class="tree-type-icon">${v.icon}</span>${escapeHtml(node.name)}</span>`;
  dragGhost.appendChild(dragGhostInner);
  document.body.appendChild(dragGhost);

  // 下一帧再加 lifted，“离地”的放大 / 微倾才有过渡
  requestAnimationFrame(() => {
    if (dragGhost) dragGhost.classList.add('lifted');
  });
}

function moveGhost(x, y) {
  if (!dragGhost) return;

  const left = x - dragOffsetX;
  const top = y - dragOffsetY;
  dragGhost.style.transform = `translate3d(${left}px, ${top}px, 0)`;

  if (!dragGhostInner) return;

  if (dropPreview && dropPreview.mode === 'into' && intoCenterY !== null) {
    // 效果三：被目标“含住”——卡片缩小、变淡，并朝目标中心靠过去
    const ghostCenterY = top + dragGhost.offsetHeight / 2;
    const dy = (intoCenterY - ghostCenterY) * 0.45;
    const targetRow = rowElOf(dropPreview.targetId);
    const dx = targetRow ? (targetRow.getBoundingClientRect().left + 24 - left) * 0.45 : 12;
    dragGhostInner.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(0.7)`;
    dragGhostInner.style.opacity = '0.55';
  } else {
    dragGhostInner.style.transform = '';
    dragGhostInner.style.opacity = '';
  }
}

// 指针挪到哪儿，就在哪儿算落点、画预览
function updateDropPreview(x, y) {
  // 浮层设了 pointer-events:none，所以这里取到的是它底下的真实元素
  const el = document.elementFromPoint(x, y);

  if (el && el.closest('#rootDropZone')) {
    applyDropPreview(null, 'root');
    return;
  }

  const row = el && el.closest('#treeContainer .tree-node-row[data-id]');
  if (!row) {
    clearDropPreview();
    return;
  }

  const targetId = Number(row.dataset.id);
  if (targetId === dragNodeId) { clearDropPreview(); return; } // 悬在自己身上：不提示

  const mode = computeDropModeAt(y, row, targetId);
  applyDropPreview(targetId, mode || 'invalid');
}

// 按指针在目标行里的相对高度判断落点：
//   上 25% = before，下 25% = after，中间 = into（只有 folder 能 into）
// 返回 null 表示这是非法落点
function computeDropModeAt(clientY, row, targetId) {
  if (targetId === dragNodeId) return null;            // 拖到自己身上
  if (isDescendant(dragNodeId, targetId)) return null; // 拖到自己的后代

  const target = findNodeById(targetId);
  if (!row || !target) return null;

  const rect = row.getBoundingClientRect();
  const ratio = rect.height ? (clientY - rect.top) / rect.height : 0.5;

  // 系统分类“未分类”钉在顶层最前面，不是可操作对象：
  // 既不能放进它里面，也不能插到它前面 / 后面（它上面永远没有东西）
  if (target.is_system) return null;

  // 知识点不能当容器（不能“吃别的”）：拖到它身上只在它前面 / 后面插入。
  // 反过来，知识点本身可以被分类吃掉（变成分类的子节点），那是正常操作。
  if (target.type === 'folder') {
    if (ratio < 0.25) return 'before';
    if (ratio > 0.75) return 'after';
    return 'into';
  }
  return ratio < 0.5 ? 'before' : 'after';
}

// 把落点换算成 move API 需要的 { parentId, position }
// position 的口径：把被拖节点摘掉之后，在目标层里的 0 基下标
function dropTargetToPlacement(dragId, targetId, mode) {
  const target = findNodeById(targetId);
  if (!target) return null;

  if (mode === 'into') {
    if (target.type !== 'folder') return null;
    if (target.is_system) return null; // “未分类”不能当容器
    return { parentId: targetId, position: null }; // 放到该 folder 的末尾
  }

  const list = siblingIdsWithout(target.parent_id, dragId);
  const idx = list.indexOf(targetId);
  if (idx < 0) return null;
  return { parentId: target.parent_id, position: mode === 'before' ? idx : idx + 1 };
}

/* ----- 落点预览：三种效果 ----- */
//
//   效果一 same → 同级换上下：插入线 + 上下两个同级各让开一点，把空位“撑”出来
//   效果二 up   → 往上挪到上级：只让落点下方的那一个标签向下沉
//   效果三 into → 挪进下一级：目标胀大 + 清透玻璃质感，拖拽卡片被吸进去“含住”
//
// 这里的位移一律用 transform（合成层，不走重排），过渡曲线在 CSS 里统一给。

/* ----- 松手 / 取消 ----- */

function onPointerUp(ev) {
  if (ev.pointerId !== dragPointerId) return;

  const moved = dragNodeId;
  const preview = dropPreview;
  const started = dragStarted;
  endDrag();

  if (!started || moved === null) return;  // 只是点了一下，什么都没发生
  if (!preview) { renderTree(); return; }
  if (preview.mode === 'invalid') { renderTree(); return; }

  if (preview.mode === 'root') {
    performMove(moved, null, null); // 移到课程顶层末尾
    return;
  }

  const placement = dropTargetToPlacement(moved, preview.targetId, preview.mode);
  if (!placement) { renderTree(); return; }

  performMove(moved, placement.parentId, placement.position);
}

function onPointerCancel(ev) {
  if (ev.pointerId !== dragPointerId) return;
  cancelDrag();
}

// 拖到一半按 Esc：当作没拖过
function onDragKeyDown(ev) {
  if (ev.key === 'Escape' && dragStarted) {
    ev.preventDefault();
    cancelDrag();
  }
}

function cancelDrag() {
  const started = dragStarted;
  endDrag();
  if (started) renderTree(); // 把 drag-source 之类的临时状态清干净
}

// 收尾：拆浮层、还原让位位移、摘掉监听。没在拖的时候调用也是安全的。
function endDrag() {
  document.removeEventListener('pointermove', onPointerMove);
  document.removeEventListener('pointerup', onPointerUp);
  document.removeEventListener('pointercancel', onPointerCancel);
  document.removeEventListener('keydown', onDragKeyDown);

  if (dragSourceRow) dragSourceRow.classList.remove('drag-source');
  if (dragGhost && dragGhost.parentNode) dragGhost.parentNode.removeChild(dragGhost);
  clearDropPreview();

  dragNodeId = null;
  dragPointerId = null;
  dragStarted = false;
  dragSourceRow = null;
  dragGhost = null;
  dragGhostInner = null;
}
