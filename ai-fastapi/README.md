# AI 错题分类 FastAPI 移植模块

这是交给主网站后端集成的模块，不是新网站或部署方案。只新增本目录，Node 服务和 SCF 准备包保持不变。Python >=3.11。

## 交付给大组什么

必需文件只有 `src/ai_mistake.py`。将它放入大组现有 Python 项目的 `src/`；若大组不是这个包布局，可以调整导入语句。此文件自包含现有分类规则，不依赖外部 JSON 或原 Node 目录，不操作数据库，不实现登录，不读 .env，不监听端口。不要用本目录的空 `src/__init__.py` 覆盖大组已有文件。

其余文件供开发验收：`requirements.txt`、本说明、`test_app.py` 和 `tests/`。`tests/test_core.py` 有一个源规则一致性测试会读取同仓库的 `ai-service/config/classification.json`；这个路径只存在于测试，运行模块不依赖它。单独交付完整测试目录时可一起提供原规则 JSON 作为审查依据，或在宿主项目中调整这一个测试的 fixture 路径。

## 依赖与本地验收环境

- 宿主已有 FastAPI 时，合并 `requirements.txt`，不要另建应用/服务器。
- HTTP 路由需要 FastAPI（它会带入 Starlette 等传递依赖）。
- 真实 Provider 和假上游测试使用 httpx；默认 mock 不发网络请求。
- uvicorn 仅用于本地独立联调，宿主已有 ASGI 服务器时无需额外增加。
- 测试使用 Python unittest 标准库，不需要 pytest。

2026-10-20 已将依赖安装到仓库专用且被 Git 忽略的 `.local-ai-deps/`，未修改系统 Python 包。实测 Python 3.14.6、FastAPI 0.148.0、Starlette 1.9.0、uvicorn 0.54.0、httpx 0.28.1、AnyIO 4.15.1、Pydantic 2.14.1。requirements 仍是兼容范围，大组应合并自身依赖锁并复测。

## 在主应用中注册

最小调用符合要求：

```python
from src.ai_mistake import register

register(app)
```

这会注册 `POST /api/ai/classify`，但缺少主网站授权依赖时返回 `503 {"error":"AI_AUTH_NOT_CONFIGURED"}`，即使客户端伪造用户 ID 或 Authorization 也不会调用 Provider。

正式集成时，使用大组已经实现的认证和 AI 权限依赖：

```python
from fastapi import Depends
from src.ai_mistake import register

# app、require_current_user、require_ai_permission 均由大组现有代码提供。
# 不要将这两个依赖替换成空函数，也不要直接接受浏览器自报的 user_id。
register(app, dependencies=[
    Depends(require_current_user),
    Depends(require_ai_permission),
])
```

这些依赖由 FastAPI 正常执行，支持复用现有 Cookie/Session/JWT 验证；用户信息可由宿主依赖存入 request.state，模块本身不读取身份字段。权限/额度依赖应在 Provider 调用前拒绝请求。HTTPException 的认证错误格式继续由宿主管理，模块不会替换全局异常处理、生命周期、CORS 或其他路由。重复注册同一路径会安全失败。

宿主负责用户/课程资源授权、按用户与全局的共享额度、调用记录和入库。模块的进程内限流/并发不等同于这些能力。若需要按结果结算/保存，宿主应在后续整合层调用 `Classifier` 或封装该路由流程，本版本不会偷偷写库。

## JSON 契约，复用现有业务规则

请求头必须 `Content-Type: application/json`，可带 charset。五个字段均可省略，但已提供值必须是字符串；每字段最多 4000 个 JavaScript UTF-16 单元，总请求体最多 16384 字节。拒绝未知字段、图片、用户 ID、模型/Provider/Key 等客户端配置；拒绝压缩请求体。

```json
{"question":"1+1=?","student_answer":"3","error_type":"careless","correct_answer":"2","context":"虚构联调题目"}
```

mock 成功响应：

```json
{"review_method":"retry","reason":"Mock：按已提供的错误类型匹配临时示例规则，未推断错误原因。","needs_review":true}
```

确定的 mock 演示映射：knowledge_gap → cloze；reasoning_gap → self_explain；careless → retry；其他 → unclassified。题目、学生答案、明确的 error_type 缺少任一项时不调用 Provider，返回 `unclassified` 人工兜底。correct_answer/context 不能替代上述门槛。

