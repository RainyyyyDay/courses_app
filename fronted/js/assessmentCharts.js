const ASSESSMENT_CHART_PALETTE = Object.freeze([
  '#7f9298', '#a8b4a3', '#c6aaa4', '#a99caf', '#c8b99f', '#849ba8', '#b7a69b', '#9aa89d',
]);
const ASSESSMENT_CHART_UNKNOWN_COLOR = '#b9b5ae';
const assessmentChartInstances = new Map();
let assessmentChartEditorState = null;
let assessmentChartPreviewFrame = 0;

function assessmentChartPercent(value) {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[%％]/g, '').trim());
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
}

function assessmentChartItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 30).map((item, index) => ({
    label: String(item?.label || '').trim().slice(0, 80),
    percent: typeof item?.percent === 'number' && Number.isFinite(item.percent)
      ? Math.round(assessmentChartPercent(item.percent) * 100) / 100 : 0,
    detail: String(item?.detail || '').trim().slice(0, 500),
    color: /^#[0-9a-f]{6}$/i.test(item?.color || '') ? item.color : ASSESSMENT_CHART_PALETTE[index % ASSESSMENT_CHART_PALETTE.length],
  })).filter(item => item.label && item.percent > 0);
}

function assessmentChartPrepared(chart) {
  const items = assessmentChartItems(chart?.items);
  const known = Math.round(items.reduce((sum, item) => sum + item.percent, 0) * 100) / 100;
  const overflow = known > 100.0001;
  const unknown = overflow ? 0 : Math.round((100 - known) * 100) / 100;
  const display = items.map((item, index) => ({
    ...item,
    color: item.color || ASSESSMENT_CHART_PALETTE[index % ASSESSMENT_CHART_PALETTE.length],
  }));
  if (items.length && unknown > 0) {
    display.push({
      label: '未说明', percent: unknown, detail: '来源没有明确说明的剩余比例',
      color: ASSESSMENT_CHART_UNKNOWN_COLOR, unknown: true,
    });
  }
  return { items, display, known, unknown, overflow, valid: items.length > 0 && !overflow };
}

function assessmentChartSumText(prepared) {
  if (prepared.overflow) return `已填写 ${prepared.known}%，合计超过 100%，请减少后再保存。`;
  if (!prepared.items.length) return '至少填写一个考核部分。';
  if (prepared.unknown > 0) return `已填写 ${prepared.known}%，未满 100%；将自动把 ${prepared.unknown}% 归为“未说明”。`;
  return '各部分合计 100%。';
}

function assessmentChartDetailsHtml(prepared) {
  return prepared.display.map(item => `<li><span class="assessment-chart-swatch" style="--chart-color:${item.color}"></span><span><strong>${escapeHtml(item.label)}</strong>${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ''}</span><b>${item.percent}%</b></li>`).join('');
}

const assessmentChartCalloutPlugin = {
  id: 'assessmentChartCallout',
  afterTooltipDraw(chart) {
    const active = chart.tooltip?.getActiveElements?.() || [];
    const tooltip = chart.canvas.parentElement?.querySelector('.assessment-chart-tooltip');
    if (!active.length || !tooltip || tooltip.style.opacity !== '1') return;
    const arc = chart.getDatasetMeta(0).data[active[0].index];
    if (!arc) return;
    const middle = (arc.startAngle + arc.endAngle) / 2;
    const sx = arc.x + Math.cos(middle) * arc.outerRadius;
    const sy = arc.y + Math.sin(middle) * arc.outerRadius;
    const tipX = tooltip.offsetLeft < chart.width / 2 ? tooltip.offsetLeft + tooltip.offsetWidth : tooltip.offsetLeft;
    const tipY = tooltip.offsetTop + Math.min(24, tooltip.offsetHeight / 2);
    const bendX = sx + Math.sign(tipX - sx) * 18;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(92, 105, 108, .5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(bendX, sy, tipX, tipY);
    ctx.stroke();
    ctx.fillStyle = '#6f8587';
    ctx.beginPath();
    ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
};

function assessmentChartExternalTooltip(context) {
  const chart = context.chart, tooltip = context.tooltip;
  const host = chart.canvas.parentElement;
  const box = host?.querySelector('.assessment-chart-tooltip');
  if (!box) return;
  if (!tooltip.opacity || !tooltip.dataPoints?.length) {
    box.style.opacity = '0';
    box.style.transform = 'translateY(4px)';
    return;
  }
  const item = chart.$assessmentItems?.[tooltip.dataPoints[0].dataIndex];
  if (!item) return;
  box.innerHTML = `<strong>${escapeHtml(item.label)}</strong><span>${item.percent}%</span>${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ''}`;
  const maxLeft = Math.max(8, chart.width - 224);
  const left = tooltip.caretX > chart.width * .58 ? Math.max(8, tooltip.caretX - 208) : Math.min(maxLeft, tooltip.caretX + 18);
  const top = Math.max(8, Math.min(chart.height - 100, tooltip.caretY - 44));
  box.style.left = left + 'px';
  box.style.top = top + 'px';
  box.style.opacity = '1';
  box.style.transform = 'translateY(0)';
}

function assessmentChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 260 },
    layout: { padding: 10 },
    events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove'],
    plugins: {
      legend: {
        position: 'bottom',
        labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14, color: '#586169' },
      },
      tooltip: { enabled: false, external: assessmentChartExternalTooltip },
    },
  };
}

