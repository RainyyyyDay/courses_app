const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const os = require('node:os'), http = require('node:http');
const { runBrowser } = require('./browser-driver.cjs');
const root = path.resolve(__dirname, '..');
const browserSource = fs.readFileSync(path.join(root, 'fronted/js/ocrBrowser.js'), 'utf8');
function bulletTrial() {
  const c=vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root,'fronted/js/utils.js'),'utf8'),c);
  return c.ocrBulletTrialText;
}
test('bullet experiment normalizes glyphs and fills only evidenced sequential items',()=>{
  const trial=bulletTrial();
  assert.equal(trial('第一场 选妆：正文。\n第二场 赠囊：正文。\n●第七场：正文。'),
    '第一场 选妆：正文。\n第二场 赠囊：正文。\n• 第七场：正文。','nonconsecutive items stay unfilled');
  assert.equal(trial('第一场：正文。\n•第二场：正文。\n第三场：正文。'),
    '• 第一场：正文。\n• 第二场：正文。\n• 第三场：正文。');
  assert.equal(trial('●项目甲\n◦ 项目乙\n▪项目丙'), '• 项目甲\n• 项目乙\n• 项目丙');
  const unchanged='第一场：正文。\n第二场：正文。\n第三场：正文。\n· x = 2\nx · y = 4\n?\n000\n1/3\nA. 选项\n1. 编号';
  assert.equal(trial(unchanged),unchanged);
  assert.equal(trial('第一场：正文。\n●第二场：正文。\n\n第三场：正文。'),
    '第一场：正文。\n• 第二场：正文。\n\n第三场：正文。');
  assert.equal(trial('第一场：正文。\n●第二场：正文。\n【第 2 页】\n第三场：正文。'),
    '第一场：正文。\n• 第二场：正文。\n【第 2 页】\n第三场：正文。');
});
function context() {
  const c = vm.createContext({ document: { addEventListener() {} }, window: {}, location: { protocol: 'http:' },
    console, DOMException, AbortController, File, FormData, performance });
  vm.runInContext(browserSource, c);
  return c;
}
const first = '植物通过光合作用将太阳的光能转化为';
const second = '化学能并储存在有机物中。';
function line(text, y = 0, x = 10, width = 360, height = 20, page) {
  return { text, box: [[x,y],[x+width,y],[x+width,y+height],[x,y+height]], page };
}
function result(lines, extra = {}) { return { text: lines.map(l => l.text).join('\n'), lines, provider: 'browser', ...extra }; }

test('long Chinese and English continuations join without changing characters', () => {
  const c = context(), source = result([line(first), line(second, 30, 10, 250)]);
  const formatted = c.formatOcrParagraphs(source);
  assert.equal(formatted.text, first + second);
  assert.equal(formatted.rawText, source.text);
  assert.equal(source.text, first + '\n' + second);
  assert.equal(c.formatOcrParagraphs(formatted), formatted, 'formatting is idempotent');
  assert.equal(c.formatOcrParagraphs(result([line('Photosynthesis converts sunlight into'), line('chemical energy.',30,10,200)])).text,
    'Photosynthesis converts sunlight into chemical energy.');
  for (const prefix of ['1. ', '（1）', 'A. ']) {
    assert.equal(c.formatOcrParagraphs(result([line(prefix+first),line(second,30,10,250)])).text,prefix+first+second);
  }
});

test('preserves paragraphs, options, headings, equations, missing geometry and uncertain layouts', () => {
  const c = context();
  const cases = [
    [line(first+'。'),line(second,30)],
    [line(first),line(second,65)],
    [line(first),line(second,30,50)],
    [line(first,0,10,220),line(second,30)],
    [line(first),line('1. '+second,30)],
    [line('1. '+first),line('2. '+second,30)],
    [line('A. '+first),line('B. '+second,30)],
    [line(first),line('A. '+second,30)],
    [line(first),line('（B）'+second,30)],
    [line(first),line('二、'+second,30)],
    [line(first),line('解析：'+second,30)],
    [line(first),line('• '+second,30)],
    [line(first+' x=2'),line(second,30)],
    [line(first+'  30%'),line(second,30)],
    [line(first),line(second,30,10,360,32)],
    [line(first),line(second,30),line('另一栏文字',0,450,300)],
    [line(first),line(second,30),line('单元格',30,450,90)],
    [line(first),{text:second}],
    [line('标题'),line(second,30)],
    [line(first),line(second,-30)],
  ];
  for (const lines of cases) {
    const source = result(lines);
    assert.equal(c.formatOcrParagraphs(source).text,source.text,JSON.stringify(lines));
  }
  const malformed = result([line(first), {text:second,box:[[0,30],[null,30],[20,50],[0,50]]}]);
  assert.equal(c.formatOcrParagraphs(malformed).text,malformed.text);
});

