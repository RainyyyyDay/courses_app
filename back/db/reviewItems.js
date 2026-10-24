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
const {limitReviewGrade}=require('./reviewAnswers');
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
    lastModeId: row?.last_mode_id || null,
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
  sessionId = null, sessionItemId = null, mistakeType = null, modeId = null,
  firstAnswer = null, answerRevealed = false, evidence = null,
}) {
  grade=limitReviewGrade(grade,answerRevealed,evidence?.judgedBeforeReveal===true);
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
     stability_before,stability_after,difficulty_before,difficulty_after,due_before,due_after,mode_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(courseId, type, id, now, reviewDate, grade, durationMs, sessionId, sessionItemId,
      before.stability, after.stability, before.difficulty, after.difficulty, before.dueDate, after.dueDate, modeId);
  if (db.prepare('PRAGMA table_info(review_item_events)').all().some(c=>c.name==='first_answer')) {
    db.prepare('UPDATE review_item_events SET first_answer=?,answer_revealed=?,evidence_json=? WHERE id=?')
      .run(firstAnswer,answerRevealed?1:0,evidence===null?null:JSON.stringify(evidence),Number(info.lastInsertRowid));
  }
  if (modeId) {
    db.prepare('UPDATE review_item_states SET last_mode_id=? WHERE course_id=? AND item_type=? AND item_id=?')
      .run(modeId, courseId, type, id);
  }
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
    const {reviewSessionContext,assertSessionItemWritable}=require('./reviewSessions');
    assertSessionItemWritable(reviewSessionContext(sessionItemId,courseId,type,id));
  }

  db.exec('BEGIN');
  try {
    const progress=type==='mistake'?db.prepare('SELECT * FROM mistake_review_progress WHERE mistake_id=?').get(id):null;
    const written = recordGradeInTransaction({
      courseId, type, id, grade, reviewDate, durationMs, sessionId, sessionItemId,
      mistakeType: type === 'mistake' ? source.mistake_type : null,
      firstAnswer:progress?.first_answer??null,answerRevealed:!!progress?.answer_revealed,
      evidence:{manualGrade:true,judgedBeforeReveal:progress?.choice_correct===1&&progress?.selected_option!==null},
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

// 计划排期：首读初始化快照；普通刷新只合并进度，真正执行仍走 review-sessions。
// 计划里选中的内容 + 各自记忆状态 + 计划参数（生成排期用）。
function planScheduleParts(courseId, plan) {
  const rows = db.prepare('SELECT DISTINCT item_type,item_id FROM review_plan_items WHERE plan_id=? AND source_deleted=0').all(plan.id);
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
  return {
    items,
    states,
    profile: { ...(PROFILES[plan.strategy] || PROFILES.balanced), targetRetention: plan.target_retention },
    capacity: { dailyMinutes: plan.daily_minutes, dailyMaxItems: plan.daily_max_items },
  };
}

// 只保留排期的“结构”（日期 + 当天内容），状态每次展示时实时计算。
function scheduleStructure(days) {
  return (days || []).map(day => ({
    date: day.date,
    minutes: Number(day.minutes) || 0,
    items: (day.items || []).map(item => ({
      type: item.type,
      id: item.id,
      minutes: Number(item.minutes) || 5,
      roundNo: item.roundNo || 1,
      reason: item.reason || 'repeat',
    })),
  }));
}
// Replanning is event-driven. Normal grades and daily progress never replace a confirmed schedule.
function planCompletionDate(value) {
  const time = new Date(value);
  if (!value || !Number.isFinite(time.getTime())) return null;
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(time);
}
function planCompletedRows(planId) {
  return {
    tasks: db.prepare("SELECT id,scheduled_date AS date,completed_at FROM review_plan_items WHERE plan_id=? AND source_deleted=0 AND status='completed'").all(planId),
    sessions: db.prepare(`SELECT i.id,s.source_date AS date,i.completed_at FROM review_session_items i
      JOIN review_sessions s ON s.id=i.session_id WHERE s.source_type='plan' AND s.source_id=?
      AND i.source_deleted=0 AND i.status='completed' AND i.result='passed' AND i.exposure_only=0`).all(planId),
  };
}
function planScheduleSnapshot(plan, items, live, applied) {
  const completed = applied ? planCompletedRows(plan.id) : { tasks: [], sessions: [] };
  return { days: scheduleStructure(live.days), sourceKeys: items.map(item => item.type + ':' + item.id),
    unscheduled: live.unscheduled, feasibility: live.feasibility,
    generatedAt: applied ? new Date().toISOString() : null, applied,
    appliedOn: applied ? planToday() : null,
    completedTaskIds: completed.tasks.map(row => row.id), completedSessionItemIds: completed.sessions.map(row => row.id) };
}
function planRescheduleReasons(plan, snapshot, items, days, today) {
  const currentKeys = new Set(items.map(item => item.type + ':' + item.id));
  const snapshotKeys = new Set(snapshot.sourceKeys
    || (snapshot.days || []).flatMap(day => (day.items || []).map(item => item.type + ':' + item.id)));
  const reasons = [];
  // Deleting content only changes the schedule when that content still has a task today or later.
  const deletedUpcoming = new Set();
  for (const row of db.prepare(`SELECT item_type,item_id FROM review_plan_items
    WHERE plan_id=? AND source_deleted=1 AND scheduled_date>=?`).all(plan.id, today)) {
    const key = row.item_type + ':' + row.item_id;
    if (snapshotKeys.has(key)) deletedUpcoming.add(key);
  }
  for (const day of snapshot.days || []) {
    if (!day.date || day.date < today) continue;
    for (const item of day.items || []) {
      const key = item.type + ':' + item.id;
      if (!currentKeys.has(key)) deletedUpcoming.add(key);
    }
  }
  if (deletedUpcoming.size) reasons.push('content_deleted');
  const floor = snapshot.applied ? snapshot.appliedOn || planCompletionDate(snapshot.generatedAt) || plan.start_date : plan.start_date;
  const completed = planCompletedRows(plan.id);
  const unacknowledged = (rows, known) => {
    const ids = new Set(known || []);
    return rows.filter(row => Array.isArray(known) ? !ids.has(row.id)
      : !snapshot.applied || !snapshot.generatedAt || row.completed_at > snapshot.generatedAt);
  };
  const changedCompletions = [...unacknowledged(completed.tasks, snapshot.completedTaskIds),
    ...unacknowledged(completed.sessions, snapshot.completedSessionItemIds)];
  if (changedCompletions.some(row => {
    const completedOn = planCompletionDate(row.completed_at);
    return row.date && completedOn && completedOn < row.date;
  })) reasons.push('completed_early');
  const completedLate = changedCompletions.some(row => row.date >= floor && row.date < today && planCompletionDate(row.completed_at) > row.date);
  const unfinishedPastDay = days.some(day => day.date >= floor && day.date < today
    && day.items.some(item => !(item.status === 'completed' && item.result === 'passed')));
  if (completedLate || unfinishedPastDay) reasons.push('overdue');
  return reasons;
}

// 同一天可能同时存在：排期快照、物化任务、当天会话。
// 三者按 type:id 合并，会话只覆盖状态，不能把快照里其他未开始的项目挤掉。
function mergeDayItems(base, extra) {
  const merged = new Map();
  for (const item of base || []) {
    if (!item || !item.type || !Number.isSafeInteger(item.id)) continue;
    merged.set(item.type + ':' + item.id, { ...item });
  }
  for (const item of extra || []) {
    if (!item || !item.type || !Number.isSafeInteger(item.id)) continue;
    const key = item.type + ':' + item.id;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...item });
      continue;
    }
    const next = { ...current };
    if (item.title) next.title = item.title;
    if (item.status !== undefined) next.status = item.status;
    if (item.result !== undefined) next.result = item.result;
    if (item.sourceDeleted !== undefined) next.sourceDeleted = item.sourceDeleted;
    if (item.minutes !== undefined) next.minutes = item.minutes;
    if (item.roundNo !== undefined) next.roundNo = item.roundNo;
    merged.set(key, next);
  }
  return [...merged.values()];
}

