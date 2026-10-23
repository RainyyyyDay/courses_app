/*
 * db/assessments.js
 * 考核：列表 / 新建 / 删除
 *
 * 由原来的单文件 db.js 按业务拆分而来，只搬了位置，逻辑没有改动。
 */

const { db, nowText } = require('./connection');

// ==================== 考核 ====================

const ASSESSMENT_COLUMNS =
  'id, course_id, title, deadline, requirement, archived, file_url, file_type, created_at, completed_at';

// Pending deadlines first; undated items last, completed items at the end.
function listAssessments(courseId) {
  return db
    .prepare(`SELECT ${ASSESSMENT_COLUMNS} FROM assessments WHERE course_id = ? ORDER BY (completed_at IS NOT NULL), (deadline = ''), deadline, id`)
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

function updateAssessment(courseId, id, changes) {
  const row=db.prepare(`SELECT ${ASSESSMENT_COLUMNS} FROM assessments WHERE id=? AND course_id=?`).get(id,courseId);
  if(!row)return null;
  const completedAt=changes.completed===undefined?row.completed_at:changes.completed?(row.completed_at||nowText()):null;
  db.prepare('UPDATE assessments SET title=?, deadline=?, requirement=?, completed_at=? WHERE id=? AND course_id=?')
    .run(changes.title??row.title,changes.deadline??row.deadline,changes.requirement??row.requirement,completedAt,id,courseId);
  return db.prepare(`SELECT ${ASSESSMENT_COLUMNS} FROM assessments WHERE id=? AND course_id=?`).get(id,courseId);
}

function deleteAssessment(id) {
  db.prepare('DELETE FROM assessments WHERE id = ?').run(id);
}


module.exports = {
  listAssessments,
  createAssessment,
  deleteAssessment,
  updateAssessment
};
