# SCF Web 函数第一阶段：mock、业务关闭

本阶段复用 Express 应用，只增加独立的配置与进程入口。没有实现登录、服务间授权、共享额度或调用记录；没有部署云资源。主网站继续由大组负责认证。本阶段不修改 back/aiProxy.js 的开关。

## 两个入口

| 入口 | 配置和监听 | 访问规则 |
| --- | --- | --- |
| 原 `npm start --prefix ai-service` | 保持原样，Node 尝试加载本地 .env；127.0.0.1，默认 3001 | 原 Host、来源、代理头、生产和用户 Key 限制保持不变 |
| `npm run start:scf --prefix ai-service` | 直接 node src/scf-server.js，不加载 .env；0.0.0.0:9000 | GET/HEAD /health 可用，所有 /api 请求固定 503 AI_AUTH_NOT_CONFIGURED，无模型调用 |

SCF 准备入口只支持 Node 24.x 且不低于 24.11。AI_PROVIDER 未设置或为 mock 才可启动，deepseek/其他值安全失败。即使误注入 DEEPSEEK_API_KEY 或 DEEPSEEK_MODEL，也不读取或传入它们，不能启用真实模型。HOST/PORT 仅接受 0.0.0.0/9000（也可不设置）；NODE_ENV 仅接受 production（也可不设置）。AI_KEY_MODE=user 仍拒绝。

允许的非秘密调优变量：AI_TIMEOUT_MS、AI_MAX_CONCURRENT、AI_LOG_REQUESTS、RATE_LIMIT_MAX、RATE_LIMIT_WINDOW_MS，复用原取值校验；不输出变量值。SCF 配置加载器以显式白名单调用本地校验器，不改变本地校验器规则。

健康检查响应表明 provider=mock、mode=scf-preparation、business_enabled=false、local_only=false，仅证明进程存活。健康路径不会请求模型或验证业务能力。云端入口没有可注入“直接放行认证”的参数，也没有通过环境变量启用业务的开关。授权检查先于题目解析和 Provider 执行。

此准备入口会监听全部网卡；本机短时验收后应停止，禁止在未经授权时使用隧道、反向代理公开。业务虽关闭，公开入口仍可能产生云资源费用；未来也必须验证所有入口的服务间授权。

## 官方要求和待验证事项

