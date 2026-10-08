/*
 * db/assessments.js
 * 考核：列表 / 新建 / 删除
 *
 * 由原来的单文件 db.js 按业务拆分而来，只搬了位置，逻辑没有改动。
 */

const { db, nowText } = require('./connection');

// ==================== 考核 ====================

const ASSESSMENT_COLUMNS =
  'id, course_id, title, deadline, requirement, archived, file_url, file_type, created_at';

// 考核列表保持和原来一样：按加入的先后顺序返回（没有额外排序）
function listAssessments(courseId) {
  return db
    .prepare(`SELECT ${ASSESSMENT_COLUMNS} FROM assessments WHERE course_id = ? ORDER BY id`)
    .all(courseId);
}

// fileUrl / fileType 可选：不传就是原来那种“纯文字”的考核
function createAssessment(courseId, title, deadline, requirement, fileUrl, fileType) {
  const info = db
    .prepare(
      'INSERT INTO assessments (course_id, title, deadline, requirement, archived, file_url, file_type, created_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)'
    )
    .run(courseId, title, deadline, requirement, fileUrl || '', fileType || '', nowText());
  return db
    .prepare(`SELECT ${ASSESSMENT_COLUMNS} FROM assessments WHERE id = ?`)
    .get(Number(info.lastInsertRowid));
}

function deleteAssessment(id) {
  db.prepare('DELETE FROM assessments WHERE id = ?').run(id);
}


module.exports = {
  listAssessments,
  createAssessment,
  deleteAssessment
};
