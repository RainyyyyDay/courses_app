const {db} = require('./connection');
const {planError,dateNumber,planDates,schedulePlan,planToday} = require('./reviewPlanSchedule');
const {getReviewPlanSchedule} = require('./reviewItems');
const PLAN_SOURCES = {material:'materials',note:'notes',mistake:'mistakes'};

// 迁移夹具会在 v12 旧表上建计划；旧表还没有选择题列时退回原来的答案条件。
function mistakeReviewableSql(alias = '') {
  const p = alias ? alias + '.' : '';
  const hasChoice = db.prepare('PRAGMA table_info(mistakes)').all().some(column => column.name === 'question_format');
  const answer = `trim(${p}answer_content) != '' OR ${p}answer_image_url != ''`
    + (hasChoice ? ` OR (${p}question_format = 'choice' AND ${p}correct_option != '' AND ${p}options_json != '[]')` : '');
  return `CASE WHEN (trim(${p}content) != '' OR ${p}image_url != '' OR trim(${p}ocr_text) != '') AND (${answer}) THEN 1 ELSE 0 END`;
}

function listPlanCandidates(courseId) {
  // 计划选题只读取内容本身，不联查标签、知识树或复习事件。
  return Object.entries(PLAN_SOURCES).flatMap(([type,table])=>db.prepare(`SELECT id,course_id,title,content,review_status,favorite,
    '${type}' AS type, ${type==='mistake' ? `mistake_type, ${mistakeReviewableSql()}` : "NULL AS mistake_type, 1"} AS reviewable
    FROM ${table} WHERE course_id=? ORDER BY id`).all(courseId));
}

