# 课程复习中心（v13）

## 使用方式

课程的第五个标签现在为「复习」，位置不变。上半区保留原计划创建、详情、每日任务及补做功能；多个计划以单卡片循环轮播切换，单个计划隐藏箭头。计划状态由后端根据任务及考试日期计算。下半区显示最多五条会话记录，可进入全部记录页，按状态和来源筛选、分页、查看详情、继续或再次复习。

右上角「总复习」位于原「搜索本课程」前。支持资料、笔记、错题模块多选，以及搜索、收藏、内容 review_status、四类错题和直接标签筛选。全选当前结果只影响当前结果；全选本课程会选择所有可复习内容并启用三个模块。改变搜索和筛选保留选择，取消模块会移除该模块的选择，底部实时显示三类数量与总量。

总复习固定选中顺序，通过 type + id 区分身份。资料和笔记使用原 createReadingReview 的独立实例与同一页面；错题使用原详情、步骤机、requestId 和 expectedVersion。适配层只负责前后导航、跳过、暂停和类型切换。已处理项目可以返回查看，但不会再次修改其完成状态。

进行中或暂停记录通过「继续复习」恢复原 ID、项目、顺序、位置和已保存步骤，不创建新记录。已完成记录不可继续操作；「再次复习」校验原范围，排除已删除／不可复习内容并提示，创建新记录，原历史保持完成。若全部无效则提示，无空白队列。

## 与旧功能的关系

原内容 review_status、计划任务 status、会话项目 status 是三套独立状态。资料／笔记成功提交 reviewed 后完成对应会话项目；跳过只处理本次会话，不改变内容状态，也不完成计划任务。错题真实完成当前步骤流程后完成项目，答错或不记得依旧算执行完成，原内容可保持 unreviewed。

计划按类型启动原队列，每次具体执行记录为一个会话，同一计划可有多次会话。计划来源的会话项目关联 plan_item_id，完成时同事务更新计划。再次复习计划历史只使用历史范围，不重新打开旧计划任务。归档计划的未完成关联任务需先恢复计划再继续写入，保持原归档约束。

新启动的资料、笔记、错题模块队列同样记录会话。原模块保留现有列表、选择器、复习体验及恢复入口；本地头指针显示最近一轮，其他未完成会话通过历史独立恢复，不会丢失。

v13 以前缺少完整开始时间和执行记录，不补造历史。原本地队列继续可用。新模块复习覆盖本地头指针前，自动将未记录的旧队列备份到 legacy-review-backups:<courseId>，复习中心提供「继续旧…复习」入口。旧队列进度继续保存在本浏览器；新会话的范围、状态和位置则保存到 SQLite。

## 数据库

新增 v12 → v13 事务迁移，不修改 v1～v12 的迁移实现。旧库先沿原链升级至 v12，再执行 v13；失败回滚结构和版本号，重复启动不重置数据。升级不生成历史记录。

review_sessions 保存 id、course_id、source_type、source_id、source_date、name、status、current_position、create_request_id、request_json，以及 created_at/started_at/updated_at/completed_at。

- source_type：plan / total / material / note / mistake。
- status：active / paused / completed。
- source_id：可空，计划外键；删除计划时置空，名称快照保留。
- (course_id,create_request_id) 唯一，防止创建响应丢失重试造成重复。

review_session_items 保存 id、session_id、item_type、item_id、position、title_snapshot、status、completed_at、source_deleted、plan_item_id、review_round、review_revision。

- 项目状态：pending / completed / skipped。
- (session_id,position) 与 (session_id,item_type,item_id) 唯一，固定顺序和身份。
- 删除课程级联删除会话及项目。删除来源将未完成项目跳过，保留身份和标题；已完成项目保留完成状态并标记来源删除。
- 删除计划或计划任务只解除会话关联，不删除执行历史。
- 全部项目完成或跳过后，事务内自动将会话设为 completed；完成数量不包含 skipped。会话处理进度为 (completed + skipped) / total，计划完成率仍使用原规则。
- 开始、回忆、揭示、判断、导航、暂停及恢复更新最近活动时间。会话顺序不可修改。

历史只保存队列身份、标题及执行结果；不保存正文和附件的完整历史版本。错题当前步骤仍由原 mistake_review_progress 维护，不另建第二套步骤机。多个窗口操作同题仍使用原版本冲突处理。

## API

前缀 P = /api/courses/:courseId/review-sessions。所有 ID 和课程归属由后端校验，不能通过修改 sessionId 或 sessionItemId 操作其他课程。

