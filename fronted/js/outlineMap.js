const OUTLINE_MAP={current:null,currentTitle:""};

// Fullscreen uses the same readonly renderer, never a reconstructed tree.
function openOutlineFullscreen(){
 const overlay=document.getElementById('outlineFullscreen'),body=document.getElementById('outlineFullscreenBody');if(!overlay||!body)return;
 if(resourceDetailRow?.mindmap_json)previewCourseMindmap(body,resourceDetailRow.mindmap_json);
 else{const image=document.querySelector('#resourceDetailOutlineMap img');body.replaceChildren(image?image.cloneNode():Object.assign(document.createElement('p'),{textContent:'还没有思维导图'}));}
 overlay.classList.add('show');
}
function closeOutlineFullscreen(){const overlay=document.getElementById('outlineFullscreen');if(overlay){overlay.classList.remove('show');document.getElementById('outlineFullscreenBody')?.replaceChildren();}}

// 把导图数据摊回缩进文本，好复用上面的 SVG 渲染
function mindmapToOutline(map) {
  // 平铺导图（flat + edges）：节点都在顶层，关系靠连线。
  // 预览时取连接最多的那个当中心，其余作为它的子节点，保证所有节点都能显示。
  if (map && map.flat === true && Array.isArray(map.nodes) && Array.isArray(map.edges)) {
    const degree = new Map();
    const bump = (id) => degree.set(id, (degree.get(id) || 0) + 1);
    for (const edge of map.edges) {
      if (edge?.from?.node) bump(edge.from.node);
      if (edge?.to?.node) bump(edge.to.node);
    }
    const ranked = [...map.nodes].sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0));
    const center = ranked[0];
    if (center) {
      const lines = [`- ${String(center.text || '').replace(/\s*\n+\s*/g, ' ').trim() || '思维导图'}`];
      for (const node of map.nodes) {
        if (node === center) continue;
        const text = String(node.text || '').replace(/\s*\n+\s*/g, ' ').trim();
        if (text) lines.push(`  - ${text}`);
      }
      if (lines.length > 1) return lines.join('\n');
    }
  }
  const root = Array.isArray(map?.nodes) ? map.nodes[0] : null;
  if (!root) return '';
  const lines = [];
  const walk = (node, depth) => {
    const text = String(node.text || '').replace(/\s*\n+\s*/g, ' ').trim();
    if (text) lines.push(`${'  '.repeat(depth)}- ${text}`);
    (node.children || []).forEach((child) => walk(child, depth + 1));
  };
  walk(root, 0);
  return lines.join('\n');
}

function countMindmapNodes(map) {
  let count = 0;
  const walk = (node) => {
    count += 1;
    (node.children || []).forEach(walk);
  };
  (Array.isArray(map?.nodes) ? map.nodes : []).forEach(walk);
  return count;
}

// 下载导图 JSON，交给导图工具导入
function downloadMindmapJson(mapJson, title) {
  let map = null;
  try { map = typeof mapJson === 'string' ? JSON.parse(mapJson) : mapJson; } catch { map = null; }
  if (!map || !Array.isArray(map.nodes)) { showToast('没有可下载的导图数据'); return; }
  const safe = String(title || map.title || '思维导图').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  const blob = new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safe}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('已下载导图 JSON，可在导图工具里导入');
}

// Canvas assets are bundled into this website.
const MINDMAP_APP_URL = '/mindmap/';

let mindmapGenerationBusy = false;

function mindmapAiReady() {
  return typeof coursesAiSettings !== 'undefined'
    && typeof coursesAiSettings.realReady === 'function'
    && coursesAiSettings.realReady();
}

