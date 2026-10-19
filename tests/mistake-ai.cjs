// node --test tests/mistake-ai.cjs — 不启动后端、不读数据库、不加载 .env、不发外部请求。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const vm = require('node:vm');
const { runBrowser } = require('./browser-driver.cjs');
const { mistakeAiBrowserScenario } = require('./mistake-ai-frontend.cjs');
const root = path.resolve(__dirname, '..');
const input = {question:'1+1=?',student_answer:'3',error_type:'careless'};
const output = {review_method:'retry',reason:'Mock only',needs_review:true};

function adapter(fetch, globals = {}) {
  const ctx = vm.createContext({fetch,AbortController,TextEncoder,setTimeout,clearTimeout,...globals});
  vm.runInContext("const API='https://example.invalid/api';" + fs.readFileSync(path.join(root,'fronted/js/ai.js'),'utf8'),ctx);
  return (body=input,options={}) => {ctx.body=body;ctx.options=options;return vm.runInContext('classifyMistakeWithAi(body,options)',ctx);};
}
const reply = (data,status=200) => new Response(JSON.stringify(data),{status});

test('file/configuration errors are distinct from local mock connection failures', async () => {
  let calls=0;
  const fetch=async()=>{calls++;throw new TypeError('connection refused');};
  await assert.rejects(adapter(fetch,{location:{protocol:'file:'}})(),{code:'AI_API_NOT_CONFIGURED'});
  for(const base of ['',42,null])await assert.rejects(adapter(fetch,{COURSES_AI_API_BASE:base})(),{code:'AI_API_NOT_CONFIGURED'});
  assert.equal(calls,0);
  await assert.rejects(adapter(fetch,{COURSES_AI_API_BASE:'/api',COURSES_AI_LOCAL_MOCK:true})(),err=>err.code==='LOCAL_MOCK_UNAVAILABLE' && err.message.includes('重试'));
  assert.equal(calls,1);
});

test('adapter uses existing API base, fixed JSON contract, no keys or user identity', async () => {
  let captured;
  const classify=adapter(async(url,options)=>{captured={url,...options};return reply({...output,extra:'discard'});});
  assert.equal(JSON.stringify(await classify()),JSON.stringify(output));
  assert.equal(captured.url,'https://example.invalid/api/ai/classify');
  assert.equal(captured.method,'POST');
  assert.deepEqual(JSON.parse(captured.body),input);
  assert.deepEqual({...captured.headers},{'Content-Type':'application/json'});
});
test('adapter validates whitelist, UTF-16 fields and UTF-8 body before fetching', async () => {
  let calls=0;const classify=adapter(async()=>{calls++;return reply(output);});
  for(const body of [{...input,user_id:'forged'},{...input,question:'x'.repeat(4001)},[],{...input,context:42}]) {
    await assert.rejects(classify(body),{code:'INVALID_INPUT'});
  }
  await assert.rejects(classify({...input,question:'中'.repeat(4000),student_answer:'文'.repeat(4000)}),{code:'BODY_TOO_LARGE'});
  assert.equal(calls,0);
});
test('adapter enforces method/reason/manual-review output contract', async () => {
  for(const data of [null,{...output,review_method:'knowledge'},{...output,review_method:'recall'},
    {...output,review_method:'guided'},{...output,review_method:['retry']},
    {...output,reason:''},{...output,reason:'x'.repeat(501)},{...output,needs_review:false}]) {
    await assert.rejects(adapter(async()=>reply(data))(),{code:'INVALID_RESPONSE'});
  }
  await assert.rejects(adapter(async()=>new Response('not json'))(),{code:'INVALID_RESPONSE'});
});

