import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, type DriverId, type DriverProbe, type TimelineItem } from '@baocut/protocol';
import { ConversationStore, ProjectStore, resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { DriverRegistry } from './agent-manager.ts';
import type {
  AgentDriver,
  AgentEvent,
  AgentPersistenceHandle,
  AgentSession,
  CreateSessionOptions,
  NativeSession,
  NativeSessionHistory,
} from './driver.ts';
import { Harness } from './harness.ts';
import { IMPORT_TEXT_LIMIT, IMPORT_TURN_LIMIT, importedItems } from './import.ts';
import { silentLogger } from './logger.ts';

/**
 * 导入外部会话（产品设计 §3.1「导入外部会话」、架构设计 §3.4「导入的记录」）：落点、借用原会话的目录、幂等、复制的条目与预算。
 * 假 Driver 给出本机会话，全部在临时目录里，不碰本机真实的 Agent。
 */

const at = (n: number) => new Date(Date.UTC(2026, 9, 30, 8, 0, n)).toISOString();

describe('importedItems', () => {
  const handle: AgentPersistenceHandle = { driverId: 'claude', data: { sessionId: 's' } };

  it('每一轮：用户消息、已完成的任务、回复与工具步骤（没有输出）；末尾一条导入提示', () => {
    const history: NativeSessionHistory = {
      nativeId: 's',
      cwd: '/work',
      title: 'Cut',
      persistence: handle,
      turns: [
        {
          user: 'Cut the intro',
          startedAt: at(1),
          endedAt: at(2),
          steps: [
            { kind: 'message', text: 'Done.' },
            { kind: 'tool', tool: 'command', title: 'ls', detail: 'List', status: 'failed' },
          ],
        },
        { user: 'Again', startedAt: null, endedAt: null, steps: [] },
      ],
    };
    const { items, note } = importedItems(history, {
      driverId: 'claude',
      at: at(9),
      notice: { text: 'Imported', key: 'k', params: {} } as never,
    });
    expect(items.map((item) => item.kind)).toEqual([
      'user-message',
      'task',
      'agent-message',
      'tool-call',
      'user-message',
      'task',
      'notice',
    ]);
    const [user, task, , tool, , second] = items as Array<Extract<TimelineItem, { kind: 'task' }> & Record<string, unknown>>;
    expect(user).toMatchObject({ text: 'Cut the intro', createdAt: at(1), taskId: task!.id });
    expect(task).toMatchObject({ status: 'completed', goal: 'Cut the intro', startedAt: at(1), endedAt: at(2) });
    expect(tool).toMatchObject({ tool: 'command', title: 'ls', detail: 'List', output: '', status: 'failed', taskId: task!.id });
    // 没有时刻的一轮按导入的时刻记。
    expect(second).toMatchObject({ startedAt: at(9), endedAt: at(9) });
    expect(note).toEqual({ driverId: 'claude', nativeId: 's', at: at(9), turns: 2, omitted: 0 });
    expect(items.at(-1)).toMatchObject({ kind: 'notice', level: 'info', taskId: null, imported: note });
  });

  it('只复制最近的几轮，略去的记在提示里；超长的消息截掉中间', () => {
    const turns = Array.from({ length: IMPORT_TURN_LIMIT + 5 }, (_, i) => ({
      user: `turn ${i}`,
      startedAt: null,
      endedAt: null,
      steps: [],
    }));
    turns.at(-1)!.user = `${'a'.repeat(IMPORT_TEXT_LIMIT)}${'z'.repeat(100)}`;
    const { items, note } = importedItems(
      { nativeId: 's', cwd: null, title: '', persistence: handle, turns },
      { driverId: 'claude', at: at(0), notice: { text: 'x' } as never },
    );
    expect(note).toMatchObject({ turns: IMPORT_TURN_LIMIT, omitted: 5 });
    const users = items.filter((item) => item.kind === 'user-message') as Array<{ text: string }>;
    expect(users[0]!.text).toBe('turn 5');
    const last = users.at(-1)!.text;
    expect(last.length).toBeLessThanOrEqual(IMPORT_TEXT_LIMIT);
    expect(last).toContain('\n[…]\n');
    expect(last.startsWith('aaa')).toBe(true);
    expect(last.endsWith('zzz')).toBe(true);
  });
});

// ---- 在 Harness 里导入 ----

const capabilities: DriverProbe['capabilities'] = { steer: false, approvals: true, resume: true, images: false };

/** `reply` 回一句话并结束回合。 */
class Session implements AgentSession {
  readonly id = newId('fake');
  readonly capabilities = capabilities;
  readonly inputs: string[] = [];
  readonly #listeners = new Set<(event: AgentEvent) => void>();
  readonly options: CreateSessionOptions;
  turnId: string | null = null;

  constructor(options: CreateSessionOptions) {
    this.options = options;
  }

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
    return this.options.resume;
  }

  async close() {}

  #emit(event: AgentEvent) {
    for (const listener of this.#listeners) listener(event);
  }
}

