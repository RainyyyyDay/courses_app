/*
 * db/reviewItems.js
 * 备考总复习（v14）：内容级记忆状态的读写与评分记录。
 *
 * 排期算法在 reviewScheduling.js（纯函数）；这里只负责：
 *   - 校验内容归属；
 *   - 读取 / 写入 review_item_states；
 *   - 记录 review_item_events（sessionItemId 唯一，重复提交幂等）；
 *   - 按计划生成「今天到考前」的排期预览。
 */
const { db } = require('./connection');
const { planError, planToday } = require('./reviewPlanSchedule');
const {
  PROFILES, profileFor, applyGrade, normalizeState, emptyState, isValidDate, retrievability, toDay, planOccurrences,
} = require('./reviewScheduling');

const TYPES = { material: 'materials', note: 'notes', mistake: 'mistakes' };

function contentRow(courseId, type, id) {
  const table = TYPES[type];
  if (!table) planError(400, 'INVALID_ARGUMENT', '内容类型必须是 material / note / mistake');
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  if (!row || row.course_id !== courseId) planError(404, 'ITEM_NOT_FOUND', '内容不存在或不属于当前课程');
  return row;
}

function stateRow(courseId, type, id) {
  return db.prepare('SELECT * FROM review_item_states WHERE course_id=? AND item_type=? AND item_id=?')
    .get(courseId, type, id) || null;
}

function fromRow(row) {
  if (!row) return emptyState();
  return normalizeState({
    stability: row.stability,
    difficulty: row.difficulty,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    lastGrade: row.last_grade,
    lastReviewDate: row.last_review_date,
    dueDate: row.due_date,
    elapsedDays: row.elapsed_days,
    scheduledDays: row.scheduled_days,
  });
}

function stateView(courseId, type, id, row) {
  const state = fromRow(row);
  const today = planToday();
  const elapsed = state.lastReviewDate ? Math.max(0, toDay(today) - toDay(state.lastReviewDate)) : 0;
  return {
    courseId, itemType: type, itemId: id,
    ...state,
    retention: state.stability > 0 ? Math.round(retrievability(state.stability, elapsed) * 1000) / 1000 : 0,
  };
}

function getReviewItemState(courseId, type, id) {
  contentRow(courseId, type, id);
  return stateView(courseId, type, id, stateRow(courseId, type, id));
}

