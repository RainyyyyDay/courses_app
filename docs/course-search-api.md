# 课程内统一搜索 API（后端第一阶段）

本接口只读，搜索当前课程中的资料、笔记、错题已有文本。使用现有 SQLite 表和课程索引，不新增表、索引或迁移，不改变原列表、详情、标签、收藏和复习协议。本阶段不修改前端。

## 请求

`GET /api/courses/:courseId/search`

默认服务地址：`http://localhost:3000`。

| 参数 | 默认值 | 约定 |
| --- | --- | --- |
| courseId（路径） | 必填 | 正整数且课程必须存在，沿用现有课程 ID 校验 |
| q | 空字符串 | 关键词，首尾空白忽略；最多 500 个 JavaScript 字符串长度单位，不能含 NUL 空字符 |
| types | materials,notes,mistakes | 逗号分隔的复数类型名；仅允许这三种，顺序不影响结果排序，重复类型去重，允许各类型前后有空白 |
| limit | 20 | 1–100 的整数；限制三个板块合并后的数量，而非每板块数量 |
| offset | 0 | 从零开始的偏移量；0–9007199254740991 的整数 |

不传 `types` 搜索三个板块；显式传入 `types=`、未知类型或空类型项返回 400。数字参数不接受空值、负数、小数、科学计数法或超过范围的值；超限返回 400，不自动截断。所有参数只能传一次；不支持标签、收藏、复习状态等额外参数。

关键词是一个完整的字面子串，不拆词、不模糊扩展。SQLite LIKE 对 ASCII 英文字母不区分大小写；中文正常按字面匹配，不做拼音或 Unicode 大小写扩展。`%`、`_`、反斜杠均作为普通字符，不作为通配符。SQL 使用绑定参数，类型对应的表名来自固定白名单。

前端建议用 `URLSearchParams` 编码关键词和逗号分隔的 `types`，避免手工拼接百分号、空格、`&` 等字符。

## 实际搜索字段

| types 参数 | results.type | 数据表 | 可检索字段 |
| --- | --- | --- | --- |
| materials | material | materials | title、content |
| notes | note | notes | title、content |
| mistakes | mistake | mistakes | title、content、ocr_text、answer_content、explanation |

错题的 `ocr_text` 只读取已保存内容，`answer_content` 是已有参考答案文字，`explanation` 是解析/错误原因。知识框架、标签名称、父子标签关系、考核、笔记 source、文件 URL 和附件二进制不参与搜索。不会递归扩展知识点或重新执行 OCR。

图片/PDF 若已有文字保存在上述字段中，该文字可匹配；没有提取文字的附件仍可按标题搜索，接口不会尝试解析文件。

## 成功响应

HTTP 200：

```json
{
  "query": "矩阵",
  "total": 3,
  "results": [
    {
      "type": "material",
      "id": 1,
      "courseId": 12,
      "title": "矩阵运算讲义",
      "snippet": "矩阵的基本运算"
    },
    {
      "type": "note",
      "id": 2,
      "courseId": 12,
      "title": "逆矩阵",
      "snippet": "逆矩阵的计算方法"
    },
    {
      "type": "mistake",
      "id": 3,
      "courseId": 12,
      "title": "矩阵秩的计算",
      "snippet": "使用初等行变换"
    }
  ]
}
```

以上示例对应如下完整请求（假设课程 12 有这三条匹配记录）：

```http
GET /api/courses/12/search?q=%E7%9F%A9%E9%98%B5&types=materials,notes,mistakes&limit=20&offset=0 HTTP/1.1
Host: localhost:3000
Accept: application/json
```

字段约定：

- `query`：首尾去空白后的原关键词，保留大小写。
- `total`：当前课程、关键词和类型范围的全部匹配数量，分页前计数。
- `results`：当前页数组，仅含 `type`、`id`、`courseId`、`title`、`snippet`；不返回完整正文、附件、标签或复习数据。
- `id`：所属板块的原 ID。不同板块可能出现相同 ID，前端列表 key 必须使用 `type + ':' + id`。
- `courseId`：数字，始终等于路径中的当前课程 ID。
- `title`：原标题。
- `snippet`：纯文本，最多 160 个 Unicode 字符，包含截断省略号；没有可用正文时为空字符串。

摘要优先使用含关键词的非标题文本字段；资料/笔记使用 content，错题依次考虑 content、ocr_text、answer_content、explanation。如果仅标题命中，则从该顺序中的首个非空正文取开头。命中位置较远时保留前约 40 字上下文；前后截断加 `…`。关键词超过摘要容量时可能显示不全，标题和摘要均不含额外高亮 HTML。

## 排序、去重与分页

1. 标题包含关键词的记录优先于仅正文/OCR/答案/解析匹配的记录。
2. 同一级别固定按 material → note → mistake 排序。
3. 同一板块、同一级别按 ID 升序。

同一内容不论命中多少字段、关联多少标签，仅出现一次。不同板块同 ID 的记录分别返回。顺序不依赖 `types` 参数顺序；内容未变化时翻页顺序稳定。编辑、增加或删除内容后，前端应从 offset=0 重新搜索。

例如第一条请求取第 1–2 条，第二条取第 3–4 条：

```text
GET /api/courses/12/search?q=矩阵&limit=2&offset=0
GET /api/courses/12/search?q=矩阵&limit=2&offset=2
```

当 `offset >= total` 时返回真实 total 和空 results。缺省、空字符串或仅空白的 q 返回 `{"query":"","total":0,"results":[]}`，不会返回整门课程内容。无匹配返回 `{"query":"关键词","total":0,"results":[]}`。

## 错误响应

沿用现有 API 的 code/message 格式：

```json
{"code":"INVALID_ARGUMENT","message":"types 只能包含 materials、notes、mistakes，使用逗号分隔"}
```

| HTTP | code | 条件 |
| --- | --- | --- |
| 400 | INVALID_ARGUMENT | ID、关键词、类型、分页参数非法，重复参数或额外参数 |
| 404 | COURSE_NOT_FOUND | 课程不存在，空关键词也会校验课程 |
| 500 | INTERNAL_ERROR | 查询失败，message 为“课程搜索失败，请重试” |

## 前端对接

本阶段仅新增 API，前端页面尚未接入。类型筛选发送复数 `materials/notes/mistakes`，响应类型使用单数 `material/note/mistake`。每页上限是合并后的 100 条，用 total 判断是否还有下一页。

展示 title/snippet 时按普通文本处理，例如使用 textContent。点击结果使用原有详情接口：

| type | 详情接口 |
| --- | --- |
| material | GET /api/materials/:id |
| note | GET /api/notes/:id |
| mistake | GET /api/mistakes/:id |

详情沿用现有 `course_id` 字段；附件、标签和完整正文继续从详情获取。搜索接口的 courseId 为统一展示命名，不改变原详情字段。搜索结果中的错题答案摘要属于内容查询，不替代复习接口，也不改变复习步骤或状态。

## 验证

运行 `npm test --prefix back -- --backend-only`，包括独立 SQL/数据库夹具及真实隔离 HTTP 测试，覆盖三种类型、混合类型、标题/正文/OCR/答案/解析、中文/大小写、特殊符号/SQL 注入输入、空词/无结果、排序/分页/总数、字段与摘要限制、同 ID/去重、课程隔离和参数错误。所有测试库和附件位于临时目录，检查原数据库校验值未变化。

原后端回归同时覆盖资料、笔记、错题 CRUD、标签、收藏、独立复习、版本/幂等规则、迁移和课程归属，不因搜索改变原有行为。
