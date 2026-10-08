/*
 * db/schema.js
 * 建表 + 版本迁移 + 初始课程（require 这个文件就会自动跑一次 migrate）
 *
 * 由原来的单文件 db.js 按业务拆分而来，只搬了位置，逻辑没有改动。
 */

const { db } = require('./connection');

// ===== 当前程序支持的数据库版本 =====
const CURRENT_DB_VERSION = 6;

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

  // ---- 4 → 5：四类资源支持“手动输入 / 上传文件”，知识树增加系统分类 ----
  if (version === 4) {
    upgradeToV5();
    setUserVersion(5);
    version = 5;
  }

  // ---- 5 → 6：错题记录文件的真实类型（不再假定一定是图片）----
  if (version === 5) {
    upgradeToV6();
    setUserVersion(6);
    version = 6;
  }
}

// ===== v5 → v6 的迁移 =====
// 错题以前只存 image_url，前端就默认它是图片。
// 改成“上传文件”之后可能是 PDF 之类，所以补一列存 MIME 类型。
// 老数据这一列是空字符串，前端见到空值仍按图片处理，显示方式不变。
function upgradeToV6() {
  const exists = db
    .prepare('PRAGMA table_info(mistakes)')
    .all()
    .some((c) => c.name === 'file_type');
  if (!exists) {
    db.exec("ALTER TABLE mistakes ADD COLUMN file_type TEXT NOT NULL DEFAULT ''");
  }
}

// ===== v4 → v5 的迁移（Phase 5）=====
// 只做 ALTER TABLE ADD COLUMN，每一列都带默认值，旧数据一行都不会动。
function upgradeToV5() {
  // ALTER TABLE ... ADD COLUMN 没有 IF NOT EXISTS，所以先查一下这一列在不在
  const addColumn = (table, column, ddl) => {
    const exists = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((c) => c.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };

  // 手动输入的正文（上传文件录入时是空字符串）
  addColumn('materials', 'content', "content TEXT NOT NULL DEFAULT ''");
  addColumn('notes', 'content', "content TEXT NOT NULL DEFAULT ''");
  // 错题也能手动输入：这里存手写的题目内容；
  // ocr_text 仍然留给以后接文字识别用，两者互不干扰
  addColumn('mistakes', 'content', "content TEXT NOT NULL DEFAULT ''");

  // 考核也允许挂一个附件（不传文件时是空字符串，行为与以前完全一致）
  addColumn('assessments', 'file_url', "file_url TEXT NOT NULL DEFAULT ''");
  addColumn('assessments', 'file_type', "file_type TEXT NOT NULL DEFAULT ''");

  // 系统内置节点（“未分类”）：1 = 系统分类。
  // 用标记位而不是靠名字判断，这样用户改了名字也不会失灵。
  addColumn('knowledge_nodes', 'is_system', 'is_system INTEGER NOT NULL DEFAULT 0');
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
