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
//  升级只做“新增表 / 新增索引”，不会删除、清空或重建任何已有数据：
//    - 全新的空数据库：直接建出最新完整结构（version 2）
//    - 已有的 version 1 数据库：只补上本阶段需要的表，旧数据原样保留
//    - 已经是 version 2：什么都不做
// ============================================================

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// __dirname 表示“当前这个 db.js 文件所在的文件夹”，也就是 back
// 数据库统一放在 back/data/app.db
const DATA_DIR = path.join(__dirname, 'data');

// 如果 data 文件夹还不存在就自动创建（recursive 表示可以一层层创建）
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'app.db');

// 打开数据库文件：文件不存在时会自动新建一个空的
const db = new DatabaseSync(DB_FILE);

// ===== 开启外键约束 =====
// 打开这个开关之后，建表时写的 ON DELETE CASCADE 才会真正生效：
// 删掉一门课，属于它的资料 / 笔记 / 考核 / 错题会被数据库一起清理掉
db.exec('PRAGMA foreign_keys = ON');

// ===== 当前程序支持的数据库版本 =====
const CURRENT_DB_VERSION = 4;

// 判断某张表是否已经存在
function tableExists(name) {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
}

// 读取数据库版本号（user_version 是 SQLite 自带的、写在文件头里的一个小整数）
function getUserVersion() {
  return db.prepare('PRAGMA user_version').get().user_version;
}

// 写入数据库版本号
function setUserVersion(version) {
  // PRAGMA 不支持参数占位符，只能把数字直接拼进 SQL。
  // 这里的 version 是代码里的常量算出来的整数，不是用户输入，安全。
  db.exec(`PRAGMA user_version = ${Number(version)}`);
}

// ===== 自动迁移：把数据库结构升级到最新版本 =====
// 每一段迁移只做“新增表 / 新增索引”，不会删除、清空或重建任何已有数据
function migrate() {
  let version = getUserVersion();

  if (version > CURRENT_DB_VERSION) {
    throw new Error(
      `数据库版本（${version}）比当前程序支持的版本（${CURRENT_DB_VERSION}）更高，` +
        '请先更新程序再启动，避免损坏数据。'
    );
  }

  // ---- 0 → 1：Phase 0 的基础结构 ----
  if (version === 0) {
    if (tableExists('courses')) {
      // 这是用 Phase 0 的代码建出来的数据库，只是当初没有写版本号。
      // 只把版本登记成 1，一行数据都不动。
      setUserVersion(1);
      version = 1;
    } else {
      // 全新的空数据库：建出 Phase 0 的完整结构，并写入初始课程。
      // 初始课程只在这一次写入，以后启动（哪怕课程被删光）都不会重复插入。
      createBaseSchema();
      seedCourses();
      setUserVersion(1);
      version = 1;
    }
  }

  // ---- 1 → 2：Phase 1 新增知识树 + 错题标签关联 ----
  if (version === 1) {
    createKnowledgeSchema();
    setUserVersion(2);
    version = 2;
  }

  // ---- 2 → 3：Phase 4A 把关联表泛化为“任意知识树节点” ----
  if (version === 2) {
    upgradeLinkTableToV3();
    setUserVersion(3);
    version = 3;
  }

  // ---- 3 → 4：Phase 4E 资料 / 笔记 也接入统一的节点标签 ----
  if (version === 3) {
    createResourceLinkTables();
    setUserVersion(4);
    version = 4;
  }
}

migrate();

