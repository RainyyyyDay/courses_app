// 课程内统一搜索：仅查询已有文本，不读取附件、不联查或扩展知识树。
const { db } = require('./connection');

// SQL 标识符仅来自这个固定白名单，用户输入只通过参数绑定。
const SEARCH_RESOURCES = {
  materials: { type: 'material', order: 0, fields: ['content'] },
  notes: { type: 'note', order: 1, fields: ['content'] },
  mistakes: { type: 'mistake', order: 2, fields: ['content', 'ocr_text', 'answer_content', 'explanation'] }
};
const COURSE_SEARCH_TYPES = Object.keys(SEARCH_RESOURCES);

function searchCourse(courseId, { q, types = COURSE_SEARCH_TYPES, limit = 20, offset = 0 }) {
  const query = q.trim();
  if (!query) return { query, total: 0, results: [] };
  const selectedTypes = [...new Set(types)];
  if (!selectedTypes.length || selectedTypes.some(type => !Object.hasOwn(SEARCH_RESOURCES, type))) {
    throw new Error('不支持的搜索类型');
  }
  // 将 %、_、反斜杠按字面搜索，沿用错题列表的 LIKE ESCAPE 约定。
  const pattern = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
  const parameters = [];
  const like = field => {
    parameters.push(pattern);
    return `${field} LIKE ? ESCAPE '\\'`;
  };
  const branches = COURSE_SEARCH_TYPES.filter(type => selectedTypes.includes(type)).map(table => {
    const resource = SEARCH_RESOURCES[table];
    const rank = `CASE WHEN ${like('title')} THEN 0 ELSE 1 END`;
    // 优先取包含关键词的文本字段；仅标题命中时取首个非空正文作为摘要。
    const source = `CASE ${resource.fields.map(field => `WHEN ${like(field)} THEN ${field}`).join(' ')}
      ELSE COALESCE(${resource.fields.map(field => `NULLIF(${field}, '')`).join(', ')}, '') END`;
    parameters.push(courseId);
    const matches = ['title', ...resource.fields].map(like).join(' OR ');
    return `SELECT '${resource.type}' AS type, id, course_id AS courseId, title,
      ${rank} AS rank, ${resource.order} AS type_order, ${source} AS source
      FROM ${table} WHERE course_id = ? AND (${matches})`;
  });
  // 每个表的一行仅贡献一次结果；跨表用 type + id 区分，不做标签 JOIN。
  const matchingSql = `WITH matches AS (${branches.join(' UNION ALL ')})`;
  const total = db.prepare(`${matchingSql} SELECT COUNT(*) AS total FROM matches`).get(...parameters).total;
  if (!total || offset >= total) return { query, total, results: [] };
  const results = db.prepare(`${matchingSql}, positioned AS (
      SELECT *, CASE WHEN instr(lower(source), lower(?)) > 40
        THEN instr(lower(source), lower(?)) - 40 ELSE 1 END AS start FROM matches
    ) SELECT type, id, courseId, title,
      (CASE WHEN start > 1 THEN '…' ELSE '' END || substr(source, start, 158) ||
       CASE WHEN length(source) >= start + 158 THEN '…' ELSE '' END) AS snippet
      FROM positioned ORDER BY rank, type_order, id LIMIT ? OFFSET ?`
  ).all(...parameters, query, query, limit, offset);
  return { query, total, results };
}

module.exports = { searchCourse, COURSE_SEARCH_TYPES };
