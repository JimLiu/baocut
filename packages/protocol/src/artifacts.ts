import type { Id } from './domain.ts';

/**
 * Open Artifact 作品（docs/design/artifacts）：幻灯片、设计稿、设计系统、文档、表格、白板、数据看板、动画。
 *
 * 作品本身由 Open Artifact 的 daemon 管（本机一个，`~/.agents/open-artifact`），Runtime 是它的一个适配器（harness `baocut`）：
 * 给会话里的智能体 `Artifact`、`ArtifactData`、`ArtifactComments` 三个工具，把页面上发给智能体的评论与请求交给拥有作品的会话，
 * 把作品页面（Shell）的一次性地址交给界面。页面与宿主之间的消息（`shell_hello`、`goto`、`new_session`……）经 Runtime 转发：
 * 界面用 `artifacts.shellCommand` 发，Shell 说的经 `artifacts` 主题的 `artifacts.shell` 事件回来。
 */

/** 作品链接的写法：`open-artifact://artifact/<id>`。 */
export const ARTIFACT_URL_PATTERN = /^open-artifact:\/\/artifact\/[A-Za-z0-9_-]{1,128}$/;

export const ARTIFACT_LIMITS = {
  url: 200,
  view: 200,
  /** 一条 Shell 命令序列化后的上限（字节）：`host_hello`、`goto` 都很小。 */
  commandBytes: 16 * 1024,
} as const;

/** 打开一份作品的结果：界面在作品标签里用 iframe 载入 `embedUrl`，之后与 Shell 的消息都按 `view` 转发。 */
export interface ArtifactOpenResult {
  url: string;
  title: string;
  /** 作品类型（`slides`、`docs`……）；daemon 没说时为空串。 */
  type: string;
  /** Shell 页面的地址（`http://127.0.0.1:<port>/a/<id>`），给「在浏览器打开」用。 */
  viewUrl: string;
  /** iframe 载入的地址：`viewUrl` 带一次性的视图票据。 */
  embedUrl: string;
  /** 视图票据：`artifacts.shellCommand` 与 `artifacts.shell` 事件按它对应到这一个视图。 */
  view: string;
}

/** `artifacts` 主题的快照：daemon 连上没有，没连上时为什么。 */
export interface ArtifactsSnapshot {
  available: boolean;
  /** 连不上的原因（给人看的英文短句，来自 Open Artifact）；连上了或还在连时为 null。 */
  error: string | null;
}

export type ArtifactsEvent =
  | { type: 'artifacts.state'; available: boolean; error: string | null }
  /** 智能体要给用户看一份作品（`Artifact` 的 `open`，或新建后 daemon 要打开它）：界面在作品标签里打开。 */
  | { type: 'artifacts.show'; conversationId: Id | null; open: ArtifactOpenResult }
  /** Shell 发给宿主的一条消息（`shell_ready`、`new_session`、`open_session`、`place`、`close`……），原样转来。 */
  | { type: 'artifacts.shell'; view: string; message: unknown };
