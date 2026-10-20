const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');

test('Windows launcher separates AI mock and real OCR, retains cwd/exit codes and tolerates unhealthy OCR',{skip:process.platform!=='win32'},()=>{
  const script=fs.readFileSync(path.join(root,'start-local.ps1'),'utf8');
  assert.equal(script.charCodeAt(0),0xfeff,'retain BOM for Windows PowerShell Chinese');
  assert.doesNotMatch(script,/\$package\.scripts\.start|Get-Tool 'npm.cmd'|& \$npmPath/);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'courses-launch-'));
  try{
    const project=path.join(temp,'中文 project with spaces'),back=path.join(project,'back');fs.mkdirSync(back,{recursive:true});
    // Isolate listener discovery only: this fake backend opens no port or database.
    // Production launcher still checks actual 3000/3002 listeners.
    const isolated=script.replace('function Get-OccupiedPorts {','function Get-OccupiedPorts {\n    return @()').replace('function Test-LocalOcrHealth {','function Test-LocalOcrHealth {\n    return $true');
    fs.writeFileSync(path.join(project,'start-local.ps1'),isolated);
    fs.writeFileSync(path.join(back,'package.json'),JSON.stringify({scripts:{start:'this-command-must-never-be-run'}}));
    for(const exit of [0,7]){
      fs.writeFileSync(path.join(back,'server.js'),`console.log('LAUNCH_TEST:'+JSON.stringify({cwd:process.cwd(),ai:process.env.AI_PROVIDER,real:process.env.AI_ENABLE_REAL,ocr:process.env.OCR_PROVIDER,ocrBase:process.env.OCR_API_BASE,python:process.env.PYTHONPATH,nodeOptions:process.env.NODE_OPTIONS,npmOptions:process.env.NPM_CONFIG_NODE_OPTIONS}));process.exit(${exit});`);
      const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(project,'start-local.ps1'),'-Service','Node'],{
        cwd:temp,input:'\r\n',encoding:'utf8',windowsHide:true,timeout:20000,
        env:{...process.env,AI_PROVIDER:'real-provider-must-not-run',AI_ENABLE_REAL:'true',OCR_PROVIDER:'http',NODE_OPTIONS:'--require=missing-preload-must-not-load',NPM_CONFIG_NODE_OPTIONS:'--require=missing-preload-must-not-load'}
      });
      assert.ifError(result.error);assert.equal(result.status,exit,result.stdout+result.stderr);
      const marker=result.stdout.match(/LAUNCH_TEST:(\{[^\r\n]+\})/);assert.ok(marker,result.stdout+result.stderr);
      const data=JSON.parse(marker[1]);
      assert.equal(data.cwd.toLowerCase(),back.toLowerCase());assert.equal(data.ai,'mock');assert.equal(data.real,'false');assert.equal(data.ocr,'http');assert.equal(data.ocrBase,'http://127.0.0.1:8001');
      assert.equal(data.python,path.join(project,'.local-ai-deps'));assert.equal(data.nodeOptions,undefined);assert.equal(data.npmOptions,undefined);
      assert.match(result.stdout,new RegExp('退出码：'+exit));
    }
    fs.writeFileSync(path.join(project,'start-local.ps1'),isolated.replace('return $true','return $false'));
    const degraded=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(project,'start-local.ps1'),'-Service','Node'],{cwd:temp,input:'\r\n',encoding:'utf8',windowsHide:true,timeout:20000});
    assert.equal(degraded.status,7,'backend executes and preserves its own exit code despite OCR outage');assert.match(degraded.stdout,/OCR 暂不可用/);assert.match(degraded.stdout,/LAUNCH_TEST:/,'backend still starts on OCR failure');
  }finally{fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

test('OCR launcher has portable ordered Python discovery, isolated dependency checks and explicit health/logging',()=>{
  const script=fs.readFileSync(path.join(root,'ocr-service/start.ps1'),'utf8');
  assert.equal(script.charCodeAt(0),0xfeff);
  assert.ok(script.indexOf("'.venv\\Scripts\\python.exe'")<script.indexOf("Get-Command 'py.exe'"));
  assert.ok(script.indexOf("Get-Command 'py.exe'")<script.indexOf("Get-Command 'python.exe'"));
  assert.doesNotMatch(script,/C:\\Users\\LENOVO|pip install|Stop-Process/);
  assert.match(script,/Prefix=@\('-3'\)/);assert.match(script,/-I -B -c \$probe/);
  assert.match(script,/provider -eq 'paddleocr'/);assert.match(script,/RedirectStandardError/);
  const main=fs.readFileSync(path.join(root,'start-local.ps1'),'utf8');
  const optionalStart=main.search(/-File \$ocrScript\r?\n/);
  assert.ok(optionalStart>=0&&main.indexOf("Start-Process -FilePath 'http://127.0.0.1:3002/'")<optionalStart,'website opens before optional OCR startup');
});

test('main launcher allows missing OCR/preflight/start failures while retaining website startup',{skip:process.platform!=='win32'},()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'courses-optional-ocr-'));
  try{
    const project=path.join(temp,'项目 with spaces');
    for(const folder of ['back','fronted','ai-fastapi','.local-ai-deps','ocr-service'])fs.mkdirSync(path.join(project,folder),{recursive:true});
    for(const file of ['back/server.js','ai-fastapi/test_app.py','fronted/index.html','.local-ai-deps/fastapi.py','.local-ai-deps/uvicorn.py'])fs.writeFileSync(path.join(project,file),'');
    fs.writeFileSync(path.join(project,'back/package.json'),'{}');
    // Stub only external side effects: no real services, DB, browser or OCR model.
    const script=fs.readFileSync(path.join(root,'start-local.ps1'),'utf8')
      .replace('function Get-OccupiedPorts {','function Get-OccupiedPorts {\n    return @()')
      .replace('function Test-LocalOcrHealth {','function Test-LocalOcrHealth {\n    return $false')
      .replace('function Test-LoopbackPort([int]$Port) {','function Test-LoopbackPort([int]$Port) {\n    return $true')
      .replace('function Start-ServiceWindow([string]$Name) {','function Start-ServiceWindow([string]$Name) {\n    Write-Host "TEST_SERVICE:$Name"; return')
      .replace("$schema = Invoke-RestMethod -Uri 'http://127.0.0.1:3002/openapi.json' -TimeoutSec 2","$schema = @{paths=@{'/api/ai/classify'=@{post=$true}}}")
      .replace("Start-Process -FilePath 'http://127.0.0.1:3002/' | Out-Null","Write-Host 'TEST_BROWSER'");
    fs.writeFileSync(path.join(project,'start-local.ps1'),script);
    const ocr=path.join(project,'ocr-service/start.ps1');
    for(const variant of ['missing','preflight-failure','start-failure']){
      if(variant==='preflight-failure')fs.writeFileSync(ocr,'param([switch]$CheckOnly)\nexit 1');
      if(variant==='start-failure')fs.writeFileSync(ocr,"param([switch]$CheckOnly)\nif($CheckOnly){exit 0}; Write-Host 'TEST_OCR_FAILURE'; exit 1");
      for(const checkOnly of [true,false]){
        const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(project,'start-local.ps1'),...(checkOnly?['-CheckOnly']:[])],{
          cwd:temp,encoding:'utf8',windowsHide:true,timeout:25000,env:{...process.env,NODE_PATH:path.join(root,'back/node_modules')}
        });
        assert.ifError(result.error);assert.equal(result.status,0,variant+'\n'+result.stdout+result.stderr);
        if(checkOnly){assert.doesNotMatch(result.stdout,/TEST_BROWSER|TEST_SERVICE:/);}
        else{
          assert.match(result.stdout,/TEST_SERVICE:Node/);assert.match(result.stdout,/TEST_SERVICE:AI/);assert.match(result.stdout,/TEST_BROWSER/);
          assert.match(result.stdout,/8001 暂不可用/);
          if(variant==='start-failure')assert.ok(result.stdout.indexOf('TEST_BROWSER')<result.stdout.indexOf('TEST_OCR_FAILURE'),'OCR failure occurs after browser opens');
        }
      }
    }
  }finally{fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
