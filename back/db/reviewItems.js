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

// 在调用方已有的事务里记录一次评分（错题步骤机用），不做 BEGIN/COMMIT。
// sessionItemId 已记录过时返回 null，由调用方保持幂等。
function recordGradeInTransaction({
  courseId, type, id, grade, reviewDate = planToday(), durationMs = 0,
  sessionId = null, sessionItemId = null, mistakeType = null,
}) {
  if (sessionItemId !== null && db.prepare('SELECT 1 FROM review_item_events WHERE session_item_id=?').get(sessionItemId)) {
    return null;
  }
  const before = fromRow(stateRow(courseId, type, id));
  const after = applyGrade(before, grade, reviewDate, profileFor({ mistakeType }));
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
  return { state: after, eventId: Number(info.lastInsertRowid) };
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

  db.exec('BEGIN');
  try {
    const written = recordGradeInTransaction({
      courseId, type, id, grade, reviewDate, durationMs, sessionId, sessionItemId,
      mistakeType: type === 'mistake' ? source.mistake_type : null,
    });
    db.exec('COMMIT');
    if (!written) {
      const existing = sessionItemId === null ? null : db.prepare('SELECT * FROM review_item_events WHERE session_item_id=?').get(sessionItemId);
      return { ...stateView(courseId, type, id, stateRow(courseId, type, id)), eventId: existing ? existing.id : null, duplicate: true };
    }
    return { ...stateView(courseId, type, id, stateRow(courseId, type, id)), eventId: written.eventId };
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
  // 日历要用标题；同一天的完成状态取该计划该日期最近一次计划复习会话。
  const titleCache = new Map();
  const titleFor = (type, id) => {
    const key = type + ':' + id;
    if (!titleCache.has(key)) {
      const table = TYPES[type];
      const row = table ? db.prepare(`SELECT title FROM ${table} WHERE id=?`).get(id) : null;
      titleCache.set(key, row ? row.title : '');
    }
    return titleCache.get(key);
  };
  const scheduledDays = result.days.map(day => {
    const session = db.prepare(`SELECT id,status FROM review_sessions
      WHERE course_id=? AND source_type='plan' AND source_id=? AND source_date=?
      ORDER BY (status='completed') DESC, updated_at DESC, id DESC LIMIT 1`).get(courseId, planId, day.date);
    let state = 'none';
    let sessionTypes = [];
    if (session) {
      const counts = db.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN status='completed' AND result='failed' THEN 1 ELSE 0 END) failed,
        SUM(CASE WHEN status!='completed' THEN 1 ELSE 0 END) open
        FROM review_session_items WHERE session_id=?`).get(session.id);
      state = session.status === 'completed' && counts.total > 0
        && (counts.failed || 0) === 0 && (counts.open || 0) === 0 ? 'done' : 'partial';
      sessionTypes = db.prepare('SELECT DISTINCT item_type FROM review_session_items WHERE session_id=?')
        .all(session.id).map(row => row.item_type);
    }
    return {
      ...day,
      state,
      sessionId: session ? session.id : null,
      sessionStatus: session ? session.status : null,
      sessionTypes,
      items: day.items.map(item => ({ ...item, title: titleFor(item.type, item.id) })),
    };
  });
  // 物化任务（review_plan_items）才是“实际排了、实际做了什么”的权威记录：
  // 把它合并进日历，避免“17 号任务已完成但日历没勾”的矛盾。
  const planRows = db.prepare(`SELECT item_type,item_id,scheduled_date,status,title_snapshot,estimated_minutes,source_deleted
    FROM review_plan_items WHERE plan_id=? ORDER BY scheduled_date,sort_order`).all(planId);
  const planByDate = new Map();
  for (const row of planRows) {
    if (!planByDate.has(row.scheduled_date)) planByDate.set(row.scheduled_date, []);
    planByDate.get(row.scheduled_date).push(row);
  }
  const scheduledByDate = new Map(scheduledDays.map(day => [day.date, day]));
  const dates = [...new Set([...scheduledByDate.keys(), ...planByDate.keys()])].sort();
  const days = dates.map(date => {
    const materialized = planByDate.get(date);
    const preview = scheduledByDate.get(date) || null;
    if (!materialized) return preview;
    const active = materialized.filter(row => row.status !== 'skipped');
    const completed = active.filter(row => row.status === 'completed').length;
    return {
      date,
      minutes: materialized.reduce((sum, row) => sum + (Number(row.estimated_minutes) || 5), 0),
      items: materialized.map(row => ({
        type: row.item_type,
        id: row.item_id,
        title: row.title_snapshot,
        sourceDeleted: row.source_deleted ? 1 : 0,
        minutes: Number(row.estimated_minutes) || 5,
        roundNo: 1,
      })),
      state: active.length && completed === active.length ? 'done' : completed ? 'partial' : 'none',
      sessionId: preview ? preview.sessionId : null,
      sessionStatus: preview ? preview.sessionStatus : null,
      sessionTypes: preview ? preview.sessionTypes : [],
      source: 'plan',
    };
  });
  // 过期未完成的项目，按当前排期算出它们下一次出现在哪一天，供界面提示「已往后排」。
  const futureByItem = new Map();
  for (const day of days) {
    if (day.date < today) continue;
    for (const item of day.items) {
      const key = item.type + ':' + item.id;
      if (!futureByItem.has(key)) futureByItem.set(key, new Set());
      futureByItem.get(key).add(day.date);
    }
  }
  for (const day of days) {
    if (day.date >= today || day.state === 'done') continue;
    const dates = new Set();
    for (const item of day.items) {
      for (const date of futureByItem.get(item.type + ':' + item.id) || []) dates.add(date);
    }
    day.movedTo = [...dates].sort();
  }
  return { ...base, ...result, days };
}

module.exports = { getReviewItemState, recordReviewItemGrade, recordGradeInTransaction, getReviewPlanSchedule };
