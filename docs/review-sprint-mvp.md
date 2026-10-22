# 20 小时 DDL 冲刺：本地演示 MVP 与交接

2026-10-22 可选作答批改：原复习页提交后新增折叠入口，复用共用 AI 设置；结果只作参考，不写评分或排期。Mock 不假装实际批改。合同、边界及验证入口见 `review-ai-feedback.md`。

2026-10-21 材料衔接与生成：原页内补齐材料状态/缺项/手动准备/明确保存并开始，真实材料草稿复用共用 AI 设置和既有 Provider，不自动覆盖、保存、评分或切换模式。测试范围与当前边界见 `review-material-readiness.md`，此前“只有固定 Mock 草稿”为历史记录。

2026-10-21 资料／笔记与 OCR 修正：六种用户可选模式（选择复现为 retry 的选择题分支，旧引擎 ID 保留）；资料、笔记接入统一 AI 设置和原页内材料/评分流程；启动脚本区分已准备的浏览器 OCR 与可选 Python 备用服务。本轮根因、文件/接口、验证及正常网站操作见 `review-resources-ocr-fixes.md`。

2026-10-21 第二轮 AI 设置：正常网站统一入口，Key 可选择只在当前标签页保留，新错题保存后可选单次分析草稿（默认关），不自动采用/评分/改分类。登录及永久凭据未做；实现范围、主组接点、手动步骤和本轮验证见 `ai-settings-round-two.md`。

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

模式工作台入口在普通内容详情“准备复习材料”和总复习/考前计划运行时的“复习模式 / 手动材料”。材料准备不算复习，也不覆盖已确认的本地 AI 复习建议。当前入口按“本次明确选择 → 已确认采用的 AI 建议 → 分类和已确认题型规则”选模式。模式建议不等于材料；缺材料可在当前会话点击“手动创建材料”，或“切换到可用模式”。已有题目和答案的错题直接复用 standard/retry，无需补一套材料。

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

## 2026-10-20：七模式实际交互修复与验证

本次开始时 main 干净，无 MERGE_HEAD 或未解决冲突。仅修改复习交互及必要集成，不修改选择题编辑确认弹窗、不提交 Git。

### 数据路径及保护

保存 AI 建议仍只保存稳定模式 ID，不创建材料。工作台展示“当前实际流程”和“本次待使用模式”，提供“本次使用此建议”按钮；用户明确选择优先，其次已确认 AI 建议，再按已确认题型/错因给规则候选。没有确认题型时不猜测选择题，缺材料不伪装成通用作答。

工作台开始时传递选中 modeId、原 sessionItemId 和 planItemId，后端轮次保存 mode_id 与材料快照；渲染依据返回的 attempt.modeId，评分继续写原 review_item_events。原生选择/标准仍由 mistakeReview 执行。session_items 本身不新增 mode_id 列；工作台轮次和评分事件才是实际执行模式的证据。切换候选不改变正在运行的轮次，关闭后可恢复；工作台激活时隐藏原流程提交区，避免误提交另一种结果。

### 在正常网站逐项验证

启动现有本地网站后 Ctrl+F5。进入课程，准备有题目和答案的错题（选择题需确认题型、选项和正确项）。每完成一种模式后，从总复习新建下一次会话；已完成项目不能在原会话重复评分。

1. 总复习选择内容→“复习模式 / 手动材料”。选择复现→确认进入：必须是单选 radio 或多选 checkbox；提交才显示正确答案、解析与客观结果。
2. 标准复习→确认进入：使用原题，不要求额外材料；先填写首次作答/回忆，再看答案、自评；看答案后最高 Hard。
3. 挖空→若缺材料，点“手动准备材料”：题面“中国首都是【b1】，2+2=【b2】”，添加 b1/b2，答案北京/4、别名北京市/四。确认保存并开始，输入框必须嵌在原句；提交逐空显示核对和参考答案，全对 Good。
4. 自述→手动任务、分行参考要点和量规→确认保存并开始。长讲解区作答；提交后才出现参考解释、要点勾选和 Again/Hard 自评。勾选本身不评分。
5. 阅读→准备正文并开始：正文阅读区、可留空的一句话总结、已完成勾选；点击记录曝光。会话只增加“仅曝光”，不新增 Good，不改变掌握/排期状态。
6. 对比→准备至少两个对象、分行维度、参考异同与核对要点。开始后必须出现对象×维度表格及相同点/不同点/条件/易错点字段；提交后保留结构化首次回答，核对参考并自评。
7. 重做→在尚未完成的本轮选择 retry 并确认：选择题仍使用选项，主观题重新输入；工作台复用原模式新轮次，旧输入/答案不再展示。旧作答证据保留。已完成项目提示到记录“再次复习”创建新会话。
8. 在普通错题的 AI 面板确认保存建议，再进入总复习。应看见“建议”和“当前实际流程”分开；点“本次使用此建议”，缺材料则手动补齐，再明确开始。实际轮次、评分模式应一致；此前本次手动选择不能被保存的建议覆盖。

