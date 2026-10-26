const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),net=require('node:net');
const {fork,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
async function exercise(owned,menu=false){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'course-service-control-'));let child;
 try{
  const identity=crypto.createHash('sha256').update(temp.toLowerCase()).digest('hex'),script=path.join(temp,'fixture-server.cjs');
  fs.writeFileSync(script,`const http=require('node:http');const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({service:'courses-local-website',project_id:${JSON.stringify(owned?identity:'foreign-project')},pid:process.pid}));});server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));`);
  child=fork(script,[],{silent:true,windowsHide:true});const {port}=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);});
  const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const aiPort=probe.address().port;await new Promise(r=>probe.close(r));
  let helper=fs.readFileSync(path.join(root,'service-control.ps1'),'utf8').replaceAll(':3000',':'+port).replaceAll('-LocalPort 3000','-LocalPort '+port).replaceAll(':3003',':'+aiPort).replaceAll('-LocalPort 3003','-LocalPort '+aiPort);fs.writeFileSync(path.join(temp,'service-control.ps1'),helper);fs.copyFileSync(path.join(root,'manage-local.ps1'),path.join(temp,'manage-local.ps1'));
  if(!owned)fs.writeFileSync(path.join(temp,'.local-service-processes.json'),JSON.stringify({project_id:identity,website:{id:child.pid,started:'0',executable:process.execPath},aiWorker:null,aiRunner:null}));
  if(menu)fs.writeFileSync(path.join(temp,'start-local.ps1'),"\ufeffparam([switch]$NoOpen)\nWrite-Host '模拟启动完成'\nexit 0\n");
  const result=spawnSync(powershell,['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(temp,'manage-local.ps1'),'-Action',menu?'Menu':'Stop','-NoOpen'],{input:menu?'2\r\n0\r\n':undefined,encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(result.status,0,result.stdout+result.stderr);
  if(owned){await assert.rejects(fetch('http://127.0.0.1:'+port+'/api/local-service'));assert(!fs.existsSync(path.join(temp,'.local-service-processes.json')));}
  else {assert.equal((await fetch('http://127.0.0.1:'+port+'/api/local-service')).status,200,'foreign project and reused PID stay alive');}
 }finally{if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
test('PowerShell stop closes its own project service',{timeout:60000},()=>exercise(true));
test('PowerShell stop leaves other projects and reused PIDs untouched',{timeout:60000},()=>exercise(false));
test('Windows launch scripts retain UTF-8 BOM for PowerShell 5.1',()=>{for(const name of ['start-local.ps1','manage-local.ps1','service-control.ps1'])assert.equal(fs.readFileSync(path.join(root,name)).subarray(0,3).toString('hex'),'efbbbf',name);});

test('launcher menu option 2 stops services and option 0 exits the console',{timeout:60000},()=>exercise(true,true));
