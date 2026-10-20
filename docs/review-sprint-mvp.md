# 20 小时 DDL 冲刺：本地演示 MVP 与交接

本轮沿用总路线和现有 Node/SQLite、评分、会话、计划与排期模块。原工作区只有总路线文档未提交，已保留其中同步的优先级与交接要求。没有读取 .env、打开原数据库、连接生产或调用真实模型，没有暂存/提交 Git。

## 实际交付边界

| 标识 | 当前实际执行路径 |
| --- | --- |
| choice_reproduction | 原选择复现，单/多选，首次选择后客观核对，再显示答案；正确 Good、错误 Again。没有另写引擎。 |
| standard | 原错题步骤机新增首次作答、答案查看与计时；资料/笔记的开放任务使用共用工作台。揭示参考答案后的自评最高 Hard。 |
| cloze | 错题/资料/笔记均可手动编辑题面、增加/删除空位、答案、别名和提示，确认保存到数据库；会话中填写、核对并记录结果。全对 Good，任一空错误 Again；无语义判分。 |
| self_explain | 手动任务、参考要点/量规；文字首次作答后看要点，自评 Again/Hard。 |
| contrast | 手动对比对象、维度、关键异同与核对要点；共用开放作答引擎。 |
| reading | 原阅读器及工作台均只记曝光/处理完成，不自动写 grade 或完成掌握型计划任务；可保存阅读标记/总结。 |
| retry | 已定为动作，不是新引擎。旧错题通过原步骤机 restart 重开当前流程；工作台内已运行模式可复用同一材料再开轮次。已完成会话需从“再次复习”创建新会话，禁止重复记分。 |

模式工作台入口在普通内容详情“准备复习材料”和总复习/考前计划运行时的“复习模式 / 手动材料”。材料准备不算复习，也不自动覆盖已确认的本地 AI 复习建议。当前新模式按本次会话项目显式选择，不自动改变旧默认模式或采纳 AI 建议。

## 迁移与数据保护

- v18→v19：增加 mistake_review_progress 的 first_answer、answer_revealed、started_at、duration_ms；review_item_events 增加 first_answer、answer_revealed、evidence_json；review_session_items 增加 exposure_only。
- v19→v20：增加 review_artifacts、review_mode_attempts、review_mode_events。材料按课程/内容类型/内容 ID/模式隔离，并有版本；答案与别名存后端。一次作答使用不可变材料快照，避免编辑后改变历史核对结果。
- 不删除或重写原题目、题型确认、评分、会话或 localStorage AI 建议。旧历史不补造首次答案/耗时。旧错题内容修改后，旧的新模式轮次拒绝提交，要求重新开始。
- 准备/编辑接口只在用户明确确认后保存正式材料；练习接口在提交前不返回填空答案/别名、开放任务参考要点/量规。普通详情的材料编辑权限不等于复习阶段答案可见性。
- 结果提交使用事务、expectedVersion 和 requestId；评分复用 recordGradeInTransaction，会话与计划复用原上下文和完成函数。曝光不创建评分事件，也不被日历、历史或完成弹窗误计为通过。
- 原数据库本轮未打开或迁移。首次启动新后端将自动升到 v20；请先备份本地 back/data。升级后旧版程序会按已有版本保护拒绝打开该库，回退时不能仅切回旧代码继续写新库。PostgreSQL 迁移需大组另行实现。

## 接口

前缀为 `/api/courses/:courseId/review-items/:itemType/:itemId`，itemType 是 mistake/material/note：

- GET/PUT `/materials/:modeId`：读取编辑材料，或 `{expectedVersion, confirmed:true, material}` 确认保存；练习预览 GET 加 `?view=practice`，不下发答案。
- POST `/attempts`：`{requestId,modeId,expectedMaterialVersion,sessionItemId?,planItemId?}`，取得轮次。前端实际运行从已有会话传入正确的项目 ID。
- GET `/attempts/:attemptId`：恢复当前步骤、首次答案及结果。
- POST `/attempts/:attemptId/events`：`{requestId,expectedVersion,action,answer?,grade?,durationMs?}`。
- cloze 用 submit + 按空位 ID 的答案对象；开放模式先 submit 文本、再 judge；reading 用 complete，grade 为 null。
- 原错题接口保留，recall/reveal_answer 现在必须带 firstAnswer；restart 在原步骤机内重开。旧调用方需要同步这一新增证据要求。

固定 Mock 草稿：`POST /api/ai/review-draft`，请求 `{modeId,text}`，响应 `{provider:'mock',needsReview:true,material}`。复用既有确定性挖空 provider，并强制本地 mock；不改变 FastAPI `/api/ai/classify` 或其响应。生成只进入独立预览；可补空白/明确替换，保留原稿撤回，采用后仍可在普通表单改删，最终确认才持久保存。AI 超时/错误保留输入，不妨碍手动路径。

