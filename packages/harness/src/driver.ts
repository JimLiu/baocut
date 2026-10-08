import type {
  AgentErrorCode,
  AgentMode,
  ApprovalDecision,
  ApprovalRequest,
  DriverId,
  DriverProbe,
  Id,
  MessageRef,
  ToolCallKind,
  ToolCallStatus,
} from '@baocut/protocol';

/**
 * Driver ABI（架构设计 §3.1）。
 *
 * `AgentDriver` 连接一个完整的智能体运行时，经它的机器协议，不解析终端屏幕。
 * 这里的类型不带任何具体引擎的概念：Codex 的 thread / item 在 Driver 内部翻译成下面的事件。
 */
export interface AgentDriver {
  readonly id: DriverId;
  /**
   * false：这个 Driver 还没有通过集成测试（架构设计 §3.11 的 D08），只显示探测结果，Harness 不让它开始会话。
   * 不给按 true。探测结果的 `verified` 与它一致。
   */
  readonly verified?: boolean;
  /**
   * 这一家在 BaoCut 里真机跑通过完整会话（Claude、Codex、OpenCode 为 true）。同一协议的共享实现在一家验证通过即算 `verified`，
   * 其余预设与用户添加的智能体 `tested` 为 false：能开会话，界面提示「未在 BaoCut 实测」（§3.11 的 D08）。
   * 不给按 `verified` 处理。探测结果的 `tested` 与它一致。
   */
  readonly tested?: boolean;
  /**
   * true：探测要拉起智能体进程（ACP 的智能体冷启动可达十几秒），而不只是 `--version` 一类的快命令。`agents.list` 不等它的
   * 首次探测，「便宜的纠正」也不重探它（架构设计 §3.11）。不给按 false。
   */
  readonly slowProbe?: boolean;
  /**
   * 探测安装、版本、登录状态与模型表，给出能力快照条目（§3.6、§3.11）。不含用户偏好：启用、默认与否由 Harness 合并。
   * 探测不得启动会花钱的模型调用；模型表能在没登录时拿到就照样给（Claude 的 `supportedModels()` 可以）。
   */
  probe(options?: ProbeOptions): Promise<DriverProbe>;
  /**
   * Driver 这一版的常量（名字、命令、最低版本、订阅、登录命令、安装方式、`verified`、`tested`、能力），不探测、不起进程。
   * Driver 注册表用它把磁盘缓存里的本机事实（`store/agent-probes.json`，§3.11）补成完整的探测结果：缓存只存本机事实，
   * 不存常量，换了 BaoCut 版本之后常量总是新的，不必给缓存文件记版本、对不上就整份作废。
   * 没有实现它的 Driver（测试里的假 Driver）不读磁盘缓存，每次启动从头探测。
   */
  describe?(): DriverDescription;
  createSession(options: CreateSessionOptions): Promise<AgentSession>;
}

/** `describe()` 给出的常量部分：探测结果去掉本机事实与由 `state` 推出的 `status` / `unavailableReason`。 */
export type DriverDescription = Pick<
  DriverProbe,
  'id' | 'name' | 'command' | 'minVersion' | 'plan' | 'planRef' | 'loginCommand' | 'install' | 'verified' | 'tested' | 'capabilities'
>;

export interface ProbeOptions {
  /** 用户手动指定的可执行文件；null 按 PATH 与常见安装位置找。 */
  executable?: string | null;
  /**
   * 强制：不用 Driver 自己的缓存（Claude 的模型表、Codex 与 ACP 的模型目录与登录状态），真的再查一遍。
   * 「重新检测」（`agents.detect`）、安装结束与运行中出错后的纠正用它；启动时的后台刷新不用。
   */
  force?: boolean;
}

