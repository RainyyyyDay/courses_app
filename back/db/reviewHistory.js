// Read existing immutable evidence; feedback is separate and never calls the grading engine.
const {db}=require('./connection');
const {hasReviewAnswer}=require('./reviewAnswers');
const TABLES={material:'materials',note:'notes',mistake:'mistakes'};
function fail(status,message){throw Object.assign(new Error(message),{status,code:status===409?'VERSION_CONFLICT':'INVALID_ARGUMENT'});}
function scope(courseId,type,id){
  if(!Object.hasOwn(TABLES,type))fail(400,'内容类型无效');
  const row=db.prepare(`SELECT * FROM ${TABLES[type]} WHERE course_id=? AND id=?`).get(courseId,id);
  if(!row)fail(404,'找不到当前课程的内容');return row;
}
const HISTORY=`WITH native AS (
 SELECT max(id) id,round,json_extract(response_json,'$.reviewRevision') revision,min(created_at) started_at
 FROM mistake_review_events WHERE mistake_id=$id AND $type='mistake'
 GROUP BY round,json_extract(response_json,'$.reviewRevision')
), rounds AS (
 SELECT 'w:'||id history_key,'workbench' engine,id local_id,mode_id,started_at,stage,grade,duration_ms FROM review_mode_attempts
 WHERE course_id=$course AND item_type=$type AND item_id=$id
 UNION ALL
 SELECT 'n:'||n.revision||':'||n.round,'native',CAST(e.id AS TEXT),e.mode_id,
 COALESCE(json_extract(e.response_json,'$.startedAt'),n.started_at),json_extract(e.response_json,'$.stage'),
 (SELECT grade FROM review_item_events g WHERE g.course_id=$course AND g.item_type=$type AND g.item_id=$id
 AND json_extract(g.evidence_json,'$.nativeHistoryKey')='n:'||n.revision||':'||n.round ORDER BY g.id DESC LIMIT 1),
 COALESCE(json_extract(e.response_json,'$.durationMs'),0)
 FROM native n JOIN mistake_review_events e ON e.id=n.id WHERE n.round>0
 UNION ALL
 SELECT 'r:'||i.id,'reading',CAST(i.id AS TEXT),'reading',COALESCE(r.started_at,i.completed_at,s.started_at),
 CASE WHEN i.status='completed' AND i.exposure_only=1 THEN 'completed' WHEN i.status='skipped' THEN 'skipped' ELSE 'question' END,NULL,0
 FROM review_session_items i JOIN review_sessions s ON s.id=i.session_id
 LEFT JOIN review_reading_history r ON r.session_item_id=i.id
 WHERE s.course_id=$course AND i.item_type=$type AND i.item_id=$id AND $type!='mistake'
 AND (r.session_item_id IS NOT NULL OR i.exposure_only=1)
 AND NOT EXISTS(SELECT 1 FROM review_mode_attempts a WHERE a.session_item_id=i.id)
)`;
function params(courseId,type,id){return {$course:courseId,$type:type,$id:id};}
function summary(row){return {key:row.history_key,engine:row.engine,modeId:row.mode_id,startedAt:row.started_at,stage:row.stage,grade:row.grade,durationMs:row.duration_ms,feedbackCount:row.feedback_count||0};}
function listItemReviewHistory(courseId,type,id,query={}){
  scope(courseId,type,id);let at=null,key=null;
  if(query.before){try{const value=JSON.parse(Buffer.from(query.before,'base64url').toString());if(typeof value.at!=='string'||value.at.length>60||typeof value.key!=='string'||value.key.length>150)throw Error();at=value.at;key=value.key;}catch{fail(400,'历史分页参数无效');}}
  const rows=db.prepare(HISTORY+` SELECT r.*,(SELECT count(*) FROM review_ai_feedback f WHERE f.course_id=$course AND f.item_type=$type AND f.item_id=$id AND f.history_key=r.history_key) feedback_count
    FROM rounds r WHERE ($at IS NULL OR started_at<$at OR (started_at=$at AND history_key<$key)) ORDER BY started_at DESC,history_key DESC LIMIT 21`).all({...params(courseId,type,id),$at:at,$key:key});
  const more=rows.length>20;if(more)rows.pop();const last=rows.at(-1);
  return {items:rows.map(summary),next:more?Buffer.from(JSON.stringify({at:last.started_at,key:last.history_key})).toString('base64url'):null};
}
function roundDetail(courseId,type,id,key){
  scope(courseId,type,id);if(typeof key!=='string'||key.length>150)fail(400,'轮次编号无效');
  const row=db.prepare(HISTORY+' SELECT * FROM rounds WHERE history_key=$key').get({...params(courseId,type,id),$key:key});
  if(!row)fail(404,'找不到本内容的复习轮次');
  let material=null,firstAnswer=null,referenceAvailable=false,note='',responseKind=null,recall=null;
  if(row.engine==='workbench'){
    const attempt=db.prepare('SELECT * FROM review_mode_attempts WHERE id=?').get(row.local_id),visible=attempt.stage!=='question';
    material=JSON.parse(attempt.snapshot_json);delete material._sourceRevision;
    if(!visible){delete material.reference;delete material.rubric;material.blanks=material.blanks.map(b=>({id:b.id,hint:b.hint}));}
    firstAnswer=attempt.first_answer===null?null:JSON.parse(attempt.first_answer);referenceAvailable=visible;
    if(visible&&row.mode_id!=='reading'&&!hasReviewAnswer(firstAnswer)){responseKind='unanswered';note='本轮主动留空提交，按不会记录；未提交文字作答，不提供 AI 批改。';}
  }else if(row.engine==='native'){
    const event=db.prepare('SELECT response_json FROM mistake_review_events WHERE id=?').get(Number(row.local_id)),p=JSON.parse(event.response_json);
    material={prompt:p.question?.content||p.question?.ocrText||'',options:p.choice?.options||[],reference:p.answer?.content||'',rubric:p.answer?.explanation||'',correctOption:p.choice?.correctOption??null};
    firstAnswer=p.firstAnswer??null;referenceAvailable=!!p.answerVisible;
    recall=p.recall??null;
    responseKind=hasReviewAnswer(firstAnswer) ? 'written_answer' : p.mistakeType==='knowledge' && p.mode?.id==='standard' && recall ? 'memory_self_report' : p.answerRevealed ? 'unanswered' : null;
    if(!referenceAvailable){delete material.reference;delete material.rubric;delete material.correctOption;}
    if(row.stage==='completed'&&row.grade===null)note='此旧轮次未关联原评分，不推算或补造评分。';
    if(responseKind==='memory_self_report')note+=(note?' ':'')+'本轮仅记录记忆自评，未记录文字作答，不提供 AI 批改。';
    if(responseKind==='unanswered')note+=(note?' ':'')+'本轮主动留空提交，按不会记录，不提供 AI 批改。';
  }else{
    const saved=db.prepare('SELECT snapshot_json FROM review_reading_history WHERE session_item_id=?').get(Number(row.local_id));
    material=saved?JSON.parse(saved.snapshot_json):null;
    note=saved?'原文阅读只记录曝光，不评掌握度。':'旧阅读记录没有当时正文快照，不用当前正文冒充历史内容。';
  }
  return {...summary(row),material,firstAnswer,referenceAvailable,note,responseKind,recall};
}
function listFeedback(courseId,type,id,key,before){
  const cursor=before===undefined?Number.MAX_SAFE_INTEGER:Number(before);
  if(!Number.isSafeInteger(cursor)||cursor<1)fail(400,'批改分页参数无效');
  const rows=db.prepare('SELECT id,version,provider,model,payload_json,created_at FROM review_ai_feedback WHERE course_id=? AND item_type=? AND item_id=? AND history_key=? AND id<? ORDER BY id DESC LIMIT 11').all(courseId,type,id,key,cursor);
  const more=rows.length>10;if(more)rows.pop();
  return {items:rows.map(r=>({id:r.id,version:r.version,provider:r.provider,model:r.model,feedback:JSON.parse(r.payload_json),createdAt:r.created_at})),nextBeforeId:more?rows.at(-1).id:null};
}
function getItemReviewHistory(courseId,type,id,key,before){return {...roundDetail(courseId,type,id,key),feedback:listFeedback(courseId,type,id,key,before)};}
function validateFeedback(raw,answer){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['judgment','needs_review','summary','reference_answer','reference_check','errors','steps','suggestions'].includes(k)))fail(400,'批改字段无效');
  if(!['correct','partial','incorrect','uncertain'].includes(raw.judgment)||raw.needs_review!==true)fail(400,'批改判断无效');
  const result={judgment:raw.judgment,needs_review:true};
  for(const [k,max]of [['summary',1000],['reference_answer',2000],['reference_check',600]]){
    if(typeof raw[k]!=='string'||raw[k].length>max||(k==='summary'&&!raw[k].trim()))fail(400,'批改内容过长或缺失');result[k]=raw[k];
  }
  for(const k of ['steps','suggestions']){if(!Array.isArray(raw[k])||raw[k].length>6||raw[k].some(v=>typeof v!=='string'||!v.trim()||v.length>600))fail(400,'批改列表无效');result[k]=raw[k];}
  if(!Array.isArray(raw.errors)||raw.errors.length>6)fail(400,'批改错误列表无效');
  result.errors=raw.errors.map(e=>{
    if(!e||Object.keys(e).some(k=>!['quote','explanation','correction'].includes(k))||['quote','explanation','correction'].some(k=>typeof e[k]!=='string'||e[k].length>600)||(e.quote&&!answer.includes(e.quote))||!e.explanation.trim()||!e.correction.trim())fail(400,'错误引用不属于本轮首次作答');
    return {quote:e.quote,explanation:e.explanation,correction:e.correction};
  });return result;
}
function saveItemReviewFeedback(courseId,type,id,key,body){
  const round=roundDetail(courseId,type,id,key);
  if(!body||Object.keys(body).some(k=>!['requestId','provider','model','feedback'].includes(k))||typeof body.requestId!=='string'||!body.requestId.trim()||body.requestId.length>100)fail(400,'保存批改参数无效');
  if(round.modeId==='reading'||!hasReviewAnswer(round.firstAnswer)||!round.referenceAvailable)fail(409,'本轮没有实际作答或属于阅读记录，不提供 AI 批改');
  if(!['mock','deepseek','compatible'].includes(body.provider)||(body.provider==='mock'?body.model!=='':body.provider==='compatible'?(typeof body.model!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(body.model)):!['deepseek-flash','deepseek-v4-pro'].includes(body.model)))fail(400,'批改来源或模型无效');
  const answer=typeof round.firstAnswer==='string'?round.firstAnswer:JSON.stringify(round.firstAnswer),feedback=validateFeedback(body.feedback,answer),payload=JSON.stringify(feedback);
  db.exec('BEGIN');try{
    const old=db.prepare('SELECT * FROM review_ai_feedback WHERE course_id=? AND item_type=? AND item_id=? AND history_key=? AND request_id=?').get(courseId,type,id,key,body.requestId);
    if(old){if(old.payload_json!==payload||old.provider!==body.provider||old.model!==body.model)fail(409,'同一保存编号不能用于不同批改');db.exec('COMMIT');return {saved:true,id:old.id,version:old.version};}
    const version=db.prepare('SELECT count(*) n FROM review_ai_feedback WHERE course_id=? AND item_type=? AND item_id=? AND history_key=?').get(courseId,type,id,key).n+1;
    const added=db.prepare('INSERT INTO review_ai_feedback(course_id,item_type,item_id,history_key,request_id,version,provider,model,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(courseId,type,id,key,body.requestId,version,body.provider,body.model,payload,new Date().toISOString());
    db.exec('COMMIT');return {saved:true,id:Number(added.lastInsertRowid),version};
  }catch(err){db.exec('ROLLBACK');throw err;}
}
function startReadingHistory(courseId,type,id,body){
  const row=scope(courseId,type,id);
  if(type==='mistake'||!body||Object.keys(body).some(k=>k!=='sessionItemId')||!Number.isSafeInteger(body.sessionItemId)||body.sessionItemId<1)fail(400,'阅读上下文无效');
  const item=require('./reviewSessions').reviewSessionContext(body.sessionItemId,courseId,type,id,null);
  const old=db.prepare('SELECT 1 FROM review_reading_history WHERE session_item_id=?').get(item.id);
  if(old)return {saved:true};
  require('./reviewSessions').assertSessionItemWritable(item);
  db.prepare('INSERT INTO review_reading_history VALUES(?,?,?)').run(item.id,JSON.stringify({prompt:row.content||'',fileUrl:row.file_url||'',title:row.title||''}),new Date().toISOString());
  return {saved:true};
}
module.exports={listItemReviewHistory,getItemReviewHistory,saveItemReviewFeedback,startReadingHistory};
