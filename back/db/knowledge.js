/*
 * db/knowledge.js
 * 知识树节点：查找 / 建树 / 新建改名删除 / 排序移动 + 子树 CTE
 *
 * 由原来的单文件 db.js 按业务拆分而来，只搬了位置，逻辑没有改动。
 */

const { db, nowText } = require('./connection');

const SUBTREE_CTE = `
  WITH RECURSIVE subtree(id, depth) AS (
    SELECT ?, 0
    UNION ALL
    SELECT k.id, s.depth + 1
      FROM knowledge_nodes k
      JOIN subtree s ON k.parent_id = s.id
     WHERE s.depth < 100
  )`;

// 取某个节点（含其整棵子树）关联的资料。
// 用户打标签时往往只勾最末级那个，母标签靠这里汇总上来，不用存冗余关联。
// DISTINCT：一条资料同时挂在子树里的多个节点上时，只返回一次。
// 另外：如果这个节点是系统分类“未分类”，连“一条标签都没打的资料”也一起收进来。
// ==================== 知识树 ====================

const KNOWLEDGE_COLUMNS =
  'id, course_id, parent_id, name, type, sort_order, is_system, created_at, updated_at';

// 按 id 找节点，找不到返回 undefined
function findKnowledgeNode(id) {
  return db
    .prepare(`SELECT ${KNOWLEDGE_COLUMNS} FROM knowledge_nodes WHERE id = ?`)
    .get(id);
}

// ===== 系统分类“未分类” =====
// 每门课都有一个系统内置的顶层分类，用来收纳“还没打过任何标签”的资源。
// 用 is_system 标记识别（不靠名字），所以用户随时可以改名，功能不受影响。
const SYSTEM_NODE_NAME = '未分类';

// 取这门课的系统分类；如果还没有就现场建一个（放在顶层最后，不打乱已有顺序）
function ensureSystemNode(courseId) {
  let node = db
    .prepare(
      `SELECT ${KNOWLEDGE_COLUMNS} FROM knowledge_nodes
        WHERE course_id = ? AND is_system = 1 LIMIT 1`
    )
    .get(courseId);

  if (!node) {
    // sort_order 固定给 -1：它永远排在最顶端，不参与同级排序
    const info = db
      .prepare(
        'INSERT INTO knowledge_nodes (course_id, parent_id, name, type, sort_order, is_system, created_at) VALUES (?, NULL, ?, ?, -1, 1, ?)'
      )
      .run(courseId, SYSTEM_NODE_NAME, 'folder', nowText());
    node = findKnowledgeNode(Number(info.lastInsertRowid));
  }
  return node;
}

// 取某门课的完整知识树，把扁平的 parent_id 结构组装成嵌套的 children 结构。
// 顶层节点（parent_id 为 NULL）在最外层数组里，同层按 sort_order、id 排序。
function listKnowledgeTree(courseId) {
  ensureSystemNode(courseId); // “未分类”必须始终存在

  // is_system DESC 让“未分类”永远排在最前面；其余节点照旧按 sort_order
  const rows = db
    .prepare(
      `SELECT ${KNOWLEDGE_COLUMNS} FROM knowledge_nodes
        WHERE course_id = ?
        ORDER BY is_system DESC, sort_order, id`
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
//
// 注意：系统分类“未分类”被排除在外。它永远钉在顶层最前面，
// 不属于“可以被排序的同级”之一——否则把它算进来，别的节点上移一格
// 就会算到它前面去（界面又把它显示回顶部，看起来什么都没发生）。
function listChildNodes(courseId, parentId) {
  return parentId === null
    ? db
        .prepare(
          `SELECT ${KNOWLEDGE_COLUMNS} FROM knowledge_nodes
            WHERE course_id = ? AND parent_id IS NULL AND is_system = 0
            ORDER BY sort_order, id`
        )
        .all(courseId)
    : db
        .prepare(
          `SELECT ${KNOWLEDGE_COLUMNS} FROM knowledge_nodes
            WHERE course_id = ? AND parent_id = ? AND is_system = 0
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
    if (node.is_system) return fail(400, '「未分类」是系统分类，不能移动');

    // ---- 校验目标父节点 ----
    let parent = null;
    if (parentId !== null) {
      parent = findKnowledgeNode(parentId);
      if (!parent) return fail(400, '父节点不存在');
      if (parent.id === node.id) return fail(400, '不能把节点移动到它自己下面');
      if (parent.course_id !== node.course_id) return fail(400, '父节点不属于这门课程');
      // “未分类”是只读收纳桶，只自动收纳“没打标签”的资源，不接受子节点
      if (parent.is_system) return fail(400, '不能把节点移到「未分类」下面');
      // 知识点是叶节点，不能再往下挂子节点
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


module.exports = {
  SUBTREE_CTE,
  findKnowledgeNode,
  listKnowledgeTree,
  getKnowledgePath,
  createKnowledgeNode,
  renameKnowledgeNode,
  deleteKnowledgeNode,
  moveKnowledgeNode
};