test('PDF page boundaries and text layers survive mixed-page formatting', () => {
  const c = context();
  const lines = [line(first,0,10,360,20,1),line(second,30,10,250,20,1),
    {text:'PDF native text\nretains its layout',page:2},line(first,0,10,360,20,3),line(second,30,10,250,20,3)];
  const raw = '【第 1 页】\n'+first+'\n'+second+'\n\n【第 2 页】\nPDF native text\nretains its layout\n\n【第 3 页】\n'+first+'\n'+second;
  const formatted = c.formatOcrParagraphs({text:raw,lines,pages:3});
  assert.equal(formatted.text,raw.replaceAll(first+'\n'+second,first+second));
  assert.equal(formatted.rawText,raw);
  const unknownPages = result([line(first),line(second,30)],{pages:2});
  assert.equal(c.formatOcrParagraphs(unknownPages).text,unknownPages.text);
  const differentPages = result([line(first,0,10,360,20,1),line(second,30,10,360,20,2)],{pages:2});
  assert.equal(c.formatOcrParagraphs(differentPages).text,differentPages.text);
  for (const provider of ['office-browser','mock']) {
    const source = result(lines,{provider}); assert.equal(c.formatOcrParagraphs(source),source);
  }
});

test('split headings and hanging bullets do not disable single-column paragraph merging',()=>{
  const c=context();
  // Geometry reproduces the reported screenshot, with synthetic course text.
  const a='●第一节 导论：这里是一段需要在图片右边界折行的长正文';
  const b='继续阅读本段的剩余内容。';
  const d='• 第二节 正文：这是另一条需要保留独立条目但合并内部折行的内容';
  const e='这是第二条的剩余内容。';
  const lines=[line('课程版《阅读资料》',90,30,282,37),line('(8节)',87,332,97,44),
    line(a,168,46,1238,40),line(b,220,81,266,33),
    line(d,273,45,1270,32),line(e,320,81,420,33),
    line('第三节 小结：这一条必须独立。',369,46,1093,35)];
  const formatted=c.formatOcrParagraphs(result(lines));
  assert.equal(formatted.text,'课程版《阅读资料》(8节)\n'+a+b+'\n'+d+e+'\n第三节 小结：这一条必须独立。');
  assert.equal(formatted.rawText,lines.map(l=>l.text).join('\n'));
});

test('unrelated page regions and isolated missing boxes do not veto ordinary body lines',()=>{
  const c=context();
  const lines=[line('工具栏左侧',0,10,200),line('工具栏右侧',0,450,200),
    {text:'没有坐标的独立标签'},line('正文标题',150,10,100),
    line(first,200,50,360),line(second,230,50,250)];
  const formatted=c.formatOcrParagraphs(result(lines));
  assert.equal(formatted.text,lines.slice(0,4).map(l=>l.text).join('\n')+'\n'+first+second);
  const columns=[line(first,200,50,360),line(second,230,50,250),
    line('右栏中与左栏并列的独立正文',200,500,300)];
  assert.equal(c.formatOcrParagraphs(result(columns)).text,result(columns).text);
});

test('real image entry and HTTP fallback both return smart and original text', async () => {
  const c = context(), lines = [line(first),line(second,30,10,250)];
  c.getOcrWebEngine = async () => ({predict:async()=>[{items:lines.map(l=>({text:l.text,poly:l.box,score:.99}))}]});
  const file = new File(['synthetic'],'test.png',{type:'image/png'});
  const direct = await c.recognizeTextInBrowser(file);
  assert.equal(direct.text,first+second); assert.equal(direct.rawText,first+'\n'+second);
  const source = fs.readFileSync(path.join(root,'fronted/js/mistakes.js'),'utf8');
  vm.runInContext(source.slice(source.indexOf('async function recognizeUploadedFile('),source.indexOf('\nfunction ocrProviderLabel')),c);
  c.recognizeTextInBrowser = async () => {throw Error('synthetic browser failure')};
  c.showToast=()=>{};c.API='/api';
  c.requestApi=async()=>({json:async()=>result(lines,{provider:'paddle'})});
  const fallback = await c.recognizeUploadedFile(file);
  assert.equal(fallback.text,direct.text);assert.equal(fallback.rawText,direct.rawText);
  assert.match(fallback.warnings[0],/synthetic browser failure/);
});

test('backend normalization preserves coordinates and page numbers for fallback', () => {
  const c = vm.createContext({require,module:{exports:{}},process,console});
  vm.runInContext(fs.readFileSync(path.join(root,'back/ocr/service.js'),'utf8')+'\nmodule.exports.normalizeResult=normalizeResult;',c);
  const source=result([line(first,0,10,360,20,1),line(second,30,10,250,20,2)]);
  const normalized=c.module.exports.normalizeResult(source,'paddle');
  assert.deepEqual(normalized.lines[0].box,source.lines[0].box);
  assert.equal(normalized.lines[1].page,2);
});

