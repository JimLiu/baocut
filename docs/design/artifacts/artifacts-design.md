# 作品：接入 Open Artifact

幻灯片、文档、设计稿、设计系统、表格、白板、数据看板这类给人看、可以评论与协作的成品，BaoCut 不自己实现，交给 [Open Artifact](https://github.com/JimLiu/open-artifact) 做成「作品」。BaoCut 的 Runtime 是 Open Artifact daemon 的一个适配器（harness `baocut`）：把三个作品工具给会话里的智能体，把页面上的评论交回拥有作品的会话，把作品页面放进功能区的标签。

## 目录

1. 范围
2. 运行时
3. 工具与审批
4. 回执与唤醒
5. 打开与作品标签
6. skill 与 `/artifacts` 命令
7. 旧数据
8. 已知限制

## 1. 范围

- 作品的格式、编辑器、存储、版本与评论都在 Open Artifact 里，以它的文档为准；本文只写 BaoCut 这一侧怎么接。
- 作品属于会话：Open Artifact 的 session 就是 BaoCut 的会话 id，workspace 是会话的工作目录。
- 作品不是 Space 条目，也不进视频的版本记录。工作目录里旧的 deck、设计稿、文档目录只是普通文件夹。
- 只给会话里的智能体：BaoCut 的 MCP 服务与 CLI 不带作品工具，外部 Agent 直接用 Open Artifact 自己的 CLI 与 MCP。

## 2. 运行时

- **一台机器一个 daemon**。daemon 的 home 是 `~/.agents/open-artifact`（`OPEN_ARTIFACT_HOME` 可改），别的应用也连它；BaoCut 退出时不停它。
- **什么时候连**：Runtime 启动后，本机已经有 daemon 在跑就在后台连上，页面上的评论能马上回到会话；没有在跑时等第一次用到（工具调用、打开作品）才连，连不上就用随应用带的运行时起一个。
- **随应用带的运行时**：`@open-artifact/cli` 的包目录（`scripts/open-artifact.mjs` 与 `vendor/`），不需要别的 npm 依赖。依次找 `BAOCUT_OPEN_ARTIFACT_DIR`（桌面端主进程传入，打包后是 `<resources>/open-artifact`）、Electron 的资源目录、`node_modules/@open-artifact/cli`；都没有时由 harness-kit 找本机登记过的运行时。
- **连接状态**走 `artifacts` 主题：快照 `{ available, error }`，变化时 `artifacts.state`。`error` 是 Open Artifact 给的英文短句。
- 连上或重连后，Runtime 取一次 daemon 的工具定义（§3），按 daemon 重新渲染 skill（§6）。

## 3. 工具与审批

- 三个工具 `Artifact`、`ArtifactData`、`ArtifactComments`，名字、说明与参数的 JSON Schema 原样用 Open Artifact 的。参数的细查在 daemon，BaoCut 只要求是个带 `action` 的对象。
- 调用时以会话的身份交给 daemon：第一次以某个会话调用时 attach（session、workspace、会话标题与当前是否在跑），之后回合起止报 `running` / `idle`。
- **风险按动作分**，动作的种类来自工具定义的 `actions`：
  - `read`（读、列、选类型）与 `ui`（打开页面）：读，不审批。
  - `write`（发布、调用）：编辑，按会话的访问模式。
  - `remove`（删除、交出所有权）与 `person`（分享给人）：高风险，每次都问。
  - 装了远程类型时，daemon 的工具定义标 `annotations.openWorldHint`，这时 `remoteActions` 里的动作会把数据发出本机，也算高风险；没装时 `remoteActions` 不算数。
  - 定义里没有的动作按编辑处理，daemon 再拒绝不认识的。
- daemon 报的错误原样成为工具错误（`code`、`message`、`fix`、`next`）。连不上时是 `ARTIFACTS_UNAVAILABLE`。

## 4. 回执与唤醒

- **作品回执**：daemon 报告某份作品新建或改动（`artifacts/changed`），且作品的所有者是 BaoCut 的某个会话时，那条会话的时间线上记一条 `artifact`（`url`、`title`、`type`、`taskId`）。同一份作品只有一条，之后改了标题、类型或换了任务时原地更新。删掉的作品与不属于现存会话的不记。界面把它画成产物卡，同一份作品的几次回执合成一张。
- **唤醒**：用户在作品页面上把评论或请求发给智能体时，daemon 经 `wake` 交给拥有作品的会话：
  - 所有者本人发的，以及系统发的（后台动作结束）：按 `relay` 交给会话（`direction: 'artifact'`，显示 daemon 给的摘要，交给智能体的是完整的请求），没在跑时起一个新回合，在跑时插进当前回合或等它结束一起带进去。
  - 协作者发的不起回合，留在 Open Artifact 的收件箱，智能体下次用 `ArtifactComments` 读到。
  - 会话不存在时回答 `failed`，daemon 自己保留。

## 5. 打开与作品标签

- 作品在功能区的**作品标签**里打开：标签里是一个 iframe，载入 Shell 页面带一次性视图票据的地址（`embedUrl`）。标签按作品链接 `open-artifact://artifact/<id>` 区分，地址会随 daemon 的端口变，所以不存。
- **用户点开**（产物卡、标签恢复）：界面调 `artifacts.open { url, conversationId? }`。Runtime 请 daemon 开一个视图，等它回调 `open`（最多 10 秒）；等不到时退回普通页面地址，页面照样能看，只是没有宿主桥。
- **智能体打开**（`Artifact` 的 `open`，或新建后 daemon 要打开）：daemon 回调 `open`，Runtime 发 `artifacts.show`，正在看那条会话的界面在作品标签里打开；没有界面在看时回答没打开，daemon 按自己的设置处理。
- **宿主桥**：页面与宿主之间的消息经 Runtime 转发（Open Artifact 的 view 模式），不靠 iframe 的来源。界面发的（`host_hello`、`goto`）用 `artifacts.shellCommand { view, command }`，页面说的经 `artifacts.shell` 事件回来。界面用 `@open-artifact/harness-kit/embed` 完成握手、明暗主题，以及：
  - 「打开会话」：切到那条会话。
  - 「新会话」：页面上写的话放进新会话的输入框，由用户自己发。
  - 外部链接：桌面端交给系统浏览器（只收 http/https），浏览器里开新窗口。
- daemon 重新连上而标签之前打开失败时自动重试一次；Runtime 重启或 daemon 换了端口后点「重试」重新打开。

## 6. skill 与 `/artifacts` 命令

- Runtime 把 Open Artifact 的 skill 写进 skill 的集成目录，id 是 `artifacts`：连上时用 daemon 按 harness `baocut` 渲染的，没连上时用 harness-kit 自带的；按界面语言渲染，语言变了重写。界面名称与介绍另写一份 `SKILL_META_FILE`，每种出货语言一份。内容变了才重建会话的 skill 索引。
- 输入框的斜杠菜单里有 `/artifacts`（「做一份作品」）。选上后消息以 `/artifacts ` 开头；Runtime 发送时认出开头的 `/artifacts`（后面是空白或结束，不分大小写），给这条消息点选 `artifacts` skill，和在输入框里点选它一样。界面、CLI 与 Bot 发来的都认；正文原样留着，智能体看得到命令后面写的要求。skill 还没写好时不点选，消息照常发。
- BaoCut 的说明书（`skills/baocut`）只写什么时候交给作品、工具名与连不上时怎么说，做法以 `artifacts` skill 为准。

## 7. 旧数据

- 原来内置的幻灯片、设计稿、设计系统与协作文档（`slides_*`、`design_*`、`design_system_*`、`docs_*` 工具与各自的编辑器）已经移除。
- 时间线上旧的 `slides-created`、`design-created`、`design-system-created`、`docs-created` 回执不再读；旧消息上的幻灯片、设计稿、设计系统与文档标注字段不再显示，排队中的旧消息发出前去掉这些字段。
- 工作目录里旧的 deck、设计稿与文档目录不迁移，在文件面板里是普通文件。

## 8. 已知限制

- Shell 页面的地址是 daemon 在本机回环地址上的端口。远程的 Web 客户端（别的设备上的浏览器）打不开作品标签，只能在运行 BaoCut 的那台电脑上看。
- 作品不随便携包导出。会话分叉后，作品的所有者仍是原会话，页面上发给智能体的评论回到原会话。
