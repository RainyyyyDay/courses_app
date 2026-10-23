# 国外 AI 预设与验证范围（2026-10-23）

本轮加入 OpenAI、Google Gemini、Anthropic Claude、Grok（xAI），与国内预设共用现有业务调用层。

| 服务商 | 基础地址 | 初始常用模型 |
| --- | --- | --- |
| OpenAI | https://api.openai.com/v1 | gpt-6.1-sol、gpt-6-luna、gpt-6-astra、gpt-5.4-mini |
| Google Gemini | https://generativelanguage.googleapis.com/v1beta/openai | gemini-3.8-flash、gemini-4-argon、gemini-3.5-flash-lite |
| Anthropic Claude | https://api.anthropic.com/v1 | claude-sonnet-5-5、claude-opus-5-5、claude-haiku-5-5 |
| Grok（xAI） | https://api.x.ai/v1 | grok-4.7 |

模型 ID 可自行填写，能否调用由该账号的模型权限、额度和地区决定；网页聊天账号不是本项目中的 API 凭据。预设名称按“AI 名称（厂商）”显示，切换后不会把旧服务的 Key 自动传给新服务。

## 适配差异

- OpenAI 使用 max_completion_tokens，不向新推理模型发送旧的 max_tokens；预设 GPT 模型使用低推理强度与 JSON 输出。
- Gemini 使用官方兼容接口，预设 Gemini 3 系列使用低推理强度、JSON 输出及独立输出额度。本轮不支持 Vertex AI 身份认证。
- Claude 使用官方兼容接口。兼容层忽略 response_format，依靠明确的 JSON 提示及现有严格材料校验；不承诺原生 JSON Schema 保证。非工作区作用域 Key 如需工作区 ID，在设置的专用输入框填写。后端仅允许向 api.anthropic.com 发送该字段作为 anthropic-workspace-id，拒绝跨服务传递和换行注入。未加入 Bedrock、AWS 或 Google Cloud 专用认证。
- Grok 使用官方仍支持的 Chat Completions 接口及 JSON 输出，不开启搜索、外部工具或自动重试。

## 你是否必须申请所有平台的 Key

不需要为了测试日常程序逻辑申请所有平台。文档核对与模拟接口可覆盖配置、请求格式、凭据隔离、业务结果校验、错误、取消、超时和页面操作；本轮四家×六类业务入口完成模拟验证。现有国内接口继续回归。

但模拟测试不能证明真实网络、账号权限、余额、模型实际返回质量或服务商服务状态。若要对外声称每个平台已完成真实联调，需要每家至少一个有效 API 账号或正式测试凭据；这是发布前的集成验证，不能通过模拟结果代替。个人使用只需验证自己打算使用的平台。

设置里的验证状态只对当前配置、当前标签页有效。应用或清除设置会重置状态；连接测试通过后仍显示“不代表所有生成场景或模型都已验证”。不会自动读取已有 Key、替你开通账号、充值、调用全部平台或把验证状态持久化。

建议有 Key 后先做一次连接测试，再用一个虚构短文本测试实际需要的材料生成或批改功能。无需反复测试不使用的平台，也无需为验证而上传真实学习资料。

## 官方参考

- OpenAI Chat Completions：https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- GPT 模型：https://developers.openai.com/api/docs/models
- Gemini 兼容接口：https://ai.google.dev/gemini-api/docs/openai
- Claude 兼容接口与工作区：https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk
- Claude 模型：https://platform.claude.com/docs/en/models/overview
- Grok 兼容接口：https://docs.x.ai/developers/model-capabilities/legacy/chat-completions
- Grok JSON 输出：https://docs.x.ai/developers/model-capabilities/text/structured-outputs

## 常用型号更新

2026-10-23 根据官方模型目录补充 GPT-6.1 Sol、GPT-6 Luna、GPT-6 Astra、Gemini 4 Argon、Gemini 3.5 Flash-Lite 与 Claude Opus 5.5。GPT 默认均衡型号为 gpt-6.1-sol，保留 gpt-5.4-mini；应用中的已有配置不自动切换。下拉框的中文定位只作选型提示，发送请求始终使用完整 API ID。

- OpenAI 模型与接口：https://developers.openai.com/api/docs/models/gpt-6.1-sol 、https://developers.openai.com/api/docs/models/gpt-6-luna 、https://developers.openai.com/api/docs/models/gpt-6-astra
- Gemini 目录：https://ai.google.dev/gemini-api/docs/models
- Claude 目录：https://platform.claude.com/docs/en/models/overview

新增型号仍属于文档适配与模拟验证，未使用真实账号逐一调用。
