// 在隔离 Chrome 页面中执行真实 UI 操作，刷新后再次验证恢复。
function mistakeBrowserPrelude() {
  return `
    async function waitUntil(test, label) {
      for (let i = 0; i < 200; i++) {
        if (test()) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('timeout: ' + label);
    }
    const restored = JSON.parse(sessionStorage.getItem('mistake-regression-refresh') || 'null');
    if (restored) {
      await waitUntil(() => currentView.type === 'mistake' && mistakeDetailState?.progress?.stage === 'answer', 'refresh restore');
      check(currentView.id === restored.id && mistakeDetailState.review, 'restored correct review page');
      if (restored.type === 'unclassified') {
        check(!mistakeUi.type, 'home state restored for a queue started from home');
        check(mistakeQueue?.type === 'mixed' && JSON.stringify(mistakeQueue.ids) === JSON.stringify(restored.queueIds), 'unclassified queue restored as mixed');
        check(mistakeDetailState.progress.round === restored.round && mistakeDetailState.progress.version === restored.version, 'unclassified refresh preserves backend round and version');
        check(document.getElementById('mistakeReviewAnswer').textContent === '待分类答案', 'unclassified restored answer');
        check(document.querySelector('[data-review-action="judge-false"]').getAttribute('onclick').includes('mastered'), 'unclassified restored judgment uses mastered');
        document.querySelector('[data-review-action="judge-false"]').click();
        await waitUntil(() => mistakeDetailState.progress.stage === 'completed' && !mistakeReviewBusy, 'unclassified restored judgment');
        check(mistakeDetailState.progress.reviewStatus === 'unreviewed', 'unclassified needs review saved');
        await waitUntil(() => currentView.type === 'mistakeQueueComplete', 'unclassified restored queue completes');
        await backFromDetail(); await openMistakeCategory('unclassified'); await clearMistakeFilters();
        check(document.querySelector('[data-mistake-id="' + restored.id + '"]').textContent.includes('未复习'), 'unclassified list reflects judgment');
        sessionStorage.removeItem('mistake-regression-refresh');
        result.dataset.result = 'passed';
        result.textContent = 'four-type browser interactions, selection, continuous review and actual refresh passed';
        document.body.appendChild(result);
        return;
      }
      check(mistakeUi.type === 'knowledge' || mistakeQueue?.type === 'mixed', 'category or mixed queue persisted');
      check(document.getElementById('mistakeReviewAnswer').textContent === '浏览器答案', 'restored answer');
      await submitMistakeReview('judge', 'correct', true);
      check(mistakeDetailState.progress.reviewStatus === 'reviewed', 'reviewed saved after refresh');
      if (restored.queueIds) {
        check(mistakeQueue && JSON.stringify(mistakeQueue.ids) === JSON.stringify(restored.queueIds), 'fixed queue restored');
        check(mistakeQueue.index === 0 && !document.getElementById('mistakeQueueNext').disabled, 'restored completed first item');
        const savedFetch = window.fetch;
        window.fetch = async url => { if (String(url).endsWith('/review')) throw new TypeError('offline'); return savedFetch(url); };
        await nextMistakeQueueItem();
        check(mistakeQueue.index === 0, 'failed confirmation never skips');
        window.fetch = savedFetch;
        await nextMistakeQueueItem();
        check(currentView.id === restored.queueIds[1] && mistakeDetailState.progress.stage === 'question', 'next item starts');
        check(document.getElementById('mistakeQueueBanner').textContent.includes('已完成 1'), 'completed count');
        await submitMistakeReview('recall', 'recall', 'forgotten');
        check(mistakeDetailState.progress.reviewStatus === 'unreviewed', 'queue forgotten stays unreviewed');
        await nextMistakeQueueItem();
        check(currentView.type === 'mistakeQueueComplete' && document.getElementById('mistakeCompleteModal').classList.contains('show')
          && document.getElementById('mistakeCompleteText').textContent.includes('2 道'), 'queue completion modal');
      }
      await backFromDetail();
      if (!mistakeUi.type) await openMistakeCategory('knowledge');
      await clearMistakeFilters();
      check(document.querySelector('[data-mistake-id="' + restored.id + '"]').textContent.includes('已复习'), 'list status updated');
      check(!mistakeStorageGet('mistake-detail:' + currentCourseId), 'back clears detail restoration');
      if (restored.unclassifiedId) {
        // 复习入口只在「错题」大页：回大页 → 开始复习 → 选待分类 → 勾题 → 开始。
        await openMistakeCategory(null);
        await enterMistakeReviewFromHome();
        await openMistakeReviewCategory('unclassified'); await clearMistakeFilters();
        chooseMistake(restored.unclassifiedId, true);
        await startMistakeQueue();
        await submitMistakeReview('reveal_answer');
        await pauseMistakeQueue();
        check(readMistakeQueue()?.type === 'mixed', 'paused unclassified queue accepted');
        await resumeMistakeQueue();
        check(mistakeDetailState.progress.stage === 'answer', 'unclassified pause/resume restores answer');
        sessionStorage.setItem('mistake-regression-refresh', JSON.stringify({id:restored.unclassifiedId,type:'unclassified',queueIds:mistakeQueue.ids,round:mistakeDetailState.progress.round,version:mistakeDetailState.progress.version}));
        location.reload(); return;
      }
      sessionStorage.removeItem('mistake-regression-refresh');
      result.dataset.result = 'passed';
      result.textContent = 'browser interactions, selection, continuous review and queue refresh passed';
      document.body.appendChild(result);
      return;
    }
  `;
}

