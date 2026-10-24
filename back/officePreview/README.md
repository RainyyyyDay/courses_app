# Word / PPT 在线预览

独立的本地文件转换适配器，不使用 AI、不读取业务数据库、不下载远程 URL。
同时支持旧版 doc/ppt 临时转成 docx/pptx，交回浏览器现有解析器提取文字。
支持 doc/docx/ppt/pptx，最大原文件 50 MB，单任务 60 秒，单进程串行转换，最多 20 个等待任务。
首次转换 PDF，缓存于 back/data/office-preview；缓存按附件文件名、大小和修改时间区分。
保存成功后后台预热；已有附件首次查看时补转；失败后需明确点击重试。
预览只生成副本，不覆盖原文件、正文、大纲或导图。PPT 动画和交互不包含在 PDF 中。

## 依赖与本地准备

- Node 使用项目现有依赖，无需新增 npm 或 Python 包。
- 安装 LibreOffice（https://www.libreoffice.org/download/download-libreoffice/），并准备课程文档使用的中文字体。
- Windows 自动检测 Program Files 下 LibreOffice/program/soffice.com。
- Linux 自动检测 /usr/bin/libreoffice、/usr/bin/soffice。
- 非默认安装位置：启动后端前设置 OFFICE_PREVIEW_CONVERTER 为可执行程序完整路径。
- 一键启动不会自动安装软件；缺组件时网站及图片/PDF 预览仍可用。
- 安装或配置后重新启动后端，再运行 start-local.ps1 -CheckOnly。

## 部署交接

当前接口为 GET /api/attachments/:name/preview（状态 JSON）和同路径 preview.pdf（预览副本）。
?retry=1 用于重新准备失败任务。状态为 preparing/ready/failed/unavailable/busy/missing。
本地复用现有上传地址的访问边界。正式部署必须沿用大网站附件权限校验，为原件及预览副本提供同等鉴权。
旧版文字提取入口 POST /api/office/convert-legacy，multipart 单个 file，最大 50 MB；
返回对应 docx/pptx 二进制（最大 32 MB），失败返回 JSON code。与预览共用单进程串行队列，
等待转换的临时上传总量限 100 MB；临时输入/输出在完成、失败后清理，无业务记录写入。
用户取消后停止等待，已启动的转换可能运行至结束或 60 秒超时；其结果不会写回已关闭的页面。
转换服务应作为隔离工作进程/容器部署，限制网络、CPU、内存和磁盘，禁止宏和外部资源访问；
当前适配器写入独立用户配置以提高宏安全级别，不能替代生产环境进程隔离。
定期清理已无原件的缓存目录；应用实例间如需共享，应由大网站统一管理任务和对象存储。
扣子环境如不允许运行 LibreOffice，应独立部署转换服务，Python 路由仅负责 JSON 协调及受控文件交付。

## 验证边界

自动化可注入模拟转换器，验证缓存、排队、失败、重试和前端操作流程；不代表真实 Office 排版已验证。
真实验收须安装 LibreOffice 后，用实际 Word/PPT（图片、表格、中文、公式）检查 PDF 排版，
覆盖上传保存、立即打开、重开、刷新、后端重启、替换附件，以及损坏/加密文件。

自动化入口：

- `node --test tests/office-preview.cjs`：模拟转换器的队列、缓存、源文件变化、失败和重试。
- `node --test --test-name-pattern "Office simulated" tests/office-preview-browser.cjs`：模拟转换，真实 HTTP/数据库及桌面、手机浏览器流程，含等待时关闭与失败后重试。
- `node --test --test-name-pattern "Office real" tests/office-preview-browser.cjs`：真实 LibreOffice 转换 DOCX/PPTX，真实浏览器及刷新、后端重启、替换和删除检查。
- `node --test tests/office-preview-legacy.cjs`：真实 DOC/PPT 转 PDF；未安装 LibreOffice 时明确跳过。
- `node --test --test-name-pattern "Legacy Office real extraction" tests/legacy-office-text.cjs`：真实 DOC/PPT 转 OOXML、浏览器提取、明确采用、保存、重开、刷新及已上传附件再提取。

2026-10-24：在获准安装 LibreOffice 后，DOCX 中文正文及表格、两页 PPTX 的真实转换和双视口浏览器流程通过，截图已检查。
旧版 DOC/PPT 的真实转换兼容性测试也已通过。图片/PDF 站内预览回归、模拟等待/取消/重试流程及启动检查通过。
随后接入旧版文字提取：真实 DOC/PPT 转 OOXML，桌面 Word、手机 PPT 的上传前提取、明确追加、保存、立即重开、真实刷新及已上传附件再次提取均通过；原附件字节保持一致。
新版 OOXML 提取回归、已有附件正文接口与冲突保护回归通过；转换失败/取消保留正文与草稿使用模拟响应验证。
这不代表所有复杂排版、动画、公式、加密文档都已验证；模型 API 未参与。
