const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./temp-backend-fixture.cjs'),{runBrowser}=require('./browser-driver.cjs');

test('mistake question and answer reuse recognition choices and Markdown/LaTeX previews',{timeout:90000},()=>fixture(async({ids,api,serve,temp})=>{
  const course=ids.courseId;
  const row=await api('POST',`/courses/${course}/mistakes`,{
    title:'富文本错题',
    content:'题目 $x^2$',
    answerContent:'答案 $\\frac{1}{2}$',
    explanation:'先整理公式，再核对答案。',
    mistakeType:'knowledge'
  },201);
  const url=await serve();
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  assert.ok(chrome);
  const script=`window.COURSES_API_BASE=${JSON.stringify('/api')};addEventListener('load',async()=>{
    const out=document.createElement('pre');out.id='regressionResult';
    const wait=async(fn,message)=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,20))}throw Error(message)};
    const check=(value,message)=>{if(!value)throw Error(message)};
    try{
      await openCourse(${course},'错题富文本','mistakes');
      await openMistakeDetail(${row.id},false);
      await wait(()=>document.getElementById('mistakeDetailName').textContent==='富文本错题','detail loaded');
      check(document.getElementById('mistakeDetailContent').querySelector('.katex'),'question detail renders LaTeX');
      check(document.getElementById('mistakeAnswerText').querySelector('.katex'),'answer detail renders LaTeX');
      await openMistakeEdit();
      const advice=document.getElementById('mistakeEditReviewModeAdvice');
      check(advice?.disabled&&advice.getAttribute('aria-disabled')==='true','edit AI advice stays disabled before connection');
      check(getComputedStyle(advice).backgroundColor!=='rgb(74, 108, 247)','edit AI advice is not highlighted before connection');
      check(document.getElementById('mistakeEditQuestionRecognitionMethod')?.querySelectorAll('option').length===2,'question recognition choices');
      check(document.getElementById('mistakeEditAnswerRecognitionMethod')?.querySelectorAll('option').length===2,'answer recognition choices');
      check(document.getElementById('mistakeCreateQuestionRecognitionMethod')?.querySelectorAll('option').length===2,'create question recognition choices');
      check(document.getElementById('mistakeCreateAnswerRecognitionMethod')?.querySelectorAll('option').length===2,'create answer recognition choices');
      const question=document.getElementById('mistakeEditContent'),answer=document.getElementById('mistakeEditAnswer');
      check(question.previousElementSibling?.classList.contains('course-text-mode'),'question source/preview controls');
      check(answer.previousElementSibling?.classList.contains('course-text-mode'),'answer source/preview controls');
      question.value='题目 $a^2+b^2=c^2$';courseRichText.setMode('mistakeEditContent','preview');
      check(document.getElementById('mistakeEditContentPreview').querySelector('.katex'),'question preview renders math');
      courseRichText.setMode('mistakeEditContent','edit');
      answer.value='答案 $\\\\frac{a}{b}$';courseRichText.setMode('mistakeEditAnswer','preview');
      check(document.getElementById('mistakeEditAnswerPreview').querySelector('.katex'),'answer preview renders math');
      courseRichText.reset();
      const method=document.getElementById('mistakeEditQuestionRecognitionMethod');
      method.value='vision';method.dispatchEvent(new Event('change'));
      check(recognitionMethodFor('mistakeEditQuestionOcrBtn')==='vision','vision recognition can be selected without uploading');
      closeMistakeEdit();
      out.textContent='PASS';document.body.append(out);
    }catch(error){out.textContent=error.stack;document.body.append(out)}
  });`;
  const html=await runBrowser({chrome,profile:path.join(temp,'mistake-rich'),url,viewport:[1280,960],initScript:script,noSandbox:true});
  const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];
  assert.match(result||'',/PASS/,result||html.slice(-2000));
}));
