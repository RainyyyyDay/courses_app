# AI 错题分类 FastAPI 移植模块

## 可选作答批改（2026-10-22）

新增 `src/ai_review_feedback.py`，以 `register(app, dependencies=[Depends(宿主真实权限依赖)])` 挂载 `POST /api/ai/review-feedback`。复用现有 Provider 与共用 AI 设置，不新增依赖、不操作数据库。正常复习页提交后按需请求，返回判断、错误解释、参考解答及改进建议；不替换客观判分、自评或排期。Mock 明确不实际批改。接口合同及网页验证见 [作答批改说明](../docs/review-ai-feedback.md)。本地使用前重启3002。

## 复习材料草稿（2026-10-21）

新增 `src/ai_material_draft.py`，复用现有 `ai_mistake.py` 的 DeepSeekProvider/Classifier/请求保护，不新增依赖、不读写数据库。宿主可通过 `from src.ai_material_draft import register`，再调用 `register(app, dependencies=[Depends(宿主真实权限依赖)])` 挂载；不提供权限依赖时拒绝请求。

`POST /api/ai/material-draft` 请求为 `{provider:"deepseek",api_key,model,confirm_cost:true,input:{kind:"mistake/material/note",mode_id:"standard/cloze/self_explain/contrast/reading",content,reference?}}`。kind/mode_id 为枚举中的单个值；不接受自定义地址或 retry。正文及参考文字各最多4000 UTF-16单元，整个JSON最多16384字节。返回 `{provider,mode_id,draft:{material,needs_more_information,caveats,needs_review:true}}`；信息不足时 material=null，并说明缺项。返回结果不保存、评分或执行复习。

正常网站材料编辑器读取共用 AI 设置；真实返回材料经过结构/空位对应校验，用户可独立编辑预览，明确确认后补空白或替换，再走原正式材料保存及开始流程。独立测试页是 `/ai-test`，网站 AI 设置中的本地链接可打开；它不会继承网站标签页的 Key。原 Mock 材料演示仍独立保留，真实调用失败不回退 Mock。详见 `docs/review-material-readiness.md`。

## 资料／笔记复习建议（2026-10-21）

新增可选模块 `src/ai_review_suggestion.py`，用 `register(app, dependencies=[Depends(宿主真实权限依赖)])` 挂载 `POST /api/ai/review-suggestion`，缺权限依赖默认拒绝。JSON `{provider:mock/deepseek,input:{kind:material/note,title?,content,goal?:remember/understand/compare/practice/read/空字符串,recall?},api_key?,model?,confirm_cost?}`；各输入字符串最多4000 UTF-16单元，总体16KB，真实凭据和费用确认沿用现有约束。响应 `{provider,result:{review_method,reason,needs_review:true}}`，六种公开模式，不操作数据库。复用 ai_mistake 的 HTTP/并发/超时/取消基础，无新增第三方依赖。已注册本地开发服务，使用前重启 3002。正常网页入口和验收见 [资料笔记/OCR修正](../docs/review-resources-ocr-fixes.md)。

## 第二轮补充：统一设置（2026-10-21）

正常网站右下角新增“AI 设置”，错题建议与答案/解析草稿共用标签页内临时 Key。保留 Key 和保存新错题后的自动分析均需显式同意；自动分析默认关闭，只生成待确认的内存草稿。未实现账户登录、永久 Key 或主后端整合，Python 继续复用已有权限依赖。范围、安全边界、宿主身份钩子及验收见 [第二轮说明](../docs/ai-settings-round-two.md)。下文“未做统一设置”等为此前记录，以本节为当前状态。

## 可选按钮：生成参考答案与解析草稿（2026-10-21）

入口在新增错题、编辑错题的“解析 / 错因”输入区下方，按钮为“AI 生成答案与解析（可选）”。默认折叠，不要求使用；展开后选 DeepSeek 官方、输入临时 Key 并确认费用，再点击“生成草稿（不保存）”。Mock 只演示流程，明确不提供本题答案，不能把它当成真实解答。图片题先手工或 OCR 校对题干，不自动读取/上传附件。修改了 Python 路由，使用前须重启 3002，再 Ctrl+F5。

