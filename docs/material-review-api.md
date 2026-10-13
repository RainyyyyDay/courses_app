# 资料独立复习接口

仅处理当前课程的资料阅读回顾，不包含错题、笔记、综合复习或标签递归扩展。

## 数据兼容

迁移 v7 → v8，仅给 `materials` 增加 `review_status`：`unreviewed` / `reviewed`。旧资料和新增资料默认 `unreviewed`，原文、附件、标签不变。迁移可重复执行，不重置已有状态。改名、标签编辑不改变复习状态。

## 复用接口

- `GET /api/courses/:courseId/materials`：沿用原列表顺序，增加 `review_status`。
- `GET /api/materials/:id`：增加 `review_status`，保留原字段和 `nodes`。
- 上传、删除、改名及标签接口不改变。

选择弹窗使用完整列表在前端搜索标题和 `content`，并筛选 `review_status` 与直接关联的 `nodes`。搜索、状态、标签之间采用 AND；多个标签采用 OR。已复习/未复习通过同一个选择框互斥，全部表示不限制状态。不会查询标签后代或由其他标签扩展内容，附件二进制内容不参与搜索。

现有列表接口无分页，前端持有当前课程全部资料；全选覆盖当前条件下全部匹配结果。ID 集合去重，切换条件保留勾选，取消全选只影响当前结果，清空已选才清除全部。开始后按原列表顺序固定队列。

## 新增接口

`GET /api/courses/:courseId/materials/:materialId/review`

读取资料实际状态及内容，成功 200 返回原资料详情结构：

```json
{"id":12,"course_id":1,"title":"讲义","content":"正文","file_url":"","file_type":"","created_at":"2026/10/13 12:00:00","review_status":"unreviewed","nodes":[]}
```

`PATCH /api/courses/:courseId/materials/:materialId/review`

```json
{"reviewStatus":"reviewed"}
```

未复习传 `{"reviewStatus":"unreviewed"}`。成功 200 返回更新后的完整资料详情。请求只接受 `reviewStatus`，不修改原文、标题、附件或标签。

每次判断立即保存。重复提交相同状态是幂等的绝对状态设置；已复习资料允许再次标记未复习。本阶段无额外复习历史表或复杂会话协议。

错误 JSON 为 `{"code":"INVALID_ARGUMENT","message":"..."}`：

| HTTP | code | 情况 |
|---|---|---|
|400|INVALID_ARGUMENT|非法 ID、缺少/非法状态或额外请求字段|
|404|COURSE_NOT_FOUND|课程不存在|
|404|MATERIAL_NOT_FOUND|资料不存在或不属于当前课程|
|500|INTERNAL_ERROR|保存失败，可重试|

## 前端流程

资料首页 → 开始复习 → 搜索、状态/标签筛选、勾选 → 固定队列 → 展示标题、正文、附件预览。

- 已复习：提交 `reviewStatus:"reviewed"`，确认成功后自动下一条；最后一条自动完成。
- 跳过此条：不发送状态写入，直接下一条；不计成功复习数量。已有状态保持原值，包括原本已复习的资料。
- 不再显示未复习判断按钮，但保留未复习筛选及原 API 对 `unreviewed` 的兼容支持。
- 退出，稍后继续：保存当前队列位置及待确认请求，返回资料页；恢复时先读后端状态。
- 结束本轮：只清除当前板块的前端队列，不改已保存状态。

完成页分开统计成功复习与跳过数量，不将跳过计入成功。资料和笔记复用 `createReadingReview` 和同一个选择界面，分别调用接口并使用不同存储键，不混合队列。

队列按现有列表顺序、唯一 ID 保存到当前浏览器的 localStorage（资料键 `material-review-queue:<courseId>`）。单条状态通过上述 GET/PATCH 获取和保存；刷新、恢复时重新 GET，不由前端伪造状态。保存失败保留待确认操作，禁止自动跳过；重试相同绝对状态确认成功后自动继续。未知附件类型提供打开附件入口。

后续 v10 增加资料与笔记的独立收藏字段，列表增加收藏等组合查询，详情及复习响应增加 `favorite`（0/1）。普通列表和复习弹窗均有星标与收藏筛选，收藏不改变复习状态。接口、参数及迁移见 [资料与笔记收藏接口](reading-favorites-api.md)。旧资料队列仍可恢复，旧未复习操作不在新界面重放，也不计入成功复习。

后端重启时自动迁移；自动化测试只操作临时数据库，真实业务数据库不用于测试写入。
