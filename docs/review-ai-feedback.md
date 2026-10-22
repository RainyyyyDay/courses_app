# 可选作答批改与错误解析（2026-10-22）

## 正常网站入口

资料、笔记、错题的材料任务提交首次作答后，在原复习页展开“AI 批改与错误解析（可选）”，点击“AI 帮我批改与解析”。标准复习、自述、对比、逐空填写以及原错题选择题引擎均复用已提交作答，不要求重复输入。阅读只记录曝光，没有标准作答，不提供批改。重新作答复用实际执行引擎，批改当前轮次，不引用旧作答。

共用右下角 AI 设置，默认不调用；Mock 明确只是流程演示，不冒充分析。DeepSeek 使用现有临时 Key、费用授权、标签页调用限制与取消机制。页面渲染、提交答案、手动评分不会触发模型。切换题目、离开材料工作台或清除 Key 后，不采用迟到的结果；错误不会自动重试或回退 Mock。

结果包含待核实判断、错误/遗漏、参考解答、解析步骤、练习建议与参考可靠性说明。AI 不保证正确，不修改首次作答、正式参考答案、客观成绩、自评、进度、会话或排期。结果只保留在当前页面内存，刷新后不留存，不新增数据库字段。开放题仍用原自评，选择/挖空仍用原客观核对；即便 AI 意见不同，也不替换原判分。

## Python 独立模块

`ai-fastapi/src/ai_review_feedback.py` 的 `register(app, dependencies=[Depends(宿主权限依赖)])` 注册 `POST /api/ai/review-feedback`。未提供权限依赖时默认拒绝。JSON 入出，不读写数据库、不读取附件；不新增依赖。复用既有 httpx / FastAPI / Provider 的固定官方地址、超时、并发及响应保护。

请求：`{provider: "mock" 或 "deepseek", api_key?, model?, confirm_cost?, input: {mode_id, question, student_answer, reference?, rubric?, objective_result?}}`。

- mode_id：standard / self_explain / contrast / cloze / choice_reproduction / retry；reading 拒绝。
- objective_result：空字符串或 correct / partial / incorrect / uncertain，只说明已有核对。
- input 各字段字符串最多4000 UTF-16单元；整个请求最多16384字节，过长提示手动核对，不静默截断。前端预留凭据开销。
- DeepSeek 的模型、临时凭据和费用确认沿用现有接口；不接受任意中转地址。
- 响应：`{provider, feedback:{judgment, summary, errors:[{quote,explanation,correction}], reference_answer, reference_check, steps:[], suggestions:[], needs_review:true}}`。
- quote 必须来自学生作答原文或为空，未知评分字段剔除；结构异常拒绝，不假装成功。

本地 `test_app.py` 已注册此模块。已有运行中的3002进程需要重启才能加载新路由，再在浏览器强制刷新；不能仅刷新网页。

## 验证与边界

自动化使用临时虚构数据库、真实 Chrome 桌面/手机 DOM 和伪造的官方 HTTP 上游，不调用真实模型。对应测试 `ai-fastapi/tests/test_review_feedback.py`、`tests/review-feedback.cjs`。不代表 DeepSeek 的实际准确率、延迟或费用已经验收。

手动验证：选一个自述任务，先作答，再点击可选批改；确认出现总评/错误解释后，自行核对并按原按钮评分。再试一个答对的选择题或填空，即使 AI 提出不同意见，原 Good 不改变。纯阅读不出现入口。不配置 Key 或取消请求时，仍可继续手动核对和完成复习。