`error_type` 是调用方明确提供的证据标签，不是模型自动诊断；不要直接把主网站的 knowledge/thinking/execution 当作这些标签。`needs_review=true` 固定表示需要人工复核，不表示学生掌握程度或是否完成复习。规则版本为 review-modes-2，仅为可测试的演示映射，不是已确定的教学依据。

输出严格检查类别白名单、非空且最多 500 UTF-16 单元的 reason 和布尔 needs_review；额外字段丢弃，返回的 needs_review 总为 true。结构/类别不合法返回 200 人工兜底；上游非法 JSON、截断和 HTTP 故障返回错误，不伪装成分类成功。前端请使用 textContent 渲染 reason。

响应头：X-AI-Provider、X-AI-Result-Source（provider/input_fallback/validation_fallback/error）、服务端随机 X-Request-ID、Cache-Control: no-store、X-Content-Type-Options: nosniff。入口前的错误不一定含结果来源头。

模块错误正文统一 `{"error":"CODE"}`：400 INVALID_INPUT/INVALID_JSON；413 BODY_TOO_LARGE；415 JSON_REQUIRED/UNSUPPORTED_ENCODING；429 RATE_LIMITED（含 Retry-After）；502 AI_UNAVAILABLE/AI_AUTH_FAILED；503 AI_AUTH_NOT_CONFIGURED/AI_BUSY/AI_BALANCE_UNAVAILABLE/AI_UPSTREAM_RATE_LIMITED；504 AI_TIMEOUT；内部意外错误 500 INTERNAL_ERROR。断连取消在仍可响应时使用 499 CLIENT_DISCONNECTED；真实网关是否透传断连需另验收。

## 环境变量，不使用 dotenv

| 名称 | 默认与规则 |
| --- | --- |
| AI_PROVIDER | mock；只允许 mock/deepseek |
| AI_ENABLE_REAL | 只有精确为 true 且 AI_PROVIDER=deepseek 才允许真实调用；这是 Python 移植版额外的显式开关 |
| DEEPSEEK_API_KEY | 仅真实模式从进程环境读取，缺少时注册失败；mock 不读取此变量 |
| DEEPSEEK_MODEL | 默认 deepseek-flash；保留原白名单 deepseek-v4-pro，实际账户可用性未验收 |
| AI_KEY_MODE | 仅 development，拒绝 user；这只是原开发凭据模式名称，不是用户认证机制 |
| AI_TIMEOUT_MS | 默认 15000，1–120000 |
| AI_MAX_CONCURRENT | 默认 2，1–100 |
| RATE_LIMIT_MAX | 默认 30，1–10000 |
| RATE_LIMIT_WINDOW_MS | 默认 60000，1–3600000 |

不读取或修改宿主 HOST、PORT、NODE_ENV；没有本地服务/SCF 的监听配置。无配置、无 Key 时默认 mock，不能因为已有 Key 自动变成真实调用。密钥只由部署负责人在宿主的服务端环境变量界面填写，不放到前端、源码、命令行参数或聊天中。本轮没有启用真实模式。

真实传输复用原固定 URL、模型请求格式（max_tokens=512、非流式、JSON Output、关闭 thinking）和错误映射。httpx 禁止重定向、禁用隐式环境代理，不自动重试；整个 Provider 调用含响应体读取受分类总超时约束，响应解码后最多 65536 字节。网络代理/证书需求由宿主另外审查。

每个注册应用创建一个执行器，进程内全局默认每分钟 30 次、同时两个 Provider。超时或客户端取消会取消任务；若 Provider 吞掉取消，仍占容量直到真正结束，避免抛弃任务无限增长。实际部署应按 worker 数和实例数计算总并发，并由大组提供共享配额。取消不保证真实上游不计费。本版本不记录原始请求、响应、异常或 Key；大组平台日志仍需配置脱敏。

## 本地测试（不调用真实模型）

PowerShell：

```powershell
Set-Location D:\GitCourcesWeb\courses_app\ai-fastapi
$env:PYTHONPATH = "D:\GitCourcesWeb\courses_app\.local-ai-deps"
python -B -m unittest discover -s tests -v
```

