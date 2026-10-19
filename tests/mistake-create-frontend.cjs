// 错题上传弹窗：使用与编辑错题一致的图标卡片结构，并显示已选文件摘要。
function mistakeCreateBrowserScenario() {
  return `
    {
      const course = await (await requestApi(API + '/courses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '错题上传卡片测试' })
      })).json();
      openCourse(course.id, course.name, 'mistakes');
      pendingUploadFile = new File(['preview'], '错题截图.png', { type: 'image/png' });
      await openTagPicker('upload', 'mistake', null);
      await waitUntil(() => document.getElementById('tagPickerModal').classList.contains('show')
        && !document.getElementById('tagPickerTree').textContent.includes('加载中'), 'mistake create modal');
      check(document.querySelectorAll('#tagPickerMistakeFields .edit-card').length === 4, 'create modal uses four icon cards');
      check(document.getElementById('tagPickerTitle').textContent === '上传错题', 'create modal title');
      check(document.getElementById('mistakeCreateFileSummary').textContent.includes('错题截图.png'), 'create file summary');
      check(document.getElementById('tagPickerTagHeading').style.display === 'flex', 'create tag heading');
      check(document.getElementById('tagPickerBody').classList.contains('mistake-create-body'), 'create card background');
      document.getElementById('mistakeCreateFormat').value = 'choice';
      toggleMistakeChoiceFields('Create');
      document.getElementById('mistakeCreateChoiceType').value = 'multiple';
      changeMistakeChoiceType('Create');
      addMistakeChoiceOption('Create');
      addMistakeChoiceOption('Create');
      const optionInputs = [...document.querySelectorAll('#mistakeCreateOptionsList .choice-option-input')];
      check(optionInputs.length === 4, 'choice editor starts with two and appends options');
      check([...document.querySelectorAll('#mistakeCreateOptionsList .choice-option-letter')].map(el => el.textContent).join('') === 'A.B.C.D.', 'system assigns A-D labels');
      optionInputs.forEach((input, index) => { input.value = String(index + 1); input.dispatchEvent(new Event('input')); });
      const answerInputs = [...document.querySelectorAll('#mistakeCreateAnswerOptions input')];
      check(answerInputs.length === 4 && answerInputs.every(input => input.type === 'checkbox'), 'multiple answer selector only lists added letters');
      answerInputs[0].click();
      document.querySelectorAll('#mistakeCreateAnswerOptions input')[2].click();
      check([...document.querySelectorAll('#mistakeCreateAnswerOptions input:checked')].map(input => input.value).join(',') === 'A,C', 'multiple correct answers selectable');
      document.getElementById('mistakeCreateChoiceType').value = 'single';
      changeMistakeChoiceType('Create');
      const singleInputs = [...document.querySelectorAll('#mistakeCreateAnswerOptions input')];
      check(singleInputs.every(input => input.type === 'radio')
        && singleInputs.filter(input => input.checked).length === 1, 'single choice limits answer to one radio');
      document.getElementById('mistakeCreateChoiceType').value = 'multiple';
      changeMistakeChoiceType('Create');
      document.querySelectorAll('#mistakeCreateAnswerOptions input')[2].click();
      check([...document.querySelectorAll('#mistakeCreateAnswerOptions input:checked')].map(input => input.value).join(',') === 'A,C', 'switching back to multiple restores multi-select');
      const payload = mistakeChoiceFields('Create');
      check(payload.choiceType === 'multiple' && payload.options.length === 4
        && JSON.stringify(payload.correctOption) === JSON.stringify(['A', 'C']), 'multiple choice payload is normalized');
      if (location.hash === '#mistakeCreateOnly') await new Promise(resolve => setTimeout(resolve, 400));
      document.getElementById('mistakeCreateChoiceFields').scrollIntoView({ block: 'center' });
      if (location.hash !== '#mistakeCreateOnly') closeTagPicker();
    }
  `;
}

module.exports = { mistakeCreateBrowserScenario };