function assessmentChartMount(key, canvasOrId, chart, prepared) {
  assessmentChartDestroy(key);
  const canvas = typeof canvasOrId === 'string' ? document.getElementById(canvasOrId) : canvasOrId;
  if (!canvas || typeof Chart === 'undefined' || !prepared.display.length) return null;
  const instance = new Chart(canvas, {
    type: 'pie',
    data: {
      labels: prepared.display.map(item => item.label),
      datasets: [{
        data: prepared.display.map(item => item.percent),
        backgroundColor: prepared.display.map(item => item.color || ASSESSMENT_CHART_UNKNOWN_COLOR),
        borderColor: '#fffdfa',
        borderWidth: 3,
        hoverOffset: 13,
      }],
    },
    options: assessmentChartOptions(),
    plugins: [assessmentChartCalloutPlugin],
  });
  instance.$assessmentItems = prepared.display;
  assessmentChartInstances.set(key, instance);
  return instance;
}

function assessmentChartDestroy(key) {
  const chart = assessmentChartInstances.get(key);
  if (chart) {
    chart.destroy();
    assessmentChartInstances.delete(key);
  }
}

function assessmentChartCardHtml(row) {
  if (!row.chart?.items?.length) {
    return '<div class="assessment-chart-empty"><span>还没有考核构成图</span><button type="button" onclick="openAssessmentChartEditor(' + row.id + ')">添加构成饼图</button></div>';
  }
  const prepared = assessmentChartPrepared(row.chart);
  if (!prepared.valid) return '<div class="assessment-chart-empty"><span>图表数据需要修正</span><button type="button" onclick="openAssessmentChartEditor(' + row.id + ')">编辑图表</button></div>';
  return `<section class="assessment-chart-card" aria-label="${escapeHtml(row.chart.title || row.title + '构成图')}">
    <header><div><h4>${escapeHtml(row.chart.title)}</h4><p>已明确 ${prepared.known}%${prepared.unknown ? ` · 未说明 ${prepared.unknown}%` : ''}</p></div><button type="button" onclick="openAssessmentChartEditor(${row.id})">编辑图表</button></header>
    <div class="assessment-chart-visual"><canvas id="assessmentChartCanvas${row.id}" role="img" aria-label="${escapeHtml(row.chart.title)}，详细数据见下方列表"></canvas><div class="assessment-chart-tooltip" role="status" aria-live="polite"></div></div>
    <ul class="assessment-chart-details">${assessmentChartDetailsHtml(prepared)}</ul>
  </section>`;
}

function renderAssessmentCharts() {
  for (const key of [...assessmentChartInstances.keys()]) {
    if (key.startsWith('card:')) assessmentChartDestroy(key);
  }
  for (const row of assessmentRows) {
    if (!row.chart?.items?.length) continue;
    const prepared = assessmentChartPrepared(row.chart);
    if (prepared.valid) assessmentChartMount('card:' + row.id, 'assessmentChartCanvas' + row.id, row.chart, prepared);
  }
  if (assessmentChartEditorState && document.getElementById('assessmentChartEditor')?.open) assessmentChartEditorRender();
}

