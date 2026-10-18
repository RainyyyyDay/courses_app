// Set the document viewport explicitly: Chrome's native window minimum can exceed 390px.
// Uses the browser's built-in DevTools protocol; no extra test dependency is required.
const fs=require('node:fs');
const {spawn}=require('node:child_process');

async function runBrowser({chrome,profile,url,viewport,screenshot,noSandbox}) {
  const browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
    ...(noSandbox ? ['--no-sandbox','--disable-software-rasterizer'] : []),
    '--remote-debugging-port=0','--user-data-dir='+profile,'--window-size='+viewport.join(','),'about:blank'],{windowsHide:true});
  let socket,sequence=0;const pending=new Map();
  try {
    const endpoint=await new Promise((resolve,reject)=>{
      let output='';const timeout=setTimeout(()=>reject(new Error('Browser debugging endpoint timed out')),15000);
      browser.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
      browser.once('error',err=>{clearTimeout(timeout);reject(err);});
      browser.once('exit',code=>{clearTimeout(timeout);reject(new Error('Browser exited before connection: '+code));});
    });
    socket=new WebSocket(endpoint);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    socket.addEventListener('message',event=>{
      const message=JSON.parse(String(event.data)),request=pending.get(message.id);if(!request)return;
      pending.delete(message.id);clearTimeout(request.timeout);
      if(message.error)request.reject(new Error(message.error.message));else request.resolve(message.result);
    });
    const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
      const id=++sequence,timeout=setTimeout(()=>{pending.delete(id);reject(new Error('Browser protocol timeout: '+method));},15000);
      pending.set(id,{resolve,reject,timeout});socket.send(JSON.stringify({id,method,params,...(sessionId ? {sessionId} : {})}));
    });
    const {targetInfos}=await send('Target.getTargets'),target=targetInfos.find(item=>item.type==='page');
    const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
    const page=(method,params)=>send(method,params,sessionId);
    const [width,height]=viewport;
    await page('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600,screenWidth:width,screenHeight:height});
    await page('Page.navigate',{url});
    const deadline=Date.now()+120000;
    while(Date.now()<deadline) {
      try {
        const {result}=await page('Runtime.evaluate',{expression:"document.getElementById('regressionResult') ? document.documentElement.outerHTML : null",returnByValue:true});
        if(typeof result.value==='string') {
          if(screenshot){const {data}=await page('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(screenshot,Buffer.from(data,'base64'));}
          return result.value;
        }
      }catch(err){if(!/context|navigat/i.test(err.message))throw err;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    const {result}=await page('Runtime.evaluate',{expression:'document.documentElement.outerHTML',returnByValue:true});
    throw new Error('Browser scenarios timed out: '+String(result.value).slice(-4000));
  }finally {
    for(const request of pending.values()){clearTimeout(request.timeout);request.reject(new Error('Browser closed'));}pending.clear();
    if(socket)socket.close();
    if(browser.exitCode===null)await new Promise(resolve=>{browser.once('exit',resolve);browser.kill();});
  }
}
module.exports={runBrowser};
