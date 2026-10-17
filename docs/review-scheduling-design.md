# 备考总复习：排期引擎设计（草稿，v14）

本文只解决「什么时候复习、复习几次、每天排多少」，不涉及复习模式的内容实现，也不依赖大模型。
目标是把排期做成**纯函数 + 确定性**：同样的记忆状态和考试日期，永远得到同样的结果，可单测、可复现、可离线。

## 1. 范围与非目标

范围内：

- 每项内容（资料 / 笔记 / 错题）一份记忆状态，按评分更新；
- 给定考试日、每日容量、目标保持率，生成未来的复习出现日期与次数；
- 可行性反馈（容量不够时明确告诉用户能覆盖几轮）；
- 「模式 ↔ 调度」的接口契约，供以后加复习模式。

非目标（本阶段不做）：

- 判断内容是记忆类还是理解类（用用户选择 + 课程默认 + 历史表现当先验，未分类给中性参数）；
- 挖空、变式、辨析题的生成（由模式内部实现，可接本地大模型）；
- OCR / 文件文本抽取；
- 自动调 FSRS 权重（先用官方默认参数，积累事件后再离线拟合）。

## 2. 现有实现与差距

现有 v12/v13：

- `review_plans` + `review_plan_items`：一个任务 = 一项内容在某个日期出现一次，**没有重复**；
- `reviewPlanSchedule.schedulePlan()`：按 `type + id` 排序后**平均铺到每一天**，不读难度、标签、复习历史；
- `review_sessions` / `review_session_items`：固定范围与执行记录，可复用为「每天一次会话」；
- 内容侧只有 `review_status`（reviewed/unreviewed）和错题的步骤机，没有逐次评分。

差距：

1. 没有「间隔」和「重复次数」的概念，考试日只是排期终点；
2. 没有逐次评分，无法判断该拉长还是缩短间隔；
3. 计划任务一次性物化，改考试日 / 中途失败无法自然重排。

## 3. 数据模型（v14 草稿）

### 3.1 每项内容的记忆状态（新表）

状态属于**内容本身**，不按计划复制：同一个错题在多个计划里复习，共用一份记忆状态。

```sql
CREATE TABLE review_item_states (
  course_id      INTEGER NOT NULL,
  item_type      TEXT NOT NULL CHECK (item_type IN ('material','note','mistake')),
  item_id        INTEGER NOT NULL,
  stability      REAL NOT NULL DEFAULT 0,     -- 天，0 = 未初始化
  difficulty     REAL NOT NULL DEFAULT 0,     -- 1..10，0 = 未初始化
  reps           INTEGER NOT NULL DEFAULT 0,  -- 有效复习次数
  lapses         INTEGER NOT NULL DEFAULT 0,  -- 评为「重来」的次数
  state          TEXT NOT NULL DEFAULT 'new'
                 CHECK (state IN ('new','learning','review','relearning')),
  last_grade     INTEGER,                     -- 1=Again 2=Hard 3=Good 4=Easy
  last_review_date TEXT,                      -- YYYY-MM-DD（Asia/Shanghai）
  due_date       TEXT,                        -- YYYY-MM-DD
  elapsed_days   INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (course_id, item_type, item_id)
);
CREATE INDEX idx_review_item_states_due ON review_item_states(course_id, due_date);
```

多态引用不做外键；删除来源时用触发器清理对应行（沿用 v13 的触发器写法）。

### 3.2 评分事件（新表，建议保留）

用于审计、后续离线拟合权重、以及「为什么排到今天」的解释。

```sql
CREATE TABLE review_item_events (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL,
  item_type TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL,        -- ISO 时间
  review_date TEXT NOT NULL,        -- YYYY-MM-DD，排期用的日历日
  grade INTEGER NOT NULL,           -- 1..4
  duration_ms INTEGER NOT NULL DEFAULT 0,
  session_id INTEGER,               -- 可空，来自哪次会话
  session_item_id INTEGER,
  stability_before REAL, stability_after REAL,
  difficulty_before REAL, difficulty_after REAL,
  due_before TEXT, due_after TEXT
);
CREATE INDEX idx_review_item_events_item ON review_item_events(course_id,item_type,item_id,reviewed_at);
```

### 3.3 计划与任务的扩展

