// 单题复习：当前步骤独立保存，最终状态只存在 mistakes.review_status。
const { db } = require('./connection');
const { getMistakeDetail } = require('./mistakes');
const { reviewPlanContext, completePlanItem } = require('./reviewPlans');
const {reviewSessionContext,assertSessionItemWritable,completeSessionItem,touchReviewSession} = require('./reviewSessions');
const {recordGradeInTransaction} = require('./reviewItems');
const { choiceIsUsable, normalizeOptions, resolveMistakeMode, correctOptionIds } = require('./reviewModes');

function fail(status, code, message) {
  throw Object.assign(new Error(message), { status, code });
}

function progressFor(mistake) {
  return db.prepare('SELECT * FROM mistake_review_progress WHERE mistake_id = ?').get(mistake.id)
    || { stage: 'idle', recall: null, round: 0, version: 0, review_revision: mistake.review_revision,
      selected_option: null, choice_correct: null, updated_at: null };
}

function getMistakeReview(id) {
  const mistake = getMistakeDetail(id);
  const progress = progressFor(mistake);
  const mode = resolveMistakeMode(mistake);
  const isChoice = mode.id === 'choice_reproduction';
  const hasChoiceAnswer = mistake.question_format === 'choice' && !!mistake.correct_option;
  const blockedReasons = [];
  // 答案可以是文字，也可以是一个附件；两者都没有才拦。
  if (isChoice) {
    if (!choiceIsUsable(mistake)) blockedReasons.push('missing_choice_options');
  } else if (!mistake.answer_content.trim() && !mistake.answer_image_url && !hasChoiceAnswer) {
    blockedReasons.push('missing_answer');
  }
  if (!mistake.content.trim() && !mistake.image_url && !mistake.ocr_text.trim()) blockedReasons.push('missing_question');
  const completed = progress.stage === 'completed';
  const answerVisible = isChoice ? completed : ['answer', 'completed'].includes(progress.stage);
  let allowedActions = [];
  if (!blockedReasons.length) {
    if (isChoice) {
      if (['idle', 'completed'].includes(progress.stage)) allowedActions = ['start'];
      else if (progress.stage === 'question') allowedActions = ['choose'];
    } else if (['idle', 'completed'].includes(progress.stage)) allowedActions = ['start'];
    else if (progress.stage === 'question') allowedActions = [mistake.mistake_type === 'knowledge' ? 'recall' : 'reveal_answer'];
    else if (progress.stage === 'answer') allowedActions = ['judge'];
  }
  const choiceType = mistake.choice_type === 'multiple' ? 'multiple' : 'single';
  if(!blockedReasons.length && ['question','answer'].includes(progress.stage))allowedActions.push('restart');
  const correctIds = correctOptionIds(choiceType, mistake.correct_option);
  const selectedRaw = progress.selected_option || null;
  const selectedOption = choiceType === 'multiple'
    ? (selectedRaw ? correctOptionIds('multiple', selectedRaw) : null)
    : selectedRaw;
  const choice = isChoice ? {
    type: choiceType,
    options: normalizeOptions(mistake.options_json),
    selectedOption,
    correct: progress.choice_correct === 1 ? true : progress.choice_correct === 0 ? false : null,
    ...(completed ? { correctOption: choiceType === 'multiple' ? correctIds : correctIds[0] } : {}),
  } : null;
  const answerContent = mistake.answer_content
    || (!isChoice && hasChoiceAnswer ? `正确答案：${mistake.correct_option}` : '');
  return {
    mistakeId: id, courseId: mistake.course_id, mistakeType: mistake.mistake_type,
    reviewStatus: mistake.review_status, reviewRevision: mistake.review_revision,
    stage: progress.stage, recall: progress.recall, round: progress.round, version: progress.version,
    firstAnswer: progress.first_answer ?? null, answerRevealed: !!progress.answer_revealed,
    responseKind: progress.first_answer?.trim() ? 'written_answer'
      : mistake.mistake_type === 'knowledge' && mode.id === 'standard' && progress.recall ? 'memory_self_report'
      : progress.answer_revealed ? 'unanswered' : null,
    startedAt: progress.started_at || null,
    durationMs:progress.duration_ms || 0,
    updatedAt: progress.updated_at,
    mode: { id: mode.id, name: mode.name, description: mode.description, source: mode.source,
      availableModes: mode.availableModes.map(({ id, name, description }) => ({ id, name, description })) },
    choice,
    question: { title: mistake.title, content: mistake.content, ocrText: mistake.ocr_text,
      fileUrl: mistake.image_url, fileType: mistake.file_type, format: mistake.question_format || 'open' },
    answerVisible, answer: answerVisible ? { content: answerContent, explanation: mistake.explanation,
      fileUrl: mistake.answer_image_url, fileType: mistake.answer_file_type } : null,
    reviewable: !blockedReasons.length, blockedReasons, allowedActions,
  };
}

