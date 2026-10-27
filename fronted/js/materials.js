/*
 * materials.js
 * 资料 Tab：列表 + 上传
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

/* ========== 资料 ========== */
let materialListRequest = 0;
async function loadMaterials() {
 const request=++materialListRequest,courseId=currentCourseId,box=document.getElementById('materialList');box.innerHTML='<div class="loading-tip">加载中…</div>';
 try{
  if(resourceSelectionCourse!==courseId){resourceSelectionCourse=courseId;resourceSelection.clear();resourceTypeFilter='';}
  const query=readingBrowseQuery('materials');
  const [materials,notes]=await Promise.all([requestList(API+'/courses/'+courseId+'/materials'+query),requestList(API+'/courses/'+courseId+'/notes'+query),loadResourceTypes(courseId)]);
  if(request!==materialListRequest||currentCourseId!==courseId)return;
  currentMaterials=materials;currentNotes=notes;
  if(resourceTypeFilter&&resourceTypeFilter!=='unclassified'&&!resourceTypeDefinitions.some(type=>String(type.id)===resourceTypeFilter))resourceTypeFilter='';
  const all=[...materials.map(r=>({...r,resourceKind:'material'})),...notes.map(r=>({...r,resourceKind:'note'}))].sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id-a.id);
  const rows=all.filter(row=>!resourceTypeFilter||(resourceTypeFilter==='unclassified'?!(row.resource_types||[]).length:(row.resource_types||[]).some(t=>String(t.id)===resourceTypeFilter)));
  unifiedResourceRows=rows;loadReadingBrowseTags('materials');
  let host=document.getElementById('resourceTypeFilters');if(!host){host=document.createElement('div');host.id='resourceTypeFilters';box.before(host);}host.innerHTML=resourceTypeFiltersHtml();
  box.innerHTML=rows.length?rows.map(row=>{const kind=row.resourceKind,collection=kind==='note'?'notes':'materials';return `<div class="item-row content-card card-openable" data-resource-kind="${kind}" role="link" tabindex="0" aria-label="查看资料：${escapeHtml(row.title)}" onclick="openReadingCard(event,'${kind}',${row.id})" onkeydown="openReadingCardKey(event,'${kind}',${row.id})">
   <label class="resource-select" onclick="event.stopPropagation()"><input data-resource-select type="checkbox" aria-label="选择：${escapeHtml(row.title)}" ${resourceSelection.has(kind+':'+row.id)?'checked':''} onchange="selectResource('${kind}',${row.id},this.checked)"></label>
   <div class="info"><div class="title">${escapeHtml(row.title)}</div><div class="resource-badge-row">${resourceTypesHtml(row,true)}<span class="material-review-badge">${row.review_status==='reviewed'?'已复习':'未复习'}</span></div><div class="meta">${row.file_url?'📄 文件':'✍ 手动输入'} · ${escapeHtml(row.created_at)}</div>${row.content?'<div class="row-content">'+escapeHtml(row.content)+'</div>':''}<div class="mistake-tags">${nodeChipsHtml(row)}</div></div>
   <div class="mistake-actions">${readingFavoriteButton(collection,row)}<button onclick="event.stopPropagation();openTagPicker('edit','${kind}',${row.id})">编辑</button><button onclick="event.stopPropagation();delItem('${collection}',${row.id},loadMaterials)">删除</button></div></div>`;}).join(''):'<div class="empty">没有符合条件的资料</div>';
 }catch(error){if(request===materialListRequest&&courseId===currentCourseId)showListError(box,error);}
}

// 选完文件先弹标签选择器，确认后再真正上传
async function uploadMaterial() {
  const fileInput = document.getElementById('materialFile');
  const file = fileInput.files[0];
  if (!file) return;

  pendingUploadFile = file;
  fileInput.value = ''; // 清空选择框，方便再次选择同一个文件
  openTagPicker('upload', 'material', null);
}

// 真正上传资料：file + nodeIds（title 是用户改过的名字，为空则后端用文件名）
async function doUploadMaterial(file, nodeIds, title, content = '') {
  const uploadBtn = document.querySelector('#pane-materials .upload-btn');
  const originalText = uploadBtn.textContent;
  uploadBtn.textContent = '上传中…';
  uploadBtn.disabled = true;

  const fd = new FormData();
  if (file) fd.append('file', file);
  if (title) fd.append('title', title);
  if (content) fd.append('content', content);
  fd.append('nodeIds', JSON.stringify(nodeIds));
  fd.append('typeIds',JSON.stringify(selectedPickerResourceTypes()));
  const outline = document.getElementById('tagPickerOutline')?.value || '';
  if (outline.trim()) fd.append('outline', outline);
  if (pendingMindmapJson) fd.append('mindmapJson', pendingMindmapJson);
  if (pendingMindmapImage) fd.append('mindmapImage', pendingMindmapImage);

  try {
    const res = await fetch(`${API}/courses/${currentCourseId}/materials`, {
      method: 'POST',
      body: fd
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || '上传失败');
    }

    const created = await res.json().catch(() => null);
    if (!created?.id) throw new Error('保存成功但未返回资料记录，请在列表中核对后再操作');
    showToast('上传成功');
    await loadMaterials();
    return created;
  } catch (err) {
    console.error('上传资料失败:', err);
    showToast(err.message || '上传失败，请重试');
    return false;
  } finally {
    uploadBtn.textContent = originalText;
    uploadBtn.disabled = false;
  }
}
