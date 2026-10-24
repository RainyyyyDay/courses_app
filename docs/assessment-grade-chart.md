# 考核构成饼图

考核卡片可以保存一张可编辑的考核构成饼图。图表数据与考核正文、附件和完成状态相互独立。

## 数据

每个考核最多一张图表，保存在 `assessment_charts`：

```json
{
  "title": "总评成绩构成",
  "items": [
    {"label":"考勤","percent":10,"detail":"签到和课堂参与","color":"#7f9298"},
    {"label":"期末","percent":60,"detail":"闭卷考试","color":"#a8b4a3"}
  ],
  "version": 1,
  "source": "manual"
}
```

- 标题最多 120 字，最多 30 个部分。
- 每个部分需要唯一名称，占比大于 0 且总和不超过 100%。
- 总和小于 100% 时允许保存，前端自动补一个不可单独调整数值的“未说明”灰色部分。
- 保存使用 `expectedVersion`；并发编辑返回 `409 CHART_VERSION_CONFLICT`。
- 删除考核时图表由外键级联删除。

## 接口

- `GET /api/courses/:courseId/assessments/:assessmentId/chart`
- `PUT /api/courses/:courseId/assessments/:assessmentId/chart`

考核列表响应同时附带 `chart`；没有图表时为 `null`。

## 显示与编辑

查看状态使用本地化的 Chart.js 4.4.9 绘制只读饼图。悬停或触摸扇区显示名称、占比和具体内容，并绘制引导线。移动端同时保留图表下方的可聚焦明细列表，避免只能通过悬停获取信息。

“编辑图表”打开独立编辑器。标题、部分名称、占比、具体内容和颜色均可手动修改；保存或取消不会影响考核名称、正文和完成状态。

## AI 提取

- AI 按钮只在 `coursesAiSettings.realReady()` 为真时启用；手动图表不受 Key 状态影响。
- “AI 读取附件并生成”复用现有 OCR、PDF 文本层和 Office 文本能力，不建设第二套 OCR。
- 考核新增页和编辑页都可识别当前选择或已保存的附件；结果进入独立的“附件识别内容”框，用户可校对。
- 考核正文旁和识别内容旁的“传入图表的 AI 提取来源”按钮会先保存考核，再打开图表编辑器，并用最新点击的整段文字覆盖“提取来源文字”。后一次传入覆盖前一次。
- 考核编辑页可更换或删除附件；替换成功后服务端清理旧文件。
- OCR 文字先填入来源框，用户可以再选择替换或追加考核正文；不会自动改动原文。
- AI 只接收提取后的文字，不接收附件二进制，也不接收 API Key 的持久副本。
- AI 结果只是编辑器中的草稿，必须由用户点击保存后才写入数据库。
- AI 不得猜测缺失占比、平均分配或自动补齐到 100%；缺少的部分由前端显示为“未说明”。
- AI 总和超过 100% 时拒绝采用，要求用户核对来源。

AI 接口为 `POST /api/ai/assessment-chart`，仅加入本机固定 AI 网关允许列表，输入来源最多 8000 字；编辑当前图表时会把说明截到 200 字以控制请求大小。

## 验证

- `node --test --test-name-pattern="assessment API" tests/assessments.cjs`
- `node --test --test-name-pattern="assessment edit" tests/assessments.cjs`
- `node --test tests/local-ai-gateway.cjs tests/frontend-script-syntax.cjs`
- 在 `ai-fastapi` 目录设置项目本地 Python 依赖路径后运行 `python -B -m unittest tests.test_assessment_chart -v`

浏览器测试覆盖桌面和手机、手动图表保存、未知比例、明细列表、悬停提示和未配置 API 时 AI 按钮不可用。
