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
    throw new Error((data && data.message) || `服务器返回 HTTP ${res.status}`);
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
function showConfirm(msg, title = '确认操作') {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = msg;
  document.getElementById('confirmModal').classList.add('show');
  return new Promise(resolve => { confirmResolve = resolve; });
}
function closeConfirm(result) {
  document.getElementById('confirmModal').classList.remove('show');
  if (confirmResolve) { confirmResolve(result); confirmResolve = null; }
}
/* ========== Toast 工具 ========== */
function showToast(msg, duration = 2000) {
  const box = document.getElementById('toastBox');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, duration);
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