草稿先独立预览，可编辑答案/解析并查看待核实点。勾选人工核实确认后，才能“仅填空白字段”“替换答案”或“替换解析”；填入后仍须点击原保存按钮。支持撤回上次填入，若此后又手动编辑，为保护新输入拒绝自动撤回。题干、题型、单/多选或选项改变会拒绝旧草稿；取消、关闭、切题或保存关闭时清空临时 Key/草稿并取消或丢弃晚到响应。请求中手工输入不被覆盖，失败保留原内容/已有草稿，不自动重试或回退 Mock。

选择题先提供完整选项，AI 只返回所给选项 ID 的候选答案，不得新增选项；候选不会自动选中正确答案，必须人工核实并明确填入，保存仍复用原校验与题目修改规则。原历史记录和评分不被生成/采用操作改写。开放题给参考要点；所有 AI 内容未必正确，不能因成功生成就当作客观判分依据。普通复习页未新增生成入口，不提前泄露答案。来源提示仅在当前草稿界面展示，未增加永久来源审计字段或数据库结构。

新增自包含路由模块 `src/ai_answer_draft.py`（复用同目录 ai_mistake.py 的 HTTP/限流/取消基础），通过 `register(app, dependencies=[Depends(宿主真实权限依赖)])` 注册 `POST /api/ai/answer-draft`。不传依赖拒绝使用，不写数据库或读 .env。JSON 请求为 `{provider:mock/deepseek,input:{question,question_format:open/choice,choice_type:single/multiple,options:[{id:A,text:...}],existing_answer?,existing_explanation?},api_key?,model?,confirm_cost?}`，仅 DeepSeek 必须提供本次凭据/费用同意；不接受自定义地址或额外字段。成功返回 `{provider,draft:{answer,explanation,choice_answer,caveats,needs_more_information,needs_review:true}}`。条件不足允许空答案并列出缺失信息，不编造；原题/已有答案均为待核对输入。草稿模块独立于模式分析，复用固定官方传输、1600 token上限、15秒超时、每应用/worker的本功能每分钟10次与并发2个限制；线上用户/全局配额仍由宿主负责。没有新增第三方依赖。

新增前端 `fronted/js/mistakeAnswerAi.js`，在原新增/编辑流程内挂载，不改原手工字段和保存接口。新增 Python/浏览器测试 `tests/test_answer_draft.py`、仓库 `tests/mistake-answer-ai.cjs`，全部虚构 Key、假上游和临时数据库。真实模型的参考答案/解析质量、延迟和费用仍待用户人工验收，未做真实请求。正常AI学习分析、临时Key测试和手动复习继续保留。

最终Python59/59、Node集中40/40通过，无跳过；最后专项8/8复测通过，已查看桌面/手机截图，JS语法和git diff --check通过。首轮夹具与Windows浏览器临时目录清理问题及实际命令见冲刺文档末节。没有真实调用、依赖安装、原数据库读取或Git提交；不能把假上游成功当成真实答案正确。

## 第一轮：真实学习分析与 Mock 分离（2026-10-21）

错误原因不再必填，默认“不确定，请 AI 辅助分析”；正常面板、列表、新增错题和独立测试工具均允许只提供题目与学生答案。增加可选解题过程；已有分类只是用户线索，题型仅在已有记录确认后传入，否则 unknown。临时 Key、安全门禁和人工确认流程不变，本轮不做统一账户/Key 设置或自动调用。

真实 DeepSeek 提示词不再接收 DEFAULT_RULES 的演示映射，只接收七模式定义、分析要求和用户证据。允许提出有依据的候选错因，但必须区分观察、推测、过程证据和局限；未知错因不再阻止调用。特别要求核验可能有误的参考答案、对正确作答不制造错误、对缺少过程的单次错误不直接断言知识缺漏或粗心。JSON 结构校验不是语义准确性的保证。

保留 `review_method/reason/needs_review`，真实结果新增必需的 `analysis`：`answer_status`、`observations`、`possible_causes`（category/support/explanation/evidence）、`follow_up_questions`、`reference_check`、`alternatives`（mode_id/reason）。服务端严格限长、限条数并丢弃未知字段，按模式附加可信的 `material_requirements`，不接受模型声称材料已经创建；题型未确认时拒绝选择复现建议。正确作答却同时编造候选错因的结构也拒绝。普通 Mock 保留原三字段演示输出，未提供标签时明确说明未做真实分析。