### 修改范围和测试边界

- 业务：fronted/js/reviewWorkbench.js、reviewCenter.js、mistakeDetail.js、fronted/style.css、back/db/reviewModes.js。后端仅清理模式切换后的当前轮次证据显示；历史事件不改。
- 测试：tests/review-sprint.cjs、mistake-format.cjs；新增 review-interactions.cjs（嵌入真实网站的浏览器断言）、review-mode-rules.cjs。夹具固定 OCR_PROVIDER=mock，防止旧回归意外依赖真实 OCR 服务。
- 浏览器是实际 Chrome，普通 index.html + 临时本地 HTTP 后端，1280×960 和 390×844 两种视口。检查真实 DOM、单/多选、行内空位、对比矩阵、讲解与核对、阅读勾选、前后答案可见性、retry 新轮次/历史、AI 采用到实际 modeId/评分、刷新恢复及会话归属；不是 demo 页面或仅检查按钮名称。
- 未读取 .env、现有 data/uploads、未调用真实模型或生产库。长文自动分块、真实 AI/语义判分、完整历史明细页面仍是原有限制；原数据库运行、整站完整回归、真实手机触摸/软键盘没有验证。
- 最终执行 `node --test tests/review-sprint.cjs tests/review-mode-rules.cjs tests/mistake-ai.cjs`：29/29 通过，无跳过，包含上述两个真实浏览器视口。所有变更 JavaScript 语法检查、git diff --check 通过。初轮曾发现切换时清空非空耗时字段导致 500，修正为 0；随后旧夹具的 OCR 默认 HTTP 导致 502，固定测试 Mock 后完整复测通过，不隐去过程失败。

## 后续：一键模式切换与真实 OCR 配置

- 页面为 index.html 的 mistakeDetailPage，运行入口 renderCenterReviewItem；原标准走 openMistakeDetail / renderMistakeReview / submitMistakeReview。工作台走 openReviewWorkbench / startWorkbenchAttempt / renderWorkbenchAttempt / submitWorkbenchAttempt，确认时实际传 reviewWorkbench.mode 为 modeId，不复制判分逻辑。
- 已确认建议存本浏览器 mistake-ai-method:<courseId>:<mistakeId>；当前原生模式由 review_item_modes 与 mistake_review_progress 返回，工作台实际模式由 review_mode_attempts.mode_id 保存；本次选择复用 review-mode-selection:<courseId>:mistake:<id>:<sessionItemId>。一键控件使用 centerReview.quickMode.modeId，确认后同步到已有工作台，区分候选和实际执行。
- 可运行建议默认选中；单击切标准，再单击切回。确认时复查材料，恢复已有轮次须同步 active 指针；无效/缺材料回退标准，说明缺项。手动模式与材料入口保留，草稿和已输入讲解按原轮次恢复，无新数据库字段。
- 浏览器新增 tests/review-quick-mode-checks.cjs，接入原临时虚构库真实 Chrome 双视口；验证 AI 默认、标准确认、切回恢复、清空内存缓存后本地选择恢复、无建议/无效/缺材料回退及选择题目附件后 OCR 按钮实际出现。不会发送用户附件。
- start-local.ps1 保持 AI=mock，OCR_PROVIDER=http、OCR_API_BASE=http://127.0.0.1:8001；先 OCR 健康再开业务后端。ocr-service/start.ps1 去除个人绝对路径，按 .venv / py -3 / PATH 选 Python，输出缺依赖和日志路径，不自动安装或切 Mock。
- 本机所选 Python 为 Python314/python.exe（3.14.6），缺 fastapi、uvicorn、python-multipart、pillow、pymupdf、paddlepaddle、paddleocr。OCR 与主启动的检查均以退出码 1 明确拒绝；没有启动现有数据库、真实 OCR 或下载模型。因此不能宣称真实图片识别成功，也没有 8001 真实识别请求日志可展示。
- 最终相关测试命令加入 tests/start-local.cjs 后 31/31 通过，无跳过；首轮曾发现切回已有 AI 轮次未恢复 active 指针，修复后复测通过。完整 Python/整站回归未运行；真实 OCR 端到端待用户批准准备环境后验收。
- 正常网站的 3002 静态脚本 GET 已核对与磁盘一致；已有 3000/3002 进程保留，Node AI 健康接口确认 mock。8001 健康检查失败；实际主启动尝试因缺依赖退出 1，未新开业务服务。当前网站可能仍保留旧 Node 的 OCR 环境，只有准备好依赖并重启后才应用新启动配置。