function assessmentChartRowsHtml() {
  const state = assessmentChartEditorState;
  if (!state) return '';
  return state.chart.items.map((item, index) => `<article class="assessment-chart-row" data-chart-row="${index}">
    <label>名称<input maxlength="80" value="${escapeHtml(item.label)}" oninput="assessmentChartField(${index},'label',this.value)" placeholder="如：期末考试" /></label>
    <label>占比（%）<input type="number" min="0.01" max="100" step="0.01" value="${item.percent || ''}" oninput="assessmentChartField(${index},'percent',this.value)" /></label>
    <label class="assessment-chart-detail-field">具体内容<textarea maxlength="500" rows="2" oninput="assessmentChartField(${index},'detail',this.value)" placeholder="这部分包含哪些内容">${escapeHtml(item.detail)}</textarea></label>
    <label class="assessment-chart-color-field">颜色<input type="color" value="${item.color || ASSESSMENT_CHART_PALETTE[index % ASSESSMENT_CHART_PALETTE.length]}" oninput="assessmentChartField(${index},'color',this.value)" aria-label="第 ${index + 1} 部分颜色" /></label>
    <button type="button" class="assessment-chart-remove" onclick="assessmentChartRemoveRow(${index})" ${state.chart.items.length <= 1 ? 'disabled' : ''}>删除</button>
  </article>`).join('');
}

function assessmentChartEditorPrepared() {
  return assessmentChartPrepared(assessmentChartEditorState?.chart);
}

function renderAssessmentChartEditorRows() {
  const host = document.getElementById('assessmentChartRows');
  if (host) host.innerHTML = assessmentChartRowsHtml();
}

function assessmentChartEditorRender() {
  const state = assessmentChartEditorState;
  if (!state) return;
  const prepared = assessmentChartEditorPrepared();
  const sum = document.getElementById('assessmentChartSum');
  if (sum) {
    sum.textContent = assessmentChartSumText(prepared);
    sum.classList.toggle('is-over', prepared.overflow);
  }
  const title = document.getElementById('assessmentChartPreviewTitle');
  if (title) title.textContent = state.chart.title || '图表预览';
  const details = document.getElementById('assessmentChartPreviewDetails');
  if (details) details.innerHTML = prepared.display.length ? assessmentChartDetailsHtml(prepared) : '<li class="assessment-chart-no-data">填写名称和占比后显示预览。</li>';
  cancelAnimationFrame(assessmentChartPreviewFrame);
  assessmentChartPreviewFrame = requestAnimationFrame(() => {
    const canvas = document.getElementById('assessmentChartEditorCanvas');
    if (!canvas || !document.getElementById('assessmentChartEditor')?.open) return;
    assessmentChartMount('editor', canvas, state.chart, prepared);
  });
  assessmentChartRefreshAiAvailability();
}

function assessmentChartAddRow() {
  const state = assessmentChartEditorState;
  if (!state || state.chart.items.length >= 30) return;
  const index = state.chart.items.length;
  state.chart.items.push({ label: '', percent: '', detail: '', color: ASSESSMENT_CHART_PALETTE[index % ASSESSMENT_CHART_PALETTE.length] });
  renderAssessmentChartEditorRows();
  assessmentChartEditorRender();
  document.querySelector(`[data-chart-row="${index}"] input`)?.focus();
}

function assessmentChartRemoveRow(index) {
  const state = assessmentChartEditorState;
  if (!state || state.chart.items.length <= 1) return;
  state.chart.items.splice(index, 1);
  renderAssessmentChartEditorRows();
  assessmentChartEditorRender();
}