前端把分析各项分区、以 textContent 显示；候选错因不等于错题分类，观察也标注需核对。补充问题可通过“解题过程/补充说明”手动提供后再次请求；没有自动追加对话或收费。只在用户明确确认时按旧方式保存模式 ID，不存分析、理由或 Key；既有材料、评分、会话、排期不自动改变。真实响应缺少分析或格式无效，普通 classify 接口按既有合同返回人工兜底，临时 Key 入口明确返回 INVALID_RESPONSE，不伪装成真实分析或回退 Mock。

真实响应输出上限由 512 调至 1600 tokens，以容纳结构化分析；可能增加输出费用，仍需用户逐次明确同意。超时、并发、地址限制和凭据处理沿用现有机制，没有新增依赖。修改 Python 后必须重启本地 3002，再 Ctrl+F5；页面/脚本版本号为 20261021-analysis-1，仅刷新不能更新正在运行的 Python 模块。

真实质量验收清单：[六组虚构题目与人工判据](../docs/ai-analysis-acceptance.md)。本轮只跑假上游/本地临时夹具，不发送真实模型请求；自动化通过不等于 DeepSeek 的真实准确性、延迟、稳定性或费用已验收。

本轮回归 Python 51/51、Node集中40/40，通过且无跳过；JS语法和git diff --check通过。新增9项分析提示词/结构回归，原网页双视口整链路也验证了错误原因留空、分析分区、明确确认、评分/会话保护及不保存分析或Key。已查看桌面/手机截图。只使用虚构Key、httpx.MockTransport和临时SQLite，没有真实调用、依赖安装、原数据库访问或Git提交。完整命令和边界见冲刺文档末节。

## 网站 AI 面板已接入临时 DeepSeek Key（2026-10-21）

若切换时报 `changeMistakeAiProvider is not defined`：本轮核对 3002 直接 GET 的脚本与磁盘一致且包含函数、语法通过，但旧静态响应没有缓存控制，现象最符合新 HTML 与旧缓存脚本混用。已给两个 AI 脚本和样式加 `v=20261021-byok-2`，当前运行中的 3002 已能返回带版本入口和正确函数；普通重新加载即可使用新资源，不需要清空浏览器数据（会丢失本地建议）。本地 FastAPI 页面及 JS/CSS 还设置 no-store，后者需重启 3002 后生效，不影响生产宿主缓存策略。实际 Chrome 先载入并缓存不含新函数的旧脚本，再导航新首页，桌面/手机均能通过真实 onchange 展开临时 Key 区域。修复后 Node AI 测试 15/15、Python 42/42 通过，JS 语法与 git diff --check 通过；没有调用真实模型或修改实际数据库。

不必先到独立测试台：打开正常网站 `http://127.0.0.1:3002/`，从错题列表的 AI 建议、错题详情的 AI 分类，或新增错题的 AI 复习建议中，将“本次 AI 来源”改成“DeepSeek 官方（临时 Key）”。填写本次 Key、模型，勾选发送内容/费用确认，再点原来的“获取 AI 建议”。使用更新前已运行的 3002 服务时先重启该服务，再 Ctrl+F5。

未明确选择 DeepSeek 时仍走原网站接口（本地 Mock）。明确选择后 Key 缺失/无效或未确认费用会拒绝请求，不能悄悄回退 Mock。Key 发送后立即清空；重试必须重新填写和确认。取消、关闭、新开面板、切回默认来源和页面离开也会清空。凭据只在本次请求中传递，不进入建议状态、错题数据或浏览器存储。普通 HTTP 远端和跨来源接口不接收临时 Key；本机回环 HTTP 或同源 HTTPS 才允许，生产宿主需同源路由和真实授权依赖。

前端复用 `POST /api/ai/test` 的 classify 动作及现有真实 Provider，将结果归一为原 `{review_method, reason, needs_review}`。返回后继续原人工复核/确认保存流程，只保存最终模式，不保存 Key。原建议驱动的页内复习、材料检查、评分、历史和计划保持不变；请求失败保留上次建议/确认选择。新增错题仍须先明确采用，再创建成功才关联保存。没有新增数据库字段、登录或主后端集成。

相关前端为 `fronted/index.html`、`fronted/js/ai.js`、`fronted/js/mistakeAi.js` 和少量样式；Python 继续使用下方的两个可选模块。独立测试页仍可使用，两条入口共用同一个后端，不会各造一套模型调用逻辑。下节 41/15 项为此前独立工具测试记录，网站接入验证另记于本节。

