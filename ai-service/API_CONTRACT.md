# AI 服务接口契约与并行开发交接确认稿

核对日期：2026-10-18。适用版本：`courses-ai-service` 0.1.0，当前仓库源码。本文用于业务对接和部署交接，**不是 CloudBase 已部署或可公开上线的证明**。

本文只依据源码、配置、测试和已有说明描述现状；建议均单独标注，无法从仓库确认的事项标为“待确认”。本次仅更新已有接口文档，不读取本地 `.env`，不修改代码、不运行真实付费请求、不执行部署。分工：你负责 AI 接口与云函数 API 接入，组员负责复习模式实现；两方先按本文的现有契约和固定示例并行开发，新增功能的候选契约需共同确认后再实施。

## 1. 依据与适用边界

| 依据文件 | 核对内容 |
| --- | --- |
| [src/app.js](src/app.js) | 路由、输入与结果校验、安全门禁、限流、超时和错误响应 |
| [src/server.js](src/server.js) | HTTP 监听入口、接收超时、启动错误处理 |
| [src/config.js](src/config.js) | 环境变量默认值、取值范围、启动阻断及分类配置验证 |
| [src/providers/mock.js](src/providers/mock.js)、[src/providers/deepseek.js](src/providers/deepseek.js) | Provider 行为、上游地址、协议和错误映射 |
| [config/classification.json](config/classification.json) | 当前类别、示例规则与版本标记 |
| [test/service.test.js](test/service.test.js) | 11 组普通测试定义，含模拟上游、本机访问、错误脱敏及超时 |
| [integration/deepseek.test.js](integration/deepseek.test.js) | 可选真实请求的条件、请求路径及验收检查 |
| [package.json](package.json)、[.env.example](.env.example) | 命令、依赖和无密钥配置模板 |
| [README.md](README.md)、[LOCAL_TESTING.md](LOCAL_TESTING.md) | 使用与联调说明，发生歧义时以源码为准 |

当前服务独立于原有学习模块，只处理文字错题复习方式分类；不访问 SQLite、不查询课程或学生数据、不保存分类结果。默认本机基址为 `http://127.0.0.1:3001`。CloudBase 环境 ID、实际域名、访问前缀和部署形态均**待确认**。

### 实现、联调与云端交付状态

| 能力 | 本地实现状态 | 测试依据 | 云端状态 |
| --- | --- | --- | --- |
| GET /health | 已实现 | 普通测试检查 200 与 provider | 仓库未交付云适配/域名或部署验收，尚不能作为云端接口对接 |
| POST /api/ai/classify | 已实现，含 mock 与 DeepSeek Provider | 普通测试覆盖输入、分类、兜底、上游模拟和错误处理；另有可选真实集成测试 | 同上；本次不部署，外部是否另行部署待负责人确认 |
| 真实 DeepSeek 连通 | 已有调用代码 | 集成测试仅在 Key 与 Provider 条件满足时运行；SKIP 不证明连通 | 目标云运行环境的真实调用验收待确认 |
| 智能挖空、答案评价、笔记/资料推荐 | 尚未实现，见第 9 节候选方案 | 没有这些功能的自动测试 | 尚无本模块可部署的对应实现 |
| 云函数 handler、正式认证、网站 AI 接入 | 尚未实现 | 没有云端/登录/网站 AI 集成验收 | 尚未形成可交付的云端接入方案，见第 11 节 |

“已在本地实现”不等于服务此刻正在运行，也不等于已部署。源码无法证明仓库之外的云资源状态；本文不提供虚构线上地址。

## 2. 当前已实现的接口

源码显式声明的业务路由只有以下两个；没有类别查询、登录、批处理、文件上传或复习结果保存接口。未单独实现/测试 HEAD、OPTIONS 契约，也没有 CORS 预检处理接口。

| HTTP 方法 | 路径 | 用途 | 成功状态 |
| --- | --- | --- | --- |
| GET | `/health` | 返回服务配置状态，不请求上游 AI | 200 |
| POST | `/api/ai/classify` | 根据文字信息推荐错题复习方式，必要时兜底 | 200 |

路由没有定义路径参数或查询参数；分类逻辑只读取 JSON 请求体。请求本地服务不需要也不支持传入开发 API Key；Bearer Key 是服务内部访问 DeepSeek 的凭据，不是当前用户身份认证机制。

### 2.1 GET /health

无必填参数、无请求体要求；仍需通过全局本机访问门禁。正常响应为：

```json
{"status":"ok","provider":"mock","local_only":true}
```

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| status | string | 固定为 `ok` |
| provider | string | 当前配置，`mock` 或 `deepseek` |
| local_only | boolean | 当前固定为 `true` |

