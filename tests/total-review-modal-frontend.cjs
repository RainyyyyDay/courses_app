// Run inside the existing isolated Chrome/API regression fixture, at both viewport sizes.
function totalReviewModalBrowserScenario() {
  return `
      await openTotalReview();
      const modal=document.getElementById('totalReviewModal'),dialog=modal.querySelector('.total-review-dialog');
      const field=id=>document.getElementById(id),tabs=[...modal.querySelectorAll('[role=tab]')];
      const shown=selector=>[...modal.querySelectorAll(selector)].filter(el=>el.getClientRects().length);
      const rect=el=>el.getBoundingClientRect();
      await Promise.all(dialog.getAnimations().map(animation=>animation.finished.catch(()=>{})));
      check(tabs.length===3 && !field('totalReviewModules').querySelector('input'),'equal tabs replace module checkboxes');
      check(Math.max(...tabs.map(el=>rect(el).width))-Math.min(...tabs.map(el=>rect(el).width))<1,'three equal-width tabs');
      check(rect(dialog).width<=innerWidth-18 && (innerWidth<900 || (rect(dialog).width>=900 && rect(dialog).width<=1000)),'desktop 900-1000px and responsive width');
      check(rect(dialog).height<=innerHeight*.9+1 && rect(dialog).top>=0,'dialog bounded by 90% viewport');
      check(field('totalReviewTags').hidden && field('totalReviewMistakeType').hidden,'material category hidden and tags collapsed');
      check(rect(field('totalReviewSearch')).top>=rect(field('totalReviewModules')).bottom && rect(modal.querySelector('.total-review-filters')).top>=rect(modal.querySelector('.total-review-search')).bottom,'specified search then separate filter row');
      for(const control of shown('.total-review-filters select, .total-review-filters button')) {
        check(rect(control).height>=30 && rect(control).height<=34,'compact 30-34px controls');
        check(parseFloat(getComputedStyle(control).fontSize)>=12 && parseFloat(getComputedStyle(control).fontSize)<=13,'12-13px filter text');
      }
      const actualRows=totalReviewState.rows;
      // Long titles and many rows exercise wrapping and real independent overflow without modifying user data.
      const longTitle='很长的复习内容标题及正文测试'.repeat(14);
      totalReviewState.rows=[...actualRows,...Array.from({length:32},(_,i)=>({...m,id:900000+i,type:'material',title:i===0 ? longTitle : '列表滚动测试 '+i,nodes:[],reviewable:1}))];renderTotalReview();
      const list=field('totalReviewCandidates'),headTop=rect(field('totalReviewTitle')).top,tabTop=rect(tabs[0]).top,footTop=rect(modal.querySelector('.total-review-footer')).top;
      check(list.scrollHeight>list.clientHeight && list.clientHeight>60,'only content list has useful scroll area');
      list.scrollTop=180;rememberTotalReviewScroll();const scroll=list.scrollTop;
      field('totalReviewCandidates').querySelector('[data-total-choice="material:'+m.id+'"]').click();
      check(totalReviewState.ids.has('material:'+m.id) && Math.abs(list.scrollTop-scroll)<1,'checkbox preserves list scroll');
      const stateBefore=JSON.stringify([...totalReviewState.ids]);
      list.querySelector('.total-review-item-title').click();await waitUntil(()=>!field('totalReviewPreviewBody').textContent.includes('加载中'),'material preview loads');
      check(field('totalReviewPreviewBody').textContent.includes('first body') && JSON.stringify([...totalReviewState.ids])===stateBefore,'title opens actual detail without selecting');
      closeTotalReviewPreview();check(totalReviewState.tab==='material' && list.scrollTop===scroll,'preview restores active tab and exact scroll');
      switchTotalReviewTab('note');check(filteredTotalReview().every(row=>row.type==='note') && field('totalReviewMistakeType').hidden,'note only list, no category');
      field('totalReviewSearch').value='note body';field('totalReviewSearch').dispatchEvent(new Event('input'));
      field('totalReviewTagsToggle').click();changeTotalReviewTag(tag.id,true);
      check(!field('totalReviewTags').hidden && filteredTotalReview().length===1,'existing multiselect direct tags expand and filter');
      field('totalReviewSelectAll').click();check(totalReviewState.ids.size===2,'select filtered note adds to material');
      list.querySelector('.total-review-item-preview').click();await waitUntil(()=>field('totalReviewPreviewBody').textContent.includes('note body'),'note eye preview');
      field('totalReviewPreview').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      check(!totalReviewState.preview && modal.classList.contains('show') && field('totalReviewSearch').value==='note body' && totalReviewState.filters.note.tags.has(tag.id),'Escape closes preview only and keeps filters');
      switchTotalReviewTab('mistake');check(!field('totalReviewMistakeType').hidden && field('totalReviewTags').hidden && field('totalReviewSearch').value==='','mistake category visible and own blank filters');
      field('totalReviewMistakeType').value='thinking';renderTotalReview();check(filteredTotalReview().length===0,'mistake category actually filters');
      field('totalReviewMistakeType').value='knowledge';renderTotalReview();field('totalReviewSelectAll').click();
      list.querySelector('.total-review-item-preview').click();await waitUntil(()=>field('totalReviewPreviewBody').textContent.includes('参考答案'),'mistake read-only detail');
      check(field('totalReviewPreviewBody').textContent.includes('question') && field('totalReviewPreviewBody').textContent.includes('answer'),'mistake question and answer rendered');closeTotalReviewPreview();
      check(totalReviewState.ids.size===3 && field('totalReviewCounts').textContent==='资料 1 · 笔记 1 · 错题 1' && !field('totalReviewStart').disabled,'live cross-module totals enable start');
      switchTotalReviewTab('note');check(field('totalReviewSearch').value==='note body' && !field('totalReviewTags').hidden && totalReviewState.filters.note.tags.has(tag.id),'note independent search and expanded tags restored');
      switchTotalReviewTab('material');check(field('totalReviewSearch').value==='' && list.scrollTop===scroll && totalReviewState.ids.size===3,'switch restores material scroll without clearing any module');
      check(rect(field('totalReviewTitle')).top===headTop && rect(tabs[0]).top===tabTop && rect(modal.querySelector('.total-review-footer')).top===footTop,'header tabs footer stay fixed during scrolling');
      check(dialog.scrollWidth<=dialog.clientWidth+1 && list.scrollWidth<=list.clientWidth+1 && document.documentElement.scrollWidth<=innerWidth,'no horizontal overflow with long title');
      // Actual multipart attachments: shared previewer must render an image and a PDF, not just a text stub.
      const upload=async(kind,name,blob)=>{const form=new FormData();form.append('title',name);form.append('content','带附件的正文');form.append('file',blob,name);const response=await requestApi(API+c+'/'+kind,{method:'POST',body:form});return response.json();};
      const image=await upload('materials','预览图片.png',new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3WQAAAAASUVORK5CYII='),ch=>ch.charCodeAt(0))],{type:'image/png'}));
      const pdfText='%PDF-1.1\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\\ntrailer<</Root 1 0 R>>\\n%%EOF';
      const pdf=await upload('notes','预览文档.pdf',new Blob([pdfText],{type:'application/pdf'}));
      totalReviewState.rows.push({...image,type:'material',nodes:[],reviewable:1},{...pdf,type:'note',nodes:[],reviewable:1});
      await openTotalReviewPreview('material:'+image.id);await waitUntil(()=>field('totalReviewPreviewBody').querySelector('img')?.complete,'shared image preview loads');
      check(field('totalReviewPreviewBody').querySelector('img').naturalWidth===1 && field('totalReviewPreviewBody').textContent.includes('带附件的正文'),'image loads alongside body');closeTotalReviewPreview();
      switchTotalReviewTab('note');await openTotalReviewPreview('note:'+pdf.id);
      check(field('totalReviewPreviewBody').querySelector('iframe')?.src.endsWith(pdf.file_url) && field('totalReviewPreviewBody').querySelector('a[target="_blank"]'),'PDF uses shared iframe and open attachment fallback');closeTotalReviewPreview();
      check((await fetch(API.replace(/\\/api\\/?$/,'')+pdf.file_url)).ok,'uploaded PDF attachment served successfully');
      await api('DELETE','/materials/'+image.id);await api('DELETE','/notes/'+pdf.id);
      const originalFetch=window.fetch;
      window.fetch=async(url,options)=>String(url).endsWith('/notes/'+note.id) ? {ok:false,status:503,json:async()=>({message:'preview unavailable'})} : originalFetch(url,options);
      await openTotalReviewPreview('note:'+note.id);check(field('totalReviewPreviewBody').textContent.includes('preview unavailable') && totalReviewState.ids.size===3,'preview failure preserves selection');window.fetch=originalFetch;
      field('totalReviewPreviewBody').querySelector('button').click();await waitUntil(()=>field('totalReviewPreviewBody').textContent.includes('note body'),'preview retry');closeTotalReviewPreview();
      // A late detail response after closing must never reopen or overwrite the selector.
      let release;window.fetch=async(url,options)=>{if(String(url).endsWith('/notes/'+note.id)){await new Promise(resolve=>release=resolve);}return originalFetch(url,options);};
      const late=openTotalReviewPreview('note:'+note.id);closeTotalReviewPreview();release();await late;window.fetch=originalFetch;
      check(field('totalReviewPreview').hidden && !field('totalReviewSelector').hidden && totalReviewState.ids.size===3,'late preview response ignored');
      switchTotalReviewTab('mistake');check(field('totalReviewMistakeType').value==='knowledge','mistake category restored independently');
      field('totalReviewFavorite').checked=true;field('totalReviewStatus').value='reviewed';renderTotalReview();
      check(filteredTotalReview().length===0 && totalReviewState.ids.size===3,'mistake favorite and status filters preserve hidden selections');
      switchTotalReviewTab('note');check(!field('totalReviewFavorite').checked && field('totalReviewStatus').value==='','note favorite/status independent');
      switchTotalReviewTab('material');renderTotalReview();
      // Keep a representative populated layout for the optional screenshot run.
      totalReviewState.rows=[...actualRows,...Array.from({length:12},(_,i)=>({...m,id:900000+i,type:'material',title:'复习资料 '+(i+1),nodes:[],reviewable:1}))];
      totalReviewState.filters.material.scroll=0;renderTotalReview();document.activeElement.blur();
  `;
}
module.exports={totalReviewModalBrowserScenario};