网站接入最终回归：Python `unittest discover -s tests -v` 42/42，通过且无跳过；Node `node --test tests/start-local.cjs tests/review-sprint.cjs tests/review-mode-rules.cjs tests/mistake-ai.cjs tests/ai-proxy.cjs` 38/38，通过且无跳过。Python 新增的整链路用例调用真实 Chrome 桌面/手机视口、原网站首页与原 AI 面板、临时独立 Node/SQLite 业务夹具及假 DeepSeek 上游，验证原按钮→建议→明确确认→原页内 self_explain→原评分与会话完成，且每个会话只记录一次 Hard、计划不变。另测新增错题明确采用、列表取消、缺 Key/未同意拒绝、失败保留旧建议、默认 Mock、同源限制与凭据不入存储。初轮修正了夹具的创建状态码预期和跨测试共享限流桶问题，再完整复测。JS 语法和 git diff --check 通过。没有读取 .env、用户原数据库/上传内容，没有真实模型调用、依赖安装或 Git 提交。真实账户、额度、网络仍需用户自行填写 Key 验证；普通浏览器面板已接线，不是仅独立测试台成功。

## 新增：DeepSeek 官方临时 Key 测试台（2026-10-21）

本地启动后打开 `http://127.0.0.1:3002/ai-test`，或独立运行下面的 uvicorn 命令后打开同一地址。这里无需 Node 或数据库；不要为测试启动原数据库。使用一键入口时仍会按原行为启动网站业务后端。

