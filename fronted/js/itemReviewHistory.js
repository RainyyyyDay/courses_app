/* One lazy, paginated history viewer for materials, notes and mistakes. Never calls AI. */
let itemReviewHistoryState=null;
function itemHistoryCurrent(s){return itemReviewHistoryState===s&&s.view===currentView&&s.courseId===currentCourseId&&s.host.isConnected;}
function resetItemReviewHistory(){itemReviewHistoryState=null;document.getElementById('itemReviewHistory')?.remove();}
function mountItemReviewHistory(host,type,id){
  resetItemReviewHistory();
  const section=document.createElement('section');section.id='itemReviewHistory';section.className='detail-card review-feedback';
  section.innerHTML='<details><summary>复习历史</summary><p class="ai-help">按实际复习轮次记录；查看历史不调用 AI，不修改评分或排期。</p><div data-history-list></div><p data-history-error role="alert" class="mistake-inline-error"></p><button type="button" data-history-more hidden>加载更多</button></details>';
  host.append(section);const s={host:section,type,id,courseId:currentCourseId,view:currentView,next:null,loaded:false,busy:false,keys:new Set()};itemReviewHistoryState=s;
  section.querySelector('details').addEventListener('toggle',e=>{if(e.target.open&&!s.loaded)void loadItemReviewHistory(s);});
  section.querySelector('[data-history-more]').onclick=()=>void loadItemReviewHistory(s);
}
function itemHistoryBase(s){return `${API}/courses/${s.courseId}/review-items/${s.type}/${s.id}/history`;}
function historyDate(value){const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString('zh-CN');}
function historyGrade(row){return row.modeId==='reading'?'仅阅读曝光，不评分':row.grade===null?'尚无关联评分':(['','Again · 未掌握','Hard · 基本掌握','Good · 掌握','Easy · 熟练'][row.grade]||'未知评分');}
async function loadItemReviewHistory(s=itemReviewHistoryState){
  if(!s||s.busy||!itemHistoryCurrent(s))return;s.busy=true;
  const error=s.host.querySelector('[data-history-error]'),more=s.host.querySelector('[data-history-more]');error.textContent='';more.disabled=true;
  try{
    const data=await(await requestApi(itemHistoryBase(s)+(s.next?'?before='+encodeURIComponent(s.next):''))).json();
    if(!itemHistoryCurrent(s))return;
    const list=s.host.querySelector('[data-history-list]');
    if(!s.loaded&&!data.items.length)list.textContent='暂无复习历史，开始并提交复习后可在这里查看。';
    for(const row of data.items){if(s.keys.has(row.key))continue;s.keys.add(row.key);
      const entry=document.createElement('details');entry.className='review-ai-draft';entry.dataset.historyKey=row.key;
      const stages={question:'未完成',answer:'已作答，待自评',completed:'本轮已完成',skipped:'已跳过'};
      entry.innerHTML='<summary>'+escapeHtml(historyDate(row.startedAt))+' · '+escapeHtml(AI_REVIEW_METHODS[row.modeId]||row.modeId)+' · '+escapeHtml(stages[row.stage]||'状态未知')+'</summary><p>'+escapeHtml(historyGrade(row))+' · '+(row.feedbackCount?'AI 批改 '+row.feedbackCount+' 版':'暂无已保存的 AI 批改')+'</p><div data-history-detail></div>';
      entry.addEventListener('toggle',event=>{if(event.target===entry&&entry.open&&!entry.dataset.loaded)void loadItemReviewHistoryDetail(s,entry,row.key);});list.append(entry);
    }
    s.loaded=true;s.next=data.next;more.hidden=!s.next;more.textContent='加载更多';
  }catch(err){if(itemHistoryCurrent(s)){error.textContent='历史加载失败：'+err.message;more.hidden=false;more.textContent='重试加载';}}
  finally{s.busy=false;more.disabled=false;}
}
function historyText(title,value){return value===null||value===undefined||value===''?'':'<h4>'+escapeHtml(title)+'</h4><div class="detail-content">'+escapeHtml(typeof value==='string'?value:JSON.stringify(value,null,2))+'</div>';}
function historyFeedbackHtml(item){
  const f=item.feedback,labels={correct:'基本正确',partial:'部分正确 / 有遗漏',incorrect:'需要修正',uncertain:'暂不能判断'};
  return '<section class="review-ai-draft" data-history-feedback-version="'+item.version+'"><h4>AI 批改 · 版本 '+item.version+'</h4><p class="ai-help">'+escapeHtml(historyDate(item.createdAt))+' · '+escapeHtml(item.provider==='mock'?'Mock 演示，未实际批改':item.model+' · AI 参考意见，不是最终评分')+'</p>'
    +historyText(labels[f.judgment]||'参考判断',f.summary)+(f.errors||[]).map(e=>'<div class="review-feedback-error">'+historyText('你的作答片段',e.quote)+historyText('错误与遗漏',e.explanation)+historyText('如何修正',e.correction)+'</div>').join('')
    +historyText('参考解答 / 要点',f.reference_answer)+historyText('解析步骤',(f.steps||[]).join('\n'))+historyText('改进建议',(f.suggestions||[]).join('\n'))+historyText('参考核验',f.reference_check)+'</section>';
}
async function loadItemReviewHistoryDetail(s,entry,key,before){
  if(!itemHistoryCurrent(s)||entry.dataset.busy)return;entry.dataset.busy='true';
  const host=entry.querySelector('[data-history-detail]');host.querySelector('[data-history-detail-error]')?.remove();
  try{
    const data=await(await requestApi(itemHistoryBase(s)+'/'+encodeURIComponent(key)+(before?'?beforeFeedbackId='+before:''))).json();if(!itemHistoryCurrent(s))return;
    if(!before){const m=data.material;host.innerHTML=historyText('本轮题面 / 阅读正文',m?.prompt)+historyText('比较对象',m?.objects?.join(' / '))+historyText('比较维度',m?.dimensions?.join('、'))+historyText('选项',m?.options?.map(o=>o.id+'：'+o.text).join('\n'))+historyText('首次作答',data.firstAnswer)
      +historyText('参考答案 / 要点',m?.reference)+historyText('评分量规 / 解析',m?.rubric)+historyText('正确选项',m?.correctOption)+historyText('逐空参考',m?.blanks)+historyText('耗时',data.durationMs?Math.round(data.durationMs/1000)+' 秒':'未记录')+historyText('说明',data.note)
      +(!data.referenceAvailable&&data.modeId!=='reading'?'<p class="ai-help">本轮尚未揭示参考答案；历史页面也不提前展示。</p>':'');entry.dataset.loaded='true';}
    host.querySelector('[data-history-older]')?.remove();
    for(const f of data.feedback.items)host.insertAdjacentHTML('beforeend',historyFeedbackHtml(f));
    if(data.feedback.nextBeforeId){const button=document.createElement('button');button.type='button';button.dataset.historyOlder='';button.textContent='查看更早的批改版本';button.onclick=()=>void loadItemReviewHistoryDetail(s,entry,key,data.feedback.nextBeforeId);host.append(button);}
  }catch(err){if(itemHistoryCurrent(s)){const p=document.createElement('p');p.dataset.historyDetailError='';p.className='mistake-inline-error';p.textContent='详情加载失败：'+err.message;const retry=document.createElement('button');retry.textContent='重试';retry.onclick=()=>void loadItemReviewHistoryDetail(s,entry,key,before);p.append(retry);host.append(p);}}
  finally{delete entry.dataset.busy;}
}
