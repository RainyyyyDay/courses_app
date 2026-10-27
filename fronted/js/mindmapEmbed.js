let courseMindmapDialog=null;
function courseMapFrame(map,readonly=false,source={}){
 const frame=document.createElement('iframe');frame.className=readonly?'course-map-preview':'course-map-editor';frame.title=readonly?'思维导图只读预览':'思维导图工作台';
 frame.src=readonly?'/mindmap/preview.html?mode=preview&v=20261026-3':'/mindmap/course.html?v=20261026-3';frame.allow='fullscreen';
 frame.addEventListener('load',async()=>{try{await frame.contentWindow.CourseMap.load(map,source);frame.dataset.ready='true';frame.dispatchEvent(new Event('mapready'));}catch(error){frame.dataset.error=error.message;frame.dispatchEvent(new Event('maperror'));}});return frame;
}
function showCourseMindmap(map,{onSave,title='思维导图',source={},replacing=false}={}){
 if(courseMindmapDialog){showToast('请先保存或关闭当前导图工作台');return;}
 const dialog=document.createElement('dialog');dialog.id='courseMindmapDialog';dialog.className='course-map-dialog';courseMindmapDialog=dialog;
 dialog.innerHTML='<header><h3></h3><button type="button" class="btn-cancel" data-map-close>关闭</button><button type="button" class="btn-confirm" data-map-save disabled>保存并回传资料</button></header><p data-map-status role="status">正在加载导图工作台…</p><div data-map-host></div>';
 dialog.querySelector('h3').textContent=replacing?'重新生成 · '+title:title;const frame=courseMapFrame(map,false,{...source,title});dialog.querySelector('[data-map-host]').append(frame);document.body.append(dialog);dialog.showModal();let baseline='',saved=false,busy=false;
 if(replacing){dialog.querySelector('[data-map-save]').textContent='保存并替换原导图';dialog.querySelector('[data-map-status]').textContent='正在准备新导图，原导图保留，保存后才替换。';}
 frame.addEventListener('mapready',()=>{baseline=JSON.stringify(frame.contentWindow.CourseMap.snapshot());dialog.querySelector('[data-map-save]').disabled=false;dialog.querySelector('[data-map-status]').textContent=replacing?'当前是新导图。原导图保留，确认结果后点击“保存并替换原导图”；关闭或生成失败不会替换资料中的原导图。':'生成、结构复核、分组和自动整理均使用导图原有功能；保存后回传当前资料。AI 与课程顶栏共用设置。';});
 frame.addEventListener('maperror',()=>{dialog.querySelector('[data-map-status]').textContent='工作台加载失败：'+frame.dataset.error;});
 async function close(){if(busy)return;try{if(frame.dataset.ready==='true'){if(!saved&&JSON.stringify(frame.contentWindow.CourseMap.snapshot())!==baseline&&!confirm('导图尚未回传资料，确定关闭？工作台草稿会保留。'))return;await frame.contentWindow.CourseMap.flush();}dialog.close();}catch(error){dialog.querySelector('[data-map-status]').textContent='草稿尚未保存：'+error.message;}}
 dialog.querySelector('[data-map-close]').onclick=()=>void close();dialog.addEventListener('cancel',event=>{event.preventDefault();void close();});dialog.addEventListener('close',()=>{dialog.remove();courseMindmapDialog=null;});
 dialog.querySelector('[data-map-save]').onclick=async()=>{if(busy)return;busy=true;const button=dialog.querySelector('[data-map-save]');button.disabled=true;try{const value=await frame.contentWindow.CourseMap.save();if(!value)throw Error('导图尚未就绪');await onSave(value);saved=true;dialog.close();}catch(error){dialog.querySelector('[data-map-status]').textContent=error.message+' 当前导图与附件仍保留在工作台中。';button.disabled=false;}finally{busy=false;}};
}
function previewCourseMindmap(host,value){try{const map=typeof value==='string'?JSON.parse(value):value;if(!map||!Array.isArray(map.nodes))return false;const frame=courseMapFrame(map,true);frame.addEventListener('maperror',()=>{const message=document.createElement('p');message.textContent='导图预览失败：'+frame.dataset.error;host.replaceChildren(message);});host.replaceChildren(frame);return true;}catch{return false;}}
