// 单题复习：当前步骤独立保存，最终状态只存在 mistakes.review_status。
const { db } = require('./connection');
const { getMistakeDetail } = require('./mistakes');
const { reviewPlanContext, completePlanItem } = require('./reviewPlans');
const {reviewSessionContext,assertSessionItemWritable,completeSessionItem,touchReviewSession} = require('./reviewSessions');
const {recordGradeInTransaction} = require('./reviewItems');

function fail(status, code, message) {
  throw Object.assign(new Error(message), { status, code });
}

function progressFor(mistake) {
  return db.prepare('SELECT * FROM mistake_review_progress WHERE mistake_id = ?').get(mistake.id)
    || { stage: 'idle', recall: null, round: 0, version: 0, review_revision: mistake.review_revision, updated_at: null };
}

function getMistakeReview(id) {
  const mistake = getMistakeDetail(id);
  const progress = progressFor(mistake);
  const blockedReasons = [];
  // 答案可以是文字，也可以是一个附件；两者都没有才拦。
  if (!mistake.answer_content.trim() && !mistake.answer_image_url) blockedReasons.push('missing_answer');
  if (!mistake.content.trim() && !mistake.image_url && !mistake.ocr_text.trim()) blockedReasons.push('missing_question');
  const answerVisible = ['answer', 'completed'].includes(progress.stage);
  let allowedActions = [];
  if (!blockedReasons.length) {
    if (['idle', 'completed'].includes(progress.stage)) allowedActions = ['start'];
    else if (progress.stage === 'question') allowedActions = [mistake.mistake_type === 'knowledge' ? 'recall' : 'reveal_answer'];
    else if (progress.stage === 'answer') allowedActions = ['judge'];
  }
  return {
    mistakeId: id, courseId: mistake.course_id, mistakeType: mistake.mistake_type,
    reviewStatus: mistake.review_status, reviewRevision: mistake.review_revision,
    stage: progress.stage, recall: progress.recall, round: progress.round, version: progress.version,
    updatedAt: progress.updated_at,
    question: { title: mistake.title, content: mistake.content, ocrText: mistake.ocr_text,
      fileUrl: mistake.image_url, fileType: mistake.file_type },
    answerVisible, answer: answerVisible ? { content: mistake.answer_content, explanation: mistake.explanation,
      fileUrl: mistake.answer_image_url, fileType: mistake.answer_file_type } : null,
    reviewable: !blockedReasons.length, blockedReasons, allowedActions,
  };
}

// 白名单 + 严格类型：避免 truthy 字符串把 false 当作 true，也拒绝混用不同类型的判断。
function validateOperation(body, startOnly = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'INVALID_ARGUMENT', '请求必须是 JSON 对象');
  const actions = startOnly ? ['start'] : ['recall', 'reveal_answer', 'judge'];
  if (!actions.includes(body.action)) fail(400, 'INVALID_ARGUMENT', 'action 不合法');
  if (typeof body.requestId !== 'string' || !body.requestId.trim() || body.requestId.length > 100) {
    fail(400, 'INVALID_ARGUMENT', 'requestId 必须是 1 到 100 字符的非空字符串');
  }
  if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) fail(400, 'INVALID_ARGUMENT', 'expectedVersion 必须是非负整数');
  const allowed = ['action', 'requestId', 'expectedVersion'];
  if (body.action === 'recall') {
    allowed.push('recall');
    if (!['clear', 'vague', 'forgotten'].includes(body.recall)) fail(400, 'INVALID_ARGUMENT', 'recall 只能是 clear、vague 或 forgotten');
  }
  if (body.action === 'judge') {
    allowed.push('correct', 'mastered');
    if ((typeof body.correct === 'boolean') === (typeof body.mastered === 'boolean')) {
      fail(400, 'INVALID_ARGUMENT', '判断必须且只能提供一个布尔字段 correct 或 mastered');
    }
  }
  if (Object.keys(body).some(key => !allowed.includes(key))) fail(400, 'INVALID_ARGUMENT', '存在不支持的复习参数');
  // 同一判断请求不能夹带另一种判断的非布尔值。
  if (body.action === 'judge' && ['correct', 'mastered'].some(key => key in body && typeof body[key] !== 'boolean')) {
    fail(400, 'INVALID_ARGUMENT', '判断字段必须是布尔值');
  }
  return Object.fromEntries(Object.keys(body).sort().map(key => [key, body[key]]));
}

