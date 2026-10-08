import {
  PROTOCOL_VERSION,
  RpcError,
  compareSeq,
  conversationTopic,
  isNextSeq,
  videoTopic,
  type AgentSetupEvent,
  type AgentsEvent,
  type AgentsSnapshot,
  type AgentSetupSnapshot,
  type ClientKind,
  type ConversationEvent,
  type ConversationSnapshot,
  type DirectoryEvent,
  type DirectorySnapshot,
  type Id,
  type VideoTopicEvent,
  type VideoTopicSnapshot,
  type RpcMethod,
  type RpcParams,
  type RpcResult,
  type RuntimeInfo,
  type Seq,
  type SequencedEvent,
  type ServerFrame,
  type SpaceEvent,
  type SpaceSnapshot,
  type TasksEvent,
  type TasksSnapshot,
  type JobsEvent,
  type JobsSnapshot,
  type ModelsEvent,
  type ModelsSnapshot,
  type SettingsEvent,
  type SettingsSnapshot,
  type ServicesEvent,
  type ServicesSnapshot,
  type Topic,
} from '@baocut/protocol';
import { ClientConnection as C } from '@baocut/protocol/messages/client';

export interface ConnectionTarget {
  endpoint: string;
  token: string;
}

export interface ClientOptions {
  /** 每次（重新）连接前调用：Runtime 重启后端口与令牌都会变，要重新读发现信息。 */
  resolve: () => Promise<ConnectionTarget>;
  client: { kind: ClientKind; name: string; version: string };
  /** 断线后自动重连。CLI 的一次性命令可以关掉。 */
  reconnect?: boolean;
  requestTimeoutMs?: number;
  WebSocket?: typeof WebSocket;
}

/** 单次请求的选项。 */
export interface RequestOptions {
  /** 这一次的超时（毫秒），覆盖 `ClientOptions.requestTimeoutMs`。 */
  timeoutMs?: number;
}

export type ConnectionState =
  | { status: 'connecting'; attempt: number }
  | { status: 'connected'; runtime: RuntimeInfo; connectionId: Id }
  | { status: 'disconnected'; reason: string; retryInMs: number | null }
  /** 协议不兼容：不重试，等用户更新（架构设计 §13.3）。 */
  | { status: 'incompatible'; reason: string }
  | { status: 'closed' };

export interface TopicHandlers<S, E> {
  /** 收到同一水位的快照：整体替换本地镜像。 */
  snapshot(snapshot: S, seq: Seq): void;
  /** 按序到达的增量事件。 */
  event(event: E, seq: Seq): void;
}

interface TopicEntry {
  topic: Topic;
  handlers: TopicHandlers<unknown, unknown>;
  /** 本地镜像所在的水位；null 表示需要快照。 */
  seq: Seq | null;
  /** 订阅请求在途：期间到达的事件都已被它的响应覆盖，丢弃。 */
  pending: boolean;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const BACKOFF_MS = [250, 500, 1000, 2000, 5000];

/**
 * Runtime 的客户端：握手、请求、按主题订阅与断线恢复（架构设计 §4.4）。
 *
 * 订阅的保证：处理函数只会看到「快照，然后连续的事件」。序号重复的事件丢弃，
 * 出现缺口或 Runtime 换了运行代（epoch）就重新取快照，不在缺事件的镜像上继续。
 */
export class BaoCutClient {
  readonly #options: ClientOptions;
  readonly #WebSocket: typeof WebSocket;
  readonly #topics = new Map<Topic, TopicEntry>();
  readonly #pending = new Map<string, PendingRequest>();
  readonly #stateListeners = new Set<(state: ConnectionState) => void>();
  readonly #readyWaiters = new Set<{ resolve: () => void; reject: (error: unknown) => void }>();
  #socket: WebSocket | null = null;
  #state: ConnectionState = { status: 'connecting', attempt: 0 };
  #epoch: string | null = null;
  #nextId = 1;
  #attempt = 0;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #closed = false;
  #started = false;

  constructor(options: ClientOptions) {
    this.#options = options;
    this.#WebSocket = options.WebSocket ?? globalThis.WebSocket;
  }

  get state(): ConnectionState {
    return this.#state;
  }

  /** 开始连接，在第一次握手成功后返回。 */
  connect(): Promise<RuntimeInfo> {
    if (!this.#started) {
      this.#started = true;
      void this.#open();
    }
    return this.#waitReady().then(() => (this.#state as Extract<ConnectionState, { status: 'connected' }>).runtime);
  }

