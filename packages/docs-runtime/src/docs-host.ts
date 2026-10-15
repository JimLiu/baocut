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
 */
import { isFrameArtifact } from "./hello-early";

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
 * 独立页面没有宿主一侧的批注锚点（Frame 里由 claude.ai 的批注层提供）。应用只检查这三个方法存在、在卸载时调 release()，
 * 不调 compose / placed，所以给一个空实现，让「发给智能体」照 Frame 的流程走。
 */
export const standaloneCommentAnchors = {
  compose(): void {},
  placed(): void {},
  release(): void {},
};
