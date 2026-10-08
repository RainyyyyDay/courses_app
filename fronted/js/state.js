/*
 * state.js
 * 全局运行时状态：当前课程、三类资源缓存、标签选择器、知识树、排序与拖拽
 *
 * 这个文件是由 app.js 按职责拆分出来的，只搬了位置，逻辑没有改动。
 * 加载顺序见 index.html 底部的 <script> 列表；本文件依赖前面已加载的文件。
 */

let currentCourseId = null;
let currentCourseName = '';
let allcourses = [];
let currentTree = null;
// 三类资源的列表缓存（编辑标签时用来回显已有标签）
let currentMistakes = [];
let currentMaterials = [];
let currentNotes = [];
// 知识点选择器的临时状态：纯前端，不写 localStorage，每次打开都是全新的
let tagPickerState = null;
// 已经选好文件、等用户选完标签再真正上传的文件（错题 / 资料 / 笔记共用）
let pendingUploadFile = null;
let pendingManual = null;
// 当前所在页面：{type:'list'} | {type:'course',tab} | {type:'node',id} | {type:'mistake',id}
let currentView = { type: 'list' };
// 简单的“来源页”栈：从哪个页面进来的，返回时优先回那个页面（不依赖浏览器 history）
let navStack = [];
// 只有“哪些节点是展开的”属于纯前端 UI 状态，用 Set 记在内存里，不入库。
let expandedIds = new Set();    // 当前展开的 folder 节点 id
let knownNodeIds = new Set();   // 上次加载时见过的节点 id，用来识别“新出现的节点”
let treeStateCourseId = null;   // 上面两个 Set 属于哪门课
let renamingNodeId = null;      // 正在改名的节点 id（普通模式下点 ✎ 进入）
let sortMode = false;        // 是否处于排序模式
let dragNodeId = null;       // 正在被拖拽的节点 id
let dropPreview = null;      // 当前落点预览 { targetId, mode }
let moveMenuNodeId = null;   // “移动”菜单当前操作的节点 id
let moveTargetNodeId = null; // “移动到…”弹窗当前操作的节点 id
let dragPointerId = null;    // 当前指针 id
let dragStartX = 0;
let dragStartY = 0;
let dragStarted = false;     // 是否已经越过阈值、真正进入拖拽
let dragSourceRow = null;    // 被拖起来的那一行
let dragGhost = null;        // 跟手浮层外层（管位置）
let dragGhostInner = null;   // 跟手浮层内层（管缩放 / 倾斜 / 淡出）
let dragOffsetX = 0;         // 指针在行内的相对位置，保证“拿起来”时不跳
let dragOffsetY = 0;
let previewTouchedRows = []; // 被写了 inline transform 的行，收尾时要还原
let intoCenterY = null;      // “挪进下一级”时目标行的中心 y，用来把卡片吸过去
let addMenuParentId = null; // null 表示建在课程顶层
