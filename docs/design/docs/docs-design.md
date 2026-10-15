# 会话里的协作文档

界面上叫「协作文档」（英文 Docs），与 Space 里已有的「文档」类型（文本、Markdown、PDF 文件）区分；下文简称文档。

**状态：已实现（2026-10-14）。** 第 0 节的五项决定按默认做法实现；原型、运行时包与构建、`packages/docs` 服务与连接器、Runtime 文档服务与路由、skill 与工具、功能区标签、评论发给智能体都已做完。实现与 Claude Docs 不同的地方随文写明。

## 0. 决定

| # | 决定 | 做法 | 影响 |
| --- | --- | --- | --- |
| D1 | 编辑器运行时如何进仓库 | 还原的源码放进 `packages/docs-runtime/` 并入库（同 slides、design），BaoCut 的改动以 `BaoCut:` 注释标出，包的 README 逐项列出 | 第 3 节 |
| D2 | 托管 | 与幻灯片相同：网关上 `/docs/<grant>/…`（grant 就是凭证，桌面界面与 CLI 用），Web 服务同源另挂一份（会话 cookie）；编辑器自己的 WebSocket 走 `/docs/<grant>/api/mux`。不用设计稿那种单独的 loopback 主机名 | 第 6 节 |
| D3 | 智能体怎么改文档 | 只经 `docs_*` 工具，语义照搬 Claude Docs 连接器（door 的动词、拒绝码、回执）；不用文件工具写文档目录。工具与编辑器经同一份内存里的文档读写，改动即时推给开着的编辑器 | 第 7 节 |
| D4 | 图表、示意图、widget | 不做：连接器拒绝（`unsupported`），已有的 embed 块原样保留；skill 让智能体用表格与列表表达 | 第 4、7 节 |
| D5 | 评论 | 评论是文档的一部分，存在 `comments.json`，编辑器与智能体都读写；「发给智能体」只是把一个指向评论的标注挂到会话的消息上（不像幻灯片的一次性标注） | 第 8 节 |

## 1. 目标与范围

1. **创建**：用户在会话里要一份文档，智能体第一个工具调用就是骨架（标题、byline、每节一个待填块），会话线程里随即出现文档卡片；之后一节一节填，用户看着它填满。
2. **打开**：点卡片（或 Space 里的条目），功能区新开一个「协作文档」标签，里面是完整的文档编辑器：标签页、富文本、表格、任务、下拉、图片、评论；改动即时保存。
3. **评论与请求**：用户在文档里评论，或在评论上点「发送给智能体」、在空行上写给智能体的请求；它们作为文档标注进当前会话的输入框，与一句话一起发出。
4. **据此修改**：智能体收到结构化的标注（哪份文档、哪个标签页与块、线程、原文、评论），用 `docs_update` 改文档、在那个线程里回复。

| 范围 | 内容 |
| --- | --- |
| 做 | 上面四步，桌面端与 Web 端；单用户；导出 Markdown（智能体 `docs_export`，编辑器里的导出） |
| 不做 | 多人协作与在线状态；分享与权限；图表、示意图、widget（D4）；Claude 会话侧栏、版本侧栏里依赖 claude.ai 的部分 |

## 2. 文档的文件

一份文档是一个目录，放在会话工作目录或项目目录里：

```
<doc>/
  doc.json              { format: "baocut-doc", version: 1, id, name, created, updated, rev, tabs: [...], enums?, sessions, ... }
  tabs/<正文 id>.json    一个标签页的正文：{ id, rev, blocks: [...] }
  comments.json         评论线程与回复、resolve
  assets/<sha256>.<ext> 上传的图片与文件，按内容寻址
```

- 认文档只看 `doc.json`（`format` 为 `baocut-doc`）：`readDocInfo(dir)` 给出 `{id, name, tabs, openThreads}`，Space 与项目文件列表据此把目录当成一个条目（第 7.3 节），不再往里走。
- 写入原子化（临时文件加改名），保存去抖，关服务前 `flush()`。
- 块与字符的 id 是 `<session>.<clock>`（Claude Docs 的 char-id），会话前缀记在 `doc.json` 的 `sessions` 里，重开文档不复用。

细节（每个字段、块与 atom 的写法、XML 正文格式）见 `packages/docs` 的源码注释。

## 3. 运行时的放置与构建

