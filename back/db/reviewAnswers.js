// Shared deterministic answer normalization; no database/model/network side effects.
function normalizeAnswer(value) {
  return String(value ?? '').toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。；：、,.!?！？；：""''（）()\[\]【】]/g, '');
}
function limitReviewGrade(grade,answerRevealed,judgedBeforeReveal=false){
  return answerRevealed&&!judgedBeforeReveal?Math.min(grade,2):grade;
}
module.exports={normalizeAnswer,limitReviewGrade};
