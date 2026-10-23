const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ctx=vm.createContext({escapeHtml:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../fronted/js/itemReviewHistory.js'),'utf8'),ctx);
const render=value=>ctx.historyClozeReferences(value);
const sample={modeId:'cloze',referenceAvailable:true,material:{blanks:[{id:'b1',answer:'北京',aliases:['北京市','北京市']}]}};
test('reference answers appear only for revealed cloze rounds with actual blanks',()=>{
 for(const modeId of ['standard','self_explain','contrast','reading','retry'])assert.equal(render({...sample,modeId}),'');
 assert.equal(render({...sample,referenceAvailable:false}),'');
 assert.equal(render({...sample,material:{blanks:[]}}),'');
 assert.equal(render({...sample,material:null}),'');
 const html=render(sample);assert.match(html,/各空参考答案/);assert.match(html,/第 1 空：北京（也接受：北京市）/);assert.ok(!html.includes('[]'));
 assert.ok(!render({...sample,material:{blanks:[{answer:'<script>x</script>'}]}}).includes('<script>'));
});