// ===== 建表：Phase 0 的基础结构（version 1）=====
// 每一张“子表”都用 course_id 指向 courses(id)，
// 并带上 ON DELETE CASCADE：课程被删掉时，它下面的数据自动跟着删掉
function createBaseSchema() {
  db.exec(`
    -- 课程
    CREATE TABLE IF NOT EXISTS courses (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      pinned     INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL
    );

    -- 资料（挂在课程下面，一个课程可以有很多条）
    CREATE TABLE IF NOT EXISTS materials (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title      TEXT    NOT NULL,
      file_url   TEXT    NOT NULL,
      file_type  TEXT    NOT NULL DEFAULT '',
      created_at TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_materials_course ON materials(course_id);

    -- 笔记（比资料多一个 source 字段：笔记来源）
    CREATE TABLE IF NOT EXISTS notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title      TEXT    NOT NULL,
      file_url   TEXT    NOT NULL,
      file_type  TEXT    NOT NULL DEFAULT '',
      source     TEXT    NOT NULL DEFAULT '手动上传',
      created_at TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notes_course ON notes(course_id);

    -- 考核（纯文字，没有上传文件）
    CREATE TABLE IF NOT EXISTS assessments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title       TEXT    NOT NULL,
      deadline    TEXT    NOT NULL DEFAULT '',
      requirement TEXT    NOT NULL DEFAULT '',
      archived    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assessments_course ON assessments(course_id);

    -- 错题（目前主要是上传的图片）
    CREATE TABLE IF NOT EXISTS mistakes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title      TEXT    NOT NULL,
      image_url  TEXT    NOT NULL,
      ocr_text   TEXT    NOT NULL DEFAULT '',
      created_at TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mistakes_course ON mistakes(course_id);
  `);
}

// ===== 写入初始课程（只在第一次建库时执行一次）=====
// 这两条数据就是原来写死在 server.js 里的 courses 数组，字段完全一样
function seedCourses() {
  const insert = db.prepare(
    'INSERT INTO courses (id, name, pinned, created_at) VALUES (?, ?, ?, ?)'
  );
  insert.run(1, '前端开发入门', 0, '2026-09-01 08:00:00');
  insert.run(2, 'Node.js 后端基础', 0, '2026-09-02 08:00:00');
}

// ===== 建表：知识树结构 =====
// 知识树用 parent_id 指向自己这张表，实现“无限层级”：
//   - parent_id 为 NULL  → 顶层节点
//   - type = 'folder'    → 分类节点，可以继续往下建子节点，也可以作为错题标签
//   - type = 'knowledge' → 知识点节点，不能再有子节点，也可以作为错题标签
function createKnowledgeSchema() {
  db.exec(`
    -- 知识树节点
    CREATE TABLE IF NOT EXISTS knowledge_nodes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id  INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      parent_id  INTEGER REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      type       TEXT    NOT NULL CHECK (type IN ('folder', 'knowledge')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_course        ON knowledge_nodes(course_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_parent        ON knowledge_nodes(parent_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_course_parent ON knowledge_nodes(course_id, parent_id);
  `);

  // 错题 ↔ 知识树节点 的关联表（v3 起 folder / knowledge 都能当标签）
  createLinkTable();
}

