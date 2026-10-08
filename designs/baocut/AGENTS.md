# designs/baocut — 局部协议

BaoCut 的浏览器高保真原型，两份入口共用一套组件：`BaoCut.html` 是桌面应用（App rail + Home + Space + 编辑器），`BaoCutWeb.html` 是从原原型带过来的 Web 入口（只有编辑器与导出，没有 AI 入口）。规范在 [`docs/`](../../docs/README.md)，界面以 [产品设计](../../docs/product/product-design.md) §2–§5 为准。先读 [`README.md`](README.md)（信息架构、入口与文档目录），再读本文（怎么写代码）。

**用词**（[术语表](../../docs/glossary.md)）：项目 = 目录（智能体的工作目录）；视频 = 项目下的一个子目录，可编辑、可导出；成片 = 导出的文件。新写或改到的文案按这套词写；旧屏幕里把视频叫「项目」的文案还没扫，不要顺手半改。

## 绑定的设计系统是硬约束

一切视觉遵守 [`_ds/adobe-spectrum-2/`](_ds/adobe-spectrum-2/readme.md)，约束原文在 [`_ds_prompt.md`](_ds/adobe-spectrum-2/_ds_prompt.md)。不是建议——`check-conformance.mjs` 会让不合规的改动失败。

- **只用 `var(--*)`，不写字面值。** token 全在 [`app/tokens.css`](app/tokens.css)（生成物，勿手改）。要的颜色不在里面，那要么是值选错了，要么是该给 `_ds/adobe-spectrum-2/tokens/artboard-tokens.css` 加一档——不是往代码里粘一个 hex。
- **例外只有「画进视频画面的内容」**：素材缩略图、模板插画、导出画面的渲染色、macOS 红绿灯。那些是图不是 chrome，按文件登记在 [`_ds_conformance.json`](_ds_conformance.json) 的 `allow` 里并写清理由。豁免**按文件生效**：`app/data.js` 里为演示素材放行的色，不等于 `app/shell.jsx` 里也能拿它当 chrome 用。
- 单行豁免写理由：`/* @ds-allow: 画的是 macOS 窗口本身，不是 S2 表面 */`（写在该行或它上面一行）。
- **几何阶梯**：字号 `10/11/12/14/16/18/20/22/25/28…`（14 是 UI 默认、12 是标签、11 是下限，没有 13 和 15）；控件高度 `20/24/32/40/48`（勾选框与开关走小档 `14/16/18/20`）；圆角 按钮 pill、控件 8、卡片/弹层/toast 10、对话框与 sheet 16、勾选框 4；间距 `4/6/8/12/16/20/24/32/40/48`；动效 `150ms cubic-bezier(0.45,0,0.4,1)`，按下 `scale(0.96)`，焦点环 `2px outline + 2px offset`。
- 文案：句式大小写、按钮上放动词（不写「OK」）、第二人称、无 emoji、无感叹号；元数据用间隔号 + 相对时间（`12 clips · 2 小时前编辑`）。演示数据**禁真实品牌名**；服务商与模型的真实名称、标志属于产品事实，不受此限（标志的署名见仓库根的 `THIRD_PARTY_NOTICES.md`）。

## 控件只写一次

基础控件统一使用 **React Spectrum S2**（`window.RSP`），App、Web、Components 三个入口加载同一份 `vendor/react-spectrum-s2/`。每个入口的根上只有一个 Provider，语言与主题由宿主提供。

- S2 有的控件直接使用；已有屏幕可通过 `app/ui.jsx` 与 `app/ui-spectrum.jsx` 的适配接口组合。按钮、输入、选择、开关、滑杆、菜单、弹层、对话框、提示与进度都由 S2 实现。
- `BCAction` 适配媒体卡片等自定义内容的按钮；`Field` 保留输入元素 ref 与旧屏幕的 change 事件接口。新表单优先使用 S2 的值回调。单选项必须属于同一个 `RSP.RadioGroup`。
- 时间线、画布手柄、素材缩略图与 App rail 外框是产品专用布局，继续使用 token。文件选择器可保留隐藏的原生 `input type="file"`。
- S2 样式在 `@layer _.*`；无层 CSS 会覆盖它。不要给 S2 控件套旧 `.btn`、`.field`、`.sw` 等外观类。`app/spectrum.css` 只处理布局与既有屏幕的兼容。
- 新增共享适配模块时，三个入口都要按相同顺序加载并同步缓存串。Web 的能力限制仍由 `BC_SURFACE` 决定。

