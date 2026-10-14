/*
 * db/mistakes.js
 * 错题：增删改查 + 改名 + 标签关联 + 按节点汇总
 *
 * 由原来的单文件 db.js 按业务拆分而来，只搬了位置，逻辑没有改动。
 */

const { db, nowText } = require('./connection');
const { findKnowledgeNode, listSubtreeIds, SUBTREE_CTE } = require('./knowledge');

// ==================== 错题 ====================

const MISTAKE_COLUMNS =
  'id, course_id, title, image_url, file_type, ocr_text, content, created_at, mistake_type, answer_content, explanation, favorite, review_status, review_revision, answer_image_url, answer_file_type';

// 错题列表：字段和原来完全一样，按加入的先后顺序返回（没有额外排序）。
// 额外给每条错题补一个 knowledge 数组（知识点标签）；新增字段不影响老前端。
function listMistakes(courseId, filters = {}) {
  const conditions = ['course_id = ?'];
  const params = [courseId];
  for (const [key, column] of [['mistakeType', 'mistake_type'], ['reviewStatus', 'review_status'], ['favorite', 'favorite']]) {
    if (filters[key] !== undefined) { conditions.push(`${column} = ?`); params.push(filters[key]); }
  }
  if (filters.q) {
    // 用户输入作为普通子串，% 和 _ 不作为 SQL 通配符。
    const q = '%' + filters.q.replace(/[\\%_]/g, '\\$&') + '%';
    conditions.push("(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR ocr_text LIKE ? ESCAPE '\\')");
    params.push(q, q, q);
  }
  if (filters.nodeIds?.length) {
    // 用母标签（分类目录）筛选时，也要能命中只打了子标签的错题：
    // 把每个所选节点展开成「节点 + 全部后代」，再按这批 id 关联。
    const ids = listSubtreeIds(filters.nodeIds);
    if (!ids.length) conditions.push('0 = 1');
    else {
      conditions.push(`EXISTS (SELECT 1 FROM mistake_node_links l WHERE l.mistake_id = mistakes.id AND l.node_id IN (${ids.map(() => '?').join(',')}))`);
      params.push(...ids);
    }
  }
  const rows = db
    .prepare(`SELECT ${MISTAKE_COLUMNS} FROM mistakes WHERE ${conditions.join(' AND ')} ORDER BY id`)
    .all(...params);
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

// content 是“手动输入”的题目内容；上传文件录入时传空字符串
// fileType 是文件的 MIME 类型；创建记录与初始标签共用事务。
function createMistake(courseId, title, imageUrl, content, fileType, nodeIds, options = {}) {
  if (!['knowledge', 'thinking', 'execution', 'unclassified'].includes(options.mistakeType)) {
    throw new Error('新建错题必须选择知识类、思维类、执行类或待分类');
  }
  db.exec('BEGIN');
  try {
    const info = db
      .prepare(
        'INSERT INTO mistakes (course_id, title, image_url, file_type, ocr_text, content, created_at, mistake_type, answer_content, explanation) VALUES (?, ?, ?, ?, \'\', ?, ?, ?, ?, ?)'
      )
      .run(courseId, title, imageUrl, fileType || '', content || '', nowText(), options.mistakeType, options.answerContent || '', options.explanation || '');
    const id = Number(info.lastInsertRowid);
    const insert = db.prepare(
      'INSERT OR IGNORE INTO mistake_node_links (mistake_id, node_id) VALUES (?, ?)'
    );
    for (const nodeId of nodeIds || []) insert.run(id, nodeId);
    const item = db
      .prepare(`SELECT ${MISTAKE_COLUMNS} FROM mistakes WHERE id = ?`)
      .get(id);
    db.exec('COMMIT');
    return item;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function deleteMistake(id) {
  db.prepare('DELETE FROM mistakes WHERE id = ?').run(id);
}

// 改显示名：只动 title
function renameMistake(id, title) {
  db.prepare('UPDATE mistakes SET title = ? WHERE id = ?').run(title, id);
  return getMistakeDetail(id);
}

function updateMistake(id, changes, expectedRevision) {
  db.exec('BEGIN');
  try {
    const old = getMistakeDetail(id);
    if (expectedRevision !== undefined && old.review_revision !== expectedRevision) {
      const err = new Error('错题内容已修改，请重新加载');
      Object.assign(err, { status: 409, code: 'VERSION_CONFLICT' });
      throw err;
    }
    const changed = Object.entries(changes).filter(([key, value]) => old[key] !== value);
    // 题目/答案的附件换了或删了，和改文字一样算实质修改：回到未复习，等重新过一遍。
    const invalidates = changed.some(([key]) => ['mistake_type', 'content', 'answer_content', 'explanation',
      'image_url', 'file_type', 'answer_image_url', 'answer_file_type'].includes(key));
    if (changed.length) {
      const assignments = changed.map(([key]) => `${key} = ?`);
      if (invalidates) assignments.push("review_revision = review_revision + 1", "review_status = 'unreviewed'");
      db.prepare(`UPDATE mistakes SET ${assignments.join(', ')} WHERE id = ?`).run(...changed.map(([, value]) => value), id);
      if (invalidates) {
        db.prepare("UPDATE mistake_review_progress SET stage = 'idle', recall = NULL, version = version + 1, review_revision = ?, updated_at = ? WHERE mistake_id = ?")
          .run(old.review_revision + 1, new Date().toISOString(), id);
      }
    }
    db.exec('COMMIT');
    return getMistakeDetail(id);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
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

// 取某个节点（含其整棵子树）关联的错题。
//
// 这里以前是“只看直接绑定在这个 node_id 上的”，结果就是：用户打标签时
// 只勾了最末级那个知识点，点进它的母标签却显示“暂无关联错题”。
// 现在改成把整棵子树都算进来——母标签天然包含后代标签的资源，
// 不用在打标签时往母标签里塞冗余关联（那样一旦移动节点就会留下脏数据）。
function listMistakesByNode(nodeId) {
  const node = findKnowledgeNode(nodeId);
  const isSystem = node && node.is_system ? 1 : 0;
  const courseId = node ? node.course_id : -1;

  return db
    .prepare(
      `${SUBTREE_CTE}
       SELECT DISTINCT m.id, m.course_id, m.title, m.image_url, m.content, m.created_at
         FROM mistakes m
         LEFT JOIN mistake_node_links mnl ON mnl.mistake_id = m.id
        WHERE mnl.node_id IN (SELECT id FROM subtree)
           OR (? = 1 AND m.course_id = ? AND NOT EXISTS (
                SELECT 1 FROM mistake_node_links x WHERE x.mistake_id = m.id))
        ORDER BY m.id`
    )
    .all(nodeId, isSystem, courseId);
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

// 可选改名与标签替换共用事务，失败时恢复原名称及原标签。
function replaceMistakeNodes(mistakeId, nodeIds, title) {
  const del = db.prepare('DELETE FROM mistake_node_links WHERE mistake_id = ?');
  const insert = db.prepare(
    'INSERT OR IGNORE INTO mistake_node_links (mistake_id, node_id) VALUES (?, ?)'
  );
  db.exec('BEGIN');
  try {
    if (typeof title === 'string') renameMistake(mistakeId, title);
    del.run(mistakeId);
    for (const nodeId of nodeIds) insert.run(mistakeId, nodeId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return listMistakeNodes(mistakeId);
}


module.exports = {
  listMistakes,
  createMistake,
  updateMistake,
  renameMistake,
  getMistakeDetail,
  listMistakeNodes,
  listMistakesByNode,
  addMistakeNodes,
  replaceMistakeNodes,
  deleteMistake
};
