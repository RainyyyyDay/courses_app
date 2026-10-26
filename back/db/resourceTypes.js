const {db}=require('./connection');
const defaults=[['笔记','#ede9fe'],['课件','#dbeafe'],['讲义','#ccfbf1'],['题集','#ffedd5'],['作业','#fce7f3']];
db.exec(`CREATE TABLE IF NOT EXISTS resource_types(id INTEGER PRIMARY KEY,course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,name TEXT NOT NULL,color TEXT NOT NULL,UNIQUE(course_id,name));
CREATE TABLE IF NOT EXISTS resource_type_links(course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,kind TEXT NOT NULL,resource_id INTEGER NOT NULL,type_id INTEGER NOT NULL REFERENCES resource_types(id) ON DELETE CASCADE,PRIMARY KEY(kind,resource_id,type_id));
CREATE TABLE IF NOT EXISTS resource_type_seed(course_id INTEGER PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE);`);
function ensure(courseId){
 if(db.prepare('SELECT 1 FROM resource_type_seed WHERE course_id=?').get(courseId))return;
 if(!db.prepare('SELECT 1 FROM courses WHERE id=?').get(courseId))throw Error('课程不存在');
 db.exec('SAVEPOINT resource_types_seed');try{
  for(const [name,color]of defaults)db.prepare('INSERT OR IGNORE INTO resource_types(course_id,name,color) VALUES(?,?,?)').run(courseId,name,color);
  const note=db.prepare("SELECT id FROM resource_types WHERE course_id=? AND name='笔记'").get(courseId);
  db.prepare("INSERT OR IGNORE INTO resource_type_links SELECT course_id,'note',id,? FROM notes WHERE course_id=?").run(note.id,courseId);
  db.prepare('INSERT INTO resource_type_seed VALUES(?)').run(courseId);db.exec('RELEASE resource_types_seed');
 }catch(e){db.exec('ROLLBACK TO resource_types_seed;RELEASE resource_types_seed');throw e;}
}
function listResourceTypes(courseId){ensure(courseId);return db.prepare('SELECT * FROM resource_types WHERE course_id=? ORDER BY id').all(courseId);}
function typesFor(row,kind){if(!row)return row;ensure(row.course_id);return {...row,resource_types:db.prepare('SELECT t.id,t.name,t.color FROM resource_types t JOIN resource_type_links l ON l.type_id=t.id WHERE l.course_id=? AND l.kind=? AND l.resource_id=? ORDER BY t.id').all(row.course_id,kind,row.id)};}
function validateTypes(courseId,ids){ensure(courseId);if(!Array.isArray(ids)||ids.length>50||ids.some(id=>!Number.isSafeInteger(id)||!db.prepare('SELECT 1 FROM resource_types WHERE id=? AND course_id=?').get(id,courseId)))throw Error('资料类型无效或不属于当前课程');return [...new Set(ids)];}
function setResourceTypes(courseId,kind,id,ids){
 ids=validateTypes(courseId,ids);const table=kind==='note'?'notes':kind==='material'?'materials':null;
 if(!table||!db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND course_id=?`).get(id,courseId))throw Error('资料不存在');
 db.prepare('DELETE FROM resource_type_links WHERE course_id=? AND kind=? AND resource_id=?').run(courseId,kind,id);
 for(const typeId of ids)db.prepare('INSERT INTO resource_type_links VALUES(?,?,?,?)').run(courseId,kind,id,typeId);
}
function typeFields(value){if(typeof value.name!=='string'||!value.name.trim()||value.name.trim().length>30||!/^#[0-9a-f]{6}$/i.test(value.color))throw Error('名称须为 1–30 字，颜色须为有效色值');return [value.name.trim(),value.color];}
function createResourceType(courseId,value){ensure(courseId);const [name,color]=typeFields(value);const result=db.prepare('INSERT INTO resource_types(course_id,name,color) VALUES(?,?,?)').run(courseId,name,color);return db.prepare('SELECT * FROM resource_types WHERE id=?').get(result.lastInsertRowid);}
function updateResourceType(courseId,id,value){const [name,color]=typeFields(value);if(!db.prepare('SELECT 1 FROM resource_types WHERE id=? AND course_id=?').get(id,courseId))throw Error('资料类型不存在');db.prepare('UPDATE resource_types SET name=?,color=? WHERE id=? AND course_id=?').run(name,color,id,courseId);}
function mergeResourceType(courseId,id,target){validateTypes(courseId,[id,target]);if(id===target)throw Error('不能合并到自身');db.prepare('INSERT OR IGNORE INTO resource_type_links SELECT course_id,kind,resource_id,? FROM resource_type_links WHERE type_id=? AND course_id=?').run(target,id,courseId);db.prepare('DELETE FROM resource_types WHERE id=? AND course_id=?').run(id,courseId);}
module.exports={listResourceTypes,typesFor,validateTypes,setResourceTypes,createResourceType,updateResourceType,mergeResourceType};
