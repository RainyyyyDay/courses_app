/*
 * db/courses.js
 * 课程：增删改查 + 置顶
 *
 * 由原来的单文件 db.js 按业务拆分而来，只搬了位置，逻辑没有改动。
 */

const { db, nowText } = require('./connection');

// ==================== 课程 ====================

const COURSE_COLUMNS = 'id, name, pinned, created_at';

// 课程列表：置顶的排前面，然后按创建时间倒序（和原来的排序规则一致）
function listCourses() {
  const rows = db.prepare(`SELECT ${COURSE_COLUMNS} FROM courses`).all();
  return rows.sort((a, b) => {
    if (b.pinned !== a.pinned) return b.pinned - a.pinned;
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

// 按 id 找一门课，找不到返回 undefined（和原来 courses.find 的行为一致）
function findCourse(id) {
  return db.prepare(`SELECT ${COURSE_COLUMNS} FROM courses WHERE id = ?`).get(id);
}

// 新增课程：pinned 默认 0，created_at 自动取当前时间，返回新建好的那条
function createCourse(name) {
  const info = db
    .prepare('INSERT INTO courses (name, pinned, created_at) VALUES (?, 0, ?)')
    .run(name, nowText());
  return findCourse(Number(info.lastInsertRowid));
}

// 修改课程名
function updateCourseName(id, name) {
  db.prepare('UPDATE courses SET name = ? WHERE id = ?').run(name, id);
  return findCourse(id);
}

// 置顶 / 取消置顶：pinned 存 1 或 0（和原来一样是数字，不是 true/false）
function setCoursePinned(id, pinned) {
  db.prepare('UPDATE courses SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
  return findCourse(id);
}

// 删除课程：属于它的资料 / 笔记 / 考核 / 错题由外键级联一起删除
function deleteCourse(id) {
  db.prepare('DELETE FROM courses WHERE id = ?').run(id);
}


module.exports = {
  listCourses,
  findCourse,
  createCourse,
  updateCourseName,
  setCoursePinned,
  deleteCourse
};
