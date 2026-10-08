/*
 * manualEntry.js
 * 手动输入弹窗（资料 / 笔记 / 错题共用一套）
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ========== 手动输入（资料 / 笔记 / 错题共用一套弹窗） ========== */
// 流程和上传完全一致：填内容 → 选标签 → 保存。
// 区别只是把“文件”换成了“标题 + 正文”。

// 已经填好、等用户选完标签再真正保存的内容

function openManualModal(type) {
  const cfg = MANUAL_CONFIG[type];
  if (!cfg) return;

  pendingManual = { type: type, title: '', content: '' };

  document.getElementById('manualModalTitle').textContent = cfg.heading;

  const titleInput = document.getElementById('manualTitle');
  titleInput.value = '';
  titleInput.placeholder = cfg.titlePlaceholder;

  const contentInput = document.getElementById('manualContent');
  contentInput.value = '';
  contentInput.placeholder = cfg.contentPlaceholder;

  document.getElementById('manualModal').classList.add('show');
  titleInput.focus();
}

function closeManualModal() {
  document.getElementById('manualModal').classList.remove('show');
  pendingManual = null;
}

// 填完点“下一步”：先记下来，再走和上传一样的选标签流程
function confirmManualModal() {
  const type = pendingManual ? pendingManual.type : null;
  if (!type) return;

  const title = document.getElementById('manualTitle').value.trim();
  const content = document.getElementById('manualContent').value.trim();

  if (!title) { showToast('请输入标题'); return; }
  if (!content) { showToast('请输入内容'); return; }

  pendingManual = { type: type, title: title, content: content };
  document.getElementById('manualModal').classList.remove('show');
  openTagPicker('manual', type, null);
}

// 真正保存手动输入的内容（在标签选择器里点“保存”后调用）
async function doCreateManual(nodeIds) {
  const pending = pendingManual;
  if (!pending) return;

  const cfg = {
    material: { url: `/courses/${currentCourseId}/materials`, reload: loadMaterials, label: '资料' },
    note: { url: `/courses/${currentCourseId}/notes`, reload: loadNotes, label: '笔记' },
    mistake: { url: `/courses/${currentCourseId}/mistakes`, reload: loadMistakes, label: '错题' }
  }[pending.type];
  if (!cfg) return;

  const fd = new FormData();
  fd.append('title', pending.title);
  fd.append('content', pending.content);
  // 错题的接口历史上用 knowledgeIds，另外两个用 nodeIds，后端两个都认
  fd.append(pending.type === 'mistake' ? 'knowledgeIds' : 'nodeIds', JSON.stringify(nodeIds));

  try {
    const res = await fetch(`${API}${cfg.url}`, { method: 'POST', body: fd });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '保存失败');
    }
    showToast('已添加' + cfg.label);
    await cfg.reload();
    return true;
  } catch (err) {
    console.error('手动输入保存失败:', err);
    showToast(err.message || '保存失败，请重试');
    return false;
  }
}

// 选完文件后把文件名显示在按钮下面（考核弹窗用）
function showPickedFile(inputId, tipId) {
  const input = document.getElementById(inputId);
  const tip = document.getElementById(tipId);
  const file = input && input.files ? input.files[0] : null;
  if (tip) tip.textContent = file ? file.name : '未选择附件';
}
