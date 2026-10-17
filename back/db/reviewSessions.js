// 单次复习的固定范围与执行记录。实际阅读/错题判断仍由原复习模块负责。
const {db} = require('./connection');
const {planError,dateNumber} = require('./reviewPlanSchedule');
const {reviewPlanContext,completePlanItem} = require('./reviewPlans');
const TYPES = {material:'materials',note:'notes',mistake:'mistakes'};
const SOURCES = ['plan','total',...Object.keys(TYPES)];
const LABELS = {plan:'考前计划复习',total:'总复习',material:'资料复习',note:'笔记复习',mistake:'错题复习'};
function sourceRow(type,id) {
  return Object.hasOwn(TYPES,type) ? db.prepare(`SELECT * FROM ${TYPES[type]} WHERE id=?`).get(id) : null;
}
function canReview(type,row) {
  return !!row && (type!=='mistake' || ((row.content.trim() || row.image_url || row.ocr_text.trim()) && (row.answer_content.trim() || row.answer_image_url)));
}
function sessionRow(courseId,id) {
  const row=db.prepare('SELECT * FROM review_sessions WHERE id=? AND course_id=?').get(id,courseId);
  if (!row) planError(404,'SESSION_NOT_FOUND','找不到当前课程的复习记录');
  return row;
}
function sessionItems(id) {
  return db.prepare('SELECT * FROM review_session_items WHERE session_id=? ORDER BY position').all(id).map(item=>{
    const source=sourceRow(item.item_type,item.item_id);
    return {...item,mistake_type:source?.mistake_type || null,reviewable:canReview(item.item_type,source) ? 1 : 0};
  });
}
function sessionView(row,withItems=false) {
  const items=sessionItems(row.id),counts={total:items.length,completed:0,pending:0,skipped:0};
  for (const item of items) counts[item.status]++;
  const {request_json,create_request_id,...publicRow}=row;
  return {...publicRow,...counts,progress:counts.total ? Math.round((counts.completed+counts.skipped)/counts.total*100) : 0,
    types:[...new Set(items.map(item=>item.item_type))],...(withItems ? {items} : {})};
}
function getReviewSession(courseId,id) { return sessionView(sessionRow(courseId,id),true); }
function listReviewSessions(courseId,query={}) {
  if (Object.keys(query).some(key=>!['status','sourceType','limit','offset'].includes(key)) || Object.values(query).some(v=>typeof v!=='string')) planError(400,'INVALID_ARGUMENT','复习记录筛选参数不合法');
  const where=['course_id=?'],args=[courseId];
  if (query.status && query.status!=='all') {
    if (query.status==='ongoing') where.push("status IN ('active','paused')");
    else if (['active','paused','completed'].includes(query.status)) {where.push('status=?');args.push(query.status);}
    else planError(400,'INVALID_ARGUMENT','复习记录状态不合法');
  }
  if (query.sourceType && query.sourceType!=='all') {
    if (!SOURCES.includes(query.sourceType)) planError(400,'INVALID_ARGUMENT','复习来源不合法');
    where.push('source_type=?');args.push(query.sourceType);
  }
  const number=(key,fallback,max)=>{
    if(query[key]===undefined)return fallback;
    if(!/^\d+$/.test(query[key]) || !Number.isSafeInteger(Number(query[key])) || Number(query[key])>max || (key==='limit' && Number(query[key])<1)) planError(400,'INVALID_ARGUMENT','分页参数不合法');
    return Number(query[key]);
  };
  const limit=number('limit',20,100),offset=number('offset',0,Number.MAX_SAFE_INTEGER);
  return {total:db.prepare(`SELECT count(*) n FROM review_sessions WHERE ${where.join(' AND ')}`).get(...args).n,
    results:db.prepare(`SELECT * FROM review_sessions WHERE ${where.join(' AND ')} ORDER BY (status='completed'),updated_at DESC,id DESC LIMIT ? OFFSET ?`).all(...args,limit,offset).map(row=>sessionView(row))};
}
function requestId(value) {
  if(typeof value!=='string' || !value.trim() || value.length>100) planError(400,'INVALID_ARGUMENT','requestId 须为 1～100 字符');
  return value;
}
function createReviewSession(courseId,body,repeatFrom=null) {
  if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(key=>!['requestId','sourceType','sourceId','scheduledDate','selectedItems'].includes(key))) planError(400,'INVALID_ARGUMENT','复习会话参数不合法');
  const key=requestId(body.requestId),source=body.sourceType || 'total';
  if(!SOURCES.includes(source)) planError(400,'INVALID_ARGUMENT','复习来源不合法');
  if(!Array.isArray(body.selectedItems) || !body.selectedItems.length || body.selectedItems.length>2000) planError(400,'INVALID_ARGUMENT','请选择 1～2000 项复习内容');
  const payload=JSON.stringify({sourceType:source,sourceId:body.sourceId??null,scheduledDate:body.scheduledDate??null,selectedItems:body.selectedItems,repeatFrom});
  db.exec('BEGIN');
  try {
    const prior=db.prepare('SELECT * FROM review_sessions WHERE course_id=? AND create_request_id=?').get(courseId,key);
    if(prior) {
      if(prior.request_json!==payload) planError(409,'IDEMPOTENCY_CONFLICT','同一 requestId 不能创建不同复习');
      db.exec('COMMIT');return getReviewSession(courseId,prior.id);
    }
    let plan=null;
    if(source==='plan' && repeatFrom===null) {
      if(!Number.isSafeInteger(body.sourceId) || body.sourceId<1) planError(400,'INVALID_ARGUMENT','计划 ID 不合法');
      dateNumber(body.scheduledDate);
      plan=db.prepare('SELECT * FROM review_plans WHERE id=? AND course_id=?').get(body.sourceId,courseId);
      if(!plan) planError(404,'PLAN_NOT_FOUND','找不到当前课程的计划');
      if(plan.status!=='active') planError(409,'PLAN_UNAVAILABLE','计划已归档');
    } else if(repeatFrom===null && (body.sourceId!==undefined || body.scheduledDate!==undefined)) planError(400,'INVALID_ARGUMENT','只有计划复习可指定计划来源');
    const seen=new Set();
    const selected=body.selectedItems.map(item=>{
      if(!item || !Object.hasOwn(TYPES,item.type) || !Number.isSafeInteger(item.id) || item.id<1 || Object.keys(item).some(k=>!['type','id'].includes(k))) planError(400,'INVALID_ARGUMENT','复习对象不合法');
      if(Object.hasOwn(TYPES,source) && item.type!==source) planError(400,'INVALID_ARGUMENT','模块复习不能包含其他类型');
      const compound=item.type+':'+item.id;
      if(seen.has(compound)) planError(400,'INVALID_ARGUMENT','不能重复选择同一复习对象');seen.add(compound);
      const row=sourceRow(item.type,item.id);
      if(!row || row.course_id!==courseId) planError(400,'INVALID_ARGUMENT','内容不存在或不属于当前课程');
      if(!canReview(item.type,row)) planError(422,'REVIEW_CONFIG_INCOMPLETE','错题需要先补齐题目和参考答案');
      let planItem=null;
      if(plan) {
        planItem=db.prepare("SELECT id FROM review_plan_items WHERE plan_id=? AND item_type=? AND item_id=? AND scheduled_date=? AND status='pending'").get(plan.id,item.type,item.id,body.scheduledDate);
        if(!planItem) planError(409,'PLAN_ITEM_UNAVAILABLE','内容不是该日期的待完成计划任务');
      }
      return {...item,title:row.title,planItemId:planItem?.id || null};
    });
    const now=new Date().toISOString();
    const id=Number(db.prepare('INSERT INTO review_sessions(course_id,source_type,source_id,source_date,name,create_request_id,request_json,created_at,started_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(courseId,source,plan?.id || (repeatFrom!==null ? body.sourceId??null : null),body.scheduledDate??null,plan?.name || (repeatFrom!==null ? sessionRow(courseId,repeatFrom).name : LABELS[source]),key,payload,now,now,now).lastInsertRowid);
    const insert=db.prepare('INSERT INTO review_session_items(session_id,item_type,item_id,position,title_snapshot,plan_item_id) VALUES (?,?,?,?,?,?)');
    selected.forEach((item,index)=>insert.run(id,item.type,item.id,index,item.title,item.planItemId));
    db.exec('COMMIT');return getReviewSession(courseId,id);
  } catch(err) {db.exec('ROLLBACK');throw err;}
}
function repeatReviewSession(courseId,id,body) {
  if(!body || Object.keys(body).some(key=>key!=='requestId')) planError(400,'INVALID_ARGUMENT','再次复习只接收 requestId');
  requestId(body.requestId);
  const original=sessionRow(courseId,id);
  if(original.status!=='completed') planError(409,'SESSION_NOT_COMPLETED','未完成记录请使用继续复习');
  const items=sessionItems(id),valid=items.filter(item=>!item.source_deleted && item.reviewable && sourceRow(item.item_type,item.item_id)?.course_id===courseId);
  // 相同 repeat 请求重试仍返回首次生成的范围，不随来源删除而重建队列。
  const prior=db.prepare('SELECT id,request_json FROM review_sessions WHERE course_id=? AND create_request_id=?').get(courseId,body.requestId);
  if(prior) {
    const old=JSON.parse(prior.request_json);
    if(old.repeatFrom!==id) planError(409,'IDEMPOTENCY_CONFLICT','requestId 已用于其他复习');
    return {...getReviewSession(courseId,prior.id),excluded:items.filter(item=>!valid.includes(item)).map(item=>({type:item.item_type,id:item.item_id,title:item.title_snapshot}))};
  }
  if(!valid.length) planError(422,'NO_REVIEWABLE_ITEMS','原记录中的内容已删除或无法复习，没有可再次复习的内容');
  const result=createReviewSession(courseId,{requestId:body.requestId,sourceType:original.source_type,...(original.source_id ? {sourceId:original.source_id} : {}),
    selectedItems:valid.map(item=>({type:item.item_type,id:item.item_id}))},id);
  return {...result,excluded:items.filter(item=>!valid.includes(item)).map(item=>({type:item.item_type,id:item.item_id,title:item.title_snapshot}))};
}
function reviewSessionContext(itemId,courseId,type,sourceId,planItemId=null) {
  const item=db.prepare('SELECT i.*,s.course_id,s.status AS session_status FROM review_session_items i JOIN review_sessions s ON s.id=i.session_id WHERE i.id=?').get(itemId);
  if(!item || item.course_id!==courseId || item.item_type!==type || item.item_id!==sourceId) planError(404,'SESSION_ITEM_NOT_FOUND','复习记录项目不属于当前课程或对象');
  if(planItemId!==null && item.plan_item_id!==planItemId) planError(404,'SESSION_ITEM_NOT_FOUND','计划与复习会话不匹配');
  return item;
}
function assertSessionItemWritable(item) {
  if(item.session_status==='completed' || item.status!=='pending' || item.source_deleted) planError(409,'SESSION_CLOSED','该复习项目已处理，请查看记录或开始新一轮');
}
function completeSessionItem(item,round=null,revision=null) {
  touchReviewSession(item.session_id);
  db.prepare("UPDATE review_session_items SET status='completed',completed_at=?,review_round=?,review_revision=? WHERE id=? AND status='pending'")
    .run(new Date().toISOString(),round,revision,item.id);
  advanceSessionPosition(item.session_id);
}
function touchReviewSession(id) {
  db.prepare("UPDATE review_sessions SET status='active',updated_at=? WHERE id=? AND status!='completed'").run(new Date().toISOString(),id);
}
function advanceSessionPosition(id) {
  db.prepare("UPDATE review_sessions SET current_position=COALESCE((SELECT min(position) FROM review_session_items WHERE session_id=? AND status='pending'),current_position) WHERE id=?").run(id,id);
}
function saveSessionReadingReview(sessionItemId,row,type,status,setStatus,planItemId=null) {
  db.exec('BEGIN');
  try {
    const item=reviewSessionContext(sessionItemId,row.course_id,type,row.id,planItemId);
    if(status!=='reviewed') planError(400,'INVALID_ARGUMENT','会话阅读复习只接受已复习操作');
    if(item.status==='completed') {db.exec('COMMIT');return row;} // 响应丢失重试，不再改写历史或内容。
    assertSessionItemWritable(item);
    const task=item.plan_item_id ? reviewPlanContext(item.plan_item_id,row.course_id,type,row.id) : null;
    const result=setStatus(row.id,row.course_id,status);
    if(task) completePlanItem(task);
    completeSessionItem(item);
    db.exec('COMMIT');return result;
  } catch(err) {db.exec('ROLLBACK');throw err;}
}
function changeReviewSession(courseId,id,action,body={}) {
  if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(key=>key!=='position')) planError(400,'INVALID_ARGUMENT','会话操作参数不合法');
  db.exec('BEGIN');
  try {
    const row=sessionRow(courseId,id);
    if(row.status==='completed') {
      if(action==='pause' || action==='finish') {db.exec('COMMIT');return getReviewSession(courseId,id);}
      planError(409,'SESSION_CLOSED','已完成记录不能继续，请使用再次复习');
    }
    const now=new Date().toISOString();
    if(action==='position') {
      const count=db.prepare('SELECT count(*) n FROM review_session_items WHERE session_id=?').get(id).n;
      if(!Number.isSafeInteger(body.position) || body.position<0 || body.position>=count) planError(400,'INVALID_ARGUMENT','队列位置不合法');
      db.prepare('UPDATE review_sessions SET current_position=?,updated_at=? WHERE id=?').run(body.position,now,id);
    } else if(action==='finish') {
      if(db.prepare("SELECT 1 FROM review_session_items WHERE session_id=? AND status='pending'").get(id)) planError(409,'SESSION_PENDING','仍有待处理项目，请继续或暂停');
      db.prepare("UPDATE review_sessions SET status='completed',completed_at=?,updated_at=? WHERE id=?").run(now,now,id);
    } else if(['resume','pause'].includes(action)) {
      db.prepare('UPDATE review_sessions SET status=?,updated_at=? WHERE id=?').run(action==='resume' ? 'active' : 'paused',now,id);
    } else planError(400,'INVALID_ARGUMENT','会话操作不合法');
    db.exec('COMMIT');return getReviewSession(courseId,id);
  } catch(err) {db.exec('ROLLBACK');throw err;}
}
function skipReviewSessionItem(courseId,id,itemId) {
  db.exec('BEGIN');
  try {
    const session=sessionRow(courseId,id),item=db.prepare('SELECT * FROM review_session_items WHERE id=? AND session_id=?').get(itemId,id);
    if(!item) planError(404,'SESSION_ITEM_NOT_FOUND','找不到记录中的项目');
    if(item.status==='skipped') {db.exec('COMMIT');return getReviewSession(courseId,id);}
    if(session.status==='completed' || item.status!=='pending') planError(409,'SESSION_CLOSED','已完成项目不能再跳过');
    db.prepare("UPDATE review_session_items SET status='skipped' WHERE id=? AND status='pending'").run(itemId);
    advanceSessionPosition(id);db.exec('COMMIT');return getReviewSession(courseId,id);
  } catch(err) {db.exec('ROLLBACK');throw err;}
}
function listSessionCandidates(courseId) {
  const {listMaterials}=require('./materials'),{listNotes}=require('./notes'),{listMistakes}=require('./mistakes');
  return [['material',listMaterials(courseId)],['note',listNotes(courseId)],['mistake',listMistakes(courseId)]].flatMap(([type,rows])=>rows.map(row=>({...row,type,nodes:row.nodes || row.knowledge || [],reviewable:canReview(type,row) ? 1 : 0})));
}
module.exports={listReviewSessions,getReviewSession,createReviewSession,repeatReviewSession,reviewSessionContext,assertSessionItemWritable,
  completeSessionItem,touchReviewSession,saveSessionReadingReview,changeReviewSession,skipReviewSessionItem,listSessionCandidates};
