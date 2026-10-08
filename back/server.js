// 引入需要的库
const express = require('express');
const cors = require('cors'); // 解决跨域问题（必须加！）
const multer = require('multer'); // 解决文件上传
const path = require('path');
const fs = require('fs');

// 引入数据库模块：数据落在 back/data/app.db，数据库逻辑在 db/ 模块中。
// 这里负责处理接口。
const db = require('./db/index.js');

const app = express();

// 允许跨域、允许解析 JSON 数据
app.use(cors());
app.use(express.json());

// ===== 文件上传配置 =====
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// 让上传的文件可以通过地址访问（比如 http://localhost:3000/uploads/xxx.jpg）
app.use('/uploads', express.static(uploadDir));

// ===== 错题标签（知识树节点）的解析与校验 =====

// 文件后缀不能改：标题必须始终以磁盘上那个文件的真实后缀结尾。
// 前端已经把后缀做成固定的一小块（只让改前面的名字），这里再兜一道，
// 保证不管谁调接口，都不会把 title 的后缀改掉或弄丢。
function keepFileExtension(title, fileUrl) {
  const name = String(title || '').trim();
  const ext = path.extname(String(fileUrl || ''));
  if (!name || !ext) return name;
  if (name.toLowerCase().endsWith(ext.toLowerCase())) return name;
  return name + ext;
}

// 从 multipart/form-data 的请求体里解析节点 id 数组（可以完全不传）。
// 错题用字段名 knowledgeIds，资料 / 笔记用 nodeIds，格式完全一样，所以共用一个解析函数。
// 以后前端挑一种写法即可，下面三种都支持：
//   1) JSON 数组字符串：fd.append('nodeIds', JSON.stringify([3, 7, 9]))
//   2) 逗号分隔字符串： fd.append('nodeIds', '3,7,9')
//   3) 重复同名字段：   fd.append('nodeIds', 3); fd.append('nodeIds', 7)
// 没传时返回空数组，上传接口的行为和改造前完全一致。
function parseNodeIds(raw) {
  if (raw === undefined || raw === null) return [];

  const parts = Array.isArray(raw) ? raw : [raw];
  const ids = [];

  for (const part of parts) {
    const text = String(part).trim();
    if (!text) continue;

    if (text.startsWith('[')) {
      // JSON 数组字符串，例如 "[3,7,9]"
      try {
        const arr = JSON.parse(text);
        if (Array.isArray(arr)) ids.push(...arr.map(Number));
      } catch (err) {
        ids.push(NaN); // 格式不对，交给下面的校验统一报 400
      }
    } else if (text.includes(',')) {
      // 逗号分隔字符串，例如 "3,7,9"
      ids.push(...text.split(',').map((s) => Number(s.trim())));
    } else {
      ids.push(Number(text));
    }
  }

  return [...new Set(ids)]; // 去重
}

// 校验一组标签节点 id：
//   - 必须是整数
//   - 节点必须存在
//   - 节点必须属于指定课程
//   - 节点的 type 必须是两种合法类型之一（folder / knowledge）
// 从 v3 起 folder 也能作为错题标签，所以这里不再限制“只能是 knowledge”。
// 全部通过返回 null；有问题就返回一句可以直接回给前端的中文提示。
function checkNodeIds(courseId, ids) {
  for (const id of ids) {
    if (!Number.isInteger(id)) return `标签节点 id 不合法：${id}`;

    const node = db.findKnowledgeNode(id);
    if (!node) return `找不到 id 为 ${id} 的标签节点`;
    if (node.course_id !== courseId) return `节点 ${id} 不属于同一门课程`;
    // “未分类”是自动收纳桶，不是标签：资源不勾任何标签就会出现在它下面
    if (node.is_system) return '「未分类」不是可选标签，不用勾选它';
    if (node.type !== 'folder' && node.type !== 'knowledge') {
      return `节点 ${id} 的类型不合法，不能作为错题标签`;
    }
  }
  return null;
}

// ===== 课程数据已迁移到 SQLite =====
// 原来写死在内存里的 courses / materials / notes / assessments / mistakes，
// 现在统一存在 back/data/app.db 里（建表和增删改查见 db/），重启服务器不会丢。
// 初始的两门课程只在数据库第一次创建时写入一次，之后启动不会重复插入。

// ==================== 课程接口 ====================