function assessmentChartField(index, field, value) {
  const item = assessmentChartEditorState?.chart.items[index];
  if (!item) return;
  item[field] = field === 'percent' ? (value === '' ? '' : assessmentChartPercent(value)) : String(value);
  if (field === 'color' && /^#[0-9a-f]{6}$/i.test(value)) item.color = value;
  assessmentChartEditorRender();
}

function assessmentChartAiReady() {
  try { return typeof coursesAiSettings !== 'undefined' && coursesAiSettings.realReady(); }
  catch { return false; }
}

function assessmentChartRefreshAiAvailability() {
  const state = assessmentChartEditorState;
  const buttons = ['assessmentChartAiBody', 'assessmentChartAiFile', 'assessmentChartAiEdit'].map(id => document.getElementById(id));
  if (!buttons[0]) return;
  const ready = assessmentChartAiReady(), busy = !!state?.busy;
  buttons[0].disabled = !ready || busy || !document.getElementById('assessmentChartSource')?.value.trim();
  buttons[1].disabled = !ready || busy || !state?.fileUrl;
  buttons[2].disabled = !ready || busy || !state?.chart.items?.some(item => item.label);
  const source = document.getElementById('assessmentChartAiState');
  if (source) source.textContent = ready ? coursesAiSettings.label() + ' · AI 结果只作为草稿，需核对后保存' : '未配置真实 API：AI 键不可用，手动创建和编辑仍可使用。';
  const save = document.getElementById('assessmentChartSave');
  if (save) save.disabled = !!busy;
}

function assessmentChartSetBusy(busy, message = '') {
  const state = assessmentChartEditorState;
  if (!state) return;
  state.busy = busy;
  const status = document.getElementById('assessmentChartAiStatus');
  if (status && message) status.textContent = message;
  assessmentChartRefreshAiAvailability();
}

function assessmentChartAiErrorMessage(error) {
  const messages = {
    ASSESSMENT_TOTAL_EXCEEDS_100: 'AI 提取出的占比合计超过 100%，原图保持不变；请核对来源后手动修改。',
    AI_AUTH_FAILED: 'API 鉴权失败，请检查 Key 和服务商。',
    AI_MODEL_PERMISSION: '当前 Key 没有使用所选模型的权限。',
    AI_MODEL_NOT_FOUND: '所选模型不存在或未开通。',
    AI_BALANCE_UNAVAILABLE: 'API 余额或额度不可用。',
    AI_UPSTREAM_RATE_LIMITED: 'AI 服务请求过于频繁，请稍后再试。',
    BODY_TOO_LARGE: '本次来源文字过长，请缩短后重试。',
    LOCAL_AI_UNAVAILABLE: '本地 AI 服务未运行，请重启课程网站后再试。',
    AI_TIMEOUT: 'AI 请求超时，图表草稿保持不变。',
  };
  return messages[error?.message] || error?.message || 'AI 请求失败，请重试。';
}

function openAssessmentChartEditor(id, initialSource = null) {
  const row = assessmentCourseId === currentCourseId && assessmentRows.find(item => item.id === id);
  if (!row) return;
  assessmentChartDestroy('editor');
  const source = row.chart || {
    title: (row.title + '成绩构成').slice(0, 120),
    items: [{ label: '', percent: '', detail: '', color: ASSESSMENT_CHART_PALETTE[0] }],
    version: 0,
    source: 'manual',
  };
  assessmentChartEditorState = {
    courseId: currentCourseId,
    assessmentId: row.id,
    assessmentTitle: row.title,
    fileUrl: row.file_url || '',
    fileType: row.file_type || '',
    originalRequirement: row.requirement || '',
    chart: {
      title: source.title || (row.title + '成绩构成').slice(0, 120),
      items: source.items?.length ? source.items.map((item, index) => ({
        label: item.label || '', percent: item.percent ?? '', detail: item.detail || '',
        color: item.color || ASSESSMENT_CHART_PALETTE[index % ASSESSMENT_CHART_PALETTE.length],
      })) : [{ label: '', percent: '', detail: '', color: ASSESSMENT_CHART_PALETTE[0] }],
      version: Number(source.version) || 0,
      source: source.source || 'manual',
    },
    busy: false,
    ocrText: '',
    controller: null,
  };
  document.getElementById('assessmentChartTitle').value = assessmentChartEditorState.chart.title;
  document.getElementById('assessmentChartSource').value = initialSource === null ? (row.requirement || '') : String(initialSource);
  document.getElementById('assessmentChartInstruction').value = '';
  document.getElementById('assessmentChartAiStatus').textContent = '';
  document.getElementById('assessmentChartError').textContent = '';
  document.getElementById('assessmentChartBodyApply').hidden = true;
  renderAssessmentChartEditorRows();
  assessmentChartEditorRender();
  const dialog = document.getElementById('assessmentChartEditor');
  if (!dialog.open) dialog.showModal();
  document.getElementById('assessmentChartTitle').focus();
}

function closeAssessmentChartEditor() {
  const state = assessmentChartEditorState;
  if (!state) return;
  state.controller?.abort();
  assessmentChartDestroy('editor');
  assessmentChartEditorState = null;
  document.getElementById('assessmentChartEditor')?.close();
}

async function saveAssessmentChartEditor() {
  const state = assessmentChartEditorState;
  if (!state || state.busy) return;
  const error = document.getElementById('assessmentChartError');
  error.textContent = '';
  const prepared = assessmentChartEditorPrepared();
  state.chart.title = document.getElementById('assessmentChartTitle').value.trim();
  if (!state.chart.title) { error.textContent = '请填写图表标题。'; return; }
  if (!prepared.items.length) { error.textContent = '请至少填写一个考核部分的名称和占比。'; return; }
  if (prepared.overflow) { error.textContent = '各部分占比合计不能超过 100%。'; return; }
  const items = prepared.items.map(({ label, percent, detail, color }) => ({ label, percent, detail, color }));
  assessmentChartSetBusy(true, '正在保存图表…');
  try {
    const response = await requestApi(`${API}/courses/${state.courseId}/assessments/${state.assessmentId}/chart`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: state.chart.title, items, expectedVersion: state.chart.version, source: state.chart.source || 'manual' }),
    });
    const chart = await response.json();
    if (state !== assessmentChartEditorState) return;
    const row = assessmentRows.find(item => item.id === state.assessmentId);
    if (row) row.chart = chart;
    assessmentChartSetBusy(false);
    closeAssessmentChartEditor();
    renderAssessments();
    showToast('考核构成图已保存。');
  } catch (err) {
    if (state === assessmentChartEditorState) {
      error.textContent = err.message || '图表保存失败，请重试。';
      assessmentChartSetBusy(false);
    }
  }
}