function refreshMindmapAiAvailability() {
  const ready = mindmapAiReady();
  for (const button of document.querySelectorAll('[data-resource-outline-ai]')) button.disabled = !ready;
  const outlineStatus = document.getElementById('resourceDetailOutlineStatus');
  if (outlineStatus) outlineStatus.textContent = ready
    ? 'AI 结果会在编辑窗口中预览，核对后点击保存；可能计费。'
    : '手动编辑大纲可直接使用；AI 生成需要先在“AI 设置”中配置服务和 Key。';
  if (typeof refreshPickerOutlineAvailability === 'function') refreshPickerOutlineAvailability();
  for (const id of ['tagPickerMindmapAiNote', 'resourceDetailMindmapAiNote']) {
    const note = document.getElementById(id);
    if (!note) continue;
    note.textContent = ready
      ? '使用导图模块的完整生成、分组与整理流程；提交前可核对材料，生成后保存回资料。'
      : '手工编辑无需 AI；生成导图请先在顶栏 AI 设置中配置模型。';
    note.classList.toggle('mindmap-ai-unavailable', !ready);
  }
}

function setMindmapGenerationBusy(busy) {
  mindmapGenerationBusy = !!busy;
  refreshMindmapAiAvailability();
}

async function requestAiMindmapOutline(text, title = '', options = {}) {
  if (!mindmapAiReady()) {
    throw new Error('请先在顶栏 AI 设置中配置模型，再生成大纲。');
  }
  const credentials = coursesAiSettings.read();
  if (!credentials) throw new Error('没有可用的真实 AI 设置');
  const endpoint = new URL((globalThis.COURSES_AI_API_BASE ?? API).replace(/\/$/, '') + '/ai/outline-polish', location.href);
  if (endpoint.origin !== location.origin || endpoint.username || endpoint.password
    || !(endpoint.protocol === 'https:'
      || endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))) {
    throw mistakeAiError('AI_TEMP_KEY_ORIGIN');
  }
  let body = JSON.stringify({
    provider: credentials.provider || 'deepseek',
    api_key: credentials.apiKey,
    model: credentials.model,
    confirm_cost: credentials.confirmCost,
    ...(credentials.provider === 'compatible' ? {
      base_url: credentials.baseUrl,
      ...(credentials.workspaceId ? { workspace_id: credentials.workspaceId } : {}),
    } : {}),
    input: { title, text },
    ...(options.purpose === 'outline_draft' ? { purpose: 'outline_draft' } : {}),
  });
  credentials.apiKey = '';
  if (new TextEncoder().encode(body).length > 2*1024*1024) {
    body = '';
    throw new Error('大纲内容过长，请精简后再使用 AI 润色');
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 100000);
  const release = coursesAiSettings.track(credentials, () => controller.abort());
  try {
    const response = await fetch(endpoint.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!coursesAiSettings.valid(credentials)) throw Object.assign(new Error('请求已取消'), { name: 'AbortError' });
    if (!response.ok) throw mistakeAiError(data?.error, response.status);
    const result = data?.result;
    if (data?.provider !== (credentials.provider || 'deepseek')
      || !result || typeof result.outline !== 'string' || !result.outline.trim()
      || result.needs_review !== true) {
      throw mistakeAiError('INVALID_RESPONSE');
    }
    return {
      title: typeof result.title === 'string' && result.title.trim() ? result.title.trim() : title,
      outline: result.outline.trim(),
      source: 'ai',
    };
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('AI 润色已取消或超时');
    throw err;
  } finally {
    body = '';
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    release();
  }
}

// The course supplies inputs; the upstream module owns generation and layout.
async function openMindmapEditor(mapJson,title,outline,options={}){
 const target=window.__mindmapTarget;if(!target){showToast('请从资料详情进入');return;}
 const source={...target},collection=source.resourceType==='note'?'notes':'materials';
 const map=mapJson?JSON.parse(mapJson):null,expected=source.baseline?.mindmap_json||'';
 showCourseMindmap(map,{title:title||'思维导图',replacing:!!options.regenerate,source:{title,text:options.text||'',outline,attachment:options.attachment,generate:!!options.generate},onSave:async value=>{
  if(currentCourseId!==source.courseId)throw Error('课程已切换，未保存到其他课程');
  await requestApi(API+'/courses/'+source.courseId+'/'+collection+'/'+source.id+'/mindmap',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({mindmapJson:JSON.stringify(value),mindmapImage:'',expectedMindmapJson:expected})});
  showToast('导图已保存到资料');if(currentView.type==='resource'&&currentView.resourceType===source.resourceType&&currentView.id===source.id)await renderResourceDetailPage(source.resourceType,source.id);
 }});
}

