# AI 分类前端联调

入口：错题详情 → 参考答案/解析下方「AI 分类」。默认使用现有 `API` 基础地址追加 `/ai/classify`，宿主可在 ai.js 加载前配置 `window.COURSES_AI_API_BASE`（如 `/api`）；不保存 Key、不附加伪造身份。这里的分类结果是复习方式建议，不是原有的知识类/思维类/执行类。

## 已实现的契约

与 `ai-fastapi/src/ai_mistake.py`、其 README 保持一致：只提交 `question`、`student_answer`、`error_type`、`correct_answer`、`context` 五个文字字段。题目与参考答案可以预填；学生作答和明确错误原因必须人工填写，不从现有错题类型推断。图片不上传，图片题需手工补充文字。每项上限 4000 UTF-16 单元，总 JSON 上限 16KB UTF-8。

接收 `{review_method, reason, needs_review:true}`，有效模式为 choice_reproduction/standard/cloze/self_explain/reading/contrast/retry；另接受 unclassified 兜底标识，它不是第八种模式，需人工选择。理由按纯文本展示，所有建议都要人工复核；用户可改选并确认，最终复习方式复用 mistakeStorageGet/Set 保存到本浏览器，刷新后重新打开 AI 面板恢复；输入、理由及未确认的改选仍只在内存中，离开详情后清除。失败/503/20 秒总超时不会修改原分类，保留输入和上一次建议，可手动重试，不自动重试付费请求。离开详情会取消请求，陈旧响应不会写入其他错题。

## 不能复用现有保存接口的原因

现有 `PATCH /api/courses/:courseId/mistakes/:mistakeId` 的 `mistakeType` 只支持 knowledge/thinking/execution/unclassified，并有 expectedRevision 检查；不接受 review_method/reason。现有 `/mode` 只有 standard/choice_reproduction 已实现，不能用于直接保存本模块的七种建议；其中未实现或不适用的模式也不能直接执行。因此不发后端保存请求、不改数据库，也不擅自映射类别；最终复习方式仅保存在本浏览器。手动编辑原分类继续使用原有“编辑”弹窗及保存流程。

需要大组确认/提供：

1. 在最终 FastAPI 主应用注册分类路由，并复用其真实登录/AI 权限/额度依赖；保持默认 mock。当前 Node 后端默认返回 503 AI_AUTH_NOT_CONFIGURED，不自动拼接或启动 Python 后端。
2. 最终网站 API 基础地址及同源转发安排、会话凭据/CSRF 要求；本改动沿用原有 fetch 默认凭据策略。跨域 Cookie 等需大组给出契约后再接，不把用户 ID 当认证。
3. 确认演示规则和 review_method 的产品含义。若需要保存，提供课程/错题作用域下的建议保存接口：路径、方法、请求/响应、人工最终选择与 AI 原建议/理由的存储方式、可信资源授权、并发版本检查；不得默认覆盖原 mistakeType 或复习状态。

## 不接真实模型的验收

```powershell
Set-Location D:\GitCourcesWeb\courses_app
node --test tests/mistake-ai.cjs
node --test tests/ai-proxy.cjs
git diff --check
```

新增测试的 fetch 全部使用假响应：7 项适配层测试 + 桌面/手机 2 项真实浏览器交互测试。使用电脑已有 Chrome/Edge，不安装依赖；只启动临时回环静态服务器，不启动项目后端、不读 .env/数据库、不请求外部 AI。测试浏览器档案放在系统临时目录，结束后清理。浏览器运行可能需要本机许可；缺浏览器或权限时应报告未通过，不当作成功。

生产页面不提供无认证 mock 开关。本机联调复用 `ai-fastapi/test_app.py`，显式固定 Config()、只接受回环/同源请求；该入口不得作为正式授权实现。测试专用 fetch 替身只在 tests/ 中。真实联调仍需核验登录、权限/额度、503、Cookie/CSRF、并发保存和部署路由，不能用本轮前端测试代替。

## 本轮实际验收记录

