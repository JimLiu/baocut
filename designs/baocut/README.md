# BaoCut 高保真可交互原型

BaoCut 的浏览器高保真原型：**一个能真的点、能路由、能拖的应用**，不是若干张静态画板。规范在 [`docs/`](../../docs/README.md)，界面以 [产品设计](../../docs/product/product-design.md) §2–§5 为准，本目录是它的可运行对照面。

本目录从 `baocut-app` 仓库的 `designs/baocut/` 原样复制而来（2026-10-01），在它上面改成新的信息架构。原仓库的逆向研究（`research/`）、原型沿革、分歧台账与变更日志没有带过来，需要时回原仓库查。

## 信息架构（2026-10-01）

三个词不混用（[术语表](../../docs/glossary.md)）：**项目**是一个目录，也是智能体的工作目录；**视频**是项目下的一个子目录，单个可编辑、可导出的视频；**成片**是导出的文件。会话挂在一个项目下，也可以不属于任何项目。

| 区域 | 内容 | 规格 |
| --- | --- | --- |
| App rail | 最左一条 56px、只有图标的栏（名字在 tooltip 里）。顶部一级入口依次为 Home、Space、工具；分隔线后二级入口依次为服务（出错时带角标）、后台任务（带运行数量）；设置固定在底部，中间留白。Space 入口统一使用 S2 Asset 图标。选中是图标左侧一根短指示竖条、图标变深，没有底色块。编辑器里也在 | §2.1 |
| Home | 侧栏：新建会话 / 搜索 / 通知，然后是置顶、项目（目录，展开是会话，按最近活动排；段头的加号菜单新建或打开项目）、最近（不属于项目的会话）。会话行两行：标题 / 状态或多久前。侧栏可拖宽并记住宽度（默认 240、最窄 200，Space 同）。主区是会话；没选会话时是开始页 | §3 |
| Space | 所有项目里视频、素材与产物的派生视图（不是第二份存储）。分类侧栏、搜索、项目 / 状态筛选、排序、网格与列表、查看框、新建与导入 | §4 |
| 编辑器 | 从 Home（会话头的视频条、线程里的卡片）或从 Space 打开视频，两边同一套编辑器组件。从 Home 进来会话在左侧，从 Space 进来是右下角的悬浮会话（默认展开成输入框，可最小化）；此外只有 rail 的高亮和「关闭视频」回到哪里不同。rail 第三格是「AI 工具」Tab（列表页 + 工具页；第一批只列从文稿出发的整理文稿 / 写作 / 发布三组），会话的 `/` 与各面板的带范围入口都通到它，缺省交给 Agent、新开会话；Web 入口没有这个 Tab | §3.3、§4.5、§5.1、§5.10 |

图标画布按产品设计 §2.1：应用 Rail 与页面主要操作 20px，页面侧栏、紧凑列表与辅助操作 16px；新建会话使用 AddCircle，Space 入口使用 Asset。

帮助在设置里。工具、服务、后台任务各有页面侧栏；模型配置并入设置内部导航。入口归属与层级遵循产品设计 §2.1。

外壳照 Spectrum 2 app frame 分层：标题栏与 rail 同在 base 底色上，下面与右边都不画线；页面侧栏、会话抽屉、内容区是同一张白色 sheet，没有边框，只有紧挨 rail 的那一块带 16px 左上圆角（Web 没有 rail，sheet 贴窗口左缘，不要圆角）。sheet 里每条边界只画一根 2px 的 divider：侧栏与内容区之间、会话抽屉与编辑器之间各由那里的拖宽缝画，横向的分隔（会话头、Space 过滤栏下方）同样 2px。

## 页面入口

| 入口 | 范围 |
| --- | --- |
| `BaoCut.html` | 桌面应用：App rail、Home、Space、编辑器，以及任务、设置、工具、服务各页 |
| `index.html` | 桌面应用的根入口，与 `BaoCut.html` 共用模板；没有 hash 时进入 Home |
| `BaoCutWeb.html` | 从原原型带过来的 Web 入口：只有视频列表（侧栏默认收起）、编辑器 Tab 和导出，没有任何 AI 入口，也没有 App rail；基础控件与 App 共用 React Spectrum S2。新的产品设计没有为它写规格（§1.4 只列桌面应用、CLI 与外部智能体），这里保持原行为不动 |

