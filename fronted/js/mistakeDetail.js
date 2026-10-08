/*
 * mistakeDetail.js
 * 错题详情页（图片 / 附件 / 手动输入三种形态）
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ========== 错题详情 ========== */

async function openMistakeDetail(mistakeId) {
  navStack.push(currentView);
  currentView = { type: 'mistake', id: mistakeId };
  await renderMistakeDetailPage(mistakeId);
}

async function renderMistakeDetailPage(mistakeId) {
  showPageOnly('mistakeDetailPage');

  document.getElementById('mistakeDetailTitle').textContent = '错题详情';
  document.getElementById('mistakeDetailName').textContent = '加载中…';
  document.getElementById('mistakeDetailMeta').textContent = '';
  document.getElementById('mistakeDetailTags').innerHTML = '';
  document.getElementById('mistakeDetailImage').style.display = 'none';
  document.getElementById('mistakeDetailImageError').style.display = 'none';
  document.getElementById('mistakeDetailContent').innerHTML = '';

  try {
    // 详情页的数据一律以后端为准，不依赖列表缓存
    const res = await fetch(`${API}/mistakes/${mistakeId}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '找不到错题');
    }
    renderMistakeDetail(await res.json());
  } catch (err) {
    console.warn('加载错题详情失败:', err.message);
    showToast(err.message || '加载错题详情失败');
    await backFromDetail();
  }
}


function renderMistakeDetail(mistake) {
  document.getElementById('mistakeDetailTitle').textContent = mistake.title || '错题详情';
  document.getElementById('mistakeDetailName').textContent = mistake.title || '（无标题）';
  document.getElementById('mistakeDetailMeta').textContent =
    '创建时间：' + (mistake.created_at || '—');

  const tags = Array.isArray(mistake.knowledge) ? mistake.knowledge : [];
  document.getElementById('mistakeDetailTags').innerHTML = tags.length
    ? tags.map(k => tagChipHtml({ id: k.id, name: k.name, type: k.type }, false, true)).join('')
    : '<span class="tag-none">暂无标签</span>';

  const img = document.getElementById('mistakeDetailImage');
  const errBox = document.getElementById('mistakeDetailImageError');
  const contentBox = document.getElementById('mistakeDetailContent');
  const fileBox = document.getElementById('mistakeDetailFile');
  const hasFile = !!mistake.image_url;
  const isImage = isImageFile(mistake.file_type, mistake.image_url);

  // 三种形态：手动输入（只有文字）/ 图片 / 其它文件（PDF 扫描件之类）
  document.getElementById('mistakeDetailSectionTitle').textContent =
    !hasFile ? '题目内容' : (isImage ? '错题图片' : '附件');

  contentBox.innerHTML = (!hasFile && mistake.content)
    ? '<div class="detail-content">' + escapeHtml(mistake.content) + '</div>'
    : '';

  // 先全部收起来，下面按形态各自打开
  img.style.display = 'none';
  img.removeAttribute('src');
  errBox.style.display = 'none';
  errBox.innerHTML = '图片不存在或已丢失';
  fileBox.style.display = 'none';
  fileBox.innerHTML = '';

  // 手动输入的错题：没有文件
  if (!hasFile) return;

  const url = 'http://localhost:3000' + mistake.image_url;

  // 上传的不是图片：不用 <img> 硬撑，给一个打开文件的入口
  if (!isImage) {
    fileBox.style.display = 'block';
    fileBox.innerHTML =
      '<a class="detail-link" href="' + escapeHtml(url) + '" target="_blank">打开文件</a>' +
      '<div class="detail-meta">' + escapeHtml(mistake.file_type || '未知类型') + '</div>';
    return;
  }

  // 图片：正常显示，加载失败只影响图片区域，不让整页垮掉
  img.onerror = () => {
    img.style.display = 'none';
    errBox.style.display = 'block';
  };
  img.style.display = 'block';
  img.src = url;
}