function getReviewPlanSchedule(courseId, planId) {
  const plan = db.prepare('SELECT * FROM review_plans WHERE id=? AND course_id=?').get(planId, courseId);
  if (!plan) planError(404, 'PLAN_NOT_FOUND', '找不到当前课程的计划');
  const { items, states, profile, capacity } = planScheduleParts(courseId, plan);

  const today = planToday();
  const base = {
    planId: plan.id, name: plan.name, today, examDate: plan.exam_date,
    strategy: plan.strategy, targetRetention: plan.target_retention,
    dailyMinutes: plan.daily_minutes, dailyMaxItems: plan.daily_max_items,
  };
  if (today >= plan.exam_date) {
    return { ...base, days: [], occurrences: [], unscheduled: [], hasNewSchedule: false, rescheduleReasons: [],
      feasibility: { feasible: false, shortfallMinutes: 0, coverage: {}, warnings: ['考试日期已过，计划不可再排期'] } };
  }
  let snapshot = null;
  try { snapshot = plan.schedule_json ? JSON.parse(plan.schedule_json) : null; } catch { snapshot = null; }
  if (!snapshot || !Array.isArray(snapshot.days)) {
    const live = planOccurrences({ items, states, today, examDate: plan.exam_date, profile, capacity });
    snapshot = planScheduleSnapshot(plan, items, live, false);
    db.prepare('UPDATE review_plans SET schedule_json=? WHERE id=?').run(JSON.stringify(snapshot), plan.id);
  }
  // Read the agreed schedule; do not run the scheduling algorithm on ordinary progress refreshes.
  const result = { days: snapshot.days, occurrences: [], unscheduled: snapshot.unscheduled || [],
    feasibility: snapshot.feasibility || { feasible: true, shortfallMinutes: 0, coverage: {}, warnings: [] } };
  const deletedKeys = new Set(db.prepare('SELECT item_type,item_id FROM review_plan_items WHERE plan_id=? AND source_deleted=1')
    .all(plan.id).map(row => row.item_type + ':' + row.item_id));
  const visibleSnapshotDays = snapshot.days.map(day => ({
    ...day,
    items: (day.items || []).filter(item => !deletedKeys.has(item.type + ':' + item.id)),
  })).filter(day => day.items.length);
  // 采纳新排期后，只把「采纳之后」的会话算作这一版的完成记录：
  // 之前的提前复习不在这版排期里显示绿勾。
  // 只有用户主动「应用新排期」之后的快照才以生成时间为界；初始快照保留历史完成状态。
  result.days = visibleSnapshotDays;
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
    let sessionCounts = null;
    let sessionItems = [];
    if (session) {
      const counts = db.prepare(`SELECT COUNT(*) total,
        SUM(CASE WHEN status='completed' AND result='failed' THEN 1 ELSE 0 END) failed,
        SUM(CASE WHEN status!='completed' THEN 1 ELSE 0 END) open,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed,
        SUM(CASE WHEN status='completed' AND result='passed' THEN 1 ELSE 0 END) passed,
        SUM(CASE WHEN status='skipped' THEN 1 ELSE 0 END) skipped,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending
        FROM review_session_items WHERE session_id=? AND source_deleted=0`).get(session.id);
      sessionCounts = {
        total: counts.total,
        completed: counts.completed || 0,
        passed: counts.passed || 0,
        failed: counts.failed || 0,
        skipped: counts.skipped || 0,
        pending: counts.pending || 0,
      };
      sessionTypes = db.prepare('SELECT DISTINCT item_type FROM review_session_items WHERE session_id=? AND source_deleted=0')
        .all(session.id).map(row => row.item_type);
      sessionItems = db.prepare(`SELECT item_type,item_id,title_snapshot,status,CASE WHEN exposure_only=1 THEN 'exposure' ELSE result END AS result
        FROM review_session_items WHERE session_id=? AND source_deleted=0 ORDER BY position`).all(session.id).map(row => ({
        type: row.item_type,
        id: row.item_id,
        title: row.title_snapshot,
        status: row.status,
        result: row.result,
        minutes: 5,
      }));
    }
    const previewItems = day.items.map(item => ({ ...item, title: titleFor(item.type, item.id) }));
    const items = mergeDayItems(previewItems, sessionItems.map(item => ({
      type: item.type, id: item.id, title: item.title, status: item.status, result: item.result, minutes: item.minutes,
    })));
    if (session) {
      const passed = items.filter(item => item.status === 'completed' && item.result === 'passed').length;
      state = items.length && passed === items.length ? 'done' : passed ? 'partial' : 'none';
    }
    return {
      ...day,
      state,
      sessionId: session ? session.id : null,
      sessionStatus: session ? session.status : null,
      sessionTypes,
      sessionCounts,
      sessionItems,
      items,
    };
  });
  // 物化任务（review_plan_items）才是“实际排了、实际做了什么”的权威记录：
  // 把它合并进日历，避免“17 号任务已完成但日历没勾”的矛盾。
  const planRows = db.prepare(`SELECT item_type,item_id,scheduled_date,status,title_snapshot,estimated_minutes,source_deleted,completed_at
    FROM review_plan_items WHERE plan_id=? AND source_deleted=0 ORDER BY scheduled_date,sort_order`).all(planId);
  const planByDate = new Map();
  for (const row of planRows) {
    if (!planByDate.has(row.scheduled_date)) planByDate.set(row.scheduled_date, []);
    planByDate.get(row.scheduled_date).push(row);
  }
  const scheduledByDate = new Map(scheduledDays.map(day => [day.date, day]));
  const dates = [...new Set([...scheduledByDate.keys(), ...planByDate.keys()])].sort();
  const days = dates.map(date => {
    let materialized = planByDate.get(date);
    if (materialized && materialized.length === 0) materialized = null;
    const preview = scheduledByDate.get(date) || null;
    if (!materialized) return preview;
    const materializedItems = materialized.map(row => ({
      type: row.item_type,
      id: row.item_id,
      title: row.title_snapshot,
      sourceDeleted: row.source_deleted ? 1 : 0,
      status: row.status,
      result: row.status === 'completed' ? 'passed' : null,
      minutes: Number(row.estimated_minutes) || 5,
      roundNo: 1,
    }));
    const items = mergeDayItems(
      mergeDayItems(materializedItems, preview?.items || []),
      preview?.sessionItems || [],
    );
    const completed = items.filter(row => row.status === 'completed' && row.result === 'passed').length;
    return {
      date,
      minutes: items.reduce((sum, row) => sum + (Number(row.minutes) || 5), 0),
      items,
      state: items.length && completed === items.length ? 'done' : completed ? 'partial' : 'none',
      sessionId: preview ? preview.sessionId : null,
      sessionStatus: preview ? preview.sessionStatus : null,
      sessionTypes: preview ? preview.sessionTypes : [],
      sessionCounts: preview ? preview.sessionCounts : null,
      sessionItems: preview ? preview.sessionItems : [],
      source: 'plan',
    };
  }).filter(Boolean);
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
  const rescheduleReasons = planRescheduleReasons(plan, snapshot, items, days, today);
  result.occurrences = visibleSnapshotDays.flatMap(day => day.items.map(item => ({ ...item, date: day.date })));
  return { ...base, ...result, days, hasNewSchedule: rescheduleReasons.length > 0, rescheduleReasons };
}

