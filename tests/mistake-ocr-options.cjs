const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function parser() {
  const context=vm.createContext({});
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../fronted/js/mistakes.js'),'utf8'),context,{filename:'mistakes.js'});
  return text=>Array.from(vm.runInContext('parseMistakeOcrChoiceOptions',context)(text));
}

test('OCR option parser accepts horizontal and vertical A/B/C rows',()=>{
  const parse=parser();
  assert.deepEqual(parse('1. How do you\nfor coming late?\nA) explain B) excuse C) describe D) account'),
    ['explain','excuse','describe','account']);
  assert.deepEqual(parse('A. one\nB. two\nC. three'),['one','two','three']);
  assert.deepEqual(parse('(A) alpha (B) beta (C) gamma'),['alpha','beta','gamma']);
  assert.deepEqual(parse('Question mentions D) later\nA、选项一 B、选项二'),['选项一','选项二']);
  assert.deepEqual(parse('No option markers here'),[]);
});
