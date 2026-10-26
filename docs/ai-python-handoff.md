# 课程 AI 模块交接说明（2026-10-24）

本文是双模式 AI 接口的当前交接说明。旧文档中的“所有接口必须由用户提供 Key”及历史测试通过数，不代表当前交付状态。验收见 [本轮记录](ai-platform-acceptance.md)。

## 交付范围和分工

- 小组交付前端、`ai-fastapi/src/` Python 模块、依赖和接口说明。不实现大组登录、用户表、PostgreSQL 存取或部署。
- Python AI 模块不读写业务数据库、附件或用户 Key 文件；只接收 JSON，返回待确认结果，不自动保存、评分或调整复习排期。
- 大组把路由挂入现有 FastAPI 应用，负责登录、权限、用户及全局额度、业务结果保存、HTTPS 和请求日志脱敏。
- 正式环境不需要单独启动 3002 或新建云函数。`test_app.py`、`local_runner.py`、Node 本地转发器不是生产鉴权或部署入口。
- Word/PPT 转换依赖 LibreOffice 与现有 Node 适配器，属于另一个文件服务交接事项，不包含在本 Python JSON AI 包内。

## 文件与依赖

交付整个 `ai-fastapi/src/`，包括 `__init__.py`，不要只复制某个功能文件：各功能依赖 `ai_mistake.py`、`ai_provider.py`、`ai_platform.py`。

- Python >=3.11。
- `fastapi>=0.115,<1`。
- `httpx>=0.28.1,<0.29`。
- `uvicorn>=0.30,<1` 仅供本地运行；宿主已有 ASGI 服务时不必额外启动。
- 完整依赖清单：`ai-fastapi/requirements.txt`。没有新增数据库依赖。

主文件（例如 `src/calendar_routes.py`）在已有 `app` 创建后调用：

```python
from fastapi import Depends
from src.ai_routes import register as register_course_ai

# 下列函数由大组提供，名称仅作示例，不是本包自带登录实现。
register_course_ai(
    app,
    dependencies=[Depends(require_ai_permission_and_quota)],
    status_dependencies=[Depends(require_login)],
)
```

每个功能仍可单独 `from src.ai_outline import register` 后注册。不要同时统一注册和逐个注册，也不要注册两次。

缺少权限依赖时默认拒绝请求，返回 503；这不是注册失败。登录及权限依赖的 HTTP 异常由宿主处理。所有生成请求（包括用户自带 API）仍须经过宿主权限检查，不能相信 JSON 中自称的用户身份。

状态接口只需登录/查看权限，不应扣除模型调用额度；生成接口的配额预留、失败释放和多实例限流由宿主负责。模块内限制只是每 worker、每功能的并发及频率保护，不是共享用户额度系统。宿主全局依赖/中间件也应避免对状态查询扣费。

## 平台 AI 配置

在部署平台的服务端环境变量界面设置，不通过前端、仓库文件或聊天传递真实 Key：

| 环境变量 | 含义 |
| --- | --- |
| `PLATFORM_AI_ENABLED` | 精确为 `true` 才启用，默认关闭 |
| `PLATFORM_AI_PROVIDER` | `deepseek` 或 `compatible`，默认 `deepseek` |
| `PLATFORM_AI_API_KEY` | 平台的服务端 Key，必需 |
| `PLATFORM_AI_MODEL` | 模型 ID，默认 `deepseek-flash`；compatible 模式填平台实际开通的模型 |
| `PLATFORM_AI_BASE_URL` | compatible 模式必需，公网 HTTPS 的兼容接口地址 |
| `PLATFORM_AI_WORKSPACE_ID` | 可选，仅 Anthropic 官方兼容接口按凭据要求使用 |

凭据只从进程环境读取，不加载 `.env`。缺少配置、禁用或配置不合法，平台接口返回 `PLATFORM_AI_UNAVAILABLE`，不自动使用用户 Key 或 Mock。平台模式由服务端确定地址、模型和凭据，拒绝客户端覆盖 Key、地址或工作区，模型字段如传入必须与服务器一致。

`compatible` 使用现有 Chat Completions JSON 适配器，包含公网地址校验、不跟随重定向和响应结构校验。不能据此承诺所有兼容平台/模型均已真实验收。

## 两种请求方式

平台模式：

```json
{
  "provider": "platform",
  "confirm_cost": true,
  "purpose": "outline_draft",
  "input": {"title": "极限", "text": "极限的定义和基本性质"}
}
```

用户自带 API（下例仅为虚构凭据示例）：

```json
{
  "provider": "compatible",
  "base_url": "https://models.example.test/v1",
  "api_key": "synthetic-example-only",
  "model": "example-model",
  "confirm_cost": true,
  "purpose": "outline_draft",
  "input": {"title": "极限", "text": "极限的定义和基本性质"}
}
```

用户使用 DeepSeek 官方接口时传 `provider: "deepseek"`，不传自定义地址，模型沿用当前模块支持范围。

`confirm_cost` 表示用户明确允许调用，不等于登录验证或服务端额度凭证。失败不自动重试，不跨模式切换。自带 Key 默认单次使用；明确勾选后仅在当前标签页内存保留。平台 Key 永不返回前端。两种模式均不在浏览器持久存储或业务数据库中保存 Key；宿主必须禁止在日志中记录请求体及 Authorization。

## 接口索引

