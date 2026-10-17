const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

function testMaterialReviewMigration(source,temp) {
  const fixture=path.join(temp,'reading-migration'); fs.mkdirSync(fixture);
  fs.cpSync(path.join(source,'db'),path.join(fixture,'db'),{recursive:true});
  const script=`
    const assert=require('node:assert/strict'); const store=require('./db/index.js');
    const course=store.createCourse('阅读迁移'); const tag=store.createKnowledgeNode(course.id,null,'标签','knowledge');
    const material=store.createMaterial(course.id,'旧资料','/uploads/old.pdf','application/pdf',[tag.id],'资料原文');
    store.db.exec('ALTER TABLE materials DROP COLUMN review_status'); store.db.exec('PRAGMA user_version=7');
    delete require.cache[require.resolve('./db/schema.js')]; require('./db/schema.js');
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,13);
    assert.equal(store.findMaterial(material.id).review_status,'unreviewed');
    store.setMaterialReviewStatus(material.id,course.id,'reviewed');
    const note=store.createNote(course.id,'旧笔记','/uploads/old.png','image/png','manual',[tag.id],'笔记原文');
    store.db.exec('ALTER TABLE notes DROP COLUMN review_status'); store.db.exec('PRAGMA user_version=8');
    delete require.cache[require.resolve('./db/schema.js')]; require('./db/schema.js');
    const migrated=store.findNote(note.id); assert.equal(migrated.review_status,'unreviewed');
    for(const key of ['title','content','source','file_url','file_type','created_at'])assert.equal(migrated[key],note[key]);
    assert.deepEqual(store.listNoteNodes(note.id).map(n=>n.id),[tag.id]);
    assert.equal(store.findMaterial(material.id).review_status,'reviewed');
    assert.equal(store.findMaterial(material.id).content,material.content);
    store.setNoteReviewStatus(note.id,course.id,'reviewed');
    store.db.exec('PRAGMA user_version=8'); delete require.cache[require.resolve('./db/schema.js')]; require('./db/schema.js');
    assert.equal(store.findNote(note.id).review_status,'reviewed');
    assert.equal(store.db.prepare('PRAGMA table_info(notes)').all().filter(c=>c.name==='review_status').length,1);
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,13);
    for (const table of ['materials','notes']) store.db.exec('ALTER TABLE '+table+' DROP COLUMN favorite');
    store.db.exec('PRAGMA user_version=9'); delete require.cache[require.resolve('./db/schema.js')]; require('./db/schema.js');
    assert.equal(store.findMaterial(material.id).favorite,0); assert.equal(store.findNote(note.id).favorite,0);
    store.setMaterialFavorite(material.id,course.id,true); store.setNoteFavorite(note.id,course.id,true);
    store.db.exec('PRAGMA user_version=9'); delete require.cache[require.resolve('./db/schema.js')]; require('./db/schema.js');
    assert.equal(store.findMaterial(material.id).favorite,1); assert.equal(store.findNote(note.id).favorite,1);
    assert.equal(store.findNote(note.id).review_status,'reviewed'); assert.equal(store.findMaterial(material.id).review_status,'reviewed');
    assert.equal(store.findMaterial(material.id).content,material.content); assert.equal(store.findNote(note.id).content,note.content);
    assert.deepEqual(store.listNoteNodes(note.id).map(n=>n.id),[tag.id]);
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,13);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]); store.db.close();
  `;
  const result=spawnSync(process.execPath,['-e',script],{cwd:fixture,windowsHide:true,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  console.log('PASS reading migration: v7/v8/v9 to v13, legacy content/files/tags/status preserved, favorites default and repeat safe');
}
async function testMaterialReviewApi({base,course,child,other,restart}) {
  async function request(method,url,body,status=200) {
    const response=await fetch(base+url,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const json=await response.json(); assert.equal(response.status,status,JSON.stringify(json)); return json;
  }
  for(const kind of ['materials','notes']) {
    const row=await request('POST',`/courses/${course.id}/${kind}`,{title:kind+'复习API',content:'原文',nodeIds:[child.id]},201);
    const url=`/courses/${course.id}/${kind}/${row.id}/review`;
    assert.equal(row.review_status,'unreviewed');
    assert.equal(row.favorite,0);
    const favoriteUrl=url.replace('/review','');
    let favoriteRow=await request('PATCH',favoriteUrl,{favorite:true});
    assert.equal(favoriteRow.favorite,1); assert.equal(favoriteRow.review_status,'unreviewed');
    assert.deepEqual(await request('PATCH',favoriteUrl,{favorite:true}),favoriteRow);
    for(const status of ['reviewed','unreviewed','reviewed']) {
      const saved=await request('PATCH',url,{reviewStatus:status}); assert.equal(saved.review_status,status);
      assert.equal(saved.favorite,1);
      assert.equal(saved.content,row.content); assert.equal(saved.nodes[0].id,child.id);
      assert.deepEqual(await request('PATCH',url,{reviewStatus:status}),saved);
      assert.equal((await request('GET',`/${kind}/${row.id}`)).review_status,status);
      assert.equal((await request('GET',`/courses/${course.id}/${kind}`)).find(r=>r.id===row.id).review_status,status);
    }
    await restart(); assert.equal((await request('GET',url)).review_status,'reviewed');
    assert.equal((await request('GET',url)).favorite,1);
    for(const body of [{},{favorite:1},{favorite:'true'},{favorite:true,reviewStatus:'unreviewed'},[]])await request('PATCH',favoriteUrl,body,400);
    await request('PATCH',favoriteUrl.replace('/courses/'+course.id+'/', '/courses/'+other.course_id+'/'),{favorite:false},404);
    const extra=await request('POST',`/courses/${course.id}/${kind}`,{title:kind+'未收藏',content:'原文',nodeIds:[child.id]},201);
    const secondTag=await request('POST',`/courses/${course.id}/knowledge-nodes`,{name:kind+'收藏标签',type:'knowledge'},201);
    await request('PUT',`/${kind}/${row.id}/nodes`,{nodeIds:[child.id,secondTag.id]});
    const filtered=await request('GET',`/courses/${course.id}/${kind}?favorite=true&reviewStatus=reviewed&q=原文&nodeIds=${child.id},${secondTag.id}`);
    assert.deepEqual(filtered.map(r=>r.id),[row.id]);
    assert.ok(!(await request('GET',`/courses/${course.id}/${kind}?favorite=false`)).some(r=>r.id===row.id));
    if(child.parent_id) assert.ok(!(await request('GET',`/courses/${course.id}/${kind}?nodeIds=${child.parent_id}`)).some(r=>r.id===row.id));
    for(const query of ['favorite=invalid','reviewStatus=pending','nodeIds=0','nodeIds='+other.id,'favorite=true&favorite=false'])await request('GET',`/courses/${course.id}/${kind}?${query}`,undefined,400);
    for(const body of [{},{reviewStatus:'pending'},{reviewStatus:true},{reviewStatus:'reviewed',title:'覆盖'},[]]) await request('PATCH',url,body,400);
    for(const method of ['GET','PATCH']) await request(method,`/courses/${other.course_id}/${kind}/${row.id}/review`,method==='PATCH'?{reviewStatus:'unreviewed'}:undefined,404);
    await request('GET',`/courses/invalid/${kind}/1/review`,undefined,400);
    await request('GET',`/courses/999999999/${kind}/1/review`,undefined,404);
    await request('PUT',`/${kind}/${row.id}/nodes`,{title:'改名',nodeIds:[child.id]});
    assert.equal((await request('GET',url)).review_status,'reviewed');
    assert.equal((await request('GET',url)).favorite,1);
    assert.equal((await request('PATCH',favoriteUrl,{favorite:false})).review_status,'reviewed');
    assert.equal((await request('GET',url)).favorite,0);
    const foreign=await request('POST',`/courses/${other.course_id}/${kind}`,{title:'另一课程',content:'隔离',nodeIds:[other.id]},201);
    assert.ok(!(await request('GET',`/courses/${course.id}/${kind}`)).some(r=>r.id===foreign.id));
    await request('DELETE',`/${kind}/${row.id}`); await request('GET',url,undefined,404);
    await request('PATCH',favoriteUrl,{favorite:true},404);
    await request('DELETE',`/${kind}/${extra.id}`);
  }
  console.log('PASS material/note API: favorites save/cancel/restart, independent status, combined direct-tag filters, validation, isolation, CRUD/tags');
}

function materialBrowserPrelude() {
  return `
    async function materialBrowserRestore(check,waitUntil) {
      const saved=JSON.parse(sessionStorage.getItem('reading-review-refresh')||'null'); if(!saved)return false;
      const controller=saved.kind==='materials'?materialReadingReview:noteReadingReview;
      await waitUntil(()=>currentView.type==='readingReview'&&controller.row?.id===saved.ids[0],'reading actual refresh '+saved.kind);
      check(currentView.reviewKind===saved.kind&&controller.queue.kind===saved.kind,'restore independent kind');
      check(JSON.stringify(controller.queue.ids)===JSON.stringify(saved.ids)&&controller.queue.index===0&&controller.queue.pending,'restore pending operation and cursor');
      check(controller.row.review_status==='reviewed'&&document.getElementById('materialReviewNext').disabled,'backend status shown but unconfirmed save cannot skip');
      check(controller.row.favorite===saved.firstFavorite,'actual refresh preserves favorite independently of review');
      await controller.retry();
      check(controller.queue.index===1&&controller.queue.results[saved.ids[0]]==='reviewed','retry saved judgment auto advances');
      for(let i=1;i<saved.ids.length;i++) {
        check(controller.row.id===saved.ids[i],'fixed reading queue order');
        if(controller.row.file_type==='application/pdf')check(document.querySelector('#materialReviewPreview iframe'),'PDF preview');
        if(controller.row.file_type.startsWith('image/'))check(document.querySelector('#materialReviewPreview img'),'image preview');
        const old=controller.row.review_status, oldFavorite=controller.row.favorite, id=controller.row.id;
        document.getElementById('materialReviewNext').click();
        await waitUntil(()=>!controller.busy&&(controller.queue.finished||controller.queue.index===i+1&&controller.row),'skip actual button');
        const row=await(await requestApi(API+'/courses/'+currentCourseId+'/'+saved.kind+'/'+id+'/review')).json();
        check(row.review_status===old,'skip preserves previous status '+old);
        check(row.favorite===oldFavorite,'skip preserves favorite');
      }
      check(controller.queue.finished&&Object.keys(controller.queue.results).length===1&&controller.queue.skipped.length===2,'only successful save counts');
      check(document.getElementById('materialReviewComplete').textContent.includes('成功复习 1 条'),'accurate completion summary');
      await controller.pause();
      await (saved.kind==='materials'?loadMaterials():loadNotes());
      const restoredList=saved.kind==='materials'?'materialList':'noteList';
      check(document.querySelector('#'+restoredList+' [data-reading-favorite="'+saved.favoriteId+'"]').getAttribute('aria-pressed')==='true','ordinary list star restored after actual refresh');
      await controller.open();
      controller.select(saved.ids[0],true); await controller.start();
      check(controller.row.review_status==='reviewed','reviewed item can be reviewed again');
      await controller.save('reviewed'); check(controller.queue.finished,'last saved item auto completes');
      await controller.pause(); await controller.open(); controller.select(saved.ids[0],true); await controller.start();
      await controller.skip(); check(controller.queue.finished&&Object.keys(controller.queue.results).length===0,'skip last completes with zero successful reviews');
      await controller.pause();
      const currentId=saved.ids[0];
      const latest=await(await requestApi(API+'/courses/'+currentCourseId+'/'+saved.kind+'/'+currentId+'/review')).json();
      check(latest.review_status==='reviewed','repeat skip did not reset reviewed status');
      await controller.open(); controller.select(currentId,true); await controller.start();
      await controller.end();
      const key=(saved.kind==='materials'?'material':'note')+'-review-queue:'+currentCourseId;
      check(JSON.parse(localStorage.getItem(key))===null,'end clears only current round');
      if(saved.kind==='notes')check(localStorage.getItem('material-review-queue:'+currentCourseId)===saved.materialSnapshot,'note round did not overwrite material queue');
      sessionStorage.removeItem('reading-review-refresh'); return saved.kind;
    }
  `;
}
function materialBrowserScenario(data,kind='materials') {
  return `
    switchTab('${kind}');
    const readingController=${kind==='materials'?'materialReadingReview':'noteReadingReview'};
    const readingTag=await(await requestApi(API+'/courses/'+currentCourseId+'/knowledge-nodes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'阅读筛选-${kind}',type:'knowledge',parentId:null})})).json();
    const readingFixtures=[];
    for(const type of ['text','pdf','image']) {
      const form=new FormData();form.set('title','阅读浏览器-${kind}-'+type);form.set('content','正文-${kind}-'+type);
      form.set('nodeIds',JSON.stringify(type==='text'?[${data.child.id},readingTag.id]:type==='pdf'?[readingTag.id]:[${data.child.id}]));
      if(type==='pdf')form.set('file',new Blob(['%PDF-test'],{type:'application/pdf'}),'review.pdf');
      if(type==='image')form.set('file',new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN9sAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'}),'review.png');
      readingFixtures.push(await(await requestApi(API+'/courses/'+currentCourseId+'/${kind}',{method:'POST',body:form})).json());
    }
    await requestApi(API+'/courses/'+currentCourseId+'/${kind}/'+readingFixtures[1].id+'/review',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({reviewStatus:'reviewed'})});
    await ${kind==='materials'?'loadMaterials':'loadNotes'}();
    await waitUntil(()=>document.querySelector('#${kind}BrowseFilters .reading-browse-tags').textContent.includes('阅读筛选-${kind}'),'ordinary tags refreshed after new tag');
    const listId='${kind==='materials'?'materialList':'noteList'}';
    const firstStar=document.querySelector('#'+listId+' [data-reading-favorite="'+readingFixtures[0].id+'"]');
    check(firstStar&&firstStar.getAttribute('aria-pressed')==='false','ordinary list star available');
    firstStar.click();
    await waitUntil(()=>!readingFavoritePending.size&&document.querySelector('#'+listId+' [data-reading-favorite="'+readingFixtures[0].id+'"]').getAttribute('aria-pressed')==='true','ordinary star saved');
    const favoriteFetch=window.fetch;
    window.fetch=async(url,options)=>{if(options?.method==='PATCH'&&String(url).endsWith('/${kind}/'+readingFixtures[0].id))throw new TypeError('favorite save failed');return favoriteFetch(url,options);};
    document.querySelector('#'+listId+' [data-reading-favorite="'+readingFixtures[0].id+'"]').click();
    await waitUntil(()=>!readingFavoritePending.size&&document.querySelector('#${kind}BrowseFilters [role=alert]').textContent.includes('重试'),'favorite failure displayed');
    check(document.querySelector('#'+listId+' [data-reading-favorite="'+readingFixtures[0].id+'"]').getAttribute('aria-pressed')==='true','failed favorite keeps old UI');
    window.fetch=favoriteFetch;
    await changeReadingBrowse('${kind}','q','正文-${kind}'); await changeReadingBrowse('${kind}','favorite',true);
    check(document.querySelectorAll('#'+listId+' [data-reading-favorite]').length===1,'ordinary favorite plus body search');
    await changeReadingBrowseTag('${kind}',${data.child.id},true);await changeReadingBrowse('${kind}','status','unreviewed');
    check(document.querySelectorAll('#'+listId+' [data-reading-favorite]').length===1,'ordinary four-way combined filter');
    await changeReadingBrowse('${kind}','status','reviewed');check(!document.querySelector('#'+listId+' [data-reading-favorite]'),'ordinary status AND favorite');
    await changeReadingBrowse('${kind}','status','');await changeReadingBrowseTag('${kind}',${data.child.id},false);await changeReadingBrowse('${kind}','favorite',false);await changeReadingBrowse('${kind}','q','');
    await readingController.open();
    readingController.filter('阅读浏览器-${kind}');readingController.select(readingFixtures[1].id,true);
    document.getElementById('materialReviewFavoriteFilter').click();
    check(readingController.filtered().length===1,'picker actual favorite checkbox');
    readingController.filterTag(${data.child.id},true);readingController.filterStatus('unreviewed');
    check(readingController.filtered().length===1,'picker favorite search status tag AND');
    readingController.filterStatus('reviewed');check(readingController.filtered().length===0,'picker favorite AND reviewed');
    readingController.filterStatus('');readingController.filterTag(${data.child.id},false);
    readingController.selectAll(true);readingController.selectAll(false);
    check(readingController.selection.ids.size===1&&readingController.selection.ids.has(readingFixtures[1].id),'favorite select/deselect only matching results preserves hidden');
    const pickerStar=document.querySelector('#materialReviewSelectionList [data-reading-favorite="'+readingFixtures[0].id+'"]');
    pickerStar.click();await waitUntil(()=>!readingFavoritePending.size&&!readingController.filtered().length,'picker cancel favorite updates filtered list');
    check(readingController.selection.ids.size===1,'favorite changes preserve selected IDs');
    const latestFavorite=await(await requestApi(API+'/courses/'+currentCourseId+'/${kind}/'+readingFixtures[0].id+'/review')).json();
    check(latestFavorite.favorite===0&&latestFavorite.review_status==='unreviewed','picker favorite independent of status');
    readingController.filterFavorite(false);
    await toggleReadingFavorite('${kind}',readingFixtures[0].id,true,document.querySelector('#materialReviewSelectionList [data-reading-favorite="'+readingFixtures[0].id+'"]'));
    check(document.querySelector('#'+listId+' [data-reading-favorite="'+readingFixtures[0].id+'"]').getAttribute('aria-pressed')==='true','picker favorite syncs ordinary list');
    readingController.clear();readingController.filter('');readingController.filterFavorite(false);document.getElementById('materialReviewFavoriteFilter').checked=false;
    check(document.getElementById('materialReviewPicker').classList.contains('show')&&activeReadingReview===readingController,'independent reading picker ${kind}');
    check(document.getElementById('materialReviewStart').disabled,'empty selection disabled');
    readingController.filter('正文-${kind}-text'); readingController.selectAll(true);
    check(readingController.selection.ids.size===1,'search body filtered all');
    readingController.filter('正文-${kind}-pdf'); readingController.selectAll(true); readingController.selectAll(true);
    check(readingController.selection.ids.size===2,'preserve hidden selections and dedup');
    readingController.selectAll(false);check(readingController.selection.ids.size===1,'deselect current filter only');
    readingController.filter('阅读浏览器-${kind}'); readingController.filterStatus('reviewed');
    check(readingController.filtered().length===1&&readingController.filtered()[0].id===readingFixtures[1].id,'reviewed filter');
    readingController.filterStatus('unreviewed');check(readingController.filtered().length===2,'mutually exclusive unreviewed filter');
    readingController.filterTag(${data.child.id},true);check(readingController.filtered().length===2,'status search and direct tag AND');
    readingController.filterStatus('');readingController.filterTag(readingTag.id,true);
    check(readingController.filtered().length===3&&new Set(readingController.filtered().map(r=>r.id)).size===3,'multi-tag OR dedup');
    readingController.selectAll(true);check(readingController.selection.ids.size===3,'all full matching results');
    readingController.filterTag(${data.child.id},false);readingController.filterTag(readingTag.id,false);
    readingController.filterTag(${data.child.parent_id || 0},true);check(readingController.filtered().length===0,'parent tag does not expand descendants');
    readingController.filterTag(${data.child.parent_id || 0},false);
    check(readingController.selection.ids.size===3,'filter changes preserve selections');
    readingController.clear();check(readingController.selection.ids.size===0,'clear all selected');
    document.querySelector('#materialReviewSelectionList input').click();check(readingController.selection.ids.size===1,'actual checkbox select');
    readingController.selectAll(true);
    await new Promise(resolve=>setTimeout(resolve,350));
    const readingBody=document.querySelector('.material-review-picker-body');
    check(getComputedStyle(readingBody).overflowY==='auto'&&readingBody.scrollWidth<=readingBody.clientWidth+1,'picker fits and scrolls');
    const readingHead=document.querySelector('.material-review-picker-head'),readingFoot=document.querySelector('.material-review-picker-foot');
    check(readingHead.getBoundingClientRect().top>=0&&readingFoot.getBoundingClientRect().bottom<=innerHeight,'header footer visible');
    const readingSpacer=document.createElement('div');readingSpacer.style.height='1200px';readingBody.appendChild(readingSpacer);
    const headTop=readingHead.getBoundingClientRect().top,footTop=readingFoot.getBoundingClientRect().top;readingBody.scrollTop=readingBody.scrollHeight;
    check(readingBody.scrollTop>0&&readingHead.getBoundingClientRect().top===headTop&&readingFoot.getBoundingClientRect().top===footTop,'fixed header footer while content scrolls');
    readingSpacer.remove();readingBody.scrollTop=0;
    const readingIds=readingController.selection.rows.filter(r=>readingController.selection.ids.has(r.id)).map(r=>r.id);
    await readingController.start();check(JSON.stringify(readingController.queue.ids)===JSON.stringify(readingIds),'fixed ordered independent queue');
    check(!document.querySelector('[data-material-review="unreviewed"]')&&document.getElementById('materialReviewNext').textContent==='跳过此条','new reading actions');
    const readingFetch=window.fetch;let readingLost=true;
    window.fetch=async(url,options)=>{const response=await readingFetch(url,options);if(readingLost&&options?.method==='PATCH'&&String(url).includes('/${kind}/')&&new URL(url).pathname.endsWith('/review')){readingLost=false;throw new TypeError('committed response lost');}return response;};
    document.querySelector('[data-material-review="reviewed"]').click();
    await waitUntil(()=>!readingController.busy&&readingController.queue.pending,'failed save actual button');
    check(readingController.queue.pending&&readingController.queue.index===0&&Object.keys(readingController.queue.results).length===0,'failed save stays without success count');
    await readingController.skip();check(readingController.queue.index===0,'unconfirmed save cannot jump');
    window.fetch=readingFetch;await readingController.pause();
    await ${kind==='materials'?'loadMaterials':'loadNotes'}();
    check(document.getElementById('${kind==='materials'?'materialReviewResume':'noteReviewResume'}').style.display!=='none','pause resume entry');
    await readingController.resume();
    sessionStorage.setItem('reading-review-refresh',JSON.stringify({kind:'${kind}',ids:readingController.queue.ids,firstFavorite:readingController.row.favorite,favoriteId:readingFixtures[0].id,materialSnapshot:localStorage.getItem('material-review-queue:'+currentCourseId)}));
    location.reload();return;
  `;
}
module.exports={testMaterialReviewMigration,testMaterialReviewApi,materialBrowserPrelude,materialBrowserScenario};
