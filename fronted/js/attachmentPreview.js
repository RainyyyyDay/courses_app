/* Read-only attachment viewer. No OCR, AI request, or persistence. */
let attachmentViewer=null;
function attachmentUrl(value){
  try{
    const base=new URL(typeof API==='string'?API:location.origin,location.href),url=new URL(value,base.origin);
    if(url.protocol==='blob:'&&url.origin===location.origin)return url.href;
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||![location.origin,base.origin].includes(url.origin)||!url.pathname.startsWith('/uploads/'))return '';
    return url.href;
  }catch{return '';}
}
function attachmentKind(type,url){
  const mime=String(type||'').split(';')[0].toLowerCase(),name=String(url||'').split(/[?#]/)[0];
  if(mime==='application/pdf'||(!mime||mime==='application/octet-stream')&&/\.pdf$/i.test(name))return 'pdf';
  if(mime.startsWith('image/')||(!mime||mime==='application/octet-stream')&&/\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(name))return 'image';
  return '';
}
function attachmentActionsHtml(value,type,name='附件'){
  const url=attachmentUrl(value);if(!url)return '<p class="ai-help">附件地址不可用。</p>';
  const kind=attachmentKind(type,value),e=escapeHtml;
  return `<div class="attachment-actions">${kind?`<button type="button" data-attachment-preview data-url="${e(url)}" data-type="${e(type||'')}" data-name="${e(name)}">预览${e(name)}</button>`:'<span class="ai-help">此格式暂不支持站内预览</span>'}<a class="detail-link" href="${e(url)}" download rel="noopener">下载附件</a></div>`;
}
function closeAttachmentPreview(){document.getElementById('attachmentPreviewDialog')?.close();disposeAttachmentViewer();}
function disposeAttachmentViewer(){
  const state=attachmentViewer;attachmentViewer=null;if(!state)return;
  clearTimeout(state.timer);state.render?.cancel();state.task?.destroy()?.catch(()=>{});
  if(state.image){state.image.onload=null;state.image.onerror=null;state.image.removeAttribute('src');}
  state.canvas&&(state.canvas.width=state.canvas.height=0);
  if(document.fullscreenElement===state.dialog)document.exitFullscreen?.().catch(()=>{});
  state.trigger?.isConnected&&state.trigger.focus({preventScroll:true});
}
function mountAttachmentViewer(){
  let dialog=document.getElementById('attachmentPreviewDialog');if(dialog)return dialog;
  dialog=document.createElement('dialog');dialog.id='attachmentPreviewDialog';dialog.className='attachment-viewer';dialog.setAttribute('aria-labelledby','attachmentPreviewTitle');
  dialog.innerHTML='<header><h2 id="attachmentPreviewTitle">附件预览</h2><div><button type="button" data-viewer-expand>全屏查看</button><a id="attachmentPreviewDownload" download>下载附件</a><button type="button" data-viewer-close aria-label="关闭附件预览">×</button></div></header><div class="attachment-viewer-toolbar"><div id="attachmentPdfPages"><button type="button" data-viewer-prev>上一页</button><span id="attachmentPageInfo"></span><button type="button" data-viewer-next>下一页</button></div><button type="button" data-viewer-minus aria-label="缩小附件">−</button><span id="attachmentZoomInfo"></span><button type="button" data-viewer-plus aria-label="放大附件">＋</button><button type="button" data-viewer-fit>适应窗口</button><button type="button" data-viewer-rotate>旋转图片</button></div><p id="attachmentPreviewStatus" role="status" aria-live="polite"></p><div id="attachmentPreviewStage" tabindex="0" aria-label="附件内容，可滚动查看"></div>';
  document.body.append(dialog);dialog.addEventListener('close',()=>{if(!dialog.open)disposeAttachmentViewer();});
  dialog.querySelector('[data-viewer-close]').onclick=closeAttachmentPreview;
  dialog.addEventListener('click',e=>{if(e.target===dialog)closeAttachmentPreview();});
  dialog.querySelector('[data-viewer-expand]').onclick=()=>{dialog.classList.toggle('attachment-expanded');dialog.querySelector('[data-viewer-expand]').textContent=dialog.classList.contains('attachment-expanded')?'还原窗口':'全屏查看';if(attachmentViewer)void renderAttachment();};
  const changeZoom=step=>{const s=attachmentViewer;if(!s?.ready)return;s.zoom=Math.max(.25,Math.min(4,s.zoom+step));void renderAttachment();};
  dialog.querySelector('[data-viewer-minus]').onclick=()=>changeZoom(-.25);dialog.querySelector('[data-viewer-plus]').onclick=()=>changeZoom(.25);
  dialog.querySelector('[data-viewer-fit]').onclick=()=>{const s=attachmentViewer;if(s){s.zoom=1;s.rotation=0;void renderAttachment();}};
  dialog.querySelector('[data-viewer-rotate]').onclick=()=>{const s=attachmentViewer;if(s?.kind==='image'){s.rotation=(s.rotation+90)%360;void renderAttachment();}};
  for(const [selector,delta]of [['[data-viewer-prev]',-1],['[data-viewer-next]',1]])dialog.querySelector(selector).onclick=()=>{const s=attachmentViewer;if(!s?.pdf)return;s.page=Math.max(1,Math.min(s.pdf.numPages,s.page+delta));void renderAttachment();};
  dialog.addEventListener('keydown',e=>{if(e.target!==dialog&&e.target!==document.getElementById('attachmentPreviewStage'))return;if(e.key==='ArrowLeft'){e.preventDefault();dialog.querySelector('[data-viewer-prev]').click();}if(e.key==='ArrowRight'){e.preventDefault();dialog.querySelector('[data-viewer-next]').click();}});
  return dialog;
}
function attachmentStatus(text,error=false){const el=document.getElementById('attachmentPreviewStatus');el.textContent=text;el.classList.toggle('attachment-error',error);}
async function renderAttachment(){
  const s=attachmentViewer;if(!s?.ready)return;
  const version=++s.version,stage=document.getElementById('attachmentPreviewStage'),dialog=s.dialog;
  document.getElementById('attachmentZoomInfo').textContent=Math.round(s.zoom*100)+'%';
  if(s.kind==='image'){
    const rotated=s.rotation%180!==0,naturalW=rotated?s.image.naturalHeight:s.image.naturalWidth,naturalH=rotated?s.image.naturalWidth:s.image.naturalHeight;
    const fit=Math.min(1,Math.max(100,stage.clientWidth-32)/naturalW,Math.max(100,stage.clientHeight-32)/naturalH),width=s.image.naturalWidth*fit*s.zoom,height=s.image.naturalHeight*fit*s.zoom;
    s.image.style.width=width+'px';s.image.style.height=height+'px';s.image.style.transform=`translate(-50%,-50%) rotate(${s.rotation}deg)`;
    s.image.parentElement.style.width=(rotated?height:width)+'px';s.image.parentElement.style.height=(rotated?width:height)+'px';return;
  }
  s.render?.cancel();dialog.querySelector('[data-viewer-prev]').disabled=s.page<=1;dialog.querySelector('[data-viewer-next]').disabled=s.page>=s.pdf.numPages;
  document.getElementById('attachmentPageInfo').textContent='第 '+s.page+' / '+s.pdf.numPages+' 页';attachmentStatus('正在渲染第 '+s.page+' 页…');
  try{
    const page=await s.pdf.getPage(s.page);if(attachmentViewer!==s||version!==s.version)return;
    const basic=page.getViewport({scale:1}),scale=Math.max(.1,Math.max(100,stage.clientWidth-32)/basic.width)*s.zoom,view=page.getViewport({scale});
    // Bound backing pixels so large pages do not exhaust mobile canvas memory.
    const ratio=Math.min(devicePixelRatio||1,2,Math.sqrt(6000000/(view.width*view.height)));
    const canvas=document.createElement('canvas');canvas.setAttribute('role','img');canvas.setAttribute('aria-label','PDF 第 '+s.page+' 页');canvas.width=Math.max(1,Math.floor(view.width*ratio));canvas.height=Math.max(1,Math.floor(view.height*ratio));canvas.style.width=view.width+'px';canvas.style.height=view.height+'px';
    const old=s.canvas;stage.replaceChildren(canvas);s.canvas=canvas;if(old)old.width=old.height=0;
    s.render=page.render({canvasContext:canvas.getContext('2d'),viewport:view,transform:ratio===1?null:[ratio,0,0,ratio,0,0]});await s.render.promise;
    if(attachmentViewer===s&&version===s.version){attachmentStatus('可翻页、缩放或下载原文件。');stage.scrollTop=0;page.cleanup();}
  }catch(err){if(attachmentViewer===s&&version===s.version&&err?.name!=='RenderingCancelledException')attachmentStatus('这一页无法显示，请重试翻页或下载原文件。',true);}
}
async function openAttachmentPreview(value,type,name='附件'){
  const url=attachmentUrl(value),kind=attachmentKind(type,value);if(!url||!kind){showToast('暂不支持预览此附件，请下载后查看。');return;}
  const dialog=mountAttachmentViewer();disposeAttachmentViewer();const stage=document.getElementById('attachmentPreviewStage');stage.replaceChildren();
  dialog.classList.remove('attachment-expanded');dialog.querySelector('[data-viewer-expand]').textContent='全屏查看';
  const s={url,kind,dialog,zoom:1,rotation:0,page:1,version:0,ready:false,trigger:document.activeElement};attachmentViewer=s;
  document.getElementById('attachmentPreviewTitle').textContent=name||'附件预览';document.getElementById('attachmentPreviewDownload').href=url;
  document.getElementById('attachmentPdfPages').hidden=kind!=='pdf';dialog.querySelector('[data-viewer-rotate]').hidden=kind!=='image';document.getElementById('attachmentPageInfo').textContent='';document.getElementById('attachmentZoomInfo').textContent='100%';
  dialog.querySelectorAll('[data-viewer-prev],[data-viewer-next]').forEach(b=>b.disabled=true);attachmentStatus('附件加载中，请稍候…');
  if(!dialog.open)dialog.showModal();
  s.timer=setTimeout(()=>{if(attachmentViewer===s&&!s.ready){attachmentStatus('附件加载超时，请关闭后重试或下载原文件。',true);s.task?.destroy()?.catch(()=>{});}},35000);
  if(kind==='image'){
    const img=new Image();img.alt=name;s.image=img;const wrap=document.createElement('div');wrap.className='attachment-image-wrap';wrap.append(img);stage.append(wrap);
    img.onload=()=>{if(attachmentViewer!==s)return;clearTimeout(s.timer);s.ready=true;attachmentStatus('可缩放、旋转或下载原图。');void renderAttachment();};
    img.onerror=()=>{clearTimeout(s.timer);if(attachmentViewer===s)attachmentStatus('图片加载失败，文件可能已删除；可尝试下载原文件。',true);};img.src=url;return;
  }
  try{
    const lib=await loadPdfJs();if(attachmentViewer!==s)return;
    s.task=lib.getDocument({url,isEvalSupported:false,disableAutoFetch:true,disableStream:true});
    s.task.onPassword=()=>{s.passwordRequired=true;clearTimeout(s.timer);if(attachmentViewer===s)attachmentStatus('此 PDF 需要密码，请下载后使用支持密码的阅读器打开。',true);s.task.destroy().catch(()=>{});};
    s.pdf=await s.task.promise;if(attachmentViewer!==s)return;clearTimeout(s.timer);s.ready=true;await renderAttachment();
  }catch(err){clearTimeout(s.timer);if(attachmentViewer===s&&!s.passwordRequired)attachmentStatus('PDF 无法加载，文件可能损坏、已删除或阅读组件不可用；请下载原文件查看。',true);}
}
document.addEventListener('click',e=>{const button=e.target.closest?.('[data-attachment-preview]');if(!button)return;e.preventDefault();e.stopPropagation();void openAttachmentPreview(button.dataset.url,button.dataset.type,button.dataset.name);});
addEventListener('resize',()=>{if(attachmentViewer?.ready)void renderAttachment();});
addEventListener('pagehide',()=>{closeAttachmentPreview();disposeAttachmentViewer();});
