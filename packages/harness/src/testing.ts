import { newId, type DriverId, type DriverProbe, type Id } from '@baocut/protocol';
import type { AgentDriver, AgentEvent, AgentSession, CreateSessionOptions, TurnSettings } from './driver.ts';
import type { AgentToolAccess } from './driver.ts';

/*
 * 只给测试用的假 Driver（`@baocut/harness/testing`）：每个回合交给测试写的脚本，脚本像智能体一样说话、调用工具、结束回合。
 * 不跑任何模型。生产代码不引用这个文件。
 */

/** 测试里的工具通道：授权里带上会话 id，假 Driver 据此知道一个原生会话属于哪条会话。 */
export function testToolAccess(instructions = '', sessionInstructions?: (conversationId: Id) => Promise<string>): AgentToolAccess {
  return {
    instructions,
    grant: (conversationId) => ({ mcpServers: { baocut: { url: `test://${conversationId}`, headers: { 'x-test-conversation': conversationId } } }, revoke() {} }),
    ...(sessionInstructions ? { sessionInstructions } : {}),
  };
}

export interface ScriptedTurn {
  readonly conversationId: Id | null;
  readonly text: string;
  readonly settings: TurnSettings;
  readonly session: ScriptedSession;
  /** 智能体说一句（`agent-message`）。 */
  say(text: string): void;
  todo(items: { text: string; status: 'pending' | 'inProgress' | 'completed' }[]): void;
  compact(): void;
  /** 结束回合。脚本没调用它、也没调 `hold()` 时，脚本返回后自动以 `completed` 结束。 */
  complete(): void;
  fail(error: string): void;
  /** 回合先不结束：等测试再调 `complete()` / `fail()`。 */
  hold(): void;
}

export type TurnScript = (turn: ScriptedTurn) => void | Promise<void>;

export interface ScriptedDriverOptions {
  id?: DriverId;
  name?: string;
  steer?: boolean;
  approvals?: boolean;
}

export class ScriptedSession implements AgentSession {
  readonly id = newId('fake');
  readonly capabilities: DriverProbe['capabilities'];
  readonly turns: string[] = [];
  readonly steered: string[] = [];
  readonly #listeners = new Set<(event: AgentEvent) => void>();
  turnId: string | null = null;
  steer?: AgentSession['steer'];
  closed = false;
  readonly conversationId: Id | null;
  readonly options: CreateSessionOptions;
  readonly driver: ScriptedDriver;

  constructor(conversationId: Id | null, options: CreateSessionOptions, driver: ScriptedDriver, caps: { steer: boolean; approvals: boolean }) {
    this.conversationId = conversationId;
    this.options = options;
    this.driver = driver;
    this.capabilities = { steer: caps.steer, approvals: caps.approvals, resume: false, images: false };
    if (caps.steer) {
      this.steer = async (turnId, input) => {
        if (turnId !== this.turnId) return 'unavailable';
        this.steered.push(input.text);
        return 'accepted';
      };
    }
  }

  async startTurn(input: { text: string }, settings: TurnSettings): Promise<{ turnId: string }> {
    const turnId = `turn-${this.turns.length + 1}`;
    this.turns.push(input.text);
    this.turnId = turnId;
    let ended = false;
    let held = false;
    let seq = 0;
    const end = (outcome: 'completed' | 'failed', error: string | null) => {
      if (ended || this.turnId !== turnId) return;
      ended = true;
      this.turnId = null;
      this.emit({ type: 'turn.completed', turnId, outcome, error });
    };
    const turn: ScriptedTurn = {
      conversationId: this.conversationId,
      text: input.text,
      settings,
      session: this,
      say: (text) => this.emit({ type: 'item.completed', turnId, item: { kind: 'agent-message', id: `${turnId}-m${++seq}`, text } }),
      todo: (items) => this.emit({ type: 'todo.updated', turnId, items: items.map((i) => ({ text: i.text, status: i.status })) as never }),
      compact: () => this.emit({ type: 'context.compacted', turnId }),
      complete: () => end('completed', null),
      fail: (error) => end('failed', error),
      hold: () => {
        held = true;
      },
    };
    this.driver.lastTurn = turn;
    setTimeout(() => {
      this.emit({ type: 'turn.started', turnId });
      void Promise.resolve()
        .then(() => this.driver.script(turn))
        .then(
          () => {
            if (!held) end('completed', null);
          },
          (error: unknown) => end('failed', String(error)),
        );
    }, 1);
    return { turnId };
  }

  async interrupt(turnId: string) {
    setTimeout(() => {
      if (this.turnId === turnId) {
        this.turnId = null;
        this.emit({ type: 'turn.completed', turnId, outcome: 'interrupted', error: null });
      }
    }, 2);
    return { status: 'requested' as const };
  }

  async respondToApproval() {}

  subscribe(listener: (event: AgentEvent) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  describePersistence() {
    return null;
  }

  async close() {
    this.closed = true;
  }

  emit(event: AgentEvent) {
    for (const listener of this.#listeners) listener(event);
  }
}

export class ScriptedDriver implements AgentDriver {
  readonly id: DriverId;
  readonly sessions: ScriptedSession[] = [];
  lastTurn: ScriptedTurn | null = null;
  script: TurnScript = () => {};
  readonly #options: Required<ScriptedDriverOptions>;

  constructor(options: ScriptedDriverOptions = {}) {
    this.#options = { id: 'codex', name: 'Scripted', steer: true, approvals: true, ...options };
    this.id = this.#options.id;
  }

  /** 某条会话最近的原生会话。 */
  sessionOf(conversationId: Id): ScriptedSession | undefined {
    return this.sessions.filter((s) => s.conversationId === conversationId).at(-1);
  }

  async probe(): Promise<DriverProbe> {
    return {
      id: this.id,
      name: this.#options.name,
      command: 'scripted',
      state: 'ready',
      status: 'available',
      version: '0',
      minVersion: '0',
      latestVersion: null,
      unavailableReason: null,
      detail: null,
      executable: null,
      realExecutable: null,
      account: null,
      plan: '',
      loginCommand: null,
      install: [],
      models: [],
      configModel: null,
      configModelKnown: null,
      checkedAt: new Date().toISOString(),
      verified: true,
      tested: true,
      capabilities: { steer: this.#options.steer, approvals: this.#options.approvals, resume: false, images: false },
    };
  }

  async createSession(options: CreateSessionOptions): Promise<AgentSession> {
    const conversationId =
      Object.values(options.mcpServers ?? {})
        .map((server) => server.headers['x-test-conversation'])
        .find(Boolean) ?? null;
    const session = new ScriptedSession(conversationId, options, this, { steer: this.#options.steer, approvals: this.#options.approvals });
    this.sessions.push(session);
    return session;
  }
}
