# docs-runtime

文档编辑器的运行时：文档应用（标签页、工具栏、批注、版本、侧栏）、编辑器 iframe 里的 ProseMirror 运行时（lfile 运行时）与编辑器附加脚本（KaTeX、表情）。源码按 1:1 移植自 Claude Docs 类型的 TypeScript 重建（`src/docs-type`），文件名与内容不改，只改 BaoCut 托管必需的部分，改动处带 `BaoCut:` 注释（见下）。`apps/docs-editor` 把它打成编辑器页面，接口与长连接的前缀由 `packages/docs` 的 `editor/install` 设好，页面背后的 Docs 服务也在 `packages/docs`。

## 结构

源码保持原工程的平铺布局：JSX 用包内自己的 `jsx-runtime.tsx`，`tsconfig.json` 的 `jsxImportSource` 是 `"."`，按每个文件所在目录解析 `./jsx-runtime`。重建代码按原工程的布局写 `./node_modules/@base-ui/react/…` 这样相对源码目录的深路径导入（不在包的 exports 里），`tools/asset-plugin.ts` 的 `nodeModulesPaths()` 从导入方往上找第一个有这个文件的 `node_modules`，Vite 与两处 esbuild 构建都用它。

类型：保留原工程的 `Dynamic`（即 `any`），用原工程的编译选项（不开 `noUncheckedIndexedAccess`，引入 `vite/client`）单独检查，根 `tsconfig.json` 排除本包与 `apps/docs-editor/src`。根 tsconfig 开着 `noFallthroughCasesInSwitch`，`docs-app.tsx` 里有一处 `case` 落进下一个 `case`（TS7029），改成显式做下一个 `case` 的事，行为不变。

| 路径 | 内容 |
| --- | --- |
| `main.ts`、`hello-early.ts`、`preload.ts`、`rolldown-runtime.ts` | 入口；最早执行的环境判断（`isFrameArtifact()`）、预热与模块预载 |
| `docs-app.tsx`、`platform-core.tsx`、`platform-lazy.tsx` | 文档应用、平台层（接口、长连接、批注存储、字体、上报）、按需加载的部分（版本对比、表格、导出） |
| `cds.tsx`、`react.tsx`、`jsx-runtime.tsx`、`jsx-dev-runtime.tsx` | 原平台的组件库；React 与 JSX 运行时 |
| `editor-runtime.tsx`、`editor-schema.ts`、`editor-extras.ts` | 编辑器 iframe 里的 ProseMirror 运行时（打成 `lfile-runtime.35524228.js`）、文档结构、KaTeX 与表情附加脚本 |
| `editor-runtime-source.ts`、`editor-extras-source.ts` | 两份脚本的文本：前者是空串（只在 Frame 里内联运行时，独立页面从接口取），后者由资源插件打进页面 |
| `right-rail.tsx`、`tabs-*.ts(x)`、`version-*.ts(x)`、`history-groups.ts`、`lfile-snapshot-view.tsx`、`diff-worker.ts` | 批注栏、标签页、版本历史与版本对比（Worker） |
| `claude-*.ts(x)`、`ask-*.ts`、`session-route-side.ts`、`page-skill-bulb.tsx` | 空行上 @Claude 提问、Claude 直接写文档、会话路由（BaoCut 不提供，见「不提供」） |
| `widget-*.tsx`、`model-workbook.ts`、`display-text-paths.ts`、`shiki-*.ts`、`markdown-renderer.tsx`、`chat-markdown.tsx`、`code-viewer.tsx` | 嵌入组件、数据表、代码高亮与 Markdown 渲染 |
| `type-models/`、`types.ts`、`globals.d.ts`、`assets.d.ts`、`host-protocol.ts` | 模块之间的协议类型与页面全局 |
| 其余 `.ts` / `.tsx` | 原包按需加载的分块（字体与版式控件、语言对话框、底部抽屉、动画、空白文档模板、表情数据等），一个文件对应原包的一个分块 |
| `docs-host.ts` | BaoCut 加的：宿主接口 `globalThis.docsHost` 的类型与读取（见下） |
| `public/assets/docs.css` | 原页面的样式表（与线上 `index-7E8lmnbp.css` 逐字节相同），原样拷进产物 |
| `public/artifact-type/lfile-spell-words.e258c731.txt` | 拼写检查词表，原样拷进产物（只在 Frame 里取，独立页面不取） |
| `tools/asset-plugin.ts` | 原工程的资源插件：用 esbuild 打 lfile 运行时与编辑器附加脚本，KaTeX 的 WOFF2 字体独立输出为带内容哈希的本地资源 |
| `katex-fonts.ts` | 父页面读取并缓存 KaTeX 本地字体，转换为 data URL 样式，经 `loadFonts` 传入编辑器 iframe |