test('adapter accepts seven documented modes plus unclassified sentinel', async()=>{
  for(const method of ['choice_reproduction','standard','cloze','self_explain','reading','contrast','retry','unclassified']){
    assert.equal((await adapter(async()=>reply({...output,review_method:method}))()).review_method,method);
  }
});
test('HTTP errors use safe messages including 503/401/403/429/504 and allow retry', async () => {
  for(const [status,code,pattern] of [[503,'AI_AUTH_NOT_CONFIGURED',/尚未接入网站授权/],
    [503,'AI_BUSY',/繁忙/],[503,'UNKNOWN',/暂不可用/],[401,'AUTH_REQUIRED',/登录/],
    [403,'DENIED',/无权/],[429,'RATE_LIMITED',/频繁/],[504,'AI_TIMEOUT',/超时/],[502,'AI_UNAVAILABLE',/失败/]]) {
    const classify=adapter(async()=>reply({error:code,message:'SECRET',detail:'/internal/path'},status));
    await assert.rejects(classify(),err=>err.status===status && pattern.test(err.message) && !/SECRET|internal/.test(err.message));
  }
});
test('network errors are sanitized; explicit retry is possible with the same input', async () => {
  let fail=true;
  const classify=adapter(async()=>{if(fail)throw new Error('SECRET');return reply(output);});
  await assert.rejects(classify(),{code:'NETWORK_ERROR'});fail=false;
  assert.equal((await classify()).review_method,'retry');
});
test('total timeout covers stalled fetch and response body, even when mock ignores abort', async () => {
  for(const fetch of [()=>new Promise(()=>{}), async()=>({ok:true,json:()=>new Promise(()=>{})})]) {
    await assert.rejects(adapter(fetch)(input,{timeoutMs:20}),{code:'AI_TIMEOUT'});
  }
});
test('caller cancellation aborts request and prevents stale response adoption', async () => {
  const controller=new AbortController(); let signal;
  const classify=adapter(async(_,options)=>{signal=options.signal;return new Promise(()=>{});});
  const pending=classify(input,{signal:controller.signal}); controller.abort();
  await assert.rejects(pending,{name:'AbortError'}); assert.ok(signal.aborted);
  let calls=0;await assert.rejects(adapter(async()=>{calls++;})(input,{signal:controller.signal}),{name:'AbortError'});
  assert.equal(calls,0);
});

for(const viewport of [[1280,960],[390,844]]) test('real detail UI mock regression '+viewport.join('x'),{timeout:90000},async()=>{
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>fs.existsSync(p));
  assert.ok(chrome,'Chrome/Edge is required for the browser test (not installed by this test)');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'courses-ai-ui-'));
  const front=path.join(root,'fronted');
  const scenario=mistakeAiBrowserScenario(); new vm.Script(scenario);
  const index=fs.readFileSync(path.join(front,'index.html'),'utf8')
    .replace('<script src="app.js"></script>','')
    // 启动自检要求课程列表非空；该隔离测试不启动课程 API，放置明确的虚构占位。
    .replace('<div class="course-list" id="courseList"></div>','<div class="course-list" id="courseList">AI 交互测试（虚构数据）</div>')
    .replace('<head>','<head><script>window.fetch=()=>Promise.reject(new Error("Unexpected network request"));</script>')
    .replace('</body>','<script>'+scenario+'</script></body>');
  const server=http.createServer((req,res)=>{
    if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(index);return;}
    const relative=decodeURIComponent(req.url.split('?')[0]).slice(1);
    const filename=path.resolve(front,relative);
    // 只提供测试页面的前端静态文件；永远不提供 API/.env/数据库。
    if(!filename.startsWith(front+path.sep)||! /\.(js|css|svg|png|woff2?)$/.test(filename)||!fs.existsSync(filename)) {res.writeHead(404).end();return;}
    res.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript; charset=utf-8':filename.endsWith('.css')?'text/css; charset=utf-8':'application/octet-stream');
    res.end(fs.readFileSync(filename));
  });
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const html=await runBrowser({chrome,profile:path.join(temp,'profile'),viewport,url:'http://127.0.0.1:'+server.address().port+'/'});
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];
    assert.match(result||'',/data-result="passed"/,result||'browser did not complete');
  } finally {
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    // temp 是本测试 mkdtemp 的明确返回值，且 profile 只在此目录中。
    fs.rmSync(temp,{recursive:true,force:true,maxRetries:8,retryDelay:200});
  }
});
