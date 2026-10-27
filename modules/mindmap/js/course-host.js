// Host adapter only: generation and organization stay in upstream modules.
(()=>{
 'use strict';
 const preview=new URLSearchParams(location.search).get('mode')==='preview';
 window.COURSES_MAP_READONLY=preview;
 const memory=new Map();window.COURSES_MAP_MEMORY=memory;
 window.MMWorkspaceHost={libraryBusy:()=>true,beforeOpen:()=>true,onDraw:()=>{},afterOpen:()=>{},beforeLeave:()=>{},openCancelled:()=>{},canMutateSavedMap:()=>!preview,deleteMaps:()=>Promise.resolve()};
 const external=()=>{try{return parent!==window&&parent.location.origin===location.origin?parent:null;}catch{return null;}};
 window.addEventListener('DOMContentLoaded',()=>{
  document.body.classList.add(preview?'course-readonly':'course-editor');
  if(preview){window.save=(key,value)=>{memory.set(key,structuredClone(value));return true;};window.load=(key,fallback)=>memory.get(key)??fallback;}
  const settings=document.getElementById('mmAPISettingsButton');if(settings)settings.textContent='AI 设置（课程共用）';
  const settingsDialog=document.createElement('dialog');settingsDialog.id='mmAPISettingsDialog';settingsDialog.innerHTML='<p>导图与课程共用顶部 AI 设置。</p><button type="button">关闭</button>';settingsDialog.querySelector('button').onclick=()=>settingsDialog.close();document.body.append(settingsDialog);
 });
 document.addEventListener('click',event=>{
  if(!event.target.closest('#mmAPISettingsButton,#mmOutlineSettings'))return;
  event.preventDefault();event.stopImmediatePropagation();
  const host=external();if(host){host.document.getElementById('coursesAiOpen')?.click();const dlg=host.document.getElementById('coursesAiDialog');dlg?.addEventListener('close',()=>window.dispatchEvent(new Event('mm:ai-config-saved')),{once:true});}
  else{const dlg=document.getElementById('mmAPISettingsDialog');dlg.querySelector('p').textContent='请返回课程网站，通过顶栏的 AI 设置修改共用配置。';dlg.showModal();}
 },true);
 let original=null,source=null;
 function plain(value){return JSON.parse(JSON.stringify(value));}
 function blank(title){return {id:'course-draft-'+crypto.randomUUID(),title:title||'思维导图',v:3,flat:true,theme:'fresh',nodes:[{id:'root',text:title||'思维导图',children:[]}],edges:[],pos:{root:{x:0,y:0}},size:{root:{w:280,h:100}}};}
 async function generate(){if(source)return window.MMCourseSource.open(source);}
 window.CourseMap={
  async load(value,options={}){
   source=options;const map=value?window.CoursesMindmapFormat.normalize(plain(value)):blank(options.title);map.id ||= 'course-draft-'+crypto.randomUUID();
   if(preview)original=plain(map);
   const opened=await window.Mindmap.openDocument(map);if(opened===false)throw Error('导图未打开，请检查草稿提示');
   window.Mindmap.selectNodes([]);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));fit();
   if(preview)mountPreview();
   else{const button=document.createElement('button');button.type='button';button.className='mm-b';button.id='courseGenerate';button.textContent='追加课程内容';button.onclick=()=>generate().catch(e=>window.showBanner(e.message));document.querySelector('.mm-head')?.append(button);if(options.generate)await generate();}
   return true;
  },
  snapshot(){return preview?plain(original):window.Mindmap.editingSnapshot();},
  async save(){if(preview)throw Error('预览不可保存');if(!await window.MMFiles.save())throw Error('导图文件尚未保存，当前草稿仍保留');return window.Mindmap.editingSnapshot();},
  async flush(){if(!preview)await window.MMFiles?.flush();},generate
 };
 function fit(){if(window.MMTopicUI?.mode==='overview'){window.MMTopicUI.fitView();return;}const s=window.Mindmap.state(),box=s.L?.bounds,el=document.getElementById('mmView');if(!box||!el)return;const r=el.getBoundingClientRect(),k=Math.max(.05,Math.min(1.2,(r.width-40)/Math.max(1,box.x1-box.x0),(r.height-85)/Math.max(1,box.y1-box.y0)));window.Mindmap.restoreView({k,x:r.width/2-(box.x0+box.x1)/2*k,y:48+(r.height-48)/2-(box.y0+box.y1)/2*k});}
 function zoom(factor){if(window.MMTopicUI?.mode==='overview')window.MMTopicUI.zoomBy(factor);else{const v=window.Mindmap.view(),r=document.getElementById('mmView').getBoundingClientRect(),k=Math.max(.05,Math.min(4,v.k*factor));window.Mindmap.restoreView({k,x:r.width/2-(r.width/2-v.x)*k/v.k,y:r.height/2-(r.height/2-v.y)*k/v.k});}}
 function pan(dx,dy){if(window.MMTopicUI?.mode==='overview')window.MMTopicUI.panBy(dx,dy);else{const v=window.Mindmap.view();window.Mindmap.restoreView({...v,x:v.x+dx,y:v.y+dy});}}
 function mountPreview(){const bar=document.createElement('nav');bar.className='course-preview-controls';bar.setAttribute('aria-label','导图预览操作');bar.innerHTML='<button data-course-view="detail" aria-pressed="true">详细</button><button data-course-view="overview" aria-pressed="false">概览</button><span></span><button data-course-view="out" aria-label="缩小">−</button><button data-course-view="in" aria-label="放大">＋</button><button data-course-view="fit">适应窗口</button><button data-course-view="fullscreen">全屏</button>';document.body.append(bar);}
 if(!preview)return;
 // Capture before the editor's listeners. Nodes and their children only pan the viewport.
 const points=new Map();let last=null,pinch=null;
 document.addEventListener('pointerdown',event=>{if(event.target.closest('.course-preview-controls'))return;event.preventDefault();event.stopImmediatePropagation();if(event.button!==0)return;points.set(event.pointerId,{x:event.clientX,y:event.clientY});last={x:event.clientX,y:event.clientY};if(points.size===2){const [a,b]=[...points.values()];pinch=Math.hypot(a.x-b.x,a.y-b.y);}try{document.documentElement.setPointerCapture(event.pointerId);}catch{}},true);
 document.addEventListener('pointermove',event=>{if(event.target.closest('.course-preview-controls')&&!points.size)return;event.stopImmediatePropagation();if(!points.has(event.pointerId))return;event.preventDefault();points.set(event.pointerId,{x:event.clientX,y:event.clientY});if(points.size===2){const [a,b]=[...points.values()],d=Math.hypot(a.x-b.x,a.y-b.y);if(pinch)zoom(d/Math.max(1,pinch));pinch=d;}else if(last)pan(event.clientX-last.x,event.clientY-last.y);last={x:event.clientX,y:event.clientY};},true);
 for(const type of ['pointerup','pointercancel'])document.addEventListener(type,event=>{if(event.target.closest('.course-preview-controls')&&!points.size)return;event.stopImmediatePropagation();points.delete(event.pointerId);last=points.size?[...points.values()][0]:null;pinch=null;},true);
 document.addEventListener('wheel',event=>{event.preventDefault();event.stopImmediatePropagation();if(event.ctrlKey||event.metaKey)zoom(Math.exp(-event.deltaY*.002));else pan(-event.deltaX,-event.deltaY);},{capture:true,passive:false});
 document.addEventListener('click',event=>{const action=event.target.closest('[data-course-view]')?.dataset.courseView;event.preventDefault();event.stopImmediatePropagation();if(!action)return;if(action==='fit')fit();else if(action==='in'||action==='out')zoom(action==='in'?1.2:1/1.2);else if(action==='fullscreen'){const frame=window.frameElement;if(document.fullscreenElement)document.exitFullscreen();else if(frame?.ownerDocument.fullscreenElement)frame.ownerDocument.exitFullscreen();else(frame||document.documentElement).requestFullscreen?.();}else{window.MMTopicUI.setMode(action);document.querySelectorAll('[data-course-view="detail"],[data-course-view="overview"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.courseView===action)));}},true);
 for(const type of ['dblclick','contextmenu','drop','dragover','dragstart','input','change'])document.addEventListener(type,event=>{event.preventDefault();event.stopImmediatePropagation();},true);
 document.addEventListener('keydown',event=>{if(event.key==='Tab'||event.key==='Escape')return;if((event.key==='Enter'||event.key===' ')&&event.target.closest('.course-preview-controls'))return;event.preventDefault();event.stopImmediatePropagation();if((event.ctrlKey||event.metaKey)&&['+','=','-','0'].includes(event.key)){if(event.key==='0')fit();else zoom(event.key==='-'?1/1.2:1.2);}else if(event.key.startsWith('Arrow'))pan(event.key==='ArrowLeft'?40:event.key==='ArrowRight'?-40:0,event.key==='ArrowUp'?40:event.key==='ArrowDown'?-40:0);},true);
 window.addEventListener('resize',()=>{if(!points.size)fit();});
})();