## 最短演示

1. 先备份本地数据，然后按原方式启动 Node。后端启动目录为项目的 back：运行 `npm start`。若使用现有 HTTP 首页，再启动 ai-fastapi/test_app.py（原本地启动方式不变），打开 `http://127.0.0.1:3002/` 并 Ctrl+F5。
2. 在课程下新建一条手动笔记，打开详情→“准备复习材料”。默认挖空；题面写“首都为【b1】”，添加空位 b1，答案“北京”，别名“北京市”，提示“中国首都”。确认保存，不需要 AI。
3. 顶部“总复习”选该笔记并开始；在运行工具栏点“复习模式 / 手动材料”，开始本轮，输入“北京市”提交。应显示正确、Good、首次作答与耗时；返回队列后会话完成。刷新可恢复已保存轮次。
4. 在详情分别为自述、对比、阅读准备材料，再用新的总复习会话选对应模式。自述/对比先填首次回答、再看要点、自评最高 Hard；对比必须填至少两个对象与一个维度。阅读完成仅显示曝光，不产生 Good。
5. 已有选择题照原方式选择复现；主观错题先填写首次作答再看答案。运行中在工作台选 retry，可重开原流程，旧历史保留。
6. 材料编辑时可主动生成 Mock 草稿；检查原表单不变，明确采用后再手动改删、确认保存。未采用/未确认结果不能影响正式材料。

## 已知限制与后续

- 用途标记、自动分块、文档提取、完整 PDF 阅读/划标、语音、真实 AI 和语义评价不在本轮交付内。
- 开放模式为人工核对/自评；不声称客观判定开放答案。填空只做精确/别名归一化。
- durationMs 记录开始到提交的经过时间，尚未扣除暂停、后台和离线时段。
- 历史页展示通过/失败/曝光等结果，尚未逐次展开作答证据和材料版本；详细内容已在轮次与评分记录中保存，可由接口读取。
- 草稿恢复、待重试请求继续使用原 localStorage 异常保护；浏览器禁止本地存储时，页面内保留输入/待重试请求，刷新恢复草稿能力会受限。正式材料与结果仍在后端持久保存。

## 测试与变更文件

测试使用允许列表复制的代码和全新临时虚构库，不复制原 data/uploads/.env。集中运行：

```powershell
node --test tests/review-sprint.cjs tests/mistake-ai.cjs tests/ai-proxy.cjs tests/mistake-ai-http.cjs ai-service/test/service.test.js
```

review-sprint 复用并运行原题型/错题/迁移回归，另覆盖 P0/P1/P2 HTTP、别名、快照、版本冲突、课程/内容隔离、幂等、事务故障回滚、计划/会话/排期、标准计时与 retry。真实 Chrome 桌面 1280×960、手机视口 390×844 从普通网站执行编辑、Mock 草稿、实际作答、刷新恢复和会话完成。整站 regression.cjs 默认会读取既有数据，本轮不执行它；所需函数在独立夹具中运行。

本轮曾遇到旧版本断言、迁移夹具依赖、新增 restart 动作断言，以及浏览器注入脚本换行错误；修正后复测，不把首次失败隐去。最终数字见总路线的“本轮实际验证”记录。

实际结果：集中 Node 49/49；补充最终 retry 与原单/多选浏览器验收后，review-sprint 15/15 复测通过（包含重复回归）；Python 29/29。全部无跳过，JavaScript 语法与差异检查通过。真实手机触摸、原数据库升级、PostgreSQL 和整站完整回归未运行。

主要代码文件：

- 后端：back/db/schema.js、mistakeReview.js、reviewItems.js、reviewSessions.js、reviewModes.js、index.js；新增 back/db/reviewArtifacts.js、reviewAnswers.js；back/server.js、back/ai/service.js、port.js。
- 前端：新增 fronted/js/reviewWorkbench.js；fronted/index.html、style.css、fronted/js/mistakeDetail.js、resourceDetail.js、materialReview.js、reviewCenter.js、reviewPlans.js、mistakeQueue.js、utils.js。
- 测试：新增 tests/review-sprint.cjs；更新 tests/mistake-format.cjs、mistake-backend.cjs、material-review.cjs、review-center.cjs、review-plans.cjs、review-scheduling.cjs、regression.cjs 的新版本/契约断言与夹具复用。
- 文档：本文件及权威 docs/review-system-master-plan.md；保留了开始前总路线尚未提交的同步内容。
