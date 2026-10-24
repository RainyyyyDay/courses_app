// 同一天只提前复习其中一道题时，日历和当天弹窗仍要保留同一天的完整排期。
function reviewPlanDayMergeBrowserScenario() {
  return `
    {
      const today = planLocalDate();
      const exam = new Date(Date.parse(today + 'T00:00:00Z') + 86400000 * 5).toISOString().slice(0, 10);
      const course = await (await requestApi(API + '/courses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '排期合并浏览器测试' })
      })).json();
      const materialA = await (await requestApi(API + '/courses/' + course.id + '/materials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '合并资料A', content: 'A' })
      })).json();
      const materialB = await (await requestApi(API + '/courses/' + course.id + '/materials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '合并资料B', content: 'B' })
      })).json();
      const mistake = await (await requestApi(API + '/courses/' + course.id + '/mistakes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '合并错题', content: '题', mistakeType: 'knowledge', answerContent: '答' })
      })).json();
      const plan = await (await requestApi(API + '/courses/' + course.id + '/review-plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '合并排期', startDate: today, examDate: exam,
          selectedItems: [
            { type: 'material', id: materialA.id },
            { type: 'material', id: materialB.id },
            { type: 'mistake', id: mistake.id }
          ]
        })
      })).json();
      const schedule = await (await requestApi(API + '/courses/' + course.id + '/review-plans/' + plan.id + '/schedule')).json();
      const day = schedule.days.find(item => item.date > today && item.items.length >= 3
        && item.items.some(entry => entry.type === 'mistake'));
      check(day, 'merge fixture has a full multi-item day');
      const session = await (await requestApi(API + '/courses/' + course.id + '/review-sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'merge-browser-session', sourceType: 'plan', sourceId: plan.id,
          scheduledDate: day.date, selectedItems: [{ type: 'mistake', id: mistake.id }]
        })
      })).json();
      const detail = await (await requestApi(API + '/courses/' + course.id + '/review-sessions/' + session.id)).json();
      const sessionItem = detail.items.find(item => item.item_type === 'mistake');
      const before = await (await requestApi(API + '/courses/' + course.id + '/mistakes/' + mistake.id + '/review?sessionItemId=' + sessionItem.id)).json();
      const started = await (await requestApi(API + '/courses/' + course.id + '/mistakes/' + mistake.id + '/review?sessionItemId=' + sessionItem.id, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', requestId: 'merge-browser-start', expectedVersion: before.version })
      })).json();
      await requestApi(API + '/courses/' + course.id + '/mistakes/' + mistake.id + '/review/events?sessionItemId=' + sessionItem.id, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recall', recall: 'clear', requestId: 'merge-browser-recall', expectedVersion: started.version })
      });
      const answered = await (await requestApi(API + '/courses/' + course.id + '/mistakes/' + mistake.id + '/review?sessionItemId=' + sessionItem.id)).json();
      await requestApi(API + '/courses/' + course.id + '/mistakes/' + mistake.id + '/review/events?sessionItemId=' + sessionItem.id, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'judge', correct: true, requestId: 'merge-browser-judge', expectedVersion: answered.version })
      });
      openCourse(course.id, course.name, 'reviewPlans');
      await openReviewPlan(plan.id);
      await waitUntil(() => reviewPlanDetail?.schedule?.days?.some(item => item.date === day.date), 'merged plan schedule loaded');
      const cell = document.querySelector('#reviewPlanCalendar [data-plan-date="' + day.date + '"]');
      check(cell, 'merged calendar day exists');
      check(cell.querySelector('.plan-calendar-count').textContent.trim() === '1/3项', 'partial session keeps the full day count and successful count');
      cell.click();
      await waitUntil(() => document.getElementById('reviewPlanDayModal').classList.contains('show'), 'merged day popup opens');
      check(document.querySelectorAll('#reviewPlanDayBody .review-day-card').length === 1, 'the whole day remains one combined task card');
      check(document.getElementById('reviewPlanDayBody').textContent.includes('份资料') && document.getElementById('reviewPlanDayBody').textContent.includes('道错题'), 'combined day card lists populated categories and counts');
      check(document.getElementById('reviewPlanDayBody').textContent.includes('成功复习 1 / 3'), 'day stats use the full valid day total');
      closePlanScheduleDay();
    }
  `;
}

module.exports = { reviewPlanDayMergeBrowserScenario };
