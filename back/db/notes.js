/*
 * db/notes.js
 * 笔记：增删改查 + 改名 + 标签关联 + 按节点汇总
 *
 * 由原来的单文件 db.js 按业务拆分而来，只搬了位置，逻辑没有改动。
 */

const { db, nowText, sortByCreatedAtDesc } = require('./connection');
const { findKnowledgeNode, SUBTREE_CTE } = require('./knowledge');

// ==================== 笔记 ====================

const NOTE_COLUMNS = 'id, course_id, title, file_url, file_type, source, content, created_at';

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
// content 是“手动输入”的正文；上传文件录入时传空字符串
function createNote(courseId, title, fileUrl, fileType, source, nodeIds, content) {
  db.exec('BEGIN');
  try {
    const info = db
      .prepare(
        'INSERT INTO notes (course_id, title, file_url, file_type, source, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(courseId, title, fileUrl, fileType, source, content || '', nowText());
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

// 改显示名：只动 title
function renameNote(id, title) {
  db.prepare('UPDATE notes SET title = ? WHERE id = ?').run(title, id);
  return findNote(id);
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

// 可选改名与标签替换共用事务。
function replaceNoteNodes(noteId, nodeIds, title) {
  const del = db.prepare('DELETE FROM note_node_links WHERE note_id = ?');
  const insert = db.prepare(
    'INSERT OR IGNORE INTO note_node_links (note_id, node_id) VALUES (?, ?)'
  );
  db.exec('BEGIN');
  try {
    if (typeof title === 'string') renameNote(noteId, title);
    del.run(noteId);
    for (const nodeId of nodeIds || []) insert.run(noteId, nodeId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return listNoteNodes(noteId);
}

// 取某个节点（含其整棵子树）关联的笔记。规则同 listMaterialsByNode。
function listNotesByNode(nodeId) {
  const node = findKnowledgeNode(nodeId);
  const isSystem = node && node.is_system ? 1 : 0;
  const courseId = node ? node.course_id : -1;

  return db
    .prepare(
      `${SUBTREE_CTE}
       SELECT DISTINCT n.id, n.course_id, n.title, n.file_url, n.file_type, n.source, n.content, n.created_at
         FROM notes n
         LEFT JOIN note_node_links nnl ON nnl.note_id = n.id
        WHERE nnl.node_id IN (SELECT id FROM subtree)
           OR (? = 1 AND n.course_id = ? AND NOT EXISTS (
                SELECT 1 FROM note_node_links x WHERE x.note_id = n.id))
        ORDER BY n.id`
    )
    .all(nodeId, isSystem, courseId);
}


module.exports = {
  listNotes,
  createNote,
  findNote,
  renameNote,
  deleteNote,
  listNoteNodes,
  replaceNoteNodes,
  listNotesByNode
};
