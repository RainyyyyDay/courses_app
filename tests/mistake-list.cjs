// 隔离 Chrome/HTTP 场景：普通错题列表和资料/笔记使用同一套入口、操作、筛选样式。
function mistakeListBrowserScenario(data) {
  return `
    {
      switchTab('mistakes'); await openMistakeCategory('knowledge'); await clearMistakeFilters();
      const create = async title => {
        const form = new FormData(); form.set('title',title); form.set('content','统一列表测试题目');
        form.set('mistakeType','knowledge'); form.set('answerContent','统一列表答案');
        form.set('knowledgeIds',JSON.stringify([${data.child.id}]));
        return (await requestApi(API + '/courses/' + currentCourseId + '/mistakes',{method:'POST',body:form})).json();
      };
      const first = await create('统一列表第一题'), second = await create('统一列表第二题');
      const search = document.getElementById('mistakeSearch'), favorites = document.getElementById('mistakeFavoriteFilter');
      search.value = '统一列表 '; search.dispatchEvent(new Event('input'));
      await waitUntil(() => currentMistakes.length === 2 && !document.querySelector('#mistakeList .loading-tip'), 'live search trims query only');
      check(search.value === '统一列表 ', 'live search preserves the space before the next word');
      search.value = '统一列表'; search.dispatchEvent(new Event('input'));
      await waitUntil(() => currentMistakes.length === 2 && !document.querySelector('#mistakeList .loading-tip'), 'live search updates list');
      // 母标签筛选：错题只打了子标签时，勾选它的母标签（分类目录）也要能看到。
      const tree = await (await requestApi(API + '/courses/' + currentCourseId + '/knowledge-tree')).json();
      const parentNode = tree.find(node => (node.children || []).some(child => child.id === ${data.child.id}));
      check(parentNode && !parentNode.is_system, 'child tag sits under a folder');
      await waitUntil(() => document.querySelector('#mistakeFilterTags input[value="' + parentNode.id + '"]'), 'parent tag filter loaded');
      document.querySelector('#mistakeFilterTags input[value="' + parentNode.id + '"]').click();
      await waitUntil(() => !document.querySelector('#mistakeList .loading-tip') && mistakeUi.nodeIds.includes(parentNode.id), 'parent tag live filter');
      check(currentMistakes.length === 2, 'parent tag matches child-tagged mistakes');
      document.querySelector('#mistakeFilterTags input[value="' + parentNode.id + '"]').click();
      await waitUntil(() => !document.querySelector('#mistakeList .loading-tip') && mistakeUi.nodeIds.length === 0, 'parent tag filter cleared');
      check(currentMistakes.length === 2, 'clearing parent tag restores list');
      const card = id => document.querySelector('[data-mistake-id="' + id + '"]');
      const star = id => card(id)?.querySelector('[data-mistake-favorite]');
      const view = currentView;
      for (const id of [first.id,second.id]) {
        const buttons = [...card(id).querySelectorAll('.mistake-actions button')];
        check(buttons.map(button => button.textContent.trim()).join('|') === '☆|查看|编辑|删除', 'ordinary actions are star/view/edit/delete');
        check(!card(id).querySelector('[onclick*="true)"]') && !card(id).textContent.includes('开始复习'), 'no single review action on cards');
        check(star(id).getAttribute('aria-pressed') === 'false' && !star(id).classList.contains('is-favorite'), 'empty star unselected');
      }
      check(favorites.type === 'checkbox', 'favorite filter is checkbox');
      // 比较现有资料、笔记实际计算样式，防止错题专有选择器再次覆盖共享样式。
      const compareStyles = (left,right,keys,label) => {
        const a = getComputedStyle(left), b = getComputedStyle(right);
        for (const key of keys) check(a[key] === b[key], label + ' style differs: ' + key + ' ' + a[key] + '/' + b[key]);
      };
      for (const kind of ['materials','notes']) {
        if (kind === 'materials') await loadMaterials(); else await loadNotes();
        const list = document.getElementById(kind === 'materials' ? 'materialList' : 'noteList');
        const reference = list.querySelector('.item-row');
        compareStyles(card(first.id),reference,['display','flexDirection','padding','borderRadius','alignItems'],'row ' + kind);
        compareStyles(card(first.id).querySelector('.mistake-actions'),reference.querySelector('.mistake-actions'),['display','gap','alignItems'],'actions ' + kind);
        compareStyles(star(first.id),reference.querySelector('.reading-favorite'),['fontSize','padding','marginLeft','color','borderRadius','minWidth'],'star ' + kind);
        compareStyles(card(first.id).querySelector('.mistake-actions button:nth-child(2)'),reference.querySelector('.mistake-actions button:nth-child(2)'),['fontSize','padding','marginLeft','backgroundColor'],'view ' + kind);
        const controls = document.querySelector('#' + kind + 'BrowseFilters .reading-browse-controls');
        compareStyles(search,controls.querySelector('input'),['fontSize','padding','borderRadius','flex'],'search ' + kind);
        compareStyles(favorites,controls.querySelector('input[type=checkbox]'),['width','height'],'favorite filter ' + kind);
      }
      const realFetch = window.fetch;
      let patches = 0, failFavorite = true;
      window.fetch = async (url,options) => {
        if (options?.method === 'PATCH' && String(url).endsWith('/mistakes/' + first.id)) {
          patches++;
          if (failFavorite) return new Response(JSON.stringify({message:'隔离收藏失败'}),{status:503,headers:{'Content-Type':'application/json'}});
        }
        return realFetch(url,options);
      };
      star(first.id).click();
      await waitUntil(() => !mistakeFavoritePending.size, 'failed favorite request completes');
      check(star(first.id).textContent === '☆' && !star(first.id).disabled && currentView === view, 'favorite failure retains state and view');
      failFavorite = false;
      star(first.id).click(); star(first.id).click();
      await waitUntil(() => !mistakeFavoritePending.size && star(first.id)?.textContent === '★', 'favorite success updates star');
      check(patches === 2 && star(first.id).classList.contains('is-favorite') && star(first.id).getAttribute('aria-pressed') === 'true', 'favorite selected with single save');
      window.fetch = realFetch;
      const before = await (await requestApi(API + '/mistakes/' + first.id)).json();
      check(before.favorite === 1 && before.review_revision === first.review_revision, 'favorite persists without review reset');
      favorites.click();
      await waitUntil(() => currentMistakes.length === 1 && currentMistakes[0].id === first.id && !document.querySelector('#mistakeList .loading-tip'), 'favorite checkbox filters');
      document.getElementById('mistakeStatusFilter').value = 'unreviewed';
      document.getElementById('mistakeStatusFilter').dispatchEvent(new Event('change'));
      await waitUntil(() => !document.querySelector('#mistakeList .loading-tip'), 'status live filter');
      await waitUntil(() => document.querySelector('#mistakeFilterTags input[value="${data.child.id}"]'), 'tag filters loaded');
      document.querySelector('#mistakeFilterTags input[value="${data.child.id}"]').click();
      await waitUntil(() => !document.querySelector('#mistakeList .loading-tip') && mistakeUi.nodeIds.includes(${data.child.id}), 'tag live filter');
      check(currentMistakes.length === 1 && mistakeUi.favorite === 'true' && mistakeUi.q === '统一列表' && mistakeUi.reviewStatus === 'unreviewed', 'all four filters combine');
      star(first.id).click();
      await waitUntil(() => !mistakeFavoritePending.size && !document.querySelector('#mistakeList .loading-tip'), 'unfavorite completes');
      check(currentMistakes.length === 0 && favorites.checked, 'unfavorite removes row from favorite results');
      favorites.click();
      await waitUntil(() => currentMistakes.length === 2 && !document.querySelector('#mistakeList .loading-tip'), 'uncheck favorites restores matching list');
      card(first.id).querySelector('.mistake-actions button:nth-child(2)').click();
      await waitUntil(() => currentView.type === 'mistake' && mistakeDetailState?.row?.id === first.id, 'view button opens detail');
      check(!mistakeDetailState.review && document.getElementById('mistakeReviewToolbar').style.display === 'none', 'ordinary detail has no direct review entry');
      await backFromDetail(); await loadMistakes();
      card(first.id).querySelector('.mistake-actions button:nth-child(3)').click();
      await waitUntil(() => mistakeEditPending?.id === first.id, 'edit button opens existing dialog');
      check(currentView.type === 'course', 'edit stays on list');
      document.getElementById('mistakeEditTitle').value = '统一列表第一题已编辑';
      await saveMistakeDetail(); check(card(first.id).textContent.includes('已编辑'), 'edit updates list');
      // 复习入口只在「错题」大页：分类详情页没有任何复习按钮，从大页开始复习会打开四分类选择弹窗。
      check(!document.querySelector('#mistakeSelectionHeader button'), 'category page has no review entry');
      await openMistakeCategory(null);
      check(document.getElementById('mistakeHomeReview').style.display === 'flex', 'home keeps the review entry');
      document.getElementById('mistakeHomeReviewStart').click();
      await waitUntil(() => mistakeReviewPicker && !mistakeReviewPicker.pickerLoading, 'home start opens unified picker');
      check(document.querySelectorAll('[data-review-category]').length === 4 && !mistakeReviewPicker.pickerType && currentView.type === 'course', 'unified picker shows four categories');
      document.querySelector('[data-review-category="knowledge"]').click();
      await waitUntil(() => mistakeSelectionCurrent() && !mistakeSelection.listLoading, 'picker category loads');
      document.querySelector('[data-mistake-id="' + first.id + '"] .mistake-select-check').click();
      check(mistakeSelection.ids.has(first.id), 'picker checkbox selects item');
      document.getElementById('mistakeReviewPickerStart').click();
      await waitUntil(() => mistakeQueueCurrent() && mistakeDetailState.progress?.stage === 'question' && !mistakeQueueLoading, 'unified entry starts queue');
      document.querySelector('[data-review-action="recall-clear"]').click();
      await waitUntil(() => mistakeDetailState.progress.stage === 'answer' && !mistakeReviewBusy, 'queue reveals answer');
      document.querySelector('[data-review-action="judge-true"]').click();
      await waitUntil(() => mistakeDetailState.progress.reviewStatus === 'reviewed' && !mistakeReviewBusy, 'queue judgment saved');
      await nextMistakeQueueItem(); check(currentView.type === 'mistakeQueueComplete', 'selected single item queue completes');
      check(document.getElementById('mistakeCompleteModal').classList.contains('show')
        && document.getElementById('mistakeCompleteTitle').textContent.includes('恭喜')
        && document.getElementById('mistakeCompleteConfetti').children.length > 0, 'perfect round celebrates with confetti');
      await backFromDetail(); await openMistakeCategory('knowledge'); await clearMistakeFilters();
      card(second.id).querySelector('.mistake-actions button:nth-child(4)').click();
      await waitUntil(() => document.getElementById('confirmModal').classList.contains('show'), 'delete opens existing confirmation');
      closeConfirm(false);
      await new Promise(resolve => setTimeout(resolve,50));
      check(card(second.id), 'cancel delete retains item');
      card(second.id).querySelector('.mistake-actions button:nth-child(4)').click();
      await waitUntil(() => document.getElementById('confirmModal').classList.contains('show'), 'delete confirmation again');
      closeConfirm(true);
      await waitUntil(() => !currentMistakes.some(item => item.id === second.id) && !document.querySelector('#mistakeList .loading-tip'), 'delete updates list');
      check((await fetch(API + '/mistakes/' + second.id)).status === 404, 'delete persisted');
      await requestApi(API + '/mistakes/' + first.id,{method:'DELETE'});
      await openMistakeCategory(null); await clearMistakeFilters();
    }
  `;
}
module.exports = { mistakeListBrowserScenario };