// 1. 获取课程列表（支持置顶排序）
app.get('/api/courses', (req, res) => {
  // 置顶的排前面，然后按创建时间倒序（具体排序规则写在 db.js 里）
  res.json(db.listCourses());
});

// 2. 添加课程
app.post('/api/courses', (req, res) => {
  const body = req.body;
  if (!body.name) return res.status(400).json({ message: '课程名不能为空' });

  const newCourse = db.createCourse(body.name);
  res.status(201).json(newCourse);
});

// 3. 修改课程名
app.put('/api/courses/:id', (req, res) => {
  const id = Number(req.params.id);
  const course = db.findCourse(id);
  if (!course) return res.status(404).json({ message: '找不到课程' });

  // 传了 name 才改，没传就原样返回（和原来的行为一致）
  if (req.body.name) return res.json(db.updateCourseName(id, req.body.name));
  res.json(course);
});

// 4. 删除课程
app.delete('/api/courses/:id', (req, res) => {
  const id = Number(req.params.id);
  const course = db.findCourse(id);
  if (!course) return res.status(404).json({ message: '找不到课程' });

  // 属于这门课的资料 / 笔记 / 考核 / 错题，会由数据库外键级联一起清理
  db.deleteCourse(id);
  res.json({ success: true });
});

// 5. 置顶/取消置顶
app.put('/api/courses/:id/pin', (req, res) => {
  const id = Number(req.params.id);
  const course = db.findCourse(id);
  if (!course) return res.status(404).json({ message: '找不到课程' });

  db.setCoursePinned(id, req.body.pinned);
  res.json({ success: true });
});

// ==================== 资料接口 ====================

app.get('/api/courses/:id/materials', (req, res) => {
  const courseId = Number(req.params.id);
  res.json(db.listMaterials(courseId));
});

// 两种录入方式二选一：
//   1) 上传文件（multipart 里带 file 字段）
//   2) 手动输入（multipart 里带 title / content 字段）
// 上传文件时如果也带了 title，就用 title 当名称（用户在上传前改过名字）；
// 没带就用原始文件名，行为和以前完全一致。
app.post('/api/courses/:id/materials', upload.single('file'), (req, res) => {
  const courseId = Number(req.params.id);
  const body = req.body || {};

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const content = typeof body.content === 'string' ? body.content : '';

  if (!req.file && !title) {
    return res.status(400).json({ message: '请上传文件，或者填写标题' });
  }

  // 可选：录入的同时打标签。不传就是空数组，行为和以前完全一致。
  const nodeIds = parseNodeIds(body.nodeIds);
  if (nodeIds.length > 0) {
    const bad = checkNodeIds(courseId, nodeIds);
    if (bad) {
      // 标签不合法，这条资料不会入库，顺手删掉刚上传的文件，避免留下垃圾
      if (req.file) fs.rm(path.join(uploadDir, req.file.filename), { force: true }, () => {});
      return res.status(400).json({ message: bad });
    }
  }

  // 名称：用户改过就用改后的（后缀跟着文件补齐），没改就用原始文件名
  const finalTitle = title
    ? keepFileExtension(title, req.file ? req.file.originalname : '')
    : (req.file ? req.file.originalname : '');

  const newItem = db.createMaterial(
    courseId,
    finalTitle,
    req.file ? '/uploads/' + req.file.filename : '',
    req.file ? req.file.mimetype : '',
    nodeIds,
    content
  );
  res.status(201).json(newItem);
});

app.delete('/api/materials/:id', (req, res) => {
  db.deleteMaterial(Number(req.params.id));
  res.json({ success: true });
});

// 单条资料（含标签节点）：给资源详情页用，可按 id 独立重新加载
app.get('/api/materials/:id', (req, res) => {
  const id = Number(req.params.id);
  const material = db.findMaterial(id);
  if (!material) return res.status(404).json({ message: '找不到资料' });

  res.json({ ...material, nodes: db.listMaterialNodes(id) });
});