// ===== 错题 ↔ 知识树节点 多对多关联表（当前 v3 的形状）=====
// 一道错题可以有多个标签节点，一个节点也可以被多道错题使用；
// 复合主键保证同一道错题不会重复绑定同一个节点。
// 两端都是 ON DELETE CASCADE：删错题或删节点时关联自动清理。
function createLinkTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mistake_node_links (
      mistake_id INTEGER NOT NULL REFERENCES mistakes(id) ON DELETE CASCADE,
      node_id    INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
      PRIMARY KEY (mistake_id, node_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mk_node ON mistake_node_links(node_id);
  `);
}

// ===== 资料 ↔ 知识树节点、笔记 ↔ 知识树节点 的关联表（Phase 4E，version 4）=====
// 故意不用“多态表”（resource_type + resource_id），
// 而是每类资源一张关联表，这样两端都能用真正的外键 + ON DELETE CASCADE：
//   - 删资料 / 删笔记 → 关联自动删
//   - 删节点          → 关联自动删（资料 / 笔记本身保留）
//   - 删课程          → 顺着现有级联最终都清掉
function createResourceLinkTables() {
  db.exec(`
    -- 资料 ↔ 知识树节点
    CREATE TABLE IF NOT EXISTS material_node_links (
      material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
      node_id     INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
      PRIMARY KEY (material_id, node_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mnl_node ON material_node_links(node_id);

    -- 笔记 ↔ 知识树节点
    CREATE TABLE IF NOT EXISTS note_node_links (
      note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      node_id INTEGER NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
      PRIMARY KEY (note_id, node_id)
    );
    CREATE INDEX IF NOT EXISTS idx_nnl_node ON note_node_links(node_id);
  `);
}

// ===== v2 → v3 的迁移：把关联表泛化 =====
// 旧结构 mistake_knowledge(mistake_id, knowledge_id) 的语义是“只有知识点能当标签”，
// 新结构 mistake_node_links(mistake_id, node_id) 表示“任意知识树节点都能当标签”。
//
// 只做两件 SQLite 元数据操作，行数据零拷贝、不会丢失：
//   1) ALTER TABLE  mistake_knowledge  RENAME TO      mistake_node_links
//   2) ALTER TABLE  ... RENAME COLUMN  knowledge_id TO node_id
// 索引本身不存业务数据，删掉再按新名字建一个即可（顺便让索引名也有语义）。
function upgradeLinkTableToV3() {
  // 全新数据库在 createKnowledgeSchema() 里已经直接建成 v3 的形状，这里什么都不用做
  if (tableExists('mistake_node_links')) return;

  // 理论上不会出现“两张表都不在”：真遇到就按新结构建一张空的
  if (!tableExists('mistake_knowledge')) {
    createLinkTable();
    return;
  }

  db.exec('BEGIN');
  try {
    db.exec('ALTER TABLE mistake_knowledge RENAME TO mistake_node_links');
    db.exec('ALTER TABLE mistake_node_links RENAME COLUMN knowledge_id TO node_id');
    db.exec('DROP INDEX IF EXISTS idx_mk_knowledge');
    db.exec('CREATE INDEX IF NOT EXISTS idx_mk_node ON mistake_node_links(node_id)');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

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

// ==================== 课程 ====================

const COURSE_COLUMNS = 'id, name, pinned, created_at';

// 课程列表：置顶的排前面，然后按创建时间倒序（和原来的排序规则一致）
function listCourses() {
  const rows = db.prepare(`SELECT ${COURSE_COLUMNS} FROM courses`).all();
  return rows.sort((a, b) => {
    if (b.pinned !== a.pinned) return b.pinned - a.pinned;
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

// 按 id 找一门课，找不到返回 undefined（和原来 courses.find 的行为一致）
function findCourse(id) {
  return db.prepare(`SELECT ${COURSE_COLUMNS} FROM courses WHERE id = ?`).get(id);
}

// 新增课程：pinned 默认 0，created_at 自动取当前时间，返回新建好的那条
function createCourse(name) {
  const info = db
    .prepare('INSERT INTO courses (name, pinned, created_at) VALUES (?, 0, ?)')
    .run(name, nowText());
  return findCourse(Number(info.lastInsertRowid));
}

// 修改课程名
function updateCourseName(id, name) {
  db.prepare('UPDATE courses SET name = ? WHERE id = ?').run(name, id);
  return findCourse(id);
}

// 置顶 / 取消置顶：pinned 存 1 或 0（和原来一样是数字，不是 true/false）
function setCoursePinned(id, pinned) {
  db.prepare('UPDATE courses SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
  return findCourse(id);
}

// 删除课程：属于它的资料 / 笔记 / 考核 / 错题由外键级联一起删除
function deleteCourse(id) {
  db.prepare('DELETE FROM courses WHERE id = ?').run(id);
}

// ==================== 资料 ====================

const MATERIAL_COLUMNS = 'id, course_id, title, file_url, file_type, created_at';

// 资料列表：字段和原来一样，额外给每条补一个 nodes 数组（标签节点）
function listMaterials(courseId) {
  const rows = db
    .prepare(`SELECT ${MATERIAL_COLUMNS} FROM materials WHERE course_id = ? ORDER BY id`)
    .all(courseId);
  return attachMaterialNodes(sortByCreatedAtDesc(rows), courseId);
}

function findMaterial(id) {
  return db.prepare(`SELECT ${MATERIAL_COLUMNS} FROM materials WHERE id = ?`).get(id);
}

// 新建资料；nodeIds 可选，不传就是原来那条“没有标签”的资料
function createMaterial(courseId, title, fileUrl, fileType, nodeIds) {
  db.exec('BEGIN');
  try {
    const info = db
      .prepare(
        'INSERT INTO materials (course_id, title, file_url, file_type, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(courseId, title, fileUrl, fileType, nowText());
    const id = Number(info.lastInsertRowid);

    const insert = db.prepare(
      'INSERT OR IGNORE INTO material_node_links (material_id, node_id) VALUES (?, ?)'
    );
    for (const nodeId of nodeIds || []) insert.run(id, nodeId);

    db.exec('COMMIT');
    return findMaterial(id);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function deleteMaterial(id) {
  db.prepare('DELETE FROM materials WHERE id = ?').run(id);
}

// 给一批资料补上 nodes 数组（一次查完整门课，避免一条一条查）
function attachMaterialNodes(rows, courseId) {
  if (rows.length === 0) return rows;

  const links = db
    .prepare(
      `SELECT mnl.material_id, k.id, k.name, k.type
         FROM material_node_links mnl
         JOIN materials m       ON m.id = mnl.material_id
         JOIN knowledge_nodes k ON k.id = mnl.node_id
        WHERE m.course_id = ?
        ORDER BY mnl.material_id, k.id`
    )
    .all(courseId);

  const byMaterial = new Map();
  for (const link of links) {
    if (!byMaterial.has(link.material_id)) byMaterial.set(link.material_id, []);
    byMaterial.get(link.material_id).push({ id: link.id, name: link.name, type: link.type });
  }

  return rows.map(row => ({ ...row, nodes: byMaterial.get(row.id) || [] }));
}

// 某条资料当前的标签节点
function listMaterialNodes(materialId) {
  return db
    .prepare(
      `SELECT k.id, k.name, k.type
         FROM material_node_links mnl
         JOIN knowledge_nodes k ON k.id = mnl.node_id
        WHERE mnl.material_id = ?
        ORDER BY k.id`
    )
    .all(materialId);
}

// 完整替换某条资料的标签（事务：要么全成功，要么全回滚）
function replaceMaterialNodes(materialId, nodeIds) {
  const del = db.prepare('DELETE FROM material_node_links WHERE material_id = ?');
  const insert = db.prepare(
    'INSERT OR IGNORE INTO material_node_links (material_id, node_id) VALUES (?, ?)'
  );
  db.exec('BEGIN');
  try {
    del.run(materialId);
    for (const nodeId of nodeIds || []) insert.run(materialId, nodeId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return listMaterialNodes(materialId);
}

// 取“直接关联”某个节点的资料（节点详情页用，不聚合子节点）
function listMaterialsByNode(nodeId) {
  return db
    .prepare(
      `SELECT m.id, m.course_id, m.title, m.file_url, m.file_type, m.created_at
         FROM material_node_links mnl
         JOIN materials m ON m.id = mnl.material_id
        WHERE mnl.node_id = ?
        ORDER BY m.id`
    )
    .all(nodeId);
}

// ==================== 笔记 ====================

const NOTE_COLUMNS = 'id, course_id, title, file_url, file_type, source, created_at';

// 笔记列表：字段和原来一样，额外给每条补一个 nodes 数组（标签节点）
function listNotes(courseId) {
  const rows = db
    .prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE course_id = ? ORDER BY id`)
    .all(courseId);
  return attachNoteNodes(sortByCreatedAtDesc(rows), courseId);
}

function findNote(id) {
  return db.prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ?`).get(id);
}

// 新建笔记；nodeIds 可选，不传就是原来那条“没有标签”的笔记
function createNote(courseId, title, fileUrl, fileType, source, nodeIds) {
  db.exec('BEGIN');
  try {
    const info = db
      .prepare(
        'INSERT INTO notes (course_id, title, file_url, file_type, source, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(courseId, title, fileUrl, fileType, source, nowText());
    const id = Number(info.lastInsertRowid);

    const insert = db.prepare(
      'INSERT OR IGNORE INTO note_node_links (note_id, node_id) VALUES (?, ?)'
    );
    for (const nodeId of nodeIds || []) insert.run(id, nodeId);

    db.exec('COMMIT');
    return findNote(id);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function deleteNote(id) {
  db.prepare('DELETE FROM notes WHERE id = ?').run(id);
}

// 给一批笔记补上 nodes 数组
function attachNoteNodes(rows, courseId) {
  if (rows.length === 0) return rows;

  const links = db
    .prepare(
      `SELECT nnl.note_id, k.id, k.name, k.type
         FROM note_node_links nnl
         JOIN notes n           ON n.id = nnl.note_id
         JOIN knowledge_nodes k ON k.id = nnl.node_id
        WHERE n.course_id = ?
        ORDER BY nnl.note_id, k.id`
    )
    .all(courseId);

  const byNote = new Map();
  for (const link of links) {
    if (!byNote.has(link.note_id)) byNote.set(link.note_id, []);
    byNote.get(link.note_id).push({ id: link.id, name: link.name, type: link.type });
  }

  return rows.map(row => ({ ...row, nodes: byNote.get(row.id) || [] }));
}

// 某条笔记当前的标签节点
function listNoteNodes(noteId) {
  return db
    .prepare(
      `SELECT k.id, k.name, k.type
         FROM note_node_links nnl
         JOIN knowledge_nodes k ON k.id = nnl.node_id
        WHERE nnl.note_id = ?
        ORDER BY k.id`
    )
    .all(noteId);
}

// 完整替换某条笔记的标签（事务）
function replaceNoteNodes(noteId, nodeIds) {
  const del = db.prepare('DELETE FROM note_node_links WHERE note_id = ?');
  const insert = db.prepare(
    'INSERT OR IGNORE INTO note_node_links (note_id, node_id) VALUES (?, ?)'
  );
  db.exec('BEGIN');
  try {
    del.run(noteId);
    for (const nodeId of nodeIds || []) insert.run(noteId, nodeId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return listNoteNodes(noteId);
}

// 取“直接关联”某个节点的笔记（节点详情页用，不聚合子节点）
function listNotesByNode(nodeId) {
  return db
    .prepare(
      `SELECT n.id, n.course_id, n.title, n.file_url, n.file_type, n.source, n.created_at
         FROM note_node_links nnl
         JOIN notes n ON n.id = nnl.note_id
        WHERE nnl.node_id = ?
        ORDER BY n.id`
    )
    .all(nodeId);
}

// ==================== 考核 ====================

const ASSESSMENT_COLUMNS = 'id, course_id, title, deadline, requirement, archived, created_at';

// 考核列表保持和原来一样：按加入的先后顺序返回（没有额外排序）
function listAssessments(courseId) {
  return db
    .prepare(`SELECT ${ASSESSMENT_COLUMNS} FROM assessments WHERE course_id = ? ORDER BY id`)
    .all(courseId);
}

function createAssessment(courseId, title, deadline, requirement) {
  const info = db
    .prepare(
      'INSERT INTO assessments (course_id, title, deadline, requirement, archived, created_at) VALUES (?, ?, ?, ?, 0, ?)'
    )
    .run(courseId, title, deadline, requirement, nowText());
  return db
    .prepare(`SELECT ${ASSESSMENT_COLUMNS} FROM assessments WHERE id = ?`)
    .get(Number(info.lastInsertRowid));
}

function deleteAssessment(id) {
  db.prepare('DELETE FROM assessments WHERE id = ?').run(id);
}

// ==================== 知识树 ====================

const KNOWLEDGE_COLUMNS =
  'id, course_id, parent_id, name, type, sort_order, created_at, updated_at';

// 按 id 找节点，找不到返回 undefined
function findKnowledgeNode(id) {
  return db
    .prepare(`SELECT ${KNOWLEDGE_COLUMNS} FROM knowledge_nodes WHERE id = ?`)
    .get(id);
}

// 取某门课的完整知识树，把扁平的 parent_id 结构组装成嵌套的 children 结构。
// 顶层节点（parent_id 为 NULL）在最外层数组里，同层按 sort_order、id 排序。
function listKnowledgeTree(courseId) {
  const rows = db
    .prepare(
      `SELECT ${KNOWLEDGE_COLUMNS} FROM knowledge_nodes WHERE course_id = ? ORDER BY sort_order, id`
    )
    .all(courseId);

  const nodes = rows.map((row) => ({ ...row, children: [] }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots = [];

  for (const node of nodes) {
    const parent = node.parent_id === null ? null : byId.get(node.parent_id);
    if (parent) parent.children.push(node);
    else roots.push(node); // parent_id 为 NULL，或者父节点不在本课程里
  }

  return roots;
}

// 从顶层节点一路到当前节点的完整路径（含当前节点本身）
function getKnowledgePath(id) {
  const path = [];
  let node = findKnowledgeNode(id);
  // 最多往上走 1000 层，防止数据异常时绕成死循环
  for (let i = 0; node && i < 1000; i += 1) {
    path.unshift({ id: node.id, name: node.name });
    node = node.parent_id === null ? null : findKnowledgeNode(node.parent_id);
  }
  return path;
}

// 新节点的排序号：排在同一个父节点下面所有节点的最后
function nextSortOrder(courseId, parentId) {
  const row =
    parentId === null
      ? db
          .prepare(
            'SELECT MAX(sort_order) AS max_order FROM knowledge_nodes WHERE course_id = ? AND parent_id IS NULL'
          )
          .get(courseId)
      : db
          .prepare(
            'SELECT MAX(sort_order) AS max_order FROM knowledge_nodes WHERE course_id = ? AND parent_id = ?'
          )
          .get(courseId, parentId);
  return (row && row.max_order !== null ? row.max_order : -1) + 1;
}

// 新建节点（parentId 传 null 表示顶层节点）
function createKnowledgeNode(courseId, parentId, name, type) {
  const info = db
    .prepare(
      'INSERT INTO knowledge_nodes (course_id, parent_id, name, type, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(courseId, parentId, name, type, nextSortOrder(courseId, parentId), nowText());
  return findKnowledgeNode(Number(info.lastInsertRowid));
}

// 重命名节点（现阶段只支持改名，不支持移动节点 / 修改 type）
function renameKnowledgeNode(id, name) {
  db.prepare('UPDATE knowledge_nodes SET name = ?, updated_at = ? WHERE id = ?').run(
    name,
    nowText(),
    id
  );
  return findKnowledgeNode(id);
}

// 删除节点：
//   - 删 folder 时，整棵子树由 parent_id 的外键级联一起删掉
//   - 这些节点上的错题标签关联由 mistake_node_links 的外键级联清理
//   - 错题本身不会被删除
function deleteKnowledgeNode(id) {
  db.prepare('DELETE FROM knowledge_nodes WHERE id = ?').run(id);
}

// ===== Phase 4C-1：节点排序 / 移动 =====

// 取某个父节点下面的直接子节点（按 sort_order, id 稳定排序）
function listChildNodes(courseId, parentId) {
  return parentId === null
    ? db
        .prepare(
          `SELECT ${KNOWLEDGE_COLUMNS} FROM knowledge_nodes
            WHERE course_id = ? AND parent_id IS NULL
            ORDER BY sort_order, id`
        )
        .all(courseId)
    : db
        .prepare(
          `SELECT ${KNOWLEDGE_COLUMNS} FROM knowledge_nodes
            WHERE course_id = ? AND parent_id = ?
            ORDER BY sort_order, id`
        )
        .all(courseId, parentId);
}

// 把一组兄弟节点按给定顺序，稠密重编号为 0..n-1
function rewriteSiblingOrder(ids) {
  const update = db.prepare('UPDATE knowledge_nodes SET sort_order = ? WHERE id = ?');
  ids.forEach((nodeId, index) => update.run(index, nodeId));
}

// 移动 / 排序节点：
//   parentId = null  → 移到课程根层级
//   position         → 把节点摘出来之后，在目标层 children 中的 0 基位置；
//                      传 null 表示放到末尾，越界会自动 clamp 到合法范围
// folder 移动时整棵子树跟着走（只改 folder 自己的 parent_id，后代不用逐个改）。
// 节点 id 不变，所以 mistake_node_links 里的标签关联完全不受影响。
//
// 整个过程在一个事务里：任何一步失败都 ROLLBACK，不会出现
// “parent_id 改了、sort_order 只改一半”的中间状态。
//
// 返回 { ok: true, node } 或 { ok: false, status, message }
function moveKnowledgeNode(id, parentId, position) {
  db.exec('BEGIN');

  // 校验不通过时统一先回滚，再把错误交回给 server.js
  const fail = (status, message) => {
    db.exec('ROLLBACK');
    return { ok: false, status, message };
  };

  try {
    const node = findKnowledgeNode(id);
    if (!node) return fail(404, '找不到节点');

    // ---- 校验目标父节点 ----
    let parent = null;
    if (parentId !== null) {
      parent = findKnowledgeNode(parentId);
      if (!parent) return fail(400, '父节点不存在');
      if (parent.id === node.id) return fail(400, '不能把节点移动到它自己下面');
      if (parent.course_id !== node.course_id) return fail(400, '父节点不属于这门课程');
      if (parent.type !== 'folder') return fail(400, '不能把节点移动到知识点下面');
    }

    // ---- 防环：从目标父沿 parent_id 一路向上，遇到自己就拒绝 ----
    let cursor = parent;
    let depth = 0;
    while (cursor) {
      if (cursor.id === node.id) return fail(400, '不能把节点移动到它自己的后代下面');
      depth += 1;
      if (depth > 1000) return fail(400, '节点层级过深，已拒绝本次移动');
      cursor = cursor.parent_id === null ? null : findKnowledgeNode(cursor.parent_id);
    }

    // ---- 算新顺序（都先把自己摘掉，避免自己干扰下标）----
    const oldParentId = node.parent_id;
    const oldSiblings = listChildNodes(node.course_id, oldParentId)
      .filter((n) => n.id !== id)
      .map((n) => n.id);

    const sameParent = oldParentId === parentId;
    const newOrder = sameParent
      ? oldSiblings.slice()
      : listChildNodes(node.course_id, parentId)
          .filter((n) => n.id !== id)
          .map((n) => n.id);

    let index = position === null ? newOrder.length : position;
    if (index < 0) index = 0;
    if (index > newOrder.length) index = newOrder.length;
    newOrder.splice(index, 0, id);

    // ---- 落库 ----
    db.prepare('UPDATE knowledge_nodes SET parent_id = ?, updated_at = ? WHERE id = ?').run(
      parentId,
      nowText(),
      id
    );

    // 同父移动时只有一层需要重排；跨父移动时旧层和新层都要稠密重排
    if (!sameParent) rewriteSiblingOrder(oldSiblings);
    rewriteSiblingOrder(newOrder);

    db.exec('COMMIT');
    return { ok: true, node: findKnowledgeNode(id) };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ==================== 错题 ====================

const MISTAKE_COLUMNS = 'id, course_id, title, image_url, ocr_text, created_at';

// 错题列表：字段和原来完全一样，按加入的先后顺序返回（没有额外排序）。
// 额外给每条错题补一个 knowledge 数组（知识点标签）；新增字段不影响老前端。
function listMistakes(courseId) {
  const rows = db
    .prepare(`SELECT ${MISTAKE_COLUMNS} FROM mistakes WHERE course_id = ? ORDER BY id`)
    .all(courseId);
  return attachNodes(rows, courseId);
}

// 单条错题详情（含标签节点），找不到返回 undefined
function getMistakeDetail(id) {
  const row = db
    .prepare(`SELECT ${MISTAKE_COLUMNS} FROM mistakes WHERE id = ?`)
    .get(id);
  if (!row) return undefined;
  return { ...row, knowledge: listMistakeNodes(id) };
}

function createMistake(courseId, title, imageUrl) {
  const info = db
    .prepare(
      'INSERT INTO mistakes (course_id, title, image_url, ocr_text, created_at) VALUES (?, ?, ?, \'\', ?)'
    )
    .run(courseId, title, imageUrl, nowText());
  return db
    .prepare(`SELECT ${MISTAKE_COLUMNS} FROM mistakes WHERE id = ?`)
    .get(Number(info.lastInsertRowid));
}

function deleteMistake(id) {
  db.prepare('DELETE FROM mistakes WHERE id = ?').run(id);
}

// ==================== 错题 ↔ 知识树节点 关联 ====================
// 从 v3 起 folder 和 knowledge 都可以作为错题标签，
// 所以这里统一用“节点（node）”来命名，不再只叫知识点。
// 注意：对外 JSON 字段名仍是 knowledge（Phase 3 前端兼容），只是每个元素多了 type。

// 取一道错题关联的所有标签节点：[{ id, name, type }, ...]
function listMistakeNodes(mistakeId) {
  return db
    .prepare(
      `SELECT k.id, k.name, k.type
         FROM mistake_node_links mnl
         JOIN knowledge_nodes k ON k.id = mnl.node_id
        WHERE mnl.mistake_id = ?
        ORDER BY k.id`
    )
    .all(mistakeId);
}

// 取“直接关联”某个节点的错题（节点详情页用）。
// 只查 mistake_node_links 里直接绑定该 node_id 的行，不聚合子节点、不继承父标签。
function listMistakesByNode(nodeId) {
  return db
    .prepare(
      `SELECT m.id, m.course_id, m.title, m.image_url, m.created_at
         FROM mistake_node_links mnl
         JOIN mistakes m ON m.id = mnl.mistake_id
        WHERE mnl.node_id = ?
        ORDER BY m.id`
    )
    .all(nodeId);
}

// 给一批错题补上 knowledge 数组。
// 一次把整门课的关联全查出来，避免一条错题查一次数据库。
function attachNodes(rows, courseId) {
  if (rows.length === 0) return rows;

  const links = db
    .prepare(
      `SELECT mnl.mistake_id, k.id, k.name, k.type
         FROM mistake_node_links mnl
         JOIN mistakes m        ON m.id = mnl.mistake_id
         JOIN knowledge_nodes k ON k.id = mnl.node_id
        WHERE m.course_id = ?
        ORDER BY mnl.mistake_id, k.id`
    )
    .all(courseId);

  const byMistake = new Map();
  for (const link of links) {
    if (!byMistake.has(link.mistake_id)) byMistake.set(link.mistake_id, []);
    byMistake.get(link.mistake_id).push({ id: link.id, name: link.name, type: link.type });
  }

  return rows.map((row) => ({ ...row, knowledge: byMistake.get(row.id) || [] }));
}

// 追加标签（上传错题时顺便打标签用）。
// INSERT OR IGNORE + 复合主键：同一道错题重复绑定同一个节点不会产生重复记录。
function addMistakeNodes(mistakeId, nodeIds) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO mistake_node_links (mistake_id, node_id) VALUES (?, ?)'
  );
  db.exec('BEGIN');
  try {
    for (const nodeId of nodeIds) insert.run(mistakeId, nodeId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return listMistakeNodes(mistakeId);
}

// 完整替换标签（先清空这道错题的旧关联，再写入新的一组）。
// 用事务保证“要么全部成功，要么全部失败”。
function replaceMistakeNodes(mistakeId, nodeIds) {
  const del = db.prepare('DELETE FROM mistake_node_links WHERE mistake_id = ?');
  const insert = db.prepare(
    'INSERT OR IGNORE INTO mistake_node_links (mistake_id, node_id) VALUES (?, ?)'
  );
  db.exec('BEGIN');
  try {
    del.run(mistakeId);
    for (const nodeId of nodeIds) insert.run(mistakeId, nodeId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return listMistakeNodes(mistakeId);
}

// ==================== 对外导出 ====================
// server.js 只通过这里提供的函数读写数据库，不直接写 SQL
module.exports = {
  // 课程
  listCourses,
  findCourse,
  createCourse,
  updateCourseName,
  setCoursePinned,
  deleteCourse,
  // 资料
  listMaterials,
  createMaterial,
  findMaterial,
  deleteMaterial,
  listMaterialNodes,
  replaceMaterialNodes,
  listMaterialsByNode,
  // 笔记
  listNotes,
  createNote,
  findNote,
  deleteNote,
  listNoteNodes,
  replaceNoteNodes,
  listNotesByNode,
  // 考核
  listAssessments,
  createAssessment,
  deleteAssessment,
  // 知识树
  findKnowledgeNode,
  listKnowledgeTree,
  getKnowledgePath,
  createKnowledgeNode,
  renameKnowledgeNode,
  deleteKnowledgeNode,
  moveKnowledgeNode,
  // 错题
  listMistakes,
  createMistake,
  getMistakeDetail,
  listMistakeNodes,
  listMistakesByNode,
  addMistakeNodes,
  replaceMistakeNodes,
  deleteMistake
};
