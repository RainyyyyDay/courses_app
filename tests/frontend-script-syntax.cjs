const {test}=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../fronted');
test('homepage inline and referenced scripts have valid JavaScript syntax',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<!--[\s\S]*?-->/g,'');
  let inline=0;
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    const src=match[1].match(/\bsrc=["']([^"']+)["']/);
    if(src){const file=src[1].split('?')[0];if(!file.startsWith('vendor/'))new vm.Script(fs.readFileSync(file.startsWith('/mindmap/')?path.join(root,'../modules/mindmap',file.slice('/mindmap/'.length)):path.join(root,file),'utf8'),{filename:file});}
    else if(match[2].trim())new vm.Script(match[2],{filename:'homepage-inline-'+(++inline)});
  }
  if(!inline)throw Error('No homepage inline scripts checked');
});