- 新增测试 9/9 通过（含 1280×960、390×844 浏览器交互），代理测试 4/4 通过，修改的 JavaScript 语法检查通过。
- 现有完整回归使用仅源码临时副本执行，排除正式 data/uploads/.env，生成虚构测试库。后端与通用前端部分通过；完整浏览器流程在 `mixed history settles consistently` 断言失败。使用修改前 HEAD 的同样隔离基线复跑，复现同一失败，未改动该无关业务。
- 另在临时副本中只选择原有 `mistakeEditBrowserScenario`（场景断言不变），验证原编辑、保存失败/重试、PATCH/reset、详情复用与陈旧请求，通过。该独立场景通过不代表完整浏览器回归通过。
- `git diff --check` 通过。未安装依赖、未读取本地 .env 或正式数据库、未调用真实模型、未部署、未提交；测试临时目录已清理。


## 本机真实 HTTP 联调（2026-10-20）

首次安装（本机已完成；依赖目录已 Git 忽略）：

```powershell
Set-Location D:\GitCourcesWeb\courses_app
python -m pip install --target .local-ai-deps -r ai-fastapi/requirements.txt
```

启动现有入口：

```powershell
Set-Location D:\GitCourcesWeb\courses_app\ai-fastapi
$env:PYTHONPATH = "D:\GitCourcesWeb\courses_app\.local-ai-deps"
python -B -m uvicorn test_app:app --host 127.0.0.1 --port 3002 --no-proxy-headers
```

