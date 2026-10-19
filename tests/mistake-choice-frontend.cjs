// 选择题复现：真实浏览器里验证自动模式、选项渲染、错误/正确两种判分和编辑回显。
function mistakeChoiceBrowserScenario() {
  return `
    {
      const courseResponse = await requestApi(API + '/courses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '选择题模式浏览器测试' })
      });
      const course = await courseResponse.json();
      const mistakeResponse = await requestApi(API + '/courses/' + course.id + '/mistakes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '选择题复现', content: '1+1=?', mistakeType: 'knowledge',
          questionFormat: 'choice', choiceType: 'single',
          options: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }, { id: 'C', text: '3' }],
          correctOption: 'B'
        })
      });
      const mistake = await mistakeResponse.json();
      openCourse(course.id, course.name, 'mistakes');
      await openMistakeDetail(mistake.id, true);
      await waitUntil(() => mistakeDetailState?.progress?.mode?.id === 'choice_reproduction'
        && mistakeDetailState.progress.stage === 'idle', 'choice mode loaded');
      await submitMistakeReview('start');
      await waitUntil(() => mistakeDetailState.progress.stage === 'question'
        && document.querySelectorAll('.mistake-choice-option').length === 3, 'choice options rendered');
      check(!document.getElementById('mistakeReviewAnswer'), 'choice answer hidden before submit');
      document.querySelector('input[name="mistakeChoiceOption"][value="C"]').click();
      submitMistakeChoice();
      await waitUntil(() => mistakeDetailState.progress.stage === 'completed'
        && !mistakeReviewBusy && document.getElementById('mistakeReviewPanel').textContent.includes('回答错误'), 'wrong choice submitted');
      check(mistakeDetailState.progress.choice.correct === false
        && mistakeDetailState.progress.reviewStatus === 'unreviewed', 'wrong choice stays unreviewed');
      check(document.getElementById('mistakeReviewPanel').textContent.includes('回答错误'), 'wrong choice feedback');
      await submitMistakeReview('start');
      await waitUntil(() => mistakeDetailState.progress.stage === 'question', 'choice restarted');
      document.querySelector('input[name="mistakeChoiceOption"][value="B"]').click();
      submitMistakeChoice();
      await waitUntil(() => mistakeDetailState.progress.stage === 'completed'
        && mistakeDetailState.progress.reviewStatus === 'reviewed' && !mistakeReviewBusy
        && document.getElementById('mistakeReviewPanel').textContent.includes('回答正确'), 'correct choice reviewed');
      check(mistakeDetailState.progress.choice.correct === true, 'correct choice feedback');
      if (location.hash !== '#choiceOnly') {
        await openMistakeDetail(mistake.id, false);
        await openMistakeEdit();
        await waitUntil(() => mistakeEditPending && document.getElementById('mistakeEditModal').classList.contains('show'), 'choice edit opens');
        check(document.getElementById('mistakeEditFormat').value === 'choice'
          && document.getElementById('mistakeEditChoiceType').value === 'single'
          && [...document.querySelectorAll('#mistakeEditOptionsList .choice-option-input')].map(input => input.value).join('|') === '1|2|3'
          && document.querySelector('#mistakeEditAnswerOptions input:checked')?.value === 'B', 'choice fields restored');
        const answerCard = document.querySelector('#mistakeEditAnswerOptions .choice-answer-option');
        const answerLetter = answerCard?.querySelector('span');
        const cardRect = answerCard?.getBoundingClientRect(), letterRect = answerLetter?.getBoundingClientRect();
        check(cardRect && letterRect && letterRect.left >= cardRect.left && letterRect.right <= cardRect.right + 1,
          'answer letter stays inside its choice card ' + JSON.stringify({ card: cardRect, letter: letterRect }));
        if (location.hash === '#choiceEditOnly') {
          await new Promise(resolve => setTimeout(resolve, 400));
          document.getElementById('mistakeEditChoiceFields').scrollIntoView({ block: 'center' });
        } else {
        closeMistakeEdit();
        const multi = await (await requestApi(API + '/courses/' + course.id + '/mistakes', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: '多选题复现', content: '选出正确的', mistakeType: 'knowledge',
            questionFormat: 'choice', choiceType: 'multiple',
            options: [{ id: 'A', text: '甲' }, { id: 'B', text: '乙' }, { id: 'C', text: '丙' }],
            correctOption: ['A', 'C']
          })
        })).json();
        await openMistakeDetail(multi.id, true);
        await waitUntil(() => mistakeDetailState?.progress?.mode?.id === 'choice_reproduction'
          && mistakeDetailState.progress.stage === 'idle', 'multiple choice mode loaded');
        await submitMistakeReview('start');
        await waitUntil(() => mistakeDetailState.progress.stage === 'question'
          && document.querySelectorAll('input[name="mistakeChoiceOption"][type="checkbox"]').length === 3, 'multiple choice checkboxes');
        document.querySelector('input[name="mistakeChoiceOption"][value="A"]').click();
        document.querySelector('input[name="mistakeChoiceOption"][value="C"]').click();
        submitMistakeChoice();
        await waitUntil(() => mistakeDetailState.progress.stage === 'completed'
          && mistakeDetailState.progress.reviewStatus === 'reviewed' && !mistakeReviewBusy, 'multiple choice reviewed');
        check(JSON.stringify(mistakeDetailState.progress.choice.selectedOption) === JSON.stringify(['A', 'C'])
          && mistakeDetailState.progress.choice.correct === true, 'multiple choice answer saved as array');
        await openMistakeDetail(multi.id, false);
        await openMistakeEdit();
        await waitUntil(() => mistakeEditPending && document.getElementById('mistakeEditModal').classList.contains('show'), 'multiple choice edit opens');
        check(document.getElementById('mistakeEditChoiceType').value === 'multiple'
          && [...document.querySelectorAll('#mistakeEditAnswerOptions input:checked')].map(input => input.value).join(',') === 'A,C', 'multiple choice edit restores selection');
      const multiCard = document.querySelector('#mistakeEditAnswerOptions .choice-answer-option');
      const multiLetter = multiCard?.querySelector('span');
      const multiCardRect = multiCard?.getBoundingClientRect(), multiLetterRect = multiLetter?.getBoundingClientRect();
      check(multiCardRect && multiLetterRect && multiLetterRect.left >= multiCardRect.left
        && multiLetterRect.right <= multiCardRect.right + 1, 'multiple answer letter stays inside its choice card');
        closeMistakeEdit();
        await loadCourses();
        }
      }
    }
  `;
}

module.exports = { mistakeChoiceBrowserScenario };