它不校验真实 Key 是否有效、不检查账户余额、不发送模型请求。`provider=deepseek` 只说明启动配置，不代表真实调用成功。该接口不经过 `/api` 身份中间件接入点和内存限流。

### 2.2 POST /api/ai/classify

请求头：`Content-Type: application/json`；允许正常 JSON charset 表达，如 `application/json; charset=utf-8`。不支持 multipart、图片字段或压缩请求体。

请求体必须为 JSON 对象。**所有字段在语法层面均可省略，没有“缺失就报 400”的必填字段**；但只有 `question`、`student_answer`、`error_type` 经 trim 后全部非空，才会调用 Provider。否则直接返回 200 的信息不足兜底。这与业务调用模型的最低条件是两回事。

| 字段 | 类型 | 请求必填 | 调用 Provider 所需 | 当前用途 |
| --- | --- | --- | --- | --- |
| question | string | 否 | 是，非空 | 文字题目 |
| student_answer | string | 否 | 是，非空 | 学生提交的文字答案 |
| error_type | string | 否 | 是，非空 | 调用方明确提供的错误类型；不能当作 AI 已推断的错误原因 |
| correct_answer | string | 否 | 否 | 可提供参考答案，真实 Provider 将其作为输入文本 |
| context | string | 否 | 否 | 可提供相关说明；不应包含无关个人信息 |

输入约束：

- 每个已提供字段必须为字符串；`null`、数字、布尔值、对象、数组均不合法。
- 每字段原始字符串 `.length` 不超过 4000，随后去掉首尾空白；长度按 JavaScript UTF-16 code unit 计，不等同于 UTF-8 字节数。
- JSON 请求体最多 `16kb`（解析器限制）；不能用多个字段绕过总大小限制。
- 未知字段一律拒绝，包括 `course_id`、`student_id`、`api_key`、`image`、`provider`、`model`。它们都不是当前契约字段。
- 不校验 `error_type` 必须属于示例枚举；未知字符串可以进入 Provider。mock 无匹配时兜底，真实模型按提示与配置处理。
- `correct_answer` 与 `context` 不能替代前三项的调用门槛。缺信息时不会强行调用模型来推断原因。

普通成功示例（mock、错误类型 `careless`）：

```json
{
  "review_method": "retry",
  "reason": "Mock：按已提供的错误类型匹配临时示例规则，未推断错误原因。",
  "needs_review": true
}
```

响应字段：

| 字段 | 类型 | 当前保证 |
| --- | --- | --- |
| review_method | string | 必须是加载的分类配置中某个 category id；兜底为 `unclassified` |
| reason | string | 非空；有效 Provider 结果要求原始长度不超过 500，响应去除首尾空白 |
| needs_review | boolean | 对外始终为 `true`，表示需要人工复核，不是“学生是否需要复习”或“回答是否正确” |

后端校验 Provider 返回值为非数组对象，review_method 命中白名单、reason 为非空字符串且长度合格、needs_review 为布尔值。Provider 返回的其他字段会被丢弃；即使返回 `needs_review=false`，对外仍为 true。中文 reason 是提示要求，不是后端语言识别校验；分类质量与错误原因语义没有被后端自动证明。

### 2.3 兜底与来源响应头

输入不足或 Provider 结构/类别校验不通过时，统一响应：

```json
{
  "review_method": "unclassified",
  "reason": "信息不足或分类结果不可靠，需要人工复核。",
  "needs_review": true
}
```

两者均为 200，用响应头区分：

| 响应头 | 值 | 含义 |
| --- | --- | --- |
| X-AI-Provider | mock / deepseek | 分类处理函数采用的配置，不表示已发起请求 |
| X-AI-Result-Source | input_fallback | 三项最低信息不足，未调用 Provider |
| X-AI-Result-Source | provider | 已获得 Provider 结果且通过结构/类别校验 |
| X-AI-Result-Source | validation_fallback | Provider 已返回可供校验的结果，但结构/类别不合法，安全兜底 |
| X-AI-Result-Source | error | 调用、读取、JSON 解析或超时出错，响应为非 200 |

mock 对未知错误类型会自行返回有效的 unclassified，此时来源仍为 `provider`；真实模型自行选择 unclassified 也可通过校验。不能仅看 review_method 是否为 unclassified 判断请求是否发生。

只有在未注入测试替身的正常服务中，**200 + X-AI-Provider=deepseek + X-AI-Result-Source=provider** 才表示真实上游调用完成且分类结构通过校验。它不保证教学判断正确。非法/空模型 JSON 或截断不是 validation_fallback，而是上游错误 502。

