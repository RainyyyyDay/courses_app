# 错题题型显示与确认（v18）

独立字段 `question_format_confirmed`：0 待确认，1 已确认；题型仍使用 `question_format=open/choice`。与错题分类 `mistake_type`、AI 建议 `review_method` 无关。

v17→v18 使用现有迁移链，事务内新增一列，默认 0。全部存量题目保持原题型、内容与复习数据，不根据选项或文字猜测确认状态。重复初始化安全。新建时只有请求明确提交有效 questionFormat 才确认；旧客户端未提交则待确认。编辑恢复原确认状态，勾选或明确选择题型后可保存。

列表、普通详情共用徽标与入口：待确认题可确认当前题型，或进入现有编辑弹窗设置选择题。已有结构化选择题也先显示待确认，提供“确认当前选择题”，不会被静默转为主观题。确认通过原 PATCH 接口仅提交 questionFormatConfirmed=true、expectedRevision；只更新确认列，不触发 updateMistake 的复习失效逻辑。选择题仍经原校验；错误选项、无正确答案不能确认或保存。

真正改变题型仍使用已有失效规则：提示并要求确定后，review_revision 增加、review_status 回到 unreviewed、当前步骤回到 idle；不删除历史评分/事件、会话、计划或记忆状态。只确认不执行这些动作。卡片与详情徽标即时更新；刷新和重开编辑从后端恢复。

本轮未修改原数据库；所有执行过的迁移、HTTP 写入与复习均在临时虚构库中。用户下一次重启 Node 后端时，现有本地库会自动升级到 v18。未读取 .env、未调用真实模型、未提交 Git。

## 验证

在项目根目录执行：

```powershell
node --test tests/mistake-format.cjs tests/mistake-ai.cjs tests/ai-proxy.cjs tests/mistake-ai-http.cjs ai-service/test/service.test.js
```

42/42 通过，无跳过。新增题型套件 8 项，包含实际 v17 数据升级、只确认前后保护表逐行比较、进行中/已完成复习保护、重启恢复、完整性校验、真正改题型的既有重置及历史保留、原有错题 CRUD/复习回归、旧迁移回归。Chrome 1280×960 和 390×844 实际执行 HTTP 与刷新，覆盖列表/详情、确认、复用编辑、取消/接受题型变更提示、新增两类题型、状态恢复及横向溢出检查。未运行整站 regression.cjs（其默认会复制现有数据）；仅在独立夹具中复用所需回归函数。

首次旧迁移回归发现重复加列，增加列存在检查后复测通过。额外 Python 回归发现之前更新设计文档后，“六项模式表”旧断言与最新七项、多表格不匹配；仅修正测试读取主模式表及七项期望，未变更 AI 契约/业务。

Python 最终复测 29/29 通过（ai-fastapi 目录，设置 PYTHONPATH 指向根目录 .local-ai-deps 后执行 `python -B -m unittest discover -s tests -v`）。所有改动的 JavaScript 语法及 `git diff --check` 通过。

本轮修改文件：back/db/schema.js、back/db/mistakes.js、back/server.js、fronted/index.html、fronted/style.css、fronted/js/mistakes.js、fronted/js/mistakeDetail.js；新增本说明及 tests/mistake-format.cjs；同步升级五个既有测试夹具的版本断言（tests/mistake-backend.cjs、tests/material-review.cjs、tests/review-center.cjs、tests/review-plans.cjs、tests/regression.cjs），修正 ai-fastapi/tests/test_core.py 的文档读取断言。其他已有修改保留。

## 手动检查

1. 重启 Node 后端，再打开原网站并 Ctrl+F5。
2. 打开课程→错题→分类：旧题显示“题型待确认”，包括原有结构化选择题。
3. 对旧主观题点“确认是主观题”：徽标立即变成“主观题”，原复习状态不变。进入详情、刷新，再打开编辑应仍确认。
4. 点“编辑为选择题”：沿用原弹窗，补齐选项与正确答案；缺失时保存被拦截。真正改变题型时会提示当前复习重新开始，取消不保存；确定后历史记录保留。
5. 新建主观题、单选、多选，检查徽标、编辑回显及原选择复现。AI 建议与本地保存功能保持原行为。真实手机触摸体验仍建议人工验收。