  onState(listener: (state: ConnectionState) => void): () => void {
    this.#stateListeners.add(listener);
    listener(this.#state);
    return () => this.#stateListeners.delete(listener);
  }

  /**
   * 发一个请求。`options.timeoutMs` 覆盖这一次的超时（缺省用 `requestTimeoutMs`，再缺省 30 秒）：烘焙代码画面这类要几分钟的调用
   * （`compositions.import`）由调用方放宽。
   */
  async request<M extends RpcMethod>(method: M, params: RpcParams<M>, options: RequestOptions = {}): Promise<RpcResult<M>> {
    await this.#waitReady();
    return this.#send(method, params, options.timeoutMs) as Promise<RpcResult<M>>;
  }

  subscribe<S, E>(topic: Topic, handlers: TopicHandlers<S, E>): () => void {
    const entry: TopicEntry = { topic, handlers: handlers as TopicHandlers<unknown, unknown>, seq: null, pending: false };
    this.#topics.set(topic, entry);
    if (this.#state.status === 'connected') this.#resubscribe(entry);
    return () => {
      if (this.#topics.get(topic) !== entry) return;
      this.#topics.delete(topic);
      if (this.#state.status === 'connected') void this.#send('unsubscribe', { topic }).catch(() => {});
    };
  }

  subscribeDirectory(handlers: TopicHandlers<DirectorySnapshot, DirectoryEvent>): () => void {
    return this.subscribe('directory', handlers);
  }

  subscribeConversation(conversationId: Id, handlers: TopicHandlers<ConversationSnapshot, ConversationEvent>): () => void {
    return this.subscribe(conversationTopic(conversationId), handlers);
  }

  subscribeTasks(handlers: TopicHandlers<TasksSnapshot, TasksEvent>): () => void {
    return this.subscribe('tasks', handlers);
  }

  /** 后台任务（转写等）的记录，所有视频的都在里面。 */
  subscribeJobs(handlers: TopicHandlers<JobsSnapshot, JobsEvent>): () => void {
    return this.subscribe('jobs', handlers);
  }

  /** 模型服务的能力视图：配置、默认值、模型包或节点变化时推送完整的新视图。 */
  subscribeModels(handlers: TopicHandlers<ModelsSnapshot, ModelsEvent>): () => void {
    return this.subscribe('models', handlers);
  }

  /** 偏好设置：快照是全部键的有效值与默认值，之后只推送变了的键（`applySettingsEvent` 合进快照）。 */
  subscribeSettings(handlers: TopicHandlers<SettingsSnapshot, SettingsEvent>): () => void {
    return this.subscribe('settings', handlers);
  }

  /** 对外服务（架构设计 §4.8）：全部服务的状态与待处理的服务审批。 */
  subscribeServices(handlers: TopicHandlers<ServicesSnapshot, ServicesEvent>): () => void {
    return this.subscribe('services', handlers);
  }

  /** 应用内运行的 Agent 安装、升级命令（`agents.runSetup`）的状态与输出。 */
  subscribeAgentSetup(handlers: TopicHandlers<AgentSetupSnapshot, AgentSetupEvent>): () => void {
    return this.subscribe('agent-setup', handlers);
  }

  /** Agent 的探测结果与偏好（`agents.list` 的视图）：快照先来，后台探测完成后逐个送新视图。 */
  subscribeAgents(handlers: TopicHandlers<AgentsSnapshot, AgentsEvent>): () => void {
    return this.subscribe('agents', handlers);
  }

  subscribeSpace(handlers: TopicHandlers<SpaceSnapshot, SpaceEvent>): () => void {
    return this.subscribe('space', handlers);
  }

  /** 已打开视频的投影。视频要先经 `videos.open` / `videos.create` 打开；没有打开时订阅不会重试。 */
  subscribeVideo(videoId: Id, handlers: TopicHandlers<VideoTopicSnapshot, VideoTopicEvent>): () => void {
    return this.subscribe(videoTopic(videoId), handlers);
  }

  close(): void {
    this.#closed = true;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#socket?.close(1000, 'client closed');
    this.#socket = null;
    this.#failPending(new RpcError('internal', C.closed()));
    this.#setState({ status: 'closed' });
    for (const waiter of this.#readyWaiters) waiter.reject(new RpcError('internal', C.closed()));
    this.#readyWaiters.clear();
  }

  // ---- 连接 ----

  async #open(): Promise<void> {
    if (this.#closed) return;
    this.#setState({ status: 'connecting', attempt: this.#attempt });
    let target: ConnectionTarget;
    try {
      target = await this.#options.resolve();
    } catch (error) {
      return this.#scheduleReconnect(error instanceof Error ? error.message : String(error));
    }
    if (this.#closed) return;

    const socket = new this.#WebSocket(target.endpoint);
    this.#socket = socket;
    let welcomed = false;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION, token: target.token, client: this.#options.client }));
    };
    socket.onmessage = (message) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(message.data)) as ServerFrame;
      } catch {
        return;
      }
      if (frame.type === 'welcome') {
        welcomed = true;
        this.#onWelcome(frame.runtime, frame.connectionId);
      } else if (frame.type === 'fatal') {
        if (frame.error.code === 'protocol-mismatch') {
          this.#closed = true;
          this.#setState({ status: 'incompatible', reason: frame.error.message });
          for (const waiter of this.#readyWaiters) waiter.reject(RpcError.from(frame.error));
          this.#readyWaiters.clear();
        }
      } else {
        this.#onFrame(frame);
      }
    };
    socket.onclose = (event) => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#failPending(new RpcError('internal', C.disconnected()));
      for (const entry of this.#topics.values()) entry.pending = false;
      if (welcomed) this.#attempt = 0;
      this.#scheduleReconnect(event.reason || (welcomed ? C.connectionLost() : C.cannotConnect()).text);
    };
    socket.onerror = () => {
      // close 事件随后到达，在那里统一处理。
    };
  }

  #onWelcome(runtime: RuntimeInfo, connectionId: Id): void {
    if (this.#epoch !== runtime.epoch) {
      // Runtime 换了运行代：旧游标没有意义，全部重取快照。
      for (const entry of this.#topics.values()) entry.seq = null;
      this.#epoch = runtime.epoch;
    }
    this.#setState({ status: 'connected', runtime, connectionId });
    for (const waiter of this.#readyWaiters) waiter.resolve();
    this.#readyWaiters.clear();
    for (const entry of this.#topics.values()) this.#resubscribe(entry);
  }

  #scheduleReconnect(reason: string): void {
    if (this.#closed) return;
    if (this.#options.reconnect === false) {
      this.#setState({ status: 'disconnected', reason, retryInMs: null });
      for (const waiter of this.#readyWaiters) waiter.reject(new RpcError('internal', reason));
      this.#readyWaiters.clear();
      return;
    }
    const delay = BACKOFF_MS[Math.min(this.#attempt, BACKOFF_MS.length - 1)]!;
    this.#attempt++;
    this.#setState({ status: 'disconnected', reason, retryInMs: delay });
    this.#retryTimer = setTimeout(() => void this.#open(), delay);
  }

  #setState(state: ConnectionState): void {
    this.#state = state;
    for (const listener of this.#stateListeners) listener(state);
  }

  #waitReady(): Promise<void> {
    if (this.#state.status === 'connected') return Promise.resolve();
    if (this.#closed) return Promise.reject(new RpcError('internal', C.closed()));
    if (!this.#started) {
      this.#started = true;
      void this.#open();
    }
    return new Promise((resolve, reject) => this.#readyWaiters.add({ resolve, reject }));
  }

  // ---- 请求 ----

  #send(method: string, params: unknown, timeoutOverride?: number): Promise<unknown> {
    const socket = this.#socket;
    if (!socket || this.#state.status !== 'connected') {
      return Promise.reject(new RpcError('internal', C.disconnected()));
    }
    const id = String(this.#nextId++);
    return new Promise((resolve, reject) => {
      const timeoutMs = timeoutOverride ?? this.#options.requestTimeoutMs ?? 30_000;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new RpcError('internal', C.requestTimedOut({ method })));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ type: 'request', id, method, params }));
    });
  }

  #failPending(error: RpcError): void {
    for (const pending of this.#pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #onFrame(frame: ServerFrame): void {
    if (frame.type === 'response') {
      const pending = this.#pending.get(frame.id);
      if (!pending) return;
      this.#pending.delete(frame.id);
      if (pending.timer) clearTimeout(pending.timer);
      if (frame.ok) pending.resolve(frame.result);
      else pending.reject(frame.error ? RpcError.from(frame.error) : new RpcError('internal', C.unknownError()));
    } else if (frame.type === 'event') {
      const entry = this.#topics.get(frame.topic);
      if (!entry || entry.pending || entry.seq === null) return;
      this.#deliver(entry, { seq: frame.seq, event: frame.event });
    }
  }

  // ---- 订阅 ----

  #resubscribe(entry: TopicEntry): void {
    entry.pending = true;
    const params = entry.seq === null ? { topic: entry.topic } : { topic: entry.topic, afterSeq: entry.seq };
    this.#send('subscribe', params).then(
      (raw) => {
        if (this.#topics.get(entry.topic) !== entry) return;
        entry.pending = false;
        const result = raw as RpcResult<'subscribe'>;
        if (result.mode === 'snapshot') {
          entry.seq = result.seq;
          entry.handlers.snapshot(result.snapshot, result.seq);
          return;
        }
        for (const event of result.events) {
          if (!this.#deliver(entry, event)) return;
        }
      },
      (error: unknown) => {
        entry.pending = false;
        if (this.#topics.get(entry.topic) !== entry) return;
        // 主题不存在（例如会话已被删除）：交给调用方从目录里得知，不再重试。不允许订阅（Web 服务的白名单之外）同样不重试。
        if (error instanceof RpcError && (error.code === 'not-found' || error.code === 'forbidden')) return;
        if (this.#state.status === 'connected') setTimeout(() => this.#resubscribe(entry), 1000);
      },
    );
  }

  /** 送达一条事件。返回 false 表示发现缺口、已经转去重取快照。 */
  #deliver(entry: TopicEntry, event: SequencedEvent<unknown>): boolean {
    if (entry.seq === null) return false;
    if (compareSeq(event.seq, entry.seq) <= 0) return true;
    if (!isNextSeq(entry.seq, event.seq)) {
      entry.seq = null;
      this.#resubscribe(entry);
      return false;
    }
    entry.seq = event.seq;
    entry.handlers.event(event.event, event.seq);
    return true;
  }
}