/** 本机会话按 `native` 给出；`fail` 时列不出来。 */
class Driver implements AgentDriver {
  readonly sessions: Session[] = [];
  readonly reads: string[] = [];
  native: Array<NativeSession & { history?: NativeSessionHistory['turns'] }> = [];
  fail = false;
  readonly id: DriverId;

  constructor(id: DriverId) {
    this.id = id;
  }

  async probe(): Promise<DriverProbe> {
    return {
      id: this.id,
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

  async createSession(options: CreateSessionOptions): Promise<AgentSession> {
    const session = new Session(options);
    this.sessions.push(session);
    return session;
  }

  async listNativeSessions(): Promise<NativeSession[]> {
    if (this.fail) throw new Error('boom');
    return this.native.map(({ history: _, ...session }) => session);
  }

  async readNativeSession(nativeId: string): Promise<NativeSessionHistory> {
    this.reads.push(nativeId);
    await new Promise((r) => setTimeout(r, 5));
    const found = this.native.find((s) => s.nativeId === nativeId);
    if (!found) throw Object.assign(new Error('missing'), { code: 'not-found' });
    const { nativeId: id, cwd, title, persistence } = found;
    return { nativeId: id, cwd, title, persistence, turns: found.history ?? [] };
  }
}

const handleOf = (sessionId: string): AgentPersistenceHandle => ({ driverId: 'claude', data: { sessionId } });
const native = (nativeId: string, cwd: string | null, n: number): NativeSession & { history: NativeSessionHistory['turns'] } => ({
  nativeId,
  cwd,
  title: `Session ${nativeId}`,
  turns: 1,
  updatedAt: at(n),
  persistence: handleOf(nativeId),
  history: [{ user: `Hello from ${nativeId}`, startedAt: at(1), endedAt: at(2), steps: [{ kind: 'message', text: 'Hi.' }] }],
});

let dir: string;
let home: RuntimeHome;
let harness: Harness;
let claude: Driver;
let codex: Driver;
let work: { project: string; plain: string; other: string };

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
};
const exists = (p: string) =>
  fs.stat(p).then(
    () => true,
    () => false,
  );
const importOf = (nativeId: string, adopt = false) =>
  harness.importConversation({ driverId: 'claude', nativeId, adopt, commandId: newId('cmd') });

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-import-')));
  home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') });
  work = { project: path.join(dir, 'work', 'promo'), plain: path.join(dir, 'work', 'plain'), other: path.join(dir, 'work', 'other') };
  for (const d of Object.values(work)) await fs.mkdir(d, { recursive: true });
  await fs.writeFile(path.join(work.plain, 'notes.txt'), 'mine');
  const drivers = new DriverRegistry();
  claude = new Driver('claude');
  codex = new Driver('codex');
  drivers.register(claude);
  drivers.register(codex);
  harness = await Harness.open({
    home,
    conversations: new ConversationStore(home.conversationsDir),
    projects: new ProjectStore(home.projectsFile),
    drivers,
    log: silentLogger,
  });
  await fs.mkdir(path.join(home.scratchDir, 'conv_old'), { recursive: true });
  claude.native = [
    native('in-project', work.project, 5),
    native('plain', work.plain, 9),
    native('no-folder', null, 3),
    native('gone', path.join(dir, 'work', 'gone'), 2),
    native('scratch', path.join(home.scratchDir, 'conv_old'), 1),
  ];
});

