/* Visual authoring only. Persist the existing prompt + blanks contract unchanged. */
function clozeEditorHtml(m){return `<section class="cloze-editor">
  <p class="ai-help">填写完整原文，点击“选中文字并挖空”，再选中要记忆的文字并在按钮变为蓝色“确定”时点击。每确认一次可继续选择下一处；点击彩色空位可调整。</p>
  <div class="cloze-toolbar"><button type="button" class="ai-primary" id="clozeMakeBlank">选中文字并挖空</button><button type="button" id="clozeUndo">撤销</button><button type="button" id="clozeExitMode" disabled>退出挖空模式</button></div>
  <label id="clozeSourceLabel">原文与空位</label><div id="clozeSource" class="cloze-source" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="clozeSourceLabel" spellcheck="false"></div>
  <p id="clozeStatus" role="status" aria-live="polite"></p>
  <details id="clozeFind"><summary>手机选词不方便？输入要挖的文字</summary><label>要挖的文字<input id="clozeFindText" autocomplete="off"></label><button type="button" id="clozeFindButton">查找可挖位置</button><div id="clozeMatches" class="cloze-matches"></div></details>
  <details id="clozeSettings"><summary>答案与提示（<span id="clozeCount">0</span> 处）</summary><div id="reviewWbBlanks">${(m.blanks||[]).map(wbBlank).join('')}</div></details>
  <textarea id="reviewWbPrompt" hidden>${escapeHtml(m.prompt||'')}</textarea></section>`;}
