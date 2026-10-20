/*
 * 复习模式注册表（v17 MVP）
 *
 * 这里只定义“模式是什么、适用于什么、用户有没有覆盖”，
 * 具体怎么出题、怎么判分仍由各复习流程实现。
 * 当前真正落地的是：
 *   - standard：沿用原有错题步骤机（回忆 → 看答案 → 自评）
 *   - choice_reproduction：选择题复现，客观判分
 * cloze/self_explain/contrast/reading 通过通用材料工作台执行；旧步骤机可切换项仍保持两种。
 * retry 为重新执行的动作，不注册第七套判分引擎。
 */
const { db } = require('./connection');

const MODE_DEFINITIONS = {
  choice_reproduction: {
    id: 'choice_reproduction',
    name: '选择复现',
    description: '遮住答案重选一次，按选项客观判分。',
    implemented: true,
  },
  standard: {
    id: 'standard',
    name: '标准复习',
    description: '回忆/重做后查看答案，再自评掌握程度。',
    implemented: true,
  },
  cloze: {
    id: 'cloze',
    name: '挖空回忆',
    description: '对记忆型内容做挖空填空。',
    implemented: true, execution: 'workbench',
  },
  self_explain: {
    id: 'self_explain',
    name: '自述讲解',
    description: '用自己的话复述要点，再对照量规。',
    implemented: true, execution: 'workbench',
  },
  reading: {
    id: 'reading',
    name: '阅读标记',
    description: '阅读并标记“懂了/还要再看”，只作为曝光记录。',
    implemented: true, execution: 'workbench',
  },
  contrast: {id:'contrast',name:'对比辨析',description:'按维度对比，复用开放作答与自评。',implemented:true,execution:'workbench'},
};

function fail(status, code, message) {
  throw Object.assign(new Error(message), { status, code });
}

function parseOptions(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function normalizeOption(option, index) {
  if (typeof option === 'string') {
    const text = option.trim();
    return text ? { id: String.fromCharCode(65 + index), text } : null;
  }
  if (!option || typeof option !== 'object' || Array.isArray(option)) return null;
  const id = typeof option.id === 'string' ? option.id.trim() : '';
  const text = typeof option.text === 'string' ? option.text.trim() : '';
  if (!id || !text) return null;
  return { id, text };
}

function normalizeOptions(raw) {
  return parseOptions(raw).map(normalizeOption).filter(Boolean);
}

function correctOptionIds(choiceType, raw) {
  if (choiceType === 'multiple') {
    if (Array.isArray(raw)) return raw.map(String).map(value => value.trim()).filter(Boolean);
    if (typeof raw !== 'string' || !raw.trim()) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).map(value => value.trim()).filter(Boolean);
    } catch { /* 兼容逗号分隔的旧值 */ }
    return raw.split(',').map(value => value.trim()).filter(Boolean);
  }
  return typeof raw === 'string' && raw.trim() ? [raw.trim()] : [];
}

// 把前端/接口传进来的选择题字段校验并归一化成数据库列。
// questionFormat 省略时表示“这次不修改题型”，由调用方决定是否清空。
function normalizeChoiceFields(input, { current = null } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail(400, 'INVALID_ARGUMENT', '选择题字段必须是对象');
  }
  const format = input.questionFormat === undefined
    ? (current?.question_format || 'open')
    : input.questionFormat;
  if (!['open', 'choice'].includes(format)) fail(400, 'INVALID_ARGUMENT', 'questionFormat 只能是 open 或 choice');
  const choiceType = input.choiceType === undefined
    ? (current?.choice_type || 'single')
    : input.choiceType;
  if (!['single', 'multiple'].includes(choiceType)) fail(400, 'INVALID_ARGUMENT', 'choiceType 只能是 single 或 multiple');

  if (format === 'open') {
    return { question_format: 'open', options_json: '[]', correct_option: '', choice_type: choiceType };
  }
  const rawOptions = input.options === undefined ? current?.options_json : input.options;
  const options = normalizeOptions(rawOptions);
  if (options.length < 2 || options.length > 26) fail(400, 'INVALID_ARGUMENT', '选择题需要 2 到 26 个选项');
  if (options.some((option, index) => options.findIndex((item) => item.id === option.id) !== index)) {
    fail(400, 'INVALID_ARGUMENT', '选项 id 不能重复');
  }
  if (options.some((option) => option.id.length > 8 || option.text.length > 500)) {
    fail(400, 'INVALID_ARGUMENT', '选项 id 最多 8 字符，选项内容最多 500 字符');
  }
  if (options.some((option, index) => options.findIndex((item) => item.text === option.text) !== index)) {
    fail(400, 'INVALID_ARGUMENT', '选项内容不能重复');
  }
  const rawCorrect = input.correctOption === undefined ? current?.correct_option : input.correctOption;
  const correctIds = [...new Set(correctOptionIds(choiceType, rawCorrect))];
  if (!correctIds.length) fail(400, 'INVALID_ARGUMENT', '正确选项必须对应至少一个选项 id');
  if (correctIds.some(id => !options.some(option => option.id === id))) {
    fail(400, 'INVALID_ARGUMENT', '正确选项必须属于当前选项');
  }
  if (choiceType === 'single' && correctIds.length !== 1) {
    fail(400, 'INVALID_ARGUMENT', '单选题只能有一个正确选项');
  }
  return {
    question_format: 'choice',
    options_json: JSON.stringify(options),
    correct_option: choiceType === 'single' ? correctIds[0] : JSON.stringify(correctIds),
    choice_type: choiceType,
  };
}

