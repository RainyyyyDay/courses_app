// Supplement saved attachments without uploading a second copy.
let resourceTextEditor = null;
function mountResourceTextAction(type, row) {
  if (!row.file_url) return;
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'edit-mini-btn resource-text-entry';
  button.textContent = '从附件识别文字';
  button.onclick = () => void openResourceTextEditor(type, row.id, { autoStart: false });
  document.getElementById('resourceDetailContentActions').append(button);
}

async function fetchResourceAttachmentFile(row, signal) {
  const url = attachmentUrl(row.file_url || row.url || '');
  if (!url) throw new Error('没有可识别的附件，请先上传附件');
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('附件读取失败，请确认文件仍存在');
  const blob = await response.blob();
  const ext = extname(row.file_url || row.url || ''), title = row.title || row.name || '附件';
  const name = ext && !title.toLowerCase().endsWith(ext.toLowerCase()) ? title + ext : title;
  return new File([blob], name, { type: row.file_type || row.type || blob.type });
}
function resourceTextIsCurrent(state) {
  return state === resourceTextEditor && currentCourseId === state.courseId && currentView.type === 'resource'
    && currentView.resourceType === state.type && currentView.id === state.id;
}
function closeResourceTextEditor() {
  const state = resourceTextEditor;
  if (!state) return;
  resourceTextEditor = null; state.controller.abort(); state.dialog.close(); state.dialog.remove();
}
function resourceTextControls(state) {
  const dialog = state.dialog, draft = dialog.querySelector('[data-text-draft]').value.trim();
  const busy = state.busy;
  dialog.querySelector('[data-text-scan]').disabled = busy || !state.row;
  dialog.querySelector('[data-text-refresh]').disabled = busy || !state.row;
  dialog.querySelector('[data-text-draft]').disabled = busy;
  dialog.querySelector('[data-text-append]').disabled = busy || !draft || !state.row;
  dialog.querySelector('[data-text-append]').textContent = state.original.trim() ? '追加并保存' : '保存正文';
  dialog.querySelector('[data-text-replace]').hidden = !state.original.trim();
  dialog.querySelector('[data-text-replace]').disabled = busy || !draft || !state.row;
  refreshVisionOcrOptions();
}
async function refreshResourceTextOriginal(state) {
  const response = await requestApi(`${API}/${state.type === 'note' ? 'notes' : 'materials'}/${state.id}`, { signal: state.controller.signal });
  const row = await response.json();
  if (!resourceTextIsCurrent(state)) return false;
  if (row.course_id !== state.courseId) throw new Error('内容不属于当前课程');
  state.row = row; state.original = String(row.content || '');
  state.dialog.querySelector('[data-text-original]').textContent = state.original || '尚未保存正文';
  state.dialog.querySelector('[data-text-name]').textContent = row.title || '附件';
  return true;
}
async function openResourceTextEditor(type, id, options = {}) {
  closeResourceTextEditor();
  const dialog = document.createElement('dialog'); dialog.className = 'resource-text-dialog';
  dialog.setAttribute('aria-labelledby', 'resourceTextTitle');
  dialog.innerHTML = `<header><div><h2 id="resourceTextTitle">识别附件／补充正文</h2><p data-text-name></p></div><button type="button" data-text-close aria-label="关闭">×</button></header>
    <div class="resource-text-body"><p class="resource-text-note">直接读取已上传的附件。识别后请校对，选择保存方式；原附件保持不变。</p>
    <div class="resource-text-heading"><h3>已有正文</h3><button type="button" class="edit-mini-btn" data-text-refresh>刷新已有正文</button></div>
    <div class="detail-content" data-text-original>正在读取…</div>
    <div class="resource-text-heading"><h3>待补充文字（可编辑）</h3><button type="button" id="resourceTextScan" class="edit-btn" data-text-scan>从附件识别文字</button></div>
    ${recognitionOptionsHtml('resourceTextRecognitionMethod', 'resourceTextScan')}
    <div data-text-result><textarea data-text-draft aria-label="待补充文字" rows="9" placeholder="识别结果会显示在这里，也可以手动输入补充文字"></textarea></div>
    <p data-text-status role="status" aria-live="polite"></p></div>
    <footer><button type="button" class="btn-cancel" data-text-cancel>取消</button><button type="button" class="edit-btn" data-text-replace>替换并保存</button><button type="button" class="btn-confirm" data-text-append>保存正文</button></footer>`;
  const state = { type, id, courseId: currentCourseId, dialog, controller: new AbortController(), original: '', row: null, busy: true };
  resourceTextEditor = state;
  dialog.querySelector('[data-text-close]').onclick = closeResourceTextEditor;
  dialog.querySelector('[data-text-cancel]').onclick = closeResourceTextEditor;
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeResourceTextEditor(); });
  dialog.querySelector('[data-text-draft]').oninput = () => resourceTextControls(state);
  dialog.querySelector('[data-text-scan]').onclick = () => void recognizeExistingResourceText();
  dialog.querySelector('[data-text-append]').onclick = () => void saveResourceText('append');
  dialog.querySelector('[data-text-replace]').onclick = () => void saveResourceText('replace');
  dialog.querySelector('[data-text-refresh]').onclick = async () => {
    if (state.busy) return;
    state.busy = true; resourceTextControls(state);
    try { if (await refreshResourceTextOriginal(state)) dialog.querySelector('[data-text-status]').textContent = '已有正文已刷新，待补充文字保留，请核对后保存。'; }
    catch (err) { if (resourceTextIsCurrent(state)) dialog.querySelector('[data-text-status]').textContent = err.message; }
    finally { if (resourceTextIsCurrent(state)) { state.busy = false; resourceTextControls(state); } }
  };
  document.body.append(dialog); dialog.showModal(); resourceTextControls(state);
  try {
    if (!await refreshResourceTextOriginal(state)) return;
    state.busy = false; resourceTextControls(state);
    if (options.autoStart !== false) await recognizeExistingResourceText();
    else dialog.querySelector('[data-text-status]').textContent = '选择识别方式后点击识别；也可以直接在下方输入补充文字。';
  } catch (err) {
    if (resourceTextIsCurrent(state)) { state.busy = false; dialog.querySelector('[data-text-status]').textContent = err.message; resourceTextControls(state); }
  }
}
async function recognizeExistingResourceText() {
  const state = resourceTextEditor;
  if (!state || state.busy || !state.row) return;
  const dialog = state.dialog, status = dialog.querySelector('[data-text-status]');
  state.busy = true; resourceTextControls(state); status.textContent = '正在读取已上传的附件…';
  try {
    const info = { name: state.row.file_url, type: state.row.file_type };
    if (!officeFileKind(info) && !ocrWebIsPdf(info) && !/^image\//i.test(info.type || '') && !/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(info.name || '')) {
      throw new Error('此附件格式暂不支持识别，可以在下方手动补充文字');
    }
    const url = attachmentUrl(state.row.file_url);
    if (!url) throw new Error('没有可识别的附件，可以在下方手动补充正文');
    const response = await fetch(url, { signal: state.controller.signal });
    if (!response.ok) throw new Error('附件读取失败，请确认原文件仍存在；也可以手动补充正文');
    const blob = await response.blob();
    if (!resourceTextIsCurrent(state)) return;
    const ext = extname(state.row.file_url), title = state.row.title || '附件';
    const name = ext && !title.toLowerCase().endsWith(ext.toLowerCase()) ? title + ext : title;
    const file = new File([blob], name, { type: state.row.file_type || blob.type });
    const recognitionMethod = dialog.querySelector('#resourceTextRecognitionMethod').value;
    const result = await recognizeUploadedFile(file, message => { if (resourceTextIsCurrent(state)) status.textContent = message; }, { signal: state.controller.signal, recognitionMethod });
    if (!resourceTextIsCurrent(state)) return;
    if (result.provider === 'mock') throw new Error('当前服务返回模拟结果，未填入；请检查识别服务');
    if (!String(result.text || '').trim()) throw new Error('没有识别到文字，原正文和已有草稿保留');
    dialog.querySelector('[data-text-draft]').value = result.text;
    status.textContent = (result.warnings || []).join('；');
    notifyTextRecognitionSuccess(result, dialog.querySelector('[data-text-result]'));
  } catch (err) {
    if (resourceTextIsCurrent(state)) status.textContent = err.name === 'AbortError' ? '已取消识别，原正文和待补充文字保留。' : err.message;
  } finally { if (resourceTextIsCurrent(state)) { state.busy = false; resourceTextControls(state); } }
}
async function saveResourceText(mode) {
  const state = resourceTextEditor;
  if (!state || state.busy || !state.row) return;
  const text = state.dialog.querySelector('[data-text-draft]').value.trim();
  if (!text) return;
  state.busy = true; resourceTextControls(state);
  try {
    if (mode === 'replace' && state.original.trim()) {
      if (!await showConfirm('将用待补充文字替换已有正文。原附件保留，确定替换吗？', '替换正文')) return;
      if (!resourceTextIsCurrent(state)) return;
    }
    await requestApi(`${API}/courses/${state.courseId}/${state.type === 'note' ? 'notes' : 'materials'}/${state.id}/content`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, mode, expectedContent: state.original }), signal: state.controller.signal,
    });
    if (!resourceTextIsCurrent(state)) return;
    closeResourceTextEditor();
    await renderResourceDetailPage(state.type, state.id);
    showToast('✓ 正文已保存，原附件保留。', 4500, 'success');
  } catch (err) {
    if (resourceTextIsCurrent(state)) state.dialog.querySelector('[data-text-status]').textContent = err.status === 409
      ? '正文已在其他页面修改，待补充文字保留。请点“刷新已有正文”，核对后再保存。' : `保存失败：${err.message}。待补充文字保留。`;
  } finally { if (resourceTextIsCurrent(state)) { state.busy = false; resourceTextControls(state); } }
}
