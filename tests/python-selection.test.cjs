const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const root=fs.existsSync(path.join(__dirname,'ai-python.ps1'))?__dirname:path.resolve(__dirname,'..');
const target=fs.existsSync(path.join(root,'.local-ai-deps'))?root:'C:/Users/YJSen/Desktop/学习模块/课程复习模块/courses_app-main (2)/courses_app-main';
const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
function run(explicit){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'course-python-selection-'));
 try{
  const script=path.join(temp,'probe.ps1');
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  fs.writeFileSync(script,'\ufeff'+[
   "$ErrorActionPreference = 'Stop'",
   '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
   '. '+quote(path.join(root,'ai-python.ps1')),
   '$env:PYTHONPATH = '+quote(path.join(target,'.local-ai-deps')),
   "$env:PATH = 'C:\\Python314;D:\\Miniforge;' + $env:PATH",
   '$env:COURSES_AI_PYTHON = '+quote(explicit||''),
   'try { $selected = Select-LocalAiPython -ProjectRoot '+quote(temp)+'; $selected | ConvertTo-Json -Compress } catch { Write-Output $_.Exception.Message; exit 1 }'
  ].join('\r\n'));
  const result=spawnSync(shell,['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',script],{encoding:'utf8',windowsHide:true,timeout:60000});
  return {...result,log:fs.existsSync(path.join(temp,'local-ai-environment.log'))?fs.readFileSync(path.join(temp,'local-ai-environment.log'),'utf8'):''};
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
test('Windows double-click PATH falls back from incompatible 3.14 to working 3.13',()=>{
 const result=run(); assert.equal(result.status,0,result.stdout+result.stderr);
 const selected=JSON.parse(result.stdout); assert.match(selected.Version,/^3\.13\./); assert.equal(selected.Source.toLowerCase(),'d:\\miniforge\\python.exe');
 assert.match(result.log,/C:\\Python314\\python.exe/); assert.match(result.log,/ImportError/); assert.match(result.log,/D:\\Miniforge\\python.exe/);
});
test('explicit incompatible interpreter fails with diagnostic instead of silently changing it',()=>{
 const result=run('C:\\Python314\\python.exe');assert.equal(result.status,1);assert.match(result.stdout,/ImportError/);assert.match(result.log,/ArgsKwargs/);
});
test('valid explicit interpreter succeeds',()=>{
 const result=run('D:\\Miniforge\\python.exe');assert.equal(result.status,0,result.stdout+result.stderr);assert.match(JSON.parse(result.stdout).Version,/^3\.13\./);
});
test('launcher scripts keep UTF-8 BOM required by Windows PowerShell',()=>{
 for(const file of ['ai-python.ps1','start-local.ps1'])assert.equal(fs.readFileSync(path.join(root,file)).subarray(0,3).toString('hex'),'efbbbf');
});
