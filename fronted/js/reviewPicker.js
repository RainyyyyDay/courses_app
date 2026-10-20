// 仅供总复习和创建计划使用：共享选择卡片、标签与只读预览，不参与复习执行。
function createReviewPickerFilters() {
  return Object.fromEntries(['material','note','mistake'].map(type=>[type,{q:'',favorite:false,status:'',category:'',tags:new Set(),tagsOpen:false,scroll:0}]));
}
function reviewPickerCard(row,selected,busy,choiceAttribute,selectAction,previewAction,courseId=null) {
  const key=row.type+':'+row.id,title=escapeHtml(row.title || '（无标题）');
  const ai = row.type==='mistake' && courseId!==null && typeof mistakeAiSavedHtml==='function' ? mistakeAiSavedHtml(courseId,row.id) : '';
  return `<article class="total-review-card"><input ${choiceAttribute}="${key}" aria-label="选择${title}" type="checkbox" ${selected ? 'checked' : ''} ${busy || !row.reviewable ? 'disabled' : ''} onchange="${selectAction}('${key}',this.checked)" /><button type="button" class="total-review-item-title" onclick="${previewAction}('${key}',this)">${title}</button><button type="button" class="total-review-item-preview" onclick="${previewAction}('${key}',this)" aria-label="预览${title}"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>预览</button><small class="total-review-item-meta">${PLAN_TYPE_LABELS[row.type]} · ${mistakeStatusText(row.review_status)}${row.favorite ? ' · ★ 收藏' : ''}${!row.reviewable ? ' · 请先补齐题目或答案' : ''}</small>${ai ? `<small class="total-review-item-meta">${ai}</small>` : ''}</article>`;
}
function renderReviewPickerTags(state,prefix,changeAction) {
  const f=state.filters[state.tab],tags=new Map();
  state.rows.filter(row=>row.type===state.tab).forEach(row=>(row.nodes || []).forEach(tag=>tags.set(tag.id,tag.name)));
  const host=document.getElementById(prefix+'Tags'),toggle=document.getElementById(prefix+'TagsToggle');
  host.hidden=!f.tagsOpen;toggle.setAttribute('aria-expanded',String(f.tagsOpen));
  toggle.querySelector('span').textContent='知识点标签'+(f.tags.size ? ` (${f.tags.size})` : '');
  const focused=host.contains(document.activeElement) ? document.activeElement.value : null;
  host.innerHTML=tags.size ? [...tags].map(([id,name])=>`<label class="reading-review-tag"><input value="${id}" type="checkbox" ${f.tags.has(id) ? 'checked' : ''} ${state.busy ? 'disabled' : ''} onchange="${changeAction}(${id},this.checked)" />${escapeHtml(name)}</label>`).join('') : '暂无标签';
  if(focused)host.querySelector(`input[value="${focused}"]`)?.focus({preventScroll:true});
}
const REVIEW_PICKER_PREVIEWS={
  total:{selector:'totalReviewSelector',panel:'totalReviewPreview',title:'totalReviewPreviewTitle',body:'totalReviewPreviewBody',list:'totalReviewCandidates'},
  plan:{selector:'reviewPlanSelector',panel:'reviewPlanContentPreview',title:'reviewPlanContentPreviewTitle',body:'reviewPlanContentPreviewBody',list:'reviewPlanCandidates'}
};
async function openReviewPickerPreview(state,candidate,trigger,ids,isCurrentState,retryAction) {
  const key=candidate.type+':'+candidate.id,preview={key,trigger};state.preview=preview;
  const isCurrent=()=>isCurrentState() && state.courseId===currentCourseId && state.preview===preview;
  document.getElementById(ids.selector).hidden=true;document.getElementById(ids.panel).hidden=false;
  const title=document.getElementById(ids.title),body=document.getElementById(ids.body);
  title.textContent=PLAN_TYPE_LABELS[candidate.type]+'预览';title.focus();body.textContent='加载中…';body.scrollTop=0;
  try {
    const plural={material:'materials',note:'notes',mistake:'mistakes'}[candidate.type];
    const response=await requestApi(`${API}/${plural}/${candidate.id}`),row=await response.json();if(!isCurrent())return;
    if(row.course_id!==state.courseId)throw new Error('这条内容不属于当前课程');
    body.innerHTML=`<h3>${escapeHtml(row.title || '（无标题）')}</h3><p class="detail-meta">${PLAN_TYPE_LABELS[candidate.type]} · ${mistakeStatusText(row.review_status)}${candidate.type==='mistake' ? ' · '+(MISTAKE_TYPES[row.mistake_type] || '待分类') : ''}${row.favorite ? ' · ★ 收藏' : ''}</p><div>${rowNodes(row).map(tag=>tagChipHtml(tag,false,false)).join('')}</div>`;
    if(candidate.type==='mistake' && ids===REVIEW_PICKER_PREVIEWS.total && typeof mistakeAiSavedHtml==='function') body.insertAdjacentHTML('beforeend',mistakeAiSavedHtml(state.courseId,candidate.id));
    const section=(label,content,fileUrl,fileType)=>{
      const heading=document.createElement('h4');heading.textContent=label;body.appendChild(heading);
      if(content){const text=document.createElement('div');text.className='detail-content';text.textContent=content;body.appendChild(text);}
      if(fileUrl){const url=API.replace(/\/api\/?$/,'')+fileUrl,box=document.createElement('div');body.appendChild(box);renderResourcePreview(fileType || (isImageFile(fileType,fileUrl) ? 'image/*' : /\.pdf$/i.test(fileUrl) ? 'application/pdf' : ''),url,box);
        const link=document.createElement('a');link.className='detail-link';link.textContent='打开'+label+'附件';link.href=url;link.target='_blank';link.rel='noopener';body.appendChild(link);}
      if(!content && !fileUrl){const empty=document.createElement('p');empty.className='detail-meta';empty.textContent='暂无内容';body.appendChild(empty);}
    };
    section(candidate.type==='mistake' ? '题目' : '正文',row.content || row.ocr_text,row.file_url || row.image_url,row.file_type);
    if(candidate.type==='mistake'){section('参考答案',row.answer_content,row.answer_image_url,row.answer_file_type);section('解析 / 错误原因',row.explanation);}
  }catch(err){if(isCurrent())body.innerHTML=`<p class="material-review-error">${escapeHtml(err.message)}</p><button type="button" onclick="${retryAction}('${key}')">重试预览</button>`;}
}
function closeReviewPickerPreview(state,ids,fallbackId) {
  if(!state?.preview)return;
  const {trigger}=state.preview;state.preview=null;
  document.getElementById(ids.panel).hidden=true;document.getElementById(ids.selector).hidden=false;
  document.getElementById(ids.body).replaceChildren();
  document.getElementById(ids.list).scrollTop=state.filters[state.tab].scroll;
  if(trigger?.isConnected && !trigger.closest('[hidden]'))trigger.focus({preventScroll:true});else document.getElementById(fallbackId).focus({preventScroll:true});
}
function trapReviewPickerFocus(event,modalId) {
  if(event.key!=='Tab')return;
  const nodes=[...document.getElementById(modalId).querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], iframe')].filter(node=>node.getClientRects().length && node.tabIndex>=0);
  if(!nodes.length)return;
  if(event.shiftKey && (event.target===nodes[0] || !nodes.includes(event.target))){event.preventDefault();nodes.at(-1).focus();}
  else if(!event.shiftKey && (event.target===nodes.at(-1) || !nodes.includes(event.target))){event.preventDefault();nodes[0].focus();}
}
