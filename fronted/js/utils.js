/*
 * utils.js
 * 通用小工具：转义、文件名拆分、图片判断、Toast、确认弹窗
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ========== 确认弹窗工具 ========== */
// 请求成功后才交给调用方继续处理，避免 HTTP 错误被当作成功。
async function requestApi(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw new Error('无法连接服务器，请检查后端是否在 3000 端口运行。');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error((data && data.message) || `服务器返回 HTTP ${res.status}`),{status:res.status,code:data?.code});
  }
  return res;
}

async function requestList(url) {
  const res = await requestApi(url);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('服务器返回的列表数据格式不正确');
  return rows;
}

function showListError(box, err) {
  const message = document.createElement('div');
  message.className = 'empty';
  message.textContent = `加载失败：${err.message}`;
  box.replaceChildren(message);
  console.error('加载列表失败:', err);
}

let confirmResolve = null;
const confirmQueue = [];
let confirmTrigger = null;
function showConfirm(msg, title = '确认操作') {
  return new Promise(resolve => {
    confirmQueue.push({msg,title,resolve,trigger:document.activeElement});
    openNextConfirm();
  });
}
function openNextConfirm() {
  if(confirmResolve || !confirmQueue.length)return;
  const next=confirmQueue.shift(),dialog=document.getElementById('confirmModal');
  confirmResolve=next.resolve;confirmTrigger=next.trigger;
  document.getElementById('confirmTitle').textContent=next.title;
  document.getElementById('confirmMsg').textContent=next.msg;
  if(!dialog.dataset.confirmBound){
    dialog.addEventListener('cancel',event=>{event.preventDefault();closeConfirm(false);});
    dialog.addEventListener('close',()=>{if(!dialog.open&&confirmResolve)closeConfirm(false);});
    dialog.dataset.confirmBound='true';
  }
  // A normal overlay cannot cover a showModal() dialog, regardless of z-index.
  dialog.classList.add('show');dialog.showModal();
  dialog.querySelector('.btn-cancel').focus({preventScroll:true});
}
function closeConfirm(result) {
  if(!confirmResolve)return;
  const resolve=confirmResolve,trigger=confirmTrigger,dialog=document.getElementById('confirmModal');
  confirmResolve=null;confirmTrigger=null;dialog.classList.remove('show');
  if(dialog.open)dialog.close();
  if(trigger?.isConnected)trigger.focus({preventScroll:true});
  resolve(result===true);
  openNextConfirm();
}
/* ========== Toast 工具 ========== */
function showToast(msg, duration = 2000, kind = 'info') {
  let box = document.getElementById('toastBox');
  if (!box) { box = document.createElement('div'); box.id = 'toastBox'; document.body.append(box); }
  box.setAttribute('aria-live', 'polite');
  box.setAttribute('aria-relevant', 'additions');
  const el = document.createElement('div');
  el.className = kind === 'success' ? 'toast toast-success' : 'toast';
  el.textContent = msg;
  box.replaceChildren(el);
  // A manual popover stays above native dialogs without blocking input or taking focus.
  if (typeof box.showPopover === 'function') {
    box.setAttribute('popover', 'manual');
    if (box.matches(':popover-open')) box.hidePopover();
    box.showPopover();
  }
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => {
      el.remove();
      if (!box.childElementCount && typeof box.hidePopover === 'function' && box.matches(':popover-open')) box.hidePopover();
    }, 300);
  }, duration);
}

// Opt-in experiment: normalize clear line-leading bullets; infer missing ones
// only in a numbered run with at least three items and an observed bullet.
function ocrBulletTrialText(value) {
  const rows = String(value || '').split('\n');
  const numeral = value => /^\d+$/.test(value) ? Number(value) :
    ({一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10})[value];
  const item = text => {
    const match = text.match(/^(\s*)([•●◦‣▪·∙‧・]?)[ \t]*(第([一二三四五六七八九十\d]+)(场|节|章|题|幕)[^\n:：]{0,24}[:：].*)$/);
    return match ? { indent: match[1], bullet: match[2], body: match[3], number: numeral(match[4]), kind: match[5] } : null;
  };
  let run = [];
  const finish = () => {
    if (run.length >= 3 && run.some(entry => entry.item.bullet)) {
      for (const entry of run) rows[entry.index] = entry.item.indent + '• ' + entry.item.body;
    }
    run = [];
  };
  for (let index = 0; index < rows.length; index += 1) {
    const parsed = item(rows[index]);
    if (parsed) {
      const previous = run[run.length - 1];
      if (previous && (parsed.kind !== previous.item.kind || parsed.number !== previous.item.number + 1 || index - previous.index > 3)) finish();
      if (Number.isFinite(parsed.number)) run.push({ index, item: parsed });
      else finish();
      if (parsed.bullet) rows[index] = parsed.indent + '• ' + parsed.body;
    } else {
      // Preserve ambiguous dots, mathematical operators, standalone noise and
      // ordinary numbered/lettered items. Only clear bullet glyphs are replaced.
      rows[index] = rows[index].replace(/^(\s*)[•●◦‣▪][ \t]*(?=\S)/, '$1• ');
      if (!rows[index].trim() || /^【第\s*\d+\s*页】/.test(rows[index])) finish();
    }
  }
  finish();
  return rows.join('\n');
}

