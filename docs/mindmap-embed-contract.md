# 思维导图嵌入接口（给导图作者）

## 背景

课程网站要在「资料详情页」里显示一张由大纲生成的导图，用的是你们这套画布。

我们**不跑你们的 server.js**，而是把静态文件挂到我们后端下（`/mindmap/`），用 iframe 嵌入：

```html
<iframe src="/mindmap/embed.html?embed=1"></iframe>
```

`embed.html` 已经做好了：隐藏顶栏/侧栏、监听 `postMessage`。
缺的是**收到数据后要走哪条内部流程**——这部分只有你们最清楚。

## 需要暴露的接口

```js
// 在 vendor/mindmap.js 执行完之后挂上
window.MMEmbed = {
  /**
   * 用外部数据替换当前画布并渲染。
   * @param {object} map 导图数据（见下）
   * @returns {Promise<void>} 渲染完成后 resolve，失败则 reject
   */
  async load(map) {
    // 1. 校验：map.id / map.nodes 必须存在
    // 2. 注册到你们需要的本地索引（localStorage 或内存均可）
    // 3. 打开并绘制（例如 openMap(map.id) 或 replaceDocument(map) + draw()）
    // 4. 等画布尺寸稳定后 fit / zoom 到合适比例
  },
};
```

只要这个函数能用，我们这边就不用碰你们的内部实现。

### 放在哪里

必须放在 `vendor/mindmap.js` 之后执行，否则 `openMap` / `draw` 还没定义。
建议新建 `js/embed-api.js`，在 `index.html` 里排在下面两行之后：

```html
<script src="vendor/mindmap.js"></script>
<script src="js/standalone.js"></script>
<script src="js/embed-api.js"></script>
```

### 可直接填的骨架

```js
window.MMEmbed = {
  async load(map) {
    if (!map || !map.id || !Array.isArray(map.nodes)) throw new Error('无效的导图数据');

    // 1) 让 openMap 能找到它（写索引 / 写 localStorage，取决于你们的实现）
    // 2) 打开这张图，例如：
    //    await openMap(map.id);
    //    或者 window.Mindmap.openDocument(map);

    // 3) 等两帧，让 iframe 里的布局稳定
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    // 4) 让画布按 iframe 尺寸重新算一次，否则高度还是按整页算的
    window.dispatchEvent(new Event('resize'));
  },
};
```

第 3、4 步最容易漏：只调用打开函数不触发 resize，画布在 iframe 里会显示不全。

## 数据格式

就是你们自己的 map.json，最简形态：

```json
{
  "id": "material-12",
  "title": "第一章 函数",
  "nodes": [
    {
      "id": "n1",
      "text": "第一章 函数",
      "children": [
        { "id": "n2", "text": "1.1 极限", "children": [] },
        { "id": "n3", "text": "1.2 连续", "children": [] }
      ]
    }
  ],
  "pos": {},
  "size": {},
  "edges": [],
  "v": 3
}
```

`pos` / `size` 可以留空，交给你们的自动布局。

## 我们这边的调用时序

1. iframe 加载完成 → 页面 post 出 `{ type: 'mm-ready' }`
2. 我们收到后 post `{ type: 'mm:load', map }`
3. 你们调用 `MMEmbed.load(map)`
4. 成功后 iframe 回 `{ type: 'mm:loaded' }`；失败回 `{ type: 'mm:error', message }`

`embed.js` 已经写好这套收发，只需要它内部改成调用 `MMEmbed.load`。

## 只读要求

详情页里只是查看，不希望用户误改：

- 不自动保存、不写草稿
- 可以保留缩放、拖动、点选
- 双击编辑可以禁用，也可以允许但不落盘（二选一，告诉我哪种）

补充说明：我们生成的导图**只包含文本节点**，没有图片 / PDF 节点，所以加载路径不应该依赖 `/api/maps` 或媒体接口。如果 `openMap` 一进去就请求这些，需要加一个"静态数据直接渲染、跳过文件接口"的分支。

## 验收标准

在 `/mindmap/embed.html?embed=1` 里注入上面那份 3 节点的数据：

- 3 个节点都可见
- 连线正确
- 顶栏、侧栏、横幅不显示
- 控制台无报错

## 如果更省事

也可以不写 `MMEmbed`，直接告诉我**正确的调用顺序**（例如“先 `Mindmap.openDocument(map)`，再等 `mm:open` 事件后调 `Mindmap.zoom(0.8)`”），我照着实现。
