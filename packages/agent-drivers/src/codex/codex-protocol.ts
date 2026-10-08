/**
 * `codex app-server` v2 协议里 BaoCut 用到的子集。
 *
 * 权威定义由 Codex 生成：`codex app-server generate-ts --out <dir>`。本文件对照 codex-cli 0.158.0；
 * `approvalsReviewer`、`model/list`、`turn/steer`、`localImage` 与错误通知里的 `codexErrorInfo` 对照 0.159.0 导出的 schema。
 * 这些都在稳定接口里（不加 `--experimental` 导出的 schema 就有），所以 `initialize` 不必打开 `experimentalApi`。
 * 只抄需要读的字段；未知字段一律忽略，不据此推断状态。
 */

export type AskForApproval = 'untrusted' | 'on-request' | 'never';
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
/** `turn/start` 上覆盖沙箱用的完整形态（0.159.0 `SandboxPolicy`，只抄 BaoCut 会发的三种）。 */
export type SandboxPolicy =
  | { type: 'readOnly'; networkAccess: boolean }
  | { type: 'workspaceWrite'; writableRoots: string[]; networkAccess: boolean; excludeTmpdirEnvVar: boolean; excludeSlashTmp: boolean }
  | { type: 'dangerFullAccess' };
/**
 * 审批请求交给谁审（0.159.0 `ApprovalsReviewer`，缺省 `user`）。`auto_review` 由 Codex 的审核子智能体按风险判断批准与否。
 * schema 里还有 `guardian_subagent`，BaoCut 不用。
 */
export type ApprovalsReviewer = 'user' | 'auto_review';

export interface InitializeParams {
  clientInfo: { name: string; title: string | null; version: string };
  capabilities: { experimentalApi: boolean; requestAttestation: boolean } | null;
}

export interface ThreadStartParams {
  cwd: string;
  approvalPolicy: AskForApproval;
  approvalsReviewer?: ApprovalsReviewer;
  sandbox: SandboxMode;
  model?: string | null;
  developerInstructions?: string | null;
  /** 覆盖 `config.toml` 的键，例如 `mcp_servers`、`sandbox_workspace_write`。 */
  config?: { mcp_servers?: Record<string, CodexMcpServer>; sandbox_workspace_write?: SandboxWorkspaceWrite } | null;
}

/**
 * `config.sandbox_workspace_write`：`workspace-write` 沙箱的细项。默认除工作目录外还可以写 `/tmp` 与 `$TMPDIR`；
 * 两个 `exclude_*` 把它们去掉，`writable_roots` 为空表示不再加别的目录。
 */
export interface SandboxWorkspaceWrite {
  writable_roots: string[];
  network_access: boolean;
  exclude_tmpdir_env_var: boolean;
  exclude_slash_tmp: boolean;
}

/**
 * `config.mcp_servers.<name>` 的 Streamable HTTP 形态。
 * `default_tools_approval_mode: 'approve'`：调用不再经 Codex 询问；权限由 Runtime 按任务检查（架构设计 §3.5）。
 * `tool_timeout_sec`：一次工具调用的上限（Codex 默认 60 秒）；BaoCut 的工具可能在等用户批准，见 `MCP_TOOL_CALL_TIMEOUT_MS`。
 */
export interface CodexMcpServer {
  url: string;
  http_headers: Record<string, string>;
  default_tools_approval_mode: 'auto' | 'prompt' | 'approve';
  /** 一次工具调用最多等多久（秒），Codex 默认 60。 */
  tool_timeout_sec?: number;
}

export interface ThreadResumeParams extends ThreadStartParams {
  threadId: string;
  excludeTurns?: boolean;
}

export interface ThreadStartResponse {
  thread: { id: string };
  model: string;
}

/** 一段用户输入（0.159.0 `UserInput` 的子集）。`localImage` 是本机图片文件的路径，由 Codex 自己读取。 */
export type CodexUserInput = { type: 'text'; text: string; text_elements: [] } | { type: 'localImage'; path: string };

export interface TurnStartParams {
  threadId: string;
  input: CodexUserInput[];
  /** 以下几项覆盖这一轮及之后的回合（访问模式、模型、推理强度随会话设置变）。 */
  approvalPolicy?: AskForApproval;
  approvalsReviewer?: ApprovalsReviewer;
  sandboxPolicy?: SandboxPolicy;
  model?: string | null;
  effort?: string | null;
}

