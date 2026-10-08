import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RpcError,
  SETTING_DEFAULTS,
  customAgentProviderView,
  driverAvailability,
  newId,
  nowIso,
  type CustomAgentProvider,
  type DriverId,
  type DriverProbe,
  type FrozenSettings,
  type Id,
  type SettingKey,
  type SettingSource,
  type SettingValues,
} from '@baocut/protocol';
import {
  AgentPrefsStore,
  AgentProviderStore,
  ConversationStore,
  ProjectStore,
  resolveRuntimeHome,
  type RuntimeHome,
} from '@baocut/runtime-storage';
import { DriverRegistry } from './agent-manager.ts';
import type { AgentDriver, AgentEvent, AgentSession, DriverDescription } from './driver.ts';
import { Harness } from './harness.ts';
import { silentLogger } from './logger.ts';

/**
 * 用户添加的智能体（`agents.addProvider` / `removeProvider`，架构设计 §3.11）与没有逐次审批通道的 Driver 的访问模式门禁（§3.12）。
 * Driver 全是假的，文件都在临时目录里。
 */

class Session implements AgentSession {
  readonly id = newId('fake');
  readonly capabilities: DriverProbe['capabilities'];
  readonly #listeners = new Set<(event: AgentEvent) => void>();
  turnId: string | null = null;
  closed = false;

  constructor(capabilities: DriverProbe['capabilities']) {
    this.capabilities = capabilities;
  }

  async startTurn(): Promise<{ turnId: string }> {
    this.turnId = newId('turn');
    const turnId = this.turnId;
    setTimeout(() => this.#emit({ type: 'turn.started', turnId }), 1);
    return { turnId };
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

  async close() {
    this.closed = true;
  }

  #emit(event: AgentEvent) {
    for (const listener of this.#listeners) listener(event);
  }
}

class FakeDriver implements AgentDriver {
  readonly id: DriverId;
  readonly sessions: Session[] = [];
  readonly #name: string;
  readonly #approvals: boolean;

  constructor(id: DriverId, options: { name?: string; approvals?: boolean } = {}) {
    this.id = id;
    this.#name = options.name ?? `Fake ${id}`;
    this.#approvals = options.approvals ?? true;
  }

  describe(): DriverDescription {
    return {
      id: this.id,
      name: this.#name,
      command: this.id,
      minVersion: '',
      plan: '',
      loginCommand: null,
      install: [],
      verified: true,
      tested: false,
      capabilities: {
        steer: false,
        approvals: this.#approvals,
        resume: false,
        images: false,
      },
    };
  }

  async probe(): Promise<DriverProbe> {
    return {
      ...this.describe(),
      state: 'ready',
      ...driverAvailability('ready'),
      version: null,
      latestVersion: null,
      detail: null,
      executable: `/usr/local/bin/${this.id}`,
      realExecutable: null,
      account: null,
      models: [],
      configModel: null,
      configModelKnown: null,
      checkedAt: nowIso(),
    };
  }

  async createSession(): Promise<AgentSession> {
    const session = new Session(this.describe().capabilities);
    this.sessions.push(session);
    return session;
  }
}

/** 内存里的偏好设置：能读能写，记下写入。 */
class Settings {
  readonly values: Partial<SettingValues> = {};
  readonly writes: unknown[] = [];

  snapshot<K extends SettingKey>(keys: readonly K[]): FrozenSettings<K> {
    const values = {} as Pick<SettingValues, K>;
    const sources = {} as Record<K, SettingSource>;
    for (const key of keys) {
      const set = key in this.values;
      values[key] = (set ? this.values[key] : SETTING_DEFAULTS[key]) as SettingValues[K];
      sources[key] = set ? 'user' : 'default';
    }
    return { values, sources };
  }

  async set(patch: unknown): Promise<void> {
    this.writes.push(patch);
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      if (value === null) delete (this.values as Record<string, unknown>)[key];
      else (this.values as Record<string, unknown>)[key] = value;
    }
  }
}

let dir: string;
let home: RuntimeHome;
let harness: Harness | null;
let settings: Settings;
let store: AgentProviderStore;
let created: FakeDriver[];

async function open(builtins: FakeDriver[], options: { approvalsOf?: (p: CustomAgentProvider) => boolean } = {}): Promise<Harness> {
  const registry = new DriverRegistry();
  for (const driver of builtins) registry.register(driver);
  store = new AgentProviderStore(home.agentProvidersFile);
  const create = (provider: CustomAgentProvider) => {
    const driver = new FakeDriver(provider.id, {
      name: provider.name,
      approvals: options.approvalsOf?.(provider) ?? true,
    });
    created.push(driver);
    return driver;
  };
  for (const provider of await store.load())
    registry.register(create(provider), {
      custom: customAgentProviderView(provider),
    });
  harness = await Harness.open({
    home,
    conversations: new ConversationStore(home.conversationsDir),
    projects: new ProjectStore(home.projectsFile),
    drivers: registry,
    settings,
    providers: { store, create },
    log: silentLogger,
  });
  return harness;
}

async function until<T>(read: () => T | null | undefined | false, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function rejection(promise: Promise<unknown> | (() => unknown)): Promise<RpcError> {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw error;
  }
  throw new Error('应该被拒绝');
}

const pinned = {
  id: 'gemini-pinned',
  name: 'Gemini 0.52',
  command: ['npx', '-y', '@google/gemini-cli@0.52.0', '--acp'],
};

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-agent-providers-')));
  home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') });
  harness = null;
  settings = new Settings();
  created = [];
});

