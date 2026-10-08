/**
 * 局域网节点（架构设计 §6.7；节点协议规范）：一台机器把本地模型能力共享给局域网里的其他机器。
 *
 * 本文件有两部分：
 * - 节点服务的 HTTP 合同（`/v1/...`）：健康、配对、任务、事件与错误。这是两台 Runtime 之间的线上格式，
 *   与本机网关的 RPC 分开。
 * - 本机网关上的 `nodes` 方法的参数与结果（规范 §10），登记在 `RpcMethods`。
 */

/** 节点协议版本（规范 §1）。 */
export const NODE_PROTOCOL_VERSION = 1;
/** 节点接受的最低协议版本；低于它的请求以 `426 PROTOCOL_VERSION_UNSUPPORTED` 拒绝。 */
export const NODE_MIN_PROTOCOL_VERSION = 1;
/** 版本门的请求头（规范 §2）。 */
export const NODE_PROTOCOL_HEADER = 'X-BaoCut-Node-Protocol';
/** 节点服务的默认端口。 */
export const NODE_DEFAULT_PORT = 47610;
/** mDNS 服务类型（规范 §12）。 */
export const NODE_SERVICE_TYPE = '_baocut-node._tcp';
export const NODE_HEALTH_SCHEMA = 'baocut.node-health/v1';
/**
 * 节点支持共享的模型能力（规范 §10、§11）：`nodes.share.setCapability` 只接受这些，`ShareStatus.capabilities` 每种一项。
 * 将来加进来的能力对已经开启过共享的节点默认关闭，由主人打开。
 */
export const NODE_SHAREABLE_CAPABILITIES = ['transcribe'] as const;
export type NodeShareableCapability = (typeof NODE_SHAREABLE_CAPABILITIES)[number];

// ---- §3 健康 ----

export interface NodeHealth {
  schema: typeof NODE_HEALTH_SCHEMA;
  /** 节点第一次开启共享时生成，之后不变。 */
  nodeId: string;
  /** 给人看的名字，默认主机名。 */
  name: string;
  nodeProtocolVersion: number;
  minNodeProtocolVersion: number;
  runtimeVersion: string;
  platform: { os: string; arch: string };
  capabilities: {
    transcribe: {
      enabled: boolean;
      /** `state` 同 `models.list`。 */
      bundles: Array<{ bundleId: string; backend: string; device: string; state: string }>;
      /** 正在执行的任务数（含本机任务）。 */
      running: number;
      queued: number;
    };
  };
}

// ---- §4 配对 ----

export interface NodePairRequest {
  code: string;
  /** 发起端 Runtime Home 里持久的随机标识；不含 `.`。 */
  clientId: string;
  clientName: string;
}

export interface NodePairResponse {
  nodeId: string;
  name: string;
  /** `<clientId>.<secret>`，`secret` 是 32 字节随机数的 base64url。 */
  token: string;
}

// ---- §5 任务 ----

/** 与 Model Worker 协议规范 §2.5 的 `TranscribeOptions` 同形，原样传给 Worker。 */
export interface NodeTranscribeOptions {
  language: { mode: 'assert'; tag: string } | { mode: 'prefer'; tag: string | null };
  diarize: boolean;
  /** 术语与上下文，≤ 1200 字符。 */
  hint?: string;
  /** 输出的 tick 单位，默认 1_000_000。 */
  timescale: number;
}

export interface NodeJobRequest {
  /** 幂等键：发起端的 jobId 加尝试序号。 */
  clientJobId: string;
  kind: 'transcribe';
  bundleId: string;
  input: {
    /** `sha256:<hex>`，媒体文件的内容摘要。 */
    contentHash: string;
    byteLength: number;
    mediaType: string;
    track: number;
    /** tick（`options.timescale`），同 Model Worker 协议。 */
    range: { start: number; end: number } | null;
  };
  options: NodeTranscribeOptions;
}

export type NodeJobState = 'awaiting-input' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface NodeJob {
  jobId: string;
  clientJobId: string;
  state: NodeJobState;
  /** 同 `jobs` 主题的 phase；等待上传时为 `awaiting-input`。 */
  phase: string;
  progress: { done: number; total: number | null; unit: 'seconds' | 'segments' } | null;
  attempt: number;
  error: { code: string; message: string; details?: unknown } | null;
  /** completed 时给出；sha256 是小写十六进制。 */
  output: { sha256: string; byteLength: number } | null;
  lastSeq: number;
}

// ---- §6 事件流 ----

export type NodeJobEvent =
  | { seq: number; type: 'job'; job: NodeJob }
  | { seq: number; type: 'warning'; warning: { code: string; segmentId?: string; detail?: string } }
  | { seq: number; type: 'language'; tag: string; confidence: number | null }
  | { type: 'heartbeat' };

// ---- §8 错误 ----