export interface TurnStartResponse {
  turn: CodexTurn;
}

/**
 * `turn/steer`：把输入插进正在跑的回合。`expectedTurnId` 是前置条件：与当前活动回合不符时请求失败
 * （`-32600`，`expected active turn id ... but found ...`；没有活动回合时是 `no active turn to steer`）。
 */
export interface TurnSteerParams {
  threadId: string;
  input: CodexUserInput[];
  expectedTurnId: string;
}

export interface TurnSteerResponse {
  turnId: string;
}

/**
 * 回合错误里的结构化原因（0.159.0 `CodexErrorInfo`）。字符串是单元变体，对象是带 HTTP 状态的变体；
 * 没有「模型不存在」这一项：上游的 404 落在 `other`，只能看原文。
 */
export type CodexErrorInfo =
  | 'contextWindowExceeded'
  | 'sessionBudgetExceeded'
  | 'usageLimitExceeded'
  | 'rateLimitExceeded'
  | 'flexUnavailable'
  | 'serverOverloaded'
  | 'cyberPolicy'
  | 'misalignmentPolicyViolation'
  | 'tooManyDenials'
  | 'internalServerError'
  | 'unauthorized'
  | 'badRequest'
  | 'threadRollbackFailed'
  | 'sandboxError'
  | 'other'
  | { httpConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamDisconnected: { httpStatusCode: number | null } }
  | { responseTooManyFailedAttempts: { httpStatusCode: number | null } }
  | { activeTurnNotSteerable: { turnKind: 'review' | 'compact' } };

export interface CodexTurnError {
  message: string;
  codexErrorInfo?: CodexErrorInfo | null;
  additionalDetails: string | null;
}

/** `error` 通知。`willRetry` 为 true 时 Codex 自己会重试，回合继续；为 false 时紧接着的 `turn/completed` 是 `failed`，带同一个错误。 */
export interface ErrorNotification {
  error: CodexTurnError;
  willRetry: boolean;
  threadId: string;
  turnId: string;
}

export interface CodexTurn {
  id: string;
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  error: CodexTurnError | null;
}

/** `model/list`（0.159.0 `ModelListParams`）。`includeHidden`：连默认选择器里藏起来的模型一起列出。 */
export interface ModelListParams {
  cursor?: string | null;
  limit?: number | null;
  includeHidden?: boolean | null;
}

export interface ModelListResponse {
  data: CodexModel[];
  /** 下一页的游标；null 表示没有更多。 */
  nextCursor: string | null;
}

/** 0.159.0 `Model` 里 BaoCut 读的字段。`id` 与 `model` 在目前的目录里相同，turn/start 的 `model` 用 `id`。 */
export interface CodexModel {
  id: string;
  model?: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
  defaultReasoningEffort: string;
}

type ExecStatus = 'inProgress' | 'completed' | 'failed' | 'declined';

export type CodexThreadItem =
  | { type: 'userMessage'; id: string; content: Array<{ type: string; text?: string }> }
  | { type: 'agentMessage'; id: string; text: string }
  | { type: 'plan'; id: string; text: string }
  | { type: 'reasoning'; id: string; summary: string[]; content: string[] }
  | {
      type: 'commandExecution';
      id: string;
      command: string;
      cwd: string;
      status: ExecStatus;
      aggregatedOutput: string | null;
      exitCode: number | null;
      durationMs: number | null;
    }
  | {
      type: 'fileChange';
      id: string;
      changes: Array<{ path: string; kind: { type: 'add' | 'delete' | 'update' }; diff: string }>;
      status: ExecStatus;
    }
  | {
      type: 'mcpToolCall';
      id: string;
      server: string;
      tool: string;
      status: 'inProgress' | 'completed' | 'failed';
      arguments: unknown;
      result: { content: unknown[] } | null;
      error: { message: string } | null;
      durationMs: number | null;
    }
  | {
      type: 'dynamicToolCall';
      id: string;
      tool: string;
      status: 'inProgress' | 'completed' | 'failed';
      durationMs: number | null;
    }
  | { type: 'webSearch'; id: string; query: string }
  | { type: string; id: string };

export interface CommandApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  approvalId?: string | null;
  reason?: string | null;
  command?: string | null;
  cwd?: string | null;
}

export interface FileChangeApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string | null;
  grantRoot?: string | null;
}

export type CodexApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';