function scopedPlan(courseId, planId) {
  const plan = db.prepare('SELECT * FROM review_plans WHERE id = ? AND course_id = ?').get(planId,courseId);
  if (!plan) planError(404,'PLAN_NOT_FOUND','找不到当前课程的复习计划');
  return plan;
}
function planCounts(items) {
  const active = items.filter(item => !item.source_deleted);
  const count = {total:active.length,completed:0,pending:0,skipped:0,deleted:items.length-active.length};
  for (const item of active) count[item.status]++;
  count.completionRate = count.total ? Math.round(count.completed/count.total*100) : 0;
  return count;
}
function scheduleCounts(days) {
  const count={total:0,completed:0,pending:0,skipped:0,passed:0,failed:0};
  for(const day of days||[]) for(const item of day.items||[]){
    if(item.sourceDeleted)continue;
    count.total++;
    if(item.status==='completed'){
      count.completed++;
      if(item.result==='passed'&&!item.exposureOnly)count.passed++;
      else if(item.result==='failed')count.failed++;
      else count.pending++;
    }else if(item.status==='skipped')count.skipped++;
    else count.pending++;
  }
  count.completionRate=count.total?Math.round(count.passed/count.total*100):0;
  return count;
}
function listPlanItems(courseId,planId,filters={}) {
  scopedPlan(courseId,planId);
  const where = ['i.plan_id = ?','i.source_deleted = 0'], args = [planId];
  if (filters.scheduledDate !== undefined) { dateNumber(filters.scheduledDate); where.push('i.scheduled_date = ?'); args.push(filters.scheduledDate); }
  if (filters.status !== undefined) {
    if (!['pending','completed','skipped'].includes(filters.status)) planError(400,'INVALID_ARGUMENT','任务状态不合法');
    where.push('i.status = ?'); args.push(filters.status);
  }
  return db.prepare(`SELECT i.*,m.mistake_type,
    CASE WHEN i.source_deleted=1 THEN 0 WHEN i.item_type!='mistake' THEN 1
      ELSE ${mistakeReviewableSql('m')} END AS reviewable
    FROM review_plan_items i LEFT JOIN mistakes m ON i.item_type='mistake' AND m.id=i.item_id
    WHERE ${where.join(' AND ')} ORDER BY i.scheduled_date,i.sort_order,i.id`).all(...args);
}
function planSummary(plan, detailed=false) {
  const items = listPlanItems(plan.course_id,plan.id), today = planToday();
  const result = {...plan,...planCounts(items),today,remainingDays:Math.max(0,dateNumber(plan.exam_date)-dateNumber(today)),
    todayStats:planCounts(items.filter(item=>item.scheduled_date===today))};
  // 进度以完整排期为准（含后续多轮），与计划详情里的日历保持一致。
  let schedule=null;
  try { schedule=getReviewPlanSchedule(plan.course_id,plan.id); result.scheduleStats=scheduleCounts(schedule.days); }
  catch { result.scheduleStats = null; }
  const todayDay=schedule?.days.find(day=>day.date===today);
  if(todayDay)result.todayStats=scheduleCounts([todayDay]);
  const sched = result.scheduleStats;
  const pending = sched && sched.total ? sched.pending : result.pending;
  result.reviewState = pending===0 ? 'completed' : plan.exam_date<=today ? 'expired' : 'active';
  if (detailed) result.days = planDates(plan.start_date,plan.exam_date).map(date=>{
    const rows = items.filter(item=>item.scheduled_date===date);
    return {date,...planCounts(rows),types:Object.fromEntries(Object.keys(PLAN_SOURCES).map(type=>[type,planCounts(rows.filter(item=>item.item_type===type))]))};
  });
  return result;
}
function listReviewPlans(courseId) {
  return db.prepare('SELECT * FROM review_plans WHERE course_id = ? ORDER BY id DESC').all(courseId).map(plan=>planSummary(plan));
}
function getReviewPlan(courseId,planId) { return planSummary(scopedPlan(courseId,planId),true); }
function planName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length>100) planError(400,'INVALID_ARGUMENT','计划名称须为 1～100 字');
  return value.trim();
}
function createReviewPlan(courseId,body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key=>!['name','startDate','examDate','selectedItems'].includes(key))) {
    planError(400,'INVALID_ARGUMENT','计划参数不合法');
  }
  const name = planName(body.name);
  planDates(body.startDate,body.examDate);
  if (!Array.isArray(body.selectedItems) || !body.selectedItems.length || body.selectedItems.length>2000) planError(400,'INVALID_ARGUMENT','请选择 1～2000 项复习内容');
  const seen = new Set();
  db.exec('BEGIN');
  try {
    const selected = body.selectedItems.map(item=>{
      if (!item || !Object.hasOwn(PLAN_SOURCES,item.type) || !Number.isSafeInteger(item.id) || item.id<1
        || Object.keys(item).some(key=>!['type','id'].includes(key))) planError(400,'INVALID_ARGUMENT','选择的内容类型或 ID 不合法');
      const key = item.type+':'+item.id;
      if (seen.has(key)) planError(400,'INVALID_ARGUMENT','同一计划不能重复选择同一内容');
      seen.add(key);
      const row = db.prepare(`SELECT id,title,course_id FROM ${PLAN_SOURCES[item.type]} WHERE id = ?`).get(item.id);
      if (!row || row.course_id !== courseId) planError(400,'INVALID_ARGUMENT','选择的内容不存在或不属于当前课程');
      return {...item,title_snapshot:row.title};
    });
    const now = new Date().toISOString();
    const id = Number(db.prepare('INSERT INTO review_plans(course_id,name,start_date,exam_date,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(courseId,name,body.startDate,body.examDate,now,now).lastInsertRowid);
    const insert = db.prepare('INSERT INTO review_plan_items(plan_id,item_type,item_id,scheduled_date,sort_order,title_snapshot) VALUES (?,?,?,?,?,?)');
    for (const item of schedulePlan(selected,body.startDate,body.examDate)) insert.run(id,item.type,item.id,item.scheduled_date,item.sort_order,item.title_snapshot);
    db.exec('COMMIT');
    return getReviewPlan(courseId,id);
  } catch(err) { db.exec('ROLLBACK'); throw err; }
}
function updateReviewPlan(courseId,planId,body) {
  scopedPlan(courseId,planId);
  if (!body || typeof body!=='object' || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(key=>!['name','status'].includes(key))) {
    planError(400,'INVALID_ARGUMENT','只允许修改计划名称和 active / archived 状态，日期及范围需重新生成计划');
  }
  const values = [], columns = [];
  if (body.name !== undefined) { columns.push('name = ?'); values.push(planName(body.name)); }
  if (body.status !== undefined) {
    if (!['active','archived'].includes(body.status)) planError(400,'INVALID_ARGUMENT','计划状态不合法');
    columns.push('status = ?'); values.push(body.status);
  }
  columns.push('updated_at = ?'); values.push(new Date().toISOString());
  db.prepare(`UPDATE review_plans SET ${columns.join(',')} WHERE id = ?`).run(...values,planId);
  return getReviewPlan(courseId,planId);
}
function deleteReviewPlan(courseId,planId) { scopedPlan(courseId,planId); db.prepare('DELETE FROM review_plans WHERE id = ?').run(planId); }

// 仅供复习写入调用，无“任意完成任务”API；归属来自数据库而非客户端 courseId。
function reviewPlanContext(planItemId,courseId,type,itemId) {
  const item = db.prepare(`SELECT i.*,p.course_id,p.status AS plan_status FROM review_plan_items i JOIN review_plans p ON p.id=i.plan_id WHERE i.id=?`).get(planItemId);
  if (!item || item.course_id!==courseId || item.item_type!==type || item.item_id!==itemId) planError(404,'PLAN_ITEM_NOT_FOUND','任务不属于当前课程或复习对象');
  if (item.plan_status!=='active' || item.status==='skipped' || item.source_deleted) planError(409,'PLAN_UNAVAILABLE','计划已归档或内容已删除，请返回计划');
  return item;
}
function completePlanItem(item) {
  db.prepare("UPDATE review_plan_items SET status='completed',completed_at=? WHERE id=? AND status='pending'").run(new Date().toISOString(),item.id);
}
function savePlanReadingReview(planItemId,row,type,status,setStatus) {
  db.exec('BEGIN');
  try {
    const item = reviewPlanContext(planItemId,row.course_id,type,row.id);
    if (status!=='reviewed') planError(400,'INVALID_ARGUMENT','计划阅读复习只接受已复习操作');
    const updated = setStatus(row.id,row.course_id,status);
    completePlanItem(item);
    db.exec('COMMIT'); return updated;
  } catch(err) { db.exec('ROLLBACK'); throw err; }
}
function savePlanRecallReview(planItemId,row,type,recall,setStatus) {
  db.exec('BEGIN');
  try {
    const item = reviewPlanContext(planItemId,row.course_id,type,row.id);
    if(!['clear','vague','forgotten'].includes(recall)) planError(400,'INVALID_ARGUMENT','回忆结果不合法');
    const updated = setStatus(row.id,row.course_id,recall==='clear'?'reviewed':'unreviewed');
    // 只有清楚回忆才算完成计划任务；模糊/不记得保留任务，之后再复习。
    if(recall==='clear') completePlanItem(item);
    db.exec('COMMIT'); return updated;
  } catch(err) { db.exec('ROLLBACK'); throw err; }
}
module.exports = {listPlanCandidates,listReviewPlans,getReviewPlan,listPlanItems,createReviewPlan,updateReviewPlan,deleteReviewPlan,
  reviewPlanContext,completePlanItem,savePlanReadingReview,savePlanRecallReview};
