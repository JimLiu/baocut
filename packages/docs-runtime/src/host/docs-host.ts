/**
 * BaoCut: 文档编辑器的宿主接口（globalThis.docsHost），BaoCut 加的文件。
 *
 * 原应用只在嵌进 claude.ai 的 Frame 里经 window.claude 把批注交给 Claude；BaoCut 的页面不是 Frame，整个应用有上百处按
 * isFrameArtifact() 切到 Frame 的 postMessage 通道，不能伪装成 Frame。这里只给「批注发给智能体」这一条路一个宿主：
 * 宿主在应用模块求值前装上 globalThis.docsHost.comments，批注相关的几处 Frame 条件改读 commentSummonHost()。
 * 读取点（都带 BaoCut: 注释）：platform-core.tsx 的 resolveObservabilityBrowserAndOperationEventsClaude7、
 * frameSendToClaudeVerdict / frameSendCommentToClaude 的成员判断、frameRegisterCustomAnchors；docs-app.tsx 的
 * useCommentSessionBridge、SummonNote、knownBlocksRef / summonHostRef、批注框的 offered / framed。
 * 另有 docsHost.chat：左下角的「Ask Agent」原版打开 claude.ai 的对话栏，独立页面里只出一块空白浮层；宿主装了 chat 时点了
 * 交给宿主（BaoCut 把焦点交给会话的输入框），没装时不显示（docs-app.tsx 的 ChatPill）。选中文字后工具栏的「Ask Agent」
 * 不经 chat：装了 comments 时打开批注框（docs-app.tsx 的 ask-claude）。
 * 空行上 @Agent 的行内提问不经这里：它要先让模型判断请求（sample）再决定由 Claude 直接写还是转成批注，独立页面不提供
 * （packages/docs-runtime/README.md「不提供」）。
 * 版本历史也不经 docsHost：它要的是文档服务的接口，BaoCut 的文档服务提供（versionHistoryOffered()）。项目菜单的
 * 「Data sources」「Duplicate」与「Send feedback」要的东西 BaoCut 没有，独立页面不显示（dataSourcesOffered()、
 * projectDuplicateOffered()、feedbackOffered()），顶栏回首页的 Home 按钮也是（homeOffered()）。
 */
import { isFrameArtifact } from "../boot/environment";

/** canSendToClaude() 的取值，与原平台 comments 能力相同；其他取值按 `unknown` 处理（不提供发送）。 */
export type DocsHostSendVerdict =
  | "available"
  | "no_session"
  | "writers_only"
  | "off";

/**
 * 批注在文档里的位置。path 形如 `f-<标签页 id>#<正文节点 id>/<块 id>@<起>-<止>;thread=<批注 id>`（≤128 字节），
 * 例如 `f-1efb2162-7a7f#aa5cbff5-8b65/m5j4zwj66w6.247@0-6;thread=147981c5-8ddb`：起止是批注挂着的文字在块里的字符偏移，
 * thread 是刚存进文档的那条批注。x / y 是批注在编辑器视口里的相对位置（0–1）。
 */
export interface DocsHostCommentAnchor {
  path: string;
  x: number;
  y: number;
}

export interface DocsHostComments {
  canSendToClaude(): Promise<DocsHostSendVerdict>;
  /**
   * 批注先经文档服务存进文档（door 的 create utterance 返回线程 id），之后才调这里。text 是批注正文去掉控制字符与格式字符
   * （包括 @Agent 后面的 U+2060）后的文字，≤4096 字节；开头的 `@Agent ` 保留，例如 `@Agent please tighten this`
   * （以前的文档里是 `@Claude`）。
   * 成功时返回非空的 threadId。失败时 reject：错误对象的 code 是 unavailable、claude_unavailable、forbidden、not_found、
   * rate_limited 等原平台的错误码之一时按它显示，其余一律按 upstream_error。
   */
  sendToClaude(request: {
    anchor: DocsHostCommentAnchor;
    text: string;
  }): Promise<{ threadId: string }>;
}

/** 左下角「Ask Agent」交给宿主的对话：BaoCut 把焦点交给这个标签页所属会话的输入框。 */
export interface DocsHostChat {
  focus(): void;
}

export interface DocsHost {
  comments?: DocsHostComments;
  chat?: DocsHostChat;
  /** 文档服务给的是只读的入口（页面注入的 `__BAOCUT_DOCS__.canEdit` 为 false）：不开版本历史（versionHistoryOffered()）。 */
  readOnly?: boolean;
}

declare global {
  var docsHost: DocsHost | undefined;
}

/** 独立页面（不在 Frame 里）且宿主装了 docsHost.comments 时返回宿主，否则返回 null。 */
export function standaloneDocsHost(): DocsHost | null {
  if (isFrameArtifact()) return null;
  const host = globalThis.docsHost;
  return typeof host?.comments === "object" && host.comments !== null
    ? host
    : null;
}

/** 独立页面（不在 Frame 里）且宿主装了 docsHost.chat 时返回它，否则返回 null。 */
export function standaloneDocsChat(): DocsHostChat | null {
  if (isFrameArtifact()) return null;
  const chat = globalThis.docsHost?.chat;
  return typeof chat === "object" && chat !== null ? chat : null;
}