// 编辑一条资料：可选改名（title）+ 完整替换标签节点
// （标签是“替换”不是“追加”；文件夹和知识点都能当标签）
app.put('/api/materials/:id/nodes', (req, res) => {
  const id = Number(req.params.id);
  const material = db.findMaterial(id);
  if (!material) return res.status(404).json({ message: '找不到资料' });

  const body = req.body || {};
  const raw = body.nodeIds;
  if (!Array.isArray(raw)) {
    return res.status(400).json({ message: 'nodeIds 必须是数组' });
  }

  const nodeIds = [...new Set(raw.map(Number))]; // 去重
  const bad = checkNodeIds(material.course_id, nodeIds);
  if (bad) return res.status(400).json({ message: bad });

  // 可选：同时改名。后缀跟着文件走，改不掉也丢不了。
  let title = material.title;
  if (typeof body.title === 'string' && body.title.trim()) {
    title = keepFileExtension(body.title, material.file_url);
  }

  const nodes = db.replaceMaterialNodes(id, nodeIds, title);
  res.json({ success: true, nodes, title });
});

// ==================== 笔记接口 ====================

app.get('/api/courses/:id/notes', (req, res) => {
  const courseId = Number(req.params.id);
  res.json(db.listNotes(courseId));
});

// 同样支持“上传文件”和“手动输入”两种方式
app.post('/api/courses/:id/notes', upload.single('file'), (req, res) => {
  const courseId = Number(req.params.id);
  const body = req.body || {};

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const content = typeof body.content === 'string' ? body.content : '';

  if (!req.file && !title) {
    return res.status(400).json({ message: '请上传文件，或者填写标题' });
  }

  // 可选：录入的同时打标签；不传就是空数组
  const nodeIds = parseNodeIds(body.nodeIds);
  if (nodeIds.length > 0) {
    const bad = checkNodeIds(courseId, nodeIds);
    if (bad) {
      if (req.file) fs.rm(path.join(uploadDir, req.file.filename), { force: true }, () => {});
      return res.status(400).json({ message: bad });
    }
  }

  // 名称：用户改过就用改后的（后缀跟着文件补齐），没改就用原始文件名
  const finalTitle = title
    ? keepFileExtension(title, req.file ? req.file.originalname : '')
    : (req.file ? req.file.originalname : '');

  const newItem = db.createNote(
    courseId,
    finalTitle,
    req.file ? '/uploads/' + req.file.filename : '',
    req.file ? req.file.mimetype : '',
    body.source || (req.file ? '手动上传' : '手动输入'),
    nodeIds,
    content
  );
  res.status(201).json(newItem);
});

app.delete('/api/notes/:id', (req, res) => {
  db.deleteNote(Number(req.params.id));
  res.json({ success: true });
});

// 单条笔记（含标签节点）：给资源详情页用
app.get('/api/notes/:id', (req, res) => {
  const id = Number(req.params.id);
  const note = db.findNote(id);
  if (!note) return res.status(404).json({ message: '找不到笔记' });

  res.json({ ...note, nodes: db.listNoteNodes(id) });
});

// 编辑一条笔记：可选改名 + 完整替换标签节点
app.put('/api/notes/:id/nodes', (req, res) => {
  const id = Number(req.params.id);
  const note = db.findNote(id);
  if (!note) return res.status(404).json({ message: '找不到笔记' });

  const body = req.body || {};
  const raw = body.nodeIds;
  if (!Array.isArray(raw)) {
    return res.status(400).json({ message: 'nodeIds 必须是数组' });
  }

  const nodeIds = [...new Set(raw.map(Number))];
  const bad = checkNodeIds(note.course_id, nodeIds);
  if (bad) return res.status(400).json({ message: bad });

  // 可选：同时改名（后缀跟着文件走）
  let title = note.title;
  if (typeof body.title === 'string' && body.title.trim()) {
    title = keepFileExtension(body.title, note.file_url);
  }

  const nodes = db.replaceNoteNodes(id, nodeIds, title);
  res.json({ success: true, nodes, title });
});

// ==================== 考核接口 ====================

app.get('/api/courses/:id/assessments', (req, res) => {
  const courseId = Number(req.params.id);
  res.json(db.listAssessments(courseId));
});