原工程的 `thumbnail.html` / `thumbnail.ts`（托管平台生成文档缩略图用的页面）没有搬：BaoCut 不生成文档缩略图，Runtime 也不提供这个页面。

## 宿主与平台

代码里以 `BaoCut:` 注释标出，页面模板 `apps/docs-editor/index.html` 的改动写在它开头的注释里。原应用有上百处按 `isFrameArtifact()`（嵌进 claude.ai 的 Frame）切到 postMessage 通道，BaoCut 的页面不是 Frame，也不伪装成 Frame，下面每一处只放开一个具体的条件。

- **前缀与路由**：页面在 `/docs/<grant>/project/<文档 id>`，Runtime 注入 `<base href="/docs/<grant>/">`。`@baocut/docs/editor/install`（`apps/docs-editor/src/main.ts` 的第一个导入）在应用模块求值之前设好 `__BONGO_BASE__` / `__BONGO_WS_BASE__`；接口、长连接（`<前缀>/api/mux`）与 lfile 运行时（`<前缀>/api/lfile-runtime/35524228`）都带这个前缀，路由去掉前缀再匹配，这些原应用本来就支持，没有改。页面引用的资源（样式表、分块、图标字体、Worker）都是相对地址，靠 `<base>` 落在 `/docs/<grant>/` 下。
- **独立工具栏**（`docs-app.tsx`，三处）：原版只在 Frame 里显示文档工具栏（标签页、字体、版式、表格、图片、清单、插入菜单）。去掉 `useDocumentTabsUseSyncExternalStore` 的 frame 条件（手机宽度上仍然不显示）；独立分支的内容容器在有工具栏时加 `flex flex-col`，编辑器 iframe 才填满工具栏下方（否则只有 150px 高）；`emitFormatState` 去掉 Frame 条件，编辑器回报光标处的格式，工具栏按钮的可用与选中状态靠它。
- **批注发给智能体**（`docs-host.ts`、`platform-core.tsx`、`docs-app.tsx`）：原版只在 Frame 里经 `window.claude.comments` 把批注交给 Claude。BaoCut 的宿主在应用模块求值前装上 `globalThis.docsHost.comments`（`canSendToClaude()` 与 `sendToClaude({ anchor: { path, x, y }, text })`，类型与语义写在 `docs-host.ts`），装了时：
  - `platform-core.tsx` 里批注用的宿主改读 `docsHost`（Frame 里照原样读 `window.claude`）；看的人按成员处理（独立页面没有 Frame 的成员信息）；`frameRegisterCustomAnchors` 给一个空的锚点实现（应用只检查方法存在、卸载时调 `release()`）。
  - `docs-app.tsx` 的 `useCommentSessionBridge`、批注下方的发送状态、块定位（`knownBlocksRef` / `summonHostRef`）与批注框的「Send to agent」勾选，从 Frame 判断改成 `commentSummonHost()`（Frame，或独立页面装了 `docsHost.comments`）。
  - 宿主没装 `docsHost` 时与原版的独立页面相同：没有勾选，批注只存进文档。
  - 顺序：批注先经文档服务存进文档（door 的 create utterance），之后才调 `sendToClaude`，实测相隔约 20 ms。`anchor.path` 形如 `f-<标签页 id>#<正文节点 id>/<块 id>@<起>-<止>;thread=<批注 id>`；`text` 是去掉控制字符与格式字符后的批注正文，开头的 `@Agent ` 保留，例如 `@Agent please tighten this`（以前的文档里是 `@Claude`）。