function resetClozeSelection(){
  const source=document.getElementById('clozeSource');
  if(source)source.savedRange=null;
  updateClozePickingButton();
}
function clozeNodeText(node){
  if(node.nodeType===3)return node.data;
  if(node.nodeType!==1&&node.nodeType!==11)return '';
  if(node.dataset?.clozeId)return '【'+node.dataset.clozeId+'】';
  if(node.nodeName==='BR')return '\n';
  return [...node.childNodes].map((child,i)=>((i>0&&['DIV','P'].includes(child.nodeName))?'\n':'')+clozeNodeText(child)).join('');
}
function rememberClozeEdit(){const source=document.getElementById('clozeSource');if(!source)return;source.history||=[];source.history.push(readWorkbenchMaterial());if(source.history.length>30)source.history.shift();}
function clozeMessage(text){document.getElementById('clozeStatus').textContent=text;}
function clozeRangeIsValid(range){
  const source=document.getElementById('clozeSource');
  if(!source||!range||range.collapsed||!source.contains(range.commonAncestorContainer))return false;
  if([...source.querySelectorAll('[data-cloze-id]')].some(chip=>range.intersectsNode(chip)))return false;
  const answer=clozeNodeText(range.cloneContents());
  return !!answer.trim()&&!!answer.replace(/[\s\u3000，。；：、,.!?！？"'（）()\[\]【】]/g,'');
}
function updateClozePickingButton(){
  const source=document.getElementById('clozeSource'),button=document.getElementById('clozeMakeBlank'),exit=document.getElementById('clozeExitMode');
  if(!source||!button)return;
  const picking=!!source.picking,ready=picking&&clozeRangeIsValid(source.savedRange);
  button.textContent=picking?'确定':'选中文字并挖空';
  button.disabled=picking&&!ready;
  button.classList.toggle('is-picking',picking);
  button.classList.toggle('is-ready',ready);
  button.setAttribute('aria-disabled',String(button.disabled));
  if(exit)exit.disabled=!picking;
}
function captureClozeSelection(){
  const source=document.getElementById('clozeSource');if(!source||source.hidden)return;
  if(!source.picking){source.savedRange=null;return;}
  const selection=getSelection();
  if(!selection.rangeCount)return;
  const range=selection.getRangeAt(0);
  if(!source.contains(range.commonAncestorContainer))return;
  source.savedRange=!range.collapsed&&clozeRangeIsValid(range)?range.cloneRange():null;
  updateClozePickingButton();
}
function clozeChip(blank){
  const chip=document.createElement('span');chip.className='cloze-chip';chip.dataset.clozeId=blank.id;chip.contentEditable='false';
  const edit=document.createElement('button');edit.type='button';edit.textContent=blank.answer||'待填写答案';edit.setAttribute('aria-label','调整空位：'+edit.textContent);edit.onclick=()=>{
    document.getElementById('clozeSettings').open=true;
    const row=[...wb('Blanks').children].find(row=>row.querySelector('[data-blank="id"]').value===blank.id);
    if(row){row.open=true;row.querySelector('[data-blank="answer"]').focus();}
  };
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='×';cancel.setAttribute('aria-label','取消挖空：'+(blank.answer||''));cancel.onclick=()=>{
    const row=[...wb('Blanks').children].find(row=>row.querySelector('[data-blank="id"]').value===blank.id);
    const source=document.getElementById('clozeSource');if(source)source.savedRange=null;
    if(row)removeReviewBlank(row.querySelector('button'));
    updateClozePickingButton();
  };chip.append(edit,cancel);return chip;
}
function refreshClozeEditor(){
  const source=document.getElementById('clozeSource');if(!source)return;
  const m=readWorkbenchMaterial(),signature=JSON.stringify(m);
  if(source.signature!==signature){
    source.replaceChildren();const blanks=new Map(m.blanks.map(b=>[b.id,b]));
    for(const part of m.prompt.split(/(【[A-Za-z][A-Za-z0-9_]*】)/g)){
      const blank=blanks.get(part.slice(1,-1));source.append(part.startsWith('【')&&part.endsWith('】')&&blank?clozeChip(blank):document.createTextNode(part));
    }
    source.signature=signature;resetClozeSelection();
    for(const row of wb('Blanks').children)row.querySelector('summary').textContent='空位答案：'+(row.querySelector('[data-blank="answer"]').value||'待填写');
  }
  document.getElementById('clozeCount').textContent=m.blanks.length;
  document.getElementById('clozeUndo').disabled=!source.history?.length;
  updateClozePickingButton();
}
function saveClozeSource(){
  const source=document.getElementById('clozeSource');wb('Prompt').value=clozeNodeText(source);
  source.signature=JSON.stringify(readWorkbenchMaterial());updateWorkbenchPreparation();
  document.getElementById('clozeMatches').replaceChildren();
}
function undoClozeEdit(){const source=document.getElementById('clozeSource'),m=source.history.pop();if(!m)return;wb('Prompt').value=m.prompt;wb('Blanks').innerHTML=m.blanks.map(wbBlank).join('');source.savedRange=null;source.signature=null;updateWorkbenchPreparation();updateClozePickingButton();clozeMessage('已撤销上一步。');}
function cancelClozeAtCaret(range,direction){
  const source=document.getElementById('clozeSource'),side=range.cloneRange();side.selectNodeContents(source);
  if(direction==='backward')side.setEnd(range.startContainer,range.startOffset);else side.setStart(range.startContainer,range.startOffset);
  const text=clozeNodeText(side.cloneContents()),match=direction==='backward'?text.match(/【([A-Za-z][A-Za-z0-9_]*)】$/):text.match(/^【([A-Za-z][A-Za-z0-9_]*)】/);
  if(!match)return false;
  const row=[...wb('Blanks').children].find(row=>row.querySelector('[data-blank="id"]').value===match[1]);if(!row)return false;
  source.savedRange=null;removeReviewBlank(row.querySelector('button'));updateClozePickingButton();clozeMessage('已取消挖空并恢复文字。');return true;
}
function makeClozeBlank(range=document.getElementById('clozeSource')?.savedRange){
  const source=document.getElementById('clozeSource');if(!source||source.hidden||reviewWorkbench?.busy)return;
  if(!range||!source.contains(range.commonAncestorContainer)||range.collapsed){clozeMessage('请先选中原文中的文字，或在下方输入要挖的文字。');return;}
  if([...source.querySelectorAll('[data-cloze-id]')].some(chip=>range.intersectsNode(chip))){clozeMessage('这段文字包含已有空位，请重新选择未挖空的文字。');return;}
  const answer=clozeNodeText(range.cloneContents());
  if(!answer.trim()||!answer.replace(/[\s\u3000，。；：、,.!?！？"'（）()\[\]【】]/g,'')){clozeMessage('请选择有实际内容的文字。');return;}
  if(answer.length>2000){clozeMessage('一个空位最多 2000 字，请缩小选区。');return;}
  const blanks=readWorkbenchMaterial().blanks;if(blanks.length>=20){clozeMessage('每份材料最多挖 20 处。');return;}
  rememberClozeEdit();let n=1;while(blanks.some(b=>b.id==='b'+n)||wb('Prompt').value.includes('【b'+n+'】'))n++;
  const blank={id:'b'+n,answer};wb('Blanks').insertAdjacentHTML('beforeend',wbBlank(blank));
  const chip=clozeChip(blank);range.deleteContents();range.insertNode(chip);source.savedRange=null;
  saveClozeSource();getSelection()?.removeAllRanges();document.getElementById('clozeCount').textContent=blanks.length+1;
  resetClozeSelection();
  clozeMessage('已挖空，答案自动记录。点击彩色文字可调整，点击 × 恢复原文。');
}
function findClozeText(){
  const source=document.getElementById('clozeSource'),query=document.getElementById('clozeFindText').value,host=document.getElementById('clozeMatches');host.replaceChildren();
  if(!source?.picking){clozeMessage('请先点击“选中文字并挖空”进入挖空模式。');return;}
  if(!query.trim()){clozeMessage('请先输入要挖的文字。');return;}
  const walker=document.createTreeWalker(source,NodeFilter.SHOW_TEXT);let node,count=0;
  while((node=walker.nextNode())){if(node.parentElement.closest('[data-cloze-id]'))continue;
    let offset=0,index;while((index=node.data.indexOf(query,offset))!==-1){
      const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+query.length);
      const button=document.createElement('button');button.type='button';button.textContent='第 '+(++count)+' 处：…'+node.data.slice(Math.max(0,index-14),index+query.length+14)+'…';button.onclick=()=>makeClozeBlank(range);host.append(button);offset=index+query.length;
    }
  }
  clozeMessage(count?'找到 '+count+' 处，点击对应位置挖空。':'没有找到未挖空的匹配文字。');
}
let clozeSelectionEvents;
function initClozeEditor(){
  clozeSelectionEvents?.abort();clozeSelectionEvents=new AbortController();
  const source=document.getElementById('clozeSource');if(!source)return;
  source.history=[];source.picking=false;source.savedRange=null;refreshClozeEditor();
  source.addEventListener('mouseup',captureClozeSelection);source.addEventListener('keyup',captureClozeSelection);source.addEventListener('touchend',captureClozeSelection);
  document.getElementById('clozeMakeBlank').onpointerdown=e=>{captureClozeSelection();if(e.pointerType==='mouse')e.preventDefault();};
  document.getElementById('clozeMakeBlank').onclick=()=>{
    if(reviewWorkbench?.busy)return;
    if(!source.picking){
      source.picking=true;source.savedRange=null;getSelection()?.removeAllRanges();source.focus();
      updateClozePickingButton();clozeMessage('请在原文中选择要记忆的文字；选中后点击蓝色“确定”。');
      return;
    }
    captureClozeSelection();
    if(!clozeRangeIsValid(source.savedRange)){
      updateClozePickingButton();clozeMessage('请先在原文中选择一段可挖空的文字。');
      return;
    }
    makeClozeBlank(source.savedRange);
  };
  source.addEventListener('selectstart',()=>{if(source.picking){source.savedRange=null;updateClozePickingButton();}});
  document.addEventListener('selectionchange',captureClozeSelection,{signal:clozeSelectionEvents.signal});
  source.addEventListener('keydown',e=>{if(e.key==='Escape'&&source.picking){resetClozeSelection();clozeMessage('已取消本次选词，仍处于挖空模式。');}});
  source.onbeforeinput=e=>{
    if(reviewWorkbench?.busy){e.preventDefault();return;}
    const selection=getSelection(),range=selection.rangeCount?selection.getRangeAt(0):null;
    if(range&&!range.collapsed&&[...source.querySelectorAll('[data-cloze-id]')].some(chip=>range.intersectsNode(chip))){e.preventDefault();clozeMessage('选区含有空位，请先点击 × 取消对应空位再修改。');return;}
    if(e.inputType==='historyUndo'){e.preventDefault();undoClozeEdit();return;}
    if(range?.collapsed&&['deleteContentBackward','deleteContentForward'].includes(e.inputType)&&cancelClozeAtCaret(range,e.inputType==='deleteContentBackward'?'backward':'forward')){e.preventDefault();return;}
    rememberClozeEdit();
  };
  source.oninput=()=>{
    resetClozeSelection();
    // Keep hidden metadata consistent with native browser editing.
    for(const row of [...wb('Blanks').children]){const id=row.querySelector('[data-blank="id"]').value;if(![...source.querySelectorAll('[data-cloze-id]')].some(c=>c.dataset.clozeId===id))row.remove();}
    saveClozeSource();document.getElementById('clozeCount').textContent=wb('Blanks').children.length;updateClozePickingButton();
  };
  source.onpaste=e=>{e.preventDefault();if(reviewWorkbench?.busy)return;const selection=getSelection();if(!selection.rangeCount)return;const range=selection.getRangeAt(0);if(!source.contains(range.commonAncestorContainer))return;if([...source.querySelectorAll('[data-cloze-id]')].some(c=>range.intersectsNode(c)))return;rememberClozeEdit();range.deleteContents();const text=document.createTextNode(e.clipboardData.getData('text/plain'));range.insertNode(text);range.setStartAfter(text);range.collapse(true);selection.removeAllRanges();selection.addRange(range);saveClozeSource();};
  source.ondrop=e=>e.preventDefault();
  document.getElementById('clozeUndo').onclick=undoClozeEdit;
  document.getElementById('clozeFindButton').onclick=findClozeText;
  document.getElementById('clozeExitMode').onclick=()=>{
    source.picking=false;source.savedRange=null;getSelection()?.removeAllRanges();updateClozePickingButton();
    clozeMessage('已退出挖空模式。再次点击“选中文字并挖空”可继续设置。');
  };
  updateClozePickingButton();
}