function choiceIsUsable(mistake) {
  if (!mistake || mistake.question_format !== 'choice') return false;
  const options = normalizeOptions(mistake.options_json);
  const choiceType = mistake.choice_type === 'multiple' ? 'multiple' : 'single';
  const correctIds = correctOptionIds(choiceType, mistake.correct_option);
  return options.length >= 2 && options.length <= 26
    && correctIds.length > 0
    && correctIds.every(id => options.some(option => option.id === id))
    && (choiceType === 'multiple' || correctIds.length === 1);
}

function modeForMistake(mistake) {
  const available = [];
  // v17 fixtures predate confirmation. In current data an explicit pending flag
  // must never be interpreted as a confirmed choice question.
  if (mistake.question_format_confirmed !== 0 && choiceIsUsable(mistake)) available.push(MODE_DEFINITIONS.choice_reproduction);
  available.push(MODE_DEFINITIONS.standard);
  return available;
}

function savedMode(courseId, type, id) {
  return db.prepare('SELECT mode_id, mode_source, updated_at FROM review_item_modes WHERE course_id=? AND item_type=? AND item_id=?')
    .get(courseId, type, id) || null;
}

function resolveMistakeMode(mistake) {
  const available = modeForMistake(mistake);
  const saved = savedMode(mistake.course_id, 'mistake', mistake.id);
  if (saved && available.some((mode) => mode.id === saved.mode_id)) {
    return { ...available.find((mode) => mode.id === saved.mode_id), source: saved.mode_source, availableModes: available };
  }
  const recommended = available[0];
  return { ...recommended, source: recommended.id === 'choice_reproduction' ? 'rule' : 'default', availableModes: available };
}

function setItemMode(courseId, type, id, modeId, source = 'user') {
  if (!['material', 'note', 'mistake'].includes(type)) fail(400, 'INVALID_ARGUMENT', '内容类型不合法');
  if (!['user', 'rule', 'ai', 'default'].includes(source)) fail(400, 'INVALID_ARGUMENT', 'modeSource 不合法');
  const mode = MODE_DEFINITIONS[modeId];
  if(mode?.execution==='workbench')fail(409,'MODE_NOT_APPLICABLE','请通过“复习模式 / 手动材料”入口使用此模式');
  if (!mode || !mode.implemented) fail(400, 'INVALID_ARGUMENT', '这个复习模式还没有实现');
  if (type !== 'mistake' && modeId !== 'standard') {
    fail(409, 'MODE_NOT_APPLICABLE', '资料和笔记第一版只支持标准复习');
  }
  if (type === 'mistake') {
    const mistake = db.prepare('SELECT * FROM mistakes WHERE id=? AND course_id=?').get(id, courseId);
    if (!mistake) fail(404, 'MISTAKE_NOT_FOUND', '找不到当前课程的错题');
    if (!modeForMistake(mistake).some((item) => item.id === modeId)) {
      fail(409, 'MODE_NOT_APPLICABLE', '当前内容不适用这个复习模式');
    }
  }
  const before = savedMode(courseId, type, id);
  db.prepare(`INSERT INTO review_item_modes (course_id,item_type,item_id,mode_id,mode_source,updated_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(course_id,item_type,item_id) DO UPDATE SET mode_id=excluded.mode_id,
      mode_source=excluded.mode_source, updated_at=excluded.updated_at`)
    .run(courseId, type, id, modeId, source, new Date().toISOString());
  // 换模式只重置“本轮步骤”，不动记忆状态/排期；用户下次从这个模式的第一步开始。
  if (type === 'mistake' && before?.mode_id !== modeId) {
    db.prepare(`UPDATE mistake_review_progress
      SET stage='idle', recall=NULL, selected_option=NULL, choice_correct=NULL,
          first_answer=NULL, answer_revealed=0, started_at=NULL, duration_ms=0,
          version=version+1, updated_at=?
      WHERE mistake_id=?`).run(new Date().toISOString(), id);
  }
  return { modeId, source };
}

module.exports = {
  MODE_DEFINITIONS,
  parseOptions,
  normalizeOptions,
  normalizeChoiceFields,
  correctOptionIds,
  choiceIsUsable,
  modeForMistake,
  resolveMistakeMode,
  setItemMode,
};