后续按用户要求，将一键入口中的 OCR 改为可选：缺依赖或启动失败只警告，网站/AI Mock 仍可启动，并在打开浏览器后再尝试 OCR。后端 OCR_PROVIDER 继续使用 http，不切 Mock；恢复 OCR 后无需重启通过新脚本启动的后端。上述严格 OCR 门禁及退出码 1 是先前版本记录。变更仅涉及启动脚本、启动回归与相关说明，不更改复习业务逻辑。
## 此前：后端分支内部冲突整合及页面内作答

当前后端分支恢复本地修改产生冲突。合并保留规则推荐、课程隔离、原生进度校验、新模式交互、AI/标准切换和可选 OCR 启动；OCR 启动脚本保留为可移植入口，而非个人绝对路径。

复习会话中的作答与手动补材料均嵌入原复习页，用同一套工作台 DOM 与判分流程，不再打开 dialog。原生标准/选择题与工作台区域互斥；顶部按钮直接切换 AI/标准，设置在页内展开；普通详情的独立材料准备入口仍保留。兼容读取双方已发布的本地模式选择键，切换保留轮次、输入及历史证据。

本轮最终执行 `node --test tests/start-local.cjs tests/review-sprint.cjs tests/review-mode-rules.cjs tests/mistake-ai.cjs`：31/31 通过，无跳过。实际 Chrome 普通网站入口、隔离 HTTP/SQLite 夹具，1280×960 与 390×844 均验证七种交互及单击立即切换；查看了两种视口截图，作答区在原页面内，无复习遮罩或重复原生作答区。初轮两处旧提示文字断言失败，按当前语义更新后完整复测通过。变更 JavaScript、两个 PowerShell 脚本语法检查与暂存/工作区 `git diff --check` 通过。

当时的 10 个冲突文件已标记解决并暂存，未提交；该记录指后端分支内恢复修改的过程，不是下述后端合入 main 的状态。选择键为 `review-mode-selection:<courseId>:<sessionItemId>:<type>:<id>`，兼容只读旧布局；已有 active 指针在两种布局同步。未新增数据库字段，评分引擎、历史事件与已确认 AI 建议不改写。

本轮未读取 .env、现有数据库或用户上传内容，未调用真实模型或启动/下载 OCR 模型。启动回归使用假进程和隔离测试服务，不代表真实 OCR 已识别成功。尝试只读请求 3002 的静态资源未能连接，未自动启动用户的业务服务；用户应运行项目一键入口后 Ctrl+F5 验证实际网站。独立材料准备窗口仅保留在非复习会话的普通详情入口。

## 2026-10-20：后端分支合入 main 的 14 个文件冲突

本次在 main（031288a）合入后端（17d0e01）时解决 14 个文件冲突。交付时保留合并状态，解决结果暂存，等待 GitHub Desktop 的 Continue merge 完成本地合并提交；没有推送远程。

- 统一采用支持双存储键兼容与页内挂载的复习工作台，保留 main 的最新行为：有已保存 AI 建议就直接显示对应模式，缺材料显示准备入口；点击可切回原复习，再切回时恢复原轮次与草稿。未准备材料不创建作答轮次、不评分。没有有效建议沿用原生流程。保留错题列表、总复习和考前计划入口。
- 合入确认题型检查、规则候选、会话模式同步与可选 OCR 启动。main 的 PaddleOCR 3.x app.py、固定依赖、浏览器 OCR、PDF 资源准备脚本保持原样；OCR 启动使用便携的解释器选择，文档不再依赖组员电脑路径。
- 合并双方测试；缺材料的旧“自动改成标准”断言按 main 最新约定改为“显示建议、提示缺材料、允许切回原流程”。首轮相关测试 31/31 通过，无跳过；补充错题列表 AI 入口、原生 retry 恢复与切回后，两个真实 Chrome 视口再次通过。PowerShell 语法及差异格式检查通过。
- 测试使用隔离 HTTP/SQLite 夹具与虚构启动进程，没有执行依赖安装或真实 OCR 识别。

## 2026-10-21 第一轮：错因可选与真实 AI 学习分析

