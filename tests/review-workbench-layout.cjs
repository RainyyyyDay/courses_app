const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('submitted answers use 我的作答 and checkpoints share the result-card layout',()=>{
  const context=vm.createContext({
    escapeHtml:value=>String(value).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])),
    mistakeStorageGet:()=>[],
    reviewWorkbenchKey:()=> 'layout-test',
  });
  const source=fs.readFileSync(path.resolve(__dirname,'../fronted/js/reviewWorkbench.js'),'utf8');
  vm.runInContext(source,context,{filename:'reviewWorkbench.js'});
  vm.runInContext('reviewWorkbench={courseId:1,type:"note",id:1,sessionItemId:1,mode:"self_explain"}',context);
  assert.doesNotMatch(source,/不可改写的首次作答/);
  const answer=context.workbenchResultField('我的作答','首次讲解');
  assert.match(answer,/class="review-result-field"/);
  assert.match(answer,/class="detail-content"/);
  const checkpoints=context.workbenchCheckpoints({
    id:1,
    material:{reference:'要点一',rubric:'要点二'},
  });
  assert.match(checkpoints,/review-result-field review-checkpoint-field/);
  assert.match(checkpoints,/逐项核对 <small>（不自动判分）<\/small>/);
  assert.match(checkpoints,/class="review-checkpoint-card"/);
  assert.equal((checkpoints.match(/class="review-check"/g)||[]).length,2);
});
