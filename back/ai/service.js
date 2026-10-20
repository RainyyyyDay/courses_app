/*
 * 本地 AI 门面：浏览器只访问这里，真正的模型服务由 port 决定。
 * 挖空答案保存在这个进程内，返回给浏览器的 blanks 只有 id 和提示。
 */
const crypto = require('crypto');
const { createAiPort, normalizeAnswer } = require('./port');

const port = createAiPort();
const attempts = new Map();
const ATTEMPT_TTL = 60 * 60 * 1000;
const MAX_ATTEMPTS = 500;

function invalid(message) {
  throw Object.assign(new Error(message), { status: 400, code: 'INVALID_ARGUMENT' });
}

function requiredText(value, name, max = 20000, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') invalid(`${name} 必须是字符串`);
  const text = value.trim();
  if (!allowEmpty && !text) invalid(`${name} 不能为空`);
  if (text.length > max) invalid(`${name} 不能超过 ${max} 字符`);
  return text;
}

function cleanupAttempts() {
  const now = Date.now();
  for (const [id, attempt] of attempts) {
    if (now - attempt.createdAt > ATTEMPT_TTL) attempts.delete(id);
  }
  while (attempts.size > MAX_ATTEMPTS) attempts.delete(attempts.keys().next().value);
}

async function createCloze(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('请求必须是 JSON 对象');
  const text = requiredText(body.text, 'text', 20000);
  const blankCount = body.blankCount === undefined ? 3 : Number(body.blankCount);
  if (!Number.isInteger(blankCount) || blankCount < 1 || blankCount > 20) invalid('blankCount 必须是 1 到 20 的整数');
  const result = await port.generateCloze({ text, blankCount, difficulty: body.difficulty || 'basic' });
  const blanks = Array.isArray(result?.blanks) ? result.blanks : [];
  if (!blanks.length) throw Object.assign(new Error('AI 没有生成有效空位'), { status: 502, code: 'AI_INVALID_RESULT' });
  const attemptId = crypto.randomUUID();
  attempts.set(attemptId, {
    createdAt: Date.now(),
    answers: blanks.map((blank) => ({ id: String(blank.id), answer: String(blank.answer ?? '') })),
  });
  cleanupAttempts();
  return {
    attemptId,
    clozeText: String(result.clozeText || text),
    blanks: blanks.map((blank) => ({ id: String(blank.id), hint: String(blank.hint || '') })),
    needsReview: true,
    provider: port.name,
  };
}

function evaluateCloze(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('请求必须是 JSON 对象');
  if (typeof body.attemptId !== 'string' || !body.attemptId.trim()) invalid('attemptId 不能为空');
  if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) invalid('answers 必须是对象');
  const attempt = attempts.get(body.attemptId);
  if (!attempt) throw Object.assign(new Error('挖空练习已过期，请重新生成'), { status: 404, code: 'ATTEMPT_NOT_FOUND' });
  const results = attempt.answers.map(({ id, answer }) => {
    const submitted = typeof body.answers[id] === 'string' ? body.answers[id] : '';
    return { id, correct: normalizeAnswer(submitted) === normalizeAnswer(answer) };
  });
  const correctCount = results.filter((item) => item.correct).length;
  const judgment = correctCount === results.length ? 'correct'
    : correctCount > 0 ? 'partial' : 'incorrect';
  return {
    judgment,
    results,
    coverage: results.length ? Math.round(correctCount / results.length * 1000) / 1000 : 0,
    needsReview: true,
    provider: port.name,
  };
}

async function evaluateAnswer(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('请求必须是 JSON 对象');
  const question = requiredText(body.question, 'question', 4000);
  const studentAnswer = requiredText(body.studentAnswer, 'studentAnswer', 4000);
  const referenceAnswer = body.referenceAnswer === undefined ? '' : requiredText(body.referenceAnswer, 'referenceAnswer', 4000, { allowEmpty: true });
  const rubric = body.rubric === undefined ? '' : requiredText(body.rubric, 'rubric', 4000, { allowEmpty: true });
  const result = await port.evaluateAnswer({ question, studentAnswer, referenceAnswer, rubric });
  return { ...result, provider: port.name };
}

async function recommendMode(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('请求必须是 JSON 对象');
  const itemType = body.itemType || 'note';
  if (!['material', 'note', 'mistake'].includes(itemType)) invalid('itemType 必须是 material / note / mistake');
  const text = requiredText(body.text, 'text', 20000);
  const learningGoal = body.learningGoal === undefined ? '' : requiredText(body.learningGoal, 'learningGoal', 500, { allowEmpty: true });
  const result = await port.recommendMode({ itemType, text, learningGoal });
  return { ...result, provider: port.name };
}

function health() {
  return { status: 'ok', provider: port.name, local_only: port.name === 'mock' };
}

async function createReviewDraft(body) {
  const modeId=body?.modeId;
  if(!['standard','cloze','self_explain','reading','contrast'].includes(modeId))invalid('不支持的草稿模式');
  const text=requiredText(body.text,'text',20000);
  // This demo endpoint always reuses the local deterministic provider, irrespective of env.
  const material={prompt:text,reference:modeId==='reading'?'':'Mock 演示参考要点（请人工核对）：'+text,rubric:modeId==='reading'?'':'核对是否覆盖关键概念与推理；最终档位由用户确认。',blanks:[],objects:[],dimensions:[]};
  if(modeId==='cloze'){
    const generated=await createAiPort({provider:'mock'}).generateCloze({text,blankCount:3});material.prompt=generated.clozeText;
    material.blanks=generated.blanks.map(b=>({...b,aliases:[]}));material.reference='';material.rubric='';
  }
  if(modeId==='contrast'){material.objects=['概念 A（请修改）','概念 B（请修改）'];material.dimensions=['定义','适用范围'];}
  return {provider:'mock',needsReview:true,material};
}
module.exports = { createCloze, evaluateCloze, evaluateAnswer, recommendMode, health, createReviewDraft };