- `packages/docs-runtime/`：Claude Docs 前端的还原源码（D1），只做在 BaoCut 里跑起来必须的改动，每处 `// BaoCut:` 注释说明为什么，包的 README 列出全部。
- `apps/docs-editor/`：Vite 构建，`npm run build:docs-editor` 输出到 `apps/docs-editor/dist/`（编辑器页面、`artifact-type/` 下的运行时与字体、`third-party-licenses.txt`）；输入没变时跳过，`--force` 重建。入口先导入 `@baocut/docs/editor/install` 装好宿主 shim（必须在编辑器的任何模块求值之前），再加载编辑器。
- KaTeX 字体只随包分发 WOFF2，本地文件带内容哈希。父页面按 grant 下的资源地址读取并缓存，转换为 data URL 样式后经既有 `loadFonts` 消息传给编辑器 iframe；附加脚本只含排版 CSS，不内嵌字体二进制，不放宽 iframe 的 sandbox 与 CSP。网关与 Web 使用同一条加载路径。
- 首屏：lfile 运行时与编辑器附加脚本压缩后打包（运行时约 12.4 MB → 5.2 MB）；页面模板在 body 开头先挂一个隐藏的空沙箱 iframe，让浏览器提前起编辑器 iframe 要用的渲染进程（原版在 Frame 里提前建好编辑器 iframe，独立页面没有这一步），编辑器就绪（`lfile-prelude-ready`）或 20 秒后移除。本机实测从编辑器 iframe 建好到正文画出约 0.52 秒降到约 0.31 秒（各 3 次的平均）。
- 构建产物的位置：`BAOCUT_DOCS_EDITOR_DIST`，打包后的应用里是 `<resources>/docs-editor`，开发时是仓库的 `apps/docs-editor/dist`；都没有时 `docs.open` 照常给地址、`editorAvailable` 为 false，界面显示不可用的说明。

## 4. 服务端：`packages/docs`

- **存储**（`doc-store`）：按目录读写第 2 节的文件；同一个目录在内存里只有一份 `LiveDoc`。
- **door**：编辑器与智能体共用的读写入口，动词与 Claude Docs 连接器相同（`batch`、`create`、`read`、`update`、`query`、`delete`），对象有 project、file（标签页）、node（正文）、utterance（评论）、enum（下拉选项）、blob（素材）。正文的改动是 prose ops（`insert`、`replace`、`delete`、`move`、`set`、`restore` 等），整批要么全部生效、要么一条也不生效。带 `opId` 的写入只生效一次：编辑器把发出去还没收到回执的改动记在本地（`bongo.op-wal`、`bongo.comment-outbox`），重新打开时用同一个 opId 原样重发；door 按「写入者 + opId」记住最近 256 次写入的回执，重发的回上次的回执，不再写、不再推送（batch 里逐条判断）。
- **mux**：编辑器的 WebSocket，承载 door 调用与文档变化的推送；智能体经 door 写入后，开着的编辑器即时收到。`feed:project/<id>` 的信封里 `actor` 照原版的写法：本机用户是 `{principal, channel: "human"}`，智能体是 `{principal, channel: "external", via: "mcp"}`（编辑器只把这样的 actor 认作智能体）。评论的变化以线程为地址推送给所有连接（含发起的），编辑器据此重读评论；room 不同步评论，本页新建的批注由 door 读回的列表更新（`packages/docs-runtime` README「本页新建的批注收后续回复」）。
- **连接器**（`createDocsConnector(server)`）：给智能体的一层，把连接器的参数（markdown 与 chip、`find` 目标、guard、`$lid`）翻成 door 调用，回执与拒绝码照搬 Claude Docs（D3）。图表、widget 与 `node/…` 的 embed 拒绝为 `unsupported`（D4）。
- **DocsServer**：Node http 的路由与 WebSocket 升级（第 6.2 节），grant 只在内存里，Runtime 重启后要重新打开。

## 5. 编辑器页面与宿主 shim

