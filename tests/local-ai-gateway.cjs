const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('../back/node_modules/express');
const {createLocalAiGateway}=require('../back/localAiGateway');
const fs=require('node:fs'),vm=require('node:vm');

test('website API stays on the current loopback hostname',()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../fronted/js/config.js'),'utf8');
 for(const hostname of ['localhost','127.0.0.1']){
  const ctx=vm.createContext({location:{protocol:'http:',port:'3000',hostname}});vm.runInContext(source,ctx);assert.equal(vm.runInContext('API',ctx),'/api');
 }
});
async function service(t,fetchImpl){
 const app=express();app.use(express.json());app.use('/api/ai',createLocalAiGateway({fetchImpl,timeoutMs:30}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
 return (path='/test',headers={},body={api_key:'synthetic-only',action:'connection'})=>{
    if(headers.Host)return new Promise((resolve,reject)=>{
      const request=require('node:http').request(base+'/api/ai'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...headers}},response=>{response.resume();resolve({status:response.statusCode});});
      request.on('error',reject);request.end(JSON.stringify(body));
    });
    return fetch(base+'/api/ai'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...headers},body:JSON.stringify(body)});
  };
}
test('all supported AI routes forward only to fixed local service',async t=>{
 let hits=0;const request=await service(t,async(url,init)=>{hits++;assert.match(url,/^http:\/\/127\.0\.0\.1:3002\/api\/ai\//);assert.equal(init.redirect,'error');assert.equal(init.headers.Origin,'http://127.0.0.1:3002');assert.equal(JSON.parse(init.body).api_key,'synthetic-only');return new Response(JSON.stringify({ok:true,provider:'compatible'}));});
 for(const path of ['/test','/classify','/answer-draft','/review-suggestion','/review-mode-advice','/material-draft','/review-feedback','/assessment-chart']){const r=await request(path);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');}
 assert.equal(hits,8);assert.equal((await request('/other')).status,404);
});
test('foreign origin, host and forwarded requests never reach AI',async t=>{
 let hits=0;const request=await service(t,async()=>{hits++;throw Error('no call');});
 for(const headers of [{Origin:'http://evil.example'},{Origin:'null'},{Host:'evil.example'},{'X-Forwarded-For':'127.0.0.1'},{Forwarded:'for=127.0.0.1'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await request('/test',headers)).status,403,JSON.stringify(headers));
 assert.equal(hits,0);
});
test('missing service, response bounds and upstream errors have safe messages',async t=>{
 const missing=await service(t,async()=>{throw Error('synthetic-secret');});let r=await missing();assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'LOCAL_AI_UNAVAILABLE'});
 const large=await service(t,async()=>new Response('x'.repeat(70000)));r=await large();assert.equal(r.status,502);
 const failing=await service(t,async()=>new Response(JSON.stringify({error:'AI_AUTH_FAILED',detail:'synthetic-secret'}),{status:502}));r=await failing();assert.deepEqual(await r.json(),{error:'AI_AUTH_FAILED'});
});

test('obsolete AI routes return a local compatibility error instead of an upstream Key error', async t=>{
 for(const status of [404,405]){
  const request=await service(t,async()=>new Response(JSON.stringify({detail:'Method Not Allowed'}),{status}));
  const response=await request();
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'LOCAL_AI_INCOMPATIBLE'});
 }
});

test('dedicated AI port keeps a loopback destination and forwards health checks without a model call', async t=>{
 let hit=false;
 const app=express();
 app.use('/api/ai',createLocalAiGateway({port:3003,fetchImpl:async(url,init)=>{
  hit=true;
  assert.equal(url,'http://127.0.0.1:3003/api/ai/local-health');
  assert.equal(init.headers.Origin,'http://127.0.0.1:3003');
  assert.equal(init.method,'GET');
  assert.equal(init.body,undefined);
  return new Response(JSON.stringify({service:'courses-local-ai'}));
 }}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/ai/local-health`);
 assert.equal(response.status,200);assert.equal(hit,true);
 assert.deepEqual(await response.json(),{service:'courses-local-ai'});
 for(const port of ['localhost:80','https://evil.invalid',0,65536,'3003/path'])assert.throws(()=>createLocalAiGateway({port}));
});
const {test: outlineGatewayTest}=require('node:test');
outlineGatewayTest('outline forwards the same 2 MiB input bound as Python and rejects oversize without a call',async t=>{
 let hits=0;const request=await service(t,async(url,init)=>{
  hits++;assert.equal(JSON.parse(init.body).purpose,'outline_draft');
  return new Response(JSON.stringify({provider:'deepseek',result:{outline:'- Writing',needs_review:true}}));
 });
 const body={api_key:'synthetic-only',purpose:'outline_draft',input:{title:'Writing',text:'字'.repeat(7000)}};
 assert.equal((await request('/outline-polish',{},body)).status,200);
 assert.equal(hits,1);
 body.input.text='字'.repeat(800000);
 assert.equal((await request('/outline-polish',{},body)).status,413);
 assert.equal(hits,1);
});
