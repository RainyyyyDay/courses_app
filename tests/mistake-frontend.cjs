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
      check(mistakeUi.type === 'knowledge', 'category persisted');
      check(document.getElementById('mistakeReviewAnswer').textContent === '浏览器答案', 'restored answer');
      await submitMistakeReview('judge', 'correct', true);
      check(mistakeDetailState.progress.reviewStatus === 'reviewed', 'reviewed saved after refresh');
      await backFromDetail();
      await loadMistakes();
      check(document.querySelector('[data-mistake-id="' + restored.id + '"]').textContent.includes('已复习'), 'list status updated');
      check(!mistakeStorageGet('mistake-detail:' + currentCourseId), 'back clears detail restoration');
      sessionStorage.removeItem('mistake-regression-refresh');
      result.dataset.result = 'passed';
      result.textContent = 'browser interactions and mistake refresh passed';
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
    const favoriteButton = document.querySelector('[data-mistake-id="' + knowledge.id + '"] button:nth-child(3)');
    await toggleMistakeFavorite(knowledge.id, true, favoriteButton);
    document.getElementById('mistakeFavoriteFilter').value = 'true';
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
    check(document.getElementById('mistakeDetailFile').textContent.includes('打开'), 'PDF attachment displayed');
    await submitMistakeReview('start');
    await submitMistakeReview('reveal_answer');
    await submitMistakeReview('judge', 'correct', true);
    check(mistakeDetailState.progress.reviewStatus === 'reviewed', 'execution correct');
    await toggleMistakeReviewMode();
    document.getElementById('mistakeEditType').value = 'unclassified';
    await saveMistakeDetail();
    await toggleMistakeReviewMode();
    check(!mistakeDetailState.progress.reviewable && document.getElementById('mistakeReviewPanel').textContent.includes('先将错题'), 'unclassified blocked with edit guidance');
    await backFromDetail();
    await openMistakeCategory('unclassified');
    check(currentMistakes.some(r => r.id === execution.id), 'unclassified query');

    await openMistakeCategory('knowledge');
    await openMistakeDetail(knowledge.id, true);
    await submitMistakeReview('start');
    await submitMistakeReview('recall', 'recall', 'clear');
    sessionStorage.setItem('mistake-regression-refresh', JSON.stringify({id:knowledge.id}));
    location.reload();
    return;
  `;
}

module.exports = { mistakeBrowserPrelude, mistakeBrowserScenario };
