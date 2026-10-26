// 总复习全部通过后，结果弹窗只显示实际选中的类别，并触发彩带。
function totalReviewCompleteBrowserScenario() {
  return `
    {
      const course = await (await requestApi(API + '/courses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '总复习完成浏览器测试' })
      })).json();
      const first = await (await requestApi(API + '/courses/' + course.id + '/materials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '完成资料A', content: 'A' })
      })).json();
      const second = await (await requestApi(API + '/courses/' + course.id + '/materials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '完成资料B', content: 'B' })
      })).json();
      openCourse(course.id, course.name, 'reviewPlans');
      await openTotalReview();
      selectTotalReviewVisible(true);
      await startTotalReview();
      await waitUntil(() => currentView.type === 'readingReview' && activeReadingReview.row?.id === first.id, 'total review first material');
      await activeReadingReview.save('reviewed');
      await waitUntil(() => currentCenterItem()?.item_id === second.id && activeReadingReview.row?.id === second.id, 'total review second material');
      await activeReadingReview.save('reviewed');
      await waitUntil(() => document.getElementById('mistakeCompleteModal').classList.contains('show'), 'total review complete modal');
      check(reviewCompleteSummary({ items: [{ item_type: 'mistake' }, { item_type: 'note' }, { item_type: 'note' }, { item_type: 'material' }] })
        === '1 道错题、2 篇笔记、1 份资料', 'completion summary lists selected categories only');
      check(document.getElementById('mistakeCompleteTitle').textContent.includes('恭喜你！你成功复习了 2 份资料'), 'complete title lists selected category');
      check(!document.getElementById('mistakeCompleteTitle').textContent.includes('0 '), 'complete title omits unselected categories');
      check(document.getElementById('mistakeCompleteText').textContent.includes('全部通过'), 'complete text reports perfect round');
      check(typeof mistakeConfettiLayerState === 'function' && mistakeConfettiLayerState() !== 'none', 'confetti effect runs for perfect total review');
      const totalActions=[...document.querySelectorAll('#mistakeCompleteModal .modal-actions button')].filter(button=>!button.hidden);
      check(totalActions.length===3&&!document.getElementById('reviewCompleteStartNew').hidden,'non-plan completion retains start-new-review');
      check(new Set(totalActions.map(button=>Math.round(button.getBoundingClientRect().top))).size===1,'non-plan completion actions stay on one row');
      if (location.hash !== '#totalCompleteOnly') {
        document.getElementById('reviewCompleteClose').click();
        await waitUntil(() => !document.getElementById('mistakeCompleteModal').classList.contains('show'), 'complete modal cancel');
      }
    }
  `;
}

module.exports = { totalReviewCompleteBrowserScenario };
