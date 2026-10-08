/*
 * db/index.js
 * 数据库模块的统一入口：server.js 明确加载 require('./db/index.js')。
 *
 * 原来的 db.js 是一个 1100 多行的大文件，现在按业务拆到同目录下的子模块：
 *   connection.js  打开数据库连接、通用小工具
 *   schema.js      建表 + 版本迁移（require 时自动执行）
 *   courses.js     课程
 *   knowledge.js   知识树节点（资料 / 笔记 / 错题都要用到它）
 *   materials.js   资料
 *   notes.js       笔记
 *   assessments.js 考核
 *   mistakes.js    错题
 *
 * 这里只做两件事：按正确顺序加载子模块，再把它们的导出汇总成一份对外接口。
 * 所以 server.js 完全不用改，用法和以前一模一样：db.listCourses(...)。
 */

const connection = require('./connection');

// 一定要先加载 schema：require 它的同时就会跑一次 migrate()，把表建好 / 升级到最新版本
require('./schema');

module.exports = {
  // 连接本身（少数地方要直接用）
  db: connection.db,

  ...require('./courses'),
  ...require('./knowledge'),
  ...require('./materials'),
  ...require('./notes'),
  ...require('./assessments'),
  ...require('./mistakes'),
};