全局应用中间件设置 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff` 并关闭 `X-Powered-By`。分类来源头不保证出现在所有错误上：本机门禁、限流、JSON 解析失败发生在分类处理函数之前；JSON_REQUIRED、INVALID_INPUT 虽有 Provider 头，但没有结果来源头。

## 3. 错误状态码与含义

应用 JSON 错误格式为 `{"error":"CODE"}`。不要把上游 HTTP 状态与本地 HTTP 状态混淆。

| 本地 HTTP | error | 当前触发条件 / 含义 |
| --- | --- | --- |
| 400 | INVALID_INPUT | 分类请求体不是有效对象、存在未知字段、值非字符串或字段长度超限 |
| 400 | INVALID_JSON | JSON 解析器报 400，例如 JSON 语法错误；strict 模式拒绝原始标量也由解析器处理 |
| 403 | LOCAL_ONLY | 远端不是允许的回环地址，或非空 Origin / X-Forwarded-For，或 Host 不匹配本机白名单 |
| 404 | NOT_FOUND | 未命中已实现路由；没有专门的 405 业务响应 |
| 413 | BODY_TOO_LARGE | JSON 解析器请求体大小超限 |
| 415 | JSON_REQUIRED | 分类处理函数收到的 Content-Type 不是 application/json |
| 415 | UNSUPPORTED_ENCODING | JSON 解析器返回 415，包括不支持的压缩/编码；统一用此错误码 |
| 429 | RATE_LIMITED | 当前进程的 `/api` 全局计数超限，附本地 `Retry-After` 秒数 |
| 500 | INTERNAL_ERROR | 进入应用统一错误处理的其他错误；未提供详细异常信息 |
| 502 | AI_AUTH_FAILED | DeepSeek 上游返回 401；不是本地用户未登录 |
| 502 | AI_UNAVAILABLE | 其他上游非 2xx、网络/TLS、读取错误、响应超过 65536 字节、JSON 解析失败、finish_reason 非 stop、无字符串 content 等 |
| 503 | AI_BALANCE_UNAVAILABLE | DeepSeek 上游返回 402 |
| 503 | AI_UPSTREAM_RATE_LIMITED | DeepSeek 上游返回 429；不透传上游错误正文或重试头 |
| 504 | AI_TIMEOUT | Provider 等待超时触发 AbortController；该 catch 分支按 signal.aborted 判断 |

示例：

```json
{"error":"AI_AUTH_FAILED"}
```

`test/service.test.js` 的 `401 AUTH_REQUIRED` 是注入测试身份中间件的示例，**不是默认启动服务已实现的错误响应或登录机制**。未来正式认证的错误合同待确认。

上表描述进入 Express 应用处理链的响应。HTTP 解析失败、Node 接收超时或未来网关拦截可能在应用之外返回错误；不保证遵循该 JSON 格式，CloudBase 网关错误合同**待确认**。服务不会自动重试，也不会在真实 Provider 失败时改用 mock。业务方应区分 200 人工兜底、网络故障和非 200 错误。

## 4. Provider、模型与分类配置

| Provider | 已实现行为 | 凭据 / 网络 |
| --- | --- | --- |
| mock | 用配置中的 error_types 与输入 error_type 精确匹配，输出示例类别；无匹配则 unclassified | 不需要 Key，不访问上游 |
| deepseek | 固定 `POST https://api.deepseek.com/chat/completions`；JSON Output，非流式，thinking disabled，max_tokens=512 | 使用服务端 DEEPSEEK_API_KEY 发 Bearer 请求；禁止重定向 |

模型白名单按当前 `src/config.js`：`deepseek-flash`（默认）、`deepseek-v4-pro`。通过 `DEEPSEEK_MODEL` 选择，不能由客户端传入。这里记录的是代码允许值；部署时账户对目标模型的实际可用性与真实请求验收**待确认**。

内部接口为 `classify(input, rules, { signal })`；返回上述分类对象。百炼 Provider 尚未实现；当前也没有动态 Provider 注册、请求级 Provider 切换或任意上游地址配置。

`config/classification.json` 当前 version 为 `example-1`，仅是待确认的教学规则：

| 明确输入的 error_type | mock 的 review_method | 示例含义 |
| --- | --- | --- |
| knowledge_gap | recall | 回忆知识 |
| reasoning_gap | guided | 引导练习 |
| careless | retry | 重新作答 |
| 其他 | unclassified | 等待人工分类 |

真实 Provider 将 instructions、类别描述、error_types 及输入发给模型，不保证与 mock 字符串匹配结果完全一致；不臆测未明确提供的错误原因属于提示约束，不是语义证明。