/** 批注能交给智能体的环境：原来的 Frame，或装了 docsHost.comments 的独立页面。 */
export function commentSummonHost(): boolean {
  return isFrameArtifact() || standaloneDocsHost() !== null;
}

/**
 * 版本历史（顶栏的 History 按钮、项目菜单的「Version history」、版本面板与版本预览）：Frame 里照原样开，BaoCut 的独立页面
 * 也开（版本记录设计 §13.2）。面板向文档服务取 `api/v3/project/<文档>/file/<标签页>/history`（每个版本一行，`upto` 是版本号）、
 * `at/<upto>`（那一版的正文，编辑器读的 XML）、`restore/<upto>`，由 packages/docs 的 server.ts 与 versions.ts 提供。
 * 只读的入口不开：宿主标了 `docsHost.readOnly`（文档服务按 canEdit 注入，见 packages/docs 的 editor/install.ts）；只读的看法
 * 由 door 告诉编辑器，原版读取点判断的 viewerReadOnly（`access` 接口回 404）在这里不成立。读取点（都带 BaoCut: 注释）：docs-app.tsx 的 FilmedProsePage 的 historyRoad
 * （面板与版本预览）、RoomViewEmbedPage 顶栏的 HistoryRailToggle 与 ?chrome=embed 布局给 HeaderPath 的 historyOffered
 * （项目菜单的「Version history」）。
 */
export function versionHistoryOffered(): boolean {
  return isFrameArtifact() || globalThis.docsHost?.readOnly !== true;
}

/**
 * 项目菜单的「Data sources」（Routines 与 Databases 两栏的对话框）只在 Frame 里照原样开，独立页面不开。BaoCut 的文档没有
 * 定时任务与数据库，文档服务对 `api/v3/project/<id>/routines`、`databases` 只回空列表；对话框里只剩「No routines yet. Define
 * one in chat.」「No databases yet. Ask in chat to create one.」两句做不到的提示（以前 databases 还回 404，显示
 * 「databases read failed (404)」）。读取点：application/routes-routines-dialog.tsx 的 HeaderPath（带 BaoCut: 注释）。
 */
export function dataSourcesOffered(): boolean {
  return isFrameArtifact();
}

/**
 * 项目菜单的「Duplicate」只在 Frame 里照原样开，独立页面不开。原版向 `api/v3/project/<id>/duplicate` 要一份新项目，成功后在
 * 同一个页面跳到 `project/<新 id>`；BaoCut 的文档是一个目录，grant 按目录发，`api/v3/project/<id>/…` 只认这份文档，复制出的
 * 副本既没有地方放，也打不开。文档服务不提供这个接口，以前点了只提示 `not_found`。
 * 读取点：application/routes-routines-dialog.tsx 的 HeaderPath（带 BaoCut: 注释）。
 */
export function projectDuplicateOffered(): boolean {
  return isFrameArtifact();
}

/**
 * 项目菜单的「Send feedback」只在 Frame 里照原样开，独立页面不开。原版打开一个带文本框的表单，点 Send 向
 * `<前缀>/api/feedback` 发 POST，由原平台转到反馈频道；BaoCut 的文档服务（packages/docs/src/server.ts）没有这个接口，回 404，
 * 对话框只显示错误，反馈也没有地方收。同一菜单的「Copy support code」只把页面自己生成的支持码复制到剪贴板，不调接口，照原样保留。
 * 读取点：application/routes-routines-dialog.tsx 的 HeaderPath（带 BaoCut: 注释）。
 */
export function feedbackOffered(): boolean {
  return isFrameArtifact();
}

/**
 * 顶栏左上角回首页的 Home 按钮只在 Frame 里照原样开，独立页面不开。原版点了在同一个页面跳到 `/`，那里是原平台的项目列表；
 * BaoCut 的 grant 只对应一份文档，没有项目列表，`/docs/<grant>/` 落到应用路由表里的 Home（platform/lazy.tsx 的
 * UnavailablePage），只显示「This page doesn't open here」，回不到文档。不改成「回到当前文档」：已经在这份文档里，按了
 * 没有变化的按钮比不显示更让人困惑。按钮只出现在独立布局的标签托盘里（`?chrome=embed` 的顶栏与 Frame 本来就没有它），
 * 这个开关与其他几个保持同一写法、可单独测试。读取点：embed/view.tsx 的 FileTabNavigation 的 tray.leading（带 BaoCut: 注释）。
 */
export function homeOffered(): boolean {
  return isFrameArtifact();
}

/**
 * 独立页面没有宿主一侧的批注锚点（Frame 里由 claude.ai 的批注层提供）。应用只检查这三个方法存在、在卸载时调 release()，
 * 不调 compose / placed，所以给一个空实现，让「发给智能体」照 Frame 的流程走。
 */
export const standaloneCommentAnchors = {
  compose(): void {},
  placed(): void {},
  release(): void {},
};