- Runtime 给的地址是 `/docs/<grant>/`；服务端在 `index.html` 里注入 `<base href="/docs/<grant>/">` 与启动信息 `window.__BAOCUT_DOCS__ = {projectId, canEdit}`。shim（`packages/docs/src/editor/`）设好接口与 WebSocket 的基址（原应用的 `__BONGO_BASE__` / `__BONGO_WS_BASE__` = `/docs/<grant>`），再用 `history.replaceState` 把地址换成应用认的 `/docs/<grant>/project/<文档 id>`（查询串照留）；编辑器的相对地址（字体、样式、拼写词表、运行时）都落在 grant 下。
- 编辑器的改动经 mux 的 door 调用即时发出；`editor:flush` 时 shim 稍等停笔，再等在途的 door 调用都有了 `doorack`，回 `editor:flushed`。
- `globalThis.docsHost.comments`：评论的「发送给智能体」与空行上的请求经它发给父窗口（`editor:annotate`，第 8 节）；父窗口回 `editor:annotate-result`。标签（标签页名 › 原文）与原文由 shim 向 `api/baocut/annotation?path=` 查；页面不在 BaoCut 的 iframe 里时 `canSendToClaude()` 为 `no_session`。
- `globalThis.docsHost.chat`（只在 BaoCut 的 iframe 里装）：编辑器左下角的「Ask Agent」点了发 `editor:focus-chat`，功能区让这个会话露出来（单条标签条里选中会话标签），光标放到它的输入框末尾；标签不属于会话时提示。页面单独打开时没有这个按钮。原版这里打开 claude.ai 的对话栏，BaoCut 不提供。
- 选中文字后工具栏的「Ask Agent」打开这处选区的批注框（开头带着提及智能体的 `@Agent`），之后同第 8 节的评论；批注发不出去（页面单独打开、只读）时提示。
- 与功能区的其他编辑器共用 `editor:ready`、`editor:flush` / `editor:flushed`、`editor:reveal`；文档自己有持久的评论，没有幻灯片那样的标注模式开关。
- 界面里把助手叫「智能体」（Send to agent / Sent to agent / Ask Agent），不叫 Claude；评论里提及智能体写作 `@Agent`（原版是 `@Claude`）。以前的文档里的 `@Claude` 与手打的 `@claude` 照样算发给智能体：编辑器勾上「Send to agent」，没带 `to` 的评论 door 记作发给智能体，交给智能体前去掉开头的提及。智能体改文档时露出的名字（光标旗子、在线头像、播报、新加标签页与改写段落的提示、批注里的署名与等回复的提示）也叫 Agent / the agent；连不上与编辑器更新后的提示只说 Docs。BaoCut 用不到的部分（正文里的行内提问、skill、widget、图表、登录、分享）文案不改。

## 6. Runtime：文档服务与路由

### 6.1 打开

`docs.open`（参数是 `FileTarget`：来源目录与相对路径）：校验目录（不越界、不进隐藏与依赖目录、不经指向别处的符号链接），确认是文档（否则 `invalid-request`，`DOCS_NOT_A_DOC`），拿 grant，返回 `{url, doc: {title, tabCount, openThreads}, editorAvailable}`。网关上的地址是 `http://127.0.0.1:<端口>/docs/<grant>/`，Web 服务里是同源的 `/docs/<grant>/`。

### 6.2 路由

| 路径 | 内容 |
| --- | --- |
| `/docs/<grant>` | 308 到 `/docs/<grant>/`（编辑器用相对地址取样式与脚本） |
| `/docs/<grant>/`、`/docs/<grant>/project/<id>` | 编辑器页面（注入 `<base>`、启动信息与 CSP）；shim 把地址换成 `project/<文档 id>`；没构建时 503 |
| `/docs/<grant>/assets/…`、`artifact-type/…` | 编辑器的构建产物，防路径穿越 |
| `/docs/<grant>/api/…` | 编辑器读写文档、上传与取素材的 HTTP 接口（door 的 HTTP 后备 `POST api/v3/door/<地址>[/batch]`、`POST api/blob`、`GET api/blob/<sha 或素材 id>`、运行时 `api/lfile-runtime/<哈希>`）；上传与写入要同源 |
| `/docs/<grant>/api/baocut/annotation?path=` | 一条批注的说明 `{kind, label, quote?}`（shim 发 `editor:annotate` 前查） |
| `/docs/<grant>/api/mux` | WebSocket：door 调用（二进制帧，标签 `~d:<rid>:<o\|b>:<地址>`，回 `doorack`）与推送（`chat` 的空闲帧、`feed:project/<id>` 的新修订与评论、`room:project/<id>` 的标签栏与下拉选项）；跨源的升级回 404 |

- **网关**：grant 就是凭证，能编辑；桌面界面是 `file://` 页面，不限制嵌入。网关原来只有一个 WebSocket 服务；改成 `noServer`，HTTP 服务的 `upgrade` 先问 `GatewayOptions.upgrade`（文档服务认 `/docs/<grant>/api/mux`），不认的再交给原来的 RPC 服务。
- **Web 服务**：`/docs/` 下的请求与升级都要同源与会话 cookie，并通过 `webAuthorize('docs.open')`；只读会话的编辑器不能写（`canEdit: false`）；页面的 `frame-ancestors 'self'`，只能嵌在 Web 界面里。
- 网关与 Web 服务共用一个 `DocsServer`：同一份文档在两边打开，看到的是同一份内存。

