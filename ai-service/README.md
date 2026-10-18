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

错误格式统一为 `{"error":"CODE"}`：400 输入或 JSON 错误；403 非本机/浏览器来源/代理转发；413 请求过大；415 内容类型或压缩不支持；429 本机频率超限（Retry-After）；502 上游鉴权失败（AI_AUTH_FAILED）或其他上游错误（AI_UNAVAILABLE）；503 上游余额不足（AI_BALANCE_UNAVAILABLE）或上游限流（AI_UPSTREAM_RATE_LIMITED）；504 AI 超时。错误响应不含上游原文、请求正文、堆栈或 Key。不会自动重试或回退到 mock。

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

真实请求会将上述文字发送给 DeepSeek，并可能产生 API 费用。本实现只完成 mock/模拟上游测试，没有使用真实密钥进行联网验收。

按 2026-10-18 核对的[官方 Chat Completions 文档](https://api-docs.deepseek.com/api/create-chat-completion/)，当前支持 `deepseek-flash`、`deepseek-v4-pro`，默认前者；固定请求 `https://api.deepseek.com/chat/completions`，Bearer 鉴权、JSON Output、关闭 thinking、非流式输出。要求模型输出 JSON，并在服务端再次验证。未来模型改版时应重新核对官方文档并更新 config.js 白名单。[官方模型列表](https://api-docs.deepseek.com/api/list-models/)可用于核对账户实际可用模型。

Provider 接口：`classify(input, rules, { signal })` 返回 `{ review_method, reason, needs_review }`。在 `src/providers/` 增加百炼实现，再显式扩展 config.js Provider 白名单与 app.js 工厂选择；不要允许客户端指定上游 URL。统一验证、超时及兜底由 app.js 执行。

## 配置与密钥

环境变量见 `.env.example`：默认超时 15000ms，单进程全局限流每 60000ms 30 次；所有数值需为范围内正整数。HOST 只允许 127.0.0.1，NODE_ENV 仅允许 development/test，AI_KEY_MODE 只允许 development。没有“开放公网”开关。

开发 Key 仅在进程内使用；服务没有请求/上游正文日志、不回显密钥、不持久化 Key，也不会向重定向地址发送 Key。不要把真实密钥写入示例、源码、测试、命令历史或截图。根目录现有 .gitignore 已覆盖 .env 和 .env.*，保留 .env.example。

用户自带 Key：预留 `AI_KEY_MODE=user` 配置名，但当前启动会拒绝；禁止通过请求直接启用。未来必须由正式身份认证后的凭据解析器为每次请求选择 Provider，禁止把用户 Key 放到共享全局 Provider，以免串用。评审后再实现安全传输、用户隔离、加密保存或仅短期驻留、撤销、脱敏和删除机制。

## 安全边界与待完成事项

当前仅用于本机开发：固定回环监听、检查远端和 Host、拒绝带 Origin 与 X-Forwarded-For 的请求、不启用 CORS、不信任代理。暂不支持网页直接跨域调用；本机脚本按示例调用。正式身份认证接入点为 createApp 的 authenticate 参数；默认只是本机门禁，不能提供用户身份验证。仅绑定本机也无法抵挡本机恶意进程或被人为配置的端口转发，因此禁止用反向代理、隧道、容器端口映射将本服务公开。

已经实现：请求体与字段上限、类型校验、白名单结果验证、全局内存限流、Provider 超时与取消、响应体上限、HTTP 接收超时、统一脱敏错误、生产启动阻断。限流进程重启即重置，不能当作线上配额系统。

公开上线前仍必须完成：正式登录与授权、用户/课程数据权限、按用户的分布式限流和并发/费用配额、TLS 与可信代理配置、浏览器接入时的精确来源及 CSRF 策略、用户 Key 治理、脱敏审计与监控、隐私告知及保留策略、提示注入/分类质量评测和人工纠正流程。届时需专项评审并修改启动阻断，不能仅删除校验上线。本版不创建云资源、不购买服务、不自动部署。
