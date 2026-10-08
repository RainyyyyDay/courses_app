# 课内

课内是一个本地运行的课程学习资料管理应用。它将资料、笔记、考核和错题按课程集中管理，并通过分类与知识点组成的知识框架建立关联。

前端使用原生 HTML、CSS 和 JavaScript，无需构建；后端使用 Node.js、Express 和 SQLite。数据库和上传文件保存在本地。

## 功能

- 课程添加、搜索、改名、置顶与删除。
- 资料、笔记和错题的文件上传、手动输入、详情查看及名称与标签编辑。
- 考核名称、截止时间、要求和附件管理。
- 分类与知识点的创建、改名、删除、排序和移动。
- 父级分类汇总子节点关联的资源，“未分类”收纳没有标签的资源。
- 恢复有效期内上次打开的课程及标签页。

## 技术栈

| 部分 | 技术 |
| --- | --- |
| 前端 | 原生 HTML、CSS、JavaScript |
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
└─ tests/
   └─ regression.cjs
```

`fronted` 沿用项目现有目录名称。`back/data/`、`back/uploads/` 和 `node_modules/` 在运行或安装时生成，不纳入版本控制。

## 环境要求

- Node.js 24 和 npm。
- 浏览器。
- Python 3：用于下方的前端 HTTP 服务；直接打开 HTML 时不需要。
- 完整回归测试当前使用 Windows 和默认安装位置的 Google Chrome。

SQLite 使用 Node.js 内置模块，不需要单独安装数据库服务。

## 本地运行

以下命令均从仓库根目录执行。

### 后端

```powershell
npm ci --prefix back
npm start --prefix back
```

后端默认监听 3000 端口。可访问 [课程接口](http://localhost:3000/api/courses) 检查服务状态。

首次启动会创建 `back/data/app.db`，并插入示例课程；已有数据库会自动执行结构迁移。数据库模块当前支持版本 6。

### 前端

在另一个终端执行：

```powershell
python -m http.server 8000 --directory fronted
```

访问 [http://localhost:8000/index.html](http://localhost:8000/index.html)。

也可以在浏览器中直接打开 `fronted/index.html`。前端使用普通脚本，支持 `file://` 加载；课程和资源操作仍需要后端运行。后端提供 API 和上传文件访问，不托管前端首页。

## 配置与数据

| 项目 | 位置 / 默认值 |
| --- | --- |
| 前端 API 地址 | `fronted/js/config.js`：`http://localhost:3000/api` |
| 后端端口 | `back/server.js`：3000 |
| 数据库 | `back/data/app.db` |
| 上传文件 | `back/uploads/` |
| 文件访问路径 | `/uploads/文件名` |

附件和预览链接中也使用了 `http://localhost:3000`。调整服务地址时需要同步检查这些链接。

数据库记录文件路径，上传文件本身保存在 `uploads/`。备份或迁移数据时应同时保留两者。本应用面向本地使用，目前没有登录与权限系统。

## 测试

安装后端依赖后运行：

```powershell
npm test --prefix back
```

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
