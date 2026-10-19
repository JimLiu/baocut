/**
 * door 调用的请求 / 应答形状（与原版 platform-core 的校验一致）。door 是原版应用读写文档的统一入口，
 * 与 Claude Docs 连接器同一套 verb：read / update / create / delete / query，对象是 project / file / node /
 * utterance / session / enum / blob。
 */

export type DoorObjectKind = 'project' | 'file' | 'node' | 'utterance' | 'session' | 'enum' | 'blob';

export interface DoorRef {
  object: DoorObjectKind | (string & {});
  id: string;
}

export interface DoorContainer {
  kind: 'project';
  id: string;
}

export interface DoorRequest {
  verb: 'read' | 'update' | 'create' | 'delete' | 'query' | (string & {});
  ref?: DoorRef;
  object?: DoorObjectKind | (string & {});
  container?: DoorContainer;
  engine?: string;
  opId?: string;
  /** 回复某个评论线程时的线程 id（智能体用；本地只记录，不做校验）。 */
  answering?: string;
  payload?: Record<string, unknown>;
  /** batch 成员的别名：后面的成员用 `$lid:<别名>` 引用它创建出的 id。 */
  $lid?: string;
}

export interface DoorAllow {
  verdict: 'allow';
  diff?: unknown[];
  rev?: number;
  minted?: string;
  id?: string;
  sess?: string;
  sessSecret?: string;
  changed?: boolean;
  noop?: boolean;
  data?: unknown;
  value?: unknown;
}

export interface DoorDeny {
  verdict: 'deny';
  reason: string;
  detail?: string;
  data?: unknown;
}

export type DoorVerdict = DoorAllow | DoorDeny;

/** batch 的应答：全部通过时逐个成员的应答与别名表；任一被拒时整批不生效，报出被拒成员的下标。 */
export type DoorBatchVerdict =
  | { verdict: 'allow'; acks: DoorAllow[]; lids: Record<string, string> }
  | (DoorDeny & { index: number });

export function allow(fields: Omit<DoorAllow, 'verdict'> = {}): DoorAllow {
  return { verdict: 'allow', diff: [], ...fields };
}

export function deny(reason: string, detail?: string, data?: unknown): DoorDeny {
  return { verdict: 'deny', reason, ...(detail ? { detail } : {}), ...(data === undefined ? {} : { data }) };
}

/**
 * 发给编辑器宿主的评论记录（宿主读 `at` 取锚点，读 `by` 取作者）。`via` 不空时编辑器把这一条当成智能体写的（作者名显示为智能体，
 * 不按 `by` 找人）；原版智能体经 MCP 写的评论带 `via: "mcp"`，这里照用。
 */
export interface WireComment {
  id: string;
  resolved: boolean;
  by: string;
  byName: string;
  via: typeof AGENT_VIA | null;
  created: string;
  edited?: string;
  body: string;
  at?: { kind: 'chars'; range: [string, string]; state: 'attached' | 'detached'; quote?: string };
  replies: { id: string; by: string; byName: string; via?: typeof AGENT_VIA; created: string; edited?: string; body: string }[];
  reactions: { emoji: string; by: string }[];
}

/** 智能体写的评论与回复在 wire 上的 `via`。 */
export const AGENT_VIA = 'mcp';

/** 谁在调用 door：本机用户（编辑器页面）或智能体（principal `claude`）。 */
export interface DoorActor {
  /** 身份：本机用户是邮箱形式的 principal，智能体是 `claude`。 */
  principal: string;
  /** 显示名。 */
  name: string;
  /** `human`：编辑器页面里的人；`agent`：智能体。 */
  channel: 'human' | 'agent';
  /** 智能体所在的会话与回合（任务）：版本按回合分开（版本记录设计 §13.2）。 */
  conversation?: string;
  turn?: string;
}

/** 智能体的身份。编辑器不按 principal 认智能体：评论看 `via`（AGENT_VIA），正文改动的信封看 `channel`。 */
export const CLAUDE_ACTOR: DoorActor = { principal: 'claude', name: 'Claude', channel: 'agent' };