## 7. 智能体

### 7.1 skill `docs`

内置 skill `skills/baocut/built-in-skills/docs/`（只给会话内智能体），由 Claude Docs 连接器的指南（topic.instructions、topic.index、editing、tabs、comments、uploads）改写：先建骨架再逐节填、每节一次 `docs_update`、读写 id 的规矩、guard、chip 与下拉、写作的取舍、评论与请求的处理；参考页 `references/editing.md`（删除、移动、表格、找回、拒绝码）、`tabs.md`、`comments.md`、`uploads.md`。不讲图表与示意图（D4），不讲分享（本机没有）。

### 7.2 工具

| 工具 | 做什么 | 风险 |
| --- | --- | --- |
| `docs_batch` | 新建文档（`container.create`），或一组原子的改动 | 编辑 |
| `docs_create` | 评论与回复、下拉选项、标签页、正文 | 编辑 |
| `docs_read` | 读文档（`files[]`）或正文（大纲、view、search、`sinceRev`、`atRev`） | 读 |
| `docs_update` | 改正文（prose ops）或文档（标签页 patch）；`answering` 指评论线程 | 编辑 |
| `docs_query` | 列评论线程 | 读 |
| `docs_delete` | 删标签页、自己的评论、下拉选项 | 编辑 |
| `docs_upload` | 工作目录里的文件 → 文档的素材（≤ 20 MB），返回 `blob/<id>` | 编辑 |
| `docs_export` | 导出 Markdown：结果里（≤ 10 万字符），或带 `to` 写成工作目录里的 `.md`（不覆盖） | 编辑 |

- 每个工具都带 `doc`：文档目录，相对会话工作目录，在会话的来源目录里（不是来源目录本身，不进隐藏与依赖目录，不经过指向外面的符号链接，否则 `PATH_OUTSIDE_WORKSPACE`）。新建时目录不存在或是空的；缺的父目录与文档目录在用户确认之后才建，拒绝时什么也不留下。其余参数照搬连接器，`container` / `ref` 里的文档 id 必须是这份文档自己的（否则 `absent`）。
- 拒绝码原样作为工具错误的 code（`guard_mismatch`、`find_none`……），`message` 与 `details` 说明怎么修；`doc` 本身的问题是 `DOC_NOT_FOUND`、`NOT_A_DOC`、`DOC_EXISTS`、`DOC_PATH_TAKEN`。
- 智能体写入的作者是 `{id: 'claude', name: <智能体名>}`，评论的 `query` 结果里带这个名字。编辑器不按 principal 认智能体：发给编辑器的评论与回复，智能体写的带 `via: "mcp"`（原版智能体经 MCP 写入的标记），编辑器据此把作者显示为「Agent」并配智能体头像；本机用户写的 `via` 为 null，按邮箱形式的 principal 显示。
- 只在工具桥面（`surfaces: ['agent']`），同幻灯片与设计稿；写入按访问模式向用户确认。

### 7.3 线程卡片与 Space

- 新建成功后时间线记一条 `docs-created`（`target`、`title`、`tabCount`），线程里显示文档卡片，点开功能区的文档标签；之后的写入只刷新已有的卡片（标题、标签页数），不另起一张。
- Space 与项目文件列表把文档目录当成一个 `docs` 条目（名称取标题，另有标签页数），不列出里面的文件；导入 Space 时文档目录不支持（`docsDirFile`）。

## 8. 评论与请求发给智能体

1. 用户在编辑器里对一条评论点「发送给智能体」（`comment`），或在空行上写一句给智能体的请求（`ask`）。选中文字后工具栏的「Ask Agent」打开的批注框默认发送给智能体（第 5 节）。
2. shim 发 `editor:annotate { requestId, kind, path, label, quote?, text }`；`path` 是元素路径 `f-<标签页 id>#<正文 id>/<块 id>…`，评论另带 `;thread=<线程第一条的 id>`。
3. 功能区把它变成一条 `DocsAnnotation`（`doc` 是这个标签的 `FileTarget`）挂到这个会话的草稿上，回 `editor:annotate-result { ok }`（标签不属于会话、草稿已满时 `ok: false`）。上限同幻灯片：一条消息 20 条，每条 4096 字。
4. `conversations.send` / `steer` 带 `docsAnnotations`；Runtime 把文档解析成相对工作目录的路径，Harness 在消息末尾拼一段：

