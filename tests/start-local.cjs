const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');

test('Windows launcher uses direct Node, safe mock environment, correct cwd and real exit code',{skip:process.platform!=='win32'},()=>{
  const script=fs.readFileSync(path.join(root,'start-local.ps1'),'utf8');
  assert.equal(script.charCodeAt(0),0xfeff,'retain BOM for Windows PowerShell Chinese');
  assert.doesNotMatch(script,/\$package\.scripts\.start|Get-Tool 'npm.cmd'|& \$npmPath/);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'courses-launch-'));
  try{
    const project=path.join(temp,'中文 project with spaces'),back=path.join(project,'back');fs.mkdirSync(back,{recursive:true});
    // Isolate listener discovery only: this fake backend opens no port or database.
    // Production launcher still checks actual 3000/3002 listeners.
    const isolated=script.replace('function Get-OccupiedPorts {','function Get-OccupiedPorts {\n    return @()');
    fs.writeFileSync(path.join(project,'start-local.ps1'),isolated);
    fs.writeFileSync(path.join(back,'package.json'),JSON.stringify({scripts:{start:'this-command-must-never-be-run'}}));
    for(const exit of [0,7]){
      fs.writeFileSync(path.join(back,'server.js'),`console.log('LAUNCH_TEST:'+JSON.stringify({cwd:process.cwd(),ai:process.env.AI_PROVIDER,real:process.env.AI_ENABLE_REAL,ocr:process.env.OCR_PROVIDER,python:process.env.PYTHONPATH,nodeOptions:process.env.NODE_OPTIONS,npmOptions:process.env.NPM_CONFIG_NODE_OPTIONS}));process.exit(${exit});`);
      const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(project,'start-local.ps1'),'-Service','Node'],{
        cwd:temp,input:'\r\n',encoding:'utf8',windowsHide:true,timeout:20000,
        env:{...process.env,AI_PROVIDER:'real-provider-must-not-run',AI_ENABLE_REAL:'true',OCR_PROVIDER:'http',NODE_OPTIONS:'--require=missing-preload-must-not-load',NPM_CONFIG_NODE_OPTIONS:'--require=missing-preload-must-not-load'}
      });
      assert.ifError(result.error);assert.equal(result.status,exit,result.stdout+result.stderr);
      const marker=result.stdout.match(/LAUNCH_TEST:(\{[^\r\n]+\})/);assert.ok(marker,result.stdout+result.stderr);
      const data=JSON.parse(marker[1]);
      assert.equal(data.cwd.toLowerCase(),back.toLowerCase());assert.equal(data.ai,'mock');assert.equal(data.real,'false');assert.equal(data.ocr,'mock');
      assert.equal(data.python,path.join(project,'.local-ai-deps'));assert.equal(data.nodeOptions,undefined);assert.equal(data.npmOptions,undefined);
      assert.match(result.stdout,new RegExp('退出码：'+exit));
    }
  }finally{fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
