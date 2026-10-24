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

function chartError(status, code, message) {
  throw Object.assign(new Error(message), { status, code });
}

function parseChartRow(row) {
  if (!row) return null;
  let items;
  try { items = JSON.parse(row.items_json); } catch { return null; }
  if (!Array.isArray(items)) return null;
  return {
    assessment_id: row.assessment_id,
    course_id: row.course_id,
    title: row.title,
    items,
    version: row.version,
    source: row.source,
    updated_at: row.updated_at,
  };
}

// Pending deadlines first; undated items last, completed items at the end.
function listAssessments(courseId) {
  const rows = db
    .prepare(`SELECT ${ASSESSMENT_COLUMNS} FROM assessments WHERE course_id = ? ORDER BY (completed_at IS NOT NULL), (deadline = ''), deadline, id`)
    .all(courseId);
  const charts = new Map(db.prepare('SELECT * FROM assessment_charts WHERE course_id=?').all(courseId)
    .map(row => [row.assessment_id, parseChartRow(row)]));
  return rows.map(row => ({ ...row, chart: charts.get(row.id) || null }));
}
function getAssessment(courseId, id) {
  return db.prepare(`SELECT ${ASSESSMENT_COLUMNS} FROM assessments WHERE id=? AND course_id=?`).get(id, courseId) || null;
}
function getAssessmentByAnyCourse(id) {
  return db.prepare(`SELECT ${ASSESSMENT_COLUMNS} FROM assessments WHERE id=?`).get(id) || null;
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
  db.prepare('UPDATE assessments SET title=?, deadline=?, requirement=?, file_url=?, file_type=?, completed_at=? WHERE id=? AND course_id=?')
    .run(changes.title??row.title,changes.deadline??row.deadline,changes.requirement??row.requirement,
      changes.fileUrl??row.file_url,changes.fileType??row.file_type,completedAt,id,courseId);
  return db.prepare(`SELECT ${ASSESSMENT_COLUMNS} FROM assessments WHERE id=? AND course_id=?`).get(id,courseId);
}

function deleteAssessment(id) {
  db.prepare('DELETE FROM assessments WHERE id = ?').run(id);
}

function getAssessmentChart(courseId, assessmentId) {
  const assessment = db.prepare('SELECT id FROM assessments WHERE id=? AND course_id=?').get(assessmentId, courseId);
  if (!assessment) chartError(404, 'ASSESSMENT_NOT_FOUND', '考核不存在或不属于当前课程');
  const chart = parseChartRow(db.prepare('SELECT * FROM assessment_charts WHERE assessment_id=? AND course_id=?')
    .get(assessmentId, courseId));
  return chart || { assessment_id: assessmentId, course_id: courseId, title: '', items: [], version: 0, source: 'manual', updated_at: null };
}

function validateChart(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['title', 'items', 'expectedVersion', 'source'].includes(key))) {
    chartError(400, 'INVALID_CHART', '图表参数无效');
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 120) chartError(400, 'INVALID_CHART', '图表标题请填写 1 到 120 个字符');
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) {
    chartError(400, 'INVALID_CHART', '图表需要 1 到 30 个部分');
  }
  const labels = new Set();
  let total = 0;
  const items = body.items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).some(key => !['label', 'percent', 'detail', 'color'].includes(key))) {
      chartError(400, 'INVALID_CHART', '图表部分参数无效');
    }
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    const detail = typeof item.detail === 'string' ? item.detail.trim() : '';
    const percent = typeof item.percent === 'number' && Number.isFinite(item.percent) ? item.percent : NaN;
    const color = item.color === undefined || item.color === '' ? '' : String(item.color);
    if (!label || label.length > 80) chartError(400, 'INVALID_CHART', '每个部分需要 1 到 80 字的名称');
    if (detail.length > 500) chartError(400, 'INVALID_CHART', '每个部分的具体内容最多 500 字');
    if (!(percent > 0 && percent <= 100)) chartError(400, 'INVALID_CHART', '每个部分的占比必须大于 0 且不超过 100');
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) chartError(400, 'INVALID_CHART', '颜色必须为六位十六进制色值');
    const normalizedLabel = label.toLocaleLowerCase('zh-CN');
    if (labels.has(normalizedLabel)) chartError(400, 'INVALID_CHART', '图表部分名称不能重复');
    labels.add(normalizedLabel);
    total += percent;
    return { label, percent: Math.round(percent * 100) / 100, detail, color };
  });
  if (total > 100.0001) chartError(400, 'CHART_TOTAL_EXCEEDS_100', '各部分占比合计不能超过 100%');
  if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) {
    chartError(400, 'INVALID_CHART', '图表版本无效');
  }
  const source = body.source === undefined ? 'manual' : body.source;
  if (!['manual', 'ai'].includes(source)) chartError(400, 'INVALID_CHART', '图表来源无效');
  return { title, items, expectedVersion: body.expectedVersion, source };
}

function saveAssessmentChart(courseId, assessmentId, body) {
  const value = validateChart(body);
  const assessment = db.prepare('SELECT id FROM assessments WHERE id=? AND course_id=?').get(assessmentId, courseId);
  if (!assessment) chartError(404, 'ASSESSMENT_NOT_FOUND', '考核不存在或不属于当前课程');
  const current = db.prepare('SELECT * FROM assessment_charts WHERE assessment_id=? AND course_id=?')
    .get(assessmentId, courseId);
  const currentVersion = current?.version || 0;
  if (value.expectedVersion !== currentVersion) {
    chartError(409, 'CHART_VERSION_CONFLICT', '图表已在其他页面修改，请重新打开后再编辑');
  }
  const now = nowText(), version = currentVersion + 1, itemsJson = JSON.stringify(value.items);
  if (current) {
    db.prepare('UPDATE assessment_charts SET title=?,items_json=?,version=?,source=?,updated_at=? WHERE assessment_id=? AND course_id=?')
      .run(value.title, itemsJson, version, value.source, now, assessmentId, courseId);
  } else {
    db.prepare('INSERT INTO assessment_charts(assessment_id,course_id,title,items_json,version,source,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(assessmentId, courseId, value.title, itemsJson, version, value.source, now);
  }
  return getAssessmentChart(courseId, assessmentId);
}


module.exports = {
  listAssessments,
  getAssessment,
  getAssessmentByAnyCourse,
  createAssessment,
  deleteAssessment,
  updateAssessment,
  getAssessmentChart,
  saveAssessmentChart,
  validateChart
};
