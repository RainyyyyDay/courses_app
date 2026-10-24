const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createOfficePreview } = require('../back/officePreview');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function wait(fn) { for (let i=0;i<200;i++) { const result=fn(); if(result)return result; await sleep(10); } throw Error('preview timeout'); }

test('office preview simulated conversion: queue, cache, restart, changed source, deletion and validation', async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'courses-office-test-'));
  try {
    const uploadDir=path.join(temp,'uploads'),cacheDir=path.join(temp,'cache');fs.mkdirSync(uploadDir);
    let calls=0,active=0,peak=0;
    const options={uploadDir,cacheDir,findConverter:()=>'/fake/converter',convertFile:async(file,out)=>{
      calls++;active++;peak=Math.max(peak,active);await sleep(25);
      fs.writeFileSync(path.join(out,path.parse(file).name+'.pdf'),'%PDF-simulated');active--;
    }};
    const service=createOfficePreview(options);
    for(const name of ['a.docx','b.pptx','c.doc','d.ppt']){fs.writeFileSync(path.join(uploadDir,name),'test');assert.equal(service.prepare(name).status,'preparing');}
    assert.equal(service.prepare('a.docx').status,'preparing');
    await wait(()=>service.prepare('d.ppt').status==='ready');assert.equal(calls,4);assert.equal(peak,1);
    assert.equal(createOfficePreview(options).prepare('a.docx').status,'ready');assert.equal(calls,4);
    fs.appendFileSync(path.join(uploadDir,'a.docx'),'changed');assert.equal(service.prepare('a.docx').status,'preparing');
    await wait(()=>service.prepare('a.docx').status==='ready');assert.equal(calls,5);
    fs.unlinkSync(path.join(uploadDir,'a.docx'));assert.equal(service.prepare('a.docx').status,'missing');
    for(const name of ['../b.pptx','/b.pptx','file.xlsx','file.pdf'])assert.equal(service.prepare(name).status,'missing');
    fs.writeFileSync(path.join(uploadDir,'big.docx'),'');fs.truncateSync(path.join(uploadDir,'big.docx'),51*1024*1024);
    assert.equal(service.prepare('big.docx').code,'FILE_TOO_LARGE');
    fs.writeFileSync(path.join(uploadDir,'new.docx'),'test');
    assert.equal(createOfficePreview({...options,findConverter:()=>''}).prepare('new.docx').status,'unavailable');
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});

test('office preview simulated failures require explicit retry and reject invalid converter output',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'courses-office-test-'));
  try {
    let calls=0,fail=true;fs.writeFileSync(path.join(temp,'file.docx'),'test');
    const service=createOfficePreview({uploadDir:temp,cacheDir:path.join(temp,'cache'),findConverter:()=>'/fake',convertFile:async(file,out)=>{
      calls++;if(fail)throw Error('CONVERSION_TIMEOUT');fs.writeFileSync(path.join(out,'file.pdf'),'not a pdf');
    }});
    service.prepare('file.docx');await wait(()=>service.prepare('file.docx').status==='failed');
    assert.equal(service.prepare('file.docx').code,'CONVERSION_TIMEOUT');assert.equal(calls,1);
    fail=false;service.prepare('file.docx',true);await wait(()=>service.prepare('file.docx').status==='failed');
    assert.equal(service.prepare('file.docx').code,'CONVERSION_FAILED');assert.equal(calls,2);
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});

test('legacy Office simulated conversion shares queue, returns modern bytes and cleans temporary files',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'courses-legacy-test-'));
  try {
    let active=0,peak=0;const inputs=[];
    const service=createOfficePreview({uploadDir:temp,cacheDir:path.join(temp,'cache'),findConverter:()=>'/fake',convertFile:async(file,out,profile,executable,target)=>{
      active++;peak=Math.max(peak,active);inputs.push(file);await sleep(10);
      fs.writeFileSync(path.join(out,path.parse(file).name+'.'+target),Buffer.from([80,75,3,4,5]));active--;
    }});
    const result=await Promise.all(['doc','ppt'].map(kind=>service.convertLegacy(Buffer.from('old file'),kind)));
    assert.equal(peak,1);assert.ok(result.every(value=>value.subarray(0,2).toString()==='PK'));
    assert.ok(inputs.every(file=>!fs.existsSync(path.dirname(file))),'temporary originals removed');
    await assert.rejects(service.convertLegacy(Buffer.from('file'),'exe'),/FORMAT_UNSUPPORTED/);
    const controller=new AbortController();controller.abort();
    await assert.rejects(service.convertLegacy(Buffer.from('file'),'doc',controller.signal),/CANCELLED/);
    assert.equal(inputs.length,2,'cancelled queued job never launches conversion');
    assert.equal(fs.readdirSync(temp).length,0,'no business uploads or database created');
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