- [SCF 启动文件说明](https://cloud.tencent.com/document/product/583/56126)：scf_bootstrap、端口 9000、非回环监听、LF 结尾。
- [官方运行环境表](https://docs.cloudbase.net/cloud-function/runtime-support)：Node 24.11 对应 /var/lang/node24/bin/node。此表属于 CloudBase；目标 SCF 地域、Linux 镜像补丁版本和解释器路径仍须实际确认，不能用 Windows 测试替代。
- [SCF 函数 URL 鉴权](https://cloud.tencent.com/document/product/583/96100)：以后与大组确认 CAM 或其他可靠服务授权；不使用开放匿名入口作为整合方案。

bootstrap 明确 cd /var/user，然后 exec /var/lang/node24/bin/node src/scf-server.js，不执行 npm、不安装依赖、不加载 .env。缺模块、非法配置、端口占用均输出固定失败信息，非零退出。

## Windows 本地测试（已有依赖，无需安装）

在仓库根目录 PowerShell：

```powershell
node --test tests/ai-proxy.cjs
npm test --prefix ai-service
npm run test:scf --prefix ai-service
python -B ai-service/test/scf_package_test.py
git diff --check
```

SCF 测试要求本机 9000 端口空闲。普通 AI 测试仅使用假上游；不运行 test:integration。测试会使用系统临时目录并清理，均不访问项目数据库或本地 .env。SCF 测试短时监听 0.0.0.0:9000，完成后关闭。

## 白名单打包及验证（不会安装依赖）

Python 3.10+ 标准库工具，不需要 pip 或新 npm 包。只读取固定源码清单及 lockfile 内生产依赖目录中的 JS/JSON/许可证，排除测试、示例、环境文件、凭据文件名、日志和数据库；不递归收集整个仓库。不接受软链接，依赖版本必须匹配锁文件。不读取被排除文件内容。新增原生依赖或其他运行资产时，需要重新审查白名单。

PowerShell，在仓库根目录：

```powershell
New-Item -ItemType Directory -Force ai-service/work
python -B ai-service/tools/scf_package.py build ai-service/work/courses-ai-scf.zip
python -B ai-service/tools/scf_package.py verify ai-service/work/courses-ai-scf.zip
python -B ai-service/tools/scf_package.py smoke ai-service/work/courses-ai-scf.zip
Get-FileHash ai-service/work/courses-ai-scf.zip -Algorithm SHA256
```

build 拒绝覆盖已有 ZIP；重复构建时使用一个新文件名，例如 courses-ai-scf-2.zip。相同输入使用固定时间、排序和无压缩 ZIP，输出字节可重复。ZIP 写入 Unix 常规文件类型和权限，bootstrap 为 755，其余为 644。verify 检查白名单、根目录、必需文件、重复/危险路径、哈希清单、锁文件依赖版本、脚本准确命令、LF、无 BOM、末尾换行和权限元数据。

smoke 验证后解压到系统临时目录，以清洁的环境变量启动包内 JS（不调用 bootstrap），验证 health 和伪造身份的业务请求拒绝，随后关闭进程并清理。需要本机 9000 空闲；Windows smoke 成功不代表 Linux 启动脚本成功。

包包含 package.json、package-lock.json、config/classification.json、列明的运行源码、node_modules 生产运行文件和 scf-package-manifest.json；不含本地 server.js、测试、工具、.env 或无关前后端。哈希清单用于发现传输损坏，不能当作可信发布者数字签名。工具不验证第三方安装文件与 npm tarball 的密码学一致性；最终构建需使用可信的依赖来源。

## WSL/Linux 最终验收（后续执行，本轮未执行）

在已提供 Node 24.11+（24.x）、Python 3、bash 和已有 Linux 生产依赖的受控目录执行。当前阶段禁止安装新依赖；若没有此环境，应保留待验收状态。

```bash
node --test test/service.test.js
node --test test/scf.test.js
python3 -B test/scf_package_test.py
python3 -B tools/scf_package.py build /tmp/courses-ai-scf.zip
python3 -B tools/scf_package.py verify /tmp/courses-ai-scf.zip
```

在 WSL/Linux 中可执行以下解压/脚本检查（需要已有 unzip，不安装工具）：

```bash
scf_stage=$(mktemp -d /tmp/courses-ai-scf-stage.XXXXXX)
unzip -q /tmp/courses-ai-scf.zip -d "$scf_stage"
test "$(stat -c '%a' "$scf_stage/scf_bootstrap")" = 755
bash -n "$scf_stage/scf_bootstrap"
```

通过目录挂载将 staging 只读挂载为目标兼容容器的 /var/user，使用实际 /var/lang/node24/bin/node；只为 /tmp 提供写权限。容器启动命令为 /var/user/scf_bootstrap，端口只映射到宿主 127.0.0.1，避免公开。尚未取得目标兼容镜像标识，不在这里猜测可用镜像或提供自动拉取命令；由大组确认镜像后补齐具体容器命令。

必须验收：启动监听 0.0.0.0:9000；/health 返回 mock、业务关闭；/api/ai/classify 即使带伪造用户/Authorization 也返回 503；无 .env/模型 Key 时正常；AI_PROVIDER=deepseek、非法 PORT/HOST 或不支持运行时启动失败；端口占用/配置错误日志无敏感信息。还需确认代码目录只读可运行、目标代理头/路径和状态响应透传。

Windows 生成并通过 verify 的 ZIP 仅代表格式、内容及权限元数据已验证，不能宣称 Linux chmod/解压器权限恢复、绝对解释器路径或 SCF 运行成功。

## 创建云函数之前

与大组确认地域/账号、可信后端认证适配接口、稳定用户 ID、服务间身份及上下文签名、共享额度/记录接口、网络和费用责任人。保持真实 AI 及业务路由关闭。下一阶段经确认后再实现授权；不另建登录、数据库或模型 Key 入口。创建函数、配置 URL/CAM、上传代码、云端测试均需要后续授权，本说明不执行任何云端操作。