// 考核：文字内容是必填的，附件可选。
// 不传文件时就是一条纯文字考核，和以前的行为完全一致。
app.post('/api/courses/:id/assessments', upload.single('file'), (req, res) => {
  const body = req.body || {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return res.status(400).json({ message: '考核名不能为空' });

  const newItem = db.createAssessment(
    Number(req.params.id),
    title,
    body.deadline || '',
    body.requirement || '',
    req.file ? '/uploads/' + req.file.filename : '',
    req.file ? req.file.mimetype : ''
  );
  res.status(201).json(newItem);
});

app.delete('/api/assessments/:id', (req, res) => {
  db.deleteAssessment(Number(req.params.id));
  res.json({ success: true });
});

// ==================== 错题接口 ====================

app.get('/api/courses/:id/mistakes', (req, res) => {
  const courseId = Number(req.params.id);
  res.json(db.listMistakes(courseId));
});

// 同样两种方式二选一：上传图片，或者手动输入题目内容
app.post('/api/courses/:id/mistakes', upload.single('file'), (req, res) => {
  const courseId = Number(req.params.id);
  const body = req.body || {};

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const content = typeof body.content === 'string' ? body.content : '';

  if (!req.file && !title) {
    return res.status(400).json({ message: '请上传图片，或者填写标题' });
  }

  // 可选：录入的同时顺便打标签。两个字段名都认，老前端不受影响。
  const knowledgeIds = parseNodeIds(body.knowledgeIds !== undefined ? body.knowledgeIds : body.nodeIds);
  if (knowledgeIds.length > 0) {
    const bad = checkNodeIds(courseId, knowledgeIds);
    if (bad) {
      // 标签不合法，这道错题不会入库。
      // 刚上传的这个文件不会被任何记录引用，顺手删掉，避免在 uploads 里留下垃圾文件。
      // 只删“本次请求刚写入”的那一个文件，不会碰其它任何已上传文件。
      if (req.file) fs.rm(path.join(uploadDir, req.file.filename), { force: true }, () => {});
      return res.status(400).json({ message: bad });
    }
  }

  // 名称：用户改过就用改后的（后缀跟着文件补齐），没改就用原始文件名
  const finalTitle = title
    ? keepFileExtension(title, req.file ? req.file.originalname : '')
    : (req.file ? req.file.originalname : '');

  const newItem = db.createMistake(
    courseId,
    finalTitle,
    req.file ? '/uploads/' + req.file.filename : '',
    content,
    req.file ? req.file.mimetype : '',
    knowledgeIds
  );

  res.status(201).json(newItem);
});

app.delete('/api/mistakes/:id', (req, res) => {
  db.deleteMistake(Number(req.params.id));
  res.json({ success: true });
});

// 错题详情（含知识点标签）
app.get('/api/mistakes/:id', (req, res) => {
  const detail = db.getMistakeDetail(Number(req.params.id));
  if (!detail) return res.status(404).json({ message: '找不到错题' });

  res.json(detail);
});

// 编辑一道错题：可选改名 + 完整替换关联的知识树节点
app.put('/api/mistakes/:id/knowledge', (req, res) => {
  const id = Number(req.params.id);
  const mistake = db.getMistakeDetail(id);
  if (!mistake) return res.status(404).json({ message: '找不到错题' });

  const body = req.body || {};
  const raw = body.knowledgeIds;
  if (!Array.isArray(raw)) {
    return res.status(400).json({ message: 'knowledgeIds 必须是数组' });
  }

  const knowledgeIds = [...new Set(raw.map(Number))]; // 去重
  const bad = checkNodeIds(mistake.course_id, knowledgeIds);
  if (bad) return res.status(400).json({ message: bad });

  // 可选：同时改名（后缀跟着文件走）
  let title = mistake.title;
  if (typeof body.title === 'string' && body.title.trim()) {
    title = keepFileExtension(body.title, mistake.image_url);
  }

  // 事务：先清空旧关联再写入新的一组，要么全部成功要么全部失败
  const knowledge = db.replaceMistakeNodes(id, knowledgeIds, title);
  res.json({ success: true, knowledge, title });
});

// ==================== 知识树接口（Phase 1 新增）====================

// 1. 获取某门课的完整知识树（已经组装成嵌套的 children 结构）
app.get('/api/courses/:courseId/knowledge-tree', (req, res) => {
  res.json(db.listKnowledgeTree(Number(req.params.courseId)));
});

// 2. 新建节点：type 传 folder（分类）或 knowledge（知识点），
//    parentId 传 null 表示建在顶层
app.post('/api/courses/:courseId/knowledge-nodes', (req, res) => {
  const courseId = Number(req.params.courseId);
  const course = db.findCourse(courseId);
  if (!course) return res.status(404).json({ message: '找不到课程' });

  const body = req.body || {};

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return res.status(400).json({ message: '节点名称不能为空' });

  const type = body.type;
  if (type !== 'folder' && type !== 'knowledge') {
    return res.status(400).json({ message: 'type 只能是 folder 或 knowledge' });
  }

  // parentId 不传、传 null 或空字符串，都表示建成顶层节点
  let parentId = null;
  if (body.parentId !== undefined && body.parentId !== null && body.parentId !== '') {
    parentId = Number(body.parentId);
    if (!Number.isInteger(parentId)) {
      return res.status(400).json({ message: 'parentId 不合法' });
    }

    const parent = db.findKnowledgeNode(parentId);
    if (!parent) return res.status(400).json({ message: '父节点不存在' });
    if (parent.course_id !== courseId) {
      return res.status(400).json({ message: '父节点不属于这门课程' });
    }
    // 知识点是叶节点，不能在它下面再建子节点
    if (parent.type !== 'folder') {
      return res.status(400).json({ message: '知识点下面不能再创建子节点' });
    }
    // “未分类”是只读收纳桶，不接受子节点
    if (parent.is_system) {
      return res.status(400).json({ message: '「未分类」是自动收纳的，不能在它下面建子节点' });
    }
  }

  res.status(201).json(db.createKnowledgeNode(courseId, parentId, name, type));
});

// 3. 重命名节点（现阶段只支持改名，不支持移动节点 / 修改 type）
app.put('/api/knowledge-nodes/:id', (req, res) => {
  const id = Number(req.params.id);
  const node = db.findKnowledgeNode(id);
  if (!node) return res.status(404).json({ message: '找不到节点' });

  const name = typeof (req.body || {}).name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ message: '节点名称不能为空' });

  res.json(db.renameKnowledgeNode(id, name));
});

