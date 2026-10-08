/*
 * notes.js
 * 笔记 Tab：列表 + 上传
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ========== 笔记 ========== */
async function loadNotes() {
  const box = document.getElementById('noteList');
  box.innerHTML = '<div class="loading-tip">加载中…</div>';
  try {
    const rows = await requestList(`${API}/courses/${currentCourseId}/notes`);
    currentNotes = rows;
    if (rows.length === 0) return box.innerHTML = '<div class="empty">暂无笔记</div>';
    box.innerHTML = rows.map(r => `
      <div class="item-row">
        <div class="info">
          <div class="title">${escapeHtml(r.title)}</div>
          <div class="meta">${r.file_url ? '📄 文件' : '✍ 手动输入'} · ${r.source} · ${r.created_at}</div>
          ${r.content ? `<div class="row-content">${escapeHtml(r.content)}</div>` : ''}
          <div class="mistake-tags">${nodeChipsHtml(r)}</div>
        </div>
        <div class="mistake-actions">
          <button onclick="event.stopPropagation();openResourceDetail('note', ${r.id})">查看</button>
          <button onclick="openTagPicker('edit', 'note', ${r.id})">编辑</button>
          <button onclick="delItem('notes', ${r.id}, loadNotes)">删除</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    currentNotes = [];
    showListError(box, err);
  }
}

// 选完文件先弹标签选择器，确认后再真正上传
async function uploadNote() {
  const fileInput = document.getElementById('noteFile');
  const file = fileInput.files[0];
  if (!file) return;

  pendingUploadFile = file;
  fileInput.value = '';
  openTagPicker('upload', 'note', null);
}

// 真正上传笔记：file + source + nodeIds（title 是用户改过的名字）
async function doUploadNote(file, nodeIds, title) {
  const uploadBtn = document.querySelector('#pane-notes .upload-btn');
  const originalText = uploadBtn.textContent;
  uploadBtn.textContent = '上传中…';
  uploadBtn.disabled = true;

  const fd = new FormData();
  fd.append('file', file);
  if (title) fd.append('title', title);
  fd.append('source', '手动上传');
  fd.append('nodeIds', JSON.stringify(nodeIds));

  try {
    const res = await fetch(`${API}/courses/${currentCourseId}/notes`, {
      method: 'POST',
      body: fd
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '上传失败');
    }

    showToast('上传成功');
    await loadNotes();
    return true;
  } catch (err) {
    console.error('上传笔记失败:', err);
    showToast(err.message || '上传失败，请重试');
    return false;
  } finally {
    uploadBtn.textContent = originalText;
    uploadBtn.disabled = false;
  }
}