两份入口加载同一批 `app/` 模块，差异只写在 [`app/model-surface.js`](app/model-surface.js)（`window.BC_SURFACE`）。App rail、Home 侧栏、Space 这些只属于 App 的行为由能力位 `BC_SURFACE.appRail` 控制，对应的模块登记在 `app/model-surface.test.js` 的 `WEB_DENY`，Web 入口不加载。

在仓库根目录安装原型依赖并启动 Vite dev server：

```bash
npm --prefix designs/baocut ci
npm run dev:designs
open http://127.0.0.1:4331/
open http://127.0.0.1:4331/BaoCutWeb.html
```

根地址直接显示 App，起始 URL 是 `http://127.0.0.1:4331/#/home`。控件样本页为 `/Components.html`；原有 `/baocut/…` 页面及资源 URL 保留兼容。服务根目录为 `designs/baocut/`。

停止与重启见 [局部协议「HTTP 预览」](AGENTS.md#http-预览)。也可使用 `.claude/launch.json` 里的 `designs` 服务，两种方式不要同时占用端口 4331。

Vite 启动时运行现有 esbuild 构建，源码、模板与资源变动后自动重建并刷新页面；无需另外启动 `watch`。React 19 生产版与 S2 都在本地加载，全局模块继续使用整页刷新，没有浏览器内 Babel 编译或 React Fast Refresh。界面字体在首屏后加载，字幕字体仅在进入编辑器后加载。

### 开发与构建

```bash
cd designs/baocut
npm ci
npm run dev            # Vite 开发服务，自动构建与刷新
npm run build          # 编译 JSX、合并 CSS、生成内容哈希
npm run watch          # 仅需独立静态构建监听时使用，手动刷新
npm run build:spectrum # 修改 S2 组件导出或升级 S2 后使用
npm test
```

`build/entries/app.html`、`web.html`、`components.html` 是源文件清单与页面模板。修改 `app/` 或模板后重建，提交生成的 `index.html`、`BaoCut.html`、`BaoCutWeb.html`、`Components.html` 和 `generated/`。`app/model-home-templates-data.js` 也是生成物：Home 模板库的内置模板由 `build/home-templates.mjs` 从仓库顶层 `templates/` 读出生成，不要手改。`node build/build.mjs --check` 检查源码与生成物是否一致。Web 构建继续排除 App 专属页面和 AI 入口。

原型测试按当前目录边界取证：帮助目录、字幕样式、识别语言和 OmniVoice 词表对拍现有共享实现；素材字节与许可对拍本目录的 `provenance.json`；图标校验 S2 语义及仍共用的几何。完整色板、Shorts 演示与 API 试用表单保留原型自身的回归检查，不再引用已移除的 v2 Rust UI、图标生成器或后端夹具；当前应用与模型 API 的行为分别由 `packages/ui` 与 `packages/runtime-core` 的测试覆盖。

### URL 路由

路由使用 hash，普通静态服务无需配置回退。页面按钮、S2 链接、浏览器前进后退和快捷键共用同一份历史。

| 页面 | URL 后缀示例 |
| --- | --- |
| Home / 会话 | `#/home`、`#/agent/s2` |
| Space 与筛选 | `#/space?cat=movies&dir=d1` |
| 视频与面板 / 播放位置 | `#/movie/p1?via=space&tab=subtitle&t=20` |
| 任务详情 | `#/task/j1` |
| 设置子页 | `#/settings?sec=local&tab=asr` |
| 工具 / 服务 | `#/tools/tts`、`#/services/mcp` |

显式 URL 优先于本地记录。没有 hash 时恢复上次页面；复制链接到新标签不会带入旧标签的后退历史。未知或格式错误的路径回到 Home，已移除视频沿用现有空态。设置分节和编辑器面板使用 replace，不堆积历史；视频播放不会逐帧写 URL。Web 保留自己的功能限制与存储键。

### 性能测量

URL 的 hash 前加 `?perf=1` 可启用本地测量；首屏出现后，`document.documentElement.dataset.bootMetrics` 记录从导航开始到根内容渲染后两帧的耗时、首屏前长任务和脚本节点数。没有网络遥测。测量不包含远程媒体和字幕字体加载完成时间。

### Spectrum 参考

采用 Adobe 官方 [`react-spectrum-s2` skill](https://react-spectrum.adobe.com/.well-known/skills/react-spectrum-s2/SKILL.md) 的组件优先、子路径导入、单一 Provider、标签 / 插槽与运行期检查原则。入口保留现有全局模块 API，S2 通过 `vendor/react-spectrum-s2/build/entry.js` 按需导出。旧屏幕适配层仍使用 token CSS 与部分 `UNSAFE_*` 布局接口，尚未整体迁移到 style macro。

[Adobe skills 的 UI scaffolder](https://github.com/adobe/skills/blob/main/plugins/app-builder/skills/appbuilder-ui-scaffolder/SKILL.md) 提供通用质量清单；其 ExC Shell、IMS 和 v3 API 示例不适用于本地 S2 原型。

## 文档

| 文档 | 内容 |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | 局部协议：设计系统硬约束、控件层、模块纪律、验证（写代码前必读） |
| [`docs/README.md`](../../docs/README.md) | 规范目录与阅读路线 |
| [产品设计](../../docs/product/product-design.md) | 界面（§2 总览、§3 Home、§4 Space、§5 编辑器）、任务与对话、权限、工作流 |
| [系统架构设计](../../docs/architecture/architecture-design.md) | 客户端架构见 §11 |
| [视频格式规范](../../docs/spec/movie-format-spec.md)、[代码包规范](../../docs/spec/code-bundle-spec.md)、[命令与协议规范](../../docs/spec/command-protocol-spec.md) | 视频、代码包与命令的合同 |
| [验收与测试](../../docs/acceptance/acceptance-spec.md) | 测试策略与验收矩阵 |
| [术语表](../../docs/glossary.md) | 同一概念只用一个词 |

## 源码目录

- [`_ds/adobe-spectrum-2/`](_ds/adobe-spectrum-2/readme.md)：**绑定的设计系统**。token 数据来自 `@adobe/spectrum-tokens@14.15.0`，控件几何 / 圆角阶梯 / 字号角色 / 焦点环 / 动效读自 `@react-spectrum/s2@1.6.0` 源码（原件在 `_import/`）。`_import/generate-tokens.mjs` 是唯一写入口，升版靠重跑它。约束读 [`_ds_prompt.md`](_ds/adobe-spectrum-2/_ds_prompt.md)。
- [`_ds_conformance.json`](_ds_conformance.json)：登记在案的偏差。豁免按**文件分组**（画进视频画面的素材色集中在 `app/data.js`，舞台渲染色集中在 `app/stage.jsx`）。
- [`build/help-content.mjs`](build/help-content.mjs)：构建时从当前共享 UI 的帮助目录与中文正文生成 `app/model-help.js`；不要手改生成文件。
- [`app/`](app/)：应用源码。两层模块制：`.js` 是无 React 的纯模型（各自 `window.BC_*`，`node --test` 可测），`.jsx` 是视图（esbuild 预编译）。依赖顺序在 `build/entries/` 中；Web 模块是 App 模块的子集（`app/model-surface.test.js` 对拍）。
- [`vendor/react-spectrum-s2/`](vendor/react-spectrum-s2/README.md)：`@react-spectrum/s2` 1.7.1 的打包件（Apache-2.0），App、Web 与控件样本页共用。怎么重新打包见它的 README。

新信息架构用到的文件：

| 文件 | 是什么 |
| --- | --- |
| `app/model-agent-projects.js` | 项目（目录）与会话：归属、侧栏分组与排序、状态汇总、搜索、通知、打开视频时挑哪条会话 |
| `app/model-space.js` | Space 的投影：条目、分类与计数、筛选与排序、状态文字、另存为新版本、导入素材 |
| `app/model-app-ia.js` | rail 的去向、调用共享路由编解码、关闭视频回到哪里 |
| `app/apprail-store.jsx` | 盖在共享 store 上的 App 层状态：项目列表、打开 / 关闭视频、Space 的收藏与回收站、新版本与导入 |
| `app/apprail.jsx`、`app/apprail.css` | App rail 与页面侧栏的外框 |
| `app/home-sidebar.jsx`、`app/home-session.jsx` | Home 侧栏、会话头（项目路径 + 视频条） |
| `app/page-space.jsx`、`app/space-list.jsx`、`app/space-viewer.jsx`、`app/space.css` | Space 页、网格与列表、查看框与导入框 |

## 记录方式

**不要往本 README 追加日志**，这里只放稳定的入口说明与目录。源码变化后重建，生成物使用内容哈希更新缓存。