function applyMistakeReview(id, body, startOnly = false, planItemId = null, sessionItemId = null) {
  const operation = validateOperation(body, startOnly);
  const requestJson = JSON.stringify(sessionItemId !== null ? {operation,planItemId,sessionItemId} : planItemId === null ? operation : {operation,planItemId});
  db.exec('BEGIN');
  try {
    const prior = db.prepare('SELECT request_json, response_json FROM mistake_review_events WHERE mistake_id = ? AND request_id = ?')
      .get(id, operation.requestId);
    if (prior) {
      if (prior.request_json !== requestJson) fail(409, 'IDEMPOTENCY_CONFLICT', '同一 requestId 不能用于不同请求');
      db.exec('COMMIT');
      return JSON.parse(prior.response_json);
    }
    const mistake = getMistakeDetail(id);
    const sessionItem=sessionItemId===null ? null : reviewSessionContext(sessionItemId,mistake.course_id,'mistake',id,planItemId);
    if(sessionItem) assertSessionItemWritable(sessionItem);
    const taskId=sessionItem ? sessionItem.plan_item_id : planItemId;
    const planItem = taskId === null ? null : reviewPlanContext(taskId,mistake.course_id,'mistake',id);
    if (!sessionItem && planItem?.status === 'completed') fail(409,'PLAN_ITEM_COMPLETED','本次计划任务已完成，请返回计划');
    const progress = progressFor(mistake);
    if (progress.version !== operation.expectedVersion) fail(409, 'VERSION_CONFLICT', '复习步骤已改变，请重新查询');
    const view = getMistakeReview(id);
    if (!view.reviewable) fail(422, 'REVIEW_CONFIG_INCOMPLETE', '请先补充题目和参考答案');
    if (!view.allowedActions.includes(operation.action)) fail(409, 'INVALID_REVIEW_STEP', '当前步骤不允许此操作');
    let stage = progress.stage;
    let recall = progress.recall;
    let round = progress.round;
    let status = mistake.review_status;
    let result = null;
    if (operation.action === 'start') {
      stage = 'question'; recall = null; round += 1;
    } else if (operation.action === 'recall') {
      recall = operation.recall;
      stage = recall === 'forgotten' ? 'completed' : 'answer';
      if (recall === 'forgotten') { status = 'unreviewed'; result = 'forgotten'; }
    } else if (operation.action === 'reveal_answer') {
      stage = 'answer';
    } else {
      // 思维类与待分类共用掌握判断，其余类型仍使用正确/错误判断。
      const usesMastered = ['thinking', 'unclassified'].includes(mistake.mistake_type);
      if (usesMastered ? typeof operation.mastered !== 'boolean' : typeof operation.correct !== 'boolean') {
        fail(400, 'INVALID_ARGUMENT', usesMastered ? '思维类和待分类判断使用 mastered' : '知识类和执行类判断使用 correct');
      }
      const positive = usesMastered ? operation.mastered : operation.correct;
      status = positive ? 'reviewed' : 'unreviewed';
      result = usesMastered ? (positive ? 'mastered' : 'needs_review') : (positive ? 'correct' : 'incorrect');
      stage = 'completed';
    }
    if (planItem) {
      // 旧完成步骤不能抵扣任务；实际动作仍须经过原步骤机及 expectedVersion 校验。
      // 若其他入口推进过同题，仍由原 expectedVersion / allowedActions 校验；记录本次实际动作的轮次。
      db.prepare('UPDATE review_plan_items SET review_round=?,review_revision=? WHERE id=?').run(round,mistake.review_revision,planItem.id);
      if (stage === 'completed') completePlanItem(planItem);
    }
    if(sessionItem) {
      touchReviewSession(sessionItem.session_id);
      db.prepare('UPDATE review_session_items SET review_round=?,review_revision=? WHERE id=?').run(round,mistake.review_revision,sessionItem.id);
      if(stage==='completed') completeSessionItem(sessionItem,round,mistake.review_revision,status==='reviewed' ? 'passed' : 'failed');
    }
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO mistake_review_progress (mistake_id, stage, recall, round, version, review_revision, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mistake_id) DO UPDATE SET stage=excluded.stage, recall=excluded.recall,
        round=excluded.round, version=excluded.version, review_revision=excluded.review_revision, updated_at=excluded.updated_at`)
      .run(id, stage, recall, round, progress.version + 1, mistake.review_revision, now);
    db.prepare('UPDATE mistakes SET review_status = ? WHERE id = ?').run(status, id);
    // 把这次判断折算成 4 档评分，交给备考总复习的排期引擎。
    // 知识类的「清楚/模糊」区分 Good / Hard；答错或不记得记 Again。
    if (stage === 'completed') {
      recordGradeInTransaction({
        courseId: mistake.course_id,
        type: 'mistake',
        id,
        grade: status === 'reviewed' ? (recall === 'vague' ? 2 : 3) : 1,
        sessionId: sessionItem ? sessionItem.session_id : null,
        sessionItemId,
        mistakeType: mistake.mistake_type,
      });
    }
    const response = getMistakeReview(id);
    db.prepare(`INSERT INTO mistake_review_events
      (mistake_id, request_id, request_json, action, round, mistake_type, recall, result, from_status, to_status, response_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, operation.requestId, requestJson, operation.action, round, mistake.mistake_type,
        recall, result, mistake.review_status, status, JSON.stringify(response), now);
    db.exec('COMMIT');
    return response;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function listMistakeReviewEvents(id, beforeId, limit) {
  const events = db.prepare(`SELECT id, action, round, mistake_type, recall, result, from_status, to_status, created_at
    FROM mistake_review_events WHERE mistake_id = ? AND id < ? ORDER BY id DESC LIMIT ?`)
    .all(id, beforeId, limit + 1);
  const hasMore = events.length > limit;
  if (hasMore) events.pop();
  return { events, nextBeforeId: hasMore ? events[events.length - 1].id : null };
}

module.exports = { getMistakeReview, applyMistakeReview, listMistakeReviewEvents };
