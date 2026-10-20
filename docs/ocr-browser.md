# 浏览器端 OCR

错题上传时的「识别文字」默认在**浏览器里**跑：官方 `@paddleocr/paddleocr-js` + ONNX Runtime Web + PP-OCRv5 mobile 模型。图片不上传、不需要服务器算力。

## 为什么要改打开方式

浏览器端 OCR 依赖 10MB 的 JS 脚本、13–27MB 的 wasm 运行时和模型 tar。`file://` 协议下这些全被浏览器拦掉，所以页面必须通过 http 访问：

```
http://127.0.0.1:3000/
```

后端已经顺带托管了 `fronted/`，不用额外起服务。仍然双击打开 `fronted/index.html` 也能用，只是会自动回退到服务端 OCR（`/api/ocr`）。

## 准备运行时资源（一次性）

产物 71MB，不入库，拉下代码后跑一次：

```powershell
cd D:\捞捞\courses_app\ocr-trial
npm install
cd ..
node tools/prepare-ocr-web.cjs
```

会生成 `fronted/vendor/ocr/`：打包后的 SDK、ONNX Runtime 的 wasm、两个模型 tar。

## 运行链路

1. 用户点「识别文字」→ 前端懒加载 `fronted/js/ocrBrowser.js`。
2. 首次加载引擎（约 10MB）+ 初始化模型（约 20MB），实测冷启动 8–9 秒。
3. 之后的识别约 1 秒/张（1280×960 以内）。
4. 任何一步失败（`file://` 打开、PDF、老浏览器、模型加载失败）都会自动回退到服务端 `/api/ocr`。

## 实测（同一张 980×366 小字题图）

| 路径 | 冷启动 | 热识别 | 准确度 |
| --- | --- | --- | --- |
| 浏览器端（PP-OCRv5 mobile） | 8.8s | 1.07s | 文字正确，全角括号会变半角、空格丢失 |
| 服务端（PP-OCRv6 medium） | — | 约 12s | 全对 |

浏览器端快十倍，但模型小一档：标点和个别形近字会错（实测「眼睛」→「眼晴」）。所以校对面板必须保留，不能直接入库。

## 对比试验页

`ocr-trial/` 里有并排对比页（浏览器 vs 服务端 vs 标准答案解析），用来评估换模型的效果：

```powershell
cd ocr-trial && node server.js   # http://127.0.0.1:8010/trial.html
```
