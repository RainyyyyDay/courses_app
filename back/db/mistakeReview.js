// 单题复习：当前步骤独立保存，最终状态只存在 mistakes.review_status。
const { db } = require('./connection');
const { getMistakeDetail } = require('./mistakes');

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
  if (mistake.mistake_type === 'unclassified') blockedReasons.push('unclassified');
  if (!mistake.answer_content.trim()) blockedReasons.push('missing_answer');
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
    answerVisible, answer: answerVisible ? { content: mistake.answer_content, explanation: mistake.explanation } : null,
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

function applyMistakeReview(id, body, startOnly = false) {
  const operation = validateOperation(body, startOnly);
  const requestJson = JSON.stringify(operation);
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
    const progress = progressFor(mistake);
    if (progress.version !== operation.expectedVersion) fail(409, 'VERSION_CONFLICT', '复习步骤已改变，请重新查询');
    const view = getMistakeReview(id);
    if (!view.reviewable) fail(422, 'REVIEW_CONFIG_INCOMPLETE', '请先完成分类，并补充题目和参考答案');
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
      const thinking = mistake.mistake_type === 'thinking';
      if (thinking ? typeof operation.mastered !== 'boolean' : typeof operation.correct !== 'boolean') {
        fail(400, 'INVALID_ARGUMENT', thinking ? '思维类判断使用 mastered' : '知识类和执行类判断使用 correct');
      }
      const positive = thinking ? operation.mastered : operation.correct;
      status = positive ? 'reviewed' : 'unreviewed';
      result = thinking ? (positive ? 'mastered' : 'needs_review') : (positive ? 'correct' : 'incorrect');
      stage = 'completed';
    }
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO mistake_review_progress (mistake_id, stage, recall, round, version, review_revision, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mistake_id) DO UPDATE SET stage=excluded.stage, recall=excluded.recall,
        round=excluded.round, version=excluded.version, review_revision=excluded.review_revision, updated_at=excluded.updated_at`)
      .run(id, stage, recall, round, progress.version + 1, mistake.review_revision, now);
    db.prepare('UPDATE mistakes SET review_status = ? WHERE id = ?').run(status, id);
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
