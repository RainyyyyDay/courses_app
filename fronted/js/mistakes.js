/*
 * mistakes.js
 * 错题 Tab：列表 + 上传
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ========== 错题 ========== */

async function loadMistakes() {
  const box = document.getElementById('mistakeList');
  box.innerHTML = '<div class="loading-tip">加载中…</div>';
  try {
    const rows = await requestList(`${API}/courses/${currentCourseId}/mistakes`);
    currentMistakes = rows;

    if (rows.length === 0) return box.innerHTML = '<div class="empty">暂无错题</div>';

    box.innerHTML = rows.map(r => {
      return `
      <div class="item-row">
        <div class="info">
          <div class="title">${escapeHtml(r.title)}</div>
          <div class="meta">${!r.image_url ? '✍ 手动输入' : (isImageFile(r.file_type, r.image_url) ? '🖼 图片' : '📄 文件')} · ${r.created_at}</div>
          ${r.content ? `<div class="row-content">${escapeHtml(r.content)}</div>` : ''}
          <div class="mistake-tags">${nodeChipsHtml(r)}</div>
        </div>
        <div class="mistake-actions">
          <button onclick="event.stopPropagation();openMistakeDetail(${r.id})">查看</button>
          <button onclick="openTagPicker('edit', 'mistake', ${r.id})">编辑</button>
          <button onclick="delItem('mistakes', ${r.id}, loadMistakes)">删除</button>
        </div>
      </div>
    `;
    }).join('');
  } catch (err) {
    currentMistakes = [];
    showListError(box, err);
  }
}

// 用户选完图片后先弹标签选择器，确认后再真正上传
async function uploadMistake() {
  const fileInput = document.getElementById('mistakeFile');
  const file = fileInput.files[0];
  if (!file) return;

  pendingUploadFile = file;
  fileInput.value = ''; // 清空选择框，方便用户再次选择同一个文件
  openTagPicker('upload', 'mistake', null);
}

// 真正发起上传：multipart/form-data，字段 file + knowledgeIds（可含 folder / knowledge）
// title 是用户改过的名字，为空则后端用原始文件名
async function doUploadMistake(file, knowledgeIds, title) {
  const uploadBtn = document.querySelector('#pane-mistakes .upload-btn');
  const originalText = uploadBtn.textContent;
  uploadBtn.textContent = '上传中…';
  uploadBtn.disabled = true;

  const fd = new FormData();
  fd.append('file', file);
  if (title) fd.append('title', title);
  // Phase 1 约定的推荐格式：JSON 数组字符串；不选标签时就是 "[]"
  fd.append('knowledgeIds', JSON.stringify(knowledgeIds));

  try {
    const res = await fetch(`${API}/courses/${currentCourseId}/mistakes`, {
      method: 'POST',
      body: fd
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '上传失败');
    }

    showToast('上传成功');
    await loadMistakes(); // 刷新列表，新错题的标签会一起显示出来
    return true;
  } catch (err) {
    console.error('上传错题失败:', err);
    showToast(err.message || '上传失败，请重试');
    return false;
  } finally {
    // 恢复按钮；文件由选择器在保存成功或取消时清理，失败时保留以便重试。
    uploadBtn.textContent = originalText;
    uploadBtn.disabled = false;
  }
}