// 4. 删除节点：
//    删 folder 会连同整棵子树一起删掉，并清理这些节点上的错题标签关联；
//    错题本身不会被删除。
app.delete('/api/knowledge-nodes/:id', (req, res) => {
  const id = Number(req.params.id);
  const node = db.findKnowledgeNode(id);
  if (!node) return res.status(404).json({ message: '找不到节点' });

  db.deleteKnowledgeNode(id);
  res.json({ success: true });
});

// 5. 节点详情：含所属课程、完整路径，以及“直接关联”该节点的错题列表。
//    folder 和 knowledge 都能查；只返回直接绑定的错题，不聚合子节点。
app.get('/api/knowledge-nodes/:id', (req, res) => {
  const id = Number(req.params.id);
  const node = db.findKnowledgeNode(id);
  if (!node) return res.status(404).json({ message: '找不到节点' });

  res.json({
    id: node.id,
    name: node.name,
    type: node.type,
    course: db.findCourse(node.course_id),
    path: db.getKnowledgePath(node.id),
    // 三类资源都只返回“直接绑定当前节点”的，不聚合子节点
    mistakes: db.listMistakesByNode(node.id),
    materials: db.listMaterialsByNode(node.id),
    notes: db.listNotesByNode(node.id)
  });
});

// 6. 移动 / 排序节点（Phase 4C-1 新增）：
//    parentId = null 表示移到课程根层级；position 是目标层 children 里的 0 基位置。
//    改名仍然是上面那个 PUT /api/knowledge-nodes/:id，这里只管“换位置”。
app.put('/api/knowledge-nodes/:id/move', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(404).json({ message: '找不到节点' });

  const body = req.body || {};

  // parentId 不传、传 null 或空字符串，都表示移到课程根层级
  let parentId = null;
  if (body.parentId !== undefined && body.parentId !== null && body.parentId !== '') {
    parentId = Number(body.parentId);
    if (!Number.isInteger(parentId)) {
      return res.status(400).json({ message: 'parentId 不合法' });
    }
  }

  // position 不传或传 null 表示放到目标层最后；传了必须是 0 基整数
  let position = null;
  if (body.position !== undefined && body.position !== null && body.position !== '') {
    position = Number(body.position);
    if (!Number.isInteger(position)) {
      return res.status(400).json({ message: 'position 不合法' });
    }
  }

  // 节点是否存在、目标父是否合法、会不会成环、sort_order 重排，都在 db 的事务里完成
  const result = db.moveKnowledgeNode(id, parentId, position);
  if (!result.ok) return res.status(result.status).json({ message: result.message });

  res.json({ success: true, node: result.node });
});

// ===== 启动服务器 =====
app.listen(3000, () => {
  console.log('后端已启动，地址：http://localhost:3000');
  console.log('前端可以开始连接了！');
});
