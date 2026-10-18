# 独立 AI 复习分类服务（本地开发版）

遵循仓库 CommonJS、Express 5、Node.js 24、npm lockfile 和 Node 内置测试约定。不加载 `back`、不访问 SQLite、不修改学习流程、不处理图片。只新增本目录。类别和分类依据尚未确定，本版所有结果 `needs_review: true`（表示需要人工复核），不是判断学生是否需要复习。

## 本地启动

在仓库根目录的 PowerShell：

```powershell
npm ci --prefix ai-service
if (-not (Test-Path ai-service/.env)) { Copy-Item ai-service/.env.example ai-service/.env }
npm start --prefix ai-service
```

默认 mock，无需 Key、无需网络、无需购买服务；端口 3001，与原后端 3000 独立。环境文件已由根 `.gitignore` 排除；不要覆盖已有 `.env`。停止用 Ctrl+C。

```powershell
npm test --prefix ai-service
powershell -File ai-service/examples/classify.ps1
```

自动测试使用临时端口、假 Provider 和假 Key，不调用付费接口、不写项目数据库。

接口约定见 [API_CONTRACT.md](API_CONTRACT.md)；本轮基础审查、CloudBase HTTP 云函数可行性与上线缺口见 [CLOUDBASE_PREPARATION.md](CLOUDBASE_PREPARATION.md)。没有添加可执行云端启动入口或部署脚本，生产保护仍保留。

真实联调按 [本地联调步骤](LOCAL_TESTING.md) 操作。可选 `npm run test:integration --prefix ai-service` 会加载本地 `.env`，仅在有 Key 且 AI_PROVIDER=deepseek 时发送一次真实请求；缺配置则跳过。普通 `npm test` 不加载 `.env`、不执行真实集成测试。

## 接口

`GET /health` → `{"status":"ok","provider":"mock","local_only":true}`。

`POST /api/ai/classify`，Content-Type 必须为 application/json。仅接受以下可选字符串字段（每字段最多 4000 字符，总请求体 16KB）：`question`、`student_answer`、`error_type`、`correct_answer`、`context`。不接受未知字段、对象、图片或请求体中的密钥。字段省略合法；缺少非空题目、学生答案或明确错误类型时，不调用 AI，直接返回 unclassified。全部字段都是不可信文本；不要传入姓名、学号等无关个人信息。

```json
{"question":"1+1=?","student_answer":"3","error_type":"careless"}
```

mock 响应：

```json
{"review_method":"retry","reason":"Mock：按已提供的错误类型匹配临时示例规则，未推断错误原因。","needs_review":true}
```

`{}` 或未知错误类型在 mock 下返回 `unclassified`。真实 AI 不确定时也须使用该兜底类别。后端逐项校验类别白名单、reason、needs_review；不合法结构/类别降级为 unclassified。上游无法解析的 JSON、截断、网络或 HTTP 错误返回 502；超时返回 504，不伪装成成功分类。reason 是模型生成文本，前端应使用 textContent 渲染，不能直接插入 HTML；语义正确性仍需人工判断。

错误格式统一为 `{"error":"CODE"}`：400 输入或 JSON 错误；403 非本机/浏览器来源/代理转发；413 请求过大；415 内容类型或压缩不支持；429 本机频率超限（Retry-After）；502 上游鉴权失败（AI_AUTH_FAILED）或其他上游错误（AI_UNAVAILABLE）；503 上游余额不足（AI_BALANCE_UNAVAILABLE）、上游限流（AI_UPSTREAM_RATE_LIMITED）或本进程 Provider 并发满（AI_BUSY）；504 AI 超时。错误响应不含上游原文、请求正文、堆栈或 Key。不会自动重试或回退到 mock。

分类响应头 `X-AI-Provider` 为配置的 Provider，`X-AI-Result-Source` 区分 `input_fallback`（未调用模型）、`provider`（已获得并校验 Provider 结果）、`validation_fallback`（调用完成但输出结构/类别不合格）、`error`（上游或超时错误）。只有 HTTP 200 + deepseek + provider 的组合才能确认当前调用链已成功请求真实上游并通过结果校验；health 的 deepseek 标记只代表配置。

## 分类配置

编辑 `config/classification.json` 后重启。`categories` 是唯一类别白名单，`description` 与 `instructions` 会进入系统提示词，`error_types` 是 mock 的精确匹配规则。演示映射：knowledge_gap → recall，reasoning_gap → guided，careless → retry，其他 → unclassified。不要把示例标签当作已经确定的教学依据。

新增/删除类别无需改 Provider；id 必须唯一，error_types 不得重复，必须保留 unclassified。真实模型根据配置和输入分类；不能保证与 mock 精确匹配。没有明确错误原因时不从答案推断原因。信息不足的硬性门槛在 app.js 中；团队确定正式证据标准后应一起评审和调整。

## DeepSeek Provider

仅在明确需要真实调用时编辑本地 `.env`：

```dotenv
AI_PROVIDER=deepseek
AI_KEY_MODE=development
DEEPSEEK_API_KEY=在本机填写自己的开发密钥
DEEPSEEK_MODEL=deepseek-flash
```