```sql
ALTER TABLE review_plans ADD COLUMN target_retention REAL NOT NULL DEFAULT 0.90; -- 0.80..0.95
ALTER TABLE review_plans ADD COLUMN daily_minutes    INTEGER NOT NULL DEFAULT 60;
ALTER TABLE review_plans ADD COLUMN daily_max_items  INTEGER NOT NULL DEFAULT 60;
ALTER TABLE review_plans ADD COLUMN strategy         TEXT NOT NULL DEFAULT 'balanced';
-- strategy: memory | reasoning | balanced，只作为参数先验，单题可在编辑时覆盖

ALTER TABLE review_plan_items ADD COLUMN estimated_minutes INTEGER NOT NULL DEFAULT 5;
ALTER TABLE review_plan_items ADD COLUMN round_no INTEGER NOT NULL DEFAULT 1; -- 第几次出现
ALTER TABLE review_plan_items ADD COLUMN mode_hint TEXT;                      -- 预留，调度不使用
```

**任务物化策略**：保留「一条任务 = 一次出现」的现有语义（v13 的会话/计划关联都不用改），
但**滚动生成**——只物化未来 7~14 天；评分改变了到期日时，删除未开始的未来 pending 任务并重新生成，已开始的保持不变。

## 4. 纯函数接口（已实现于 `back/db/reviewScheduling.js`）

全部无副作用、无 IO、无 `Date.now()`（调用方传入 `today` 与 `nowIso`）。

```js
// 4.1 记忆状态更新
applyGrade(state, grade, reviewDate) -> {
  stability, difficulty, reps, lapses, state,
  last_grade, last_review_date, due_date, elapsed_days, scheduled_days
}

// 4.2 可提取性 / 间隔
retrievability(stability, elapsedDays) -> number            // 0.9^(elapsed/stability)
intervalFor(stability, targetRetention) -> days             // round(stability*ln(r)/ln(0.9))

// 4.3 读取先验（不是分类器）
profileFor({ strategy, itemType, mistakeType, tags, history }) -> {
  targetRetention, minInterval, maxInterval, repsTarget,
  estimatedMinutes, interleave, examImportance
}

// 4.4 生成某个计划的出现序列（不落库）
planOccurrences({ items, states, today, examDate, capacity, profile }) -> {
  occurrences: [{ itemType, itemId, date, roundNo, reason }],
  feasibility: { feasible, shortfallMinutes, coverage, warnings }
}

// 4.5 一天内的排序（分块 → 交错）
orderDay(items, { roundNo, groupKey, priority }) -> sorted

// 4.6 模式回传（以后接模式时用）
recordReview({ itemType, itemId, modeId, grade, durationMs, reviewedAt })
```

**已实现的记忆模型**（FSRS 的 stability 语义，公式做了可解释的简化）：

- `S` = 保持率降到 90% 所需天数，`R(t) = 0.9^(t/S)`；
- 首次评分后的 S：`[0.8, 1.5, 3, 6]` 天（Again / Hard / Good / Easy）；
- 后续 S 的倍率：Again `0.32`、Hard `1.15`、Good `1.9`、Easy `2.5`（随 difficulty 微调）；
- difficulty 每次按档位增减并轻微回归 5，clamp 到 `[1, 10]`；S clamp 到 `[0.5, maxInterval]`；
- 间隔 `= round(S * ln(targetRetention) / ln(0.9))`，clamp 到 `[1, maxInterval]`。

字段与 FSRS 兼容（stability / difficulty / reps / lapses），以后要换成 FSRS-5/6 官方权重，
只需替换 `applyGrade` / `retrievability` 两个函数，数据表不用动。

`targetRetention` 默认 0.90（memory 0.92 / reasoning 0.88）。

## 5. 从考试日往回排（核心算法）

输入：`today`、`examDate`（不含考试当天）、每项状态的 `due_date`、`daily_minutes`、`daily_max_items`。

```text
H = examDate - today                    // 可用天数
lastDay = examDate - 1                  // 最后一次复习最晚日期
finalWindowStart = max(today, examDate - max(2, round(H*0.15)))

1) 对每项算「自然到期」
   due = state.due_date ?? today
   若 due > lastDay：due = lastDay          // 反向拉回，不能晚于考试前一天
   若 due < today：due = today              // 逾期项立刻进入今日

2) 估算还需要几次（不追求无限重复）
   repsTarget = clamp(ceil(H / 14), 1, profile.repsTarget)
   repsTarget += min(2, state.lapses)       // 遗忘过的题多给 1~2 次
   若 已排次数 >= repsTarget 且 最后出现日 >= finalWindowStart：不再追加

3) 追加「考前收尾」一次
   条件：已有出现日 < finalWindowStart，且容量允许
   日期：优先 lastDay，其次 lastDay-1；只给
         last_grade < 3（Again/Hard）或 examImportance 高的题，
         其余题允许在 finalWindowStart 之前结束

4) 按天装箱（贪心，确定性）
   每天按优先级排序：
     逾期天数 desc → 最近一次 grade 升序（Again 最前）→
     examImportance desc → difficulty desc → item_type → item_id
   依次放入，直到 Σ estimated_minutes > daily_minutes 或条数 > daily_max_items；
   放不下的顺延到下一天；顺延到 lastDay 仍放不下 → 记入 shortfall

5) 同一天内的顺序
   roundNo == 1：按标签/题型分块（blocked），保证同一知识块连续出现；
   roundNo >= 2：按 groupKey 轮转（interleaved），相邻尽量不同组；
   同组内仍按第 4 步的优先级。
```