配置启动时校验：instructions 为字符串、categories 非空、id 唯一并满足小写字母开头及后续小写字母/数字/下划线（总长最多 40）、description 为字符串、error_types 为字符串数组且整体不重复、保留 unclassified。配置读取后需要重启才生效；分类响应不返回 version，也没有查询配置的接口。正式类别、证据要求、版本兼容策略由业务组**待确认**。

## 5. 启动入口、环境变量与测试

Node.js 要求 `>=24`，CommonJS，Express 5，依赖由本目录 package.json/package-lock.json 管理。没有构建步骤。

从仓库根目录执行：

```powershell
npm ci --prefix ai-service
npm start --prefix ai-service
```

`npm start` 实际入口为 `node --env-file-if-exists=.env src/server.js`，工作目录为 ai-service。只使用进程环境变量时也可在该目录执行 `node src/server.js`。`.env` 加载行为属于 Node 启动参数；已有进程环境变量优先。本文不读取或验证当前本地密钥。

### 环境变量清单（也是未来部署需交接的名称）

CloudBase 应通过选定运行方式的受控环境/密钥注入提供配置，不把真实 `.env` 打包上传。**下表只说明当前程序如何解析，不构成可直接上线的 CloudBase 配置单。**

| 名称 | 当前默认 / 允许范围 | 部署交接说明 |
| --- | --- | --- |
| AI_PROVIDER | mock；只允许 mock、deepseek | 真实调用必须显式 deepseek，mock 不是 AI 验收 |
| DEEPSEEK_API_KEY | 无默认；deepseek 时必须非空 | 由 AI/云接入负责人安全注入，仅交接名称，不在文档/日志/代码中填写值 |
| DEEPSEEK_MODEL | deepseek-flash；另允许 deepseek-v4-pro | 账户可用模型与验收结果待确认 |
| AI_KEY_MODE | 未设置时按 development 行为；只接受 development | user 非空值会阻断启动，不能启用用户自带 Key |
| HOST | 127.0.0.1；代码固定回环监听 | 其他非空值（含 0.0.0.0）会阻断启动，部署监听改造待确认 |
| PORT | 3001；整数 1–65535 | CloudBase 注入端口及转发目标待确认，不能假定就是 3001 |
| NODE_ENV | 可不设置、development 或 test | production 会阻断；不能把伪装 development 当作完成安全上线 |
| AI_TIMEOUT_MS | 15000；整数 1–120000 | 网关/运行时/客户端超时预算需与之协调 |
| RATE_LIMIT_MAX | 30；整数 1–10000 | 当前只是单进程全局次数，不是用户配额 |
| RATE_LIMIT_WINDOW_MS | 60000；整数 1–3600000 | 计数窗口，进程重启即重置 |

数字变量设置为空串、非整数或超范围会被拒绝，不自动回退默认。端口监听或配置失败是启动错误：只输出固定提示并设置失败退出码，不提供可调用的 JSON 配置诊断接口。

测试命令：

```powershell
npm test --prefix ai-service
npm run test:integration --prefix ai-service
```

前者只运行普通测试，不加载 `.env`，使用模拟数据和上游替身；后者才加载本地环境配置，只有非空 Key 且 AI_PROVIDER=deepseek 时执行一次真实请求，否则 SKIP。真实测试启动临时回环端口，不需要提前启动服务；检查 health、真实 Provider 来源和分类字段。SKIP 不算真实成功，PASS 不代表 CloudBase 网关或安全验收。本次文档工作不重新执行真实请求；CloudBase 及目标凭据的验收结果**待确认**。

## 6. 已有安全能力与明确缺口

