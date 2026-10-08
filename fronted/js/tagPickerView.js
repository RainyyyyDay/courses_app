/*
 * tagPickerView.js
 * 标签选择器的界面渲染：树、勾选框、已选 chips、展开收起
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

function renderTagPicker() {
  const state = tagPickerState;
  if (!state) return;

  const treeBox = document.getElementById('tagPickerTree');

  if (!state.tree.length) {
    treeBox.innerHTML =
      '<div class="empty">当前课程还没有分类或知识点，请先在「知识框架」中创建。</div>';
  } else {
    treeBox.innerHTML = state.tree.map(node => renderTagNode(node)).join('');
  }

  renderTagSelected();
}

// 递归渲染选择器：folder 和 knowledge 都可以勾选；
// folder 有独立的展开箭头，knowledge 是叶节点（留占位符对齐）
function renderTagNode(node) {
  const state = tagPickerState;
  const isFolder = node.type === 'folder';
  const children = Array.isArray(node.children) ? node.children : [];
  const hasChildren = children.length > 0;
  const isExpanded = isFolder && state.expanded.has(node.id);
  const checked = state.selected.has(node.id) ? 'checked' : '';
  // 系统分类“未分类”在选择器里也显示成灰色
  const base = tagVisual(node.type);
  const v = node.is_system ? { cls: 'tag-uncategorized', icon: base.icon } : base;

  // 展开箭头：点它只展开 / 收起，绝不改变勾选状态
  const toggleHtml = (isFolder && hasChildren)
    ? `<button type="button" class="tag-toggle" onclick="toggleTagExpand(${node.id})"
         title="${isExpanded ? '收起' : '展开'}">${isExpanded ? '▾' : '▸'}</button>`
    : '<span class="tag-toggle tag-toggle-empty"></span>';

  const childrenHtml = (isFolder && isExpanded && hasChildren)
    ? `<div class="tag-children">${children.map(child => renderTagNode(child)).join('')}</div>`
    : '';

  return `
    <div class="tag-node">
      <div class="tag-row">
        ${toggleHtml}
        <input type="checkbox" id="tagchk-${node.id}" class="tag-check" ${checked}
          onchange="onTagCheckChange(${node.id}, this.checked)" />
        <span class="tag-label ${v.cls}" onclick="toggleTagSelect(${node.id})">
          <span class="tag-icon">${v.icon}</span>${escapeHtml(node.name)}
        </span>
      </div>
      ${childrenHtml}
    </div>`;
}

// 展开 / 收起：只动展开状态，selected 完全不碰
function toggleTagExpand(id) {
  const state = tagPickerState;
  if (!state) return;
  if (state.expanded.has(id)) state.expanded.delete(id);
  else state.expanded.add(id);
  renderTagPicker();
}

// 勾选 / 取消勾选：只动 selected，展开状态完全不碰
function onTagCheckChange(id, checked) {
  const state = tagPickerState;
  if (!state) return;
  if (checked) state.selected.add(id);
  else state.selected.delete(id);
  renderTagSelected();
}

// 点名称文字 = 切换选中（单一行为，不会连带展开）
function toggleTagSelect(id) {
  const state = tagPickerState;
  if (!state) return;

  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);

  const box = document.getElementById('tagchk-' + id);
  if (box) box.checked = state.selected.has(id);

  renderTagSelected();
}

// 已选标签汇总区（folder / knowledge 用不同样式）
function renderTagSelected() {
  const box = document.getElementById('tagPickerSelected');
  const state = tagPickerState;

  if (!state || state.selected.size === 0) {
    box.innerHTML = '<span class="tag-none">未选择标签</span>';
    return;
  }

  box.innerHTML = [...state.selected].map(id => {
    const meta = state.nodeMeta.get(id) || { name: '#' + id, type: 'unknown' };
    return tagChipHtml({ id: id, name: meta.name, type: meta.type }, true);
  }).join('');
}

// 点 chip 上的“×”：只取消这一个标签，不影响父子节点，也不改变展开状态。
// 节点正好在收起的分支里也没问题（找不到 checkbox 元素就跳过同步）。
function removeTagSelection(id) {
  const state = tagPickerState;
  if (!state) return;
  state.selected.delete(id);

  const box = document.getElementById('tagchk-' + id);
  if (box) box.checked = false;

  renderTagSelected();
}
