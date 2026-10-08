/*
 * db/connection.js
 * 打开数据库连接 + 两个小工具（时间文本、按创建时间倒序）
 *
 * 由原来的单文件 db.js 按业务拆分而来，只搬了位置，逻辑没有改动。
 */

// ============================================================
//  db.js —— 数据库模块
//
//  作用：把原来只存在于服务器内存里的数据，改成存进 SQLite 文件，
//        这样后端重启之后数据不会丢：
//    - 课程     courses
//    - 资料     materials
//    - 笔记     notes
//    - 考核     assessments
//    - 错题     mistakes
//    - 知识树   knowledge_nodes     （Phase 1 新增）
//    - 错题标签 mistake_node_links  （Phase 1 新增，Phase 4A 泛化为“任意节点”）
//
//  用的是 Node 自带的 node:sqlite 模块（Node 22.5 以上内置），
//  不需要 npm 安装任何东西，也不需要另外启动数据库服务。
//  数据库文件位置：back/data/app.db
//
//  ===== 数据库版本与“原地升级” =====
//  用 SQLite 自带的 PRAGMA user_version 记录结构版本，服务器每次启动时自动升级：
//    version 1 = Phase 0 的结构（课程 + 四类子数据）
//    version 2 = Phase 1 的结构（额外增加知识树和错题标签两张表）
//    version 3 = 关联表泛化为“任意知识树节点”
//    version 4 = 资料 / 笔记 也接入节点标签
//    version 5 = 四类资源支持“手动输入 / 上传文件”，知识树增加系统分类“未分类”
//  升级只做“新增表 / 新增索引”，不会删除、清空或重建任何已有数据：
//    - 全新的空数据库：先建基础结构，再逐级升到最新版本
//    - 已有的旧数据库：只补上缺的表 / 列，旧数据原样保留
//    - 已经是最新版本：什么都不做
// ============================================================

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// 数据库统一放在 back/data/app.db
//
// ★ 注意这里是 '..'：本文件在 back/db/ 子目录里，__dirname 指的是 back/db，
//   所以要回上一层才是 back，数据目录是 back/data。
//   写错这一句的后果很严重：后端会跑去 back/db/data 建一个全新的空数据库，
//   表面上"能跑"，但用户原来的课程数据全都不见了。
const DATA_DIR = path.join(__dirname, '..', 'data');

// 如果 data 文件夹还不存在就自动创建（recursive 表示可以一层层创建）
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'app.db');

// 打开数据库文件：文件不存在时会自动新建一个空的
const db = new DatabaseSync(DB_FILE);

// ===== 开启外键约束 =====
// 打开这个开关之后，建表时写的 ON DELETE CASCADE 才会真正生效：
// 删掉一门课，属于它的资料 / 笔记 / 考核 / 错题会被数据库一起清理掉
db.exec('PRAGMA foreign_keys = ON');
// ========== 小工具 ==========

// 生成“给人看的时间”，和原来 server.js 里的写法完全一样：
// 例如 2026/10/7 14:30:00
function nowText() {
  return new Date().toLocaleString('zh-CN');
}

// 按创建时间倒序排（新的排在前面），和原来资料 / 笔记列表的排序保持一致。
// 传进来的数组会就地排序后返回；时间相同时保持原来的先后顺序（插入顺序）。
function sortByCreatedAtDesc(rows) {
  return rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}


module.exports = {
  db,
  nowText,
  sortByCreatedAtDesc
};
