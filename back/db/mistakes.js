/*
 * db/mistakes.js
 * 错题：增删改查 + 改名 + 标签关联 + 按节点汇总
 *
 * 由原来的单文件 db.js 按业务拆分而来，只搬了位置，逻辑没有改动。
 */

const { db, nowText } = require('./connection');
const { findKnowledgeNode, SUBTREE_CTE } = require('./knowledge');

// ==================== 错题 ====================

const MISTAKE_COLUMNS =
  'id, course_id, title, image_url, file_type, ocr_text, content, created_at';

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

// content 是“手动输入”的题目内容；上传文件录入时传空字符串
// fileType 是文件的 MIME 类型；创建记录与初始标签共用事务。
function createMistake(courseId, title, imageUrl, content, fileType, nodeIds) {
  db.exec('BEGIN');
  try {
    const info = db
      .prepare(
        'INSERT INTO mistakes (course_id, title, image_url, file_type, ocr_text, content, created_at) VALUES (?, ?, ?, ?, \'\', ?, ?)'
      )
      .run(courseId, title, imageUrl, fileType || '', content || '', nowText());
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
  renameMistake,
  getMistakeDetail,
  listMistakeNodes,
  listMistakesByNode,
  addMistakeNodes,
  replaceMistakeNodes,
  deleteMistake
};