打开 [虚构错题演示页](http://127.0.0.1:3002/demo)，点击“获取 AI 建议”，可修改并确认；确认后最终选择保存在本浏览器。无需启动 Node、课程 API 或数据库。仅测试 AI 面板，不在演示页使用课程增删改等其他功能。页面关闭或重新加载后，输入和 AI 理由清除，已确认方式在同一来源的浏览器中保留；终端 Ctrl+C 停止服务。

该入口同源提供 fronted 公共资源并注入 AI 基础地址 `/api`，生产前端文件不含 mock 行为。来自其他端口的页面被视为异源，不能直接调用本地 harness。最终大组可沿用 API 默认地址，或在加载脚本前设置 `window.COURSES_AI_API_BASE = '/api'`，无需修改请求逻辑；不会通过 URL 参数/浏览器存储切换模型。

复测：

```powershell
# ai-fastapi 目录，沿用上述 PYTHONPATH
python -B -m unittest discover -s tests -v
# 仓库根目录
node --test tests/mistake-ai.cjs tests/ai-proxy.cjs
git diff --check
```

结果：Python 28/28，无跳过，含 3 项新增本地测试（其中真实 TCP 测试覆盖四种映射、桌面/手机真实浏览器 HTTP 及人工确认）；前端 9/9，代理 4/4。沙箱内初次执行因回环连接/浏览器权限受限失败，放行后上述测试通过。此前既有混合复习历史回归失败本轮未重跑，也未改动相关业务。

HTTP 实测发现并修复两个兼容问题：断连监视在分类完成后协作退出，避免取消被 Starlette/AnyIO 消耗后错误响应挂起；应用状态标记防止新版 FastAPI 延迟展开路由时重复 register。现有错误输入与重复注册路由测试已通过。

交给大组：保留 `register(app, dependencies=[Depends(真实登录), Depends(AI权限/额度)])`，默认 mock；不导入 test_app.py 或演示数据，不部署第二个开发服务。保持五字段请求、七种建议模式及 unclassified 兜底标识、needs_review=true。PostgreSQL 不在分类模块职责内；尚无建议保存接口，需另行确认人工选择/理由存储、资源授权、并发版本、Cookie/CSRF 与部署同源转发安排。


## 最终选择的前端持久化

复用 `fronted/js/mistakes.js` 已有 `mistakeStorageGet/Set`（JSON + localStorage、异常保护），不增加新的存储框架，不修改后端。列表筛选和详情位置也使用同一组工具；复习待确认操作另有 state.pending 内存降级，本功能沿用“存储失败仍可继续操作”的模式。

存储键 `mistake-ai-method:<courseId>:<mistakeId>`，内容仅 `{version:1, method:"self_explain"}`。仅允许七种新模式；损坏 JSON 不采用，旧 ID 或未知格式版本的可识别记录保留原字节并提示重新选择，不猜测迁移。仅在点击确认时写入并回读验证；写入失败提示“本地保存失败，仅本页暂存”，保留本次选择以便重试。不会存题目、学生答案、上下文、AI 原建议或理由，不映射原 mistake_type，也不改变复习进度。

关闭面板/离开详情只清理内存，不删除已确认方式。重新进入详情并打开面板后展示“本地已保存的最终选择”；不伪造新的 AI 结果，可改选后再次确认。新 AI 响应只更新当前建议；未确认前，刷新仍恢复最后一次已保存选择。数据按课程和错题隔离，并受 localStorage 来源隔离：不同协议、域名或端口不共享，不跨设备/浏览器同步，清除浏览器数据会丢失。

本轮验证：前端与代理 13/13，Python 28/28，无跳过；桌面/手机浏览器均实际执行 location.reload()，覆盖最终选择恢复、恢复后重新确认、不保存未确认修改、课程/错题隔离、损坏数据、存储禁用、写入失败和既有错误/超时/取消流程。真实浏览器到 FastAPI 的 HTTP 联调继续通过。未修改后端业务、未连接数据库、未提交 Git。


## 错题列表与总复习入口

错题分类列表的每张普通卡片新增“AI 复习建议”按钮，直接在当前页打开原 AI 面板；不跳转详情、不新增 AI 请求实现。列表已包含题目文字/参考答案，因此直接复用当前列表数据预填。选择复习题目的批量勾选状态保留原有隐藏操作区行为。弹窗使用原生 dialog，支持关闭按钮、Escape、焦点约束及关闭后返回入口；关闭或页面切换会取消请求，旧响应不得污染另一题。

复用同一份 Panel DOM、classifyMistakeWithAi、确认保存和 mistakeStorageGet/Set。仅增加面板宿主上下文；关闭列表弹窗后将面板放回详情页。已保存标识统一由 readMistakeAiMethod 读取，成功写入后只更新页面上的对应标识，不重新加载列表或改变筛选/复习进度；未确认及保存失败均不更新已保存标识。

总复习：候选项使用 state.courseId + row.id；实际队列使用 session.course_id + item.item_id 进入原详情控制器。候选卡片、只读预览、实际错题复习详情均显示确认后的中文复习方式，缺少或损坏记录显示“暂无已保存的 AI 复习建议”。只读取本地数据，不自动请求 AI、不切换实际 mode、不执行建议。资料/笔记与创建计划的共享卡片行为不变。

手动验收：

1. 打开某课程 → 错题 → 任一分类，点击卡片“AI 复习建议”；填学生作答及明确原因，获取建议。
2. 未确认时卡片仍显示原已保存选择或暂无保存；修改并确认后，卡片立即显示中文复习方式。
3. 关闭、再次打开或刷新后检查恢复；切换课程/错题检查隔离。存储被浏览器禁用时应看到失败提示，选择保留且可重试。
4. 顶部“总复习” → 错题，检查候选卡片和预览显示；开始复习后检查详情顶部显示同一建议，原有复习操作继续使用原模式。
5. 桌面和手机检查按钮换行、弹窗滚动、Escape/关闭及原查看/编辑/删除入口。页面显示为本浏览器保存，不跨来源、设备同步。

测试：node --test tests/mistake-ai.cjs tests/ai-proxy.cjs 13/13；新增 mistake-ai-list-frontend.cjs 场景纳入原两种尺寸真实浏览器测试，覆盖列表打开与保存、失败重试、未确认选择、卡片更新、总复习候选及预览、总复习勾选、复习详情显示、隔离、损坏数据、迟到响应、真实详情/编辑弹窗和原删除处理器接线。删除测试不实际删除数据。Python mock 核心/路由/真实 HTTP 联调 28/28。完整业务回归本轮未执行，既有混合复习历史失败未作修复。没有数据库或后端业务改动，没有真实模型调用，也未提交 Git。


## 正常首页真实 HTTP 验收与居中修复

后续 UI 更新：列表弹窗采用“固定标题栏 / 中间单独滚动 / 固定确认操作栏”。题目信息和 AI 建议结果复用 edit-card、tag-sheet-section-title；底栏复用 tag-sheet-foot、modal-actions 和已有确认/取消按钮规则。列表弹窗隐藏详情面板的重复标题，题目名称作为标题栏中的次要文字；打开时聚焦标题并将中间滚动位置归零。理由按正常段落换行，不增加独立滚动容器；移动端按钮分行显示。共享操作区随面板进入弹窗，关闭后放回详情页，不复制请求或存储逻辑。

确认成功后：先回读验证本地存储并更新卡片，再关闭列表弹窗、恢复入口焦点，显示成功提示。详情页内联面板仍保留保存结果提示，不跳转页面。确认失败：弹窗不关闭，选择保留，底部显示错误，可重试。手动取消不写入、不覆盖之前保存的选择。未生成结果且无已保存选择时确认按钮不可用；获取建议按钮通过 form 属性继续使用原表单必填校验。

本轮测试覆盖了固定头尾、初始顶部位置、长理由无嵌套滚动、成功关闭和焦点返回、失败保持打开、重试成功关闭、手动取消不保存、卡片即时更新、原详情面板复用。前端/代理/正常首页 HTTP 共 15/15，通过 1280×960、390×844 两种浏览器视口；Python 28/28，语法及 diff 检查通过。实体手机的软键盘、安全区和系统缩放仍建议人工检查。FastAPI 业务与 API 地址配置未修改。

本地入口统一使用 `http://127.0.0.1:3002/` 或 `/index.html`（保留完整 app.js 初始化），AI 地址由开发专用 test_app.py 注入 `/api`，正式页面不硬编码 mock 地址。配置缺失/file:// 使用 AI_API_NOT_CONFIGURED，已配置本地 mock 的网络连接失败使用 LOCAL_MOCK_UNAVAILABLE；503 授权错误保持独立。课程 API 默认仍是原 localhost:3000，仅增加宿主可选 COURSES_API_BASE，隔离测试通过它指定临时课程服务，正式默认不变。

原生 dialog 默认 margin:auto 被全局重置清零，现为该 dialog 显式设置 fixed/inset/margin:auto；内部 flex 布局保持标题和关闭按钮不滚动，内容体单独滚动，尺寸受 viewport/dvh 限制。未改动其他弹窗系统。

```powershell
# 仓库根目录；需要现有 Node/Python/浏览器及本地依赖
node --test tests/mistake-ai.cjs tests/ai-proxy.cjs
node --test tests/mistake-ai-http.cjs
# Python 测试
Set-Location ai-fastapi
$env:PYTHONPATH = (Resolve-Path ..\.local-ai-deps).Path
python -B -m unittest discover -s tests -v
```

结果：14/14、1/1、28/28。HTTP 场景从正常根地址加载完整前端，运行隔离 Node 源码副本（仅测试副本调整监听端口）和实际 FastAPI mock。新建临时虚构库，不复制原 data/uploads/.env。页面执行原列表、表单、localStorage 和总复习代码，不替换 fetch；通过浏览器初始化脚本选择临时课程 API，显式阻断原3000地址。实际 POST 200 由 uvicorn 访问记录核验。两种屏幕均验证居中、长表单滚动、建议/理由、修改确认、真实刷新恢复、总复习和只读预览，并核对 mistake_type/review_status/review_revision 不变。测试随机端口避免干扰原服务，结束后清理服务和临时数据。全站完整业务回归本轮未运行。


## 本轮七模式对齐与旧数据保护

唯一文档：`D:\GitCourcesWeb\courses_app\docs\review-system-master-plan.md`，修改时间 2026-10-20 03:05:14。完整阅读后对照：文档有六种模式；实际 registry 只有 choice_reproduction/standard 实现，cloze/self_explain/reading 为占位，contrast 尚未注册。按本轮用户要求在六项建议清单追加 retry；不更改 registry 或实际引擎。

| 模式 ID | 中文 | 适用与判分（文档） | 当前实际流程 |
| --- | --- | --- | --- |
| choice_reproduction | 选择复现 | 完整结构化选择题；客观判分 | 已实现 |
| standard | 标准复习 | 其余错题；回忆/重做后自评 | 已实现 |
| cloze | 挖空回忆 | 记忆型；规则与语义等价 | 下一步/占位 |
| self_explain | 自述讲解 | 理解型；量规、自评/AI | 待做/占位 |
| reading | 阅读标记 | 只想多看；曝光/一句话总结 | 待做/占位 |
| contrast | 对比辨析 | 易混概念；对比要点（路线描述为自述变体） | 待做、未注册 |
| retry | 重新作答 | 本次追加的建议选项 | 不新增引擎 |

mock 精确映射 knowledge_gap→cloze、reasoning_gap→self_explain、careless→retry，其他/证据不足→unclassified。响应结构不变。unclassified 显示“AI 暂未给出可用建议，请人工选择”，下拉回到空占位、确认按钮禁用，明确选择七项之一后才能保存。

所有新确认只写稳定 ID。原 version:1/retry 直接恢复；recall、guided、unclassified 和未知版本不可靠映射，列表/总复习/弹窗显示重新选择提示，原记录不被读取、取消、生成建议等操作覆盖。仅用户明确确认有效新模式时替换。写入失败保留旧记录和当前选择，可重试；成功仍关闭列表弹窗并即时更新卡片。没有新数据库、保存接口、复习引擎或排期改动。

验收覆盖：七项 ID/中文/选项一致，七种合法响应与本地恢复、unclassified 人工选择、旧数据原字节保护与明确重选、失败重试、列表/总复习一致、桌面/手机及真实 HTTP 三阶段刷新（新保存恢复→旧记录刷新提示）。HTTP 夹具补复制同步新增的 ocr 源码模块，避免临时Node启动缺模块；不启动OCR服务、不调用OCR。正式后端业务没有变更。

人工验证：重启本地 FastAPI 后打开固定 HTTP 地址，Ctrl+F5，进入任一错题 AI 面板；确认七项中文选项。选择“其他/尚不明确”应看到人工选择提示；选“对比辨析”等模式并确认，弹窗关闭、卡片更新、刷新及总复习显示同一名称。旧记录应提示重新选择，取消不覆盖原值。模式仅是本地建议，不代表对应复习方式可实际运行。


本轮最终实测结果：前端/代理/正常首页真实 HTTP 16/16，Node AI mock 18/18（合并命令合计 34/34）；Python 29/29；全部无跳过。JavaScript 语法、git diff --check 通过。首次 HTTP 因测试副本漏复制新 OCR 模块失败，补齐夹具后复测通过，不隐去该失败。全站完整业务回归未运行。

本轮修改清单：

- 前端：fronted/index.html、fronted/js/ai.js、fronted/js/mistakeAi.js。
- mock 规则：ai-fastapi/src/ai_mistake.py、ai-service/config/classification.json（保持原有Node/Python规则一致性测试）。
- 测试：ai-fastapi/tests/test_core.py、ai-fastapi/tests/test_local_app.py、ai-service/test/service.test.js、tests/mistake-ai.cjs、tests/mistake-ai-frontend.cjs、tests/mistake-ai-list-frontend.cjs、tests/mistake-ai-http.cjs，新增 tests/mistake-ai-modes-frontend.cjs。
- 说明：ai-fastapi/README.md、ai-service/README.md、tests/README-mistake-ai.md。

未修改总路线文档、实际模式注册表、数据库、样式和API地址配置；没有重置、暂存、提交Git或读取.env，没有真实模型调用。

## 添加错题：可选 AI 复习建议（2026-10-20）

仍依据唯一的 `docs/review-system-master-plan.md`（文件修改时间 2026-10-20 03:05:14，文内更新日期 2026-10-19）：六种模式加用户要求的 retry。添加弹窗底部使用原生 details，默认收起；最终选择默认“不选择”，七项中文选项从已有 AI_REVIEW_METHODS 生成。unclassified 只显示人工选择提示，不能采用为模式。不使用 AI 或不选择时，原创建请求不变。

获取建议复用 classifyMistakeWithAi、五字段契约、错误提示及超时/取消。题干、参考答案、解析来自原表单；学生作答与明确错误原因只为 AI 填写，不推断原 mistake_type、不写入创建请求。返回建议不会预选最终方式；必须主动“采用建议”或手动选择。关闭丢弃草稿，迟到响应不污染新弹窗。

上传/手动创建沿用原接口，只把原先丢弃的响应记录返回给确认流程。创建成功后严格核对响应 course_id 与打开时课程一致，使用响应真实 id 保存；公用 saveMistakeAiMethod 继续通过 mistakeStorageSet 写入、mistakeStorageGet 回读验证，不添加另一套存储。成功后关闭、更新现有卡片中文摘要；刷新、详情及总复习沿用原读取逻辑。创建失败不写建议。创建成功而本地保存失败时保留弹窗、选择和已创建记录，底部改为“重试保存建议”，重试不会再次创建；也可改选“不选择”完成退出。响应编号无效时不猜测关联，提示从列表检查。建议不写数据库、不切换实际模式/进度。

本轮修改：fronted/index.html、fronted/style.css、fronted/js/mistakeAi.js、fronted/js/tagPicker.js、fronted/js/mistakes.js、fronted/js/manualEntry.js；新增 tests/mistake-ai-create-frontend.cjs，接入 tests/mistake-ai-frontend.cjs，扩展 tests/mistake-ai-http.cjs，以及本说明。之前已有的其他未提交修改保留。

执行：

```powershell
# 项目根目录
node --test tests/mistake-ai.cjs tests/ai-proxy.cjs tests/mistake-ai-http.cjs ai-service/test/service.test.js
# Python mock 测试
cd ai-fastapi
$env:PYTHONPATH = (Resolve-Path ..\.local-ai-deps).Path
python -B -m unittest discover -s tests -v
```

实测：Node 34/34、Python 29/29，无跳过；新增创建场景嵌入原两项真实浏览器测试（1280×960、390×844）。真实 HTTP 测试从正常首页调用实际 FastAPI mock，并通过隔离 Node 服务创建虚构错题，核验返回真实编号、本地保存、卡片即时显示、实际刷新、总复习与预览一致。测试只新建临时测试库，不复制或连接原数据库；结束清理。原列表查看/编辑/删除入口、原分类校验及复习选择的既有 AI 回归继续通过；全站完整业务回归未运行。JavaScript 语法与差异空白检查另行执行。

人工验收（保持同一浏览器及地址，以免 localStorage 来源隔离）：

1. 启动原 Node 后端和本地 FastAPI mock，打开 `http://127.0.0.1:3002/`，进入课程→错题→添加错题。
2. 不展开 AI，照常填名称、分类、题干并保存：只新增错题，无保存建议。
3. 再次添加，展开“AI 复习建议（可选）”，填写学生作答及错误原因，点击获取。应看到 Mock 理由，最终方式仍是“不选择”。
4. 点“采用建议”或手动改为“对比辨析”等，再点底部保存。进入对应分类，卡片应立即显示最终中文方式；刷新、卡片 AI 面板、顶部总复习及预览应一致。
5. 获取后不采用、不选择就保存，应没有已保存建议；直接关闭再打开应清空草稿。窄屏检查折叠、换行、内部滚动和固定底部按钮。真实手机触摸/软键盘与浏览器禁止本地存储的体验仍建议人工检查。
