/*
 * config.js
 * 常量配置：接口地址、页面记忆有效期、手动输入文案、拖拽阈值
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

const API = 'http://localhost:3000/api';
const MANUAL_CONFIG = {
  material: {
    heading: '手动输入资料',
    titlePlaceholder: '资料标题，如「第三章 讲义要点」',
    contentPlaceholder: '资料内容（可多行）'
  },
  note: {
    heading: '手动输入笔记',
    titlePlaceholder: '笔记标题',
    contentPlaceholder: '笔记正文（可多行）'
  },
  mistake: {
    heading: '手动输入错题',
    titlePlaceholder: '错题标题，如「极限计算 3 题」',
    contentPlaceholder: '题目内容（可多行）'
  }
};

const DRAG_THRESHOLD = 4;    // 移动超过这么多像素才算拖动，否则当点击处理
const EXPIRE_TIME = 5 * 60 * 1000; 
