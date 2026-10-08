/*
 * materials.js
 * 资料 Tab：列表 + 上传
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ========== 资料 ========== */
async function loadMaterials() {
  const box = document.getElementById('materialList');
  box.innerHTML = '<div class="loading-tip">加载中…</div>';
  try {
    const rows = await requestList(`${API}/courses/${currentCourseId}/materials`);
    currentMaterials = rows;
    if (rows.length === 0) return box.innerHTML = '<div class="empty">暂无资料</div>';
    box.innerHTML = rows.map(r => `
      <div class="item-row">
        <div class="info">
          <div class="title">${escapeHtml(r.title)}</div>
          <div class="meta">${r.file_url ? '📄 文件' : '✍ 手动输入'} · ${r.created_at}</div>
          ${r.content ? `<div class="row-content">${escapeHtml(r.content)}</div>` : ''}
          <div class="mistake-tags">${nodeChipsHtml(r)}</div>
        </div>
        <div class="mistake-actions">
          <button onclick="event.stopPropagation();openResourceDetail('material', ${r.id})">查看</button>
          <button onclick="openTagPicker('edit', 'material', ${r.id})">编辑</button>
          <button onclick="delItem('materials', ${r.id}, loadMaterials)">删除</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    currentMaterials = [];
    showListError(box, err);
  }
}

// 选完文件先弹标签选择器，确认后再真正上传
async function uploadMaterial() {
  const fileInput = document.getElementById('materialFile');
  const file = fileInput.files[0];
  if (!file) return;

  pendingUploadFile = file;
  fileInput.value = ''; // 清空选择框，方便再次选择同一个文件
  openTagPicker('upload', 'material', null);
}

// 真正上传资料：file + nodeIds（title 是用户改过的名字，为空则后端用文件名）
async function doUploadMaterial(file, nodeIds, title) {
  const uploadBtn = document.querySelector('#pane-materials .upload-btn');
  const originalText = uploadBtn.textContent;
  uploadBtn.textContent = '上传中…';
  uploadBtn.disabled = true;

  const fd = new FormData();
  fd.append('file', file);
  if (title) fd.append('title', title);
  fd.append('nodeIds', JSON.stringify(nodeIds));

  try {
    const res = await fetch(`${API}/courses/${currentCourseId}/materials`, {
      method: 'POST',
      body: fd
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '上传失败');
    }

    showToast('上传成功');
    await loadMaterials();
    return true;
  } catch (err) {
    console.error('上传资料失败:', err);
    showToast(err.message || '上传失败，请重试');
    return false;
  } finally {
    uploadBtn.textContent = originalText;
    uploadBtn.disabled = false;
  }
}
