// 使用已有隔离 HTTP API 和真实 Chrome 页面，不写入真实数据库。
function courseSearchBrowserScenario(data) {
  return `
    {
      const fixture = ${JSON.stringify(data.searchFixture)};
      openCourse(fixture.courseId,'隔离搜索课程'); await loadMaterials();
      check(document.getElementById('courseSearchOpen').textContent === '搜索本课程', 'course header search entry');
      document.getElementById('courseSearchOpen').click();
      check(currentView.type === 'courseSearch' && document.getElementById('detailPage').style.display === 'none', 'entry opens dedicated search page');
      const input = document.getElementById('courseSearchQuery'), results = document.getElementById('courseSearchResults');
      const typeBox = type => document.querySelector('.course-search-types input[value="' + type + '"]');
      const setQuery = value => {input.value = value; input.dispatchEvent(new Event('input'));};
      const settle = () => waitUntil(() => courseSearchState.loaded && !courseSearchState.loading && !courseSearchState.timer, 'search finishes');
      const originalFetch = window.fetch;
      const searches = [];
      window.fetch = async (url,options) => {
        if (String(url).includes('/search?')) searches.push(new URL(url));
        return originalFetch(url,options);
      };
      check([...document.querySelectorAll('.course-search-types input')].every(box => box.checked), 'default all types');
      check(results.textContent.includes('输入关键词') && searches.length === 0, 'empty keyword does not load whole course');
      setQuery('矩'); setQuery('矩阵'); setQuery('矩阵 ');
      await settle();
      check(searches.length === 1 && searches[0].searchParams.get('q') === '矩阵', '300ms debounce sends final trimmed query once');
      check(searches[0].pathname === '/api/courses/' + fixture.courseId + '/search', 'scoped search endpoint');
      check(courseSearchState.total === 4 && courseSearchState.rows.every(row => row.courseId === fixture.courseId), 'real API all three types without other course');
      check(new Set(courseSearchState.rows.map(row => row.type)).size === 3 && results.querySelectorAll('button').length === 4, 'all three resource sections render');
      check(document.getElementById('courseSearchCount').textContent.includes('共 4 条'), 'result count visible');
      check(!results.querySelector('img,iframe'), 'search results never preload attachments');
      for (const [type,id] of [['material',fixture.m],['note',fixture.n],['mistake',fixture.w]]) {
        const beforeQueries = searches.length, beforeTypes = [...courseSearchState.types].join(',');
        results.querySelector('[data-search-key="' + type + ':' + id + '"]').click();
        await waitUntil(() => type === 'mistake' ? mistakeDetailState?.row?.id === id : document.getElementById('resourceDetailName').textContent !== '加载中…', 'search detail loads ' + type);
        check(currentView.id === id && (type === 'mistake' ? currentView.type === 'mistake' && !currentView.review : currentView.resourceType === type), 'correct existing detail function ' + type);
        const title = type === 'mistake' ? document.getElementById('mistakeDetailName') : document.getElementById('resourceDetailName');
        check(title.textContent.includes('矩阵'), 'correct detail content ' + type);
        await backFromDetail();
        check(currentView.type === 'courseSearch' && input.value === '矩阵 ' && [...courseSearchState.types].join(',') === beforeTypes, 'detail return restores keyword and types');
        check(searches.length === beforeQueries && results.querySelectorAll('button').length === 4, 'return reuses search results instead of loading attachments or searching again');
      }
      const beforeComposition = searches.length;
      input.value = '矩'; input.dispatchEvent(new InputEvent('input',{isComposing:true}));
      await new Promise(resolve => setTimeout(resolve,350));
      check(searches.length === beforeComposition && !courseSearchState.timer, 'Chinese composition waits for completion');
      input.value = '矩阵'; input.dispatchEvent(new Event('compositionend')); await settle();
      check(courseSearchState.total === 4 && searches.length === beforeComposition + 1, 'Chinese composition end searches once');
      window.fetch = async (url,options) => String(url).endsWith('/materials/' + fixture.m)
        ? new Response(JSON.stringify({id:fixture.m,course_id:fixture.otherCourseId,title:'异课详情不展示'}),{headers:{'Content-Type':'application/json'}})
        : originalFetch(url,options);
      await openCourseSearchResult(courseSearchState.rows.find(row => row.type === 'material' && row.id === fixture.m));
      check(currentView.type === 'courseSearch' && results.querySelectorAll('button').length === 4, 'wrong-course detail safely returns to search');
      window.fetch = originalFetch;
      typeBox('materials').click(); typeBox('mistakes').click(); await settle();
      check(courseSearchState.total === 1 && courseSearchState.rows[0].type === 'note' && searches.at(-1).searchParams.get('types') === 'notes', 'single type combined with keyword');
      typeBox('materials').click(); await settle();
      check(courseSearchState.total === 3 && courseSearchState.rows.every(row => row.type !== 'mistake'), 'multiple selected types');
      typeBox('materials').click(); typeBox('notes').click();
      const beforeNoTypes = searches.length;
      await new Promise(resolve => setTimeout(resolve,350));
      check(results.textContent.includes('请至少选择') && searches.length === beforeNoTypes, 'zero types gives prompt without invalid API request');
      for (const box of document.querySelectorAll('.course-search-types input')) if (!box.checked) box.click();
      setQuery('不存在的搜索词'); await settle(); check(results.textContent.includes('没有找到'), 'no match prompt');
      setQuery('   ');
      check(results.textContent.includes('输入关键词') && !courseSearchState.rows.length && !courseSearchState.timer, 'whitespace clears results without request');
      setQuery('数量测试'); await settle();
      check(courseSearchState.total === 105 && courseSearchState.rows.length === 20 && !document.getElementById('courseSearchMore').hidden, '20 result page and count');
      let failMore = true;
      window.fetch = async (url,options) => {
        if (failMore && String(url).includes('/search?') && new URL(url).searchParams.get('offset') === '20') {
          return new Response(JSON.stringify({message:'隔离分页失败'}),{status:503,headers:{'Content-Type':'application/json'}});
        }
        return originalFetch(url,options);
      };
      document.getElementById('courseSearchMore').click();
      await waitUntil(() => courseSearchState.error && !courseSearchState.loading, 'failed next page');
      check(courseSearchState.rows.length === 20 && courseSearchState.offset === 20 && !document.getElementById('courseSearchRetry').hidden, 'failed next page retains previous results');
      failMore = false; document.getElementById('courseSearchRetry').click(); await settle();
      check(courseSearchState.rows.length === 40 && courseSearchState.offset === 40, 'pagination retry uses same offset');
      window.fetch = originalFetch;
      while (courseSearchState.offset < courseSearchState.total) {document.getElementById('courseSearchMore').click(); await settle();}
      check(courseSearchState.rows.length === 105 && new Set(courseSearchState.rows.map(row => row.type + ':' + row.id)).size === 105
        && document.getElementById('courseSearchMore').hidden, 'load more to final page without duplicates');
      window.scrollTo(0,500); const scroll = window.scrollY;
      check(scroll > 0, 'search scroll fixture');
      const query = input.value;
      results.querySelector('button').click();
      await waitUntil(() => document.getElementById('resourceDetailName').textContent !== '加载中…', 'paged result detail');
      await backFromDetail();
      check(window.scrollY === scroll && input.value === query && courseSearchState.rows.length === 105, 'return preserves loaded pages and scroll');
      const content = document.querySelector('.course-search-content');
      check(content.scrollWidth <= content.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1, 'search page fits viewport');
      check(document.querySelector('#courseSearchPage .header').getBoundingClientRect().top >= 0, 'back button remains reachable when scrolled');
      window.scrollTo(0,0);
      let failQuery = true;
      window.fetch = async (url,options) => {
        if (String(url).includes('/search?') && failQuery) return new Response(JSON.stringify({message:'隔离搜索失败'}),{status:503,headers:{'Content-Type':'application/json'}});
        return originalFetch(url,options);
      };
      setQuery('矩阵'); await waitUntil(() => courseSearchState.error && !courseSearchState.loading, 'initial query failure');
      check(document.getElementById('courseSearchError').textContent.includes('隔离搜索失败') && input.value === '矩阵', 'error prompt keeps input');
      failQuery = false; document.getElementById('courseSearchRetry').click(); await settle();
      check(courseSearchState.total === 4, 'initial query retry');
      // 即使服务端忽略取消信号，旧结果/旧错误仍不能覆盖新搜索。
      let releaseOld, held = false;
      window.fetch = async (url,options) => {
        if (String(url).includes('/search?') && new URL(url).searchParams.get('q') === '过期查询') {
          held = true; return new Promise(resolve => {releaseOld = resolve;});
        }
        return originalFetch(url,options);
      };
      setQuery('过期查询'); await waitUntil(() => held, 'hold old search');
      setQuery('矩阵'); await settle();
      releaseOld(new Response(JSON.stringify({query:'过期查询',total:1,results:[{type:'material',id:1,courseId:fixture.courseId,title:'过期结果不可显示',snippet:''}]}),{headers:{'Content-Type':'application/json'}}));
      await new Promise(resolve => setTimeout(resolve,50));
      check(courseSearchState.total === 4 && !results.textContent.includes('过期结果'), 'stale response ignored');
      window.fetch = async url => String(url).includes('/search?') ? new Response(JSON.stringify({query:'异课响应',total:1,
        results:[{type:'material',id:1,courseId:fixture.otherCourseId,title:'异课内容不能展示',snippet:''}]}),{headers:{'Content-Type':'application/json'}}) : originalFetch(url);
      setQuery('异课响应'); await waitUntil(() => courseSearchState.error && !courseSearchState.loading, 'reject wrong course response');
      check(!results.textContent.includes('异课内容') && document.getElementById('courseSearchError').textContent.includes('课程归属'), 'wrong course data rejected');
      window.fetch = originalFetch;
      const form = new FormData(); form.set('title','安全文本 <img src=x onerror="window.searchXss=1">');
      form.set('content','安全文本 <svg onload="window.searchXss=1"></svg> ' + '长字符串'.repeat(90));
      const xssRow = await (await requestApi(API + '/courses/' + fixture.courseId + '/materials',{method:'POST',body:form})).json();
      setQuery('安全文本'); await settle();
      check(results.textContent.includes('<img') && results.textContent.includes('<svg') && !results.querySelector('img,svg,iframe') && !window.searchXss, 'title and snippet rendered as safe plain text');
      check(content.scrollWidth <= content.clientWidth + 1, 'long text wraps on narrow viewport');
      await requestApi(API + '/materials/' + xssRow.id,{method:'DELETE'});
      let releaseCourse, courseHeld = false;
      window.fetch = async (url,options) => {
        if (String(url).includes('/search?') && new URL(url).pathname.includes('/' + fixture.courseId + '/')) {
          courseHeld = true; return new Promise(resolve => {releaseCourse = resolve;});
        }
        return originalFetch(url,options);
      };
      setQuery('跨课程旧请求'); await waitUntil(() => courseHeld, 'hold old course search');
      openCourse(fixture.otherCourseId,'其他搜索课程'); document.getElementById('courseSearchOpen').click();
      check(input.value === '' && [...document.querySelectorAll('.course-search-types input')].every(box => box.checked), 'new course resets search state');
      setQuery('矩阵'); await settle();
      check(courseSearchState.total === 3 && courseSearchState.rows.every(row => row.courseId === fixture.otherCourseId), 'new course real API only its contents');
      releaseCourse(new Response(JSON.stringify({query:'跨课程旧请求',total:1,results:[{type:'material',id:fixture.m,courseId:fixture.courseId,title:'上门课程旧内容',snippet:''}]}),{headers:{'Content-Type':'application/json'}}));
      await new Promise(resolve => setTimeout(resolve,50));
      check(!results.textContent.includes('上门课程') && courseSearchState.total === 3, 'old course response cannot overwrite current course');
      window.fetch = originalFetch;
      await backFromDetail(); check(currentView.type === 'course' && document.getElementById('detailPage').style.display === 'block', 'search closes to origin course');
      openCourse(${data.course.id},'browser course'); await loadMaterials();
      check(!courseSearchState && document.getElementById('courseSearchPage').style.display === 'none', 'normal course/list state restored');
    }
  `;
}
module.exports = { courseSearchBrowserScenario };
