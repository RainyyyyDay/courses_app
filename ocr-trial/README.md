# 浏览器端 OCR 试验

用 `@paddleocr/paddleocr-js`（官方，Apache-2.0，ONNX Runtime Web）在浏览器里跑 OCR，和服务端的 PaddleOCR 并排对比。

## 为什么需要一个本地静态服务器

浏览器端 OCR 要开多线程 WASM / WebGPU，页面必须**跨源隔离**（`Cross-Origin-Opener-Policy` + `Cross-Origin-Embedder-Policy`），而且 SDK 是 ESM 模块。这两点都要求页面从 `http://` 加载，`file://` 直接打开是不行的。

`server.js` 就是个几十行的静态服务器，会带上这两个响应头，并把 `/vendor/ort/` 映射到 `node_modules/onnxruntime-web/dist/`。

## 运行

```powershell
cd D:\捞捞\courses_app\ocr-trial
npm install
node server.js
```

然后打开 <http://127.0.0.1:8010/trial.html>。

页面里选一张图 → 「浏览器端识别」和「服务端识别」各点一次，两边会并排显示文本和耗时。把正确文本贴到「标准答案」里会算出字符错误率。

## 构建

改了 `src/trial.js` 之后要重新打包：

```powershell
node -e "require('esbuild').build({entryPoints:['src/trial.js'],bundle:true,format:'esm',outfile:'dist/trial.js',platform:'browser',external:['fs','path','crypto']})"
```

`external: ['fs','path','crypto']` 是必须的：OpenCV.js 里有只在 Node 下才走的分支，浏览器构建要跳过。

## 无头验证

```powershell
node verify.cjs wasm small     # 小字题目样张
node verify.cjs wasm novel     # 整段小说截图
node verify.cjs auto small     # 让 SDK 自己选后端
```

注意 `verify.cjs` 用 `--disable-gpu` 启动 Chrome，所以测到的都是 WASM 路径；真实 Chrome 里 WebGPU 会更快。

## 已知代价

- 打包后 `dist/trial.js` 约 11MB（OpenCV.js 占大头），首次还要下 20MB 模型。
- 用的是 PP-OCRv5 mobile 的 ONNX 量化模型，比服务端的 PP-OCRv6 medium 弱一档：标点和个别汉字会错（实测「眼睛」→「眼晴」）。
- 大图和 PDF 多页会吃内存，低端设备要实测。
