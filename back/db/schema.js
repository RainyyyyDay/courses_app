/*
 * db/schema.js
 * 建表 + 版本迁移 + 初始课程（require 这个文件就会自动跑一次 migrate）
 *
 * 由原来的单文件 db.js 按业务拆分而来，只搬了位置，逻辑没有改动。
 */

const { db } = require('./connection');

// ===== 当前程序支持的数据库版本 =====
const CURRENT_DB_VERSION = 17;

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
  if (version === 6) {
    db.exec('BEGIN');
    try {
      upgradeToV7();
      setUserVersion(7);
      db.exec('COMMIT');
      version = 7;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  if (version === 7) {
    db.exec('BEGIN');
    try {
      const columns = db.prepare('PRAGMA table_info(materials)').all();
      if (!columns.some(column => column.name === 'review_status')) {
        db.exec("ALTER TABLE materials ADD COLUMN review_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed','reviewed'))");
      }
      setUserVersion(8);
      db.exec('COMMIT');
      version = 8;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  if (version === 8) {
    db.exec('BEGIN');
    try {
      const columns = db.prepare('PRAGMA table_info(notes)').all();
      if (!columns.some(column => column.name === 'review_status')) {
        db.exec("ALTER TABLE notes ADD COLUMN review_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed','reviewed'))");
      }
      setUserVersion(9);
      db.exec('COMMIT');
      version = 9;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  if (version === 9) {
    db.exec('BEGIN');
    try {
      for (const table of ['materials', 'notes']) {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all();
        if (!columns.some(column => column.name === 'favorite')) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0,1))`);
        }
      }
      setUserVersion(10);
      db.exec('COMMIT');
      version = 10;   // 交给下一步（v11）继续，别再漏了
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  if (version === 10) {
    db.exec('BEGIN');
    try {
      // 答案也能是一个附件（拍的解题过程、答案 PDF 之类），和答案文字并存。
      const marked = new Set(db.prepare('PRAGMA table_info(mistakes)').all().map(c => c.name));
      for (const [name, ddl] of Object.entries({
        answer_image_url: "TEXT NOT NULL DEFAULT ''",
        answer_file_type: "TEXT NOT NULL DEFAULT ''",
      })) {
        if (!marked.has(name)) db.exec(`ALTER TABLE mistakes ADD COLUMN ${name} ${ddl}`);
      }
      setUserVersion(11);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  // 读取实际版本，兼容旧 v10 分支没有推进局部 version 的情况；旧迁移保持原样。
  if (getUserVersion() === 11) {
    db.exec('BEGIN');
    try {
      upgradeToV12();
      setUserVersion(12);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

function migrateReviewSessions() {
  if (getUserVersion() !== 12) return;
  db.exec('BEGIN');
  try { upgradeToV13(); setUserVersion(13); db.exec('COMMIT'); }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}

function upgradeToV13() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK(source_type IN ('plan','total','material','note','mistake')),
      source_id INTEGER REFERENCES review_plans(id) ON DELETE SET NULL,
      source_date TEXT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed')),
      current_position INTEGER NOT NULL DEFAULT 0 CHECK(current_position >= 0),
      create_request_id TEXT NOT NULL,
      request_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(course_id,create_request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_review_sessions_course ON review_sessions(course_id,status,updated_at,id);
    CREATE TABLE IF NOT EXISTS review_session_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL CHECK(item_type IN ('material','note','mistake')),
      item_id INTEGER NOT NULL CHECK(item_id > 0),
      position INTEGER NOT NULL CHECK(position >= 0),
      title_snapshot TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','skipped')),
      completed_at TEXT,
      source_deleted INTEGER NOT NULL DEFAULT 0 CHECK(source_deleted IN (0,1)),
      plan_item_id INTEGER REFERENCES review_plan_items(id) ON DELETE SET NULL,
      review_round INTEGER,
      review_revision INTEGER,
      UNIQUE(session_id,position), UNIQUE(session_id,item_type,item_id),
      CHECK((status='completed' AND completed_at IS NOT NULL) OR (status!='completed' AND completed_at IS NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_review_session_source ON review_session_items(item_type,item_id);
    CREATE TRIGGER IF NOT EXISTS review_session_settled AFTER UPDATE OF status ON review_session_items
      WHEN OLD.status != NEW.status BEGIN
      UPDATE review_sessions SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        status=CASE WHEN NOT EXISTS(SELECT 1 FROM review_session_items WHERE session_id=NEW.session_id AND status='pending') THEN 'completed' ELSE status END,
        completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM review_session_items WHERE session_id=NEW.session_id AND status='pending')
          THEN COALESCE(completed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE completed_at END
        WHERE id=NEW.session_id AND status!='completed';
    END;
  `);
  for (const [type,table] of [['material','materials'],['note','notes'],['mistake','mistakes']]) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS review_session_${type}_scope BEFORE INSERT ON review_session_items
      WHEN NEW.item_type='${type}' BEGIN
      SELECT RAISE(ABORT,'session item must belong to course') WHERE NOT EXISTS(
        SELECT 1 FROM ${table} r JOIN review_sessions s ON s.id=NEW.session_id WHERE r.id=NEW.item_id AND r.course_id=s.course_id);
    END;
    CREATE TRIGGER IF NOT EXISTS review_session_${type}_deleted AFTER DELETE ON ${table} BEGIN
      UPDATE review_session_items SET source_deleted=1,
        status=CASE WHEN status='pending' THEN 'skipped' ELSE status END WHERE item_type='${type}' AND item_id=OLD.id;
    END;`);
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS review_session_fixed_course BEFORE UPDATE OF course_id ON review_sessions
    WHEN OLD.course_id!=NEW.course_id BEGIN SELECT RAISE(ABORT,'session course is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS review_session_fixed_item BEFORE UPDATE OF session_id,item_type,item_id,position,title_snapshot ON review_session_items
    BEGIN SELECT RAISE(ABORT,'session queue is immutable'); END;`);
}

// ===== v13 → v14：备考总复习的记忆状态与评分事件 =====
function migrateReviewScheduling() {
  if (getUserVersion() !== 13) return;
  db.exec('BEGIN');
  try { upgradeToV14(); setUserVersion(14); db.exec('COMMIT'); }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}

// ===== v14 → v15：复习记录的单项结果（通过 / 未通过） =====
// 只有通过复习模式才算「完成一项」；答错、不记得、跳过都只是「过了一遍」。
function migrateReviewResults() {
  if (getUserVersion() !== 14) return;
  db.exec('BEGIN');
  try { upgradeToV15(); setUserVersion(15); db.exec('COMMIT'); }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}

// v15 → v16：保存「已确认的排期快照」。提前复习后先不自动展示新排期，
// 由用户在日历上点「应用新排期」才切换。
function migratePlanScheduleSnapshot() {
  if (getUserVersion() !== 15) return;
  db.exec('BEGIN');
  try {
    const exists = db.prepare('PRAGMA table_info(review_plans)').all().some((c) => c.name === 'schedule_json');
    if (!exists) db.exec('ALTER TABLE review_plans ADD COLUMN schedule_json TEXT');
    setUserVersion(16);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}

// ===== v16 → v17：复习模式与选择题复现 =====
// 仅新增列/表；旧错题默认仍是主观题，原有复习步骤机不受影响。
function migrateReviewModes() {
  if (getUserVersion() !== 16) return;
  db.exec('BEGIN');
  try {
    upgradeToV17();
    setUserVersion(17);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function upgradeToV17() {
  const addColumn = (table, column, ddl) => {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  addColumn('mistakes', 'question_format', "question_format TEXT NOT NULL DEFAULT 'open' CHECK(question_format IN ('open','choice'))");
  addColumn('mistakes', 'options_json', "options_json TEXT NOT NULL DEFAULT '[]'");
  addColumn('mistakes', 'correct_option', "correct_option TEXT NOT NULL DEFAULT ''");
  addColumn('mistakes', 'choice_type', "choice_type TEXT NOT NULL DEFAULT 'single' CHECK(choice_type IN ('single','multiple'))");
  addColumn('mistake_review_progress', 'selected_option', 'selected_option TEXT');
  addColumn('mistake_review_progress', 'choice_correct', 'choice_correct INTEGER CHECK(choice_correct IS NULL OR choice_correct IN (0,1))');
  addColumn('mistake_review_events', 'mode_id', 'mode_id TEXT');
  addColumn('mistake_review_events', 'selected_option', 'selected_option TEXT');
  addColumn('review_item_states', 'last_mode_id', 'last_mode_id TEXT');
  addColumn('review_item_events', 'mode_id', 'mode_id TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_item_modes (
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL CHECK(item_type IN ('material','note','mistake')),
      item_id INTEGER NOT NULL CHECK(item_id > 0),
      mode_id TEXT NOT NULL,
      mode_source TEXT NOT NULL CHECK(mode_source IN ('user','rule','ai','default')),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(course_id,item_type,item_id)
    );
  `);
  for (const [type, table] of [['material', 'materials'], ['note', 'notes'], ['mistake', 'mistakes']]) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS review_item_mode_${type}_deleted AFTER DELETE ON ${table} BEGIN
      DELETE FROM review_item_modes WHERE item_type='${type}' AND item_id=OLD.id;
    END`);
  }
}

function upgradeToV15() {
  const exists = db.prepare('PRAGMA table_info(review_session_items)').all().some((c) => c.name === 'result');
  if (!exists) {
    db.exec("ALTER TABLE review_session_items ADD COLUMN result TEXT CHECK(result IS NULL OR result IN ('passed','failed'))");
  }
  // 旧记录没有单项结果：阅读类只有 reviewed 才会完成，可安全补成 passed；
  // 错题按当前 review_status 近似回填（历史判断结果没有单独保存）。
  db.exec(`
    UPDATE review_session_items SET result='passed'
      WHERE status='completed' AND result IS NULL AND item_type IN ('material','note');
    UPDATE review_session_items SET result=CASE WHEN EXISTS(
        SELECT 1 FROM mistakes m WHERE m.id=review_session_items.item_id AND m.review_status='reviewed')
      THEN 'passed' ELSE 'failed' END
      WHERE status='completed' AND result IS NULL AND item_type='mistake';
  `);
}

function upgradeToV14() {
  const addColumn = (table, column, ddl) => {
    const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };

  db.exec(`
    CREATE TABLE IF NOT EXISTS review_item_states (
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL CHECK(item_type IN ('material','note','mistake')),
      item_id INTEGER NOT NULL CHECK(item_id > 0),
      stability REAL NOT NULL DEFAULT 0 CHECK(stability >= 0),
      difficulty REAL NOT NULL DEFAULT 0 CHECK(difficulty BETWEEN 0 AND 10),
      reps INTEGER NOT NULL DEFAULT 0 CHECK(reps >= 0),
      lapses INTEGER NOT NULL DEFAULT 0 CHECK(lapses >= 0),
      state TEXT NOT NULL DEFAULT 'new' CHECK(state IN ('new','learning','review','relearning')),
      last_grade INTEGER CHECK(last_grade IS NULL OR last_grade BETWEEN 1 AND 4),
      last_review_date TEXT,
      due_date TEXT,
      elapsed_days INTEGER NOT NULL DEFAULT 0 CHECK(elapsed_days >= 0),
      scheduled_days INTEGER NOT NULL DEFAULT 0 CHECK(scheduled_days >= 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (course_id,item_type,item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_review_item_states_due ON review_item_states(course_id,due_date);
    CREATE TABLE IF NOT EXISTS review_item_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL CHECK(item_type IN ('material','note','mistake')),
      item_id INTEGER NOT NULL CHECK(item_id > 0),
      reviewed_at TEXT NOT NULL,
      review_date TEXT NOT NULL,
      grade INTEGER NOT NULL CHECK(grade BETWEEN 1 AND 4),
      duration_ms INTEGER NOT NULL DEFAULT 0 CHECK(duration_ms >= 0),
      session_id INTEGER,
      session_item_id INTEGER,
      stability_before REAL,
      stability_after REAL,
      difficulty_before REAL,
      difficulty_after REAL,
      due_before TEXT,
      due_after TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_review_item_events_item ON review_item_events(course_id,item_type,item_id,id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_review_item_events_session ON review_item_events(session_item_id) WHERE session_item_id IS NOT NULL;
  `);
  for (const [type, table] of [['material', 'materials'], ['note', 'notes'], ['mistake', 'mistakes']]) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS review_item_state_${type}_deleted AFTER DELETE ON ${table} BEGIN
      DELETE FROM review_item_states WHERE item_type='${type}' AND item_id=OLD.id;
    END`);
  }
  addColumn('review_plans', 'target_retention', 'target_retention REAL NOT NULL DEFAULT 0.9');
  addColumn('review_plans', 'daily_minutes', 'daily_minutes INTEGER NOT NULL DEFAULT 60');
  addColumn('review_plans', 'daily_max_items', 'daily_max_items INTEGER NOT NULL DEFAULT 60');
  addColumn('review_plans', 'strategy', "strategy TEXT NOT NULL DEFAULT 'balanced' CHECK(strategy IN ('memory','reasoning','balanced'))");
  addColumn('review_plan_items', 'estimated_minutes', 'estimated_minutes INTEGER NOT NULL DEFAULT 5');
  addColumn('review_plan_items', 'round_no', 'round_no INTEGER NOT NULL DEFAULT 1');
  addColumn('review_plan_items', 'mode_hint', 'mode_hint TEXT');
}

function upgradeToV12() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
      start_date TEXT NOT NULL,
      exam_date TEXT NOT NULL CHECK (exam_date > start_date),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_review_plans_course ON review_plans(course_id, status);
    CREATE TABLE IF NOT EXISTS review_plan_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL REFERENCES review_plans(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL CHECK (item_type IN ('material','note','mistake')),
      item_id INTEGER NOT NULL CHECK (item_id > 0),
      scheduled_date TEXT NOT NULL,
      sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','skipped')),
      completed_at TEXT,
      title_snapshot TEXT NOT NULL,
      source_deleted INTEGER NOT NULL DEFAULT 0 CHECK (source_deleted IN (0,1)),
      review_round INTEGER,
      review_revision INTEGER,
      UNIQUE(plan_id, item_type, item_id),
      CHECK ((status = 'completed' AND completed_at IS NOT NULL) OR (status != 'completed' AND completed_at IS NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_review_plan_day ON review_plan_items(plan_id, scheduled_date, status, sort_order);
    CREATE INDEX IF NOT EXISTS idx_review_plan_source ON review_plan_items(item_type, item_id);
    CREATE TRIGGER IF NOT EXISTS review_plan_fixed_course BEFORE UPDATE OF course_id ON review_plans
      WHEN NEW.course_id != OLD.course_id BEGIN SELECT RAISE(ABORT, 'plan course is immutable'); END;
  `);
  for (const [type, table] of [['material','materials'],['note','notes'],['mistake','mistakes']]) {
    for (const [suffix, event] of [['insert','INSERT'],['update','UPDATE OF plan_id, item_type, item_id, scheduled_date']]) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS review_plan_${type}_${suffix} BEFORE ${event} ON review_plan_items
        WHEN NEW.item_type = '${type}' BEGIN
          SELECT RAISE(ABORT, 'plan item must belong to its course and date range') WHERE NOT EXISTS (
            SELECT 1 FROM ${table} r JOIN review_plans p ON p.id = NEW.plan_id
            WHERE r.id = NEW.item_id AND r.course_id = p.course_id
              AND NEW.scheduled_date >= p.start_date AND NEW.scheduled_date < p.exam_date);
        END`);
    }
    db.exec(`CREATE TRIGGER IF NOT EXISTS review_plan_${type}_deleted AFTER DELETE ON ${table} BEGIN
      UPDATE review_plan_items SET source_deleted = 1,
        status = CASE WHEN status = 'pending' THEN 'skipped' ELSE status END
        WHERE item_type = '${type}' AND item_id = OLD.id;
    END`);
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS review_plan_mistake_changed AFTER UPDATE OF review_revision ON mistakes
    WHEN NEW.review_revision != OLD.review_revision BEGIN
      UPDATE review_plan_items SET review_round = NULL, review_revision = NULL
        WHERE item_type = 'mistake' AND item_id = NEW.id AND status = 'pending';
    END`);
}

// 只增加字段和单题复习结构，不改写旧题目、附件或标签。
function upgradeToV7() {
  const columns = new Set(db.prepare('PRAGMA table_info(mistakes)').all().map(c => c.name));
  const additions = {
    mistake_type: "TEXT NOT NULL DEFAULT 'unclassified' CHECK (mistake_type IN ('knowledge','thinking','execution','unclassified'))",
    answer_content: "TEXT NOT NULL DEFAULT ''",
    explanation: "TEXT NOT NULL DEFAULT ''",
    favorite: 'INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0,1))',
    review_status: "TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed','reviewed'))",
    review_revision: 'INTEGER NOT NULL DEFAULT 1',
  };
  for (const [name, ddl] of Object.entries(additions)) {
    if (!columns.has(name)) db.exec(`ALTER TABLE mistakes ADD COLUMN ${name} ${ddl}`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mistakes_filters ON mistakes(course_id, mistake_type, review_status);
    CREATE TABLE IF NOT EXISTS mistake_review_progress (
      mistake_id INTEGER PRIMARY KEY REFERENCES mistakes(id) ON DELETE CASCADE,
      stage TEXT NOT NULL DEFAULT 'idle' CHECK (stage IN ('idle','question','answer','completed')),
      recall TEXT CHECK (recall IN ('clear','vague','forgotten')),
      round INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 0,
      review_revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mistake_review_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mistake_id INTEGER NOT NULL REFERENCES mistakes(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      request_json TEXT NOT NULL,
      action TEXT NOT NULL,
      round INTEGER NOT NULL,
      mistake_type TEXT NOT NULL,
      recall TEXT,
      result TEXT,
      from_status TEXT NOT NULL CHECK (from_status IN ('unreviewed','reviewed')),
      to_status TEXT NOT NULL CHECK (to_status IN ('unreviewed','reviewed')),
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (mistake_id, request_id)
    );
  `);
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
migrateReviewSessions();
migrateReviewScheduling();
migrateReviewResults();
migratePlanScheduleSnapshot();
migrateReviewModes();

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