function recordReviewItemGrade(courseId, type, id, body) {
  const source = contentRow(courseId, type, id);
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['grade', 'durationMs', 'sessionItemId', 'reviewDate'].includes(key))) {
    planError(400, 'INVALID_ARGUMENT', '评分参数不合法');
  }
  const grade = Number(body.grade);
  if (!Number.isInteger(grade) || grade < 1 || grade > 4) planError(400, 'INVALID_ARGUMENT', 'grade 必须是 1~4 的整数');
  const durationMs = body.durationMs === undefined ? 0 : Number(body.durationMs);
  if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 86400000) {
    planError(400, 'INVALID_ARGUMENT', 'durationMs 必须是 0~86400000 的整数');
  }
  const reviewDate = body.reviewDate === undefined ? planToday() : body.reviewDate;
  if (!isValidDate(reviewDate)) planError(400, 'INVALID_ARGUMENT', 'reviewDate 必须是真实的 YYYY-MM-DD');

  let sessionId = null;
  let sessionItemId = null;
  if (body.sessionItemId !== undefined) {
    sessionItemId = Number(body.sessionItemId);
    if (!Number.isSafeInteger(sessionItemId) || sessionItemId < 1) planError(400, 'INVALID_ARGUMENT', 'sessionItemId 必须是正整数');
    const item = db.prepare('SELECT i.*,s.course_id FROM review_session_items i JOIN review_sessions s ON s.id=i.session_id WHERE i.id=?')
      .get(sessionItemId);
    if (!item || item.course_id !== courseId || item.item_type !== type || item.item_id !== id) {
      planError(404, 'SESSION_ITEM_NOT_FOUND', '复习记录项目与内容不匹配');
    }
    sessionId = item.session_id;
    const existing = db.prepare('SELECT * FROM review_item_events WHERE session_item_id=?').get(sessionItemId);
    if (existing) return { ...stateView(courseId, type, id, stateRow(courseId, type, id)), eventId: existing.id, duplicate: true };
  }

  const profile = profileFor({ mistakeType: type === 'mistake' ? source.mistake_type : undefined });
  db.exec('BEGIN');
  try {
    const before = fromRow(stateRow(courseId, type, id));
    const after = applyGrade(before, grade, reviewDate, profile);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO review_item_states
      (course_id,item_type,item_id,stability,difficulty,reps,lapses,state,last_grade,last_review_date,due_date,elapsed_days,scheduled_days,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(course_id,item_type,item_id) DO UPDATE SET
        stability=excluded.stability, difficulty=excluded.difficulty, reps=excluded.reps, lapses=excluded.lapses,
        state=excluded.state, last_grade=excluded.last_grade, last_review_date=excluded.last_review_date,
        due_date=excluded.due_date, elapsed_days=excluded.elapsed_days, scheduled_days=excluded.scheduled_days,
        updated_at=excluded.updated_at`)
      .run(courseId, type, id, after.stability, after.difficulty, after.reps, after.lapses, after.state,
        after.lastGrade, after.lastReviewDate, after.dueDate, after.elapsedDays, after.scheduledDays, now);
    const info = db.prepare(`INSERT INTO review_item_events
      (course_id,item_type,item_id,reviewed_at,review_date,grade,duration_ms,session_id,session_item_id,
       stability_before,stability_after,difficulty_before,difficulty_after,due_before,due_after)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(courseId, type, id, now, reviewDate, grade, durationMs, sessionId, sessionItemId,
        before.stability, after.stability, before.difficulty, after.difficulty, before.dueDate, after.dueDate);
    db.exec('COMMIT');
    return { ...stateView(courseId, type, id, stateRow(courseId, type, id)), eventId: Number(info.lastInsertRowid) };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// 计划排期预览：只读，不落库。真正执行仍走 review-sessions。
function getReviewPlanSchedule(courseId, planId) {
  const plan = db.prepare('SELECT * FROM review_plans WHERE id=? AND course_id=?').get(planId, courseId);
  if (!plan) planError(404, 'PLAN_NOT_FOUND', '找不到当前课程的计划');
  const rows = db.prepare('SELECT DISTINCT item_type,item_id FROM review_plan_items WHERE plan_id=?').all(planId);
  const items = rows.map(row => {
    const mistakeType = row.item_type === 'mistake'
      ? db.prepare('SELECT mistake_type FROM mistakes WHERE id=?').get(row.item_id)?.mistake_type || null
      : null;
    return {
      type: row.item_type,
      id: row.item_id,
      mistakeType,
      groupKey: row.item_type + (mistakeType ? ':' + mistakeType : ''),
    };
  });
  const states = {};
  for (const item of items) states[item.type + ':' + item.id] = fromRow(stateRow(courseId, item.type, item.id));

  const today = planToday();
  const base = {
    planId: plan.id, name: plan.name, today, examDate: plan.exam_date,
    strategy: plan.strategy, targetRetention: plan.target_retention,
    dailyMinutes: plan.daily_minutes, dailyMaxItems: plan.daily_max_items,
  };
  if (today >= plan.exam_date) {
    return { ...base, days: [], occurrences: [], unscheduled: [],
      feasibility: { feasible: false, shortfallMinutes: 0, coverage: {}, warnings: ['考试日期已过，计划不可再排期'] } };
  }
  const profile = { ...(PROFILES[plan.strategy] || PROFILES.balanced), targetRetention: plan.target_retention };
  const result = planOccurrences({
    items, states, today, examDate: plan.exam_date, profile,
    capacity: { dailyMinutes: plan.daily_minutes, dailyMaxItems: plan.daily_max_items },
  });
  return { ...base, ...result };
}

module.exports = { getReviewItemState, recordReviewItemGrade, getReviewPlanSchedule };