test('scanned PDF entry merges within each selected page and keeps page headings',async()=>{
  const c=context();
  c.document.createElement=()=>({width:0,height:0,getContext(){return{}},toBlob(fn){fn(new Blob(['scan']))}});
  c.pdfjsLib={getDocument:()=>({promise:Promise.resolve({numPages:2,async getPage(){return{
    getTextContent:async()=>({items:[]}),getViewport:()=>({width:500,height:700}),
    render:()=>({promise:Promise.resolve()}),cleanup(){}
  }},async destroy(){}})})};
  c.getOcrWebEngine=async()=>({predict:async()=>[{items:[line(first),line(second,30,10,250)].map(l=>({text:l.text,poly:l.box,score:.98}))}]});
  const pdf=await c.recognizeTextInBrowser(new File(['scan'],'scanned.pdf',{type:'application/pdf'}));
  assert.equal(pdf.text,'【第 1 页】\n'+first+second+'\n\n【第 2 页】\n'+first+second);
  assert.equal(pdf.rawText,'【第 1 页】\n'+first+'\n'+second+'\n\n【第 2 页】\n'+first+'\n'+second);
});

test('proofreading modes retain edits, emit input, clear stale state and fit mobile',{timeout:60000},async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ocr-paragraph-ui-'));
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
  assert.ok(chrome);
  const server=http.createServer((req,res)=>{
    if(req.url==='/utils.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,'fronted/js/utils.js')));return;}
    if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(fs.readFileSync(path.join(root,'fronted/style.css')));return;}
    res.setHeader('Content-Type','text/html;charset=utf-8');
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><script src="/utils.js"></script>
      <main style="padding:16px" data-pending-adoption="false"><textarea aria-label="识别结果" style="width:100%"></textarea></main><script>
      const out=document.createElement('pre');out.id='regressionResult';
      const check=(value,message)=>{if(!value)throw Error(message)};
      try{const area=document.querySelector('textarea');let inputs=0;area.addEventListener('input',()=>inputs++);
      setOcrTextResult(area,{text:'合并文本',rawText:'原始\\n文本'});
      const select=document.querySelector('select');check(area.value==='合并文本','default smart');area.value+='手工修改';
      select.value='raw';select.dispatchEvent(new Event('change'));check(area.value==='原始\\n文本','raw text');check(document.querySelector('main').dataset.pendingAdoption==='true','switch requires adoption again');area.value+='原始修改';
      select.value='smart';select.dispatchEvent(new Event('change'));check(area.value==='合并文本手工修改','smart edits kept');
      select.value='raw';select.dispatchEvent(new Event('change'));check(area.value==='原始\\n文本原始修改','raw edits kept');check(inputs===3,'input events');
      area.disabled=true;select.value='smart';select.dispatchEvent(new Event('change'));check(area.value.endsWith('原始修改')&&select.value==='raw','busy preserves draft');area.disabled=false;
      check(document.querySelector('.ocr-paragraph-control').getBoundingClientRect().right<=innerWidth,'mobile control fits');
      check(select.options.length===3,'opt-in trial available');
      select.value='bullets';select.dispatchEvent(new Event('change'));check(area.value==='合并文本','trial draft');area.value+='试验修改';
      select.value='raw';select.dispatchEvent(new Event('change'));check(area.value==='原始\\n文本原始修改','raw edits survive trial');
      select.value='bullets';select.dispatchEvent(new Event('change'));check(area.value==='合并文本试验修改','trial edits preserved');
      setOcrTextResult(area,null);check(!document.querySelector('select')&&area.value==='','cleared');
      setOcrTextResult(area,{text:'新结果',rawText:'新结果'});check(document.querySelectorAll('select').length===1,'fresh control');
      setOcrTextResult(area,{text:'Word原文'});check(!document.querySelector('select')&&area.value==='Word原文','native text preserved');out.textContent='PASS';
      }catch(e){out.textContent='FAIL '+e.stack}document.body.append(out);</script>`);
  });
  try{await new Promise(r=>server.listen(0,'127.0.0.1',r));
    for(const viewport of [[1280,900],[390,844]]){
      const html=await runBrowser({chrome,profile:path.join(temp,viewport.join('x')),url:'http://127.0.0.1:'+server.address().port,viewport,timeoutMs:20000});
      assert.match(html,/<pre id="regressionResult">PASS<\/pre>/,html.slice(-1800));
    }
  }finally{await new Promise(r=>server.close(r));fs.rmSync(temp,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
});
