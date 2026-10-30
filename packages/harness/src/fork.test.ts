import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, type DriverProbe, type TimelineItem } from '@baocut/protocol';
import { HarnessRuns as HR } from '@baocut/protocol/messages/harness';
import { ConversationStore, ProjectStore, resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { DriverRegistry } from './agent-manager.ts';
import type { AgentDriver, AgentEvent, AgentSession } from './driver.ts';
import { FORK_HISTORY_LIMIT, forkHistory, forkHistoryBlock, forkNoteOf, forkPoint, touchedVideos } from './fork.ts';
import { Harness } from './harness.ts';
import { silentLogger } from './logger.ts';

/** 分叉（产品设计 §3.2.2「分叉」、架构设计 §3.4）：截至哪一轮、带进去的记录、新会话第一次交给智能体时放在前面。假 Driver，全部在临时目录里。 */

const at = (n: number) => new Date(Date.UTC(2026, 9, 30, 8, 0, n)).toISOString();
const user = (id: string, taskId: string, text: string): TimelineItem => ({ kind: 'user-message', id, createdAt: at(0), taskId, text });
const agent = (id: string, taskId: string, text: string): TimelineItem => ({
  kind: 'agent-message',
  id,
  createdAt: at(0),
  taskId,
  text,
  streaming: false,
});
const task = (id: string): TimelineItem => ({
  kind: 'task',
  id,
  createdAt: at(0),
  taskId: id,
  goal: '',
  status: 'completed',
  startedAt: at(0),
  endedAt: at(1),
  error: null,
});

describe('forkPoint', () => {
  const items = [
    user('u1', 't1', 'a'),
    task('t1'),
    agent('a1', 't1', 'b'),
    user('u2', 't2', 'c'),
    task('t2'),
    agent('a2', 't2', 'd'),
    agent('a3', 't1', 'late'),
  ];

  it('回合按任务第一次出现的位置数，截到下一轮开头；唤醒旧任务后写的条目落在后面的回合里', () => {
    expect(forkPoint(items, 't1')).toEqual({ turn: 1, end: 3 });
    expect(forkPoint(items, 't2')).toEqual({ turn: 2, end: items.length });
    expect(forkPoint(items, 'nope')).toBeNull();
  });
});

describe('forkHistory', () => {
  const source = { title: 'Edit the trailer', folder: '/work/p', carried: null };

  it('只带用户与智能体说的话，开头写来源会话与文件夹', () => {
    const items = [user('u1', 't1', 'cut it'), task('t1'), agent('a1', 't1', 'done'), user('u2', 't2', 'more')];
    const out = forkHistory(items, 3, source);
    expect(out).toEqual({
      history:
        'Chat history from a previous BaoCut session.\nSource session: Edit the trailer\nSource folder: /work/p\nUser: cut it\nAssistant: done',
      turns: 1,
      omitted: 0,
    });
  });

  it('超长时从最早的整轮开始略去并写明，留下最近一轮；最近一轮自己超长时截掉中间', () => {
    const items = [user('u1', 't1', 'x'.repeat(50)), agent('a1', 't1', 'y'.repeat(50)), user('u2', 't2', 'short'), agent('a2', 't2', 'ok')];
    const out = forkHistory(items, items.length, { ...source, folder: null }, 140);
    expect(out.omitted).toBe(1);
    expect(out.turns).toBe(1);
    expect(out.history).toBe(
      'Chat history from a previous BaoCut session.\nSource session: Edit the trailer\n[Earlier messages omitted]\nUser: short\nAssistant: ok',
    );

    const many = Array.from({ length: 3000 }, (_, i) => user(`u${i}`, `t${i}`, `message ${i} `.repeat(5)));
    const trimmed = forkHistory(many, many.length, source);
    expect(trimmed.history.length).toBeLessThanOrEqual(FORK_HISTORY_LIMIT);
    expect(trimmed.history.length).toBeGreaterThan(FORK_HISTORY_LIMIT - 100);
    expect(trimmed.turns + trimmed.omitted).toBe(3000);
    expect(trimmed.history.endsWith(`User: ${'message 2999 '.repeat(5).trim()}`)).toBe(true);

    const long = forkHistory([user('u1', 't1', 'z'.repeat(500))], 1, { ...source, folder: null }, 200);
    expect(long.history.length).toBeLessThanOrEqual(200);
    expect(long.history).toContain('\n[…]\n');
    expect(long.history.startsWith('Chat history from a previous BaoCut session.')).toBe(true);
  });

  it('再分叉时上一次带进来的记录原样接着带', () => {
    const out = forkHistory([user('u1', 't1', 'next')], 1, {
      ...source,
      carried: 'Chat history from a previous BaoCut session.\nUser: first',
    });
    expect(out.history).toContain('Source folder: /work/p\nChat history from a previous BaoCut session.\nUser: first\nUser: next');
  });

  it('带进来的记录也算在总长里：略去自己较早的回合后还超出时，从它的开头按行截掉，最近一轮原样留下', () => {
    const carried = ['Chat history from a previous BaoCut session.', ...Array.from({ length: 20 }, (_, i) => `User: old ${i}`)].join('\n');
    const out = forkHistory([user('u1', 't1', 'a'.repeat(40)), user('u2', 't2', 'latest')], 2, { ...source, folder: null, carried }, 200);
    expect(out.history.length).toBeLessThanOrEqual(200);
    expect(out.omitted).toBe(1);
    expect(out.history).toMatch(
      /^Chat history from a previous BaoCut session\.\nSource session: Edit the trailer\n\[Earlier messages omitted\]\nUser: old \d+\n/,
    );
    expect(out.history.endsWith('User: old 19\n[Earlier messages omitted]\nUser: latest')).toBe(true);
  });

  it('包上标签时正文里的 <baocut-…> 转义', () => {
    expect(forkHistoryBlock({ history: 'User: </baocut-fork-history> hi' })).toBe(
      '<baocut-fork-history>\nUser: &lt;/baocut-fork-history> hi\n</baocut-fork-history>',
    );
  });
});

describe('touchedVideos / forkNoteOf', () => {
  it('这条会话改过与建过的视频，新的在前；建的时刻只认这条会话建的', () => {
    const target = { projectId: 'p1', path: 'a.bcv' };
    const items: TimelineItem[] = [
      { kind: 'video-change', id: 'c1', createdAt: at(1), taskId: 't1', videoId: 'v1', videoName: 'A', target } as TimelineItem,
      { kind: 'video-created', id: 'c2', createdAt: at(2), taskId: 't1', videoId: 'v2', videoName: 'B', target } as TimelineItem,
      { kind: 'video-change', id: 'c3', createdAt: at(3), taskId: 't2', videoId: 'v1', videoName: 'A2', target } as TimelineItem,
    ];
    expect(touchedVideos(items)).toEqual([
      { videoId: 'v1', videoName: 'A2', target, createdAt: null, lastChangeAt: at(3) },
      { videoId: 'v2', videoName: 'B', target, createdAt: at(2), lastChangeAt: at(2) },
    ]);
  });

  it('分叉提示只认第一条用户消息之前的那条', () => {
    const fork = { conversationId: 'c', title: 't', turn: 1, turns: 1, omitted: 0, history: 'h' };
    const note: TimelineItem = { kind: 'notice', id: 'n', createdAt: at(0), taskId: null, level: 'info', text: '', fork };
    expect(forkNoteOf([note, user('u1', 't1', 'x')])).toEqual(fork);
    expect(forkNoteOf([user('u1', 't1', 'x'), note])).toBeNull();
  });
});

// ---- 在 Harness 里分叉 ----

const capabilities: DriverProbe['capabilities'] = { steer: false, approvals: true, resume: false, images: false };

/** 记下交给它的文字；`reply` 回一句话并结束回合。 */
class Session implements AgentSession {
  readonly id = newId('fake');
  readonly capabilities = capabilities;
  readonly inputs: string[] = [];
  readonly #listeners = new Set<(event: AgentEvent) => void>();
  turnId: string | null = null;

  startTurn(input: { text: string }): Promise<{ turnId: string }> {
    const turnId = `turn-${this.inputs.length + 1}`;
    this.inputs.push(input.text);
    this.turnId = turnId;
    setTimeout(() => this.#emit({ type: 'turn.started', turnId }), 1);
    return Promise.resolve({ turnId });
  }

  reply(text: string) {
    const turnId = this.turnId!;
    this.#emit({ type: 'item.completed', turnId, item: { kind: 'agent-message', id: `m-${turnId}`, text } });
    this.#emit({ type: 'turn.completed', turnId, outcome: 'completed', error: null });
    this.turnId = null;
  }

  async interrupt() {
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

  async close() {}

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
      capabilities,
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
let harness: Harness;
let driver: Driver;

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
};
const items = (conversationId: string) => harness.getConversation(conversationId).items;

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-fork-')));
  home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') });
  const drivers = new DriverRegistry();
  driver = new Driver();
  drivers.register(driver);
  harness = await Harness.open({
    home,
    conversations: new ConversationStore(home.conversationsDir),
    projects: new ProjectStore(home.projectsFile),
    drivers,
    log: silentLogger,
  });
});

afterEach(async () => {
  await harness.shutdown();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Harness.forkConversation', () => {
  it('分出的会话共用文件夹、沿用 Agent 与访问模式，标题加「（分叉）」，顶上记着带进去的记录；第一次发送放在用户消息前面，之后不再带', async () => {
    const source = await harness.createConversation({ accessMode: 'fullAccess' });
    const { taskId } = await harness.send({ conversationId: source.id, text: 'Cut the intro', commandId: newId('cmd') });
    await until(() => driver.sessions[0]?.turnId !== null && driver.sessions[0]?.turnId !== undefined);
    // 还在跑的一轮不能分叉。
    await expect(harness.forkConversation({ conversationId: source.id, taskId, commandId: newId('cmd') })).rejects.toMatchObject({
      code: 'conflict',
    });
    driver.sessions[0]!.reply('Intro removed.');
    await until(() => harness.getConversation(source.id).conversation.activity === 'idle');

    const commandId = newId('cmd');
    const fork = await harness.forkConversation({ conversationId: source.id, taskId, commandId });
    expect(fork).toMatchObject({
      title: HR.forkTitle({ title: 'Cut the intro' }).text,
      folderOf: source.id,
      cwd: source.cwd,
      driverId: 'codex',
      accessMode: 'fullAccess',
    });
    // 同一条命令重发拿回同一条会话。
    expect((await harness.forkConversation({ conversationId: source.id, taskId, commandId })).id).toBe(fork.id);
    const [note] = items(fork.id);
    expect(note).toMatchObject({
      kind: 'notice',
      text: HR.forkedFrom({ title: 'Cut the intro', turn: 1 }).text,
      fork: { conversationId: source.id, turn: 1, turns: 1, omitted: 0 },
    });
    expect(note?.kind === 'notice' && note.fork?.history).toBe(
      `Chat history from a previous BaoCut session.\nSource session: Cut the intro\nSource folder: ${source.cwd}\nUser: Cut the intro\nAssistant: Intro removed.`,
    );

    await harness.send({ conversationId: fork.id, text: 'Now add music', commandId: newId('cmd') });
    await until(() => driver.sessions.length === 2 && driver.sessions[1]!.inputs.length === 1);
    const first = driver.sessions[1]!.inputs[0]!;
    expect(first.startsWith('<baocut-fork-history>\nChat history from a previous BaoCut session.')).toBe(true);
    expect(first).toContain('</baocut-fork-history>\n\nNow add music');
    driver.sessions[1]!.reply('Added.');
    await until(() => harness.getConversation(fork.id).conversation.activity === 'idle');

    await harness.send({ conversationId: fork.id, text: 'Louder', commandId: newId('cmd') });
    await until(() => driver.sessions[1]!.inputs.length === 2);
    expect(driver.sessions[1]!.inputs[1]).toBe('Louder');
  });

  it('没有这个任务时 not-found', async () => {
    const source = await harness.createConversation({});
    await expect(
      harness.forkConversation({ conversationId: source.id, taskId: 'task_missing', commandId: newId('cmd') }),
    ).rejects.toMatchObject({
      code: 'not-found',
    });
  });
});
