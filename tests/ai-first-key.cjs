const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./mistake-format.cjs'),{runBrowser}=require('./browser-driver.cjs');
test('first pasted Key survives redundant UI events and applies once without real upstream calls',{timeout:90000},async()=>fixture(async({temp,serve})=>{
 const url=await serve(),chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);assert.ok(chrome);
 for(const [i,viewport]of [[1280,960],[390,844]].entries()){
 const script=`const originalFetch=fetch;let calls=0;fetch=(url,options)=>{if(String(url).includes('/api/ai/test')){calls++;const body=JSON.parse(options.body);if(body.api_key!=='synthetic-first-key')throw Error('incorrect synthetic credential');return Promise.resolve(new Response(JSON.stringify({ok:true,provider:'deepseek',model:'deepseek-flash',action:'connection'})));}return originalFetch(url,options);};window.COURSES_AI_API_BASE='/api';addEventListener('load',async()=>{const out=document.createElement('pre');out.id='regressionResult';const el=id=>document.getElementById('coursesAi'+id),check=(v,m)=>{if(!v)throw Error(m);};try{
  coursesAiSettings.open();el('Provider').value='deepseek';el('Provider').dispatchEvent(new Event('change'));el('Key').focus();el('Key').setRangeText('  synthetic-first-key  ');el('Key').dispatchEvent(new InputEvent('input',{inputType:'insertFromPaste',bubbles:true}));el('Retain').checked=true;el('Consent').checked=true;
  el('Provider').dispatchEvent(new Event('change'));check(el('Key').value.trim()==='synthetic-first-key'&&el('Consent').checked,'redundant source change preserves pasted credential and consent');
  coursesAiSettings.open();check(el('Key').value.trim()==='synthetic-first-key'&&el('Retain').checked,'reopening visible dialog preserves input');
  el('Dialog').dispatchEvent(new Event('close'));check(el('Key').value.trim()==='synthetic-first-key','stale close cannot clear reopened input');
  el('Apply').click();check(coursesAiSettings.status().hasKey&&coursesAiSettings.status().configured&&!el('Key').value&&calls===0,'first apply accepts pasted Key and masks input without paid call');
  el('Test').click();while(el('Test').disabled)await new Promise(r=>setTimeout(r,20));check(calls===1&&coursesAiSettings.status().connectionState==='passed','first intended connection uses correct Key');
  el('Key').value='invalid middle space';el('Consent').checked=true;el('Apply').click();check(el('Message').textContent.includes('不支持的字符')&&el('Key').value==='invalid middle space','invalid input is retained for correction');check(calls===1,'invalid apply never calls model');
  el('Provider').value='qwen';el('Provider').dispatchEvent(new Event('change'));check(!el('Key').value&&!el('Consent').checked,'actual provider change still clears credentials');
  el('Close').click();await new Promise(r=>setTimeout(r,20));coursesAiSettings.open();check(!el('Key').value,'normal close clears unsubmitted input');
  check(!JSON.stringify(localStorage).includes('synthetic-first-key')&&!JSON.stringify(sessionStorage).includes('synthetic-first-key'),'no persisted credential');out.textContent='PASS';
 }catch(e){out.textContent='FAIL '+e.stack;}document.body.append(out);});`;
 const html=await runBrowser({chrome,profile:path.join(temp,'first-key-'+i),url,viewport,initScript:script});const result=html.match(/<pre id="regressionResult">[\s\S]*?<\/pre>/)?.[0];assert.match(result||'',/>PASS</,result||'no result');
 }
},{legacy:false}));
