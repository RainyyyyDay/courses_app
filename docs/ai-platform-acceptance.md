# 平台 AI / 自带 API 验收记录

日期：2026-10-24。范围：双模式凭据、平台配置状态、统一注册入口、前端设置及交接说明。

## 2026-10-25 页面入口补充验收

- 排查出新增/上传错题的 AI 建议、错题详情建议、新增和编辑答案草稿四处仍保留旧的 DeepSeek 临时 Key 选择器，已统一到共用双模式设置；删除页面内重复的服务商、模型和 Key 字段。
- 资料/笔记大纲、建议、复习材料和批改原本已使用共用设置；导图和考核图表补充直接打开同一个设置窗口的按钮。
- `tests/unified-ai-entries.cjs` 通过：桌面和手机实际打开入口、切换平台/自带 API、来源即时同步、模拟答案生成、不自动采用、编辑输入保留、保存重开和实际刷新。静态页面的设置按钮逐个检查均打开共用窗口，页面只保留一个中央 Key 输入框。
- `tests/platform-ai.cjs` 两项通过，既有 AI 设置直接相关八项通过，前端语法及一键启动检查通过。
- 本次仅使用隔离数据库、虚构 Key 和模拟 AI，未运行真实模型；未重新执行下文整套 Python/旧迁移测试，不能将专项通过解释为全套失败已解决。

## 已验证

| 检查 | 结果及边界 |
| --- | --- |
| Python `test_platform.py` | 5 项通过；环境被虚构配置隔离。7 个功能路由逐个检查平台配置绑定；大纲、分类和连接使用模拟模型输出；大纲另通过 `httpx.MockTransport` 检查实际出站请求的虚构 Authorization |
| `tests/platform-ai.cjs` | 2 项通过。桌面 1280×960、手机 390×844；平台无 Key 请求、状态检查不生成、失败保留内容且不切换、用户自带 Key、保存立即重开、实际刷新和不持久化凭据；AI 响应为浏览器拦截的模拟结果 |
| `tests/local-ai-gateway.cjs` | 5 项通过；固定本机转发、请求来源和响应体限制；新增 GET 状态转发另在 platform-ai 中覆盖 |
| `tests/picker-ai-outline.cjs` | 1 项通过；模拟 AI 草稿、保存/重开/重新加载及旧响应保护回归 |
| 既有 AI 设置专项 | 按名称筛选直接相关的 8 项均通过，覆盖单次 Key、显式保留、自动分析授权、多个服务、兼容地址和设置面板；不包含下述旧数据库夹具检查 |
| 前端语法和一键启动 | 检查通过；没有新增启动依赖 |

Python 新测试的“路由绑定”会替换模型执行器检查配置，不代表每类模型输出的真实语义质量；其余结构校验由既有模块专项覆盖。所有测试均未使用实际用户 Key、原业务数据库或真实模型。

## 扩大回归存在的失败

最终 Python 全套为 102 项、97 通过、5 失败，无跳过。5 项失败为：

1. `test_answer_draft.BrowserDraftTests.test_normal_create_edit_choice_and_draft_safety`：仍要求页面 Mock 答案入口。
2. `test_deepseek_test.BrowserTest.test_website_advice_confirmation_and_real_review_flow`：仍断言旧面板默认行为。
3. `test_local_app.LocalRoutes.test_demo_and_public_files_only`：固定要求旧脚本缓存版本号。
4. `test_resource_review.ResourceBrowser.test_resource_real_website_flow`：仍要求无需真实设置的页面 Mock 入口。
5. `test_review_feedback.FeedbackBrowser.test_feedback_in_real_review_pages`：仍要求页面 Mock 批改。

另外，运行既有 `ai-settings.cjs` 和 `ai-settings-compact.cjs` 导入的 `mistake-format.cjs` 时，总计 30 项中 22 通过、8 失败（同一组 4 个旧检查被导入两次）。失败涉及旧复习阶段断言、旧 schema 版本/迁移夹具，以及夹具的 materials 表缺少 outline 字段。本轮未修改这些业务实现或扩大数据库迁移范围，失败保留为待整理项。

因此不能宣称“全套测试通过”。这些历史测试应另行与当前页面及数据迁移合同核对，不通过恢复用户页面 Mock 入口来迎合旧断言。

## 仍由宿主环境验收

- 大组真实登录、权限、平台额度、失败释放、共享限流和日志脱敏。
- 扣子 Python 主应用挂载及部署环境能否访问所选模型服务。
- 平台 Key 和用户自带 Key 对实际模型的权限、余额、输出质量、延迟和费用。
- 业务结果在大组 PostgreSQL 中的保存、重开和跨设备恢复。

上述内容未在本轮验证。平台状态成功只表示配置就绪，不是模型调用成功。

## 复查命令

在仓库的 `ai-fastapi` 目录，用 `.local-ai-deps` 设置 PYTHONPATH 后：

```powershell
python -B -m unittest discover -s tests -p test_platform.py -v
```

仓库根目录：

```powershell
node --test tests/platform-ai.cjs tests/local-ai-gateway.cjs tests/picker-ai-outline.cjs
node tests/frontend-script-syntax.cjs
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1 -CheckOnly
```

测试新建隔离数据库、使用虚构凭据和模拟上游。不要把真实模型验证混入这些自动化命令。
