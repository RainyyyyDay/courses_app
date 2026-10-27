# 课内

课内是一个本地运行的课程学习资料管理应用。它将资料、笔记、考核和错题按课程集中管理，并通过分类与知识点组成的知识框架建立关联。

前端使用原生 HTML、CSS 和 JavaScript，无需构建；后端使用 Node.js、Express 和 SQLite。数据库和上传文件保存在本地。

## 功能

- 课程添加、搜索、改名、置顶与删除。
- 资料与笔记统一管理，通过彩色类型标签区分笔记、课件、讲义、题集和作业，支持筛选与批量设置。
- 正文与大纲支持 Markdown / LaTeX，编辑时可切换原文与预览；附件文字识别可选择本地提取或共用大模型接口。
- 课程内集成完整思维导图编辑与生成模块：优先使用已有正文或大纲，可选嵌入原 PDF；支持重新生成、移除、分组配色与自动整理。详情预览只允许平移、缩放、适应窗口、全屏及详细／概览切换。
- 顶栏统一 AI 设置，配置在本地项目内加密保存，课程与导图共用；用户数据与密钥不进入代码仓库。
- 错题的文件上传、手动输入、详情查看及名称与标签编辑。
- 资料与笔记独立阅读复习：搜索、状态/直接标签筛选、勾选、保存后自动下一条及跳过、暂停恢复。接口见 [资料复习文档](docs/material-review-api.md) 和 [笔记复习文档](docs/note-review-api.md)。
- 考前复习计划：课程内固定选题、平均排期、每日进度与过期补做，按类型复用现有复习流程；支持改名、归档和删除，详见 [考前复习计划](docs/review-plans-api.md)。
- 课程复习中心：多计划轮播、最近／全部复习记录、继续与再次复习，以及课程内资料／笔记／错题总复习。会话保存固定范围和进度，详见 [复习中心与会话 API](docs/review-center.md)。
- 上传/编辑资料、笔记和错题时可手动选择复习方式，或让 AI 自动读取正文与附件 OCR 后建议；未选择且未采用建议时固定使用标准复习。成功判定与兼容规则见 [复习方式与成功判定](docs/review-mode-selection-and-success.md)。
- 图片与 PDF 附件预览；PDF、Word（.docx）、PPT（.pptx）文字提取并校对后填入正文，详见 [Word/PPT 文字提取](docs/office-text.md)。
- 考核名称、截止时间、要求和附件管理；可保存可编辑的考核构成饼图，支持手动占比、未知比例、悬停详情和可选 AI 提取，详见 [考核构成饼图](docs/assessment-grade-chart.md)。
- 分类与知识点的创建、改名、删除、排序和移动。
- 父级分类汇总子节点关联的资源，“未分类”收纳没有标签的资源。
- 恢复有效期内上次打开的课程及标签页。

## 技术栈

| 部分 | 技术 |
| --- | --- |
| 前端 | 原生 HTML、CSS、JavaScript；Chart.js 4.4.9 本地化 |
| HTTP 服务 | Node.js、Express |
| 数据库 | SQLite，使用 Node.js 内置 `node:sqlite` |
| 文件上传 | Multer |
| 跨域请求 | CORS |
| 回归测试 | Node.js 内置模块、隔离后端与 Chrome 无界面浏览器 |

## 目录结构

```text
.
├─ README.md
├─ .gitignore
├─ fronted/
│  ├─ index.html            # 页面结构及脚本加载
│  ├─ style.css
│  ├─ app.js                # 初始化和事件绑定
│  └─ js/                   # 页面、标签和知识框架模块
├─ back/
│  ├─ server.js             # API 和文件上传服务
│  ├─ package.json
│  ├─ package-lock.json
│  ├─ db.js                 # 历史实现，供迁移测试使用
│  └─ db/
│     ├─ index.js           # 当前数据库模块入口
│     ├─ connection.js      # 数据库连接与路径
│     ├─ schema.js          # 建表和版本迁移
│     └─ ...                # 各类数据操作
├─ modules/mindmap/         # 导图源码、必要浏览器资源、提示词及依赖清单
└─ tests/
   └─ regression.cjs
```

`fronted` 沿用项目现有目录名称。`back/data/`、`back/uploads/` 和 `node_modules/` 在运行或安装时生成，不纳入版本控制。

## 环境要求

