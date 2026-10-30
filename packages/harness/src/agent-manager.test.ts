import { describe, expect, it } from 'vitest';
import { newId, type DriverProbe } from '@baocut/protocol';
import { AgentManager, DriverRegistry } from './agent-manager.ts';
import type { AgentDriver, AgentSession, AgentToolAccess, CreateSessionOptions } from './driver.ts';
import { silentLogger } from './logger.ts';

/** 指导热更新（架构设计 §3.8）：指导的来源变了之后，在跑的原生会话在下一轮开始时重算，不同就带着恢复句柄重建。 */

class Session implements AgentSession {
  readonly id = newId('fake');
  readonly capabilities = { steer: false, approvals: false, resume: true, images: false };
  readonly options: CreateSessionOptions;
  /** 原生侧还有没有回合之外的活：false 时不让收起。 */
  releasable = true;
  closed = false;

  constructor(options: CreateSessionOptions) {
    this.options = options;
  }

  async startTurn() {
    return { turnId: 'turn-1' };
  }

  async interrupt() {
    return { status: 'requested' as const };
  }

  async respondToApproval() {}

  subscribe() {
    return () => {};
  }

  describePersistence() {
    return { driverId: 'codex', data: { thread: this.id } };
  }

  async canRelease() {
    return this.releasable;
  }

  async close() {
    this.closed = true;
  }
}

class Driver implements AgentDriver {
  readonly id = 'codex' as const;
  readonly sessions: Session[] = [];

  async probe(): Promise<DriverProbe> {
    throw new Error('not probed in this test');
  }

  async createSession(options: CreateSessionOptions): Promise<AgentSession> {
    const session = new Session(options);
    this.sessions.push(session);
    return session;
  }
}

function setup() {
  const driver = new Driver();
  const drivers = new DriverRegistry();
  drivers.register(driver);
  const state = { extra: 'skills v1', reads: 0 };
  const tools: AgentToolAccess = {
    instructions: 'GUIDE',
    grant: () => ({ mcpServers: {}, revoke() {} }),
    sessionInstructions: async () => {
      state.reads += 1;
      return state.extra;
    },
  };
  const manager = new AgentManager(drivers, () => {}, silentLogger, tools);
  const ensure = () =>
    manager.ensure({
      conversationId: 'conv_1',
      driverId: 'codex',
      cwd: '/tmp',
      settings: { accessMode: 'auto', model: null, effort: null },
      resume: null,
    });
  return { driver, manager, state, ensure };
}

describe('AgentManager 指导热更新', () => {
  it('来源没变时不重算；变了但算出来一样时接着用原来的原生会话', async () => {
    const { driver, manager, state, ensure } = setup();
    const first = await ensure();
    expect(driver.sessions[0]!.options.developerInstructions).toBe('GUIDE\n\nskills v1');
    expect(await ensure()).toBe(first);
    expect(state.reads).toBe(1);

    manager.instructionsChanged();
    expect(await ensure()).toBe(first);
    expect(state.reads).toBe(2);
    expect(await ensure()).toBe(first);
    expect(state.reads).toBe(2);
    expect(driver.sessions).toHaveLength(1);
  });

  it('指导变了：原生侧还有活时这一轮接着用旧的，能放了再带着恢复句柄重建', async () => {
    const { driver, manager, state, ensure } = setup();
    const first = (await ensure()) as Session;
    state.extra = 'skills v2';
    manager.instructionsChanged();

    first.releasable = false;
    expect(await ensure()).toBe(first);
    expect(first.closed).toBe(false);
    // 还没换成新的：下一轮再看。
    expect(await ensure()).toBe(first);
    expect(state.reads).toBe(3);

    first.releasable = true;
    const second = (await ensure()) as Session;
    expect(second).not.toBe(first);
    expect(first.closed).toBe(true);
    expect(second.options.developerInstructions).toBe('GUIDE\n\nskills v2');
    expect(second.options.resume).toEqual(first.describePersistence());
    expect(await ensure()).toBe(second);
    expect(driver.sessions).toHaveLength(2);
  });
});
