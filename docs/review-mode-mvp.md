# 复习模式 MVP（v17）

本版先把“模式”从内容属性里拆出来：题型、错因、内容性质只负责选模式；模式负责“让用户做什么”和“怎么产出 grade”。

## 已落地

| mode id | 名称 | 适用 | 判分 | AI |
| --- | --- | --- | --- | --- |
| `choice_reproduction` | 选择复现 | 有结构化选项和正确选项的错题 | 首次选择客观判分：对 = Good，错 = Again | 不依赖 |
| `standard` | 标准复习 | 其余错题，沿用原步骤机 | 回忆/重做后自评，映射 Again/Hard/Good | 可选 |

选择题错题会自动解析为 `choice_reproduction`；用户可以通过
`PUT /api/courses/:courseId/mistakes/:mistakeId/mode` 显式改回 `standard`。
换模式只重置“本轮步骤”，`review_item_states` 里的记忆状态保留。

### 数据字段

错题新增：

- `question_format`: `open` / `choice`
- `options_json`: `[{id,text}]`
- `correct_option`
- `choice_type`: 第一版只支持 `single`

复习进度新增 `selected_option`、`choice_correct`；评分事件新增 `mode_id`；
独立表 `review_item_modes` 记录用户/规则/AI 选择的模式。

### 答案隔离

- 列表接口不返回 `correct_option`，只返回 `choice_ready`。
- 选择题在提交前不下发 `correctOption`；提交后才返回正确答案。
- 挖空接口返回 `attemptId + 空位 id + hint`，答案留在本地后端。

## 本地 AI 门面

浏览器只访问本地后端，云端地址和密钥留在服务端：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/ai/health` | 当前 provider |
| POST | `/api/ai/cloze` | 生成挖空，答案不下发 |
| POST | `/api/ai/cloze/evaluate` | 提交空位答案并判分 |
| POST | `/api/ai/evaluate-answer` | 开放作答语义评价 |
| POST | `/api/ai/recommend-mode` | 模式建议，人工确认后采用 |

默认 `AI_PROVIDER=mock`，不需要云端即可开发 UI。接队友服务时设置：

```text
AI_PROVIDER=http
AI_API_BASE=<队友的 HTTPS staging 根地址，不含 /api/ai>
AI_SERVICE_TOKEN=<服务间令牌，可选>
```

`back/ai/service.js` 目前把挖空答案放在进程内 Map（1 小时 TTL）。
正式版应落到 `review_artifacts` 或本地数据库，避免重启丢答案；这一步在挖空 UI 接入前完成。

## 下一步

1. 长资料/笔记分块 + 阅读视图；
2. 挖空产物缓存与编辑界面；
3. 文本选择 → 设为挖空；
4. 自述讲解 + `evaluate-answer`；
5. OCR / PDF 坐标标注后置。
