# 国内 AI 服务商预设（2026-10-23）

打开右下角“AI 设置”，选择服务商及模型（地址默认折叠在高级设置内），填写该平台 API Key、确认授权，再应用设置。应用本身不调用模型；“测试已应用的连接”会执行一次模型请求，可能计费。

| 服务商 | 默认接口基础地址 | 常用模型选项 |
| --- | --- | --- |
| 智谱 GLM | https://open.bigmodel.cn/api/paas/v4 | glm-5.3-flash、glm-5.3、glm-5.3-flashx、glm-4.7-flash |
| DeepSeek | 官方固定接口 | deepseek-flash、deepseek-v4-pro |
| 通义千问（阿里百炼） | https://dashscope.aliyuncs.com/compatible-mode/v1 | qwen3.7-plus、qwen3.8-max、qwen3.8-flash、qwen-plus、qwen-flash |
| Kimi（Moonshot） | https://api.moonshot.cn/v1 | kimi-k3、kimi-k2.6 |
| 豆包（火山方舟） | https://ark.cn-beijing.volces.com/api/v3 | doubao-seed-2-1-pro-260915、doubao-seed-2-1-lite-260915，或手动填写 ep- 接入点 |
| 硅基流动 | https://api.siliconflow.cn/v1 | deepseek-ai/DeepSeek-V4.1-Flash、zai-org/GLM-5.3-Flash、zai-org/GLM-5.3、Pro/moonshotai/Kimi-K2.6，另保留原 Qwen2.5 与 DeepSeek-V3.2 选项 |

普通 API 预设不等于开通权限，也不代表套餐订阅可用于普通 API。服务商型号和开通范围会变化，以控制台可用模型为准；兼容接口预设都允许自行修改地址和模型 ID。百炼默认中国内地地址，官方现有域名仍可使用，也可改为业务空间专属域名；其他地域必须使用对应地域的 Key 和地址。智谱 Coding Plan、百炼 Coding/Token Plan、Kimi Code 等专用产品凭据不能直接混用。

预设共用现有业务调用层，实际请求仍为 compatible 或 deepseek，不改变数据库结构。后端按实际目标域名设置 JSON、思考与输出额度参数；未知自定义地址保留最少参数。Key 只存在标签页内存和单次后端请求中，默认下一次请求后用完。切换服务商会清空未提交的 Key 和勾选授权，不自动应用或发送请求；已应用状态仍在页脚明确显示。

## 逐空参考修复

复习历史只有在 modeId=cloze、referenceAvailable=true 且有非空答案时显示“各空参考答案”。按空位序号列出答案和同义答案，非挖空模式和空数组隐藏；尚未揭示答案时不会提前显示。查看历史不调用模型或改写记录。

## 官方文档

- 智谱：https://docs.bigmodel.cn/cn/guide/develop/openai/introduction
- DeepSeek：https://api-docs.deepseek.com/api/create-chat-completion/
- 百炼：https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope
- Kimi：https://platform.kimi.com/docs/get-api-key 、https://platform.kimi.com/docs/models
- 火山方舟：https://api.volcengine.com/api-docs/view?action=ChatCompletions&serviceCode=ark&version=2024-01-01
- 硅基流动：https://docs.siliconflow.cn/docs/api/chat-completions-post

## 验证范围

使用虚构 Key、模拟模型响应和临时业务库验证六家预设的配置、请求、模型选择、接入点输入、标签页凭据与跨服务隔离；后端验证各平台参数；历史页面和材料流程覆盖桌面及手机视口。不读取现有用户数据或 Key，不自动发送真实付费模型请求。未逐家完成真实账号联调。

2026-10-23 常用文本型号核对来源：

- GLM：https://docs.bigmodel.cn/cn/guide/start/model-overview
- 千问：https://help.aliyun.com/zh/model-studio/models
- 豆包：https://docs.volcengine.com/docs/ark/model-list?lang=zh
- 硅基流动：https://www.siliconflow.cn/models
- Kimi：https://platform.kimi.com/docs/models
- DeepSeek：https://api-docs.deepseek.com/quick_start/pricing/

DeepSeek 的 deepseek-flash 为官方滚动别名，目前对应 V4.1-Flash-1017；Kimi 已有 K3，保留通用模型，未加入本项目不需要的代码专用型号。