async function removeResourceMindmap(resourceType,item,button){
 if(!confirm('移除这份资料关联的导图？正文、大纲和附件会保留；导图工作台中的文件也会保留。'))return;
 const courseId=currentCourseId,collection=resourceType==='note'?'notes':'materials';
 if(button)button.disabled=true;
 try{
  await requestApi(API+'/courses/'+courseId+'/'+collection+'/'+item.id+'/mindmap',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({mindmapJson:'',mindmapImage:'',expectedMindmapJson:item.mindmap_json||''})});
  if(currentCourseId===courseId&&currentView.type==='resource'&&currentView.resourceType===resourceType&&currentView.id===item.id)await renderResourceDetailPage(resourceType,item.id);
  showToast('已移除导图，正文、大纲和附件保留');
 }catch(error){showToast('移除失败：'+error.message);}finally{if(button)button.disabled=false;}
}

let mindmapReturnRefresh = null;
async function refreshActiveMindmapResource() {
  const target = window.__mindmapTarget;
  if (!target?.baseline || document.visibilityState === 'hidden'
    || currentCourseId !== target.courseId || currentView.type !== 'resource'
    || currentView.id !== target.id || currentView.resourceType !== target.resourceType) return false;
  if (mindmapReturnRefresh) return mindmapReturnRefresh;
  mindmapReturnRefresh = (async () => {
    try {
      const path = target.resourceType === 'note' ? 'notes' : 'materials';
      const response = await requestApi(`${API}/${path}/${target.id}`);
      const row = await response.json();
      if (!row || row.course_id !== currentCourseId || currentView.type !== 'resource' || currentView.id !== target.id) return false;
      const before = target.baseline;
      const changed = ['mindmap_json', 'mindmap_image', 'outline'].some(key => String(row[key] || '') !== String(before[key] || ''));
      if (!changed) return false;
      const list = target.resourceType === 'note' ? currentNotes : currentMaterials;
      const index = list.findIndex(item => item.id === target.id);
      if (index >= 0) list[index] = {...list[index], ...row};
      target.baseline = {mindmap_json:row.mindmap_json || '',mindmap_image:row.mindmap_image || '',outline:row.outline || ''};
      renderResourceDetail(target.resourceType, row);
      if (typeof mountReviewPreparation === 'function') {
        mountReviewPreparation(document.getElementById('resourceDetailTags'), target.resourceType, row);
      }
      showToast('导图已自动更新');
      return true;
    } catch {
      return false;
    } finally {
      mindmapReturnRefresh = null;
    }
  })();
  return mindmapReturnRefresh;
}
function scheduleMindmapReturnRefresh() {
  if (document.visibilityState === 'hidden') return;
  void refreshActiveMindmapResource();
  setTimeout(() => { void refreshActiveMindmapResource(); }, 700);
}
window.addEventListener('focus', scheduleMindmapReturnRefresh);
window.addEventListener('pageshow', scheduleMindmapReturnRefresh);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleMindmapReturnRefresh();
});

// 把她那边编辑/导出的文件传回来，更新当前资料/笔记的导图
function reuploadMindmap(resourceType, id) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json,image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const payload = {};
      try {
        if (/json$/i.test(file.type) || /\.json$/i.test(file.name)) {
          const map = JSON.parse(String(reader.result || ''));
          if (!Array.isArray(map.nodes)) throw new Error('JSON 里没有 nodes');
          payload.mindmapJson = JSON.stringify(map);
        } else {
          payload.mindmapImage = String(reader.result || '');
        }
        const path = resourceType === 'note' ? 'notes' : 'materials';
        await requestApi(`${API}/courses/${currentCourseId}/${path}/${id}/mindmap`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        showToast('导图已更新');
        openResourceDetail(resourceType, id);
      } catch (err) {
        showToast('上传失败：' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}