| 方面 | 当前已实现 | 未实现或限制 |
| --- | --- | --- |
| 身份与授权 | createApp 提供 authenticate 中间件注入点；应用范围 `/api` | server.js 没有注入认证，默认直接 next；无登录/JWT/会话验证、用户/课程权限、角色或网关身份验证 |
| 本机门禁 | 固定监听 127.0.0.1；app 允许回环远端地址；Host 只匹配 127.0.0.1 或 localhost 加可选数字端口；拒绝非空 Origin、X-Forwarded-For；trust proxy=false | 这是本地开发限制，不是正式身份认证，不能防止本机恶意进程或人为代理暴露 |
| 生产保护 | NODE_ENV=production、非回环 HOST、AI_KEY_MODE=user 会被拒绝 | 不是可公开部署版本，尚无经评审的生产运行模式 |
| 限流 | `/api` 中认证接入点之后计数，单 app 进程共享固定窗口；默认 60 秒 30 次；超限返回 429 和 Retry-After | 非按 IP/用户；无分布式存储、并发限制、金额/Token 配额；多个实例分别计数，health 不限流 |
| 输入防护 | 字段白名单、字符串与长度校验、16kb JSON 上限、禁用压缩解包 | 无图片识别、文件扫描、学生身份识别或内容脱敏过滤 |
| AI 超时 | AbortController + Promise.race；默认 15 秒；传递给 fetch，覆盖响应读取；响应连接 close 时取消 | 取消不能保证上游不计费；不是并发排队机制，也不是完整请求 SLA |
| HTTP 接收超时 | server.js：requestTimeout=20000ms、headersTimeout=10000ms | 控制接收请求/请求头，不等同于 AI 处理时长或网关等待时长 |
| 上游与输出 | 固定 HTTPS 地址、禁止重定向、上游读取最多 65536 字节、检查 finish_reason、双层 JSON 解析与字段/类别验证、额外字段丢弃 | 无语义正确性验证、置信度算法或自动纠错；提示注入防护主要依赖提示和结构限制，不能称为全面防护 |
| 密钥与日志 | 开发 Key 用环境变量，应用不记录请求/上游正文、不回传堆栈和原始上游错误；只输出固定启动信息/提示 | 无用户 Key 生命周期治理、集中审计/监控、密钥轮换或加密保存方案；平台、网关和外部日志设置待确认 |
| 浏览器与传输 | 当前不开放 CORS，应用自身提供 HTTP 本机服务 | 无浏览器跨域接入、CSRF 方案或应用内 TLS；云端 TLS/可信代理策略待确认 |
| 数据处理 | 不连接现有 SQLite、不保存题目或 Key；真实 Provider 将输入和分类配置发至 DeepSeek | 无个人数据自动脱敏、隐私授权/保留策略、业务持久化或结果审计；reason 需使用 textContent 安全渲染 |

## 7. CloudBase 部署交接：阻碍与待确认项

**当前不能只填环境变量就公开部署。** 即使进程在某种环境中启动，仍可能因回环监听、本机 Host/远端限制或代理/Origin 头被拦截。不能通过删除保护、改用 development 或清除认证上下文来代替安全改造。下列事项由 AI/云函数接入负责人牵头确认，与复习模式负责人约定集成边界，再在后续独立实现、评审及验收；本文没有实施这些改造。

| 交接项 | 当前事实 | 需 AI/云函数接入负责人确认 |
| --- | --- | --- |
| CloudBase 运行形态 | 当前是常驻 Express HTTP 进程入口，无专用云函数事件 handler | 使用哪种托管/函数/容器形态及对应适配方案，**待确认** |
| 打包与启动 | 独立模块有 lockfile；未提供 CloudBase 部署配置、Dockerfile 或云适配入口 | 部署根目录是否 ai-service、依赖安装命令、启动入口、平台 Node 24 支持与配置方式，**待确认** |
| 地址、端口、健康检查 | 源码回环监听，health 同样受 Host/来源门禁 | 平台要求的监听地址/端口、探针来源与 Host、健康检查路径、独立 readiness 是否需要，**待确认** |
| 网关认证与权限 | 默认无正式认证，Authorization 不会被应用验证 | 网关能否强制认证、应用如何验证可信身份、鉴权失败格式、health 访问范围，以及绕过网关的防护，**待确认** |
| 路由映射 | 应用路径为 /health 和 /api/ai/classify，不带部署前缀 | 外部域名/基础路径、前缀剥离或保留、转发是否改写路径，**待确认** |
| 转发头与代理信任 | trust proxy=false；Origin / X-Forwarded-For / 非本机 Host 将被拦截 | 网关注入哪些头、远端地址变化、可信代理链和防伪造策略，**待确认**；不能盲目信任全部转发头 |
| 浏览器接入 | 当前拒绝来源头，无 CORS 预检契约 | 前端是同源后端代理调用还是跨域直连；来源白名单、OPTIONS、凭据/CSRF 策略，**待确认** |
| 超时和请求限制 | 应用有 16kb、默认 15 秒 AI 超时及 HTTP 接收超时 | 网关/运行时/客户端等待与体积上限、重试策略、断连行为，**待确认**；网关等待需给应用错误响应留余量 |
| 响应透传 | 有 X-AI-Provider、X-AI-Result-Source、Retry-After 和 JSON 状态码 | 网关是否保留状态码/响应头，跨域时如何暴露这些头，网关自身错误格式，**待确认** |
| 出站网络与秘密注入 | 固定请求 api.deepseek.com:443，不支持任意上游 URL | DNS/TLS/HTTPS 出站连通性、凭据注入与轮换、日志脱敏、目标模型/账户验收，**待确认** |
| 扩缩容和成本 | 限流只在单实例内；无并发和费用配额 | 最大实例/并发预算、共享用户配额、告警/审计、密钥费用责任人，**待确认** |

