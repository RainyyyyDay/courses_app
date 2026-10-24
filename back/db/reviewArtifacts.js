// Shared manual materials and attempts. Scheduling and session results stay in existing modules.
const {db}=require('./connection');
const {recordGradeInTransaction}=require('./reviewItems');
const {reviewSessionContext,assertSessionItemWritable,completeSessionItem}=require('./reviewSessions');
const {reviewPlanContext,completePlanItem}=require('./reviewPlans');
const {normalizeAnswer,hasReviewAnswer}=require('./reviewAnswers');
const MODES=['standard','cloze','self_explain','contrast','reading'];
const TABLES={mistake:'mistakes',material:'materials',note:'notes'};
function fail(status,message){throw Object.assign(new Error(message),{status,code:status===409?'VERSION_CONFLICT':'INVALID_ARGUMENT'});}
function source(courseId,type,id){
  if(!Object.hasOwn(TABLES,type))fail(400,'内容类型无效');
  const row=db.prepare(`SELECT * FROM ${TABLES[type]} WHERE id=? AND course_id=?`).get(id,courseId);
  if(!row)fail(404,'找不到当前课程的内容');return row;
}
function mode(value){if(!MODES.includes(value))fail(400,'此模式不使用通用材料引擎');return value;}
function text(value,name,{empty=false,max=20000}={}){
  if(typeof value!=='string'||(!empty&&!value.trim())||value.length>max)fail(400,`${name} 内容无效或过长`);return value;
}
function integer(value,name,min=0){if(!Number.isSafeInteger(value)||value<min)fail(400,`${name} 无效`);return value;}
function validateMaterial(modeId,raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail(400,'材料必须是对象');
  const value={prompt:text(raw.prompt,'题面'),reference:text(raw.reference??'','参考要点',{empty:true}),rubric:text(raw.rubric??'','核对标准',{empty:true}),blanks:[],objects:[],dimensions:[]};
  if(modeId==='cloze'){
    if(!Array.isArray(raw.blanks)||!raw.blanks.length||raw.blanks.length>20)fail(400,'请设置 1 到 20 个空位');
    const ids=new Set();value.blanks=raw.blanks.map(blank=>{
      const id=text(blank.id,'空位编号',{max:30});if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(id)||ids.has(id))fail(400,'空位编号无效或重复');ids.add(id);
      if(value.prompt.split('【'+id+'】').length!==2)fail(400,'每个空位必须在题面中恰好出现一次，如【b1】');
      if(!Array.isArray(blank.aliases)||blank.aliases.length>20)fail(400,'别名必须是最多 20 项的数组');
      const answer=text(blank.answer,'答案',{max:2000}),aliases=blank.aliases.map(v=>text(v,'别名',{max:2000}));
      if(![answer,...aliases].every(v=>normalizeAnswer(v)))fail(400,'答案或别名不能仅包含空白与标点');
      return {id,answer,aliases,hint:text(blank.hint??'','提示',{empty:true,max:2000})};
    });
    for(const [,id]of value.prompt.matchAll(/【([A-Za-z][A-Za-z0-9_]*)】/g))if(!ids.has(id))fail(400,'题面包含未设置答案的空位');
  }else if(modeId!=='reading')text(value.reference,'参考要点');
  if(modeId==='contrast'){
    for(const key of ['objects','dimensions']){
      if(!Array.isArray(raw[key])||raw[key].length<(key==='objects'?2:1)||raw[key].length>20)fail(400,'请填写至少两个对比对象及一个对比维度');
      value[key]=raw[key].map(v=>text(v,key,{max:1000}));
    }
  }
  return value;
}
function materialRow(courseId,type,id,modeId){return db.prepare('SELECT * FROM review_artifacts WHERE course_id=? AND item_type=? AND item_id=? AND mode_id=?').get(courseId,type,id,modeId);}
function getReviewMaterial(courseId,type,id,modeId,practice=false){
  source(courseId,type,id);mode(modeId);const row=materialRow(courseId,type,id,modeId);
  if(!row)return {version:0,material:null};
  const material=JSON.parse(row.payload_json);
  return {version:row.version,material:practice?{prompt:material.prompt,objects:material.objects,dimensions:material.dimensions,blanks:material.blanks.map(b=>({id:b.id,hint:b.hint}))}:material};
}
function saveReviewMaterial(courseId,type,id,modeId,body){
  source(courseId,type,id);mode(modeId);
  if(body?.confirmed!==true)fail(400,'请先确认最终复习材料');
  integer(body.expectedVersion,'材料版本');const payload=validateMaterial(modeId,body.material);
  db.exec('BEGIN');try{
    const old=materialRow(courseId,type,id,modeId);if((old?.version||0)!==body.expectedVersion)fail(409,'材料已被修改，请重新打开核对');
    db.prepare(`INSERT INTO review_artifacts VALUES(?,?,?,?,?,?,?) ON CONFLICT(course_id,item_type,item_id,mode_id)
      DO UPDATE SET version=excluded.version,payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
      .run(courseId,type,id,modeId,body.expectedVersion+1,JSON.stringify(payload),new Date().toISOString());
    db.exec('COMMIT');return getReviewMaterial(courseId,type,id,modeId);
  }catch(err){db.exec('ROLLBACK');throw err;}
}
function context(attempt){
  const item=attempt.session_item_id===null?null:reviewSessionContext(attempt.session_item_id,attempt.course_id,attempt.item_type,attempt.item_id,attempt.plan_item_id);
  if(item)assertSessionItemWritable(item);
  const planId=item?.plan_item_id??attempt.plan_item_id;
  const plan=planId===null?null:reviewPlanContext(planId,attempt.course_id,attempt.item_type,attempt.item_id);
  if(!item&&plan?.status==='completed')fail(409,'该计划项目已完成');
  return {item,plan};
}
function attemptRow(courseId,type,id,attemptId){source(courseId,type,id);const row=db.prepare('SELECT * FROM review_mode_attempts WHERE id=? AND course_id=? AND item_type=? AND item_id=?').get(attemptId,courseId,type,id);if(!row)fail(404,'找不到本内容的复习轮次');return row;}
function attemptView(row){
  const material=JSON.parse(row.snapshot_json),visible=row.stage!=='question';
  return {id:row.id,courseId:row.course_id,itemType:row.item_type,itemId:row.item_id,modeId:row.mode_id,materialVersion:row.artifact_version,
    version:row.version,stage:row.stage,startedAt:row.started_at,firstAnswer:row.first_answer===null?null:JSON.parse(row.first_answer),
    answerRevealed:!!row.answer_revealed,grade:row.grade,durationMs:row.duration_ms,
    material:{prompt:material.prompt,objects:material.objects,dimensions:material.dimensions,
      blanks:material.blanks.map(b=>visible?b:{id:b.id,hint:b.hint}),...(visible?{reference:material.reference,rubric:material.rubric}:{})},
    result:row.result_json?JSON.parse(row.result_json):null};
}
function getReviewAttempt(courseId,type,id,attemptId){return attemptView(attemptRow(courseId,type,id,attemptId));}
function startReviewAttempt(courseId,type,id,body){
  source(courseId,type,id);mode(body?.modeId);const requestId=text(body.requestId,'请求编号',{max:100});integer(body.expectedMaterialVersion,'材料版本',1);
  const sessionItemId=body.sessionItemId===undefined?null:integer(body.sessionItemId,'会话项目',1),planItemId=body.planItemId===undefined?null:integer(body.planItemId,'计划项目',1);
  db.exec('BEGIN');try{
    const prior=db.prepare('SELECT * FROM review_mode_attempts WHERE id=?').get(requestId);
    if(prior){if(prior.course_id!==courseId||prior.item_type!==type||prior.item_id!==id||prior.mode_id!==body.modeId||prior.artifact_version!==body.expectedMaterialVersion||prior.session_item_id!==sessionItemId||prior.plan_item_id!==planItemId)fail(409,'请求编号已用于其他操作');db.exec('COMMIT');return attemptView(prior);}
    const row=materialRow(courseId,type,id,body.modeId);if(!row||row.version!==body.expectedMaterialVersion)fail(409,'请先确认并保存最新材料');
    const scope={course_id:courseId,item_type:type,item_id:id,session_item_id:sessionItemId,plan_item_id:planItemId};context(scope);
    const snapshot={...JSON.parse(row.payload_json),_sourceRevision:source(courseId,type,id).review_revision??null};
    db.prepare(`INSERT INTO review_mode_attempts(id,course_id,item_type,item_id,mode_id,artifact_version,snapshot_json,started_at,session_item_id,plan_item_id)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(requestId,courseId,type,id,body.modeId,row.version,JSON.stringify(snapshot),new Date().toISOString(),sessionItemId,planItemId);
    db.exec('COMMIT');return getReviewAttempt(courseId,type,id,requestId);
  }catch(err){db.exec('ROLLBACK');throw err;}
}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
function applyReviewAttempt(courseId,type,id,attemptId,body){
  const requestId=text(body?.requestId,'请求编号',{max:100});integer(body.expectedVersion,'复习版本');
  if(Object.keys(body).some(k=>!['requestId','expectedVersion','action','answer','grade','durationMs'].includes(k)))fail(400,'不支持的作答参数');
  if(body.durationMs!==undefined)integer(body.durationMs,'耗时');
  const request=JSON.stringify(canonical(body));db.exec('BEGIN');try{
    const row=attemptRow(courseId,type,id,attemptId);
    const event=db.prepare('SELECT * FROM review_mode_events WHERE attempt_id=? AND request_id=?').get(attemptId,requestId);
    if(event){if(event.request_json!==request)fail(409,'同一请求编号不可用于不同作答');db.exec('COMMIT');return JSON.parse(event.response_json);}
    if(row.version!==body.expectedVersion||row.stage==='completed')fail(409,'复习步骤已变化，请重新加载');
    const {item,plan}=context(row),material=JSON.parse(row.snapshot_json);
    if(type==='mistake'&&material._sourceRevision!==source(courseId,type,id).review_revision)fail(409,'原错题已修改，请重新开始本轮');
    let first=row.first_answer,stage=row.stage,revealed=!!row.answer_revealed,grade=null,result=null;
    if(row.mode_id==='reading'){
      if(body.action!=='complete'||stage!=='question')fail(400,'阅读仅支持记录曝光完成');
      first=JSON.stringify(text(body.answer??'','阅读记录',{empty:true,max:12000}));stage='completed';result={exposureOnly:true};
    }else if(body.action==='submit'&&stage==='question'){
      if(row.mode_id==='cloze'){
        const rawAnswer=body.answer===undefined?{}:body.answer;
        if(!rawAnswer||typeof rawAnswer!=='object'||Array.isArray(rawAnswer)||Object.keys(rawAnswer).some(k=>!material.blanks.some(b=>b.id===k)))fail(400,'请按空位编号提交答案');
        const answer=Object.fromEntries(material.blanks.map(b=>[b.id,text(rawAnswer[b.id]===undefined?'':rawAnswer[b.id],'作答',{empty:true,max:2000})]));
        const results=material.blanks.map(b=>({id:b.id,unanswered:!answer[b.id].trim(),correct:!!answer[b.id].trim()&&[b.answer,...b.aliases].some(a=>normalizeAnswer(a)===normalizeAnswer(answer[b.id]))}));
        first=JSON.stringify(answer);grade=results.every(r=>r.correct)?3:1;stage='completed';result={results,unanswered:!hasReviewAnswer(answer),judgedBeforeReveal:hasReviewAnswer(answer)};revealed=true;
      }else{
        const answer=text(body.answer===undefined?'':body.answer,'首次作答',{empty:true,max:12000});
        first=JSON.stringify(answer);revealed=true;
        if(!hasReviewAnswer(answer)){stage='completed';grade=1;result={unanswered:true,judgedBeforeReveal:false};}
        else stage='answer';
      }
    }else if(body.action==='judge'&&stage==='answer'&&row.mode_id!=='cloze'){
      integer(body.grade,'评分',1);if(body.grade>4)fail(400,'评分只能为 1 到 4');grade=hasReviewAnswer(first===null?null:JSON.parse(first))?Math.min(body.grade,revealed?2:4):1;stage='completed';result={selfGrade:body.grade,finalGrade:grade};
    }else fail(400,'当前步骤不支持此操作');
    const duration=Math.max(1,Math.min(86400000,body.durationMs??(Date.now()-Date.parse(row.started_at))));
    if(stage==='completed'){
      const passed=grade!==null&&grade>=2;
      if(grade!==null){
        const written=recordGradeInTransaction({courseId,type,id,grade,durationMs:duration,sessionId:item?.session_id??null,sessionItemId:row.session_item_id,
          modeId:row.mode_id,mistakeType:source(courseId,type,id).mistake_type,firstAnswer:first,answerRevealed:revealed,
          evidence:{materialVersion:row.artifact_version,attemptId:row.id,result,judgedBeforeReveal:result?.judgedBeforeReveal===true}});
        if(written===null)fail(409,'本会话项目已存在评分');
        db.prepare(`UPDATE ${TABLES[type]} SET review_status=? WHERE id=?`).run(passed?'reviewed':'unreviewed',id);
      }
      if(plan&&passed)completePlanItem(plan);
      if(item){completeSessionItem(item,null,null,grade===null?null:passed?'passed':'failed');if(grade===null)db.prepare('UPDATE review_session_items SET exposure_only=1 WHERE id=?').run(item.id);}
    }
    db.prepare('UPDATE review_mode_attempts SET first_answer=?,answer_revealed=?,stage=?,version=version+1,grade=?,duration_ms=?,result_json=? WHERE id=?')
      .run(first,revealed?1:0,stage,grade,duration,result?JSON.stringify(result):null,attemptId);
    const view=getReviewAttempt(courseId,type,id,attemptId);
    db.prepare('INSERT INTO review_mode_events VALUES(?,?,?,?)').run(attemptId,requestId,request,JSON.stringify(view));
    db.exec('COMMIT');return view;
  }catch(err){db.exec('ROLLBACK');throw err;}
}
module.exports={getReviewMaterial,saveReviewMaterial,startReviewAttempt,getReviewAttempt,applyReviewAttempt};