- 保留开始前所有临时 Key/缓存修复修改，无未解决冲突；未暂存或提交。本轮不做第二轮统一设置、账户或自动调用，不接主后端/生产数据库。
- Python `ai-fastapi/src/ai_mistake.py`：Mock 的 DEFAULT_RULES 保持演示映射，真实 Provider 使用独立分析提示词，不再携带演示配置。调用门槛只需题目/学生答案；错误原因是可选线索，新增可选过程、已有分类和已确认题型。未知错因允许追问和暂定练习，不因未知直接拒绝调用。
- 兼容原三字段建议，真实结果强制带有结构化 analysis，区分答案初步判断、观察、参考核验、候选错因/证据、追问、备选。每段限长、数组限条数，额外字段丢弃；材料需求由可信模式表附加，不接受模型声称材料已创建。正确作答却制造错因、未知题型却推荐选择复现、旧三字段冒充新真实分析均拒绝。语义仍需人工验证，不把格式校验称为智能诊断成功。
- 原网站列表/详情/新增 AI 面板与独立测试工具已更新，新增过程输入和分析分区，返回文字均按 textContent 渲染。失败保留旧建议；只有用户明确确认才按旧机制保存模式 ID，不存分析/Key、不改错题类型或历史。原有复习/材料/会话/评分引擎不变。
- 真实输出上限从512增至1600 tokens，以容纳分析；可能增加输出费用。既有逐次费用确认、超时和并发机制保留，无自动重试。修改了 Python，必须重启本机3002再刷新；仅 Ctrl+F5 无法更新进程内提示词。静态入口版本为20261021-analysis-1，保留 no-store 开发缓存修复。
- 最终相关 Python 测试51/51、Node集中测试40/40通过，均无跳过；JS语法、git diff --check通过。Node命令为 `node --test tests/start-local.cjs tests/review-sprint.cjs tests/review-mode-rules.cjs tests/mistake-ai.cjs tests/ai-proxy.cjs`；Python为 `python -B -m unittest discover -s tests -v`（ai-fastapi目录，仓库.local-ai-deps作为PYTHONPATH，-B不写pyc）。
- 新增9项分析契约/提示词回归覆盖无过程算术错误、明确过程、事实提取、正确作答、缺参考/背景、错误参考和自述冲突，以及无效结构/模拟隔离；全部是假上游，不能宣称真实模型通过这六类教育质量验收。真实 Chrome 桌面/手机从正常首页走未知错因→真实接口替身→分析展示→人工确认→原页内复习→评分/会话，检查无凭据/分析入本地存储、失败保留旧选择；已检查两种截图。
- 真实人工验收清单见 `docs/ai-analysis-acceptance.md`，本轮未执行真实调用。未读取.env、原数据库/用户上传内容，未安装依赖、未调用真实模型；真实准确性、稳定性、延迟和费用仍待人工验证，不把JSON或假上游通过当作质量成功。

## 2026-10-21 可选答案/解析生成按钮

- 保留开始前全部未提交修改，无未解决冲突，未提交Git。新增/编辑的解析输入区域提供“AI 生成答案与解析（可选）”按钮，默认不展开、不请求，不影响纯手工保存。
- 新 Python 模块 ai_answer_draft.py 提供 register/app JSON路由，宿主权限未接时拒绝；本机通过既有回环限制挂载。答案草稿使用独立任务提示词，不混入错因/模式分析；与原 Provider 共享官方HTTP传输、JSON读取边界、限流/超时和取消基础。16KB请求，答案/解析各4000 UTF-16单位、待核实点最多3条。无数据库或新依赖。
- 只把结果放入可编辑预览；确认后可仅填空白、定向替换答案/解析，或放弃/撤回。字段最后仍由原保存流程持久化，原修改后的复习失效规则照旧；生成和采用本身不修改评分/会话/计划。选择题先校验所给选项，再只接纳合法单/多选ID候选，人工确认之前不改原正确项。题干/题型/选项变化拒绝旧稿，取消/关闭/跨项目不接纳晚到结果；手工并发输入保留。
- Mock 明确只演示、不提供本题解答；真实Key临时输入，发送后清空。不自动读取附件、调用、重试或切Mock。不在实际复习界面提前生成/显示答案。未实现永久来源审计或统一账户凭据，这些不属于本轮。
- 专项8项通过，含真实Chrome桌面/手机：草稿不自动采用、Mock说明、费用/权限、固定地址/限长、单/多选、原答案/解析保护、请求中编辑、过期/失败/关闭、人工填入后原保存、撤回、HTML纯文本、凭据不入存储、原评分/计划不变。初轮夹具漏填错题类型及跨视口消耗限流桶，修正夹具并单独验证真实限流；Node集中回归首轮Windows临时浏览器目录清理EPERM（非功能断言），延长清理重试后复测。所有模型均假上游，真实解题质量仍待人工验收。
- 最终完整Python59/59、Node集中40/40通过且无跳过；最后又复测草稿专项8/8，检查桌面/手机截图并保证移动端按钮可读，JS语法与git diff --check通过。Python命令仍为ai-fastapi目录的 `python -B -m unittest discover -s tests -v`；Node集中命令同上一节。未读取.env、原数据库或隐私附件，未安装依赖、未调用真实模型或提交Git。实际使用须重启3002以加载新路由，再刷新网站；首次真实生成的准确性/耗时/费用尚未验收。