- **Ask Agent**（`docs-app.tsx`、`docs-host.ts`）：原版的两个入口都通向 claude.ai 的对话栏，独立页面里点了没有可见的反应（左下角按钮只打开一块空白浮层，挡住左下角；工具栏按钮只播报一句）。
  - 选中文字后工具栏的「Ask Agent」（`ask-claude` 手势）：独立页面装了 `docsHost.comments` 时照 Frame 的做法发 `comment-key`，打开这处选区的批注框，这条批注当作问智能体的（`ask`），默认发给智能体；批注发不出去（页面单独打开、没有会话，或只读）时提示「Ask Agent isn't available here」。
  - 左下角的「Ask Agent」（`ChatPill`）：宿主装了 `globalThis.docsHost.chat`（`focus()`，BaoCut 的 iframe 里才装）时点了交给宿主，BaoCut 把焦点交给这个会话的输入框（`editor:focus-chat`）；装了 `comments` 没有 `chat`（页面单独打开）时不显示。两种情况都不再打开原版的对话浮层。
- **本页新建的批注收后续回复**（`platform-core.tsx` 的 `seatDoorList`）：原版的 `room:project/<id>` 同步评论（`utterance/<id>`），批注栏接上 fold 之后，本页新建的批注由 fold 接管，智能体的回复经 fold 到达。BaoCut 的 room 只同步标签栏与下拉选项，评论走 door 读回的列表；原版在 fold 接上时只拿列表补 fold 里没有、本地也没有的批注，本页新建的那条一直是本地那份，智能体的回复要重开编辑器才看得到（服务端的推送与编辑器重读都正常）。改成：门里列表的批注只要不在 fold 里，就顶替本地同 id 的那份，与门里来的批注同样处理；没送达的本地改动照原样由发件箱补回。
- **文案**：批注发给智能体这条路上的状态、勾选、提示与智能体署名称「the agent」/「Agent」，键与判断不变（`platform-core.tsx` 的 `PlatformSessionAndSourcesSent` 等、`DataModelSchemasSendToClaude` 等，`docs-app.tsx` 的 `Sent to agent`、`Sends to agent`、`The agent is working on it…`、`Ask the agent…`，`cds.tsx` 里批注框勾选与智能体署名的默认文字）。「Ask Claude」一类的按钮、提示、标题与播报改称「Ask Agent」/「ask the agent」（工具栏按钮与它的三种提示、左下角按钮、行内提问卡片、`@` 菜单的分组名、空文档的占位语「Start typing, or ask the agent to…」——`editor-runtime.tsx` 按「ask the agent」切开它做链接，`platform-core.tsx` 的 `EditorHostMessage12` 与它保持同一句）。批注里提及智能体写作「@Agent」：提及项的 id 仍是 `claude`（发给智能体按 id 判断），只把标签从 Claude 换成 Agent（`platform-core.tsx` 的 `PlatformApiAndAuthLabel`、`DataModelSchemasLabel3`，`cds.tsx` 批注框开头的徽标），提到这个写法的提示一并改；按正文识别提及的几处（`platform-core.tsx` 的 `platformSessionAndSourcesPattern3`，`docs-app.tsx` 的 `isEmptyClaudeRequest`，`claude-session-run.ts`、`claude-ask-card.ts`，`packages/docs` 的 `door.ts` 与 `editor/host.ts`）同时认 `@Agent` 与以前的 `@Claude`，旧文档里的批注照样发得出去。智能体改文档时露出来的名字也一样：光标旗子与在线头像上的名字（`platform-core.tsx` 的 `PlatformApiAndAuthColor`、`editor-runtime.tsx` 的 `RenderedCodeAndProofreadingColor`，以及没报名字的智能体）、「正在改这篇文档」的播报、新加标签页的提示、改写了正在打字的段落的提示、批注里智能体正在回复时的署名与「The agent is working on it…」、智能体头像的无障碍名称、表情回应名单、「Resolved by the agent」与「via the agent」，还有文档还在建、空标签页的提示；连不上与编辑器更新后的提示不提 Claude Docs，只说 Docs。这些都只是显示的文字，没有别处按它判断。BaoCut 用不到的部分（正文里的行内提问：`@claude` 触发、正文提及的标签与行内提问卡片；skill、widget、图表、登录、分享、Google Drive、校对）文案照旧。存下的批注正文照原样是纯文字，旧批注仍显示 `@Claude`；给模型看的提示词（`docs-app.tsx` 的 `S7`、`DocumentCommandsState2` 等）不改；智能体头像与工具栏按钮的星形图标来自图标字体，见「随包的第三方代码与资源」。
- **字体**：不内置 Anthropic Sans / Serif / Mono 品牌字体（`platform-core.tsx` 的字体清单留空）。原版把品牌字体与图标字体用 `Promise.all` 一起取，缺一份整组作废、编辑器 iframe 连图标字体也没有；清单留空后只取图标字体，正文退回 `docs.css` 字体栈里的系统字体。图标字体按应用要的名字 `artifact-type/fonts/anthropicons-variable.e7f7e9ca44846912.woff2` 放进产物，文件是 `packages/slides-runtime/src/fonts/anthropicons-fizzy-lake.woff2`（`apps/docs-editor/vite.config.ts`）。
- **KaTeX 字体**：只分发 npm 包的 20 份 WOFF2（共 259,792 字节），输出到 `artifact-type/fonts/katex-<字体名>-<内容哈希>.woff2`，不打进附加脚本。父页面按 `document.baseURI` 读取 grant 下的本地文件，同一页面内合并并发请求、缓存成功结果；失败的字体可在下次调用时重试。字体转为 data URL 的 `@font-face` 样式，通过既有 `loadFonts` 消息与正文／图标字体一并交给 iframe（冷启动 `all` 或预热帧 `first`，`rest` 不重复传）。附加脚本只保留 KaTeX 排版 CSS。iframe 保持原有 sandbox 与 CSP；网关和 Web 共用同一份资源与加载流程。
- **页面模板**：不装托管平台的健康上报脚本，不预载品牌字体，`appifact-capabilities` 只留 `comments`（应用本身不读这个 meta），不带写给托管平台的 README 注释与 meta，标题是 Docs。

