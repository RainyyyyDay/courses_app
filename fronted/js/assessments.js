/*
 * assessments.js
 * 考核 Tab：列表 + 添加弹窗（含可选附件）
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ========== 考核 ========== */
async function loadAssessments() {
  const box = document.getElementById('assessmentList');
  box.innerHTML = '<div class="loading-tip">加载中…</div>';
  try {
    const rows = await requestList(`${API}/courses/${currentCourseId}/assessments`);
    if (rows.length === 0) return box.innerHTML = '<div class="empty">暂无考核</div>';
    box.innerHTML = rows.map(r => `
      <div class="item-row">
        <div class="info">
          <div class="title">${escapeHtml(r.title)}</div>
          <div class="meta">截止：${r.deadline || '未设置'}</div>
          ${r.requirement ? `<div class="row-content">${escapeHtml(r.requirement)}</div>` : ''}
        </div>
        <div class="mistake-actions">
          ${r.file_url ? `<a class="detail-link" href="http://localhost:3000${escapeHtml(r.file_url)}" target="_blank">附件</a>` : ''}
          <button onclick="delItem('assessments', ${r.id}, loadAssessments)">删除</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    showListError(box, err);
  }
}
function openAssessmentModal() {
  document.getElementById('assessmentModal').classList.add('show');
  document.getElementById('assessTitle').value = '';
  document.getElementById('assessDeadline').value = '';
  document.getElementById('assessReq').value = '';
  document.getElementById('assessFile').value = '';       // 清空上次选的附件
  document.getElementById('assessFileName').textContent = '未选择附件';
}
function closeAssessmentModal() {
  document.getElementById('assessmentModal').classList.remove('show');
}
async function addAssessment() {
  const title = document.getElementById('assessTitle').value.trim();
  if (!title) { showToast('请输入考核名称'); return; }

  // 用 FormData 发：有附件就带上，没有就是一条纯文字考核
  const fd = new FormData();
  fd.append('title', title);
  fd.append('deadline', document.getElementById('assessDeadline').value);
  fd.append('requirement', document.getElementById('assessReq').value);

  const fileInput = document.getElementById('assessFile');
  const file = fileInput.files ? fileInput.files[0] : null;
  if (file) fd.append('file', file);

  try {
    const res = await fetch(`${API}/courses/${currentCourseId}/assessments`, {
      method: 'POST',
      body: fd
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '添加失败');
    }
    closeAssessmentModal();
    showToast('添加成功');
    loadAssessments();
  } catch (err) {
    console.error('添加考核失败:', err);
    showToast(err.message || '添加失败，请重试');
  }
}
