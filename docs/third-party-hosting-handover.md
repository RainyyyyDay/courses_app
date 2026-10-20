# 第三方接入说明：

**线上托管形态**

## 一、当前形态

| 部分 | 现状 |
| --- | --- |
| 前端 | 纯静态：`fronted/` 下 HTML/CSS/JS，无构建步骤，无框架 |
| 后端 | Node + Express + SQLite（better-sqlite3），单文件数据库 |
| 鉴权 | **没有**。接口全部匿名可访问 |
| 用户模型 | **没有**。所有课程/资料/错题全局共享，表里没有 `user_id` |
| 上传 | 落本地磁盘 `back/uploads/`，通过裸目录 `/uploads/xxx` 访问 |
| OCR | 浏览器端为主（`fronted/vendor/ocr/`，71MB 静态资源）；`/api/ocr` 作为回退 |
| 跨源隔离 | 后端给页面发 `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: credentialless` |

接口约 80 个，集中在 `/api/courses/:courseId/...`（课程、知识树、资料、笔记、错题、复习会话、复习计划、AI 辅助）。

## 二、必须由接入方实现的部分

### 1. 身份与鉴权（最核心）

- 登录、会话、登出；把用户 ID 传到后端（Cookie Session 或 JWT 都行）。
- **会话必须带 `HttpOnly` + `Secure` + `SameSite=Lax`**，前端不碰 token。
- 后端所有查询按用户过滤——这一层需要我们先改（见第三节），他们需要提供的是「可信的 user id」。
- 建议加 CSRF 防护：所有非 GET 请求校验 token 或 Origin。

### 2. HTTPS

浏览器端 OCR 依赖 wasm 和跨源隔离，线上必须是 HTTPS。没有 HTTPS 时部分浏览器的 wasm 线程、剪贴板、摄像头能力也会被限制。

### 3. 反向代理必须保留跨源隔离头

这是**最容易踩的坑**：很多人上线后只配了 gzip/缓存，把这两个头丢了，结果浏览器端 OCR 静默退化或直接失败。

nginx 示例：

```nginx
location / {
  add_header Cross-Origin-Opener-Policy "same-origin" always;
  add_header Cross-Origin-Embedder-Policy "credentialless" always;
  root /srv/courses/fronted;
  try_files $uri $uri/ /index.html;
}

location /api/ {
  proxy_pass http://127.0.0.1:3000;
}
```

注意 `credentialless` 会挡住没带 `Cross-Origin-Resource-Policy` 的第三方资源。如果页面以后接了外部字体、统计脚本、头像 CDN，需要它们回 `Cross-Origin-Resource-Policy: cross-origin`，否则加载失败。

### 4. 静态资源与 MIME

- `.wasm` 必须返回 `application/wasm`，否则 ONNX Runtime 会报错。
- `fronted/vendor/ocr/` 约 71MB（10MB SDK + 41MB wasm + 20MB 模型），要长缓存（`Cache-Control: public, max-age=31536000, immutable`），文件名带版本号更好。
- 模型 tar 也必须能整段下载（不要切片、不要改 Content-Encoding）。

### 5. 上传与文件访问

- 现在 `/uploads/xxx` 是裸目录，谁拿到 URL 谁能下。线上必须改成鉴权下载或签名 URL。
- 限制单文件大小（OCR 上限 20MB）、限制类型（图片/PDF/docx）、做病毒扫描。
- 上传目录换成对象存储更省心，但要注意跨源：图片若从对象存储直出，需要 `Access-Control-Allow-Origin` 与 CORP 头。

### 6. 限流与配额

- OCR 在用户自己的浏览器里跑，**不消耗服务端算力**，这是这套方案省钱的根因；但附件存储、AI 辅助接口（`/api/ai/*`）要限流。
- 建议按用户限制：课程数、附件总量、AI 调用次数。

### 7. CORS 收紧

现在后端 `cors()` 是全开。上线后应收紧到自己的域名，否则任何站点都能借用户的浏览器打你的接口。

### 8. 数据隔离策略（需要他们拍板）

两种做法，代价不同：

| 方案 | 优点 | 代价 |
| --- | --- | --- |
| 单库多租户（加 `user_id`） | 运维简单，改造集中在查询层 | 所有 SQL 都要带 owner 过滤，漏一处就是越权 |
| 每用户一库 | 天然隔离，越权面小 | 连接/备份/迁移管理复杂 |

我们建议前者，改造成本低，但要配自动化测试防漏。

## 三、需要我们先做的改造（他们不用管实现）

1. 数据库：`courses` 及下游表加 `owner_id`，所有查询按当前用户过滤。
2. 后端：加 `requireUser` 中间件，从会话取 user id；未登录一律 401。
3. `/uploads` 改成鉴权下载（或签名 URL）。
4. CORS 收紧到配置项。
5. `fronted/js/config.js` 里的 `API` 改成相对路径 `/api`，避免写死 `localhost:3000`。
6. OCR 回退开关：线上如果不想跑 Python 服务，把回退关掉，前端只走浏览器端。

## 四、部署检查清单

- [ ] HTTPS 生效
- [ ] 页面响应带 COOP + COEP，控制台里 `crossOriginIsolated === true`
- [ ] `.wasm` 的 Content-Type 是 `application/wasm`
- [ ] `vendor/ocr/` 命中缓存（第二次进入不重新下载）
- [ ] 未登录访问 `/api/courses` 返回 401
- [ ] 用户 A 的 URL 换给用户 B，返回 403/404（越权测试）
- [ ] `/uploads/xxx` 不带凭证访问被拒绝
- [ ] 上传超限返回 413，且不落盘
- [ ] 非 GET 请求的 CSRF 校验生效
- [ ] AI 接口有按用户限流

## 五、已知限制（提前告知产品侧）

- **浏览器端 OCR 精度低于服务端**：用 PP-OCRv5 mobile 量化模型，标点会丢、个别形近字会错（实测「眼睛」→「眼晴」）。所以结果必须经用户校对，不能直接入库。
- **首次使用要下 71MB 资源**：本地 instant，公网取决于带宽，弱网体验差。
- **WebGPU 只在 Chrome/Edge 新版可用**，Safari/Firefox 走 WASM，慢一些但能用。
- **PDF 在浏览器端处理**：pdf.js 逐页渲染（2 倍分辨率，最多 10 页）再识别，不需要服务端；但页数多、扫描分辨率高时会慢，建议前端提示页数上限。
- **SQLite 不适合多人同时写**：用户量上来要换 Postgres，或改成单写队列。

## 六、总结

**登录鉴权 + HTTPS + 反向代理保留 COOP/COEP + 上传鉴权 + 限流**；我们所做的是：**数据按用户隔离 + 接口加鉴权中间件 + 去掉写死的地址**。两边都完成，才能对外说「打开网址就能用」。