```
<baocut-docs-annotations doc="q3-launch-plan/">
1. 评论 · Q3 launch plan › "500 weekly active teams"
   位置：f-afc001d0-ce07#be1476b2-62c1/mq2x81a0kfd.16;thread=u-3f2a9c1e
   原文：500 weekly active teams
   评论：改成 750
   回复：在线程 u-3f2a9c1e 里回复（docs_create utterance，parent 是这个 id）
2. 请求 · Q3 launch plan › 空行
   位置：f-afc001d0-ce07#be1476b2-62c1/mq2x81a0kfd.40
   请求：这里补一张风险表
   写到：正文 be1476b2-62c1 的块 mq2x81a0kfd.40（还空着就替换它，否则写在它后面）
</baocut-docs-annotations>
```

5. 会话里的用户消息另存一份 `docsAnnotations`，显示成标注标记；点标记发 `editor:reveal` 滚到那个线程或块。
6. 智能体按 skill 处理：改文档时 `answering` 指那个线程，然后在线程里回复；请求写在指定的块。

## 9. 界面

- 功能区的「协作文档」标签：在 `editor-pane` 上加载编辑器页面（Web 同源），`?lang=` 跟界面语言；编辑器没构建时显示说明。发送消息前先让开着的编辑器 flush。
- 输入框上的文档标注标记区分评论与请求；已发送消息里显示同样的标记。
- 线程里的文档卡片、Space 的 `docs` 条目、智能体工具步骤的标签，全部 15 种界面语言。
- 原型 `designs/baocut/` 先做了同样的界面（文档标签的静态画面、评论线程的「发送给智能体」、卡片与 Space 条目）。

## 10. 要修订的规范与文档

- 产品设计：会话里的文档（创建、功能区标签、评论发给智能体）；§6.9 skill 来源加「文档」。
- 架构设计：§3.5 工具目录、工作目录里的文档目录、§4.6 发送前同步、§4.8 Web 服务与网关的新路由（含 WebSocket 升级的分派）、§5.7 Space 条目类型。
- 命令与协议规范：`docs.open`、`conversations.send` / `steer` 的 `docsAnnotations`、时间线条目 `docs-created`。
- 验收与测试：文档的验收条目。
- 词汇表：协作文档、协作文档标注。
- 打包：`docs-editor/` 资源、`BAOCUT_DOCS_EDITOR_DIST`、Windows 打包工作流、第三方许可。

## 11. 验证

| 层 | 内容 |
| --- | --- |
| `packages/docs` | 存储、prose ops、XML、json-patch、door、mux、连接器（拒绝码、回执、`$lid`、guard、chip、表格、标签页、评论） |
| Runtime | `docs.open`、网关与 Web 服务的路由与升级（同源、cookie、只读）、`docs_*` 工具（路径校验、确认、卡片）、Space 与项目文件 |
| Harness | 标注的拼法与顺序、`docs-created` 的记录与刷新 |
| 界面 | 文档标签、草稿标注、卡片与 Space、15 种语言 |
| 端到端 | 开发态在浏览器里：智能体新建文档 → 卡片 → 打开编辑器 → 改字、评论 → 发给智能体 → 智能体在线程里回复、文档即时更新 |

## 12. 风险

- **运行时的维护**：还原的前端很大，出了问题要对照 `originals/` 里的原始 bundle 排查；BaoCut 的改动集中在 `BaoCut:` 注释处。
- **协议漂移**：door 与连接器是按 Claude Docs 的行为重写的，不是原来的服务端代码；编辑器发出的新 op 或新字段要在 `packages/docs` 补上，否则编辑器里会报保存失败。
- **图标与字体**：编辑器界面的图标与字体随包分发，不是仓库约定的 S2 图标（[仓库约定 §4](../../repo-conventions.md#4-界面图标)）。
- **体积**：编辑器 bundle 只在打开文档标签时加载，不进主界面的包。功能区里只有显示过的文档标签载入编辑器：重新加载页面后，开着的文档标签只有当前那个启动编辑器，其余的第一次切过去时才启动（[幻灯片设计 §8.1](../slides/slides-design.md#81-功能区的幻灯片标签)）。显示过的标签切走后仍挂着，一次会话里切过的文档多，内存跟着涨。
