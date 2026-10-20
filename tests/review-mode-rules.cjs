const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context=vm.createContext({AI_REVIEW_METHODS:Object.fromEntries(['choice_reproduction','standard','cloze','self_explain','reading','contrast','retry'].map(id=>[id,id]))});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../fronted/js/reviewWorkbench.js'),'utf8'),context);
const recommend=(row,explicit,ai)=>context.recommendReviewMode('mistake',row,explicit,ai);
const row=type=>({mistake_type:type,question_format:'open',question_format_confirmed:1});
test('rules choose usable native engines without AI; all categories have an escape path',()=>{
  for(const type of ['knowledge','thinking','unclassified'])assert.equal(recommend(row(type)).mode,'standard');
  assert.equal(recommend(row('execution')).mode,'retry');
  assert.ok(recommend(row('knowledge')).alternatives.includes('cloze'));
  for(const mode of ['standard','self_explain','contrast','retry'])assert.ok(recommend(row('thinking')).alternatives.includes(mode));
  assert.ok(recommend(row('execution')).alternatives.includes('standard'));
  for(const type of ['knowledge','thinking','execution','unclassified']){
    assert.equal(recommend({...row(type),question_format_confirmed:0}).mode,'standard');
    assert.equal(recommend({...row(type),question_format:'choice',options_json:'bad JSON'}).mode,type==='execution'?'retry':'standard');
    assert.equal(recommend({...row(type),question_format:'choice',options_json:'[{"id":"A","text":"a"},{"id":"B","text":"b"}]',choice_ready:1}).mode,'choice_reproduction');
  }
});
test('current explicit choice wins over confirmed AI, which wins over rules; invalid legacy suggestions are ignored',()=>{
  for(const mode of Object.keys(context.AI_REVIEW_METHODS)){
    assert.equal(recommend(row('execution'),mode,'cloze').mode,mode);
    assert.equal(recommend(row('knowledge'),null,mode).mode,mode);
  }
  assert.equal(recommend(row('knowledge'),null,'guided').mode,'standard');
  assert.equal(recommend(row('knowledge'),null,'unclassified').source,'rule');
  for(const options_json of ['null','{}','[]'])assert.equal(recommend({...row('knowledge'),question_format:'choice',options_json,choice_ready:1}).mode,'standard');
  // Even an incompatible explicit choice is kept for explanation/fallback, never replaced silently.
  assert.equal(recommend(row('knowledge'),'choice_reproduction','reading').mode,'choice_reproduction');
});
