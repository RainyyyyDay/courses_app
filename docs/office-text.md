# Word/PPT 文字提取

## 2026-10-25：资料／笔记编辑弹窗

正文框增加固定的“正文内容（可编辑）”标题和说明，附件操作改为“从附件提取正文”。新选附件和已经保存的附件都可直接提取；已保存附件从原上传路径读取，不重新上传或改写原文件。PDF 优先文字提取、扫描页再 OCR，PDF/PPT 保留页码选择；格式不支持时显示原因，仍可手动录入。

结果先校对，再明确“替换正文／追加正文”，最后点击底部保存。提取中或结果尚未采用时不直接保存，失败和取消保留原正文及已有候选。关闭/换附件后的旧响应不能写入新窗口。

本轮也补齐编辑弹窗的正文提交：使用现有 `/api/courses/:courseId/materials|notes/:id/content` 及 `expectedContent` 防止覆盖其他页面的新正文。保留附件时可明确清空正文；不允许正文与附件同时为空。此接口只放宽 `replace` + 精确空字符串 + 已有附件的清空情形，空白追加仍拒绝。

新增 `tests/picker-saved-attachment-text.cjs`：隔离数据库/附件，真实 PDF 指定页、DOCX 和 PPTX 解析，桌面/手机的校对、替换/追加、保存重开和实际刷新；包括正文清空、并发冲突、失败、旧响应隔离、格式说明、原件不变及不重复上传。没有调用真实模型。扫描 PDF 的识别引擎由原 `pdf-ocr-pages.cjs` 模拟测试覆盖，不能当作本轮真实扫描准确率验收。

## 使用

上传 `.docx` 或 `.pptx` 后点击“识别文字”（错题答案附件为“识别答案文字”）。资料、笔记、错题题干和答案的新建、编辑均走共用入口。

- Word：提取正文中的标题、段落和表格；不制造分页，因为 Word 页数取决于字体和版式。
- PPT：按 `presentation.xml` 中的幻灯片关系顺序提取文本框和表格，不按 `slide1.xml` 文件名猜页序。支持全部页或 `1-5, 8` 这种范围。
- 结果先进入现有校对面板，只有明确点“替换”或“追加”才填入正文；不自动保存。
- 取消、失败保留原正文及已有校对结果。空白或只有图片的幻灯片会提示；若全无文字则显示说明，不返回假成功。
- 旧版 `.doc`、`.ppt` 请在 Office/WPS 另存为 `.docx`、`.pptx`。加密文档须先去掉密码。

图片里的文字、图表、公式、页眉页脚和备注不在本轮范围；复杂排版及自动编号需人工校对。可转 PDF 后使用扫描页识别。此功能仅提取文字，不提供 Word/PPT 的原版式网页预览。

## 实现与部署

`fronted/js/officeText.js` 负责类型分发、XML 文字提取和校对结果；`officeTextWorker.js` 在 Worker 中解压必要 XML。压缩包和 XML 都在浏览器内存中处理，不调用 AI 或服务端 OCR，不写数据库。附件本身仍沿用原上传保存流程。

第三方依赖为 MIT 许可的 `fflate@0.8.2`，记录于 `ocr-trial/package.json` 和锁文件。无需 Python 依赖或额外后端。

从仓库根目录准备：

```powershell
npm ci --prefix ocr-trial
node tools/prepare-office-text.cjs
```

生成 `fronted/vendor/office/fflate.min.js` 和许可证。生成资源不纳入 Git；部署静态前端时必须包含它们以及 `officeTextWorker.js`。一键启动会在组件缺失时尝试从已安装依赖复制，并在依赖缺失时给出修复命令，不阻断网站。

处理上限：文件 50 MB、内部条目 5000 个、单个必要 XML 8 MB、必要 XML 合计 32 MB。只解压所需 XML，不读取嵌入图片/外部链接/宏；解压任务可终止，30 秒超时后提示拆分。大小或格式问题不会转交服务端偷偷重试。

格式实现参考：[微软 PPT 文本提取说明](https://learn.microsoft.com/en-us/office/open-xml/presentation/how-to-get-all-the-text-in-all-slides-in-a-presentation)、[fflate 官方说明](https://github.com/101arrowz/fflate)。

## 验证

```powershell
node --test tests/office-text.cjs tests/pdf-ocr-pages.cjs tests/ocr-web-smoke.cjs tests/frontend-script-syntax.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1 -CheckOnly
```

Word/PPT 测试使用程序生成的 OOXML ZIP 文档，通过真实 Chrome、Worker 和 fflate 验证段落/表格、分段文字、特殊字符、幻灯片顺序、范围、空白页、损坏 XML、旧格式、加密格式提示、超限、Worker 取消，以及资料正文确认流程。覆盖桌面和手机宽度，不请求真实 AI、服务端 OCR 或个人附件。不代表已经测试全部 Office/WPS 版本及复杂课件格式。


## 上传后补充正文

资料、笔记详情的“文件”标题旁有“识别附件／补充正文”入口。直接下载已经保存的附件进行本地识别，不新增上传文件；可再次选择 PDF/PPT 页码，识别结果可编辑。没有正文时“保存正文”，已有正文时可“追加并保存”或“替换并保存”，替换另有确认。也可以手动输入补充文字。

本地开发后端新增 `PUT /api/courses/:courseId/materials/:materialId/content` 和 `PUT /api/courses/:courseId/notes/:noteId/content`，JSON 为 `{text, mode: "append"|"replace", expectedContent}`。必填读取时的原正文用于并发检查，冲突返回 409；正文上限 100 万字符。只更新 content，不改附件、标签、复习状态、历史或大纲。不需要数据库迁移。大网站合并时由主后端接入同等正文保存逻辑与现有鉴权，不属于 AI 推理接口。

测试 `tests/existing-attachment-text.cjs` 使用隔离数据库和生成的 PPT/Word 附件，在真实浏览器验证已上传后提取、追加、替换确认、取消、并发冲突及刷新保留草稿；API 测试还检查课程隔离、无效参数、重复提交、服务重启后持久化和附件字节未变。
