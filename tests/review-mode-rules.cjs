const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const context=vm.createContext({AI_REVIEW_METHODS:Object.fromEntries(['standard','choice_reproduction','cloze','self_explain','reading','contrast','retry'].map(x=>[x,x]))});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../fronted/js/reviewWorkbench.js'),'utf8'),context);
const recommend=context.recommendReviewMode;
test('deterministic no-AI defaults use only confirmed known format and classification',()=>{
  for(const [type,expected]of [['knowledge','standard'],['thinking','standard'],['execution','retry'],['unclassified','standard']])assert.equal(recommend('mistake',{mistake_type:type,question_format:'open',question_format_confirmed:1}).mode,expected);
  assert.equal(recommend('mistake',{mistake_type:'execution',question_format_confirmed:0}).mode,'standard');
  assert.equal(recommend('mistake',{}).mode,'standard');
});
test('choice recommendation requires confirmed structured data and allows manual overrides',()=>{
  const choice={question_format:'choice',question_format_confirmed:1,options_json:'[{"id":"A","text":"甲"},{"id":"B","text":"乙"}]',correct_option:'B'};
  assert.equal(recommend('mistake',choice).mode,'choice_reproduction');
  for(const options_json of ['bad','{}','null','[]'])assert.equal(recommend('mistake',{...choice,options_json}).mode,'standard');
  assert.equal(recommend('mistake',{...choice,question_format_confirmed:0}).mode,'standard');
  assert.equal(recommend('mistake',choice,'contrast').mode,'contrast');
});
test('explicit selection beats confirmed AI, which beats rule; unknown advice is not a mode',()=>{
  for(const explicit of Object.keys(context.AI_REVIEW_METHODS))assert.equal(recommend('mistake',{},explicit,'cloze').mode,explicit);
  assert.equal(recommend('mistake',{},null,'cloze').mode,'cloze');
  for(const advice of ['recall','guided','unclassified',null])assert.equal(recommend('mistake',{},null,advice).mode,'standard');
});