afterEach(async () => {
  await harness?.shutdown();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('添加智能体', () => {
  it('存进 agent-providers.json、注册成 Driver；视图里标为 custom，环境变量只给名字', async () => {
    const h = await open([new FakeDriver('codex')]);
    const view = await h.addProvider({
      ...pinned,
      env: { GEMINI_API_KEY: 'secret-value' },
      commandId: 'cmd-1',
    });
    expect(view.checking).toContain('gemini-pinned');
    const listed = await until(() => h.agentsSnapshot().drivers.find((d) => d.id === 'gemini-pinned'));
    expect(listed).toMatchObject({
      name: 'Gemini 0.52',
      source: 'custom',
      tested: false,
    });
    expect(listed.custom).toMatchObject({
      command: pinned.command,
      envKeys: ['GEMINI_API_KEY'],
    });
    expect(JSON.stringify(h.agentsSnapshot())).not.toContain('secret-value');
    expect(h.agentsSnapshot().drivers.find((d) => d.id === 'codex')).toMatchObject({ source: 'builtin', custom: null });

    const file = JSON.parse(await fs.readFile(home.agentProvidersFile, 'utf8'));
    expect(file).toMatchObject({
      schemaVersion: 1,
      providers: [{ id: 'gemini-pinned', env: { GEMINI_API_KEY: 'secret-value' } }],
    });
    if (process.platform !== 'win32') expect((await fs.stat(home.agentProvidersFile)).mode & 0o777).toBe(0o600);

    // 同一个 commandId 重试：同一结果，不重复添加；另一个 commandId 是重名。
    await h.addProvider({ ...pinned, commandId: 'cmd-1' });
    expect(created).toHaveLength(1);
    const dup = await rejection(h.addProvider({ ...pinned, commandId: 'cmd-2' }));
    expect(dup.code).toBe('conflict');
    expect(dup.details).toMatchObject({ code: 'AGENT_PROVIDER_EXISTS' });
    expect((await rejection(h.addProvider({ ...pinned, id: 'codex' }))).code).toBe('invalid-request');
  });

  it('重启后从存储载入，探测缓存里它的条目照常认得', async () => {
    let h = await open([new FakeDriver('codex')]);
    await h.addProvider(pinned);
    await until(() => h.agentsSnapshot().drivers.some((d) => d.id === 'gemini-pinned'));
    await h.shutdown();
    harness = null;
    expect(JSON.parse(await fs.readFile(home.agentProbesFile, 'utf8')).drivers['gemini-pinned']).toMatchObject({ state: 'ready' });

    h = await open([new FakeDriver('codex')]);
    // 缓存里的结果立刻可见（不在 checking 里）。
    expect(h.agentsSnapshot().checking).not.toContain('gemini-pinned');
    expect(h.agentsSnapshot().drivers.find((d) => d.id === 'gemini-pinned')).toMatchObject({ source: 'custom', name: 'Gemini 0.52' });
  });
});

describe('移除智能体', () => {
  it('清掉偏好、探测缓存与指向它的默认 Agent；进行中的任务失败，之后发送以 driver-unavailable 拒绝', async () => {
    const h = await open([new FakeDriver('codex')]);
    await h.addProvider(pinned);
    await until(() => h.agentsSnapshot().drivers.some((d) => d.id === 'gemini-pinned'));
    await h.configureAgent({
      driverId: 'gemini-pinned',
      enabled: true,
      defaultEffort: null,
    });
    await new AgentPrefsStore(home.agentPrefsFile).load().then((p) => expect(p.drivers['gemini-pinned']).toBeTruthy());
    settings.values['agent.defaultDriver'] = 'gemini-pinned';

    const conversation = await h.createConversation({});
    expect(conversation.driverId).toBe('gemini-pinned');
    const { taskId } = await h.send({
      conversationId: conversation.id,
      text: '你好',
      commandId: newId('cmd'),
    });
    const session = await until(() => created[0]!.sessions[0]);
    await until(() => session.turnId);

    const view = await h.removeProvider('gemini-pinned');
    expect(view.drivers.map((d) => d.id)).toEqual(['codex']);
    expect(view.preferences.drivers['gemini-pinned']).toBeUndefined();
    expect(settings.writes).toEqual([{ 'agent.defaultDriver': null }]);
    expect(session.closed).toBe(true);
    const task = h.getConversation(conversation.id).items.find((i) => i.kind === 'task' && i.id === taskId);
    expect(task).toMatchObject({ status: 'failed' });
    expect(await store.load()).toEqual([]);
    await h.shutdown();
    harness = null;
    expect(JSON.parse(await fs.readFile(home.agentProbesFile, 'utf8')).drivers['gemini-pinned']).toBeUndefined();

    const reopened = await open([new FakeDriver('codex')]);
    const refused = await rejection(() =>
      reopened.send({
        conversationId: conversation.id,
        text: '还在吗',
        commandId: newId('cmd'),
      }),
    );
    expect(refused.code).toBe('driver-unavailable');
    // 没建任务。
    expect(reopened.getConversation(conversation.id).conversation.activeTaskId).toBeNull();
  });

  it('内置的不能移除；没有的为 not-found；未注册的 id 不能设为默认', async () => {
    const h = await open([new FakeDriver('codex')]);
    const builtin = await rejection(h.removeProvider('codex'));
    expect(builtin.code).toBe('invalid-request');
    expect(builtin.details).toMatchObject({ code: 'AGENT_PROVIDER_BUILTIN' });
    expect((await rejection(h.removeProvider('nobody'))).code).toBe('not-found');
    expect((await rejection(() => h.assertDriverRegistered('nobody'))).code).toBe('driver-unavailable');
    expect((await rejection(h.configureAgent({ driverId: 'opencode', enabled: false }))).code).toBe('driver-unavailable');
  });
});

describe('没有逐次审批通道的 Driver 只能 fullAccess', () => {
  async function fullOnly(): Promise<{ h: Harness; conversationId: Id }> {
    const h = await open([new FakeDriver('codex'), new FakeDriver('pi', { name: 'Pi', approvals: false })]);
    await h.agents();
    const conversation = await h.createConversation({ driverId: 'pi' });
    return { h, conversationId: conversation.id };
  }

  it('发送时模式不是 fullAccess：以 AGENT_ACCESS_MODE_UNSUPPORTED 拒绝，不建任务、不改会话的模式', async () => {
    const { h, conversationId } = await fullOnly();
    // 默认模式（auto）。
    const byDefault = await rejection(() => h.send({ conversationId, text: 'a', commandId: newId('cmd') }));
    expect(byDefault.code).toBe('conflict');
    expect(byDefault.details).toMatchObject({
      code: 'AGENT_ACCESS_MODE_UNSUPPORTED',
      driverId: 'pi',
      mode: 'auto',
      supportedModes: ['fullAccess'],
    });
    expect(byDefault.message).toContain('Pi');
    const explicit = await rejection(() =>
      h.send({
        conversationId,
        text: 'a',
        commandId: newId('cmd'),
        accessMode: 'ask',
      }),
    );
    expect(explicit.details).toMatchObject({ mode: 'ask' });
    const snapshot = h.getConversation(conversationId);
    expect(snapshot.conversation.accessMode).toBeNull();
    expect(snapshot.items).toEqual([]);

    // fullAccess 照常。
    await h.send({
      conversationId,
      text: 'a',
      commandId: newId('cmd'),
      accessMode: 'fullAccess',
    });
    expect(h.getConversation(conversationId).conversation.activeTaskId).not.toBeNull();
  });

  it('建会话与切换模式时显式给出别的模式同样拒绝；fullAccess 与跟随设置可以', async () => {
    const { h, conversationId } = await fullOnly();
    expect((await rejection(h.createConversation({ driverId: 'pi', accessMode: 'ask' }))).details).toMatchObject({
      code: 'AGENT_ACCESS_MODE_UNSUPPORTED',
    });
    expect((await rejection(h.updateConversation({ conversationId, accessMode: 'plan' }))).code).toBe('conflict');
    await h.updateConversation({ conversationId, accessMode: 'fullAccess' });
    await h.updateConversation({ conversationId, accessMode: null });
    // 有逐次审批通道的不受影响。
    const codex = await h.createConversation({
      driverId: 'codex',
      accessMode: 'ask',
    });
    expect(codex.accessMode).toBe('ask');
  });
});