async function assessmentChartAttachmentText() {
  const state = assessmentChartEditorState;
  if (!state?.fileUrl) throw new Error('当前考核没有可读取的附件。');
  const url = attachmentUrl(state.fileUrl);
  if (!url) throw new Error('附件地址不可用。');
  state.controller?.abort();
  state.controller = new AbortController();
  const response = await fetch(url, { signal: state.controller.signal });
  if (!response.ok) throw new Error('附件读取失败，请确认文件仍存在。');
  const blob = await response.blob();
  const ext = extname(state.fileUrl), base = state.assessmentTitle || '考核附件';
  const name = ext && !base.toLowerCase().endsWith(ext.toLowerCase()) ? base + ext : base;
  const type = state.fileType || blob.type || '';
  if (/^text\//i.test(type) || /\.(txt|md|csv)$/i.test(state.fileUrl)) {
    const text = await blob.text();
    if (!text.trim()) throw new Error('附件没有可用的文字。');
    return text;
  }
  const file = new File([blob], name, { type });
  const result = await recognizeUploadedFile(file, message => assessmentChartSetBusy(true, message), { signal: state.controller.signal });
  if (result.provider === 'mock') throw new Error('当前 OCR 返回模拟结果，未使用；请检查识别服务。');
  if (!String(result.text || '').trim()) throw new Error('没有从附件识别到文字。');
  const warnings = (result.warnings || []).join('；');
  if (warnings) document.getElementById('assessmentChartAiStatus').textContent = warnings;
  return result.text;
}

