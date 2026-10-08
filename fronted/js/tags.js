/*
 * tags.js
 * 标签显示（chips）与通用删除
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

// 统一取一条资源的标签数组：
// 错题历史上用的是 knowledge 字段，资料 / 笔记用的是 nodes 字段，这里抹平差异
function rowNodes(row) {
  if (Array.isArray(row.nodes)) return row.nodes;
  if (Array.isArray(row.knowledge)) return row.knowledge;
  return [];
}

// 渲染一条资源的标签 chips（两类样式不同、都带跳转）
function nodeChipsHtml(row) {
  const nodes = rowNodes(row);
  return nodes.length
    ? nodes.map(k => tagChipHtml({ id: k.id, name: k.name, type: k.type }, false, true)).join('')
    : '<span class="tag-none">暂无标签</span>';
}

// 标签节点按 type 区分的视觉元数据（图标 + 样式 class）
// 未知 type 走 fallback，不会让列表或选择器报错
function tagVisual(type) {
  if (type === 'folder') return { cls: 'tag-folder', icon: '▣' };
  if (type === 'knowledge') return { cls: 'tag-knowledge', icon: '●' };
  return { cls: 'tag-unknown', icon: '？' };
}

// 生成一个标签 chip
//   withRemove = true → 带“×”取消按钮（标签选择器里用）
//   clickable  = true → 点击进入该节点详情（Phase 4D）
function tagChipHtml(tag, withRemove, clickable) {
  const v = tagVisual(tag.type);
  const removeBtn = withRemove
    ? `<button class="tag-chip-x" onclick="removeTagSelection(${tag.id})" title="取消选择">×</button>`
    : '';
  const clickAttr = clickable
    ? ` onclick="event.stopPropagation();openNodeDetail(${tag.id})" title="查看该节点详情"`
    : '';
  const cls = 'tag-chip ' + v.cls + (clickable ? ' tag-chip-link' : '');
  return `<span class="${cls}"${clickAttr}><span class="tag-chip-icon">${v.icon}</span>` +
    `${escapeHtml(tag.name)}${removeBtn}</span>`;
}

/* ========== 通用删除 ========== */
async function delItem(type, id, reloadFn) {
  const ok = await showConfirm('确定删除？删除后无法恢复。');
  if (!ok) return;
  try {
    await requestApi(`${API}/${type}/${id}`, { method: 'DELETE' });
    showToast('已删除');
    await reloadFn();
  } catch (err) {
    showToast(err.message || '删除失败，请重试');
  }
}