## 重建代码的修正

与原版压缩代码对照后改回，带 `BaoCut: restorer fix` 注释：

- `platform-lazy.tsx` 的 `createDiffWorker`：重建代码照抄了原版构建产物里 Vite 改写后的地址 `new URL("diffWorker-Dnf0Jf6P.js", import.meta.url)`（原包里同目录的 Worker 分块）。这里的构建不产出这个文件，Worker 加载失败，版本对比退回主线程计算（构建时 Vite 也会警告）。改回源码的写法 `new Worker(new URL("./diff-worker.ts", import.meta.url), …)`，Vite 把 `diff-worker.ts`（就是从 `diffWorker-Dnf0Jf6P.js` 还原的）打成 `assets/diff-worker-*.js`（约 78 KB，原版 75 KB）。

## 不提供

下面这些要 claude.ai 的服务或 Frame，BaoCut 不提供，界面照原样保留。都是在 `/docs/<grant>/` 下实测看到的：

- **文档里的对话栏**：原版左下角按钮与工具栏的提问打开 claude.ai 的对话栏，BaoCut 不提供；两个入口改走批注框与 BaoCut 会话的输入框，见「宿主与平台」的「Ask Agent」。
- **空行上 @Claude 提问**：编辑器 @ 菜单里没有「Ask Agent」一项（`docs-app.tsx` 里 `people` 回复的 Frame 条件）。只放开这一处与行内提问的 Frame 条件试过：卡片能出来，但按回车先要模型判断请求（`sample`，`claude-verdict.ts`）、再决定由 Claude 直接写还是转成批注，独立页面里卡片停住，既不存批注也不调 `sendToClaude`，所以照原样不提供。要找智能体，选中文字写批注（装了 `docsHost.comments` 时「Send to agent」默认勾选）。
- **Claude 直接写文档**（「Ask the agent to edit」之后的写作卡片、`claude-writing-*`、会话路由 `sendToClaudeSession`）：要宿主的 `room` 能力（Frame 里的 `window.claude`）。
- **分享**：「Share」按钮点了没有反应。
- **版本历史**：面板向 `<前缀>/api/v3/project/<id>/file/<文件>/history` 取数据。原始材料里只有客户端，没有这个接口的回应格式，BaoCut 的文档服务（`packages/docs/src/server.ts`）不提供它，回 404，面板显示这个错误。正文最近若干个 rev 的快照另存在 `tabs/<正文 id>.history.json`，只给智能体的 `atRev` / `sinceRev` 读与 `restore` 用。
- **品牌字体**：见上。**拼写词表**只在 Frame 里取，独立页面不取（产物里照原样有这个文件）。
- 项目菜单里的「Data sources」「Send feedback」「Copy support code」是平台功能，没有逐个试。