**外壳的边界只画一次**（Spectrum 2 app frame，`app/ui.css` 的「sheet」「缝」两节与 `app/apprail.css`）：标题栏与 rail 在 base 底色（gray-50）上，标题栏下面、rail 右边都不画线；页面侧栏（`.hside` / Web 的 `.side`）、会话抽屉（`.agdock`）、内容区（`.content`）是同一张白色 sheet（gray-25），都不画边框，只有紧挨 rail 的那一块由 `.apprail + …` 规则给 16px 左上圆角，别的元素不加圆角；sheet 里的竖向边界只由 `.seam--side` / `.seam--dock` 画一根 2px gray-100 的线（hover / 拖动的高亮与它同位），横向分隔同样 2px gray-100。往外壳里加东西时不要在这些边界上再画一条线、再加圆角或再叠一层底色，两根线相隔几像素并排就是双线。rail 的条目、分区（primary / end）与选中判定只写在 `app/model-app-ia.js`。

**新 class 名先查重**：`ui.css` 是全局的，起名撞上旧类（例如编辑器右侧的 `.rail`）会两边互相串样式。新区域的类带自己的前缀（`apprail__`、`hside__`、`hhd__`、`space__`、`sp-`、`spv__`）。

## 模块纪律

两层，靠 `build/entries/*.html` 中的源文件顺序组织依赖，esbuild 在构建时编译 JSX：

- **`app/*.js` — 纯模型**。不 import React、不碰 DOM，IIFE 结尾 `Object.assign(window, { BC_XXX })`。这一层必须能被 `node --test` 直接 require（`global.window = {}` 再 `require('./x.js')`）。时间轴几何、时间码解析、章节命中、路由栈、派生投影都归这里。
- **`app/*.jsx` — 视图**。构建时编译成生产 JavaScript，顶部从 `window` 解构依赖、底部 `Object.assign(window, {...})` 导出。

**每个文件的行数上限是真的**：视图模块超过 ~600 行就拆。可执行的拆分边界——

- `store.jsx` 只放**跨屏**状态与路由栈；一块屏自己的开合、hover、草稿一律用局部 `useState`。
- 面板各自一个 `panel-*.jsx`，面板内部再长就按子视图拆，不要往 store 里塞。
- 任何「算出来的东西」下沉到 `.js` 纯模型并补一条 `node --test`——那是行数真正的泄压阀，也是这一层唯一能被自动验证的部分。

命名空间是 `BC_*`。不要用 `VK_*`——那是更早的 Mac 原型留下的前缀，已经归档。

**绝不写 `const styles = {}`**。全局作用域共享，同名 styles 对象会互相覆盖。样式走 CSS class + token；只有真正动态的值（进度条宽度、算出来的色相）才用内联 `style={{}}`。

## 两份入口，一套组件

`BaoCut.html`（App）与 `BaoCutWeb.html`（Web）加载同一批模块。Web 是 App 的减法：只有视频列表、编辑器 Tab 与导出，没有任何 AI / Agent 入口，也没有 App rail、Home、Space 与 App 的外壳页面。新的产品设计没有为 Web 写规格，它保持原原型的行为。

- **差异只写在一张表里**：[`app/model-surface.js`](app/model-surface.js)（`window.BC_SURFACE`）。共享组件只读能力位——`BC_SURFACE.ai`（AI 入口）、`.agent`、`.pages`（App 外壳页面与去往它们的链接）、`.help`、`.windowChrome`、`.remote`（远端算力的使用侧入口：各处「用哪台电脑 / 在哪儿跑」，2026-09-27）、`.sidebarDefaultOpen`、`.appRail`（App rail、Home 侧栏、Space、打开视频时的会话，2026-10-01）——**不判断 `id` 或 `isWeb`**，也不为 Web 另写一份组件。Web 独有的文件只有 `web-shell.jsx` / `web-shell.css` / `web-main.jsx`。
- **在共享面板里加 AI 入口**（会发起模型调用或任务、或把人带去工具页 / Agent / 任务页的按钮、菜单项、链接）时，同一笔改动里用 `BC_SURFACE.ai`（或 `.agent` / `.pages`）把它包住。**收入口，不收状态**：进度、结果、过期计数照常显示，只读。原本放按钮的空态改说 `BC_SURFACE.aiElsewhere('…')` 那句话，不写歉意。
- **新增共享模块**两份 `build/entries/` 模板都要登记源文件，缓存串相同；只属于 AI / Agent / App 页面的模块不进 Web 入口，并登记进 `app/model-surface.test.js` 的 `WEB_DENY`。改了任何共享文件，运行 `npm --prefix designs/baocut run build`，生成物按内容自动更新缓存串——`node --test` 会抓不一致。会改的图形资源（如 `assets/shell/*.svg`）在 CSS 里用 `url()` 引用，构建按文件内容给它加版本串；写在 JSX 里的资源地址不带版本，浏览器会继续用缓存里的旧图。
- **两份入口都要看**：改共享组件后 App 与 Web 各过一遍预览，控制台不许有报错（Web 入口少加载了一批模块，引用 `window.X` 而 X 只在 App 入口里时，Web 会在运行期炸）。
- 本地存储按表面分键（`BC_SURFACE.storageKey()`），新加的持久化键也要过它。

## 数据

演示数据集中在 [`app/data.js`](app/data.js)（`window.BC_DATA`）。演示总时长 206s、4 章边界、6 段 clip、元素配色与 Timing 表沿用原原型的规格，新的产品设计没有逐项列这些数；改它们前先看编辑器里哪些屏依赖它们。