在上述生产改造前，本地联调文档中的限制仍然有效：不要使用公网反向代理或隧道把当前开发接口公开。未来真正上线的环境变量取值、CloudBase 部署文件和操作命令应由部署负责人另行确认，不能将本文列出的本机取值视为最终部署方案。

## 8. 明确尚未实现的业务功能

- 笔记、资料的复习模式推荐；当前没有资源类型字段、相关 Provider 输入或对应路由。
- 智能挖空、填空题生成、提示/引导内容生成；类别 guided 只是一个标签，不会返回引导步骤。
- 答案语义评价、自动判对错、得分或掌握度评估；correct_answer 只是可选输入，needs_review 不代表对错。
- 正式确定的复习类型和分类依据、类别在线查询、配置版本随响应返回、质量评测与人工纠正接口。
- 图片/OCR、多模态、批量分类、流式结果、异步任务、任务进度/取消接口、幂等键或历史记录。
- 课程/用户绑定、数据库写回、复习调度接入、前端业务集成。
- 阿里云百炼、用户自带 Key、正式认证及 CloudBase 适配与公开部署。

## 9. 推荐的后续扩展方案（仅供讨论，均未实现）

优先确定业务语义和独立验收标准，再增加接口；保持现有错题分类的最低信息门槛和人工兜底，不把新字段直接发送给当前接口。

| 建议方向 / 候选接口 | 建议请求要素 | 建议响应要素 | 业务/部署需共同确认 |
| --- | --- | --- | --- |
| GET /api/ai/review-methods | 无或版本过滤 | 类别及描述、rules_version | 类别维护责任人、发布/兼容方式 |
| POST /api/ai/notes/recommend-review | note_text、learning_goal、可选的明确学习证据 | review_method、reason、needs_review、rules_version | 笔记场景类别与最低证据；不要套用错题 error_type 门槛 |
| POST /api/ai/materials/recommend-review | material_text、learning_goal、可选的明确学习证据 | review_method、reason、needs_review、rules_version | 资料场景类别、正文提取/长度与最低证据；当前不处理 PDF/图片文件 |
| POST /api/ai/cloze | source_text、空格数量/难度等受控约束 | 挖空文本、空位标识、参考答案、needs_review | 答案如何隔离到服务端，避免前端泄露；多解与生成质量标准 |
| POST /api/ai/evaluate-answer | question、student_answer、参考答案/评分依据 | 语义评价、依据、人工复核标志；分值若需要再定义 | 评分尺度、公平性、无法判断时的状态，不能从当前 needs_review 推导成绩 |

建议新增稳定的请求标识、契约/规则版本、机器可读兜底原因，使业务无需解析 reason 文案；是否保留来源响应头或增加正文 metadata **待确认**。建议由正式身份认证上下文提供用户身份，服务端验证课程归属，不信任客户端自报 user_id。建议先完成认证、配额和网关边界，再讨论云端持久化、百炼或用户 Key。以上路由和字段名称都是候选方案，不可作为当前可调用接口使用。

### 四类待开发接口的讨论用请求示例

以下 JSON **只能用于讨论或前端本地桩数据设计，发送到当前服务不会实现这些功能**；请求/响应字段、必填项、枚举、长度和错误码均需双方定稿，尚未写入代码。当前请求到这些未实现路径会进入 NOT_FOUND，若先触发门禁/限流等则按对应错误处理。

智能挖空候选请求（POST /api/ai/cloze）：

```json
{"source_text":"水在标准大气压下的沸点是100摄氏度。","blank_count":1,"difficulty":"basic"}
```

建议响应要素为 `cloze_text`、`blanks`、`needs_review`，但空位定位方式、参考答案可见权限及字段结构待确认；当前服务不生成这些字段。

答案评价候选请求（POST /api/ai/evaluate-answer）：

```json
{"question":"植物进行光合作用主要需要哪些条件？","student_answer":"光、水和二氧化碳","correct_answer":"光照、水和二氧化碳","rubric":"按关键要点判断，允许同义表达。"}
```

建议响应要素为 `judgment`、`reason`、`needs_review`；允许“无法判断”的具体枚举、是否需要评分、评分依据与复核流程待确认。不能把当前分类接口当作判分接口。

笔记复习推荐候选请求（POST /api/ai/notes/recommend-review）：

```json
{"note_text":"牛顿第二定律：合外力等于质量与加速度的乘积。","learning_goal":"回顾概念并练习解释适用条件。"}
```

资料复习推荐候选请求（POST /api/ai/materials/recommend-review）：

```json
{"material_text":"本节资料介绍导数定义、几何意义和基本求导法则。","learning_goal":"准备基础概念测验。"}
```

