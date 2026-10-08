/*
 * db/materials.js
 * 资料：增删改查 + 改名 + 标签关联 + 按节点汇总
 *
 * 由原来的单文件 db.js 按业务拆分而来，只搬了位置，逻辑没有改动。
 */

const { db, nowText, sortByCreatedAtDesc } = require('./connection');
const { findKnowledgeNode, SUBTREE_CTE } = require('./knowledge');

// ==================== 资料 ====================

const MATERIAL_COLUMNS = 'id, course_id, title, file_url, file_type, content, created_at';

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
// content 是“手动输入”的正文；上传文件录入时传空字符串
function createMaterial(courseId, title, fileUrl, fileType, nodeIds, content) {
  db.exec('BEGIN');
  try {
    const info = db
      .prepare(
        'INSERT INTO materials (course_id, title, file_url, file_type, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(courseId, title, fileUrl, fileType, content || '', nowText());
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

// 改显示名：只动 title，文件本身和关联标签都不受影响
function renameMaterial(id, title) {
  db.prepare('UPDATE materials SET title = ? WHERE id = ?').run(title, id);
  return findMaterial(id);
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

// 可选改名与标签替换共用事务：要么全成功，要么全回滚。
function replaceMaterialNodes(materialId, nodeIds, title) {
  const del = db.prepare('DELETE FROM material_node_links WHERE material_id = ?');
  const insert = db.prepare(
    'INSERT OR IGNORE INTO material_node_links (material_id, node_id) VALUES (?, ?)'
  );
  db.exec('BEGIN');
  try {
    if (typeof title === 'string') renameMaterial(materialId, title);
    del.run(materialId);
    for (const nodeId of nodeIds || []) insert.run(materialId, nodeId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return listMaterialNodes(materialId);
}

// 取某个节点及其所有后代的 id（含自己）。
// 节点详情页要“点进母标签也能看到子标签关联的资源”，靠的就是这棵子树。
// depth 上限只是防御性的：万一数据里出现环，也不会把查询拖死。
function listMaterialsByNode(nodeId) {
  const node = findKnowledgeNode(nodeId);
  const isSystem = node && node.is_system ? 1 : 0;
  const courseId = node ? node.course_id : -1;

  return db
    .prepare(
      `${SUBTREE_CTE}
       SELECT DISTINCT m.id, m.course_id, m.title, m.file_url, m.file_type, m.content, m.created_at
         FROM materials m
         LEFT JOIN material_node_links mnl ON mnl.material_id = m.id
        WHERE mnl.node_id IN (SELECT id FROM subtree)
           OR (? = 1 AND m.course_id = ? AND NOT EXISTS (
                SELECT 1 FROM material_node_links x WHERE x.material_id = m.id))
        ORDER BY m.id`
    )
    .all(nodeId, isSystem, courseId);
}


module.exports = {
  listMaterials,
  createMaterial,
  findMaterial,
  renameMaterial,
  deleteMaterial,
  listMaterialNodes,
  replaceMaterialNodes,
  listMaterialsByNode
};