确定性要求：所有排序都必须有最终 tie-break（`item_type, item_id`），排序不依赖对象插入顺序或随机数。

可行性输出示例：

```json
{
  "feasible": false,
  "shortfallMinutes": 240,
  "coverage": { "memory": 2.1, "reasoning": 1.4 },
  "warnings": [
    "按每天 60 分钟，记忆类平均只能复习 2.1 轮（建议 3 轮）",
    "有 12 项无法在考前完成最后一次复习"
  ]
}
```

## 6. 评分怎么来（与现有流程对接）

统一成 4 档，模式只负责产出档位；旧的二元状态做映射，不重建步骤机：

| 现有结果 | 映射 |
| --- | --- |
| 错题 judge correct=true 且 recall=clear | 3 Good（连续多次可 4 Easy） |
| 错题 judge correct=true 且 recall=vague | 2 Hard |
| 错题 judge correct=false 或 recall=forgotten | 1 Again |
| 资料/笔记 reviewed（暂无分档） | 3 Good |
| 资料/笔记 unreviewed | 1 Again |

以后模式接入时可以自带更细的评分界面；调度只认 `grade`。

## 7. 与复习模式的接口（本阶段只定义契约）

```js
// 模式目录由人工设计；每个模式声明它需要的调度参数与产出
Mode = {
  id, name, description,
  appliesTo: (profile) => boolean,     // 例如 memory 型才给「挖空」
  requiredArtifacts: ['cloze'|'variant'|'contrast'], // 可空 = 不需要大模型
  run(item, context) -> { grade, durationMs }        // 不碰日期
}
```

大模型只在 `requiredArtifacts` 里出现：创建计划时后台批量生成并缓存，复习时只读；
生成失败自动降级到该模式的非 AI 版本（例如「看题→自答→对答案」）。排期不依赖任何模式实现。

## 8. API（v14 已实现）

| 方法 | 路径 | 状态 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/courses/:id/review-plans/:planId/schedule` | 已实现 | 按记忆状态生成「今天到考前」的日期 × 任务，只读不落库，含 `feasibility` |
| POST | `/api/courses/:id/review-items/:type/:id/grade` | 已实现 | `{ grade, durationMs?, sessionItemId?, reviewDate? }`；`sessionItemId` 唯一，重复提交幂等 |
| GET | `/api/courses/:id/review-items/:type/:id/state` | 已实现 | 当前 S / D / reps / lapses / dueDate / retention |
| POST | `/api/courses/:id/review-plans` | 待接入 | 计划表已有 `target_retention` 等列（默认值），创建接口尚未开放这些参数 |

会话（v13 `review-sessions`）保持不变：每天启动一次会话，完成时按 session item 记录评分并更新状态。

## 9. 测试计划

纯函数单测（不需要数据库）：

- 同一输入重复调用结果完全一致；打乱输入顺序结果一致（排序确定性）；
- grade 越高间隔越长；Again 后间隔缩短且 lapses+1；
- 所有出现日都 `< examDate`；考试日不排；
- 容量：每天 Σ 分钟 ≤ 上限、条数 ≤ 上限；放不下时 `shortfall` 非 0 且不丢项；
- 首轮分块、后续交错；同组内优先级保持；
- 跨年/闰年/3660 天上限。

数据库与迁移：

- v13 → v14 事务迁移：旧数据保留、重复启动幂等、失败回滚版本号；
- 删除来源清理状态；删除课程级联；
- 评分接口重复提交（同一 `sessionItemId`）只更新一次。

集成：

- 建计划 → 可行性 → 第一天会话 → 评分 → 到期日变化 → 滚动生成未来任务；
- 暂停/恢复不重复评分，不丢失已生成任务。

## 10. 待你拍板的默认值

1. 评分是否采用 4 档（Again/Hard/Good/Easy），旧流程按第 6 节映射？
2. 每日容量按「分钟」为主、条数为辅？
3. 每项内容的「记忆型/理解型」由用户在建计划时选，课程级有默认值，未分类走中性参数？
4. 重复次数上限：记忆型 5 次、理解型 3 次？
5. 考前最后几天只收尾「答错/困难/高重要度」的题，其余允许提前结束？

以上确认后，实施顺序建议：纯函数 + 单测 → v14 迁移 → 评分接口 → 滚动生成 → 前端排期可视化 →（之后）模式与本地模型。
