function reviewPlanPickerScenario({pickerOnly=false}={}) {
  return `
    {
      const api=async(method,url,body)=>{const response=await requestApi(API+url,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return response.json();};
      const course=await api('POST','/courses',{name:'创建计划弹窗测试'}),c='/courses/'+course.id;
      openCourse(course.id,course.name,'reviewPlans');await loadReviewPlans();
      const m=await api('POST',c+'/materials',{title:'收藏资料',content:'资料正文检索词'}),m2=await api('POST',c+'/materials',{title:'第二份资料',content:'补充资料正文'});
      const n=await api('POST',c+'/notes',{title:'课堂笔记',content:'笔记正文检索词'}),w=await api('POST',c+'/mistakes',{title:'知识错题',content:'题目正文',mistakeType:'knowledge',answerContent:'参考答案'});
      await api('POST',c+'/mistakes',{title:'思维错题',content:'第二题',mistakeType:'thinking',answerContent:'第二答案'});
      const broken=await api('POST',c+'/mistakes',{title:'尚未补齐答案',content:'题目',mistakeType:'execution'});
      await api('PATCH',c+'/materials/'+m.id,{favorite:true});await api('PATCH',c+'/materials/'+m.id+'/review',{reviewStatus:'reviewed'});
      const tag=await api('POST',c+'/knowledge-nodes',{name:'直接关联标签',type:'knowledge'});await api('PUT','/materials/'+m.id+'/nodes',{nodeIds:[tag.id]});await api('PUT','/notes/'+n.id+'/nodes',{nodeIds:[tag.id]});
      const field=id=>document.getElementById(id),rect=el=>el.getBoundingClientRect(),today=planLocalDate(),exam=new Date(Date.parse(today+'T00:00:00Z')+86400000*12).toISOString().slice(0,10);
      await openReviewPlanCreate();check(field('reviewPlanModal').classList.contains('show') && field('reviewPlanStart').value===today,'plan picker opens with existing local-date default');
      check(field('reviewPlanGenerate').disabled && !field('reviewPlanType'),'required fields/selection disabled, old type dropdown removed');
      await createReviewPlan();check(reviewPlanCreate && field('reviewPlanCreateError').textContent.includes('名称'),'programmatic invalid submit is blocked locally');
      field('reviewPlanName').value='期末考试复习';field('reviewPlanName').dispatchEvent(new Event('input'));
      selectReviewPlanItem('material:'+m.id,true);check(field('reviewPlanGenerate').disabled,'missing exam disables create');
      for(const invalid of ['',today,new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10)]){field('reviewPlanExam').value=invalid;renderReviewPlanPreview();check(field('reviewPlanGenerate').disabled,'invalid/missing/same-day/before-start exam rejected');}
      field('reviewPlanExam').value=exam;renderReviewPlanPreview();check(!field('reviewPlanGenerate').disabled,'valid form and selection enable create');
      field('reviewPlanName').value='   ';renderReviewPlanPreview();check(field('reviewPlanGenerate').disabled,'whitespace name invalid');field('reviewPlanName').value='期末考试复习';renderReviewPlanPreview();
      const modal=field('reviewPlanModal'),dialog=field('reviewPlanForm'),tabs=[...modal.querySelectorAll('[role=tab]')],list=field('reviewPlanCandidates');
      const checkLayout=()=>{
        check(rect(dialog).width<=innerWidth-32+1 && (innerWidth<1000 || (rect(dialog).width>=900 && rect(dialog).width<=1000)),'plan dialog 900-1000px and viewport minus 32px');
        check(rect(dialog).height<=innerHeight*.9+1 && rect(dialog).top>=0 && rect(dialog).bottom<=innerHeight,'90% viewport centered dialog');
        check(rect(modal.querySelector('.total-review-close')).left>rect(field('reviewPlanCreateTitle')).right && Math.abs(rect(modal.querySelector('.total-review-close')).top-rect(field('reviewPlanCreateTitle')).top)<8,'close button aligned upper right, not below title');
        check(Math.max(...tabs.map(tab=>rect(tab).width))-Math.min(...tabs.map(tab=>rect(tab).width))<1,'three equal tabs');
        check(Math.abs(rect(field('reviewPlanStart')).width-rect(field('reviewPlanExam')).width)<1 && rect(field('reviewPlanStart')).top===rect(field('reviewPlanExam')).top,'equal dates on same grid row');
        const all=field('reviewPlanSelectAll'),label=all.closest('label');check(rect(all).width===14 && rect(label).width<220,'all checkbox is small and adjacent to label');
        for(const control of [...modal.querySelectorAll('.total-review-filters select,.total-review-filters button')].filter(el=>el.getClientRects().length))check(rect(control).height>=30 && rect(control).height<=34 && parseFloat(getComputedStyle(control).fontSize)<=13,'compact filters');
        for(const card of modal.querySelectorAll('.total-review-card')){const checkbox=card.querySelector('input'),title=card.querySelector('.total-review-item-title'),preview=card.querySelector('.total-review-item-preview'),meta=card.querySelector('small');check(rect(checkbox).width===14 && rect(title).left-rect(checkbox).right<16 && Math.abs(rect(title).left-rect(meta).left)<1 && rect(preview).left>=rect(title).right-1,'checkbox title metadata preview have stable grid alignment');}
        check(rect(modal.querySelector('.total-review-footer')).bottom<=rect(dialog).bottom+1 && rect(list).height>=140,'visible footer and useful independent list height');
        for(const el of [dialog,list,...modal.querySelectorAll('.total-review-card')])check(el.scrollWidth<=el.clientWidth+1,'no picker horizontal overflow');
      };
      checkLayout();const actualRows=reviewPlanCreate.rows;
      reviewPlanCreate.rows=[...actualRows,...Array.from({length:28},(_,i)=>({...m,id:900000+i,type:'material',title:i===0 ? '超长文件名WithoutSpaces'.repeat(22)+'.pdf' : '额外复习资料 '+i,nodes:[],reviewable:1}))];renderReviewPlanSelection();checkLayout();
      check(list.scrollHeight>list.clientHeight,'injected list overflows its own scroll viewport');
      list.scrollTop=160;rememberReviewPlanScroll();check(list.scrollTop>0,'list scrolls independently of the dialog');const savedScroll=list.scrollTop,head=rect(field('reviewPlanCreateTitle')).top,footer=rect(modal.querySelector('.total-review-footer')).top;
      const snapshot=()=>JSON.stringify({name:field('reviewPlanName').value,start:field('reviewPlanStart').value,exam:field('reviewPlanExam').value,tab:reviewPlanCreate.tab,ids:[...reviewPlanCreate.ids],q:field('reviewPlanSearch').value,scroll:reviewPlanCreate.filters[reviewPlanCreate.tab].scroll});
      const before=snapshot();list.querySelector('.total-review-item-title').click();await waitUntil(()=>field('reviewPlanContentPreviewBody').textContent.includes('资料正文检索词'),'plan title opens shared actual text preview');
      check(!field('reviewPlanContentPreview').hidden && field('reviewPlanSelector').hidden,'preview swaps only modal body');closeReviewPlanPreview();check(snapshot()===before && list.scrollTop===savedScroll,'preview preserves form tab selection filters and exact scroll');
      check(rect(field('reviewPlanCreateTitle')).top===head && rect(modal.querySelector('.total-review-footer')).top===footer,'scroll does not move header/footer');
      reviewPlanCreate.rows=actualRows;reviewPlanCreate.filters.material.scroll=0;renderReviewPlanSelection();
      field('reviewPlanSearch').value='资料正文检索词';field('reviewPlanFavorite').checked=true;field('reviewPlanStatus').value='reviewed';renderReviewPlanSelection();field('reviewPlanTagsToggle').click();changeReviewPlanTag(tag.id,true);
      check(filteredReviewPlanCandidates().length===1 && !field('reviewPlanTags').hidden,'search/favorite/status/direct tag combine');
      switchReviewPlanTab('note');check(field('reviewPlanSearch').value==='' && !field('reviewPlanFavorite').checked && field('reviewPlanMistakeType').hidden && field('reviewPlanTags').hidden,'note own blank filters and hidden category/tags');
      field('reviewPlanSearch').value='笔记正文检索词';renderReviewPlanSelection();field('reviewPlanSelectAll').click();check(reviewPlanCreate.ids.size===2,'filtered all adds current note to other module selection');
      field('reviewPlanSelectAll').click();check(reviewPlanCreate.ids.size===1 && reviewPlanCreate.ids.has('material:'+m.id),'unselect all touches current results only');field('reviewPlanSelectAll').click();
      list.querySelector('.total-review-item-preview').click();await waitUntil(()=>field('reviewPlanContentPreviewBody').textContent.includes('笔记正文检索词'),'note eye preview');field('reviewPlanContentPreview').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));check(reviewPlanCreate.tab==='note' && field('reviewPlanSearch').value==='笔记正文检索词' && reviewPlanCreate.ids.size===2,'Escape closes only preview');
      switchReviewPlanTab('mistake');check(!field('reviewPlanMistakeType').hidden,'category shown only for mistakes');field('reviewPlanMistakeType').value='knowledge';renderReviewPlanSelection();check(filteredReviewPlanCandidates().length===1,'mistake category actually filters');field('reviewPlanSelectAll').click();
      list.querySelector('.total-review-item-preview').click();await waitUntil(()=>field('reviewPlanContentPreviewBody').textContent.includes('参考答案'),'shared mistake preview');check(field('reviewPlanContentPreviewBody').textContent.includes('题目正文'),'mistake question and answer');closeReviewPlanPreview();
      field('reviewPlanMistakeType').value='';renderReviewPlanSelection();check(modal.querySelector('[data-plan-choice="mistake:'+broken.id+'"]').disabled,'incomplete mistake disabled but can preview');field('reviewPlanMistakeType').value='knowledge';renderReviewPlanSelection();
      check(reviewPlanCreate.ids.size===3 && field('reviewPlanCounts').textContent==='资料 1 · 笔记 1 · 错题 1','cumulative typed footer counts');
      switchReviewPlanTab('material');check(field('reviewPlanSearch').value==='资料正文检索词' && field('reviewPlanFavorite').checked && field('reviewPlanStatus').value==='reviewed' && reviewPlanCreate.filters.material.tags.has(tag.id) && !field('reviewPlanTags').hidden,'material filters and open tags restored');
      const stored=[...reviewPlanCreate.ids];reviewPlanCreate.rows.push({...m,id:910001,type:'material',nodes:[],reviewable:1},{...n,id:910001,type:'note',nodes:[],reviewable:1});clearReviewPlanItems();selectReviewPlanItem('material:910001',true);selectReviewPlanItem('note:910001',true);check(reviewPlanCreate.ids.size===2,'same numeric IDs across modules remain distinct');clearReviewPlanItems();reviewPlanCreate.rows=actualRows;stored.forEach(key=>selectReviewPlanItem(key,true));
      const upload=async(kind,name,blob)=>{const form=new FormData();form.append('title',name);form.append('content','带附件的正文');form.append('file',blob,name);return (await requestApi(API+c+'/'+kind,{method:'POST',body:form})).json();};
      const image=await upload('materials','计划预览.png',new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3WQAAAAASUVORK5CYII='),ch=>ch.charCodeAt(0))],{type:'image/png'}));
      const pdf=await upload('notes','计划预览.pdf',new Blob(['%PDF-1.1\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\\ntrailer<</Root 1 0 R>>\\n%%EOF'],{type:'application/pdf'}));
      reviewPlanCreate.rows=[...actualRows,{...image,type:'material',nodes:[],reviewable:1},{...pdf,type:'note',nodes:[],reviewable:1}];
      await openReviewPlanPreview('material:'+image.id);await waitUntil(()=>field('reviewPlanContentPreviewBody').querySelector('img')?.naturalWidth===1,'plan actual uploaded image preview');closeReviewPlanPreview();await openReviewPlanPreview('note:'+pdf.id);check(field('reviewPlanContentPreviewBody').querySelector('iframe')?.src.endsWith(pdf.file_url),'plan PDF uses same iframe previewer');closeReviewPlanPreview();
      const originalFetch=window.fetch;let release;
      window.fetch=async(url,options)=>{if(String(url).endsWith('/notes/'+n.id))await new Promise(resolve=>release=resolve);return originalFetch(url,options);};const stale=openReviewPlanPreview('note:'+n.id);closeReviewPlanPreview();release();await stale;window.fetch=originalFetch;check(field('reviewPlanContentPreview').hidden,'late preview response ignored');
      const formBeforeFailure=snapshot();window.fetch=async(url,options)=>options?.method==='POST' && String(url).endsWith('/review-plans') ? Promise.reject(new TypeError('offline create')) : originalFetch(url,options);
      await createReviewPlan();window.fetch=originalFetch;check(snapshot()===formBeforeFailure && field('reviewPlanCreateError').textContent && !field('reviewPlanGenerate').disabled,'create failure preserves all form/selection state and retry');
      let creates=0;window.fetch=async(url,options)=>{if(options?.method==='POST' && String(url).endsWith('/review-plans'))creates++;return originalFetch(url,options);};await Promise.all([createReviewPlan(),createReviewPlan()]);window.fetch=originalFetch;
      check(creates===1 && currentView.type==='reviewPlan' && reviewPlanDetail.plan.total===3,'mixed typed selection creates once through unchanged API and opens original detail');
      check(reviewPlanDetail.items.every(item=>stored.includes(item.item_type+':'+item.item_id)),'created plan includes all three modules, not only active tab');
      backToReviewPlans();await loadReviewPlans();await openReviewPlanCreate();field('reviewPlanName').value='期末考试复习';field('reviewPlanExam').value=exam;selectReviewPlanItem('material:'+m.id,true);switchReviewPlanTab('note');selectReviewPlanItem('note:'+n.id,true);switchReviewPlanTab('mistake');selectReviewPlanItem('mistake:'+w.id,true);switchReviewPlanTab('material');
      const planState=reviewPlanCreate,planFields=snapshot();await openTotalReview();check(field('totalReviewModal').classList.contains('show') && field('totalReviewCandidates').querySelector('.total-review-card'),'total picker still uses shared cards');closeTotalReview();check(reviewPlanCreate===planState && snapshot()===planFields,'total picker does not mutate plan form');document.body.classList.add('plan-modal-open');
      checkLayout();closeReviewPlanCreate();check(!field('reviewPlanModal').classList.contains('show'),'close leaves no modal');await openReviewPlanCreate();closeReviewPlanCreate();check(!reviewPlanCreate,'cancel closes normally');
      if(${pickerOnly}){await openReviewPlanCreate();field('reviewPlanName').value='期末考试复习';field('reviewPlanExam').value=exam;selectReviewPlanItem('material:'+m.id,true);switchReviewPlanTab('note');selectReviewPlanItem('note:'+n.id,true);switchReviewPlanTab('mistake');selectReviewPlanItem('mistake:'+w.id,true);switchReviewPlanTab('material');document.activeElement.blur();result.dataset.result='passed';result.textContent='plan picker layout and interactions passed';document.body.appendChild(result);return;}
    }
  `;
}
module.exports={reviewPlanPickerScenario};
