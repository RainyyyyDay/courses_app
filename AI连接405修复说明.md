# AI 连接测试 HTTP 405 修复（2026-10-25）

网站 3000 的本机 AI 网关原来固定转发到 3002。该端口已经运行一个旧版 FastAPI 服务，其 OpenAPI 仅包含旧的 classify 等路由，没有 `/api/ai/test`。连接测试 POST 请求落入静态资源挂载，返回 405，网页因此显示 `AI_UNAVAILABLE / HTTP 405`。这次错误没有到达 DeepSeek，不能据此判断 Key 是否有效。

修复后，一键脚本为本项目设置 `COURSES_LOCAL_AI_PORT=3003`。Node 网关和 Python runner 使用相同端口；旧的 3002 服务保留。网关仍只连接固定的本机回环地址，不接受请求指定的上游地址。

新 AI 服务提供 `/api/ai/local-health`，报告服务版本、项目路径摘要和可用 POST 路由，不读取 Key、不调用模型。启动脚本要求服务属于当前项目且具备 `/api/ai/test`，不会再仅凭端口占用判定 AI 就绪。如果已有网站进程仍使用旧配置，脚本会提示先停止后端再启动。

AI 依赖已按照 `ai-fastapi/requirements.txt` 安装在本项目 `.local-ai-deps`，使用现有的 Miniforge Python，不修改全局包。浏览器仍访问 http://127.0.0.1:3000/ ，无需直接打开 3003。

对于旧版 AI 服务直接返回的 404/405，网关现在返回明确的 `LOCAL_AI_INCOMPATIBLE`，网页显示版本不匹配提示；正式模型上游错误仍保留原有分类。

已完成 12 项启动/网关测试、健康接口测试和 12 项 DeepSeek 接口模拟测试。测试使用虚构输入和模拟上游，没有使用用户 Key 或发送计费请求。实际 Key、账号额度和真实模型连接需要在网页点击“测试连接”验证。

修改前文件保存在根目录 `.ai-405-repair-backup-*`。后端日志为 `local-backend.*.log`，AI 日志为 `local-ai.*.log`。