// Each display mode keeps its own editable draft. Replacing/clearing a result
// removes the previous control so reopening an editor cannot restore old text.
function setOcrTextResult(textarea, result) {
  if (!textarea) return;
  textarea._ocrModeControl?.remove();
  textarea._ocrModeControl = null;
  textarea.value = result?.text || '';
  if (typeof result?.rawText !== 'string') return;
  const control = document.createElement('div');
  control.className = 'ocr-paragraph-control';
  const title = document.createElement('span'); title.textContent = '文字排版';
  const select = document.createElement('select'); select.setAttribute('aria-label', '识别结果文字排版');
  for (const [value, label] of [['smart', '智能合并段落'], ['raw', '保留原始换行'], ['bullets', '试验：统一列表圆点']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
  }
  const hint = document.createElement('small');
  const baseHint = result.text === result.rawText ? '未发现可安全合并的换行，请校对。' : '已保守合并段内折行，请校对；每种排版分别保留手工修改。';
  hint.textContent = baseHint;
  const trial = ocrBulletTrialText(result.text);
  const drafts = { smart: result.text, raw: result.rawText, bullets: trial };
  let mode = 'smart';
  select.onchange = () => {
    if (textarea.disabled || textarea.readOnly) { select.value = mode; return; }
    drafts[mode] = textarea.value;
    mode = select.value;
    textarea.value = drafts[mode];
    hint.textContent = mode === 'bullets' ? (trial === result.text ? '试验模式：未找到可确认的圆点调整；原文保留。' : '试验模式：统一列表圆点，并在有圆点依据的连续条目中补齐漏识别项。请校对；不会清理独立乱码。') : baseHint;
    const adoptionPanel = textarea.closest('[data-pending-adoption]');
    if (adoptionPanel) adoptionPanel.dataset.pendingAdoption = 'true';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  };
  control.append(title, select, hint);
  textarea.before(control);
  textarea._ocrModeControl = control;
}

function notifyTextRecognitionSuccess(result, panel) {
  const extracted = result?.provider === 'office-browser' || (result?.textPages > 0 && result?.scannedPages === 0);
  const pages = Number.isInteger(result?.totalPages) && result.pages > 0 ? `，已处理 ${result.pages} 页` : '';
  const message = `${extracted ? '提取成功' : '识别成功'}${pages}！请校对下方结果，再选择填入正文或答案。`;
  if (panel) {
    let notice = panel.querySelector('.recognition-success');
    if (!notice) {
      notice = document.createElement('div'); notice.className = 'recognition-success'; notice.setAttribute('role', 'note'); panel.prepend(notice);
    }
    notice.textContent = `✓ ${message}`;
    notice.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
  }
  showToast(`✓ ${message}`, 4500, 'success');
}
// 取扩展名：'/uploads/12-34.pdf' → '.pdf'，没有就是空字符串
function extname(name) {
  const m = /(\.[^./\\]+)$/.exec(String(name || ''));
  return m ? m[1] : '';
}

// 拆成"名字 + 后缀"：'第三章 讲义.pdf' → { base: '第三章 讲义', ext: '.pdf' }
function splitNameExt(name) {
  const s = String(name || '');
  const ext = extname(s);
  return { base: ext ? s.slice(0, s.length - ext.length) : s, ext: ext };
}

// 打开选择器
//   mode         = 'upload'（上传时顺便打标签）| 'edit'（改已有资源的标签）
//   resourceType = 'mistake' | 'material' | 'note'
// 这个文件是不是图片？
// 老数据缺少 MIME 类型时使用文件后缀；没有后缀时保留原来的图片行为。
function isImageFile(fileType, fileUrl) {
  const t = String(fileType || '');
  if (!t) {
    const ext = extname(fileUrl).toLowerCase();
    return !ext || ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.avif', '.ico', '.tif', '.tiff'].includes(ext);
  }
  return t.indexOf('image/') === 0;
}
// 防 XSS
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// 课程名只是知识框架的 UI 根标题，不是数据库里的节点