function mistakeBrowserScenario(data) {
  return `
    switchTab('mistakes');
    await openMistakeCategory(null);
    check(document.querySelectorAll('[data-mistake-category]').length === 4, 'four categories');
    check(document.getElementById('mistakeFilters').style.display === 'none', 'home hides filters');
    check(document.getElementById('mistakeHomeReview').style.display === 'none', 'standalone mistake review entry removed');
    check(document.getElementById('mistakeHomeReviewStart').textContent === '开始复习', 'home primary review button');
    for (const type of ['knowledge', 'thinking', 'execution', 'unclassified']) {
      document.getElementById('mistakeHomeReviewStart').click();
      await waitUntil(() => mistakeReviewPicker && !mistakeReviewPicker.pickerLoading, 'home opens category picker ' + type);
      check(document.getElementById('mistakeReviewPicker').classList.contains('show') && !mistakeUi.type, 'home opens modal without navigating');
      check(document.querySelectorAll('[data-review-category]').length === 4, 'four vertical category choices');
      check(document.getElementById('mistakeReviewPickerStart').disabled, 'empty picker cannot start');
      document.querySelector('[data-review-category="' + type + '"]').click();
      await waitUntil(() => mistakeSelectionCurrent() && !mistakeSelection.listLoading, 'category name starts detailed selection ' + type);
      check(document.getElementById('mistakeReviewPicker').classList.contains('show'), 'category detail stays in same modal');
      check(document.getElementById('mistakeReviewPickerDetail').contains(document.getElementById('mistakeFilters'))
        && document.getElementById('mistakeReviewPickerDetail').contains(document.getElementById('mistakeList'))
        && document.getElementById('mistakeReviewPickerDetail').contains(document.getElementById('mistakeSelectionHeader')), 'existing filters, list and select-all toolbar reused inside modal');
      check(currentView.type === 'course' && currentView.tab === 'mistakes', 'modal detail does not navigate page');
      check(document.getElementById('mistakeReviewPickerTitle').textContent === MISTAKE_TYPES[type], 'modal detail category title');
      check(mistakeSelection.courseId === currentCourseId && mistakeSelection.type === type && mistakeUi.type === type, 'home selection scoped to course and type ' + type);
      check(document.getElementById('mistakeHomeReview').style.display === 'none', 'home entry hidden within category');
      check(document.getElementById('mistakeFilters').style.display === 'block', 'selection keeps filters');
      check(document.querySelector('.mistake-review-picker-foot').contains(document.getElementById('mistakeReviewPickerStart')), 'fixed modal start footer');
      check(document.getElementById('mistakeReviewPickerStart').disabled, 'home does not start reviewing without selected items');
      if (type === 'knowledge') {
        await new Promise(resolve => setTimeout(resolve, 350));
        const body = document.getElementById('mistakeReviewPickerBody');
        const head = document.querySelector('.mistake-review-picker-head');
        const foot = document.querySelector('.mistake-review-picker-foot');
        check(getComputedStyle(body).overflowY === 'auto', 'only modal body scrolls');
        check(body.scrollWidth <= body.clientWidth + 1, 'modal detail fits viewport width ' + body.scrollWidth + '/' + body.clientWidth + ' ' + [...body.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > body.getBoundingClientRect().right + 1).slice(0,6).map(el => el.tagName + ':' + (el.id || el.className) + ':' + el.outerHTML.slice(0,100)).join(','));
        check(head.getBoundingClientRect().top >= 0 && foot.getBoundingClientRect().bottom <= innerHeight, 'header and footer fit viewport');
        const spacer = document.createElement('div'); spacer.style.height = '1200px'; body.appendChild(spacer);
        const headTop = head.getBoundingClientRect().top, footTop = foot.getBoundingClientRect().top;
        body.scrollTop = body.scrollHeight;
        check(body.scrollTop > 0 && head.getBoundingClientRect().top === headTop && foot.getBoundingClientRect().top === footTop, 'content scroll keeps header and footer fixed');
        spacer.remove(); body.scrollTop = 0;
      }
      await cancelMistakeSelection();
      check(!mistakeSelection && !document.getElementById('mistakeReviewPicker').classList.contains('show'), 'cancel closes modal');
      check(document.getElementById('pane-mistakes').contains(document.getElementById('mistakeList')), 'close restores ordinary list container');
      await openMistakeCategory(null);
      check(document.getElementById('mistakeHomeReview').style.display === 'none', 'standalone mistake review entry stays hidden');
    }

    openManualModal('mistake');
    document.getElementById('manualTitle').value = '浏览器知识题';
    document.getElementById('manualContent').value = '浏览器搜索题目';
    confirmManualModal();
    await waitUntil(() => tagPickerState?.tree.length > 0, 'creation tags');
    await confirmTagPicker();
    check(tagPickerState && !tagPickerState.saving, 'creation requires type');
    document.getElementById('mistakeCreateType').value = 'knowledge';
    document.getElementById('mistakeCreateAnswer').value = '浏览器答案';
    document.getElementById('mistakeCreateExplanation').value = '浏览器解析';
    onTagCheckChange(${data.child.id}, true);
    await confirmTagPicker();
    check(!tagPickerState, 'manual creation success');
    const knowledge = currentMistakes.find(r => r.title === '浏览器知识题');
    check(knowledge && knowledge.mistake_type === 'knowledge', 'creation passes type and answer');
    await openMistakeCategory('knowledge');
    check(document.getElementById('mistakeCategoryTitle').textContent === '知识类', 'category title');
    document.getElementById('mistakeSearch').value = '浏览器搜索';
    await applyMistakeFilters();
    check(currentMistakes.length === 1 && currentMistakes[0].id === knowledge.id, 'search');
    const favoriteButton = document.querySelector('[data-mistake-favorite="' + knowledge.id + '"]');
    await toggleMistakeFavorite(knowledge.id, true, favoriteButton);
    document.getElementById('mistakeFavoriteFilter').checked = true;
    document.getElementById('mistakeStatusFilter').value = 'unreviewed';
    await changeMistakeTagFilter(${data.child.id}, true);
    check(currentMistakes.length === 1 && currentMistakes[0].favorite === 1, 'combined favorites/status/tag/search');
    document.getElementById('mistakeStatusFilter').value = 'reviewed';
    await applyMistakeFilters();
    check(currentMistakes.length === 0 && document.getElementById('mistakeList').textContent.includes('暂无'), 'review status filter');
    await clearMistakeFilters();

    await openMistakeDetail(knowledge.id, true);
    check(document.getElementById('mistakeReadPanel').style.display === 'none', 'review hides editor and read answer');
    check(!document.getElementById('mistakeReviewAnswer'), 'initial answer hidden');
    document.querySelector('[data-review-action="start"]').click();
    await waitUntil(() => mistakeDetailState.progress.stage === 'question' && !mistakeReviewBusy, 'start by actual button');
    document.querySelector('[data-review-action="recall-clear"]').click();
    await waitUntil(() => mistakeDetailState.progress.stage === 'answer' && !mistakeReviewBusy, 'recall clear by actual button');
    check(document.getElementById('mistakeReviewAnswer').textContent === '浏览器答案', 'answer revealed');
    await submitMistakeReview('judge', 'correct', false);
    check(mistakeDetailState.progress.reviewStatus === 'unreviewed', 'wrong unreviewed');
    await submitMistakeReview('start');
    await submitMistakeReview('recall', 'recall', 'vague');
    await submitMistakeReview('judge', 'correct', true);
    check(mistakeDetailState.progress.reviewStatus === 'reviewed', 'vague then correct');
    await submitMistakeReview('start');
    await submitMistakeReview('recall', 'recall', 'forgotten');
    check(mistakeDetailState.progress.stage === 'completed' && mistakeDetailState.progress.reviewStatus === 'unreviewed', 'forgotten completes without judgment');
    check(!document.querySelector('[data-review-action="judge-true"]'), 'forgotten has no judgment');

    await submitMistakeReview('start');
    const reviewOriginalFetch = window.fetch;
    let lostResponse = true;
    window.fetch = async (url, options) => {
      const response = await reviewOriginalFetch(url, options);
      if (lostResponse && options?.method === 'POST' && String(url).includes('/review/events')) {
        lostResponse = false;
        throw new TypeError('simulated response loss after server commit');
      }
      return response;
    };
    await submitMistakeReview('recall', 'recall', 'clear');
    check(mistakeStorageGet(mistakePendingKey(mistakeDetailState)), 'lost response preserves request');
    const pending = mistakeStorageGet(mistakePendingKey(mistakeDetailState));
    window.fetch = reviewOriginalFetch;
    await retryMistakeReview();
    check(!mistakeStorageGet(mistakePendingKey(mistakeDetailState)) && mistakeDetailState.progress.stage === 'answer', 'idempotent retry recovers');
    check(pending.body.action === 'recall', 'pending action recorded');
    await submitMistakeReview('judge', 'correct', true);
    await toggleMistakeReviewMode();
    await openMistakeEdit();
    document.getElementById('mistakeEditExplanation').value = '修改解析';
    await saveMistakeDetail();
    check(mistakeDetailState.row.explanation === '修改解析' && mistakeDetailState.row.review_status === 'unreviewed', 'detail edit resets status');
    await backFromDetail();

    openManualModal('mistake');
    document.getElementById('manualTitle').value = '浏览器思维题';
    document.getElementById('manualContent').value = '重新思考';
    confirmManualModal();
    await waitUntil(() => tagPickerState?.tree.length > 0, 'thinking creation');
    document.getElementById('mistakeCreateType').value = 'thinking';
    document.getElementById('mistakeCreateAnswer').value = '思路';
    await confirmTagPicker();
    await openMistakeCategory('thinking');
    const thinking = currentMistakes.find(r => r.title === '浏览器思维题');
    await openMistakeDetail(thinking.id, true);
    await submitMistakeReview('start');
    await submitMistakeReview('reveal_answer');
    await submitMistakeReview('judge', 'mastered', true);
    check(mistakeDetailState.progress.reviewStatus === 'reviewed', 'thinking mastered');
    await submitMistakeReview('start');
    await submitMistakeReview('reveal_answer');
    await submitMistakeReview('judge', 'mastered', false);
    check(mistakeDetailState.progress.reviewStatus === 'unreviewed', 'thinking needs review');
    await backFromDetail();

    const transfer = new DataTransfer();
    transfer.items.add(new File(['%PDF-test'], '浏览器执行题.pdf', {type:'application/pdf'}));
    document.getElementById('mistakeFile').files = transfer.files;
    await uploadMistake();
    document.getElementById('mistakeCreateType').value = 'execution';
    document.getElementById('mistakeCreateAnswer').value = '执行答案';
    await confirmTagPicker();
    await openMistakeCategory('execution');
    const execution = currentMistakes.find(r => r.title === '浏览器执行题.pdf');
    check(execution && execution.file_type === 'application/pdf', 'upload passes type');
    await openMistakeDetail(execution.id, true);
    check(document.getElementById('mistakeDetailFile').querySelector('[data-attachment-preview]'), 'PDF attachment displayed');
    await submitMistakeReview('start');
    await submitMistakeReview('reveal_answer');
    await submitMistakeReview('judge', 'correct', true);
    check(mistakeDetailState.progress.reviewStatus === 'reviewed', 'execution correct');
    await toggleMistakeReviewMode();
    await openMistakeEdit();
    document.getElementById('mistakeEditType').value = 'unclassified';
    await saveMistakeDetail();
    await toggleMistakeReviewMode();
    check(mistakeDetailState.progress.reviewable && mistakeDetailState.progress.allowedActions.includes('start'), 'edited unclassified is reviewable');
    await submitMistakeReview('start');
    check(mistakeDetailState.progress.allowedActions.includes('reveal_answer'), 'edited unclassified uses generic reveal');
    await submitMistakeReview('reveal_answer');
    check(document.querySelector('[data-review-action="judge-true"]').textContent === '已掌握', 'unclassified mastery buttons');
    check(document.querySelector('[data-review-action="judge-true"]').getAttribute('onclick').includes('mastered'), 'unclassified uses mastered instead of correct');
    document.querySelector('[data-review-action="judge-true"]').click();
    await waitUntil(() => mistakeDetailState.progress.stage === 'completed' && !mistakeReviewBusy, 'edited unclassified mastered');
    check(mistakeDetailState.progress.reviewStatus === 'reviewed', 'edited unclassified judgment saved');
    await backFromDetail();
    await openMistakeCategory('unclassified');
    check(currentMistakes.some(r => r.id === execution.id), 'unclassified query');
    // 四个分类详情页都不再有复习入口，只有「错题」大页保留。
    check(document.getElementById('mistakeHomeReview').style.display === 'none'
      && document.getElementById('mistakeSelectionHeader').style.display === 'none'
      && !document.getElementById('mistakeSelectionHeader').innerHTML, 'category detail page has no review entry');
    // 从待分类页面新建，类型默认回显待分类，并通过现有录入 API 保存。
    openManualModal('mistake');
    document.getElementById('manualTitle').value = '浏览器待分类题';
    document.getElementById('manualContent').value = '待分类自行回忆或解题';
    confirmManualModal();
    await waitUntil(() => tagPickerState?.tree.length > 0, 'unclassified creation tags');
    check(document.querySelector('#mistakeCreateType option[value="unclassified"]'), 'unclassified creation option');
    check(document.getElementById('mistakeCreateType').value === 'unclassified', 'unclassified creation default');
    document.getElementById('mistakeCreateAnswer').value = '待分类答案';
    onTagCheckChange(${data.child.id}, true);
    await confirmTagPicker();
    check(!tagPickerState, 'unclassified creation saves');
    const unclassified = currentMistakes.find(r => r.title === '浏览器待分类题');
    check(unclassified?.mistake_type === 'unclassified' && unclassified.review_status === 'unreviewed', 'unclassified creation type and default status');
    check(!document.querySelector('[data-mistake-id="' + unclassified.id + '"] .mistake-actions').textContent.includes('复习'), 'unclassified has no single review entry');
    document.getElementById('mistakeSearch').value = '待分类自行';
    document.getElementById('mistakeStatusFilter').value = 'unreviewed';
    await changeMistakeTagFilter(${data.child.id}, true);
    check(currentMistakes.length === 1 && currentMistakes[0].id === unclassified.id, 'unclassified search status and tag filters');
    await clearMistakeFilters();
    const genericMissingForm = new FormData();
    genericMissingForm.set('title','待分类无答案'); genericMissingForm.set('content','题目'); genericMissingForm.set('mistakeType','unclassified');
    const genericMissing = await (await requestApi(API + '/courses/' + currentCourseId + '/mistakes', {method:'POST',body:genericMissingForm})).json();
    // 复习入口只在「错题」大页：从大页进弹窗，再选待分类分类。
    await openMistakeCategory(null);
    await enterMistakeReviewFromHome();
    await openMistakeReviewCategory('unclassified'); await clearMistakeFilters();
    check(!document.querySelector('[data-mistake-id="' + unclassified.id + '"] .mistake-select-check').disabled, 'unclassified selectable');
    check(document.querySelector('[data-mistake-id="' + genericMissing.id + '"] .mistake-select-check').disabled, 'unclassified missing answer still blocked');
    check(document.querySelector('[data-mistake-id="' + genericMissing.id + '"]').textContent.includes('补齐内容'), 'unclassified missing answer repair entry');
    await cancelMistakeSelection();

    // 连续复习：包含待分类队列，以及已复习题重新开轮。
    const startReviewFromHome = async (type, ids) => {
      await openMistakeCategory(null);
      await enterMistakeReviewFromHome();
      await openMistakeReviewCategory(type); await clearMistakeFilters();
      for (const id of [].concat(ids)) chooseMistake(id, true);
      await startMistakeQueue();
    };
    for (const [row, type, key] of [[thinking, 'thinking', 'mastered'], [execution, 'execution', 'correct'], [unclassified, 'unclassified', 'mastered']]) {
      if (type === 'execution') {
        await requestApi(API + '/courses/' + currentCourseId + '/mistakes/' + row.id, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({mistakeType:type})});
      }
      await startReviewFromHome(type, row.id);
      check(mistakeDetailState.progress.stage === 'question', 'queue automatic start ' + type);
      check(!document.getElementById('mistakeQueueNext'), 'last question has no manual finish button ' + type);
      await submitMistakeReview('reveal_answer');
      await submitMistakeReview('judge', key, true);
      await waitUntil(() => currentView.type === 'mistakeQueueComplete', 'last judgment auto-completes the queue ' + type);
      check(document.getElementById('mistakeCompleteModal').classList.contains('show')
        && document.getElementById('mistakeCompleteTitle').textContent.includes('恭喜')
        && mistakeConfettiLayerState() !== 'none', 'perfect round celebrates ' + type);
      await backFromDetail(); await loadMistakes();
      await startReviewFromHome(type, row.id);
      check(mistakeDetailState.progress.stage === 'question' && mistakeDetailState.progress.reviewStatus === 'reviewed', 'reviewed allowed new round ' + type);
      await submitMistakeReview('reveal_answer'); await submitMistakeReview('judge', key, false);
      check(mistakeDetailState.progress.reviewStatus === 'unreviewed', 'repeat wrong updates state ' + type);
      await waitUntil(() => currentView.type === 'mistakeQueueComplete', 'wrong last judgment still auto-completes ' + type);
      check(document.getElementById('mistakeCompleteModal').classList.contains('show')
        && !document.getElementById('mistakeCompleteTitle').textContent.includes('恭喜')
        && mistakeConfettiLayerState() === 'none', 'imperfect round shows plain completion ' + type);
      await backFromDetail();
    }
    // 弹窗快速全选与各分类手动选择共用集合和一个混合队列。
    await openMistakeCategory(null); await enterMistakeReviewFromHome();
    const eligibleKnowledge = mistakeReviewPicker.catalog.filter(r => r.mistake_type === 'knowledge' && !mistakeCannotReview(r));
    const eligibleThinking = mistakeReviewPicker.catalog.filter(r => r.mistake_type === 'thinking' && !mistakeCannotReview(r));
    document.querySelector('[data-review-category-all="knowledge"]').click();
    check(mistakeSelection.ids.size === eligibleKnowledge.length, 'quick all selects all eligible category rows');
    document.querySelector('[data-review-category-all="thinking"]').click();
    check(mistakeSelection.ids.size === eligibleKnowledge.length + eligibleThinking.length, 'quick all combines categories');
    check(Number(document.getElementById('mistakeReviewPickerCount').textContent) === mistakeSelection.ids.size, 'picker count updates');
    document.querySelector('[data-review-category-all="thinking"]').click();
    check(mistakeSelection.ids.size === eligibleKnowledge.length, 'category deselect preserves other categories');
    await openMistakeReviewCategory('knowledge'); await clearMistakeFilters();
    for (const row of currentMistakes) if (row.id !== knowledge.id) chooseMistake(row.id, false);
    chooseMistake(knowledge.id, true);
    document.getElementById('mistakeReviewPickerBack').click();
    await waitUntil(() => mistakeReviewPicker && !mistakeReviewPicker.pickerType, 'modal back button returns to category view');
    if (eligibleKnowledge.length > 1) check(document.querySelector('[data-review-category-all="knowledge"]').indeterminate, 'picker partial state follows detailed selection');
    check(mistakeSelection.ids.has(knowledge.id), 'return preserves detailed selection');
    for (const [type, row] of [['thinking',thinking],['execution',execution],['unclassified',unclassified]]) {
      await openMistakeReviewCategory(type); await clearMistakeFilters();
      chooseMistake(row.id, true); chooseMistake(row.id, true);
      await returnToMistakeReviewPicker();
    }
    check(mistakeSelection.ids.size === 4 && document.getElementById('mistakeReviewPickerCount').textContent === '4', 'four types share deduplicated selection');
    const mixedIds = [knowledge.id,thinking.id,execution.id,unclassified.id].sort((a,b)=>a-b);
    await startMistakeQueue();
    check(mistakeQueue.type === 'mixed' && JSON.stringify(mistakeQueue.ids) === JSON.stringify(mixedIds), 'quick and manual selections form one ordered queue');
    for (let i = 0; i < mixedIds.length; i++) {
      check(currentView.id === mixedIds[i] && mistakeDetailState.progress.stage === 'question', 'mixed next item question');
      const type = mistakeDetailState.progress.mistakeType;
      check(mistakeQueueTypeFor(currentView.id) === type, 'mixed item retains its own type');
      if (type === 'knowledge') await submitMistakeReview('recall','recall','vague');
      else await submitMistakeReview('reveal_answer');
      const positive = type !== 'knowledge';
      await submitMistakeReview('judge', ['thinking','unclassified'].includes(type) ? 'mastered' : 'correct', positive);
      check(mistakeDetailState.progress.reviewStatus === (positive ? 'reviewed' : 'unreviewed'), 'mixed judgment saved ' + type);
      if (i === 0) {
        await pauseMistakeQueue(); await loadMistakes();
        check(!mistakeUi.type && readMistakeQueue().type === 'mixed', 'mixed pause returns to home and preserves queue');
        check(document.getElementById('mistakeHomeReview').style.display === 'none', 'standalone mixed queue resume entry removed');
        await resumeMistakeQueue();
        check(mistakeDetailState.progress.stage === 'completed', 'mixed resume uses backend completion');
      }
      await nextMistakeQueueItem();
    }
    check(currentView.type === 'mistakeQueueComplete', 'mixed queue completion');
    await backFromDetail();
    // 完成弹窗：取消 / 再来一遍 / 查看作答预览 / 开始新复习。
    const completeButtons = () => [...document.querySelectorAll('#mistakeCompleteModal .modal-actions button')];
    // 用思维类（揭示答案 + 已掌握）跑单题轮，避免动到后面几步依赖的知识类状态。
    const finishSingleRound = async () => {
      await startReviewFromHome('thinking', thinking.id);
      await submitMistakeReview('reveal_answer');
      await submitMistakeReview('judge', 'mastered', true);
      await waitUntil(() => document.getElementById('mistakeCompleteModal').classList.contains('show'), 'completion modal after single round');
    };
    await finishSingleRound();
    check(completeButtons().map(b => b.textContent.trim()).join('|') === '取消|再来一遍|查看作答预览|开始新复习', 'completion choices include read-only preview');
    completeButtons()[1].click();
    await waitUntil(() => currentView.type === 'mistake' && currentView.id === thinking.id && mistakeDetailState?.progress?.stage === 'question' && !mistakeReviewBusy && !mistakeQueueLoading && !document.getElementById('mistakeCompleteModal').classList.contains('show'), 'replay restarts the same queue');
    check(mistakeQueue.index === 0 && !mistakeQueue.finished, 'replay resets queue progress');
    await submitMistakeReview('reveal_answer');
    await submitMistakeReview('judge', 'mastered', true);
    await waitUntil(() => document.getElementById('mistakeCompleteModal').classList.contains('show') && !mistakeReviewBusy && !mistakeQueueLoading, 'replayed round completion ready');
    completeButtons().find(b => b.textContent.includes('开始新复习')).click();
    await waitUntil(() => mistakeReviewPicker && document.getElementById('mistakeReviewPicker').classList.contains('show'), 'start new review opens the picker');
    check(!document.getElementById('mistakeCompleteModal').classList.contains('show') && !mistakeQueue, 'new review drops the finished queue');
    await cancelMistakeSelection();
    await finishSingleRound();
    completeButtons()[0].click();
    await waitUntil(() => !document.getElementById('mistakeCompleteModal').classList.contains('show') && currentView.type === 'course' && !mistakeQueue, 'cancel returns home');
    check(!mistakeUi.type, 'cancel lands on the mistake home page');
    const secondForm = new FormData();
    secondForm.set('title','队列第二题'); secondForm.set('content','队列第二题正文');
    secondForm.set('mistakeType','knowledge'); secondForm.set('answerContent','第二答案');
    secondForm.set('knowledgeIds',JSON.stringify([${data.child.id}]));
    const second = await (await requestApi(API + '/courses/' + currentCourseId + '/mistakes', {method:'POST',body:secondForm})).json();
    secondForm.set('title','队列缺答案'); secondForm.set('answerContent','');
    const missing = await (await requestApi(API + '/courses/' + currentCourseId + '/mistakes', {method:'POST',body:secondForm})).json();
    await openMistakeCategory('knowledge'); await clearMistakeFilters();
    // （复习入口只在「错题」大页）这里改从大页进弹窗，验证筛选 / 勾选仍复用同一套列表与选择状态。
    await openMistakeCategory(null);
    await enterMistakeReviewFromHome();
    await openMistakeReviewCategory('knowledge'); await clearMistakeFilters();
    check(document.getElementById('mistakeReviewPickerStart').disabled, 'empty selection disabled');
    check(document.querySelector('[data-mistake-id="' + missing.id + '"] .mistake-select-check').disabled, 'missing answer disabled');
    check(document.querySelector('[data-mistake-id="' + missing.id + '"]').textContent.includes('补齐内容'), 'missing answer repair entry');
    document.getElementById('mistakeSearch').value = '浏览器知识'; await applyMistakeFilters();
    selectAllVisibleMistakes(true);
    check(mistakeSelection.ids.size === 1 && mistakeSelection.ids.has(knowledge.id), 'all only filtered result');
    document.getElementById('mistakeSearch').value = '队列第二'; await applyMistakeFilters();
    selectAllVisibleMistakes(true); selectAllVisibleMistakes(true);
    check(mistakeSelection.ids.size === 2, 'retains hidden selections and deduplicates');
    selectAllVisibleMistakes(false);
    check(mistakeSelection.ids.size === 1 && mistakeSelection.ids.has(knowledge.id), 'unselect all preserves hidden');
    await clearMistakeFilters();
    check(document.getElementById('mistakeSelectAll').indeterminate, 'partial select indicator');
    clearMistakeSelection(); check(mistakeSelection.ids.size === 0, 'clear selected');
    document.querySelector('[data-mistake-id="' + knowledge.id + '"] .info').click();
    check(mistakeSelection.ids.has(knowledge.id) && currentView.type === 'course', 'card selects instead of detail');
    const checkbox = document.querySelector('[data-mistake-id="' + second.id + '"] .mistake-select-check');
    checkbox.click(); check(mistakeSelection.ids.size === 2, 'checkbox multiselect');
    checkbox.click(); check(mistakeSelection.ids.size === 1, 'checkbox deselect');
    document.getElementById('mistakeSearch').value = '浏览器搜索';
    document.getElementById('mistakeFavoriteFilter').checked = true;
    document.getElementById('mistakeStatusFilter').value = 'unreviewed';
    await changeMistakeTagFilter(${data.child.id}, true);
    check(currentMistakes.length === 1 && currentMistakes[0].id === knowledge.id, 'selection combined search favorite status tags');
    await cancelMistakeSelection();
    check(!mistakeSelection && !document.getElementById('mistakeReviewPicker').classList.contains('show')
      && document.getElementById('mistakeSelectionHeader').style.display === 'none', 'cancel restores ordinary list');
    await openMistakeCategory(null);
    await enterMistakeReviewFromHome();
    await openMistakeReviewCategory('knowledge'); await clearMistakeFilters();
    chooseMistake(second.id, true); chooseMistake(knowledge.id, true);
    check(document.getElementById('mistakeReviewPickerCount').textContent === '2', 'unique count displayed');
    await startMistakeQueue();
    check(JSON.stringify(mistakeQueue.ids) === JSON.stringify([knowledge.id,second.id]), 'queue follows list order rather than click order');
    check(mistakeDetailState.progress.stage === 'question' && !document.getElementById('mistakeReviewAnswer'), 'queue starts with hidden answer');
    await submitMistakeReview('recall', 'recall', 'clear');
    await pauseMistakeQueue();
    check(!mistakeQueue && readMistakeQueue().index === 0, 'pause retains queue');
    await resumeMistakeQueue();
    check(mistakeDetailState.progress.stage === 'answer', 'resume reads backend unfinished step');
    sessionStorage.setItem('mistake-regression-refresh', JSON.stringify({id:knowledge.id,queueIds:mistakeQueue.ids,unclassifiedId:unclassified.id}));
    location.reload();
    return;
  `;
}

module.exports = { mistakeBrowserPrelude, mistakeBrowserScenario };