项目（目录）在 `agentProjects`，视频的 `dir` / `folder` 指向所属项目和它在项目里的子目录名，Space 的非视频条目在 `spaceOutputs`。演示路径要能看出嵌套：`~/BaoCut/<项目>/<视频>/…`。

## HTTP 预览

首次启动先安装原型的独立 npm 依赖，再在仓库根目录运行：

```bash
npm --prefix designs/baocut ci
npm run dev:designs
```

在原型目录中也可运行 `npm run dev`。指定其他端口：

```bash
npm run dev:designs -- --port 4332
```

Vite dev server 仅监听本机 `127.0.0.1:4331`，根目录是当前检出的 `designs/baocut/`。端口被占用时直接失败，不自动切换端口。Vite 依赖由原型自己的 `package.json` 与 `package-lock.json` 管理。

浏览器访问 `http://127.0.0.1:4331/` 即可，起始 URL 是 `http://127.0.0.1:4331/#/home`。`index.html` 与 `BaoCut.html` 由同一份 App 模板构建；根入口没有 hash 时显式进入 Home，有 hash 时保留指定路由。Web 入口是 `http://127.0.0.1:4331/BaoCutWeb.html`，控件样本页是 `http://127.0.0.1:4331/Components.html`。旧 `/baocut/BaoCut.html`、`/baocut/BaoCutWeb.html` 及其相对资源 URL 通过 Vite 兼容路径继续可用。`localhost` 同样可用，但它与 `127.0.0.1` 是不同的浏览器存储来源。

停止：在运行服务的终端按 `Ctrl+C`。重启：等进程退出后，在仓库根目录再次运行 `npm run dev:designs`。端口已被占用时，先停止原来的预览服务；若由 `.claude/launch.json` 启动，则通过启动它的工具停止，不要同时启动两份。

启动时自动运行现有 esbuild 构建。修改 `app/`、`build/`、`assets/`、仓库顶层 `templates/`、共享帮助正文或 S2 打包件后自动重建，成功后由 Vite 刷新页面；编译失败时显示错误，修复后继续。沿用全局 `window.BC_*` 模块，使用整页刷新，不做 React Fast Refresh。无需另开 `npm run watch`；Vite 配置变化时自动重启，更新依赖后按上述方法手动重启。

## 验证

改完必须全绿，三条都跑：

```bash
npm --prefix designs/baocut run build
node --test designs/baocut/build/*.test.cjs
node designs/baocut/_ds/adobe-spectrum-2/check-conformance.mjs \
  --token-file designs/baocut/app/tokens.css \
  designs/baocut/app/*.css designs/baocut/app/*.jsx designs/baocut/app/*.js
node --test designs/baocut/app/*.test.js
open http://127.0.0.1:4331/   # 先按「HTTP 预览」启动 Vite，自动进入 Home
open http://127.0.0.1:4331/BaoCutWeb.html   # 改了共享组件，Web 入口也要看
```

`file://` 打不开（跨源本地脚本读取被浏览器拦），必须走 HTTP。

- **在 worktree 里验证**：`.claude/launch.json` 的 `designs` 服务 cwd 固定是主检出，会服务旧文件。从 worktree 根安装原型依赖，另起一个端口 `npm run dev:designs -- --port <端口>`，先 `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<端口>/app/<本轮新文件>` 验明正身再看页面，收尾停止服务。
- **Home 与 Space 打开同一部视频，编辑器那一块必须一样**：两边各开一次，比对 `#root` 的 DOM（抹掉 react-aria 生成的 id 与相对时间），只允许 rail 的高亮和「关闭视频」的提示不同。
- **构建与缓存**：修改源码或入口模板后运行 `npm --prefix designs/baocut run build`（Vite 开发时自动构建）。`index.html` / `BaoCut.html` / `BaoCutWeb.html` / `Components.html` 与 `generated/` 都是提交到 Git 的生成物，不手改。资源 URL 带内容哈希；不再手动给生成物推时间戳。
- 代码注释里的「第 N 轮」「台账 2026-09-10-153012」「§17.6」之类引用指向原原型仓库的变更日志、台账与旧规格，本仓库没有带过来；新写的注释引用 [产品设计](../../docs/product/product-design.md) 的小节号。**不要往 `README.md` 追加日志。**

## 同步纪律

规格在 [`docs/`](../../docs/README.md)，原型跟着规格走。改本原型的布局、交互、文案、状态语义或数值时，对照 [产品设计](../../docs/product/product-design.md) 的对应小节：

- 原型照规格做的，注释里写小节号（例如 `product-design §4.6`）。
- 原型和规格不一致（规格没写到、原型先做了简化、或者觉得规格该改），在交付说明里逐条列出小节号与差异，由维护 `docs/` 的人决定改哪边。不要悄悄偏离，也不要为了对齐顺手改 `docs/`。