下面全部挂载在同一个宿主 `app`。除状态接口外，均为 POST、`Content-Type: application/json`。表内为 `input` 内容和主要返回字段，外层使用上述凭据合同。

| 路径 | input / 特有字段 | 主要响应 |
| --- | --- | --- |
| `GET /api/ai/platform-status` | 无请求体、无 Key、无模型调用 | `{available,provider:"platform",model?}`；不可用附 `error` |
| `/api/ai/test` | 外层 `action:"classify"`，input 为题目/学生作答等 | `{ok,provider,model,action,result,elapsed_ms}`；result 包含分析和建议 |
| `/api/ai/test` | 外层 `action:"connection"`，无需 input | 执行一次模型测试，可能计费；仅显式操作时使用 |
| `/api/ai/answer-draft` | `question,question_format,choice_type?,options?,existing_answer?,existing_explanation?` | `{provider,draft:{answer,explanation,choice_answer,caveats,needs_more_information,needs_review}}` |
| `/api/ai/review-suggestion` | `kind:material/note,content,title?,goal?,recall?` | `{provider,result:{review_method,reason,needs_review}}` |
| `/api/ai/review-mode-advice` | `kind:material/note/mistake,content,title?,goal?,extra_context?,mistake_type?` | `{provider,result:{review_method,reason,needs_review}}` |
| `/api/ai/material-draft` | `kind,mode_id,content,reference?` | `{provider,mode_id,draft:{material,needs_more_information,caveats,needs_review}}` |
| `/api/ai/review-feedback` | `mode_id,question,student_answer,reference?,rubric?,objective_result?` | `{provider,feedback:{judgment,summary,errors,reference_answer,reference_check,steps,suggestions,needs_review}}` |
| `/api/ai/outline-polish` | `title,text`；外层 `purpose:outline_draft/mindmap` | `{provider,result:{title,outline,needs_review}}` |
| `/api/ai/assessment-chart` | `action:extract/edit,title,source?,instruction?,current?` | `{provider,result}`，result 是待确认的考核构成草稿 |

平台请求响应中的 `provider` 为 `platform`，不泄露服务器地址或凭据。用户自带 API 返回 `deepseek` 或 `compatible`。

`/api/ai/classify` 也保留为历史原始分类合同，输入直接为题目等字段，使用原有 `AI_PROVIDER/AI_ENABLE_REAL/DEEPSEEK_API_KEY` 配置，默认 Mock。它不接受双模式外层封装。正式双模式前端使用上表 `/api/ai/test` 的 classify action；不要用这个历史接口判断平台 AI 是否已开通，也不要把它的 Mock 返回当真实结果。

状态接口的 `available:true` 仅表示配置就绪并通过该接口权限检查，不会查询账户余额或调用模型；不能称为模型连接成功。生成请求仍可能因权限、额度、网络、模型或输出问题失败。前端“检查平台状态”只调用此状态接口。

## 数据限制与错误

- 通常请求体上限 16 KB；`review-mode-advice`、`outline-polish`、`assessment-chart` 为 32 KB。按 JSON UTF-8 字节数计算。
- 通常正文/作答各最多 4000 UTF-16 单元，具体字段限制由各模块校验；大纲正文最多 20000，考核来源最多 8000。请求体限制可能先到。
- 大纲结果最多 12000 UTF-16 单元、160 行；导图最多六层，不静默截断。
- 所有生成结果都需要人工确认，成功生成不表示已经保存、完成复习或答案正确。
- 常见错误：`INVALID_INPUT`、`INVALID_API_KEY`、`COST_CONFIRMATION_REQUIRED`、`BODY_TOO_LARGE`、`AI_AUTH_NOT_CONFIGURED`、`PLATFORM_AI_UNAVAILABLE`、`RATE_LIMITED`、`AI_BUSY`、`AI_TIMEOUT`、`AI_AUTH_FAILED`、`AI_BALANCE_UNAVAILABLE`、`AI_UPSTREAM_RATE_LIMITED`、`INVALID_RESPONSE`。
- 大纲/导图另有 `OUTLINE_EMPTY`、`OUTLINE_FORMAT_INVALID`、`OUTLINE_TOO_LONG`、`MINDMAP_FORMAT_INVALID`、`MINDMAP_HIERARCHY_INVALID`。保留旧内容，展示可操作的错误。
- 模块业务错误通常返回 `{"error":"CODE"}`，部分含经过限制的上游状态/数字业务码，不返回上游原始错误正文；FastAPI 权限依赖可能返回 `{"detail":...}`。宿主可统一异常外观，但应保留 HTTP 状态和错误含义。

## 前端与本地启动

- “AI 设置”可选“使用平台 AI”，其余服务位于“使用自己的 API”组。
- 平台模式隐藏用户 Key/自定义模型输入；应用设置先读取状态，不调用模型。刷新后需重新选择并授权，默认不自动生成。
- 用户自带 API 保留地址、模型、临时 Key 和显式费用同意；切换后取消旧请求，晚到结果不能覆盖新设置。
- 正式前端以同源 `/api` 为 AI 接口地址；必要时在脚本前注入 `window.COURSES_AI_API_BASE="/api"`。业务 API 地址由大组另行接入。
- 本地 `启动课程网站.bat` / `start-local.ps1` 仍运行 Node 3000 + Python 3002；新增状态 GET 也通过现有本机转发，不改为远程开放代理。
- 主后端只导入 `src` 模块，禁止导入本地 `test_app.py` 的回环鉴权、静态页面或独立测试台。
