# canvas-confetti（本地化的第三方库）

`confetti.browser.js` 是 [canvas-confetti](https://github.com/catdad/canvas-confetti)
的官方浏览器构建，直接放在仓库里，不依赖 CDN，断网 / `file://` 打开都能用。
MIT 许可，见同目录 `LICENSE`。

| 文件 | 来源包 | 版本 |
| --- | --- | --- |
| `confetti.browser.js` | `canvas-confetti` | 1.9.4 |

加载后全局暴露 `window.confetti`，用法：

```js
// 整屏默认画布
confetti({ particleCount: 200, spread: 100 });

// 指定画布（项目里用的是这种：画布挂在弹窗遮罩里、卡片下面，彩带不会挡住内容）
const fire = confetti.create(canvas, { resize: true, useWorker: false });
fire({ particleCount: 200, origin: { y: 0.7 } });
```

项目里只有「错题复习完成弹窗」用到它，配方是官网的 Realistic Look
（200 片分 5 组不同扩散角 / 初速度 / 衰减），见 `fronted/js/mistakeQueue.js` 的
`mistakeConfettiBurst()`；库不可用时会退回自绘的 CSS 彩带。

升级方式：`npm pack canvas-confetti`，用解包出来的 `dist/confetti.browser.js` 覆盖同名文件即可。
