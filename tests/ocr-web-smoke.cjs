// Offline browser OCR on a synthetic canvas, no personal uploads/database/LLM.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {runBrowser}=require('./browser-driver.cjs');
test('prepared browser OCR recognizes a synthetic image without Python or external requests',{timeout:120000},async()=>{
  const front=path.resolve(__dirname,'../fronted'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'courses-ocr-smoke-'));
  const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
  const page=`<!doctype html><meta charset="utf-8"><script src="/js/ocrBrowser.js"></script><script>
addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';try{
 const canvas=document.createElement('canvas');canvas.width=900;canvas.height=240;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,900,240);ctx.fillStyle='black';ctx.font='64px Arial';ctx.fillText('Math 1 + 1 = 2',50,130);
 const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));const result=await recognizeTextInBrowser(new File([blob],'synthetic.png',{type:'image/png'}));
 if(result.provider!=='browser'||!result.text.includes('2'))throw Error('synthetic OCR returned no expected text');
 out.dataset.result='passed';out.textContent='Browser OCR passed on synthetic content; no Python service used';
 }catch(e){out.dataset.result='failed';out.textContent=e.message;}document.body.append(out);});</script>`;
  const requests=[];
  const server=http.createServer((req,res)=>{
    const relative=decodeURIComponent(req.url.split('?')[0]);requests.push(relative);
    if(relative==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(page);return;}
    const file=path.resolve(front,'.'+relative);
    if(!file.startsWith(front+path.sep)||!(relative.startsWith('/vendor/ocr/')||relative==='/js/ocrBrowser.js')||!fs.existsSync(file)){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.wasm')?'application/wasm':'application/octet-stream');fs.createReadStream(file).pipe(res);
  });
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const html=await runBrowser({chrome,profile,url:'http://127.0.0.1:'+server.address().port+'/',viewport:[900,600],blockedUrls:['https://*/*','http://localhost:3000/*','http://127.0.0.1:8001/*']});
    const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/data-result="passed"/,result||html.slice(-1000));
    assert.ok(requests.some(p=>p.endsWith('.wasm'))&&requests.some(p=>p.endsWith('.tar')),'real local runtime and model files were requested');
  }finally{await new Promise(r=>server.close(r));fs.rmSync(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
});
