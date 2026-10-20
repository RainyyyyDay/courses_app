# 第二轮：统一 AI 设置与可选自动分析

2026-10-21。正常网站右下角“AI 设置”。不是账户/永久 Key 管理，也不接管主后端部署。

## 当前行为与手动验证

1. 按原 `start-local.ps1` 启动，浏览器 Ctrl+F5，右下角打开“AI 设置”。若已有 3002 进程仍未更新此前新增的 Python 路由，先正常重启服务。
2. 选 DeepSeek 官方，填 Key，勾选发送/费用确认后“应用设置”。默认只供下一次共享请求；勾选标签页内保留才可多次使用。应用后输入框清空、不回显保留值。配置不发模型请求，可手动“测试已应用的连接”（固定虚构题目，也可能计费）。
3. 错题列表/详情建议、新增错题建议、新增/编辑答案解析草稿默认使用共享设置；可手动改回 Mock 或独立一次性 Key。已有打开的面板也切到共享设置，不再 UI 切了而实际读旧 Key。改变配置取消旧请求，但不清空手工题目/答案。
4. 真实调用失败或 Key 被清除时提示，不自动回退 Mock。工作台的复习材料生成仍是独立固定 Mock 演示；独立 `/ai-test` 仍是单独临时工具，不宣称所有 AI 功能已接真实模型。
5. 新开/刷新默认未配置、自动调用关闭。Key 不写 localStorage/sessionStorage/数据库/环境变量；清除、页面离开、身份变更取消请求/丢弃晚到结果。刷新关闭失效。内存保留不等于抗 XSS/浏览器插件或安全擦除，服务端必然接触 Key，宿主需日志脱敏。

## 保存后单次自动分析（默认关闭）

- 开启需 DeepSeek、标签页内保留 Key、单独的自动发送/费用同意。
- 新增表单填写题干，在“AI 复习建议（可选）”中填写学生实际作答；错因/过程可选。缺题干/作答只提示，不猜数据、不读取附件、不把参考答案当学生作答。
- `confirmTagPicker` 保存前捕获输入和配置版本；只有创建接口成功才调用 `afterCreated`。失败不调用，重试已创建错题的本地建议不重复创建/分析；保存途中设置或身份变化使旧捕获失效。
- 标签页内按课程/错题 ID 去重，失败不自动重试。共享请求每标签页最多20次，内存自动草稿最多10条。这只是防误触，不是可信服务器账户配额。
- 右下角显示草稿数量，用户主动查看才复用原建议面板，不自动打断输入。已有手选/确认模式优先显示；重新选择、确认才按原规则保存模式 ID，不自动采用。
- 不写分类、正式材料、答案、评分、进度、会话或计划。草稿可删除，刷新不恢复；清除 Key 和自动草稿不删除手工字段。查看前需回到所属课程并关闭编辑/退出作答，避免打断或泄露答案。

## 预留登录系统接点

```js
coursesAiSettings.open();             // 未来账户页复用入口
coursesAiSettings.status();           // 来源/模型/状态，不含 Key
coursesAiSettings.identityChanged();  // 宿主确认登录/退出/切换账户时先调用
// 或 dispatchEvent(new Event('courses-ai-identity-changed'))
```

身份钩子清除 Key、自动许可/草稿、取消请求，但它不是登录验证，不接收浏览器可伪造的 userId。Python 仍提供 `register(app, dependencies=[Depends(宿主权限依赖)])`，缺依赖拒绝。主组需用已验证的会话检查权限/额度并提供 HTTPS 同源路由和日志脱敏；不能相信浏览器的 ID、费用勾选或本地次数限制。尚无伪登录、永久密钥库或 PostgreSQL 接口，本轮未新增数据库字段、云函数或评分引擎。

## 验证

新增 `tests/ai-settings.cjs`：默认/一次性/保留、身份变化/离开清除、去重/缺数据/失败不重试；Chrome 1280×960、390×844 正常网页及临时业务库，覆盖连接、详情分析、编辑答案草稿、保存后单次分析、原模式保留、原面板查看、清除取消晚到响应、无 Key 不回退、敏感值不入浏览器存储。模型响应为测试替身，不是真实 DeepSeek。原进度/评分/会话/计划快照不变。

```powershell
node --test --test-name-pattern="shared AI" tests/ai-settings.cjs
node --test tests/start-local.cjs tests/review-sprint.cjs tests/review-mode-rules.cjs tests/mistake-ai.cjs tests/ai-proxy.cjs
# 在 ai-fastapi 目录，用已有本地依赖：
$env:PYTHONPATH='D:\GitCourcesWeb\courses_app\.local-ai-deps'
python -B -m unittest discover -s tests -v
```

本轮新增3项、Node回归40项、Python59项通过，无跳过；查看了桌面/手机截图。JavaScript语法及git diff --check另检查。未调用真实模型、读取.env/原数据库、安装依赖或提交Git。真实账户额度、网络及模型准确性/费用仍待用户手动验收，假上游成功不等于真实模型正确。
