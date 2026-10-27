// Course input selection and local attachment storage; generation stays upstream.
(()=>{
 'use strict';
 const $=id=>document.getElementById(id),M=()=>window.Mindmap;
 const fileKind=value=>/pdf/i.test(value?.type||'')||/\.pdf(?:$|[?#])/i.test(value?.name||value?.url||'')?'files':/^image\/(png|jpeg|webp)$/.test(value?.type||'')?'images':null;
 function context(source){return {source,file:source.file||null,filePromise:null,kind:fileKind(source.file||source.attachment),form:null,lastText:'',pending:false};}
 async function originalFile(ctx,signal){
  if(ctx.file)return ctx.file;
  const attachment=ctx.source.attachment;if(!attachment?.url)throw Error('没有可用的原附件');
  if(!ctx.filePromise){ctx.filePromise=(async()=>{const url=new URL(attachment.url,location.href);if(url.origin!==location.origin||!/^\/uploads\/[A-Za-z0-9._-]+$/.test(url.pathname))throw Error('资料附件地址无效');const response=await fetch(url,{signal});if(!response.ok)throw Error('原附件读取失败，请保留当前文字后重试');const blob=await response.blob();return new File([blob],attachment.name||ctx.source.title||'原讲义.pdf',{type:ctx.kind==='files'?'application/pdf':attachment.type||blob.type});})().catch(error=>{ctx.filePromise=null;throw error;});}
  ctx.file=await ctx.filePromise;return ctx.file;
 }
 async function fill(ctx,kind){
  const form=ctx.form;if(!form?.isConnected)return;
  const target=$('mmOutlineInputSource'),input=$('mmOutlineText');
  if(kind==='body'||kind==='outline'){
   if(input.value.trim()&&input.value!==ctx.lastText&&!confirm('将替换生成窗口中修改过的文字，是否继续？'))return;
   target.value='text';target.dispatchEvent(new Event('change',{bubbles:true}));input.value=kind==='body'?ctx.source.text||'':ctx.source.outline||'';ctx.lastText=input.value;input.dispatchEvent(new Event('input',{bubbles:true}));
  }else{
   const file=await originalFile(ctx);if(ctx.form!==form||!form.isConnected||!$('mmDlg').open)return;
   target.value=ctx.kind;target.dispatchEvent(new Event('change',{bubbles:true}));const picker=$(ctx.kind==='files'?'mmLecturePicker':'mmTextImages'),transfer=new DataTransfer();transfer.items.add(file);picker.files=transfer.files;picker.dispatchEvent(new Event('change',{bubbles:true}));
  }
  for(const button of form.querySelectorAll('[data-course-source]'))button.setAttribute('aria-pressed',String(button.dataset.courseSource===kind));
  update(ctx);
 }
 function update(ctx){const row=ctx.form?.querySelector('[data-course-embed-row]');if(row)row.hidden=!['text','topic'].includes($('mmOutlineInputSource').value);}
 async function embed(ctx,signal){
  const file=await originalFile(ctx,signal);signal.throwIfAborted();
  if(file.size>50*1024*1024)throw Error('原讲义超过 50MB，未提交生成；可取消嵌入后继续使用文字');
  const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer()),hash=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');signal.throwIfAborted();
  const map=M().state().cur,id=map?.id;if(!id)throw Error('导图未打开');
  if(map.nodes.some(n=>n.pdf&&n.courseSourceHash===hash))return;
  const selected=[...M().state().selected],b=M().state().L.bounds;
  const media=await window.MMFiles.stagePDF(file,id,signal);signal.throwIfAborted();if(M().state().cur?.id!==id)throw Error('导图已切换，未向新导图写入原讲义');
  const nodeId=M().addPDF(media,{x:b.x0,y:b.y1+140});M().editMap(()=>{const node=M().state().cur.nodes.find(n=>n.id===nodeId);node.courseSourceHash=hash;node.courseSourceRole='original-handout';node.text='原讲义：'+file.name;});M().selectNodes(selected);await window.MMFiles.flush();
 }
 function mount(ctx){
  const form=$('mmOutlineForm');ctx.form=form;
  const controls=document.createElement('section');controls.className='course-source-options';controls.setAttribute('aria-label','课程资料生成依据');
  const label=document.createElement('b');label.textContent='使用课程中已有的内容';controls.append(label);
  const buttons=document.createElement('div');buttons.className='course-source-buttons';controls.append(buttons);
  for(const [kind,text,available]of [['body','使用正文',!!ctx.source.text?.trim()],['outline','使用大纲',!!ctx.source.outline?.trim()],['attachment','重新从原附件生成',!!ctx.kind]]){const button=document.createElement('button');button.type='button';button.className='mm-b';button.dataset.courseSource=kind;button.textContent=text;button.disabled=!available;button.onclick=()=>fill(ctx,kind).catch(error=>$('mmOutlineError').textContent=error.message);buttons.append(button);}
  const hint=document.createElement('p');hint.className='meta';hint.textContent='默认使用已有文字，不重复识别整份课件；也可直接修改下方生成依据。';controls.append(hint);
  if(ctx.kind==='files'){const row=document.createElement('label');row.dataset.courseEmbedRow='';row.className='mm-outline-check';const check=document.createElement('input');check.type='checkbox';check.checked=true;check.id='courseEmbedOriginal';row.append(check,document.createTextNode('同时嵌入原讲义（仅保存原 PDF 供查看，不额外调用 AI）'));controls.append(row);}
  $('mmOutlineInputHelp').after(controls);$('mmOutlineInputSource').addEventListener('change',()=>update(ctx));
  const submit=form.onsubmit;
  form.onsubmit=async event=>{
   event.preventDefault();if(ctx.pending)return;ctx.pending=true;const controller=new AbortController(),dialog=$('mmDlg'),cancel=()=>controller.abort(),button=$('mmOutlineGenerate');dialog.addEventListener('close',cancel);button.disabled=true;
   try{if($('courseEmbedOriginal')?.checked&&['text','topic'].includes($('mmOutlineInputSource').value)){
     $('mmOutlineError').textContent='正在本机保存原讲义；生成仍使用下方文字…';await embed(ctx,controller.signal);$('mmOutlineError').textContent='';
    }
    controller.signal.throwIfAborted();if(form!==$('mmOutlineForm')||!dialog.open)return;await submit.call(form,event);
   }catch(error){if(error.name!=='AbortError'&&form.isConnected)$('mmOutlineError').textContent=error.message;}
   finally{ctx.pending=false;dialog.removeEventListener('close',cancel);button.disabled=false;}
  };
  update(ctx);
 }
 async function open(source){
  const ctx=context(source),kind=source.text?.trim()?'body':source.outline?.trim()?'outline':ctx.kind?'attachment':'body';
  window.MMAIOutline.open(true,'text');$('mmOutlineTitle').value=source.title||'';ctx.lastText=$('mmOutlineText').value;mount(ctx);await fill(ctx,kind);
 }
 window.MMCourseSource={open};
})();
