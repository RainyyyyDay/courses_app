# 附件文字识别修复（2026-10-25）

截图中的 `/vendor/ocr/pdfjs/pdf.min.js` 加载失败来自本机缺失 PDF 读取资源。这个项目副本同时没有浏览器 OCR 运行时、模型和 Office ZIP 读取组件。

已按项目原有锁文件安装 `ocr-trial` 依赖，并运行已有的三个准备脚本，补齐：

- `fronted/vendor/ocr/pdfjs/pdf.min.js` 和 `pdf.worker.min.js`：PDF 页数、文字层读取与扫描页渲染。
- `fronted/vendor/ocr/paddleocr-js.iife.js`、`ort/`、`models/`：图片与扫描 PDF 页面在浏览器本地识别。
- `fronted/vendor/office/fflate.min.js`：新版 `.docx`、`.pptx` 的本地文字提取。

浏览器 OCR/PDF 资源约 73 MB。它们作为静态文件提供，新增后无需重启网站。请刷新 http://127.0.0.1:3000/ ，重新打开附件识别；首次初始化 OCR 可能需要稍等。识别结果仍需人工校对后填入正文。

验证包括六项测试：真实本地模型识别生成图片、27 页真实文字 PDF 的全部/指定页码读取及桌面/手机弹窗、页码校验、混合页面处理、取消及不自动上传到服务端。测试不读取用户附件、不调用真实 AI。

为适应本机环境，两个测试文件增加了 Edge 的自动查找路径，原文件保存在 `.attachment-repair-backup-*`。

此修复不安装 LibreOffice；旧版 `.doc` / `.ppt` 的转换、预览仍需该独立组件。图片和扫描 PDF 使用浏览器 OCR，不依赖 Python OCR 服务。

重新生成资源时，在项目根目录依次运行：

```powershell
node tools/prepare-ocr-web.cjs
node tools/prepare-pdf-preview.cjs
node tools/prepare-office-text.cjs
```

若迁移到另一台电脑，应先根据锁文件安装 `ocr-trial` 的 npm 依赖。模型副本保存在 `ocr-trial/models/`，方便离线重新准备浏览器资源。