## 随包的第三方代码与资源

- 打进页面、lfile 运行时与编辑器附加脚本的 npm 包按实际打进的模块收集许可：Vite 的模块图加上资源插件记下的两处 esbuild 输入（`tools/asset-plugin.ts` 的 `editorAssets(root, bundledInputs)`），输出到产物的 `third-party-licenses.txt`（`apps/docs-editor/licenses.mjs`），见根目录 [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)「协作文档编辑器」。
- 图标字体（Anthropicons）不是仓库约定的 S2 图标（[仓库约定 §4](../../docs/repo-conventions.md#4-界面图标)），以后要换；它的分发许可也待确认。
- 依赖版本跟原工程对齐（`package.json` 钉住原工程的版本；`@base-ui/react` 1.7.0、`@tanstack/*` 等装在本包的 `node_modules`），与原工程安装结果不同的（用的是根目录 `node_modules` 里已有的版本）：React / ReactDOM 19.3.0（原 19.2.5）、`@tiptap/starter-kit` 嵌套的 `@tiptap/core` 等与 `@tiptap/pm` 3.32.0（原 3.31.4）、`marked` 18.1.1（原 18.1.0）、`mdast-util-from-markdown` 2.0.3（原 2.1.0）、`mdast-util-to-markdown` 2.1.3（原 2.2.0）；`use-sync-external-store` 本包装的是原版的 1.6.0，根目录的 `wouter`、`zustand` 引用根目录的 1.7.0，两份都打了进去。
- lfile 运行时与编辑器附加脚本都压缩（`tools/asset-plugin.ts` 的 `minify: true`，带 `BaoCut:` 注释）。原工程的资源插件不压缩，原版的产物是压缩过的（4.9 MB）。运行时从约 12.4 MB 降到约 5.2 MB（5,154,387 字节）；附加脚本的字体分发方式见「KaTeX 字体」，避免字体二进制参与 JS 下载、解析与求值。

## 验证

```bash
node apps/docs-editor/build.mjs --force
```

```bash
npx tsc -p packages/docs-runtime/tsconfig.json --noEmit
```

改动后在 `/docs/<grant>/project/<id>` 下打开一篇文档，过一遍：图标与工具栏、输入后重新载入、选中文字加批注、装了 `docsHost.comments` 时批注框出现「Send to agent」并调到 `sendToClaude`。在 BaoCut 的文档标签里再过一遍：选中文字点工具栏的「Ask Agent」出批注框、加进会话草稿；左下角的「Ask Agent」把焦点交给会话的输入框。