afterEach(async () => {
  await harness.shutdown();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Harness.listImportable', () => {
  it('各家最近的会话，新的在前；落点按目录：已是项目、可以接成项目、找不到（没给、不在了或是 BaoCut 自己的会话目录）', async () => {
    const project = await harness.openProject(work.project);
    codex.fail = true;
    const { sources, sessions } = await harness.listImportable();
    // 列不出来的一家不列，不影响别家。
    expect(sources).toEqual(['claude']);
    expect(sessions.map((s) => [s.nativeId, s.landing])).toEqual([
      ['plain', { kind: 'adopt', name: 'plain' }],
      ['in-project', { kind: 'project', projectId: project.id, projectName: project.name }],
      ['no-folder', { kind: 'missing' }],
      ['gone', { kind: 'missing' }],
      ['scratch', { kind: 'missing' }],
    ]);
    expect(sessions[0]).toMatchObject({ driverId: 'claude', title: 'Session plain', turns: 1, updatedAt: at(9), importedAs: null });
    expect(sessions[0]).not.toHaveProperty('persistence');

    const only = await harness.listImportable({ projectId: project.id });
    expect(only.sessions.map((s) => s.nativeId)).toEqual(['in-project']);
    await expect(harness.listImportable({ projectId: 'proj_missing' })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('导入过的标出是哪条会话；恢复句柄相同的（BaoCut 自己在跑的那条）也算', async () => {
    const conversation = await importOf('plain');
    claude.native.push({ ...native('alias', work.plain, 10), persistence: handleOf('plain') });
    const { sessions } = await harness.listImportable();
    expect(sessions.filter((s) => s.importedAs).map((s) => [s.nativeId, s.importedAs])).toEqual([
      ['alias', conversation.id],
      ['plain', conversation.id],
    ]);
  });
});

describe('Harness.importConversation', () => {
  it('不是项目的目录作为无项目会话：工作目录就是原目录，不建目录也不放进会话目录；条目、标题与恢复句柄都带上', async () => {
    const conversation = await importOf('plain');
    expect(conversation).toMatchObject({
      projectId: null,
      cwd: work.plain,
      driverId: 'claude',
      title: 'Session plain',
      importedFrom: { driverId: 'claude', nativeId: 'plain' },
      activity: 'idle',
    });
    expect(await exists(path.join(home.scratchDir, conversation.id))).toBe(false);
    const items = harness.getConversation(conversation.id).items;
    expect(items.map((item) => item.kind)).toEqual(['user-message', 'task', 'agent-message', 'notice']);
    expect(items.at(-1)).toMatchObject({ imported: { driverId: 'claude', nativeId: 'plain', turns: 1, omitted: 0 } });

    // 接着聊：在原目录里按恢复句柄续上原生会话。
    await harness.send({ conversationId: conversation.id, text: 'Continue', commandId: newId('cmd') });
    await until(() => claude.sessions[0]?.turnId !== null && claude.sessions[0]?.turnId !== undefined);
    expect(claude.sessions[0]!.options).toMatchObject({ cwd: work.plain, resume: handleOf('plain') });
    claude.sessions[0]!.reply('Sure.');
    await until(() => harness.getConversation(conversation.id).conversation.activity === 'idle');
  });

  it('同一个命令、同一条会话、同时来的都只导入一次', async () => {
    const [a, b] = await Promise.all([importOf('plain'), importOf('plain')]);
    expect(b.id).toBe(a.id);
    expect(claude.reads).toEqual(['plain']);
    expect((await importOf('plain')).id).toBe(a.id);
    const commandId = newId('cmd');
    const c = await harness.importConversation({ driverId: 'claude', nativeId: 'in-project', adopt: false, commandId });
    expect((await harness.importConversation({ driverId: 'claude', nativeId: 'in-project', adopt: false, commandId })).id).toBe(c.id);
    expect(claude.reads).toEqual(['plain', 'in-project']);
  });

  it('已是项目的落进项目；勾了接成项目的登记那个目录；找不到目录的拒绝', async () => {
    const project = await harness.openProject(work.project);
    expect(await importOf('in-project')).toMatchObject({ projectId: project.id, cwd: project.path });
    const adopted = await importOf('plain', true);
    const registered = harness.listProjects().find((p) => p.id === adopted.projectId);
    expect(registered?.path).toBe(work.plain);
    expect(adopted.cwd).toBe(work.plain);
    await expect(importOf('no-folder')).rejects.toMatchObject({ code: 'not-found' });
    await expect(importOf('gone')).rejects.toMatchObject({ code: 'not-found' });
    await expect(importOf('scratch')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('放进项目时把原目录接成项目，不新建目录、不搬东西；目录不在了时 not-found', async () => {
    const conversation = await importOf('plain');
    const project = await harness.ensureConversationProject(conversation.id);
    expect(project.path).toBe(work.plain);
    expect(harness.getConversation(conversation.id).conversation).toMatchObject({ projectId: project.id, cwd: work.plain });
    expect(await fs.readFile(path.join(work.plain, 'notes.txt'), 'utf8')).toBe('mine');

    claude.native.push(native('other', work.other, 11));
    const other = await importOf('other');
    await fs.rm(work.other, { recursive: true });
    await expect(harness.ensureConversationProject(other.id)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('删掉导入的会话不动原目录；有共用它的分叉时先把目录接成项目，分叉跟着进项目', async () => {
    const lone = await importOf('plain');
    await harness.deleteConversation(lone.id);
    expect(await fs.readFile(path.join(work.plain, 'notes.txt'), 'utf8')).toBe('mine');
    expect(harness.listProjects()).toEqual([]);

    const source = await importOf('plain');
    const taskId = harness.getConversation(source.id).items.find((item) => item.kind === 'task')!.taskId!;
    const fork = await harness.forkConversation({ conversationId: source.id, taskId, commandId: newId('cmd') });
    expect(fork).toMatchObject({ projectId: null, cwd: work.plain, folderOf: source.id });
    await harness.deleteConversation(source.id);
    const after = harness.getConversation(fork.id).conversation;
    expect(after.folderOf).toBeUndefined();
    expect(harness.listProjects().find((p) => p.id === after.projectId)?.path).toBe(work.plain);
    expect(after.cwd).toBe(work.plain);
    expect(await fs.readFile(path.join(work.plain, 'notes.txt'), 'utf8')).toBe('mine');
  });
});