async function assessmentChartAiRequest(action, sourceText, fromFile = false) {
  const state = assessmentChartEditorState;
  if (!state || state.busy) return;
  if (!assessmentChartAiReady()) {
    document.getElementById('assessmentChartAiStatus').textContent = '请先在 AI 设置中配置真实 API。';
    return;
  }
  const source = String(sourceText || '').trim();
  if (action === 'extract' && !source) {
    document.getElementById('assessmentChartAiStatus').textContent = '请先填写考核正文或识别附件。';
    return;
  }
  if (source.length > 8000) {
    document.getElementById('assessmentChartAiStatus').textContent = 'AI 提取最多读取 8000 字，请缩短来源文字；手动图表不受影响。';
    return;
  }
  const prepared = assessmentChartEditorPrepared();
  const current = prepared.items.map(({ label, percent, detail }) => ({ label, percent, detail: detail.slice(0, 200) }));
  if (action === 'edit' && !current.length) {
    document.getElementById('assessmentChartAiStatus').textContent = '请先填写至少一个图表部分，再让 AI 整理。';
    return;
  }
  let credentials;
  state.controller?.abort();
  state.controller = new AbortController();
  assessmentChartSetBusy(true, fromFile ? '正在读取附件并生成图表草稿…' : '正在请求 AI 生成图表草稿…');
  try {
    credentials = coursesAiSettings.read();
    const endpoint = new URL((globalThis.COURSES_AI_API_BASE ?? API).replace(/\/$/, '') + '/ai/assessment-chart', location.href);
    if (endpoint.origin !== location.origin) throw new Error('AI 接口地址不安全。');
    const body = JSON.stringify({
      provider: credentials.provider || 'deepseek', input: {
        action, title: document.getElementById('assessmentChartTitle').value.trim() || state.assessmentTitle,
        source, instruction: document.getElementById('assessmentChartInstruction').value.trim(), current,
      },
      api_key: credentials.apiKey, model: credentials.model, confirm_cost: credentials.confirmCost,
      ...(credentials.provider === 'compatible' ? {
        base_url: credentials.baseUrl, ...(credentials.workspaceId ? { workspace_id: credentials.workspaceId } : {}),
      } : {}),
    });
    if (new TextEncoder().encode(body).byteLength > 32000) throw new Error('本次 AI 输入过长，请缩短来源文字或部分说明。');
    credentials.apiKey = '';
    const release = coursesAiSettings.track(credentials, () => state.controller.abort());
    const timer = setTimeout(() => state.controller.abort(), 100000);
    try {
      const response = await fetch(endpoint.href, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body, signal: state.controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (state !== assessmentChartEditorState) return;
      if (!response.ok) throw new Error(data?.error || 'AI 图表生成失败，请重试。');
      const result = data?.result;
      if (!result || typeof result.title !== 'string' || !Array.isArray(result.items)) throw new Error('AI 返回的图表格式无效。');
      if (action === 'edit' && !result.items.length) throw new Error('AI 没有返回可用的图表部分，原图保持不变。');
      const oldColors = new Map(state.chart.items.map(item => [item.label.trim().toLocaleLowerCase('zh-CN'), item.color]));
      if (result.items.length) {
        state.chart.items = result.items.slice(0, 30).map((item, index) => ({
          label: String(item.label || '').slice(0, 80), percent: assessmentChartPercent(item.percent),
          detail: String(item.detail || '').slice(0, 500),
          color: oldColors.get(String(item.label || '').trim().toLocaleLowerCase('zh-CN'))
            || ASSESSMENT_CHART_PALETTE[index % ASSESSMENT_CHART_PALETTE.length],
        }));
      }
      state.chart.title = result.title.trim().slice(0, 120) || state.chart.title;
      state.chart.source = 'ai';
      document.getElementById('assessmentChartTitle').value = state.chart.title;
      renderAssessmentChartEditorRows();
      assessmentChartEditorRender();
      const preparedAfter = assessmentChartEditorPrepared();
      document.getElementById('assessmentChartAiStatus').textContent = result.items.length
        ? `AI 草稿已填入，尚未保存。${assessmentChartSumText(preparedAfter)}`
        : 'AI 没有找到明确占比；原图保持不变。可手动填写或补充更清楚的来源。';
    } finally {
      clearTimeout(timer);
      release();
    }
  } catch (err) {
    if (state === assessmentChartEditorState) {
      document.getElementById('assessmentChartAiStatus').textContent = err.name === 'AbortError'
        ? '已取消 AI 请求，图表草稿保持不变。' : assessmentChartAiErrorMessage(err);
    }
  } finally {
    if (credentials) credentials.apiKey = '';
    if (state === assessmentChartEditorState) assessmentChartSetBusy(false);
  }
}

async function assessmentChartAiFromFile() {
  const state = assessmentChartEditorState;
  if (!state || state.busy) return;
  if (!assessmentChartAiReady()) {
    document.getElementById('assessmentChartAiStatus').textContent = '请先在 AI 设置中配置真实 API。';
    return;
  }
  try {
    assessmentChartSetBusy(true, '正在使用现有 OCR/文本读取能力解析附件…');
    const text = await assessmentChartAttachmentText();
    if (state !== assessmentChartEditorState) return;
    state.ocrText = text;
    document.getElementById('assessmentChartSource').value = text;
    document.getElementById('assessmentChartBodyApply').hidden = false;
    assessmentChartSetBusy(false);
    await assessmentChartAiRequest('extract', text, true);
  } catch (err) {
    if (state === assessmentChartEditorState) {
      if (err.name !== 'AbortError') document.getElementById('assessmentChartAiStatus').textContent = err.message;
      assessmentChartSetBusy(false);
    }
  }
}

async function assessmentChartApplyBody(mode) {
  const state = assessmentChartEditorState;
  if (!state || state.busy) return;
  const text = document.getElementById('assessmentChartSource').value.trim();
  if (!text) return;
  if (mode === 'replace' && !await showConfirm('用识别文字替换当前考核正文？原附件不会被修改，图表也不会自动保存。', '替换考核正文')) return;
  const requirement = mode === 'append' && state.originalRequirement.trim()
    ? state.originalRequirement.replace(/\s+$/, '') + '\n\n' + text
    : text;
  if (requirement.length > 20000) {
    document.getElementById('assessmentChartAiStatus').textContent = '考核正文最多 20000 字，请精简后再应用。';
    return;
  }
  assessmentChartSetBusy(true, '正在保存考核正文…');
  try {
    await requestApi(`${API}/courses/${state.courseId}/assessments/${state.assessmentId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requirement }),
    });
    if (state !== assessmentChartEditorState) return;
    state.originalRequirement = requirement;
    const row = assessmentRows.find(item => item.id === state.assessmentId);
    if (row) row.requirement = requirement;
    document.getElementById('assessmentChartBodyApply').hidden = true;
    document.getElementById('assessmentChartAiStatus').textContent = mode === 'append' ? '识别文字已追加到考核正文。' : '考核正文已替换。';
    renderAssessments();
  } catch (err) {
    if (state === assessmentChartEditorState) document.getElementById('assessmentChartAiStatus').textContent = err.message || '考核正文保存失败。';
  } finally {
    if (state === assessmentChartEditorState) assessmentChartSetBusy(false);
  }
}

function assessmentChartBindEditor() {
  const dialog = document.getElementById('assessmentChartEditor');
  if (!dialog || dialog.dataset.bound) return;
  dialog.dataset.bound = '1';
  document.getElementById('assessmentChartTitle').oninput = event => {
    if (!assessmentChartEditorState) return;
    assessmentChartEditorState.chart.title = event.target.value;
    assessmentChartEditorRender();
  };
  document.getElementById('assessmentChartSource').oninput = assessmentChartRefreshAiAvailability;
  document.getElementById('assessmentChartAddRow').onclick = assessmentChartAddRow;
  document.getElementById('assessmentChartClose').onclick = closeAssessmentChartEditor;
  document.getElementById('assessmentChartCancel').onclick = closeAssessmentChartEditor;
  document.getElementById('assessmentChartSave').onclick = () => void saveAssessmentChartEditor();
  document.getElementById('assessmentChartAiBody').onclick = () => void assessmentChartAiRequest('extract', document.getElementById('assessmentChartSource').value);
  document.getElementById('assessmentChartAiFile').onclick = () => void assessmentChartAiFromFile();
  document.getElementById('assessmentChartAiEdit').onclick = () => void assessmentChartAiRequest('edit', document.getElementById('assessmentChartSource').value);
  document.getElementById('assessmentChartBodyReplace').onclick = () => void assessmentChartApplyBody('replace');
  document.getElementById('assessmentChartBodyAppend').onclick = () => void assessmentChartApplyBody('append');
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeAssessmentChartEditor();
  });
}

// Explicit bridge for shared AI settings, which may refresh while the editor is open.
globalThis.refreshAssessmentChartAiAvailability = assessmentChartRefreshAiAvailability;

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', assessmentChartBindEditor, { once: true });
else assessmentChartBindEditor();
