// 日期按日历计算，考试当天不排任务；不读取任何业务表或知识框架。
function planError(status, code, message) {
  throw Object.assign(new Error(message), { status, code });
}
function dateNumber(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) {
    planError(400, 'INVALID_ARGUMENT', '日期必须是 YYYY-MM-DD 格式');
  }
  const time = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0,10) !== value) {
    planError(400, 'INVALID_ARGUMENT', '日期不存在');
  }
  return time / 86400000;
}
function planDates(startDate, examDate) {
  const start = dateNumber(startDate), end = dateNumber(examDate);
  if (end <= start) planError(400, 'INVALID_ARGUMENT', '考试日期必须晚于开始日期，考试当天不安排复习');
  if (end - start > 3660) planError(400, 'INVALID_ARGUMENT', '复习计划不能超过 3660 天');
  return Array.from({length:end-start}, (_, i) => new Date((start+i)*86400000).toISOString().slice(0,10));
}
function schedulePlan(items, startDate, examDate) {
  const dates = planDates(startDate,examDate);
  const ordered = [...items].sort((a,b) => a.type.localeCompare(b.type,'en') || a.id-b.id);
  const result = [];
  let offset = 0;
  for (let day=0;day<dates.length;day++) {
    const until = Math.ceil((day+1)*ordered.length/dates.length);
    while (offset < until) {
      result.push({...ordered[offset],scheduled_date:dates[day],sort_order:offset}); offset++;
    }
  }
  return result;
}
function planToday() {
  // 与用户所在时区一致；不从 UTC ISO 字符串截取“今天”。
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
function planExcludedKeys(plan) {
  try { return new Set(JSON.parse(plan.schedule_json || '{}').excludedKeys || []); }
  catch { return new Set(); }
}
module.exports = {planError,dateNumber,planDates,schedulePlan,planToday,planExcludedKeys};