1. 在密码框输入自己的 DeepSeek 官方 Key（不要把 Key 发给他人或提交 Git）。
2. 选择模型，勾选费用/内容发送确认。默认 deepseek-flash；可选 deepseek-v4-pro。地址、模型依据 [DeepSeek 官方接口文档](https://api-docs.deepseek.com/api/create-chat-completion/) 核对，不接受任意 URL 或中转站。
3. 点击“测试连接”仅发送固定虚构题目，但仍可能计费；“测试复习建议”发送页面中的题目和作答，验证实际建议格式。两个按钮复用已有 DeepSeek Provider 与结果校验，不是只验证 HTTP 200。
4. 请求发出后 Key 和费用勾选立即清空，再次请求须重新输入和确认。页面不自动发送请求、不自动重试、不自动回退 Mock；错误只显示脱敏信息。

新增 `src/ai_deepseek_test.py` 导出独立的 `register(app, dependencies=...)`，注册 `POST /api/ai/test`。它复用同目录 `ai_mistake.py`，因此交接这个可选功能需要两个 Python 文件；没有新增第三方依赖。现有 `register`、环境变量方式和普通网站 Mock 不变，结果不自动保存/应用到错题，不改变材料、评分、会话或进度。临时 Key 不写数据库、文件、环境变量或浏览器存储，不放到共享 Provider；按请求隔离，应用内共享每分钟 10 次、同时 2 个调用限制。此限制不是分布式用户配额。

测试页文件为 `deepseek-test.html`、`deepseek-test.js`，由开发入口显式提供，不在生产环境自动挂载。正常网站 AI 面板默认走原 Mock/宿主接口，临时 Key 的可选接入见上节；独立测试页的结果仍仅展示，不覆盖已保存建议。这不是永久 Key 设置功能。`test_app.py` 的普通分类接口始终 Mock，但新增测试路由会在明确点击并提供临时 Key 后调用官方服务，不应再把整个开发服务理解为绝对不会发模型请求。

可选模块接入（宿主提供真实鉴权/AI 权限依赖，不导入本地 test_app）：

```python
from src.ai_deepseek_test import register as register_deepseek_test
register_deepseek_test(app, dependencies=[Depends(require_ai_permission)])
```

不传依赖时拒绝请求，不能用空依赖函数绕过生产鉴权。本机入口以回环、Host/Origin/转发头限制代替开发身份，仅可本机使用；不能公开、反向代理或用于线上。线上应使用 HTTPS、宿主授权和请求体/日志/异常跟踪脱敏；服务器必然接触本次 Key，不能承诺服务器无法看到，清空字段也不保证安全擦除内存或浏览器插件不会保存。

JSON 请求只接受 `api_key`、`model`、`action`（connection/classify）、`confirm_cost: true` 和 `input`。classify 的 input 沿用下文扩展契约，其中仅 question/student_answer 必填非空；错误原因可省略。connection 忽略 input，用固定虚构题目。成功返回 `{ok, provider, model, action, elapsed_ms}`，classify 另有 `result`（建议和结构化分析）。连接成功不等于真实教学质量已验收。额外错误：400 COST_CONFIRMATION_REQUIRED/INVALID_API_KEY、502 INVALID_RESPONSE；其他沿用原 Provider 的超时、鉴权、余额、上游错误映射。

测试台以人工输入 Key 为本次明确授权，不使用环境变量 Key，也不需要全局 AI_ENABLE_REAL 开关；不会更改原模块的 AI_KEY_MODE=development 限制。这是隔离的可选入口，不是将用户密钥偷偷放进服务器统一凭据。

本轮验证：`python -B -m unittest discover -s tests -v` 41/41 通过（原有 29 项与新增 12 项，无跳过）；`node --test tests/mistake-ai.cjs tests/ai-proxy.cjs` 15/15 通过。新增浏览器测试实际访问本地 FastAPI 测试页，覆盖 1280×960、390×844，逐次点击连接/建议/失败分支，断言两种视口总共只有 6 次假上游请求，未勾选不请求、Key 即时清空、无浏览器存储、结果按纯文本显示；已检查两种视口截图。另验证按请求隔离、固定官方地址、费用确认、输入限制、默认拒绝、跨来源拒绝、超时、限流/共享并发和普通 Mock 不变。JS 语法与 git diff --check 通过。全部使用虚构 Key/httpx.MockTransport，无真实模型请求、.env、数据库或依赖安装，未提交 Git。真实账户、网络与模型可用性待用户在本机手动测试；不能把假上游通过当成真实调用成功。

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

请求头必须 `Content-Type: application/json`，可带 charset。原 question/student_answer/error_type/correct_answer/context 五字段保持兼容，增加可选 solution_steps、mistake_category（knowledge/thinking/execution/unclassified）、question_format（choice/open/unknown）。已提供值必须是字符串；每字段最多 4000 个 JavaScript UTF-16 单元，总请求体最多 16384 字节。只有题目、学生答案是调用门槛；其他可省略。拒绝未知字段、图片、用户 ID、模型/Provider/Key 等客户端配置；拒绝压缩请求体。

```json
{"question":"1+1=?","student_answer":"3","error_type":"careless","correct_answer":"2","context":"虚构联调题目"}
```

mock 成功响应：

```json
{"review_method":"retry","reason":"Mock：按已提供的错误类型匹配临时示例规则，未推断错误原因。","needs_review":true}
```

确定的 Mock 演示映射仍为 knowledge_gap → cloze、reasoning_gap → self_explain、careless → retry、其他 → unclassified，只限 Mock。题目或学生答案缺少时不调用 Provider，返回 `unclassified` 人工兜底。没有 error_type 仍可调用：Mock 标注未做分析，真实 DeepSeek 按证据分析。correct_answer/context 不能替代题目和学生答案。

`error_type` 是可选的用户自述，不是诊断事实；knowledge/thinking/execution 是已有错题分类线索，通过独立的 mistake_category 传入，不混同题型或模式。`needs_review=true` 固定表示需要人工复核，不表示学生掌握程度或是否完成复习。review-modes-2 演示规则仅供 Mock，不再作为真实分析提示。

输出严格检查模式白名单、非空且最多 500 UTF-16 单元的 reason 和布尔 needs_review；返回 needs_review 总为 true。真实 Provider 还必须有上述 analysis，各条文本最多300 UTF-16单元，观察1–4条、候选错因/追问/备选各0–3条；未知字段丢弃。结构不合法由 classify 返回200人工兜底，临时 Key 入口返回502 INVALID_RESPONSE；上游非法 JSON、截断和 HTTP 故障返回错误，不伪装成分析成功。前端分析和理由均使用 textContent，不执行 HTML。

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

真实传输复用原固定 URL、非流式 JSON Output、关闭 thinking 和错误映射，结构化分析的 max_tokens 上限为1600。httpx 禁止重定向、禁用隐式环境代理，不自动重试；整个 Provider 调用含响应体读取受分类总超时约束，响应解码后最多 65536 字节。网络代理/证书需求由宿主另外审查。

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
