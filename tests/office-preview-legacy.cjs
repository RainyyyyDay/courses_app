// Actual LibreOffice binary .doc/.ppt compatibility; no AI or personal files.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {converterPath,createOfficePreview}=require('../back/officePreview');
const {wordFixture,pptFixture}=require('./office-fixtures.cjs');
test('Office real legacy doc and ppt convert to preview PDF', {timeout:240000,skip:!converterPath()?'LibreOffice unavailable; real legacy conversion NOT verified':false},async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'courses-office-legacy-'));
  try {
    const uploads=path.join(temp,'uploads');fs.mkdirSync(uploads);
    fs.writeFileSync(path.join(temp,'word.docx'),wordFixture());fs.writeFileSync(path.join(temp,'slides.pptx'),pptFixture());
    for(const [name,format]of [['word.docx','doc:MS Word 97'],['slides.pptx','ppt:MS PowerPoint 97']]){
      await new Promise((resolve,reject)=>{
        const child=spawn(converterPath(),['-env:UserInstallation='+pathToFileURL(path.join(temp,'profile-'+name)).href,'--headless','--convert-to',format,'--outdir',uploads,path.join(temp,name)],{windowsHide:true,stdio:'ignore'});
        child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('legacy fixture conversion failed')));
      });
    }
    const service=createOfficePreview({uploadDir:uploads,cacheDir:path.join(temp,'cache')});
    for(const name of ['word.doc','slides.ppt']){
      assert.ok(fs.statSync(path.join(uploads,name)).size>0);
      service.prepare(name);
      for(let i=0;i<140;i++){
        const state=service.prepare(name);
        if(state.status==='ready')break;
        assert.equal(state.status,'preparing',JSON.stringify(state));
        assert.ok(i<139,'legacy preview timed out');await new Promise(r=>setTimeout(r,500));
      }
    }
  } finally {fs.rmSync(temp,{recursive:true,force:true,maxRetries:3});}
});