// 白名单 + 严格类型：避免 truthy 字符串把 false 当作 true，也拒绝混用不同类型的判断。
function validateOperation(body, startOnly = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'INVALID_ARGUMENT', '请求必须是 JSON 对象');
  const actions = startOnly ? ['start','restart'] : ['recall', 'reveal_answer', 'judge', 'choose','restart'];
  if (!actions.includes(body.action)) fail(400, 'INVALID_ARGUMENT', 'action 不合法');
  if (typeof body.requestId !== 'string' || !body.requestId.trim() || body.requestId.length > 100) {
    fail(400, 'INVALID_ARGUMENT', 'requestId 必须是 1 到 100 字符的非空字符串');
  }
  if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) fail(400, 'INVALID_ARGUMENT', 'expectedVersion 必须是非负整数');
  const allowed = ['action', 'requestId', 'expectedVersion'];
  if (['recall','reveal_answer'].includes(body.action)) {
    allowed.push('firstAnswer');
    if (body.action === 'recall') {
      if (body.firstAnswer !== undefined && (typeof body.firstAnswer !== 'string' || body.firstAnswer.length > 12000)) {
        fail(400, 'INVALID_ARGUMENT', '选填的回忆内容必须是最多 12000 字符的文字');
      }
    } else if (body.firstAnswer !== undefined && (typeof body.firstAnswer !== 'string' || body.firstAnswer.length>12000)) {
      fail(400,'INVALID_ARGUMENT','首次作答必须是最多 12000 字符的文字；留空提交按不会记录');
    }
  }
  if (body.durationMs !== undefined) {
    allowed.push('durationMs');
    if (!Number.isInteger(body.durationMs) || body.durationMs < 0 || body.durationMs > 86400000) {
      fail(400, 'INVALID_ARGUMENT', 'durationMs 必须是 0 到 86400000 的整数');
    }
  }
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
  if (body.action === 'choose') {
    allowed.push('selectedOption');
    const selected = body.selectedOption;
    const validString = typeof selected === 'string' && selected.length <= 20;
    const validArray = Array.isArray(selected) && selected.length <= 26
      && selected.every(value => typeof value === 'string' && !!value.trim() && value.length <= 20)
      && new Set(selected.map(value => value.trim())).size === selected.length;
    if (!validString && !validArray) fail(400, 'INVALID_ARGUMENT', 'selectedOption 必须是选项字符串或选项字符串数组');
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
    const mode = resolveMistakeMode(mistake);
    const isChoice = mode.id === 'choice_reproduction';
    let stage = progress.stage;
    let recall = progress.recall;
    let round = progress.round;
    let status = mistake.review_status;
    let result = null;
    let selectedOption = progress.selected_option || null;
    let choiceCorrect = progress.choice_correct;
    let firstAnswer=progress.first_answer || null, answerRevealed=!!progress.answer_revealed;
    let startedAt=progress.started_at || null;
    if (operation.action === 'start' || operation.action==='restart') {
      firstAnswer=null;answerRevealed=false;startedAt=new Date().toISOString();
      stage = 'question'; recall = null; round += 1; selectedOption = null; choiceCorrect = null;
    } else if (operation.action === 'choose') {
      if (!isChoice) fail(409, 'INVALID_REVIEW_STEP', '当前不是选择题复现模式');
      const options = normalizeOptions(mistake.options_json);
      const choiceType = mistake.choice_type === 'multiple' ? 'multiple' : 'single';
      const correctIds = correctOptionIds(choiceType, mistake.correct_option);
      let selectedIds;
      if (choiceType === 'single') {
        if (typeof operation.selectedOption !== 'string') fail(400, 'INVALID_ARGUMENT', '单选题只能选择一个选项');
        selectedIds = [operation.selectedOption.trim()];
      } else {
        if (!Array.isArray(operation.selectedOption)) fail(400, 'INVALID_ARGUMENT', '多选题需要提交选项数组');
        selectedIds = [...new Set(operation.selectedOption.map(value => value.trim()).filter(Boolean))];
      }
      selectedIds=selectedIds.filter(Boolean);
      if (selectedIds.some(id => !options.some(option => option.id === id))) {
        fail(400, 'INVALID_ARGUMENT', 'selectedOption 不属于当前题目的选项');
      }
      choiceCorrect = selectedIds.length === correctIds.length && selectedIds.every(id => correctIds.includes(id)) ? 1 : 0;
      selectedOption = choiceType === 'single' ? (selectedIds[0]??null) : JSON.stringify(selectedIds);
      firstAnswer=selectedIds.length ? selectedOption : '';
      answerRevealed=true; // Correct answer is returned only after this objective submission is scored.
      status = choiceCorrect ? 'reviewed' : 'unreviewed';
      result = choiceCorrect ? 'correct' : 'incorrect';
      stage = 'completed';
    } else if (operation.action === 'recall') {
      if (mistake.mistake_type !== 'knowledge' || mode.id !== 'standard') fail(409, 'INVALID_REVIEW_STEP', '当前模式不使用记忆自评');
      firstAnswer=operation.firstAnswer?.trim() ? operation.firstAnswer : null;answerRevealed=true;
      recall = operation.recall;
      // 清楚/模糊/不记得都先展示答案；最终只有明确判断正确或已掌握才算通过。
      stage = 'answer';
    } else if (operation.action === 'reveal_answer') {
      firstAnswer=operation.firstAnswer?.trim() ? operation.firstAnswer : '';answerRevealed=true;
      stage = firstAnswer ? 'answer' : 'completed';
      if(!firstAnswer){status='unreviewed';result=['thinking','unclassified'].includes(mistake.mistake_type)?'needs_review':'incorrect';}
    } else {
      if (isChoice) fail(409, 'INVALID_REVIEW_STEP', '选择题复现请直接提交选项');
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
      // 只有通过（判断为已复习）才算完成当天任务；答错 / 不记得保留待完成，等重试或重新排期。
      if (stage === 'completed' && status === 'reviewed') completePlanItem(planItem);
    }
    if(sessionItem) {
      touchReviewSession(sessionItem.session_id);
      db.prepare('UPDATE review_session_items SET review_round=?,review_revision=? WHERE id=?').run(round,mistake.review_revision,sessionItem.id);
      if(stage==='completed') completeSessionItem(sessionItem,round,mistake.review_revision,status==='reviewed' ? 'passed' : 'failed');
    }
    const now = new Date().toISOString();
    const durationMs=['start','restart'].includes(operation.action)?0:(operation.durationMs || Math.max(1,Math.min(86400000,Date.now()-Date.parse(startedAt || now))));
    db.prepare(`INSERT INTO mistake_review_progress
      (mistake_id, stage, recall, round, version, review_revision, selected_option, choice_correct, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mistake_id) DO UPDATE SET stage=excluded.stage, recall=excluded.recall,
        round=excluded.round, version=excluded.version, review_revision=excluded.review_revision,
        selected_option=excluded.selected_option, choice_correct=excluded.choice_correct,
        updated_at=excluded.updated_at`)
      .run(id, stage, recall, round, progress.version + 1, mistake.review_revision, selectedOption, choiceCorrect, now);
    if (db.prepare('PRAGMA table_info(mistake_review_progress)').all().some(c=>c.name==='first_answer')) {
      db.prepare('UPDATE mistake_review_progress SET first_answer=?,answer_revealed=?,started_at=?,duration_ms=? WHERE mistake_id=?')
        .run(firstAnswer,answerRevealed?1:0,startedAt,durationMs,id);
    }
    db.prepare('UPDATE mistakes SET review_status = ? WHERE id = ?').run(status, id);
    // 把这次判断折算成 4 档评分，交给备考总复习的排期引擎。
    // 知识类的「清楚/模糊」区分 Good / Hard；答错或不记得记 Again。
    if (stage === 'completed') {
      recordGradeInTransaction({
        courseId: mistake.course_id,
        type: 'mistake',
        id,
        grade: status === 'reviewed' ? (!isChoice && (answerRevealed || recall === 'vague') ? 2 : 3) : 1,
        sessionId: sessionItem ? sessionItem.session_id : null,
        sessionItemId,
        mistakeType: mistake.mistake_type,
        modeId: mode.id,
        durationMs,
        firstAnswer,answerRevealed,
        evidence:{judgedBeforeReveal:isChoice&&!!firstAnswer?.trim(),nativeHistoryKey:`n:${mistake.review_revision}:${round}`,
          ...(firstAnswer===''?{unanswered:true}:{}),
          ...(mistake.mistake_type === 'knowledge' && mode.id === 'standard'
            ? {responseKind:firstAnswer ? 'written_answer' : 'memory_self_report',recall} : {})},
      });
    }
    const response = getMistakeReview(id);
    db.prepare(`INSERT INTO mistake_review_events
      (mistake_id, request_id, request_json, action, round, mistake_type, recall, result,
       from_status, to_status, response_json, created_at, mode_id, selected_option)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, operation.requestId, requestJson, operation.action, round, mistake.mistake_type,
        recall, result, mistake.review_status, status, JSON.stringify(response), now, mode.id, selectedOption);
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