真实请求会将上述文字发送给 DeepSeek，并可能产生 API 费用。项目负责人已反馈本机 mock 和真实 DeepSeek 联调通过；本轮仅运行无需密钥的自动测试，不读取 `.env`，不重复发起真实付费请求。云端连通和正式上线验收尚未完成。

按 2026-10-18 核对的[官方 Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/)，当前支持 `deepseek-flash`、`deepseek-v4-pro`，默认前者；固定请求 `https://api.deepseek.com/chat/completions`，Bearer 鉴权、JSON Output、关闭 thinking、非流式输出。要求模型输出 JSON，并在服务端再次验证。未来模型改版时应重新核对官方文档并更新 config.js 白名单。[官方模型列表](https://api-docs.deepseek.com/api/list-models/)可用于核对账户实际可用模型。

Provider 接口：`classify(input, rules, { signal })` 返回 `{ review_method, reason, needs_review }`。工厂在 `src/providers/index.js`，未知 Provider 直接拒绝。未来增加百炼时扩展配置白名单和这个工厂，不允许客户端指定上游 URL。分类的输入/输出合同在 `src/contracts/classification.js`，超时、并发门禁及路由在 app.js；没有重复实现已有分类规则。

`error_type` 是调用方明确提供的错误标签，`review_method` 是临时推荐类别，`needs_review` 是人工复核标志。它们不是同一个概念，当前也不会生成复习活动、挖空或评价成绩。未来新任务应有独立路由、输入/输出合同和测试，复用基础防护与 Provider 传输边界；不能把 note_text/score 等字段直接加到现有请求中。

## 配置与密钥

环境变量见 `.env.example`：默认超时 15000ms，单进程全局限流每 60000ms 30 次；所有数值需为范围内正整数。HOST 只允许 127.0.0.1，NODE_ENV 仅允许 development/test，AI_KEY_MODE 只允许 development。没有“开放公网”开关。

新增通用配置：`AI_MAX_CONCURRENT=2`（1–100）限制每个 app 进程同时未完成的 Provider 调用，超限直接 503 AI_BUSY、不排队。容量只在 Provider Promise 真正结束时释放；如果忽略取消，HTTP 超时后仍占名额，直到结束或重启进程。health 和信息不足兜底不占 Provider 名额；调用失败/成功正常释放。该限制不能代替云端多实例共享用户配额或金额上限。

每个进入应用的请求返回服务端生成的 `X-Request-ID`。可设置 `AI_LOG_REQUESTS=true` 输出一行白名单 JSON 诊断，默认 false。仅记录事件、随机请求 ID、固定操作名、状态、耗时、Provider、结果来源和固定错误码；不记录 URL/查询参数、IP、请求头、题目、模型 reason、配置对象、Key 或堆栈。日志写入失败不阻断请求，不回显客户端传入的请求 ID。它是基础排障日志，不是集中监控/费用审计；平台、网关和其他日志源仍需单独配置脱敏。

开发 Key 仅在进程内使用；服务没有请求/上游正文日志、不回显密钥、不持久化 Key，也不会向重定向地址发送 Key。不要把真实密钥写入示例、源码、测试、命令历史或截图。根目录现有 .gitignore 已覆盖 .env 和 .env.*，保留 .env.example。

用户自带 Key：预留 `AI_KEY_MODE=user` 配置名，但当前启动会拒绝；禁止通过请求直接启用。未来必须由正式身份认证后的凭据解析器为每次请求选择 Provider，禁止把用户 Key 放到共享全局 Provider，以免串用。评审后再实现安全传输、用户隔离、加密保存或仅短期驻留、撤销、脱敏和删除机制。

## 安全边界与待完成事项

当前仅用于本机开发：固定回环监听、检查远端和 Host、拒绝带 Origin 与 X-Forwarded-For 的请求、不启用 CORS、不信任代理。暂不支持网页直接跨域调用；本机脚本按示例调用。正式身份认证接入点为 createApp 的 authenticate 参数；默认只是本机门禁，不能提供用户身份验证。仅绑定本机也无法抵挡本机恶意进程或被人为配置的端口转发，因此禁止用反向代理、隧道、容器端口映射将本服务公开。

已经实现：请求体与字段上限、类型校验、白名单结果验证、全局内存限流与 Provider 并发上限、超时与取消、响应体上限、HTTP 接收超时、统一脱敏错误、服务端请求 ID、可选白名单诊断、生产启动阻断。限流进程重启即重置，不能当作线上配额系统。

公开上线前仍必须完成：正式登录与授权、用户/课程数据权限、按用户的分布式限流和并发/费用配额、TLS 与可信代理配置、浏览器接入时的精确来源及 CSRF 策略、用户 Key 治理、脱敏审计与监控、隐私告知及保留策略、提示注入/分类质量评测和人工纠正流程。届时需专项评审并修改启动阻断，不能仅删除校验上线。本版不创建云资源、不购买服务、不自动部署。