/**
 * 每一轮的设置（架构设计 §3.11、§3.12）。会话上的模型、强度、访问模式改了，下一轮按新的跑，不重开原生会话：
 * Codex 在 `turn/start` 上带 approvalPolicy / sandboxPolicy / model / effort；Claude 用 `setPermissionMode`、`setModel`，
 * 强度变了由 Driver 自己带着恢复句柄重启 Query。
 *
 * 访问模式到原生策略的映射（两边取更严的）。原生侧来问的动作由 Harness 按风险等级与模式查表（`decideApproval`）：
 *
 * | 模式 | Claude permissionMode | Codex approvalPolicy / sandbox |
 * | --- | --- | --- |
 * | plan | plan | untrusted / read-only |
 * | ask | default | untrusted / workspace-write |
 * | autoAcceptEdits | acceptEdits | untrusted / workspace-write，工作目录内的 fileChange 由 Harness 自动答应 |
 * | auto | auto（模型不支持时退回 default） | on-request / workspace-write，越出沙箱来问时算 `high` |
 * | fullAccess | bypassPermissions | never / workspace-write（隔离不放开） |
 *
 * Codex 在 `untrusted` 下 apply_patch 会发 fileChange 审批（依 codex 源码 main@4642370542 推断，未实测：`core/src/safety.rs` 的 `assess_patch_safety` 在 UnlessTrusted 下一律 AskUser，经 `app-server/src/bespoke_event_handling.rs` 转成 `item/fileChange/requestApproval`），ask 与 autoAcceptEdits 不会塌成一档；答 acceptForSession 后同一路径不再问。
 *
 * BaoCut 自己的 MCP 服务（`baocut`）在原生侧一律放行（Codex `default_tools_approval_mode: 'approve'`，Claude 预批
 * `mcp__baocut__*`）：它的写操作由 Runtime 的 ApprovalService 按访问模式把关，原生侧再拦一次用户就要点两次。
 */
export interface TurnSettings {
  accessMode: AgentMode;
  /** null = 不传，用 Agent 自己的默认。 */
  model: string | null;
  effort: string | null;
}

export interface CreateSessionOptions extends TurnSettings {
  cwd: string;
  /** 用户手动指定的可执行文件。 */
  executable?: string | null;
  /** 上一次 `describePersistence()` 的结果；有则恢复原生会话。 */
  resume: AgentPersistenceHandle | null;
  developerInstructions?: string;
  /** 智能体经 MCP 进入 Runtime 的工具通道（架构设计 §3.5）。新建与恢复都要带上：令牌按原生会话签发。 */
  mcpServers?: Record<string, McpServerSpec>;
  /**
   * 受限的一次性调用（智能体作为 Provider，架构设计 §6.9）：`cwd-write-only` 只允许写工作目录（不含系统临时目录），
   * 命令不联网，从不请求审批（越界的动作直接被拒绝，没有人来批）。给了它时 `accessMode` 不起作用。
   */
  confinement?: 'cwd-write-only';
}

/** 一个 Streamable HTTP 的 MCP 服务。`headers` 里有令牌，不得写进日志。 */
export interface McpServerSpec {
  url: string;
  headers: Record<string, string>;
}

/**
 * Driver 给 MCP 工具调用设的原生超时下限。BaoCut 的工具在 `ask` 这类档位要等用户在卡片上点允许才返回，
 * 原生侧的默认超时（Codex 的 `tool_timeout_sec` 默认 60 秒）一到，工具调用就在 Agent 那边失败了，
 * 而卡片还挂着、随后被「MCP 断开」收掉，用户看不出为什么。和原生审批一样「一直等」，这里取 24 小时。
 * 耗时的工具本来就立即返回 `jobId`（架构设计 §3.5），不靠这个超时。
 */
export const MCP_TOOL_CALL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/**
 * 工具通道的签发方（ToolCatalog 的入口，架构设计 §3.5）。每个原生会话一份授权，会话关闭时收回；
 * 授权只认会话，工具调用的权限在 Runtime 里按会话当前的任务检查。
 */
export interface AgentToolAccess {
  grant(conversationId: Id): ToolGrant;
  /** 入口层的指导（§3.8）：作为开发者指令交给原生会话。 */
  readonly instructions: string;
  /**
   * 每个原生会话开始时另附在 `instructions` 后面的一段（§3.8：开着的 skill 的索引）。空串表示不附；出错时按空串处理，不拦住会话。
   * 只在会话开始时取一次：会话进行中改了也不影响这个原生会话。
   */
  sessionInstructions?(conversationId: Id): Promise<string>;
}

