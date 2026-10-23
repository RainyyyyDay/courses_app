const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function runHandoff({pageHref,api}) {
  let opened='';
  let handoffBody=null;
  const context=vm.createContext({
    URL,
    URLSearchParams,
    Promise,
    console,
    encodeURIComponent,
    document:{visibilityState:'visible',addEventListener() {}},
    location:{href:pageHref},
    MINDMAP_APP_URL:'http://127.0.0.1:8794/',
    window:{
      addEventListener() {},
      __mindmapTarget:{resourceType:'material',id:7,label:'测试资料'},
      open(url){opened=url;return null;}
    },
    globalThis:{},
    API:api,
    currentCourseId:2,
    requestApi:async(url,options)=>{
      handoffBody=JSON.parse(options.body);
      return {json:async()=>({token:'synthetic-token',bridge:'/api/mindmap-handoffs'})};
    },
    showToast() {},
  });
  context.window.location=context.location;
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../fronted/js/outlineMap.js'),'utf8'),context);
  return context.openMindmapEditor('', '润色后的主题', '- 根节点\n  - 子节点', {startNew:true})
    .then(()=>({opened,handoffBody}));
}

test('mindmap bridge uses the business API origin instead of the page origin', async()=>{
  const {opened,handoffBody}=await runHandoff({pageHref:'http://127.0.0.1:3002/',api:'http://localhost:3000/api'});
  const url=new URL(opened);
  assert.equal(url.origin,'http://127.0.0.1:8794');
  assert.equal(url.hash,'#handoff=synthetic-token');
  assert.equal(new URL(url.searchParams.get('bridge')).origin,'http://localhost:3000');
  assert.equal(new URL(url.searchParams.get('bridge')).pathname,'/api/mindmap-handoffs');
  assert.deepEqual(handoffBody,{outline:'- 根节点\n  - 子节点',title:'润色后的主题',startNew:true});
  const sameOrigin=await runHandoff({pageHref:'http://127.0.0.1:3000/',api:'/api'});
  assert.equal(new URL(new URL(sameOrigin.opened).searchParams.get('bridge')).origin,'http://127.0.0.1:3000');
  assert.deepEqual(sameOrigin.handoffBody,handoffBody);
});
