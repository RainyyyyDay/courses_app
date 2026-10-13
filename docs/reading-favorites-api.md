# 资料、笔记收藏与组合筛选（v10）

资料与笔记各自收藏、各自复习，不生成混合队列，不递归扩展知识点。普通列表与复习选题弹窗共用下面的后端状态。

## 数据迁移与兼容

启动后端时自动执行 v9 → v10：给 `materials`、`notes` 各增加 `favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0,1))`。旧内容默认未收藏；原标题、正文、附件、标签及复习状态全部保留。事务迁移可重复安全执行，不新增收藏关联表。删除内容时收藏随所在行删除，原有标签级联清理规则不变。

与错题现有约定一致：请求使用布尔值 `favorite: true/false`，响应使用 `favorite: 1/0`。前端可用 `Boolean(row.favorite)` 判断星标。

原列表、详情、创建和阅读复习响应兼容式增加 `favorite`；原上传、编辑、删除、标签及复习协议不变。收藏只更新 favorite，复习只更新 review_status，改名、正文、附件与标签编辑不自动取消收藏。

## 收藏与取消收藏

资料：`PATCH /api/courses/:courseId/materials/:materialId`

笔记：`PATCH /api/courses/:courseId/notes/:noteId`

收藏请求：

```json
{"favorite":true}
```

取消收藏请求：

```json
{"favorite":false}
```

只接受 favorite，缺少字段、非布尔值或额外字段返回 400。重复设置相同值幂等，不支持在该请求同时修改复习状态或正文。

成功 200 返回完整内容及直接关联标签。资料示例（笔记另外包含原有 source）：

```json
{"id":12,"course_id":1,"title":"讲义","content":"正文","file_url":"","file_type":"","created_at":"2026/10/13 12:00:00","review_status":"unreviewed","favorite":1,"nodes":[{"id":7,"name":"知识点","type":"knowledge"}]}
```

状态读取继续使用原列表、详情接口，或课程范围内的 `GET /api/courses/:courseId/materials/:materialId/review`、笔记对应路径。

| HTTP | code | 条件 |
|---|---|---|
|400|INVALID_ARGUMENT|非法 ID、收藏参数或查询参数|
|404|COURSE_NOT_FOUND|课程不存在|
|404|MATERIAL_NOT_FOUND / NOTE_NOT_FOUND|内容不存在或属于其他课程|
|500|INTERNAL_ERROR|收藏写入失败，可重试|

错误结构：`{"code":"INVALID_ARGUMENT","message":"请提交 favorite: true 或 false"}`。

## 扩展列表筛选

`GET /api/courses/:courseId/materials` 和 `GET /api/courses/:courseId/notes` 共用参数：

| 参数 | 示例 | 含义 |
|---|---|---|
|q|讲义|标题及 content 文本包含匹配，忽略大小写；不搜索附件二进制|
|favorite|true|true/1 仅收藏，false/0 仅未收藏；省略或空字符串不限制|
|reviewStatus|unreviewed|reviewed / unreviewed；省略或空字符串不限制|
|nodeIds|7,8|逗号分隔的当前课程直接标签 ID，最多 100 个；多个标签 OR|

例：`GET /api/courses/1/materials?q=讲义&favorite=true&reviewStatus=unreviewed&nodeIds=7,8`。笔记把 materials 换成 notes。

不同条件 AND，同一内容匹配多个标签仅返回一次。筛选严格限定课程，不通过父子标签或内容的其他标签扩展。返回完整数组，沿用原顺序，无分页；因此全选覆盖全部当前匹配结果。有效课程无参数查询保持原数组协议；非法课程 ID 返回 400，不存在的课程返回 404。

## 前端调用与验收

- 课程 → 资料/笔记：列表每行有 ☆/★；点击提交 PATCH，成功后刷新星标；失败保留当前显示、提示并允许重试。
- 普通列表顶部有搜索、收藏、复习状态和多选标签；收藏筛选可与其他条件组合。
- 开始复习 → 选择弹窗：加载当前课程完整数组，对相同字段筛选；包含收藏筛选与星标。弹窗与普通列表操作共享数据库状态，保存成功后同步当前界面。
- ID 集合保留隐藏勾选；切换收藏或其他条件不会清空选择。全选/取消全选仅操作当前匹配内容，清空已选才清除全部。
- 刷新后收藏从后端读取。资料/笔记各自队列沿用原 localStorage 键；已复习、跳过、退出、结束的阅读流程不变。

人工验收：分别在资料、笔记收藏两条内容；打开复习弹窗，只看收藏，再结合正文搜索、复习状态及多标签筛选；切换条件确认勾选保留；弹窗取消收藏后关闭，确认普通列表同步；刷新确认持久化；完成一次复习确认星标不变。