| 方法 | 路径 | 含义 |
|---|---|---|
| GET | P/candidates | 当前课程三类内容及原有直接标签，供选题 |
| GET | P?limit=5 | 最近记录；进行中／暂停优先，再按活动时间和 ID 倒序 |
| GET | P?status=ongoing&sourceType=total&limit=20&offset=0 | 全部记录分页与筛选 |
| POST | P | 创建固定范围会话，201 |
| GET | P/:sessionId | 信息、统计、项目及可用性 |
| POST | P/:sessionId/resume | 恢复原会话，已完成返回 409 |
| POST | P/:sessionId/pause | 暂停；已完成时幂等返回原记录 |
| POST | P/:sessionId/position | 保存绝对 position，不修改完成状态 |
| POST | P/:sessionId/finish | 结束；仍有 pending 返回 409，不伪造完成 |
| POST | P/:sessionId/items/:sessionItemId/skip | 跳过当前会话项目，幂等 |
| POST | P/:sessionId/repeat | 原范围创建新记录，201；返回 excluded 列表 |

列表返回 {total,results}，status 支持 all / ongoing / active / paused / completed，sourceType 支持 all 或五种来源，limit 为 1～100，offset 为非负整数。详情包含原字段、total/completed/pending/skipped/progress/types/items。

创建示例：

```json
{
  "requestId":"一次创建的唯一ID，重试保持不变",
  "sourceType":"total",
  "selectedItems":[
    {"type":"material","id":1},
    {"type":"note","id":1},
    {"type":"mistake","id":1}
  ]
}
```

最多 2000 项。服务端重查来源、课程、标题及错题可复习性；重复身份、跨课程、无效类型和空选择拒绝。计划来源另传 sourceId 和 scheduledDate，服务端只允许加入该日 pending 任务。普通模块来源仅允许相同内容类型。

再次复习仅提交 {requestId}；新请求 ID 表示新一轮，相同请求重试不重复生成。暂停／恢复无需新创建 ID；位置和跳过采用绝对值或条件更新，重复请求不累计计数。

原阅读 PATCH /review 及错题 POST /review、POST /review/events 增加可选查询参数 sessionItemId，原请求正文不变。会话项目的完成与原内容更新、计划回写在同一事务。错题幂等载荷额外绑定会话上下文，重放同一请求到另一记录返回 409；普通无上下文请求保持原协议。

没有可直接任意标记 completed 的会话 API。已完成历史拒绝继续或导航，重复已成功写入不会覆盖 completed_at。原模块「结束本轮」保留未完成会话为 paused，可从历史继续。

## 修改范围与协作

后端新增 reviewSessions.js，schema.js 新增独立迁移，server.js 增加会话路由，原阅读／错题保存仅增加上下文和事务回写。

前端新增 reviewCenter.js；共享 index.html、style.css、app.js、page.js、courseDetail.js、reviewPlans.js 和三个复习控制文件有局部修改。这些文件可能与前端组员的工作冲突，应逐块核对合并。未改知识框架代码，未大范围格式化，未新增依赖，未自动 commit/push/merge/reset。实施前 main 工作区干净。

修改文件清单：

- README.md、docs/review-plans-api.md、docs/review-center.md。
- back/db/index.js、back/db/schema.js、back/db/reviewPlans.js、back/db/reviewSessions.js、back/db/mistakeReview.js、back/server.js。
- fronted/index.html、fronted/style.css、fronted/app.js、fronted/js/courseDetail.js、fronted/js/page.js、fronted/js/reviewPlans.js、fronted/js/reviewCenter.js、fronted/js/materialReview.js、fronted/js/mistakeDetail.js、fronted/js/mistakeQueue.js。
- tests/regression.cjs、tests/material-review.cjs、tests/mistake-backend.cjs、tests/review-plans.cjs、tests/review-plans-frontend.cjs、tests/review-center.cjs、tests/review-center-frontend.cjs。

## 验证

- node tests/regression.cjs --backend-only：隔离迁移与 API。
- node tests/regression.cjs：桌面 Chrome 完整回归。
- node tests/regression.cjs --viewport=390,844：窄屏 Chrome 完整回归。
- 测试仅写临时数据库和文件，并校验业务数据库哈希不变；不用业务库试写。

覆盖迁移回滚／重复与旧数据、同数字跨类型 ID、范围固定、创建及再次复习幂等、课程隔离、内容／计划／会话同事务回滚、负向错题执行、历史不可继续改写、来源删除与课程级联、多未完成会话、旧浏览器队列保留、计划轮播、筛选、前后导航、暂停、阅读及错题真实刷新恢复，并保留原全部回归场景。

建议英文提交摘要（不自动提交）：

`feat: unify course reviews with persistent sessions and mixed review navigation`
