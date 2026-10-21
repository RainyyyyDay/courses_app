const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../fronted/js/reviewWorkbench.js'),'utf8'),context);
const missing=(mode,material)=>Array.from(context.workbenchMaterialMissing(mode,material));
test('material checklist distinguishes mode-specific missing fields; rubric and aliases remain optional',()=>{
  assert.deepEqual(missing('reading',{prompt:'正文'}),[]);
  assert.deepEqual(missing('self_explain',{prompt:'解释任务'}),['参考答案或核对要点']);
  assert.deepEqual(missing('standard',{prompt:'题目',reference:'答案'}),[]);
  assert.deepEqual(missing('contrast',{prompt:'比较',reference:'要点'}),['至少两个比较对象','至少一个比较维度']);
  assert.deepEqual(missing('contrast',{prompt:'比较',reference:'要点',objects:['甲','乙'],dimensions:['定义']}),[]);
});
test('cloze readiness requires matching placeholders and answers, without rejecting mathematical symbols',()=>{
  const material={prompt:'运算符【b1】',blanks:[{id:'b1',answer:'+',aliases:[]}]};
  assert.deepEqual(missing('cloze',material),[]);
  assert.ok(missing('cloze',{...material,blanks:[]}).some(v=>v.includes('答案设置')));
  assert.ok(missing('cloze',{...material,prompt:'没有空位'}).some(v=>v.includes('恰好')));
  assert.ok(missing('cloze',{...material,blanks:[{id:'b1',answer:'。'}]}).some(v=>v.includes('有效答案')));
});
