const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildMindmapOutline}=require('../back/ai/outline');

test('basic mind-map splitting preserves explicit hierarchy and removes numbering noise',()=>{
  const outline=buildMindmapOutline('第一章 函数\n一、极限\n1. 定义\n2. 运算\n二、连续');
  assert.equal(outline,[
    '- 第一章 函数',
    '  - 极限',
    '    - 定义',
    '    - 运算',
    '  - 连续',
  ].join('\n'));
});

test('basic mind-map splitting handles run-on and Markdown outlines deterministically',()=>{
  assert.equal(buildMindmapOutline('函数：极限、连续、导数；重点是比较适用条件。'),[
    '- 函数',
    '  - 极限',
    '  - 连续',
    '  - 导数',
    '  - 重点是比较适用条件',
  ].join('\n'));
  assert.equal(buildMindmapOutline('# 学习目标\n- 理解概念\n  - 掌握定义\n- 完成练习'),[
    '- 学习目标',
    '  - 理解概念',
    '    - 掌握定义',
    '  - 完成练习',
  ].join('\n'));
});

test('basic mind-map splitting is bounded and keeps repeated labels in different branches',()=>{
  const lines=Array.from({length:80},(_,index)=>`${index+1}. 第 ${index+1} 项`);
  const outline=buildMindmapOutline(lines.join('\n'));
  assert.equal(outline.split('\n').length,60);
  assert.match(outline,/^- 第 1 项/);
  assert.match(outline,/第 60 项/);
  assert.doesNotMatch(outline,/第 61 项/);

  const repeated=buildMindmapOutline('第一章 总览\n一、重点\n1. 例子\n二、难点\n1. 例子');
  assert.equal((repeated.match(/例子/g)||[]).length,2);
});
