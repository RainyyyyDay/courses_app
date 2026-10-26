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

function notifyTextRecognitionSuccess(result, panel) {
  const extracted = result?.provider === 'office-browser' || (result?.textPages > 0 && result?.scannedPages === 0);
  const pages = Number.isInteger(result?.totalPages) && result.pages > 0 ? `，已处理 ${result.pages} 页` : '';
  const message = result?.partial ? `部分识别完成${pages}，未完成的页码见下方说明；已成功结果保留，请校对后填入。`
    : `${extracted ? '提取成功' : '识别成功'}${pages}！请校对下方结果，再选择填入正文或答案。`;
  if (panel) {
    let notice = panel.querySelector('.recognition-success');
    if (!notice) {
      notice = document.createElement('div'); notice.className = 'recognition-success'; notice.setAttribute('role', 'note'); panel.prepend(notice);
    }
    notice.textContent = `${result?.partial ? '⚠' : '✓'} ${message}`;
    notice.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
  }
  showToast(`${result?.partial ? '⚠' : '✓'} ${message}`, 4500, result?.partial ? 'info' : 'success');
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
