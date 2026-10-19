async function mistakeAiModeChecks(check,el,prepare) {
  const modes=[['choice_reproduction','选择复现'],['standard','标准复习'],['cloze','挖空回忆'],
    ['self_explain','自述讲解'],['reading','阅读标记'],['contrast','对比辨析'],['retry','重新作答']];
  const options=[...el('Method').options].filter(option=>option.value).map(option=>[option.value,option.textContent]);
  check(JSON.stringify(options)===JSON.stringify(modes),'exact seven stable IDs and Chinese labels');
  check(JSON.stringify(Object.entries(AI_REVIEW_METHODS))===JSON.stringify(modes),'mapping matches seven options');
  const fetchBefore=window.fetch;
  let output;
  window.fetch=async()=>new Response(JSON.stringify({review_method:output,reason:'Mock 演示建议',needs_review:true}),{status:200});
  const open=id=>{resetMistakeAi();prepare(id);toggleMistakeAi();};
  const request=async()=>{el('StudentAnswer').value='3';el('ErrorType').value='careless';await requestMistakeAi();};
  const key=id=>'mistake-ai-method:42:'+id;
  try {
    for(const [method,label] of modes){
      localStorage.removeItem(key(81));open(81);output=method;await request();
      check(el('Suggested').textContent.includes(label) && el('Method').value===method,'valid AI mode rendered: '+method);
      check(!localStorage.getItem(key(81)),'AI output never autosaves');
      el('Confirm').click();
      check(readMistakeAiMethod(mistakeDetailState)===method,'stable ID saved: '+method);
      resetMistakeAi();toggleMistakeAi();
      check(el('Method').value===method && el('Confirmation').textContent.includes(label),'restores confirmed mode: '+method);
    }
    localStorage.setItem(key(82),JSON.stringify({version:1,method:'retry'}));open(82);
    output='unclassified';await request();
    check(el('Suggested').textContent==='AI 暂未给出可用建议，请人工选择','fallback is a prompt, not an eighth mode');
    check(el('Method').value==='' && el('Confirm').disabled,'fallback requires explicit valid selection');
    check(readMistakeAiMethod(mistakeDetailState)==='retry','fallback preserves prior confirmed mode');
    confirmMistakeAiSuggestion();check(readMistakeAiMethod(mistakeDetailState)==='retry','invalid fallback cannot save');
    el('Method').value='contrast';changeMistakeAiSuggestion();el('Confirm').click();
    check(readMistakeAiMethod(mistakeDetailState)==='contrast','manual choice after fallback saves');
    for(const legacy of ['recall','guided','unclassified']){
      const raw=JSON.stringify({version:1,method:legacy,extra:'preserve original'});
      localStorage.setItem(key(83),raw);open(83);
      check(el('Suggested').textContent.includes('重新选择') && el('Method').value==='' && el('Confirm').disabled,'legacy is not silently remapped: '+legacy);
      check(mistakeAiSavedText(mistakeDetailState).includes('重新选择'),'list/total summary warns about legacy');
      el('Method').value='standard';changeMistakeAiSuggestion();
      check(localStorage.getItem(key(83))===raw,'unconfirmed migration leaves original record');
      resetMistakeAi();toggleMistakeAi();
      check(localStorage.getItem(key(83))===raw && el('Method').value==='','closing retains legacy bytes');
      el('Method').value='reading';changeMistakeAiSuggestion();el('Confirm').click();
      check(readMistakeAiMethod(mistakeDetailState)==='reading','explicit new choice can replace legacy');
    }
    const raw=JSON.stringify({version:1,method:'guided'});localStorage.setItem(key(83),raw);open(83);
    const set=Storage.prototype.setItem;
    el('Method').value='standard';changeMistakeAiSuggestion();
    try{Storage.prototype.setItem=()=>{throw Error('quota');};el('Confirm').click();}
    finally{Storage.prototype.setItem=set;}
    check(localStorage.getItem(key(83))===raw && el('Confirmation').textContent.includes('本地保存失败'),'failed migration preserves old record');
    el('Confirm').click();check(readMistakeAiMethod(mistakeDetailState)==='standard','failed migration can retry');
  } finally {
    resetMistakeAi();window.fetch=fetchBefore;
    for(const id of [81,82,83])localStorage.removeItem(key(id));
  }
}
module.exports={mistakeAiModeChecks};