export interface ToolGrant {
  mcpServers: Record<string, McpServerSpec>;
  revoke(): void;
}

/** 原生恢复句柄。Runtime 只保存、不解释。 */
export type AgentPersistenceHandle = { driverId: DriverId; data: unknown };

export interface AgentInput {
  text: string;
  /** 随消息的图片，已经落在本机。Driver 不支持图片（`capabilities.images` 为 false）时 Harness 不会传。 */
  images?: AgentImage[];
}

export interface AgentImage {
  path: string;
  mimeType: string;
}

export interface InterruptReceipt {
  /** `unknown`：原生取消是否生效不确定，调用方不得立即放行替代的回合（§3.1）。 */
  status: 'requested' | 'not-running' | 'unknown';
}

export interface ApprovalResponse {
  /**
   * `cancel`：拒绝并结束本回合，只由停止屏障使用（D04），不对外暴露。
   * `accept-always` 到了 Driver 这里等同 `accept-for-session`：规则由 Harness 存，Driver 不写原生的持久设置。
   */
  decision: ApprovalDecision | 'cancel';
}

export interface AgentSession {
  readonly id: Id;
  readonly capabilities: DriverProbe['capabilities'];
  startTurn(input: AgentInput, settings: TurnSettings): Promise<{ turnId: string }>;
  steer?(turnId: string, input: AgentInput): Promise<'accepted' | 'unavailable'>;
  interrupt(turnId: string): Promise<InterruptReceipt>;
  respondToApproval(approvalId: Id, response: ApprovalResponse): Promise<void>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
  describePersistence(): AgentPersistenceHandle | null;
  close(): Promise<void>;
}

/** 驱动无关的条目。 */
export type AgentItem =
  | { kind: 'agent-message'; id: string; text: string }
  | { kind: 'reasoning'; id: string; text: string }
  | {
      kind: 'tool-call';
      id: string;
      tool: ToolCallKind;
      title: string;
      detail: string | null;
      output: string | null;
      status: ToolCallStatus;
      exitCode: number | null;
      durationMs: number | null;
    }
  | { kind: 'user-message'; id: string; text: string }
  | { kind: 'other'; id: string; label: string };

export type TurnOutcome = 'completed' | 'interrupted' | 'failed';

export type AgentEvent =
  | { type: 'turn.started'; turnId: string }
  | {
      type: 'turn.completed';
      turnId: string;
      outcome: TurnOutcome;
      error: string | null;
      /** `error` 的消息引用（message-ref.ts）：Driver 自己写的原因带上；Agent 的原话没有。 */
      errorRef?: MessageRef;
      errorCode?: AgentErrorCode | null;
    }
  | { type: 'item.started'; turnId: string; item: AgentItem }
  | { type: 'item.completed'; turnId: string; item: AgentItem }
  | {
      type: 'item.delta';
      turnId: string;
      itemId: string;
      channel: 'text' | 'reasoning' | 'output';
      delta: string;
    }
  | {
      type: 'approval.requested';
      turnId: string;
      approvalId: Id;
      request: ApprovalRequest;
      /**
       * 这次请求是要越出沙箱（写工作目录之外、联网等），不是策略要求的逐项确认。Harness 据此把它算作 `high`（§3.12）。
       * Driver 不知道时不给。
       */
      escalation?: boolean;
    }
  /** 原生侧已经结算了这次审批（例如回合被中断），界面上的待批卡片要收起。 */
  | { type: 'approval.resolved'; approvalId: Id }
  | { type: 'session.warning'; message: string; messageRef?: MessageRef }
  | { type: 'session.error'; turnId: string | null; message: string; messageRef?: MessageRef; willRetry: boolean; code?: AgentErrorCode | null }
  /** 智能体进程退出。`error` 为空表示正常关闭。 */
  | { type: 'session.exited'; error: string | null; errorRef?: MessageRef };
