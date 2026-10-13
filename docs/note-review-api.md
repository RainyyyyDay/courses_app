# 笔记独立阅读复习

本轮检查确认原项目只有笔记增删改查、附件和标签功能，没有独立复习。因此新增最小支持，并复用资料的阅读复习控制器和界面；两者始终独立。

## 数据兼容

迁移 v8 → v9，仅增加 `notes.review_status`：`unreviewed` / `reviewed`，旧笔记与新笔记默认未复习。原标题、正文、附件、source、标签全部保留。每条笔记仅一份状态，不因多标签重复；重复迁移不重置状态。原内容编辑及标签接口不改变。

## API

原 `GET /api/courses/:courseId/notes` 和 `GET /api/notes/:id` 增加 `review_status`，其余字段保持兼容。

新增 `GET /api/courses/:courseId/notes/:noteId/review`，200 返回完整笔记详情：

```json
{"id":12,"course_id":1,"title":"课堂笔记","content":"正文","file_url":"","file_type":"","source":"manual","created_at":"2026/10/13 12:00:00","review_status":"unreviewed","nodes":[{"id":7,"name":"知识点","type":"knowledge"}]}
```

新增 `PATCH /api/courses/:courseId/notes/:noteId/review`：

```json
{"reviewStatus":"reviewed"}
```

200 返回更新后的上述详情。请求仅接受 `reviewStatus`，合法值为 reviewed / unreviewed，重复设置同值幂等。复习页面只提交 reviewed；保留 unreviewed API 能力与状态筛选，不显示未复习判断按钮。

| HTTP | code | 说明 |
|---|---|---|
|400|INVALID_ARGUMENT|非法 ID、状态或额外字段|
|404|COURSE_NOT_FOUND|课程不存在|
|404|NOTE_NOT_FOUND|笔记不存在或属于其他课程|
|500|INTERNAL_ERROR|操作失败，可重试|

所有新复习接口先校验课程归属，不跨课程。原上传、改名、标签和删除接口保持原协议。

## 界面、筛选与恢复

课程 → 笔记 → 开始复习。共用资料的搜索、状态、直接标签筛选及 ID 勾选集合实现：不同条件 AND，多标签 OR，状态互斥；切换条件保留勾选，全选/取消全选仅作用于当前结果。现有列表无分页，全选覆盖全部匹配笔记。不递归查找标签后代。

已复习：保存成功后自动下一条。跳过：不写后端，不改变旧状态，不计成功数量。最后一条无论保存成功或跳过，都显示完成页。保存失败停留当前条，保留相同请求供重试确认；不自动跳过。

队列使用独立存储键 `note-review-queue:<courseId>`，不覆盖资料队列。退出保留位置，结束只清除该队列。刷新/恢复先 GET 当前笔记，以后端状态为准。正文、图片、PDF 和其他附件入口复用原有预览机制。

共用的 DOM 保留既有 materialReview 名称以减少接线变化，界面标题随板块切换；事件由 activeReadingReview 委托给独立资料/笔记控制器，不代表混合复习。

## v10 收藏扩展

笔记新增 favorite（响应 0/1，请求 true/false）。普通列表与复习弹窗共用收藏状态，都提供星标与收藏组合筛选。收藏和复习互不修改，原编辑与标签操作不会取消收藏。详见 [资料与笔记收藏接口](reading-favorites-api.md)。
