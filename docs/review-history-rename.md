# 复习历史重命名

2026-10-21：历史列表、最近记录及记录详情的操作栏增加“重命名”。使用原 review_sessions.name，不新增数据库字段。支持进行中、暂停和已完成记录；不会重命名原计划、原内容或改动会话类型。

输入预填当前名称，支持1至100个字符；取消不保存，失败保留输入，成功关闭并提示。更新当前列表标题和已加载状态，不刷新分页、不改变筛选或按最近复习时间的排序。新名称按文本显示，不执行HTML。

后端 `PATCH /api/courses/:courseId/review-sessions/:sessionId/name`，JSON `{name,expectedName}`。课程和会话归属检查沿用原接口；旧名称不匹配返回409，避免旧页面覆盖其他修改。仅更新name，updated_at、进度、评分、事件和计划保持不变。原库无需迁移。

验证：`node --test --test-name-pattern='review record rename|review history rename|shared sessions API' tests/review-rename.cjs tests/review-sprint.cjs`，3/3通过。包含真实Chrome桌面/手机中的预填、取消、空值、保存失败保留、重复点击、列表/详情/最近记录同步、刷新持久化和HTML文本转义；API验证各状态、参数/课程隔离/冲突及重启持久化，数据库快照确认只改变name。语法及git diff --check通过。

部署本地更改需重启3000业务后端，再Ctrl+F5刷新网页；未调用模型、读取.env/用户原数据库、提交Git或进行数据库迁移。
