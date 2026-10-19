// 使用 regression.cjs 的隔离 HTTP 服务和 Chrome，覆盖编辑弹窗实际布局与保存。
function mistakeEditBrowserScenario(data) {
  return `
    {
    switchTab('mistakes');
    await openMistakeCategory('knowledge'); await clearMistakeFilters();
    const editApi = async (url, method, body) => (await requestApi(API + url, {
      method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
    })).json();
    const coursePath = '/courses/' + currentCourseId;
    const folder = await editApi(coursePath + '/knowledge-nodes', 'POST', {name:'中文分类 Algebra 123',type:'folder'});
    const nested = await editApi(coursePath + '/knowledge-nodes', 'POST', {name:'第二层 456',type:'folder',parentId:folder.id});
    const leaf = await editApi(coursePath + '/knowledge-nodes', 'POST', {name:'中文 English 789 <标签>',type:'knowledge',parentId:nested.id});
    const long = await editApi(coursePath + '/knowledge-nodes', 'POST', {name:'LongName123'.repeat(18),type:'knowledge',parentId:nested.id});
    for (let i = 0; i < 14; i++) await editApi(coursePath + '/knowledge-nodes', 'POST', {name:'滚动标签 ' + i,type:'knowledge',parentId:folder.id});
    const form = new FormData();
    form.set('title','弹窗测试题'); form.set('content','原题目'); form.set('mistakeType','knowledge');
    form.set('answerContent','原答案'); form.set('explanation','原解析');
    form.set('knowledgeIds', JSON.stringify([leaf.id]));
    const row = await (await requestApi(API + coursePath + '/mistakes', {method:'POST',body:form})).json();
    const reviewPath = coursePath + '/mistakes/' + row.id + '/review';
    let progress = await (await requestApi(API + reviewPath)).json();
    for (const step of [{action:'start'}, {action:'recall',recall:'clear'}, {action:'judge',correct:true}]) {
      progress = await editApi(reviewPath + (step.action === 'start' ? '' : '/events'), 'POST', {
        ...step,requestId:crypto.randomUUID(),expectedVersion:progress.version
      });
    }
    await editApi(coursePath + '/mistakes/' + row.id,'PATCH',{favorite:true});
    document.getElementById('mistakeSearch').value = '弹窗测试';
    document.getElementById('mistakeFavoriteFilter').checked = true;
    document.getElementById('mistakeStatusFilter').value = 'reviewed';
    await changeMistakeTagFilter(leaf.id,true);
    check(currentMistakes.length === 1 && currentMistakes[0].id === row.id, 'edit fixture filtered');
    const viewBefore = currentView, navBefore = JSON.stringify(navStack), filtersBefore = JSON.stringify(mistakeUi);
    const rememberedBefore = localStorage.getItem('mistake-detail:' + currentCourseId);
    const spacer = document.createElement('div'); spacer.style.height = '1600px';
    document.getElementById('pane-mistakes').appendChild(spacer);
    window.scrollTo(0,450); const scrollBefore = window.scrollY;
    check(scrollBefore > 0, 'fixture has nonzero list scroll');
    document.querySelector('[data-mistake-id="' + row.id + '"] .mistake-actions button:nth-child(2)').click();
    await waitUntil(() => document.querySelector('#mistakeEditTagTree .edit-tag-name'), 'list edit loaded tree');
    await new Promise(resolve => setTimeout(resolve,350));
    // 无界面浏览器的虚拟计时器可能先于合成动画推进；在量布局前完成已有打开动画。
    document.getElementById('mistakeEditModal').getAnimations({subtree:true}).forEach(animation => animation.finish());
    check(currentView === viewBefore && JSON.stringify(navStack) === navBefore, 'list edit does not navigate');
    check(localStorage.getItem('mistake-detail:' + currentCourseId) === rememberedBefore, 'list edit does not persist detail location');
    check(document.getElementById('detailPage').style.display === 'block' && document.getElementById('mistakeDetailPage').style.display === 'none', 'list remains behind modal');
    check(document.getElementById('mistakeEditTitle').value === row.title
      && document.getElementById('mistakeEditType').value === row.mistake_type
      && document.getElementById('mistakeEditContent').value === row.content
      && document.getElementById('mistakeEditAnswer').value === row.answer_content
      && document.getElementById('mistakeEditExplanation').value === row.explanation, 'all original fields populated');
    const modal = document.getElementById('mistakeEditModal');
    const tree = document.getElementById('mistakeEditTagTree');
    const body = document.getElementById('mistakeEditBody');
    const names = [...tree.querySelectorAll('.edit-tag-name')];
    check(names.some(el => el.textContent.includes(leaf.name)), 'Chinese English numeric escaped name exists in DOM');
    for (const name of names) {
      const rect = name.getBoundingClientRect(), style = getComputedStyle(name);
      check(rect.width > 80 && style.visibility === 'visible' && style.display !== 'none' && style.opacity === '1',
        'node name has visible width: ' + name.textContent + ' ' + JSON.stringify({width:rect.width,visibility:style.visibility,display:style.display,opacity:style.opacity,checkbox:getComputedStyle(name.previousElementSibling).width,tree:tree.clientWidth}));
      check(rect.right <= tree.getBoundingClientRect().right + 1, 'node name fits tree');
    }
    check(tree.scrollWidth <= tree.clientWidth + 1, 'long label wraps without horizontal clipping');
    const checkbox = tree.querySelector('.edit-tag-check');
    check(checkbox.getBoundingClientRect().width <= 20, 'checkbox keeps compact width');
    // 精确重放原有宽度规则：证实文字仍在 DOM，但被不可收缩的满宽复选框挤出。
    const oldRule = document.createElement('style');
    oldRule.textContent = '#mistakeEditModal input:not([type="file"]) {width:100%;padding:11px 12px;border:1px solid #dbe0ea;box-sizing:border-box;}';
    document.head.appendChild(oldRule);
    check(tree.querySelector('.edit-tag-name').getBoundingClientRect().width < 1
      && checkbox.getBoundingClientRect().width > 100, 'original CSS reproduces lost name space');
    oldRule.remove();
    const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
    check(ids.length === new Set(ids).size, 'no duplicate element IDs');
    check(document.getElementById('mistake-edit-tagchk-' + leaf.id).checked, 'original tag checked');
    const head = modal.querySelector('.tag-sheet-head'), foot = modal.querySelector('.tag-sheet-foot');
    const headTop = head.getBoundingClientRect().top, footTop = foot.getBoundingClientRect().top;
    check(headTop >= 0 && foot.getBoundingClientRect().bottom <= innerHeight + 1, 'edit header and footer fit viewport');
    check(body.scrollWidth <= body.clientWidth + 1, 'edit form fits viewport');
    body.scrollTop = body.scrollHeight;
    check(body.scrollTop > 0 && Math.abs(head.getBoundingClientRect().top - headTop) < 1
      && Math.abs(foot.getBoundingClientRect().top - footTop) < 1, 'edit content scroll retains title and save');
    tree.scrollTop = tree.scrollHeight; check(tree.scrollTop > 0, 'tag tree independently scrolls');
    toggleAllMistakeEditTags(false);
    check(!document.getElementById('mistake-edit-tagchk-' + leaf.id), 'collapse hides descendants');
    tree.querySelector('.edit-tag-toggle').click();
    toggleAllMistakeEditTags(true);
    check(document.getElementById('mistake-edit-tagchk-' + leaf.id), 'expand restores descendants');
    toggleAllMistakeEditTags(false);
    const search = document.getElementById('mistakeEditTagSearch');
    search.value = 'english 789'; search.dispatchEvent(new Event('input'));
    check(tree.textContent.includes(leaf.name) && tree.textContent.includes(folder.name)
      && tree.textContent.includes(nested.name) && !tree.textContent.includes(long.name), 'search retains ancestor path and auto expands');
    document.getElementById('mistake-edit-tagchk-' + leaf.id).click();
    check(!mistakeEditPending.tags.some(t => t.id === leaf.id), 'uncheck removes selected tag');
    tree.querySelectorAll('.edit-tag-name')[2].click();
    check(mistakeEditPending.tags.some(t => t.id === leaf.id), 'name click selects tag');
    search.value = 'no-such-label'; search.dispatchEvent(new Event('input'));
    check(tree.textContent.includes('没有匹配') && mistakeEditPending.tags.some(t => t.id === leaf.id), 'empty search preserves selection');
    document.getElementById('mistakeEditTitle').value = '应取消的名称';
    document.getElementById('mistakeEditAnswer').value = '应取消的答案';
    modal.querySelector('.btn-cancel').click();
    check(!mistakeEditPending && window.scrollY === scrollBefore && JSON.stringify(mistakeUi) === filtersBefore, 'cancel preserves list filters and scroll');
    let stored = await (await requestApi(API + '/mistakes/' + row.id)).json();
    check(stored.title === row.title && stored.answer_content === row.answer_content && stored.review_status === 'reviewed', 'cancel does not mutate data');

    await editMistakeFromList(row.id);
    document.getElementById('mistakeEditTitle').value = '弹窗测试已更名';
    toggleMistakeEditTag(folder.id,true);
    const realFetch = window.fetch;
    const patches = [];
    let failPatch = true;
    window.fetch = async (url, options) => {
      if (options?.method === 'PATCH' && String(url).endsWith('/mistakes/' + row.id)) {
        patches.push(JSON.parse(options.body));
        if (failPatch) return new Response(JSON.stringify({message:'隔离测试保存失败'}),{status:503,headers:{'Content-Type':'application/json'}});
      }
      return realFetch(url,options);
    };
    await saveMistakeDetail();
    check(mistakeEditPending && modal.classList.contains('show')
      && document.getElementById('mistakeEditTitle').value === '弹窗测试已更名'
      && mistakeEditPending.tags.some(t => t.id === folder.id)
      && document.getElementById('mistakeEditError').textContent.includes('输入已保留'), 'save failure preserves fields and tags');
    failPatch = false;
    await Promise.all([saveMistakeDetail(),saveMistakeDetail()]);
    window.fetch = realFetch;
    check(patches.length === 2 && patches[1].expectedRevision === stored.review_revision, 'single PATCH per save with original revision');
    check(!mistakeEditPending && currentMistakes[0].title === '弹窗测试已更名', 'success closes and updates list');
    check(currentView === viewBefore && JSON.stringify(mistakeUi) === filtersBefore && window.scrollY === scrollBefore, 'save preserves category search filters and scroll');
    stored = await (await requestApi(API + '/mistakes/' + row.id)).json();
    check(stored.knowledge.some(t => t.id === folder.id) && stored.knowledge.some(t => t.id === leaf.id), 'tags persisted');
    check(stored.review_revision === row.review_revision && stored.review_status === 'reviewed', 'title and tag changes retain review');
    await editMistakeFromList(row.id);
    document.getElementById('mistakeEditTitle').value = '弹窗测试字段更新';
    document.getElementById('mistakeEditType').value = 'thinking';
    document.getElementById('mistakeEditContent').value = '更新题目';
    document.getElementById('mistakeEditAnswer').value = '更新答案';
    document.getElementById('mistakeEditExplanation').value = '更新解析';
    await saveMistakeDetail();
    stored = await (await requestApi(API + '/mistakes/' + row.id)).json();
    check(stored.title === '弹窗测试字段更新' && stored.mistake_type === 'thinking' && stored.content === '更新题目'
      && stored.answer_content === '更新答案' && stored.explanation === '更新解析', 'all text and category fields PATCH correctly');
    check(stored.review_status === 'unreviewed' && stored.review_revision === row.review_revision + 1, 'substantive edits reset review once through backend');
    check(currentMistakes.length === 0 && JSON.stringify(mistakeUi) === filtersBefore && window.scrollY === scrollBefore, 'moved category removes row without clearing filters or scroll');
    spacer.remove(); window.scrollTo(0,0); await clearMistakeFilters(); await openMistakeCategory('thinking');
    document.querySelector('[data-mistake-id="' + row.id + '"] .info').click();
    await waitUntil(() => mistakeDetailState?.row?.id === row.id && currentView.type === 'mistake', 'ordinary card opens detail');
    await openMistakeEdit(); document.getElementById('mistakeEditExplanation').value = '详情入口更新';
    await saveMistakeDetail();
    check(mistakeDetailState.row.explanation === '详情入口更新' && currentView.type === 'mistake', 'same dialog saves from detail');
    const selectFile = (id,name) => {
      const input = document.getElementById(id), files = new DataTransfer();
      files.items.add(new File(['%PDF-isolated-edit-test'],name,{type:'application/pdf'}));
      input.files = files.files; input.dispatchEvent(new Event('change'));
    };
    await openMistakeEdit();
    selectFile('mistakeEditQuestionUpload','原题.pdf'); selectFile('mistakeEditAnswerUpload','原答案.pdf');
    closeMistakeEdit();
    stored = await (await requestApi(API + '/mistakes/' + row.id)).json();
    check(!stored.image_url && !stored.answer_image_url, 'cancel selected files does not upload');
    await openMistakeEdit();
    selectFile('mistakeEditQuestionUpload','原题.pdf'); selectFile('mistakeEditAnswerUpload','原答案.pdf');
    const beforeFilesRevision = stored.review_revision;
    await saveMistakeDetail();
    stored = await (await requestApi(API + '/mistakes/' + row.id)).json();
    check(stored.image_url && stored.answer_image_url && stored.title.endsWith('.pdf')
      && stored.review_revision === beforeFilesRevision + 2, 'question and answer attachments save through original APIs');
    await openMistakeEdit();
    check(document.getElementById('mistakeEditQuestionFile').textContent.includes('打开题目附件')
      && document.getElementById('mistakeEditAnswerFile').textContent.includes('打开答案附件'), 'existing attachments populated');
    removeMistakeEditQuestionFile(); selectFile('mistakeEditQuestionUpload','新题.pdf');
    toggleMistakeEditTag(folder.id,false);
    let failTags = true;
    window.fetch = async (url,options) => {
      if (failTags && options?.method === 'PUT' && String(url).endsWith('/mistakes/' + row.id + '/knowledge')) {
        return new Response(JSON.stringify({message:'隔离标签保存失败'}),{status:503,headers:{'Content-Type':'application/json'}});
      }
      return realFetch(url,options);
    };
    const beforeReplaceRevision = stored.review_revision, beforeReplaceUrl = stored.image_url;
    await saveMistakeDetail();
    check(mistakeEditPending && !mistakeEditPending.questionFile
      && mistakeEditPending.row.review_revision === beforeReplaceRevision + 2
      && document.getElementById('mistakeEditError').textContent.includes('输入已保留'), 'partial save keeps form and refreshes revision');
    failTags = false; await saveMistakeDetail(); window.fetch = realFetch;
    stored = await (await requestApi(API + '/mistakes/' + row.id)).json();
    check(stored.image_url !== beforeReplaceUrl && stored.review_revision === beforeReplaceRevision + 2
      && !stored.knowledge.some(t => t.id === folder.id), 'partial retry does not repeat attachment writes or review reset');
    await openMistakeEdit(); document.getElementById('mistakeEditAnswer').value = '并发冲突时保留的输入';
    await editApi(coursePath + '/mistakes/' + row.id,'PATCH',{answerContent:'服务器上的新答案',expectedRevision:stored.review_revision});
    await saveMistakeDetail();
    check(mistakeEditPending && document.getElementById('mistakeEditAnswer').value === '并发冲突时保留的输入', 'revision conflict preserves input');
    stored = await (await requestApi(API + '/mistakes/' + row.id)).json();
    check(stored.answer_content === '服务器上的新答案', 'revision conflict cannot overwrite newer content'); closeMistakeEdit();
    await backFromDetail(); await openMistakeCategory('knowledge'); await clearMistakeFilters();
    // 两次打开的知识树响应故意倒序返回，旧响应不得污染新的表单。
    let resolveOldTree, oldRequested = false;
    window.fetch = async (url, options) => {
      if (!oldRequested && String(url).endsWith('/knowledge-tree')) {
        oldRequested = true; return new Promise(resolve => {resolveOldTree = resolve;});
      }
      return realFetch(url,options);
    };
    const oldOpening = editMistakeFromList(row.id);
    await waitUntil(() => oldRequested, 'first tree request held');
    closeMistakeEdit();
    await editMistakeFromList(row.id);
    resolveOldTree(new Response(JSON.stringify([{id:999999,name:'过期树不可出现',type:'knowledge'}]),{headers:{'Content-Type':'application/json'}}));
    await oldOpening;
    window.fetch = realFetch;
    check(!tree.textContent.includes('过期树不可出现') && tree.textContent.includes(folder.name), 'stale tree response ignored');
    closeMistakeEdit();
    for (const item of ${JSON.stringify(data.cases.filter(([kind]) => kind !== 'mistake').map(([kind, row]) => ({kind,id:row.id})))}) {
      switchTab(item.kind === 'material' ? 'materials' : 'notes');
      if (item.kind === 'material') await loadMaterials(); else await loadNotes();
      await openTagPicker('edit',item.kind,item.id);
      await new Promise(resolve => setTimeout(resolve,350));
      const label = document.querySelector('#tagPickerTree .tag-label');
      check(label.getBoundingClientRect().width > 80 && label.textContent.trim(), item.kind + ' shared tag labels visible');
      onTagSearchInput('English 789');
      check(document.getElementById('tagPickerTree').textContent.includes(leaf.name), item.kind + ' shared search works');
      const box = document.getElementById('tagchk-' + leaf.id); box.click();
      check(tagPickerState.selected.has(leaf.id), item.kind + ' shared select works'); box.click();
      check(!tagPickerState.selected.has(leaf.id), item.kind + ' shared unselect works'); closeTagPicker();
    }
    await requestApi(API + '/mistakes/' + row.id,{method:'DELETE'});
    await requestApi(API + '/knowledge-nodes/' + folder.id,{method:'DELETE'});
    switchTab('mistakes'); await openMistakeCategory(null); await clearMistakeFilters();
    }
  `;
}

module.exports = { mistakeEditBrowserScenario };
