// Classification is one task contract, not a generic API for future review modes.
const fields = ['question', 'student_answer', 'error_type', 'correct_answer', 'context'];
function parseInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(k => !fields.includes(k)) ||
      Object.values(body).some(v => typeof v !== 'string' || v.length > 4000)) return null;
  return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v.trim()]));
}
function hasEvidence(input) {
  return Boolean(input.question && input.student_answer && input.error_type);
}
function fallback() {
  return { review_method: 'unclassified', reason: '信息不足或分类结果不可靠，需要人工复核。', needs_review: true };
}
function normalizeResult(result, rules) {
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      !rules.categories.some(c => c.id === result.review_method) ||
      typeof result.reason !== 'string' || !result.reason.trim() || result.reason.length > 500 ||
      typeof result.needs_review !== 'boolean') return null;
  return { review_method: result.review_method, reason: result.reason.trim(), needs_review: true };
}
module.exports = { parseInput, hasEvidence, normalizeResult, fallback };
