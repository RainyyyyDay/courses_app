# 第一阶段错题后端：接口对接文档

本文对应当前已实现代码，替代此前综合复习设计稿。本阶段仅支持当前课程的错题分类、筛选和单题独立复习；不实现资料/笔记复习、综合会话或标签递归扩展。

## 1. 与原方案的调整

- 类型使用 knowledge / thinking / execution / unclassified。旧题默认 unclassified；新建必须明确提交四种之一，省略类型仍返回 400。本次按最新需求放开待分类创建与复习，待分类复用思维类的通用掌握判断；不新增数据库结构或 action。
- 最终状态仅 unreviewed / reviewed，取消 not_started / pending / reviewed 三状态。
- 只新增单题进度和历史表，不增加 review_resources、review_sessions 或聚合队列。
- 题目继续使用 content、image_url、file_type、ocr_text；新增 answer_content 和 explanation。当前答案为文字，不实现单独答案附件接口。
- 配置编辑合并为课程下的 PATCH 错题接口；原方案的 review-config、review-catalog、会话接口不在本阶段实现。
- 实际旧代码无收藏功能，新增 favorite，不改标签关系。

## 2. 通用约定

基础地址：http://localhost:3000。下文路径均包含 /api。

除上传文件外使用 Content-Type: application/json。路径 ID 必须是正整数。

| 概念 | 值 |
| --- | --- |
| 错题类型 | knowledge 知识类；thinking 思维类；execution 执行类；unclassified 待分类 |
| 最终复习状态 | unreviewed 未复习；reviewed 已复习 |
| 当前复习步骤 | idle 尚未开始；question 看题；answer 对照答案；completed 本轮完成 |
| 记忆程度 | clear 清楚；vague 模糊；forgotten 不记得 |

请求编辑字段用 camelCase；原有资源记录响应继续使用 snake_case。favorite 在资源响应中为整数 0/1，编辑请求为布尔值。

## 3. 错题创建（扩展原接口）

POST /api/courses/:courseId/mistakes

文字录入示例：

```json
{
  "title": "例题",
  "content": "题目正文",
  "mistakeType": "knowledge",
  "answerContent": "参考答案",
  "explanation": "解析或错误原因",
  "knowledgeIds": [7, 9]
}
```

mistakeType 必填，可为 knowledge、thinking、execution 或 unclassified；缺失、null、空字符串及其他值返回 400 INVALID_ARGUMENT。没有文件时 title 必填；答案和解析可不填，保存为空字符串。新建默认 favorite=0、review_status=unreviewed。待分类同样适用于 JSON 文字录入及 multipart/form-data 手动/上传录入。

上传题目用 multipart/form-data：file 为题目附件，其他字段同上，knowledgeIds 传 JSON 数组字符串。保留 nodeIds 别名，有 knowledgeIds 时优先使用。支持分类/知识点标签，不允许系统“未分类”节点。

成功 HTTP 201 返回资源记录（创建响应不附带 knowledge 数组）：

```json
{
  "id": 12,
  "course_id": 1,
  "title": "例题",
  "image_url": "",
  "file_type": "",
  "ocr_text": "",
  "content": "题目正文",
  "created_at": "2026/10/11 16:00:00",
  "mistake_type": "knowledge",
  "answer_content": "参考答案",
  "explanation": "解析或错误原因",
  "favorite": 0,
  "review_status": "unreviewed",
  "review_revision": 1
}
```

## 4. 列表与组合筛选（扩展原接口）

GET /api/courses/:courseId/mistakes

所有筛选参数可省略。无参数仍返回当前课程错题数组，按 ID 升序。

| 参数 | 格式 | 含义 |
| --- | --- | --- |
| mistakeType | 四种类型之一 | 类型筛选 |
| reviewStatus | unreviewed / reviewed | 最终复习状态 |
| favorite | true / false / 1 / 0 | 收藏状态 |
| nodeIds | 7,9 | 直接关联任一所选标签，最多 100 个，重复 ID 去重 |
| q | 搜索文本，最多 500 字符 | 标题、content、ocr_text 的子串搜索 |

示例：

```text
GET /api/courses/1/mistakes?mistakeType=knowledge&reviewStatus=unreviewed&favorite=true&nodeIds=7,9&q=函数
```

不同筛选类别是 AND；多个标签是 OR。不会递归查后代，也不会跨课程；同一题返回一次。% 和 _ 按普通文字搜索；不会搜索附件二进制内容、答案或解析。

成功 HTTP 200 返回资源记录数组，每条在第 3 节记录字段基础上增加：

```json
{"knowledge":[{"id":7,"name":"知识点A","type":"knowledge"}]}
```

无匹配返回 []。标签不存在、跨课程或为系统节点返回 400。

## 5. 详情、编辑、收藏和标签

GET /api/mistakes/:id：原有详情接口，返回第 3 节全部字段和 knowledge 数组。答案缺失返回 answer_content:""，不推断或编造。

PATCH /api/courses/:courseId/mistakes/:mistakeId：新增编辑接口。

```json
{
  "mistakeType": "thinking",
  "answerContent": "修改后的答案",
  "explanation": "修改后的解析",
  "favorite": true,
  "expectedRevision": 1
}
```

