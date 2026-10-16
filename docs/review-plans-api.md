# 考前复习计划（v12）

计划属于固定课程，只保存何时复习哪些内容。实际复习复用现有错题队列和资料／笔记阅读控制器。无 AI、跨课程、知识框架依赖或新的复习步骤。

## 数据与排期

启动自动迁移 v11 → v12，新增 `review_plans`、`review_plan_items`、索引和课程／来源删除约束。旧 migration 保持原样；v12 读取实际 user_version，因此旧版本也能一次启动升级到 v12。不修改旧内容、收藏、review_status 或错题事件。

计划状态为 active / archived。任务状态为 pending / completed / skipped，与内容自身 review_status 完全独立。每个计划内 `(item_type,item_id)` 唯一，不同计划可使用相同内容。

日期必须是真实的 YYYY-MM-DD。包含开始日期，不包含考试日期；考试日期须晚于开始日期。按 type + id 稳定排序，通过累计平均分配，任意两天数量差不超过 1。任务少于天数时存在空白日，不自动移动过期任务。第一版上限为 2000 项、3660 天。

完成率 `round(completed / (total - skipped) * 100)`。没有有效任务（包括全部 skipped）时固定返回 0%，同时显示各项数量，不表示任务已完成。

来源删除后，未完成任务变为 skipped，保留 title_snapshot 并设置 source_deleted=1。已完成任务保留完成历史，但同样显示来源已删除。删除计划级联删除任务；删除课程级联删除计划。删除计划不会删除来源内容。

## API

所有路径前缀为 `/api/courses/:courseId/review-plans`，ID 必须为正整数；课程与计划归属均由服务端校验。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/` | 计划列表及总体、今日统计 |
| GET | `/candidates` | 本课程资料、笔记、错题的选题数据，不读取知识树或标签 |
| POST | `/` | 创建计划，成功返回 201 |
| GET | `/:planId` | 详情、剩余天数、每日和今日统计 |
| GET | `/:planId/items` | 任务，可按 scheduledDate、status 筛选 |
| PATCH | `/:planId` | 仅改 name、status |
| DELETE | `/:planId` | 删除计划及任务 |

创建请求：

```json
{
  "name": "期末考试复习",
  "startDate": "2026-10-16",
  "examDate": "2026-10-28",
  "selectedItems": [
    {"type":"mistake","id":1},
    {"type":"note","id":5},
    {"type":"material","id":8}
  ]
}
```

只接收上述字段。空选择、重复内容、非法日期、同日／倒序日期、不存在或跨课程内容返回 400。服务端重查标题、来源和归属，并重新排期，不接收前端标题、courseId 或排期结果。筛选仅用于形成固定选择集合；后续收藏和复习状态变化不改变任务。

列表／详情在数据库字段外返回 `total`、`completed`、`pending`、`skipped`、`completionRate`、`remainingDays`、`today`、`todayStats`。详情另有 `days` 数组，每天含 date、同样的任务统计和按 mistake/material/note 分组的 types。包含零任务日期。

任务返回数据库字段及 mistake_type、reviewable。source_deleted=1 表示来源已删除。标题使用创建时的 title_snapshot。没有直接修改任务状态的公开 API。

PATCH 示例：`{"name":"期末冲刺","status":"archived"}`。修改日期和范围返回 400，需重新生成计划。归档计划保留任务，但拒绝继续写入计划复习结果。

## 复用原复习接口

原请求正文和响应结构保持不变，只增加可选查询参数 `planItemId`：

- 资料／笔记：`PATCH /api/courses/:courseId/materials或notes/:id/review?planItemId=123`，正文仍为 `{"reviewStatus":"reviewed"}`。
- 错题开始：`POST /api/courses/:courseId/mistakes/:id/review?planItemId=123`。
- 错题动作：`POST /api/courses/:courseId/mistakes/:id/review/events?planItemId=123`。

无参数即普通复习。服务端验证任务所属计划、课程、类型和对象；资料／笔记成功保存 reviewed 才完成任务。跳过和打开不计完成。

错题仍使用原 requestId、expectedVersion 和步骤机，达到 completed 即完成任务，无论判断结果是否为 reviewed。任务记录实际轮次及内容版本；旧完成结果不能直接抵扣。其他入口已完成同题但计划仍 pending 时，计划会开始实际的新一轮。计划上下文纳入幂等载荷比较，同 requestId 改用另一个任务返回 409；相同请求重试返回首次成功结果。内容和任务更新在原事务内完成，不嵌套 BEGIN。

任务重复完成不会累加数量或覆盖 completed_at。资料／笔记只支持在计划上下文提交 reviewed，不接受 unreviewed。错误继续使用 code/message；归档、已跳过等冲突为 409，任务归属不匹配为 404。

## 前端与恢复

课程 → 考前复习计划 → 创建。搜索、类型、四类错题、收藏和内容状态筛选可组合，隐藏选择保留，全选只影响当前结果。创建前显示数量与每日约数；最终以服务端排期为准。依照本版不依赖知识框架的约束，不提供标签筛选。

详情按日展开，支持今日和过期日期补做。开始今日复习进入第一类尚未完成内容（错题、资料、笔记顺序），一类完成后返回详情，也可按类型单独进入。阅读跳过后任务仍 pending，可以再次进入。计划创建后只开放改名、归档、恢复、删除。

阅读复用 createReadingReview 的独立实例和同一界面；错题复用原队列及详情步骤。计划导航键 `review-plan-session:<courseId>`，队列键 `review-plan-queue:<courseId>:<planId>:<date>:<type>`。普通队列、普通错题位置和待确认操作使用原键，互不覆盖。

刷新由计划上下文找到原控制器，仍通过原有恢复逻辑读取队列、重查后端步骤并重试待确认请求。来源删除或任务已完成时从服务端 pending 集合恢复；计划详情进度始终来自后端。页面位置沿用项目现有五分钟恢复有效期。日期统计以 Asia/Shanghai 日历日为准，完成时间使用 ISO 时间。

## 测试

`npm test --prefix back` 或 `node tests/regression.cjs` 运行完整隔离回归；`node tests/regression.cjs --backend-only` 只跑迁移与 API。使用临时数据库和后端，校验业务数据库原始哈希不变。

新增测试包括 v10/v11 到 v12、旧升级链、重复执行／失败回滚、数据快照保留、排期边界、混合选择／重复／跨课程、完成和删除、原复习事务故障注入、幂等及版本、前端创建和筛选、阅读跳过／响应丢失重试、阅读及错题两次真实刷新恢复、普通三类队列不被覆盖、归档和过期补做。
