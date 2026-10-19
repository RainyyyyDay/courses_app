# DeepSeek 本地联调操作

只在本机运行，不部署、不创建云资源。无需修改 `back` 或前端。真实调用需自行提供有效 DeepSeek 开发 Key，可能产生 API 费用；本说明与集成测试只使用固定虚构题目，不发送真实学生信息。不通过聊天、命令行参数或请求体传递 Key。

## 1. 准备独立模块

使用 Node.js 24，从仓库根目录打开 PowerShell：

```powershell
npm ci --prefix ai-service
if (-not (Test-Path ai-service/.env)) { Copy-Item ai-service/.env.example ai-service/.env }
npm test --prefix ai-service
```

普通测试不加载 `.env`，不会调用真实 AI。已有 `.env` 时保持原文件；通过本地编辑器填写，不输出文件内容。

## 2. 在本机编辑配置

| 环境变量 | mock | 真实 DeepSeek |
| --- | --- | --- |
| AI_PROVIDER | mock | deepseek（必填以切换） |
| DEEPSEEK_API_KEY | 留空 | 自己的有效开发 Key（必填） |
| DEEPSEEK_MODEL | 可保持默认 | deepseek-flash（默认），或 deepseek-v4-pro |
| AI_KEY_MODE | development | development，禁止 user |
| HOST | 127.0.0.1 | 127.0.0.1，禁止公开监听 |
| NODE_ENV | development | development（测试也允许 test），禁止 production |
| PORT | 3001 | 3001，若占用可改为其他端口 |
| AI_TIMEOUT_MS | 15000 | 默认 15000，慢网络可手动改为 30000，最高 120000 |
| AI_MAX_CONCURRENT | 2 | 单进程未结束 Provider 调用上限，允许 1–100 |
| AI_LOG_REQUESTS | false | 可选 true 启用白名单元数据日志，不记录正文/Key |
| RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS | 30 / 60000 | 每进程每分钟 30 次，适合本地联调 |

模型、JSON Output 和 thinking 参数依据 [DeepSeek 官方 Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)；当前配置不接受客户端 URL 或模型参数。请求使用固定 HTTPS 官方地址，禁止跟随重定向。

Node 加载 `.env` 时，终端中已有同名环境变量优先。如果配置与 health 不一致，使用新终端，并移除此前手动设置的对应环境变量覆盖；不要通过输出环境变量诊断 Key。切换 Provider、Key、模型或超时后须先 Ctrl+C 停止旧进程，再重新启动。

## 3. 启动并检查配置

```powershell
npm start --prefix ai-service
```

另一个终端（若改过端口，后续地址也相应修改）：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3001/health
```

确认 `status=ok`、`provider=deepseek`、`local_only=true`。这个检查不调用 DeepSeek，也不能证明 Key 有效。缺 Key 时 deepseek 模式启动失败，不会悄悄变为 mock。

## 4. 发送一次固定示例请求并检查来源

```powershell
$sample = @{
  question = '1 + 1 = ?'
  student_answer = '3'
  correct_answer = '2'
  error_type = 'careless'
} | ConvertTo-Json
$result = Invoke-WebRequest -UseBasicParsing -Method Post `
  -Uri http://127.0.0.1:3001/api/ai/classify `
  -ContentType 'application/json; charset=utf-8' `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($sample))
$result.StatusCode
$result.Headers['X-AI-Provider']
$result.Headers['X-AI-Result-Source']
$result.Content | ConvertFrom-Json
```

成功标准：HTTP **200**，`X-AI-Provider=deepseek`，`X-AI-Result-Source=provider`，返回 JSON 含配置内的 review_method、非空 reason、needs_review=true。真实 Provider 不会在失败时改用 mock。类别可能是 unclassified；只要来源为 provider 就表示收到并通过了校验，不表示分类教学质量已经验证。

响应还有服务端生成的 X-Request-ID，可在启用 AI_LOG_REQUESTS 后用于关联白名单排障日志。不需要也不要打印题目、配置或请求头来排查密钥问题。项目负责人已反馈本机真实联调通过；后续基础改进可先运行普通测试，无需每次重复付费请求。

不要只看响应速度、reason 文案或分类名称判断。`provider=mock` 表示仍在 mock 模式；`input_fallback` 表示信息不足、完全没调用 AI；`validation_fallback` 表示完成上游调用但结果校验未通过。空 `{}` 请求即使在 deepseek 模式也不产生真实调用。上述响应头只含固定枚举，不含 Key、提示词或题目正文。

## 5. 可选：运行一次真实集成测试

```powershell
npm run test:integration --prefix ai-service
```

该独立命令会读取本机 `.env` 到进程，不打印配置；无需提前启动服务。测试启动自己的临时回环端口，通过真实 HTTP 接口发送一次固定虚构题目，使用生产代码的 DeepSeek Provider 和默认 fetch（没有注入 mock），检查 health、响应来源、类别白名单及 JSON 字段；随后关闭服务。端口和题目不会来自已有学习数据。

- 没有配置 Key：显示 SKIP，不发送请求。
- 有 Key，但 AI_PROVIDER 不是 deepseek：显示 SKIP，不发送请求。
- 有 Key 且 AI_PROVIDER=deepseek：执行真实请求，PASS 且退出码为 0 才算通过。配置错误、上游错误、超时或校验降级均会失败，不会按成功处理，也不自动重试。

测试只报告固定名称、成功/跳过/失败及白名单错误码，不打印 Key、请求/响应正文或底层异常对象。跳过不等于真实联调通过。

## 6. 错误定位与结束

| 本地结果 | 手动检查 |
| --- | --- |
| 启动提示 Invalid configuration | 检查必填 Key、Provider、模型、数值范围以及 NODE_ENV/HOST/AI_KEY_MODE；保持生产保护 |
| 502 AI_AUTH_FAILED | DeepSeek 返回 401；在本地确认 Key 有效、未撤销，不要贴出 Key |
| 503 AI_BALANCE_UNAVAILABLE | DeepSeek 返回 402；自行查看账户状态，本服务不会购买或充值 |
| 503 AI_UPSTREAM_RATE_LIMITED | DeepSeek 返回 429；稍后手动再试 |
| 503 AI_BUSY | 本进程 Provider 并发已满；等已有调用结束，不自动重试。忽略取消的 Provider 会一直占用名额，必要时本地重启排查 |
| 502 AI_UNAVAILABLE | 网络/TLS、其他上游 HTTP 错误、非法/过大/截断 JSON 或空内容；先确认网络与模型配置 |
| 504 AI_TIMEOUT | 超时覆盖连接、响应读取和解析流程；检查网络，必要时调整允许范围内的超时后重启 |
| 200 + validation_fallback | 检查类别配置和规则提示；语法合法但类别/字段不合格的结果已安全兜底 |
| 429 RATE_LIMITED | 本地进程限流，按 Retry-After 等待 |
| 403 LOCAL_ONLY | 使用本机 PowerShell 调用，不加 Origin/代理头，不改公网监听限制 |
| integration: LOCAL_CHECK_FAILED | 检查本机监听权限、端口安全策略和配置；也可能是输出校验兜底，按第 4 步查看来源标记 |

限流与超时返回不会包含上游原文。客户端超时/取消无法保证上游不计费，因此不要自动重复发送。联调结束 Ctrl+C 停止服务，想回到离线模式就设置 AI_PROVIDER=mock 并重启。用户 Key 模式、正式认证和公开部署仍未启用。
