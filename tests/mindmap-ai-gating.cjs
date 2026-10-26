const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('mind-map AI generation stays disabled until a real API is configured',()=>{
  const basic={disabled:false,dataset:{mindmapGenerate:'basic'},setAttribute(){},title:''};
  const ai={disabled:false,dataset:{mindmapGenerate:'ai'},setAttribute(name,value){this[name]=value;},title:''};
  const notes={
    tagPickerMindmapAiNote:{textContent:'',classList:{toggle(){}}},
    resourceDetailMindmapAiNote:{textContent:'',classList:{toggle(){}}},
  };
  let ready=false;
  const context=vm.createContext({
    URL,
    URLSearchParams,
    Promise,
    TextEncoder,
    console,
    encodeURIComponent,
    setTimeout,
    clearTimeout,
    AbortController,
    location:{href:'http://127.0.0.1:3000/',origin:'http://127.0.0.1:3000'},
    document:{
      visibilityState:'visible',
      addEventListener(){},
      querySelectorAll(selector){return selector==='[data-mindmap-generate]'?[basic,ai]:[];},
      getElementById(id){return notes[id]||null;},
    },
    window:{addEventListener(){}},
    globalThis:{},
    API:'/api',
    requestApi:async()=>{throw new Error('not requested');},
    showToast(){},
    mistakeAiError(code){return Object.assign(new Error(code),{code});},
    coursesAiSettings:{realReady:()=>ready},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../fronted/js/outlineMap.js'),'utf8'),context);

  context.refreshMindmapAiAvailability();
  assert.equal(basic.disabled,false);
  assert.equal(ai.disabled,true);
  assert.equal(ai['aria-disabled'],'true');
  assert.match(notes.tagPickerMindmapAiNote.textContent,/接入真实 API/);
  assert.match(notes.resourceDetailMindmapAiNote.textContent,/基础生成无需 API/);

  ready=true;
  context.refreshMindmapAiAvailability();
  assert.equal(basic.disabled,false);
  assert.equal(ai.disabled,false);
  assert.equal(ai['aria-disabled'],'false');
  assert.match(notes.tagPickerMindmapAiNote.textContent,/不自动覆盖已保存内容/);
});
