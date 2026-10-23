// Explicit body updates only; attachments, labels, review state and history are untouched.
const {db}=require('./connection');
function saveReadingContent(kind,id,courseId,text,mode,expectedContent){
  const table=kind==='note'?'notes':kind==='material'?'materials':null;
  if(!table)throw new Error('Invalid resource kind');
  const content=mode==='append'&&expectedContent ? expectedContent+'\n\n'+text : text;
  if(content.length>1000000)throw Object.assign(new Error('正文过长，请分批整理到 100 万字符以内'),{status:400,code:'INVALID_ARGUMENT'});
  const result=db.prepare(`UPDATE ${table} SET content = ? WHERE id = ? AND course_id = ? AND COALESCE(content, '') = ?`).run(content,id,courseId,expectedContent);
  if(!result.changes)throw Object.assign(new Error('正文已在其他页面修改，请刷新已有正文、核对后再保存'),{status:409,code:'CONTENT_CONFLICT'});
  return content;
}
module.exports={saveReadingContent};