两种推荐建议返回 `review_method`、`reason`、`needs_review`、`rules_version`；类别和证据要求需分别确认，不承诺与当前 recall/guided/retry 相同。组员可以先实现接受这些候选数据的本地界面桩，定稿后再接真实接口；不要把候选字段加到现有 classify 请求里。

## 10. 可直接测试的本地示例

确保本地配置为 mock（使用 `.env.example` 的默认值；若已有本地配置，用编辑器自行确认，勿输出 Key），从仓库根目录启动 `npm start --prefix ai-service`。另开 PowerShell：

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3001/health

$sample = @{
  question = '1+1=?'
  student_answer = '3'
  error_type = 'careless'
} | ConvertTo-Json
$response = Invoke-WebRequest -UseBasicParsing -Method Post `
  -Uri http://127.0.0.1:3001/api/ai/classify `
  -ContentType 'application/json; charset=utf-8' `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($sample))
$response.StatusCode
$response.Headers['X-AI-Provider']
$response.Headers['X-AI-Result-Source']
$response.Content | ConvertFrom-Json
```

对应 HTTP 请求与预期响应（默认示例配置、mock 模式）：

```http
POST /api/ai/classify HTTP/1.1
Host: 127.0.0.1:3001
Content-Type: application/json

{"question":"1+1=?","student_answer":"3","error_type":"careless"}
```

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
X-AI-Provider: mock
X-AI-Result-Source: provider