核心与 httpx.MockTransport 测试不访问真实模型；缺 FastAPI 时 5 项路由测试明确跳过，不能算通过。测试用假 Key，不加载 .env、不访问数据库。test_app.py 默认被 unittest discover 排除（discover 范围只含 tests/）。

独立联调入口（先设置上面的 PYTHONPATH；首次安装命令见 `../tests/README-mistake-ai.md`）：

```powershell
python -B -m uvicorn test_app:app --host 127.0.0.1 --port 3002 --no-proxy-headers
```

该入口固定使用 Config()，忽略进程中的模型开关和 Key，仅为回环开发请求放行；它不是登录系统，不能用于公网部署、反向代理或隧道公开。另一个终端可发送虚构题目：

```powershell
$sample = @{ question='1+1=?'; student_answer='3'; error_type='careless' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3002/api/ai/classify `
  -ContentType 'application/json; charset=utf-8' `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($sample))
```

浏览器打开 `http://127.0.0.1:3002/demo`：现有错题详情界面预填虚构题目，点击“获取 AI 建议”即可真实联调。演示页不加载 app.js、不请求课程 API、不启动 Node/SQLite；仅用于 AI 面板操作。它与分类路由同源，无需 CORS。拒绝异源 Origin、非回环客户端、伪造 Host 和转发头。根页面保留正常网站入口，完整课程功能仍需要原有后端。

完成后 Ctrl+C。主应用只导入 ai_mistake.py 并调用 register，不导入 test_app.py，不再运行第二个 uvicorn。

## 当前验收边界

已通过 Python 28/28：20 项核心/假上游、5 项原有路由、3 项本地服务测试；本地测试包含真实 uvicorn TCP、原前端适配层四种映射、桌面/手机浏览器实际 POST、建议展示与仅页面确认。前端与代理 13/13 通过。修复了实际运行暴露的断连监视取消退出和新版 FastAPI 重复注册保护问题，契约与分类规则不变。未读取 .env、未连接数据库、未调用真实模型。主网站鉴权/额度、PostgreSQL、真实部署生命周期和模型可用性仍需大组环境验收。


## 正常网站的本地入口

启动本 mock 服务和 back 的 Node 服务后，打开 `http://127.0.0.1:3002/`（或 `/index.html`）。此处提供完整原前端并注入同源 AI 地址 `/api`，可在真实课程的错题列表/详情请求 mock；`/demo` 仅为可选独立演示。不要直接打开 file:// 页面，也不需要新增 CORS 放行。正式部署不导入此开发入口，继续使用宿主配置和真实授权依赖。启动脚本已改为打开根 HTTP 地址，具体命令见仓库根目录“启动说明.md”。


## 七种建议模式（与最新总路线对齐）

依据仓库唯一的 `docs/review-system-master-plan.md`（文件修改时间 2026-10-20 03:05:14，文档内更新日期 2026-10-19）。建议可选项为 choice_reproduction/standard/cloze/self_explain/reading/contrast/retry；七项中文分别为选择复现、标准复习、挖空回忆、自述讲解、阅读标记、对比辨析、重新作答。前六项来自模式表，retry 为本次明确追加项。

API 路径、五字段请求和 `{review_method, reason, needs_review:true}` 结构保持不变；可返回七个模式 ID 或 unclassified 兜底标识。unclassified 不是复习模式，前端提示“AI 暂未给出可用建议，请人工选择”，用户须明确选七项之一后才能保存。recall/guided 已不是新响应白名单。

默认 mock 只按现有明确错误类型确定返回：knowledge_gap→cloze，reasoning_gap→self_explain，careless→retry，其余或证据不足→unclassified。没有结构化题型/用途证据时，不擅自推荐选择复现、阅读等；其余模式可由用户人工选择。没有启用任何新复习引擎，也不修改排期、错题类型和复习状态。

测试已更新：Python 29 项包含文档模式清单、Node/Python规则一致性、所有七种模式归一化、旧响应拒绝和真实 HTTP；前端另验证旧 localStorage 只提示重选、不自动迁移。宿主移植测试时需要同时提供上述文档fixture（与原 classification.json 一致性测试相同，运行模块不依赖文档）。