可编辑 title、content、mistakeType、answerContent、explanation、favorite，至少传一个。只修改实际传入字段，不传保持原值；文字答案或解析可传空字符串清除。四种类型之间均可切换，编辑为 unclassified 后可参与通用独立复习。

expectedRevision 可选，建议修改正文/分类/答案时传入上次记录的 review_revision；版本落后返回 409。成功 HTTP 200 返回完整错题详情，含 knowledge。

修改分类、题目正文、答案或解析：增加 review_revision，重置步骤为 idle、状态为 unreviewed，并使旧步骤版本失效；历史保留。仅改标题、收藏或标签不重置状态。重复保存相同值不重置。

收藏示例：PATCH /api/courses/1/mistakes/12，JSON {"favorite":true}。

原接口保持：

- PUT /api/mistakes/:id/knowledge，JSON {"knowledgeIds":[7,9],"title":"可选标题"}；完整替换标签，返回 {"success":true,"knowledge":[...],"title":"..."}。
- DELETE /api/mistakes/:id，返回 {"success":true}；删除时级联清理该题的进度、历史和标签。

原有按 ID 的详情/删除/标签接口不具备课程路径；新编辑和所有复习接口均强制校验课程归属。当前应用没有账号权限系统。

## 6. 查询当前复习步骤与恢复

GET /api/courses/:courseId/mistakes/:mistakeId/review

成功 HTTP 200：

```json
{
  "mistakeId": 12,
  "courseId": 1,
  "mistakeType": "knowledge",
  "reviewStatus": "unreviewed",
  "reviewRevision": 1,
  "stage": "question",
  "recall": null,
  "round": 1,
  "version": 1,
  "updatedAt": "2026-10-11T08:00:00.000Z",
  "question": {"title":"例题","content":"题目正文","ocrText":"","fileUrl":"","fileType":""},
  "answerVisible": false,
  "answer": null,
  "reviewable": true,
  "blockedReasons": [],
  "allowedActions": ["recall"]
}
```

未有复习记录时 stage=idle、round=0、version=0、updatedAt=null。答案仅在 answer 或 completed 步骤返回：

```json
{"answerVisible":true,"answer":{"content":"参考答案","explanation":"解析或错误原因"}}
```

blockedReasons 可包含 missing_answer、missing_question；此时 reviewable=false、allowedActions=[]。unclassified 类型本身不再阻止复习。无答案题可浏览编辑，但需要补答案后才能正式复习。答案已有但只有标题、没有正文/OCR/题目附件时也不能正式复习。

前端重新进入时先 GET；question/answer 表示尚未完成，直接恢复该步骤，不重新 start。completed 展示本轮结果，可再次 start。

普通资源列表和详情会返回答案，供编辑使用；复习页面应使用本接口控制展示。后端不会从旧混合题目图片中自动剥离答案。

## 7. 开始下一轮复习

POST /api/courses/:courseId/mistakes/:mistakeId/review

```json
{"action":"start","requestId":"唯一操作ID","expectedVersion":0}
```

仅 idle 或 completed 可开始。成功 HTTP 200 返回第 6 节结构，stage=question、round 加 1、version 加 1。开始不改变原有最终状态。

中途再次 start 返回 409，使用 GET 恢复即可。

## 8. 提交复习动作

POST /api/courses/:courseId/mistakes/:mistakeId/review/events

| 类型与步骤 | JSON 的动作部分 | 结果 |
| --- | --- | --- |
| 知识类 question | {"action":"recall","recall":"clear"} | 展示答案，进入 answer，不改变最终状态 |
| 知识类 question | {"action":"recall","recall":"vague"} | 同上 |
| 知识类 question | {"action":"recall","recall":"forgotten"} | 展示答案，进入 completed，状态 unreviewed，无须再判断 |
| 知识类 answer | {"action":"judge","correct":true/false} | reviewed / unreviewed，进入 completed |
| 思维类 question | {"action":"reveal_answer"} | 展示答案及解析，进入 answer |
| 思维类 answer | {"action":"judge","mastered":true/false} | 已掌握/仍需复习，reviewed / unreviewed，进入 completed |
| 待分类 question | {"action":"reveal_answer"} | 用户自行回忆或解题后查看答案及解析，进入 answer |
| 待分类 answer | {"action":"judge","mastered":true/false} | 已掌握/仍需复习，reviewed / unreviewed，进入 completed |
| 执行类 question | {"action":"reveal_answer"} | 展示答案及错误原因，进入 answer |
| 执行类 answer | {"action":"judge","correct":true/false} | reviewed / unreviewed，进入 completed |

每个请求还必须包含 requestId 和 expectedVersion：

```json
{"action":"recall","recall":"clear","requestId":"recall-唯一ID","expectedVersion":1}
```

下一步判断示例：

```json
{"action":"judge","correct":true,"requestId":"judge-唯一ID","expectedVersion":2}
```

成功 HTTP 200 仍返回第 6 节完整结构，包含最新 stage、reviewStatus、version、recall 和答案。前端使用最新 version 提交下一步，不自行提交最终状态。