- Node.js 24 和 npm。
- 浏览器。
- Python 3.11 或更新版本：可选，用于课程 AI 服务；启动器会检查解释器和依赖是否兼容。
- 完整回归测试当前使用 Windows 和默认安装位置的 Google Chrome。

SQLite 使用 Node.js 内置模块，不需要单独安装数据库服务。

## 本地运行

以下命令均从仓库根目录执行。

### 后端

```powershell
npm ci --prefix back
npm ci --prefix modules/mindmap
npm start --prefix back
```

后端默认监听 3000 端口。可访问 [课程接口](http://localhost:3000/api/courses) 检查服务状态。

首次启动会创建 `back/data/app.db`，并插入示例课程；已有数据库会自动执行结构迁移。数据库模块当前支持版本 26；v8 新增资料复习状态，v9 新增笔记复习状态，v10 增加独立收藏字段，v11 增加错题答案附件，v12 新增考前计划及任务表，v13 新增复习会话及项目表，v26 新增考核构成图表。升级保留旧内容、附件、标签、计划及复习状态；计划任务和单次会话状态均独立于内容状态。不补造旧历史，旧浏览器队列保留继续入口。收藏接口见 [资料与笔记收藏接口](docs/reading-favorites-api.md)，计划 API 见 [考前复习计划](docs/review-plans-api.md)，会话与总复习见 [复习中心](docs/review-center.md)，考核图表见 [考核构成饼图](docs/assessment-grade-chart.md)。

### 前端与一键启动

Node 同时托管前端、API 和导图，访问 [http://127.0.0.1:3000/](http://127.0.0.1:3000/)，无需另开前端服务器或 8794/8796 导图端口。Windows 用户安装依赖后可双击 `启动课程网站.bat`，在同一窗口打开网站、停止、重启或查看服务状态；也可双击 `停止课程网站.bat`。

完整的首次安装、可选 Python AI、OCR 和 Office 预览步骤见 [启动说明](启动说明.md)。导图集成结构、数据位置和升级注意事项见 [集成说明](modules/mindmap/COURSES-INTEGRATION.md)。

## 配置与数据

| 项目 | 位置 / 默认值 |
| --- | --- |
| 前端 API 地址 | `fronted/js/config.js`，默认使用本站 `/api` |
| 后端端口 | `back/server.js`：3000 |
| 数据库 | `back/data/app.db` |
| 上传文件 | `back/uploads/` |
| 文件访问路径 | `/uploads/文件名` |
| 导图、媒体与后台任务 | `back/data/mindmap/` |
| 本地加密 AI 设置 | `back/data/local-ai/`，不提交到仓库 |

网页通过同源路径访问附件、预览和导图。当前面向本机使用，尚未实现服务器账号体系。

数据库记录文件路径，上传文件本身保存在 `uploads/`。备份或迁移数据时应同时保留两者。本应用面向本地使用，目前没有登录与权限系统。

## 测试

安装后端依赖后运行：

```powershell
npm test --prefix back
```

导图与正文公式的独立集成回归：`node tests/mindmap-integration.cjs`。它使用临时数据库与本地模拟模型，验证桌面／手机预览、固定分组标题、重新生成和移除、原 PDF 嵌入及保存冲突，不调用真实 AI。

也可以执行 `node tests/regression.cjs`。

测试在临时目录中运行独立后端和数据库，完成后清理临时进程与文件。首次克隆没有数据库时会生成临时测试库；如果存在本地数据库，会复制数据库并检查原文件校验值。

覆盖内容包括：数据库迁移、名称与标签事务回滚、正文和附件保存、父级汇总与未分类查询、页面空状态与错误提示、保存失败重试、重复提交及实际浏览器交互。

浏览器测试使用 `C:/Program Files/Google/Chrome/Application/chrome.exe`。其他安装位置或平台需调整 `tests/regression.cjs` 中的浏览器路径。

## 开发约定

- 前端使用普通脚本，共享全局作用域。新增脚本需要在 `index.html` 中按依赖顺序加载，`app.js` 放在最后。
- 后端明确加载 `db/index.js`，不要改为 `require('./db')`，避免同名历史文件遮蔽当前模块。
- 数据库结构变更通过 `db/schema.js` 的版本迁移完成。
- 涉及资源名称和标签的写入保持事务一致性。
- 提交功能变更前运行回归测试。
- 依赖通过 `package.json` 和 `package-lock.json` 管理；本地数据库、上传文件、依赖目录及环境配置不提交。