export const NODE_ERROR = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  SOURCE_NOT_ALLOWED: 'SOURCE_NOT_ALLOWED',
  PAIRING_CODE_INVALID: 'PAIRING_CODE_INVALID',
  CAPABILITY_DISABLED: 'CAPABILITY_DISABLED',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  MODEL_NOT_READY: 'MODEL_NOT_READY',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  INVALID_STATE: 'INVALID_STATE',
  RESULT_EXPIRED: 'RESULT_EXPIRED',
  INPUT_TOO_LARGE: 'INPUT_TOO_LARGE',
  INPUT_HASH_MISMATCH: 'INPUT_HASH_MISMATCH',
  PROTOCOL_VERSION_UNSUPPORTED: 'PROTOCOL_VERSION_UNSUPPORTED',
  PAIRING_LOCKED: 'PAIRING_LOCKED',
  QUEUE_FULL: 'QUEUE_FULL',
  DISK_LOW: 'DISK_LOW',
} as const;

export type NodeErrorCode = (typeof NODE_ERROR)[keyof typeof NODE_ERROR];

/** 每个错误码对应的 HTTP 状态（规范 §8）。 */
export const NODE_ERROR_STATUS: Record<NodeErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  SOURCE_NOT_ALLOWED: 403,
  PAIRING_CODE_INVALID: 403,
  CAPABILITY_DISABLED: 403,
  JOB_NOT_FOUND: 404,
  MODEL_NOT_READY: 409,
  IDEMPOTENCY_CONFLICT: 409,
  INVALID_STATE: 409,
  RESULT_EXPIRED: 410,
  INPUT_TOO_LARGE: 413,
  INPUT_HASH_MISMATCH: 422,
  PROTOCOL_VERSION_UNSUPPORTED: 426,
  PAIRING_LOCKED: 429,
  QUEUE_FULL: 429,
  DISK_LOW: 507,
};

/** 任务自身失败（`NodeJob.error`）时节点特有的两个错误码；其余沿用模型类错误码。 */
export const NODE_JOB_ERROR = {
  INPUT_HASH_MISMATCH: 'INPUT_HASH_MISMATCH',
  INPUT_EXPIRED: 'INPUT_EXPIRED',
} as const;

/** 非 2xx 响应体。 */
export interface NodeErrorBody {
  error: { code: NodeErrorCode; message: string; details?: Record<string, unknown> };
}

// ---- §10 本机网关的 nodes 方法 ----

export interface ShareStatus {
  /** 用户的开关，持久。 */
  enabled: boolean;
  /** 节点服务此刻是否在监听。 */
  listening: boolean;
  /** 开着却没有监听的原因（例如端口被占用）。 */
  error: string | null;
  nodeId: string | null;
  name: string;
  /** 监听时为实际绑定的端口，否则为设置的端口。 */
  port: number;
  /** 此刻能连上的地址：监听所有接口时为本机非回环的 IPv4 地址，绑定具体地址时只有它，没在监听时为空。 */
  addresses: string[];
  allowAnySource: boolean;
  /** 每种可共享的模型能力一项（`NODE_SHAREABLE_CAPABILITIES`）；持久。关闭的能力新任务以 `403 CAPABILITY_DISABLED` 拒绝。 */
  capabilities: Record<string, { enabled: boolean }>;
  pairing: { code: string; expiresAt: string } | { lockedUntil: string } | null;
  clients: Array<{ clientId: string; name: string; pairedAt: string; lastSeenAt: string | null }>;
  /** 这台节点上的远端任务。 */
  jobs: { running: number; queued: number };
}

export interface ShareStartParams {
  port?: number;
  name?: string;
  allowAnySource?: boolean;
}

export interface DiscoveredNode {
  name: string;
  host: string;
  port: number;
  nodeId: string | null;
}

export interface PairedNode {
  nodeId: string;
  /** 本机唯一；默认取节点的 name，冲突时加序号。 */
  alias: string;
  name: string;
  host: string;
  port: number;
  pairedAt: string;
  /** 探测不到时为 null。 */
  health: NodeHealth | null;
  /**
   * `unreachable`：连不上、超时或来源地址被拒；`version`：协议版本不兼容；`unpaired`：令牌已被吊销、
   * 本机读不到它的令牌（凭据存储不可用），或这个地址上已经是另一台节点（`nodeId` 不同）。
   */
  problem: 'unreachable' | 'version' | 'unpaired' | null;
}

// ---- §9 发起端的任务错误 ----

/** 发起端的错误码（命令与协议规范 §11.3）：任务的 `error.code`，或 `nodes.pair` 失败时 `RpcError.details.code`。 */
export const REMOTE_NODE_ERROR = {
  LOST: 'REMOTE_NODE_LOST',
  REJECTED: 'REMOTE_NODE_REJECTED',
} as const;

/** `REMOTE_NODE_REJECTED` 的 `details.reason`：任务的预检与请求用前八个，`nodes.pair` 用后两个与 `version`、`source-not-allowed`。 */
export type RemoteNodeRejectReason =
  | 'unpaired'
  | 'version'
  | 'capability-disabled'
  | 'model-not-ready'
  | 'queue-full'
  | 'disk-low'
  | 'source-not-allowed'
  | 'input-too-large'
  | 'pairing-code-invalid'
  | 'pairing-locked';

/** `REMOTE_NODE_LOST` 的 `details.reason`。 */
export type RemoteNodeLostReason = 'unreachable' | 'stream-lost' | 'node-restarted';