- 每步立即事务保存进度、最终状态和历史；退出无需额外保存。
- requestId 为 1 到 100 字符的非空字符串，同一题内唯一。重试沿用原 ID、原 JSON；后端返回该请求首次成功的原响应，不重复写入。
- 同 ID 不同请求体返回 409。原响应可能早于当前状态，若页面已继续操作应再次 GET 获取最新状态。
- expectedVersion 必须是非负整数。旧版本、跳步骤、重复判断均返回 409。
- correct/mastered 必须是布尔值且只能提供其一；思维类与待分类只用 mastered，知识/执行类只用 correct。
- allowedActions 为 start、recall、reveal_answer、judge 中当前合法动作。

待分类对接示例（版本取上一步响应，requestId 每次新操作唯一）：

```json
{"action":"start","requestId":"generic-start-1","expectedVersion":0}
```

随后 POST 同一路径的 /events：

```json
{"action":"reveal_answer","requestId":"generic-reveal-1","expectedVersion":1}
```

```json
{"action":"judge","mastered":true,"requestId":"generic-judge-1","expectedVersion":2}
```

以上依次返回 stage=question / answer / completed，allowedActions=["reveal_answer"] / ["judge"] / ["start"]。响应沿用第 6 节结构，mistakeType="unclassified"；揭示前 answer=null，揭示后返回实际答案。mastered=true 最终为 reviewed，false 为 unreviewed。再次 start 允许把已复习题重新复习；开始和揭示答案不改变最终状态，判断后才更新。重进页面使用 GET 恢复，幂等、版本校验、课程归属及内容编辑重置规则完全复用原逻辑。

## 9. 历史记录

GET /api/courses/:courseId/mistakes/:mistakeId/review/events?limit=20

limit 默认 20，上限 100。按事件 ID 倒序；下一页使用 nextBeforeId：?limit=20&beforeId=301。

```json
{
  "events":[{
    "id":302,"action":"judge","round":1,"mistake_type":"knowledge",
    "recall":"clear","result":"correct","from_status":"unreviewed",
    "to_status":"reviewed","created_at":"2026-10-11T08:00:00.000Z"
  }],
  "nextBeforeId":null
}
```

result 可为 null、forgotten、correct、incorrect、mastered、needs_review。开始、记忆选择和揭示答案同样记录；不改变最终状态时 from_status 与 to_status 相同。编辑后历史仍保留。

## 10. 错误处理

新增/扩展接口失败返回 JSON：

```json
{"code":"INVALID_REVIEW_STEP","message":"当前步骤不允许此操作","details":{}}
```

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | INVALID_ARGUMENT | 非法类型、缺少类型、参数/动作/布尔值不合法、标签跨课程 |
| 404 | COURSE_NOT_FOUND | 课程不存在 |
| 404 | MISTAKE_NOT_FOUND | 新课程范围接口中的错题不存在或不属于该课程 |
| 409 | VERSION_CONFLICT | 内容版本或复习步骤版本落后，请重新 GET |
| 409 | IDEMPOTENCY_CONFLICT | 同 requestId 使用不同载荷 |
| 409 | INVALID_REVIEW_STEP | 未看答案就判断、已完成后继续判断、中途重复开始 |
| 422 | REVIEW_CONFIG_INCOMPLETE | 缺少题目/答案；GET review 可获取 blockedReasons |
| 500 | INTERNAL_ERROR | 未预期服务器错误 |

原有详情、删除、标签接口继续保留原来的错误格式。文件上传格式错误仍按现有 Multer/Express 处理，本阶段未新增附件大小策略。

## 11. 数据结构与联调顺序

迁移版本 v6 → v7，新增 mistakes 字段：mistake_type、answer_content、explanation、favorite、review_status、review_revision。保留全部旧字段和原文；旧混合题目/答案不自动拆分。新增 mistake_review_progress（每题一行步骤）和 mistake_review_events（操作历史和重试结果）；不按标签复制进度。

前端建议顺序：

1. 新建补传 mistakeType；分类页面用原列表接口的 mistakeType 查询。
2. 编辑/收藏用 PATCH，标签继续用旧 knowledge 接口。
3. 搜索框与状态、收藏、标签筛选拼接到同一个 GET 查询。
4. 打开复习页先 GET review，按 stage 和 allowedActions 展示；首次或新一轮 POST start。
5. 每次选择直接 POST events，成功后更新 version；断网保留请求，重试不更换 requestId。
6. 页面重开通过 GET 恢复，最终状态筛选使用 reviewStatus。

本次后端调整不修改前端文件。前端需放开 unclassified 创建选项、待分类页面及队列复习入口；将待分类与思维类共用 reveal_answer → judge(mastered) 按钮流程，移除“待分类必须先分类才能复习”的提示。无需新增 action 或响应字段；仍按 stage、allowedActions 控制操作，缺少题目/答案时引导补齐。原三类单分类队列协议保持不变；待分类队列的前端类型白名单需由前端组员同步扩展。

需要共同确认的展示约定：缺少答案时引导补齐；旧混合图片由用户整理；编辑复习内容后重置为未复习。以上后端已按此规则实现。