{"review_method":"retry","reason":"Mock：按已提供的错误类型匹配临时示例规则，未推断错误原因。","needs_review":true}
```

将请求体改为 `{}`，预期为 200、X-AI-Result-Source=input_fallback，并返回第 2.3 节的固定兜底 JSON；此例在 deepseek 模式也不会调用上游。真实 Key 配置、来源确认及错误排查见 [LOCAL_TESTING.md](LOCAL_TESTING.md)。示例只验证本地契约，实际 CloudBase URL 和经网关后的响应尚待 AI/云函数接入负责人确认。

### 可分别复制的请求/响应 JSON

当前 classify 的完整示例请求（不是待开发接口）：

```json
{
  "question": "1+1=?",
  "student_answer": "3",
  "error_type": "careless",
  "correct_answer": "2",
  "context": "用于验证本地接口的虚构题目。"
}
```

默认 mock 模式响应（HTTP 200）：

```json
{
  "review_method": "retry",
  "reason": "Mock：按已提供的错误类型匹配临时示例规则，未推断错误原因。",
  "needs_review": true
}
```

输入不足请求：

```json
{}
```

对应响应（HTTP 200）：

```json
{
  "review_method": "unclassified",
  "reason": "信息不足或分类结果不可靠，需要人工复核。",
  "needs_review": true
}
```

非法字段请求：

```json
{"question":"1+1=?","course_id":1}
```

对应响应（HTTP 400）：

```json
{"error":"INVALID_INPUT"}
```

## 11. 云函数部署后的网站接入方案（待实现）

### 11.1 当前网站配置与未来 AI 基础地址

已核对 [fronted/js/config.js](../fronted/js/config.js)：当前只有原学习后端使用的 `const API = 'http://localhost:3000/api'`。没有已接入的 AI 基础地址或 CloudBase SDK 调用；当前 ai-service 也未接受浏览器 Origin 请求。以下是未来集成约定，不是现在可直接运行的云端功能；本次不修改前端文件。

部署完成并通过认证/网关验收后，由 AI/云函数负责人交付：外部 HTTPS 基础地址、网关前缀、最终路径映射、认证方式及测试环境标识。建议网站另设公开配置名 `AI_API_BASE`，保留原 `API` 给课程/资料等现有接口，避免把原数据库请求误发到 AI 服务。

建议定义：`AI_API_BASE` = 对外协议、域名及网关公共前缀，**不包含**应用路径 `/api/ai/classify`。调用时拼接 `${AI_API_BASE}/api/ai/classify`；不要重复拼接 `/api`，也不要把基础地址配置为 DeepSeek 官方地址。例：

| 环境 | 建议 AI_API_BASE | 拼接后的分类地址 |
| --- | --- | --- |
| 本机独立服务 | http://127.0.0.1:3001 | http://127.0.0.1:3001/api/ai/classify；当前仅脚本可联调，不承诺浏览器可直连 |
| 云端 HTTP 映射（假设网关保留 /ai-service 前缀） | https://ai-api.example.invalid/ai-service | https://ai-api.example.invalid/ai-service/api/ai/classify |

`.invalid` 是不可用的演示域名，不是真实云地址；云端前缀是否存在/是否剥离待负责人确认。若网关对外重写路径，需要以最终映射更新拼接规则，不能猜测。现有原生前端没有构建时环境变量替换机制；AI_API_BASE 可通过将来新增的普通脚本或运行时公共配置注入，名称与加载顺序需实施时确认。浏览器可见配置只放公开地址，不放 DeepSeek Key、服务管理凭据或长期服务端秘密。

如果采用纯事件型云函数/SDK 调用而没有 HTTP 映射，则需要另行约定函数名、事件参数和响应封装，不能直接把函数名当作 fetch URL；当前仓库没有这类适配器。

### 11.2 网站身份认证与服务端验证（待实现）

当前没有登录接口或有效的客户端身份协议；`Authorization` 在默认启动服务中不会被验证。建议上线前共同选定登录与身份系统，再完成以下链路：

1. 网站通过确定的登录系统获取代表当前用户的短期访问令牌；提供方、SDK/登录流程、Token 格式、刷新/退出策略待确认。
2. 对 HTTP 映射方案，建议使用 `Authorization: Bearer <用户访问令牌>` 发送业务请求。它是用户登录凭证，**不是 DEEPSEEK_API_KEY**；不通过 URL 查询参数传递，不写入日志。
3. 云函数或受信任网关验证令牌真实性、有效期、签发者/受众（如所选方案适用），形成可信用户身份；业务层验证课程/资源归属。不能只根据 Header 存在或客户端自报 user_id 放行。
4. 网关和应用必须明确谁负责验证，以及如何保证验证上下文不可伪造、接口不可绕过网关直接访问；当前 authenticate 接入点尚未连接这套实现。
5. 建议未来将缺失/失效用户凭证约定为 401、权限不足为 403，并约定机器错误码及过期后的界面行为；具体码值尚未实现。当前 `502 AI_AUTH_FAILED` 是上游开发 Key 的问题，不应被界面当成“请学生重新登录”。

网站调用形态示意（仅将来完成认证和浏览器接入后使用）：

```js
// AI_API_BASE 来自将来的网站公共配置，accessToken 来自选定的登录系统。
const response = await fetch(`${AI_API_BASE}/api/ai/classify`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`
  },
  body: JSON.stringify({
    question: '1+1=?',
    student_answer: '3',
    error_type: 'careless'
  })
});
const result = await response.json();
// 业务层先处理 HTTP 非成功状态，再按第 2.3 节识别人工兜底。
```

跨域 HTTP 方案还需实现来源白名单、OPTIONS 对 Content-Type/Authorization 的允许规则，以及 X-AI-Provider、X-AI-Result-Source、Retry-After 的可读响应头配置；当前均未完成。若改为同源业务后端代理，也要验证用户身份、保留必要来源信息并保护 AI 上游访问。具体采用哪种入口待确认；不能以删除本机门禁替代正式认证。

## 12. 交给复习模式组员的并行开发清单

| 交接内容 | 复习模式组员可以先做什么 | AI/云函数负责人后续交付 |
| --- | --- | --- |
| 第 2–3 节：已实现契约与错误表 | 按五个可选字符串组装请求，只使用实际已有字段；显示 reason 和人工复核状态，区分输入错误/限流/上游失败 | 保持字段合同；必要变更先协商 |
| 第 4 节：临时类别与含义 | 建立 review_method 到复习流程的显式映射，保留 unclassified 手动入口；不要按 reason 文案分支 | 与业务方确认正式类别、错误类型证据和规则版本 |
| 第 10 节：固定 JSON 示例 | 不依赖云服务，先用本地桩数据实现加载中、成功、人工兜底、失败状态；连接脚本可用 mock 服务 | 本地服务与后续云端联调环境 |
| 第 8–9 节：尚未实现的四类功能 | 确认挖空展示、答案可见权限、评价尺度、笔记/资料所需模式和界面交互；候选 API 仅用桩数据 | 定稿后的请求/响应、验证规则、模型调用与测试，不把建议当成已完成 |
| 第 11 节：API 地址与认证边界 | 预留可替换的 AI 调用适配层和登录状态处理；业务逻辑不写死域名，不接触开发 Key | 确认后的 AI_API_BASE、路由映射、身份令牌协议、网关限制和验收结果 |

双方先确认三件业务事项：每个 review_method 对应什么复习流程，error_type 的来源和可用证据是什么，信息不足/评价不确定时如何人工处理。`needs_review=true` 当前始终表示人工复核，不能用它计算复习完成或学生掌握度。

整合验收建议覆盖：四个示例类别、缺信息的 unclassified、未知类别输出的安全兜底、400/429/502/503/504、真实上游来源、未来的未登录/无权限与域名切换。组员不需要真实 AI Key 或云管理权限来先完成模式界面与桩数据测试；正式云端整合需待认证和第 7 节网关事项完成后进行。