// 采纳当前记忆状态算出的新排期（替换快照）。
function applyReviewPlanSchedule(courseId, planId) {
  const plan = db.prepare('SELECT * FROM review_plans WHERE id=? AND course_id=?').get(planId, courseId);
  if (!plan) planError(404, 'PLAN_NOT_FOUND', '找不到当前课程的计划');
  const current = getReviewPlanSchedule(courseId, planId);
  if (!current.hasNewSchedule) return current;
  if (planToday() < plan.exam_date) {
    const { items, states, profile, capacity } = planScheduleParts(courseId, plan);
    const live = planOccurrences({ items, states, today: planToday(), examDate: plan.exam_date, profile, capacity });
    const snapshot = planScheduleSnapshot(plan, items, live, true);
    db.prepare('UPDATE review_plans SET schedule_json=? WHERE id=?').run(JSON.stringify(snapshot), plan.id);
  }
  return getReviewPlanSchedule(courseId, planId);
}

// 计划进度按“完整排期”统计（含后续多轮），与日历显示保持一致。
function getPlanScheduleStats(courseId, planId) {
  const schedule = getReviewPlanSchedule(courseId, planId);
  let total = 0, passed = 0, failed = 0, skipped = 0, pending = 0;
  for (const day of schedule.days) {
    const items = day.items || [];
    for (const item of items) {
      if (item.sourceDeleted) continue;
      total += 1;
      if (item.status === 'completed') {
        if (item.result === 'failed') failed += 1; else if(item.result==='passed') passed += 1; else pending += 1;
      } else if (item.status === 'skipped') skipped += 1;
      else pending += 1;
    }
  }
  return { total, passed, failed, skipped, pending, completionRate: total ? Math.round(passed / total * 100) : 0 };
}

module.exports = {
  getReviewItemState, recordReviewItemGrade, recordGradeInTransaction, getReviewPlanSchedule,
  applyReviewPlanSchedule, getPlanScheduleStats,
};
