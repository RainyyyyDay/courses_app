// Use the mindmap's Markdown/KaTeX renderer. The textarea/database remain source text.
const courseRichText=(()=>{
 const editors=new Map();
 function render(host,value,empty='尚未填写内容。'){
  if(!host)return;const source=String(value||'');host.classList.add('mm-rich','course-rich-text');
  host.classList.toggle('is-empty',!source.trim());
  if(!source.trim()){host.textContent=empty;return;}
  if(!window.MMContent?.render||!window.MMContent.isRich(source)){host.textContent=source;return;}
  host.innerHTML=window.MMContent.render(source);
  for(const input of host.querySelectorAll('input')){input.disabled=true;input.setAttribute('aria-readonly','true');}
  const errors=host.querySelectorAll('.mm-math-error').length;
  if(errors){const notice=document.createElement('p');notice.className='course-math-notice';notice.setAttribute('role','status');notice.textContent=`有 ${errors} 处公式暂时无法排版，已保留公式原文，请在编辑时核对。`;host.append(notice);}
 }
 function setMode(id,mode){const editor=editors.get(id);if(!editor)return;editor.mode=mode;const preview=mode==='preview';editor.input.hidden=preview;editor.preview.hidden=!preview;for(const button of editor.buttons)button.setAttribute('aria-pressed',String(button.dataset.mode===mode));if(preview)render(editor.preview,editor.input.value,'暂无内容，可切回编辑原文。');}
 function refresh(id){const list=id?[editors.get(id)]:[...editors.values()];for(const editor of list)if(editor?.mode==='preview')render(editor.preview,editor.input.value,'暂无内容，可切回编辑原文。');}
 function mount(id,label){const input=document.getElementById(id);if(!input||editors.has(id))return;input.classList.add('course-editor-source');
  const controls=document.createElement('div');controls.className='course-text-mode';controls.setAttribute('role','group');controls.setAttribute('aria-label',label+'编辑与预览');
  for(const [mode,text]of [['edit','编辑原文'],['preview','预览效果']]){const button=document.createElement('button');button.type='button';button.className='edit-mini-btn';button.textContent=text;button.dataset.mode=mode;button.setAttribute('aria-pressed',String(mode==='edit'));button.onclick=()=>setMode(id,mode);controls.append(button);}
  const help=document.createElement('small');help.textContent='支持 Markdown 与 LaTeX；保存时保留原文。';controls.append(help);
  const preview=document.createElement('div');preview.id=id+'Preview';preview.className='course-text-preview';preview.hidden=true;preview.setAttribute('aria-label',label+'排版预览');
  input.before(controls);input.after(preview);editors.set(id,{input,preview,buttons:[...controls.querySelectorAll('button')],mode:'edit'});input.addEventListener('input',()=>refresh(id));
 }
 function reset(){for(const id of editors.keys())setMode(id,'edit');}
 mount('tagPickerResourceContent','正文');mount('tagPickerOutline','大纲');mount('tagPickerResourceOcrText','识别结果');
 mount('mistakeEditContent','题目');mount('mistakeEditAnswer','答案');
 mount('mistakeCreateContent','题目');mount('mistakeCreateAnswer','答案');
 return{render,setMode,refresh,reset};
})();
