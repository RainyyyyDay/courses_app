/*
 * treeView.js
 * 知识树渲染：课程标题、整棵树、单个节点
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

function courseTitleHtml() {
  const hasTree = Array.isArray(currentTree) && currentTree.length > 0;
  const modeBtn = hasTree
    ? `<button class="sort-mode-btn${sortMode ? ' active' : ''}" onclick="toggleSortMode()">${sortMode ? '完成排序' : '更改排序'}</button>`
    : '';

  return `<div class="tree-node">
      <div class="tree-node-row tree-title-row">
        <span class="tree-root-name">${escapeHtml(currentCourseName || '课程')}</span>
        ${modeBtn}
      </div>
    </div>`;
}

// 渲染整棵树
function renderTree() {
  const container = document.getElementById('treeContainer');
  container.classList.toggle('sort-mode', sortMode); // 排序模式的整体视觉提示

  if (!Array.isArray(currentTree) || currentTree.length === 0) {
    container.innerHTML =
      courseTitleHtml() + '<div class="empty">还没有内容，点右上角 ＋ 添加内容</div>';
    return;
  }

  const sortHintHtml = sortMode
    ? '<div class="sort-hint">排序模式：按住节点拖动可调整顺序 / 层级，或点 ⇅ 用菜单移动</div>'
    : '';

  // 排序模式下，课程标题行下面给一个明显的根层级落区，
  // 保证节点拖进 folder 之后还能拖回课程顶层。
  const rootZoneHtml = sortMode
    ? '<div class="root-drop-zone" id="rootDropZone">拖到这里移到第一级</div>'
    : '';

  container.innerHTML =
    courseTitleHtml() + sortHintHtml + currentTree.map(node => renderNode(node)).join('') + rootZoneHtml;
}

// 递归渲染节点
function renderNode(node) {
  const isFolder = node.type === 'folder';
  const isSystem = !!node.is_system; // 系统分类“未分类”：灰色、不能改名 / 删除
  const nameClass = isSystem
    ? 'tree-name-uncategorized'
    : (isFolder ? 'tree-name-folder' : 'tree-name-knowledge');
  const children = Array.isArray(node.children) ? node.children : [];
  const hasChildren = children.length > 0;
  const isExpanded = isFolder && expandedIds.has(node.id);
  // “未分类”只是收纳桶，不接受任何子节点：不展开、不能加内容
  const canContain = isFolder && !isSystem;

  // 只有“有子节点的普通分类”才显示展开 / 折叠箭头，其它情况占位对齐
  let toggleHtml = '<span class="tree-toggle tree-toggle-empty"></span>';
  if (canContain && hasChildren) {
    toggleHtml = `<button class="tree-toggle" onclick="event.stopPropagation();toggleExpand(${node.id})"
        title="${isExpanded ? '折叠' : '展开'}">${isExpanded ? '▾' : '▸'}</button>`;
  }

  // ---- 排序模式：只留拖拽手柄 + 展开箭头 + 名称 + 移动菜单，
  //      去掉改名输入框 / 添加内容 / 删除，避免拖拽时误操作 ----
  if (sortMode) {
    const v = tagVisual(node.type);
    // 系统分类不参与排序：没有手柄、不能拖、也没有 ⇅，但仍然是合法的放置目标
    const handleHtml = isSystem
      ? '<span class="tree-handle tree-handle-empty"></span>'
      : '<span class="tree-handle" title="按住拖动排序">☰</span>';
    const sortNameHtml = `<span class="tree-name ${nameClass}">
        <span class="tree-type-icon">${v.icon}</span>${escapeHtml(node.name)}</span>`;
    const moveBtnHtml = isSystem
      ? ''
      : `<button class="tree-move-btn" onclick="event.stopPropagation();openMoveMenu(${node.id}, event)" title="移动">⇅</button>`;
    const dragAttr = isSystem ? '' : ` onpointerdown="onNodePointerDown(event, ${node.id})"`;
    const sortChildrenHtml = canContain && isExpanded && hasChildren
      ? `<div class="tree-children">${children.map(child => renderNode(child)).join('')}</div>`
      : '';

    return `
      <div class="tree-node">
        <div class="tree-node-row${isFolder ? '' : ' tree-node-row-knowledge'}"
             data-id="${node.id}"${dragAttr}>
          ${handleHtml}
          ${toggleHtml}
          ${sortNameHtml}
          ${moveBtnHtml}
        </div>
        ${sortChildrenHtml}
      </div>`;
  }

  // 名称：默认是可点击的“查看详情”入口；只有正在改名的那一个节点才变成输入框
  const v = tagVisual(node.type);
  const nameHtml = renamingNodeId === node.id
    ? `<input type="text" class="tree-input ${isFolder ? 'tree-input-folder' : 'tree-input-knowledge'}"
        value="${escapeHtml(node.name)}"
        onblur="commitRename(${node.id}, this)"
        onkeydown="onRenameKey(event, ${node.id}, this)" />`
    : `<span class="tree-name-link ${nameClass}"
        onclick="event.stopPropagation();openNodeDetail(${node.id})" title="查看节点详情">
        <span class="tree-type-icon">${v.icon}</span>${escapeHtml(node.name)}</span>`;

  // 改名按钮：点名称是看详情，改名走这个独立的 ✎。
  // 系统分类不给改名入口，避免“未分类”被改得认不出来。
  const editBtnHtml = isSystem
    ? ''
    : `<button class="tree-edit" onclick="event.stopPropagation();startRename(${node.id})" title="重命名">✎</button>`;

  // 只有普通分类能添加子节点；知识点是叶节点，“未分类”是只读收纳桶，都不给入口
  const addBtnHtml = canContain
    ? `<button class="tree-add" onclick="event.stopPropagation();openAddMenu(${node.id}, event)" title="添加内容">＋</button>`
    : '';

  // 系统分类也不能删（删了下次打开还会自动建出来，索性不给入口）
  const delBtnHtml = isSystem
    ? ''
    : `<button class="tree-del" onclick="event.stopPropagation();removeNode(${node.id})" title="删除">×</button>`;

  const childrenHtml = canContain && isExpanded && hasChildren
    ? `<div class="tree-children">${children.map(child => renderNode(child)).join('')}</div>`
    : '';

  return `
    <div class="tree-node">
      <div class="tree-node-row${isFolder ? '' : ' tree-node-row-knowledge'}">
        ${toggleHtml}
        ${nameHtml}
        ${editBtnHtml}
        ${addBtnHtml}
        ${delBtnHtml}
      </div>
      ${childrenHtml}
    </div>
  `;
}
