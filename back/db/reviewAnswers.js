// Shared deterministic answer normalization; no database/model/network side effects.
function normalizeAnswer(value) {
  return String(value ?? '').toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。；：、,.!?！？；：""''（）()\[\]【】]/g, '');
}
function limitReviewGrade(grade,answerRevealed,judgedBeforeReveal=false){
  return answerRevealed&&!judgedBeforeReveal?Math.min(grade,2):grade;
}
function hasReviewAnswer(value) {
  if (typeof value === 'string') {
    if (!value.trim()) return false;
    try { const parsed=JSON.parse(value); if(parsed?.kind==='contrast-v1')return hasReviewAnswer(parsed.fields); } catch {}
    return true;
  }
  return !!value && typeof value==='object' && Object.values(value).some(v=>typeof v==='string'&&v.trim());
}
module.exports={normalizeAnswer,limitReviewGrade,hasReviewAnswer};
