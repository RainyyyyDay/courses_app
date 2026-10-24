const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..');

async function stop(child) {
  if(!child||child.exitCode!==null)return;
  await new Promise(resolve=>{
    const timer=setTimeout(resolve,3000);
    child.once('exit',()=>{clearTimeout(timer);resolve();});
    child.kill();
  });
  if(child.exitCode===null){
    child.kill('SIGKILL');
    await new Promise(resolve=>{
      const timer=setTimeout(resolve,1000);
      child.once('exit',()=>{clearTimeout(timer);resolve();});
    });
  }
}

// Isolated Node backend and static frontend server for focused integration tests.
async function fixture(run) {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'courses-review-mode-')),back=path.join(temp,'back');
  fs.mkdirSync(back);
  let child,staticServer;
  try {
    for(const file of ['server.js','aiProxy.js','localAiGateway.js','db.js']){
      fs.copyFileSync(path.join(root,'back',file),path.join(back,file));
    }
    for(const folder of ['db','ai','ocr','officePreview']){
      fs.cpSync(path.join(root,'back',folder),path.join(back,folder),
        {recursive:true,filter:p=>fs.statSync(p).isDirectory()||p.endsWith('.js')});
    }
    const env={...process.env,NODE_PATH:path.join(root,'back/node_modules'),AI_PROVIDER:'mock',
      AI_ENABLE_REAL:'false',OCR_PROVIDER:'mock'};
    delete env.NODE_OPTIONS;delete env.NPM_CONFIG_NODE_OPTIONS;
    const seed=spawnSync(process.execPath,['-e',`
      const store=require('./db/index.js'),course=store.createCourse('复习方式测试');
      console.log(JSON.stringify({courseId:course.id}));store.db.close();
    `],{cwd:back,env,encoding:'utf8',windowsHide:true});
    assert.equal(seed.status,0,seed.stderr);
    const ids=JSON.parse(seed.stdout.trim());
    const read=fn=>{const db=new DatabaseSync(path.join(back,'data/app.db'),{readOnly:true});try{return fn(db);}finally{db.close();}};
    const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
    const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
    const serverPath=path.join(back,'server.js');
    fs.writeFileSync(serverPath,fs.readFileSync(serverPath,'utf8')
      .replace(/app\.listen\(3000,\s*(?:listenHost,\s*)?/,`app.listen(${port}, '127.0.0.1', `));
    const base='http://127.0.0.1:'+port+'/api';
    let logs='';
    const start=async()=>{
      child=spawn(process.execPath,['server.js'],{cwd:back,env,windowsHide:true});
      child.stdout.on('data',chunk=>{logs+=chunk;});child.stderr.on('data',chunk=>{logs+=chunk;});
      for(let index=0;index<150;index++) {
        try { if((await fetch(base+'/courses')).ok)return; } catch {}
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      throw Error(logs);
    };
    await start();
    const api=async(method,url,body,status=200)=>{
      const response=await fetch(base+url,{method,...(body===undefined?{}:
        {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
      const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
    };
    const serve=async()=>{
      const frontend=path.join(root,'fronted');
      staticServer=http.createServer((request,response)=>{
        const file=path.resolve(frontend,decodeURIComponent(request.url.split('?')[0]).slice(1)||'index.html');
        if(!file.startsWith(frontend+path.sep)||! /\.(html|js|css|png|svg|wasm|tar)$/.test(file)||!fs.existsSync(file)){
          response.writeHead(404).end();return;
        }
        response.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':
          file.endsWith('.js')?'text/javascript; charset=utf-8':
          file.endsWith('.css')?'text/css; charset=utf-8':'application/octet-stream');
        response.end(fs.readFileSync(file));
      });
      await new Promise(resolve=>staticServer.listen(0,'127.0.0.1',resolve));
      return 'http://127.0.0.1:'+staticServer.address().port+'/';
    };
    await run({temp,back,ids,api,read,base,serve,restart:async()=>{await stop(child);await start();}});
  } finally {
    await stop(child);
    if(staticServer?.listening)await new Promise(resolve=>staticServer.close(resolve));
    fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
}

module.exports={fixture};
