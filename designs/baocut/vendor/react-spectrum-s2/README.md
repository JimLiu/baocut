# react-spectrum S2（随原型分发的打包件）

`@react-spectrum/s2` **1.7.1**，Adobe 出品，**Apache-2.0**（许可证原文见同目录 [`LICENSE`](LICENSE)，取自该包）。打包件里还带着它的依赖：`react-aria` 3.52.1、`react-aria-components` 1.21.1、`react-stately` 3.50.0、`@internationalized/*`、`@swc/helpers`（均为 Apache-2.0），以及 `react-aria` 引入的 `clsx`、`aria-hidden`、`use-sync-external-store`（MIT）。

AI 组件来自 `@react-spectrum/ai` **0.4.0**（Apache-2.0），与 S2 共用 Provider 和依赖，通过 `RSP.AI` 使用。PromptField 管理文本与引用 token；输入禁用、附件校验和提交条件由宿主适配。

三个入口（`BaoCut.html`、`BaoCutWeb.html`、`Components.html`）都加载。基础控件由 S2 实现，`app/ui.jsx` 与 `app/ui-spectrum.jsx` 适配旧屏幕的调用接口。Web 的产品能力仍由 `BC_SURFACE` 限制。

| 文件 | 是什么 |
| --- | --- |
| `react-spectrum-s2.js` | esbuild 打出的 IIFE，挂 `window.RSP`。React 与 ReactDOM 取页面上的 `window.React` / `window.ReactDOM`，所以必须在 React 19 生产包之后、应用包之前加载 |
| `react-spectrum-s2.css` | 本原型使用的 S2 样式，规则都在 `@layer _.*` 里。本目录的无层 CSS 天然压过它，不需要 `!important` |
| `react-spectrum-s2-font.css` | **生成物，勿手改**。把 S2 的字体类（按 class 哈希）指向原型的 `--sans`（Source Sans 3 打头）。无层，所以压过 S2 |
| `build/entry.js` | 入口：按实际使用组件做子路径导出，外加 `RSP.Icons` 用到的 S2 图标（逐个 import，没有的图标要在这里加） |
| `build/build.mjs` | 打包脚本 |
| `build/font-override.mjs` | 由 `react-spectrum-s2.css` 生成字体覆盖；`build.mjs` 每次打包都会调用 |

## 用法要点

- 运行期没有 `style()` 宏。定制走 `UNSAFE_className` / `UNSAFE_style` 加本目录的 CSS 类和 token。
- `RSP.UNSAFE_PortalProvider` 来自 React Aria，用于把全屏播放器的 S2 菜单与音量弹层挂到全屏容器内。
- 图标是 `RSP.Icons.X`。图标颜色随文字：`--iconPrimary: currentColor; fill: currentColor`。
- 像素加载图形是 `RSP.AI.PixelLoader`，图形在 `RSP.AI.loader`（`@react-spectrum/ai/loader` 的全部导出）。原型只用 `app/model-agent-loader.js` 列出的图案类图形；字母类图形与含字母的预设拼的是第三方字标，不用。`RSP.AI.Alert` 也已导出。
- 每个入口根上只有一个 `RSP.Provider`（`main.jsx`、`web-main.jsx` 或 `components-page.jsx`）：`locale="zh-CN"`，配色跟随外观偏好，`router.navigate` 把 S2 链接交给共享 URL 路由。
- `CardView` 与 `TableView` 是虚拟化的，父元素要有确定的高度（flex 1 + `min-height: 0`）。
- `Dialog` 会把 children 在标题区、正文区、底栏各渲染一遍，状态要放在 Dialog 外面。`isDismissible` 的对话框会藏掉 `ButtonGroup`。

## 重新打包

默认使用 `designs/baocut/node_modules`（`npm ci` 后执行 `npm run build:spectrum`）。也可用 `NODE_MODULES` 指向另一份装了 `@react-spectrum/s2@1.7.1` 和 `esbuild` 的依赖：

```bash
# 例：临时装一份
mkdir -p /tmp/rsp && cd /tmp/rsp && npm init -y >/dev/null && npm i @react-spectrum/s2@1.7.1 esbuild
# 打包：默认写回本目录（build/ 的上一层），--out 可改到别处先比对
NODE_MODULES=/tmp/rsp/node_modules node designs/baocut/vendor/react-spectrum-s2/build/build.mjs
NODE_MODULES=/tmp/rsp/node_modules node designs/baocut/vendor/react-spectrum-s2/build/build.mjs --out /tmp/rsp/out
```

打包时做的事：

- `react` / `react-dom` / `react/jsx-runtime` 换成读 `window.React` / `window.ReactDOM` 的垫片。
- 语言包只留 `zh-CN` 与 `en-US`。
- 不加载远端字体（`font-faces.css` 与 `Fonts` 组件置空）。
- 给 `Tabs` 的溢出检查补一个空值保护（补丁点找不到时构建直接失败）。
- 打完重新生成 `react-spectrum-s2-font.css`。S2 的 class 哈希每次打包都可能变，所以这份不能留旧的。

升级版本时：改 `build.mjs` 里的横幅版本号和本文的版本，重新打包，跑一遍两份入口的预览与 `node --test`，再运行原型构建，三个入口自动使用新内容哈希。
