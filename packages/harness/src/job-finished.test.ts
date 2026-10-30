import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, type DriverProbe, type Id, type TimelineItem } from '@baocut/protocol';
import { ConversationStore, ProjectStore, resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { DriverRegistry } from './agent-manager.ts';
import type { AgentDriver, AgentEvent, AgentSession } from './driver.ts';
import { Harness, type JobFinished } from './harness.ts';
import { silentLogger } from './logger.ts';

/**
 * 完成收件箱（架构设计 §7.2）：后台任务结束时插话、唤醒、等回合结束或不告诉；以及原生会话的空闲回收（§2.5）。
 * 假 Driver，全部在临时目录里。
 */

let steerable = true;

/** 回合开始后一直开着，直到测试 `finish()`；`steerable` 为 false 时没有插话。 */
class Session implements AgentSession {
  readonly id = newId('fake');
  readonly capabilities: DriverProbe['capabilities'] = { steer: steerable, approvals: true, resume: false, images: false };
  readonly inputs: string[] = [];
  readonly turns: string[] = [];
  readonly #listeners = new Set<(event: AgentEvent) => void>();
  turnId: string | null = null;
  steer?: AgentSession['steer'];
  /** 原生侧还有没有回合之外的活：false 时不让空闲回收。 */
  releasable = true;
  closed = false;

  constructor() {
    if (steerable) {
      this.steer = async (_turnId, input) => {
        this.inputs.push(input.text);
        return 'accepted';
      };
    }
  }

  startTurn(input: { text: string }): Promise<{ turnId: string }> {
    const turnId = `turn-${this.turns.length + 1}`;
    this.turns.push(input.text);
    this.turnId = turnId;
    this.inputs.push(input.text);
    setTimeout(() => this.#emit({ type: 'turn.started', turnId }), 1);
    return Promise.resolve({ turnId });
  }

  finish() {
    if (this.turnId) this.#emit({ type: 'turn.completed', turnId: this.turnId, outcome: 'completed', error: null });
    this.turnId = null;
  }

  async interrupt(turnId: string) {
    setTimeout(() => {
      if (this.turnId === turnId) {
        this.turnId = null;
        this.#emit({ type: 'turn.completed', turnId, outcome: 'interrupted', error: null });
      }
    }, 5);
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

  async canRelease() {
    return this.releasable;
  }

  async close() {
    this.closed = true;
  }

  #emit(event: AgentEvent) {
    for (const listener of this.#listeners) listener(event);
  }
}

class Driver implements AgentDriver {
  readonly id = 'codex' as const;
  readonly sessions: Session[] = [];

  async probe(): Promise<DriverProbe> {
    return {
      id: 'codex',
      name: 'Fake',
      command: 'fake',
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
      capabilities: { steer: steerable, approvals: true, resume: false, images: false },
    };
  }

  async createSession(): Promise<AgentSession> {
    const session = new Session();
    this.sessions.push(session);
    return session;
  }
}

let dir: string;
let home: RuntimeHome;
let driver: Driver;
let harness: Harness;

async function open(): Promise<Harness> {
  const drivers = new DriverRegistry();
  drivers.register(driver);
  return Harness.open({
    home,
    conversations: new ConversationStore(home.conversationsDir),
    projects: new ProjectStore(home.projectsFile),
    drivers,
    log: silentLogger,
  });
}

async function until<T>(read: () => T | undefined | null | false, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const taskOf = (conversationId: Id, taskId: Id) =>
  harness
    .getConversation(conversationId)
    .items.find((i): i is Extract<TimelineItem, { kind: 'task' }> => i.id === taskId && i.kind === 'task');
const notices = (conversationId: Id) =>
  harness
    .getConversation(conversationId)
    .items.filter((i): i is Extract<TimelineItem, { kind: 'notice' }> => i.kind === 'notice' && i.job !== undefined);

/** 发一条消息、等回合开始；`done` 时让回合结束、等任务完成。 */
async function started(text: string, done: boolean) {
  const conversation = await harness.createConversation({ title: text });
  const { taskId } = await harness.send({ conversationId: conversation.id, text, commandId: newId('cmd') });
  const session = await until(() => driver.sessions.at(-1));
  await until(() => harness.agentRun(conversation.id).taskId && session.turnId);
  if (done) {
    session.finish();
    await until(() => taskOf(conversation.id, taskId)?.status === 'completed');
  }
  return { conversationId: conversation.id, taskId, session };
}

const finished = (conversationId: Id, taskId: Id, over: Partial<JobFinished> = {}): JobFinished => ({
  conversationId,
  taskId,
  jobId: 'job_1',
  kind: 'music',
  attempt: 1,
  state: 'completed',
  ...over,
});

beforeEach(async () => {
  steerable = true;
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-job-inbox-')));
  home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') });
  driver = new Driver();
  harness = await open();
});

afterEach(async () => {
  await harness.shutdown();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Harness.jobFinished', () => {
  it('空闲、任务已完成：重新打开同一个任务、起一个回合，交给它结束通知段；重复交来不再起回合', async () => {
    const { conversationId, taskId, session } = await started('做一段配乐', true);
    expect(await harness.jobFinished(finished(conversationId, taskId))).toBe('woke');
    expect(taskOf(conversationId, taskId)).toMatchObject({ status: 'running', endedAt: null });
    expect(harness.getConversation(conversationId).conversation).toMatchObject({ activeTaskId: taskId, activity: 'running' });
    const input = await until(() => session.turns[1]);
    expect(input.startsWith('<baocut-job-finished>\njob: job_1\nkind: music\nstate: completed\nattempt: 1\n')).toBe(true);
    expect(input).toContain('jobs_inspect');
    expect(notices(conversationId)).toEqual([
      expect.objectContaining({
        id: 'job_job_1_1',
        taskId,
        level: 'info',
        job: { jobId: 'job_1', attempt: 1, state: 'completed', delivery: 'woke' },
      }),
    ]);

    expect(await harness.jobFinished(finished(conversationId, taskId))).toBe('woke');
    expect(session.turns).toHaveLength(2);
    await until(() => session.turnId);
    session.finish();
    await until(() => taskOf(conversationId, taskId)?.status === 'completed');
    expect(notices(conversationId)).toHaveLength(1);
  });

  it('回合进行中、能插话：插进当前回合，不另起回合', async () => {
    const { conversationId, taskId, session } = await started('做一段配乐', false);
    expect(await harness.jobFinished(finished(conversationId, taskId, { state: 'failed' }))).toBe('steered');
    expect(session.inputs.at(-1)).toContain('state: failed');
    expect(session.turns).toHaveLength(1);
    expect(notices(conversationId)[0]).toMatchObject({ level: 'warning', job: { delivery: 'steered' } });
  });

  it('回合进行中、不能插话：等回合结束再唤醒，提示还是同一条', async () => {
    steerable = false;
    const { conversationId, taskId, session } = await started('做一段配乐', false);
    expect(await harness.jobFinished(finished(conversationId, taskId))).toBe('held');
    expect(notices(conversationId)[0]?.job?.delivery).toBe('held');
    session.finish();
    const input = await until(() => session.turns[1]);
    expect(input).toContain('<baocut-job-finished>');
    expect(notices(conversationId)).toEqual([
      expect.objectContaining({ id: 'job_job_1_1', job: expect.objectContaining({ delivery: 'woke' }) }),
    ]);
    expect(taskOf(conversationId, taskId)?.status).toBe('running');
  });

  it('任务被停止：不告诉智能体，提示不挂在任务上', async () => {
    const { conversationId, taskId, session } = await started('做一段配乐', false);
    await harness.stopTask(taskId);
    await until(() => taskOf(conversationId, taskId)?.status === 'stopped');
    expect(await harness.jobFinished(finished(conversationId, taskId))).toBe('dropped');
    expect(session.turns).toHaveLength(1);
    expect(notices(conversationId)[0]).toMatchObject({ taskId: null, job: { delivery: 'dropped' } });
    expect(harness.getConversation(conversationId).conversation.activeTaskId).toBeNull();
  });

  it('归档的会话不唤醒；重启前还在等回合结束的标为没有告诉', async () => {
    const idle = await started('归档的', true);
    await harness.updateConversation({ conversationId: idle.conversationId, archived: true });
    expect(await harness.jobFinished(finished(idle.conversationId, idle.taskId))).toBe('dropped');

    steerable = false;
    const running = await started('等着的', false);
    expect(await harness.jobFinished(finished(running.conversationId, running.taskId, { jobId: 'job_2' }))).toBe('held');
    await harness.shutdown();
    harness = await open();
    expect(notices(running.conversationId)[0]?.job?.delivery).toBe('dropped');
  });
});

describe('空闲回收', () => {
  it('Driver 说还有后台任务时不收起原生会话，过 10 分钟再问，能放了才关', async () => {
    const { session } = await started('跑个后台命令', false);
    session.releasable = false;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      session.finish();
      await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
      expect(session.closed).toBe(false);
      session.releasable = true;
      await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
      expect(session.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
