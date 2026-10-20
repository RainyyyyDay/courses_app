// Launcher regression: only a fictional Node entry is executed. No project
// database, dotenv file, model, service window or browser is opened.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');

test('local launcher runs Node directly from a path with spaces/Chinese and fixes inherited providers',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'courses-launcher-'));
  const project=path.join(temp,'课程 website');
  try{
    fs.mkdirSync(path.join(project,'back'),{recursive:true});
    fs.copyFileSync(path.join(__dirname,'../start-local.ps1'),path.join(project,'start-local.ps1'));
    fs.writeFileSync(path.join(project,'back/package.json'),JSON.stringify({scripts:{start:'node nonexistent-npm-entry.js'}}));
    fs.writeFileSync(path.join(project,'back/server.js'),`
      console.log('LAUNCHER_TEST '+JSON.stringify({cwd:process.cwd(),ai:process.env.AI_PROVIDER,real:process.env.AI_ENABLE_REAL,ocr:process.env.OCR_PROVIDER,preload:process.env.NODE_OPTIONS??null}));
      process.exit(Number(process.env.LAUNCHER_TEST_EXIT||0));
    `);
    for(const exitCode of [0,7]){
      const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(project,'start-local.ps1'),'-Service','Node'],{
        cwd:temp,windowsHide:true,encoding:'utf8',input:'\n',timeout:15000,
        env:{...process.env,AI_PROVIDER:'http',AI_ENABLE_REAL:'true',OCR_PROVIDER:'http',NODE_OPTIONS:'--require=nonexistent-preload',LAUNCHER_TEST_EXIT:String(exitCode)}
      });
      assert.ifError(result.error);assert.equal(result.status,exitCode,result.stdout+'\n'+result.stderr);
      const match=result.stdout.match(/LAUNCHER_TEST (.+)/);assert.ok(match,result.stdout+'\n'+result.stderr);
      const observed=JSON.parse(match[1]);assert.equal(observed.cwd,path.join(project,'back'));
      assert.equal(observed.ai,'mock');assert.equal(observed.real,'false');assert.equal(observed.ocr,'mock');assert.equal(observed.preload,null);
    }
  }finally{
    // Exact directory freshly allocated above; contains only the fictional fixture.
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
