import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  driverAvailability,
  newId,
  nowIso,
  type AgentsEvent,
  type DriverId,
  type DriverProbe,
  type SequencedEvent,
} from '@baocut/protocol';
import {
  AgentPrefsStore,
  AgentProbeStore,
  ConversationStore,
  ProjectStore,
  resolveRuntimeHome,
  type RuntimeHome,
} from '@baocut/runtime-storage';
import { DriverRegistry } from './agent-manager.ts';
import type { AgentDriver, AgentSession, DriverDescription, ProbeOptions } from './driver.ts';
import { Harness } from './harness.ts';
import { silentLogger } from './logger.ts';

/** Agent 探测的缓存、后台刷新、`agents` 主题与运行中的纠正（架构设计 §3.11）。Driver 全是假的，文件都在临时目录里。 */

interface Gate {
  promise: Promise<void>;
  open: () => void;
}

function gate(): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

class FakeDriver implements AgentDriver {
  readonly id: DriverId;
  readonly verified: boolean;
  readonly slowProbe: boolean;
  readonly calls: ProbeOptions[] = [];
  /** 给了就等它打开再返回：模拟慢的探测。 */
  hold: Gate | null = null;
  fail: string | null = null;
  state: DriverProbe['state'] = 'ready';
  version = '1.0.0';
  /** createSession 抛的错（带 agentCode）。 */
  sessionError: (Error & { agentCode?: string }) | null = null;
  /** 给了就当探测时间：模拟很久没探过的结果。 */
  checkedAt: string | null = null;

  constructor(id: DriverId, verified = true, slowProbe = false) {
    this.id = id;
    this.verified = verified;
    this.slowProbe = slowProbe;
  }

  describe(): DriverDescription {
    return {
      id: this.id,
      name: `Fake ${this.id}`,
      command: this.id,
      minVersion: '1.0.0',
      plan: '订阅',
      loginCommand: `${this.id} login`,
      install: [],
      verified: this.verified,
      tested: this.verified,
      capabilities: { steer: false, approvals: true, resume: false, images: true },
    };
  }

  async probe(options: ProbeOptions = {}): Promise<DriverProbe> {
    this.calls.push(options);
    const hold = this.hold;
    if (hold) await hold.promise;
    if (this.fail) throw new Error(this.fail);
    return {
      ...this.describe(),
      state: this.state,
      ...driverAvailability(this.state),
      version: this.version,
      latestVersion: null,
      detail: null,
      executable: options.executable ?? `/usr/local/bin/${this.id}`,
      realExecutable: null,
      account: null,
      models: [{ id: 'm1', label: 'M1', description: null, tier: null, isDefault: true, efforts: [], defaultEffort: null }],
      configModel: null,
      configModelKnown: null,
      checkedAt: this.checkedAt ?? nowIso(),
    };
  }

  async createSession(): Promise<AgentSession> {
    if (this.sessionError) throw this.sessionError;
    throw new Error('这个测试不开会话');
  }
}

let dir: string;
let home: RuntimeHome;
let harness: Harness | null;
let events: AgentsEvent[];

async function open(drivers: FakeDriver[]): Promise<Harness> {
  const registry = new DriverRegistry();
  for (const driver of drivers) registry.register(driver);
  const opened = await Harness.open({
    home,
    conversations: new ConversationStore(home.conversationsDir),
    projects: new ProjectStore(home.projectsFile),
    drivers: registry,
    log: silentLogger,
  });
  events = [];
  opened.subscribe('agents', undefined, (event) => events.push((event as SequencedEvent<AgentsEvent>).event));
  harness = opened;
  return opened;
}

async function seed(drivers: Record<string, Record<string, unknown>>): Promise<void> {
  await fs.mkdir(path.dirname(home.agentProbesFile), { recursive: true });
  await fs.writeFile(home.agentProbesFile, JSON.stringify({ schemaVersion: 1, drivers }));
}

function stored(state: string, version: string, executableOverride: string | null = null): Record<string, unknown> {
  return {
    state,
    version,
    executable: '/old/bin',
    realExecutable: null,
    account: null,
    models: [],
    configModel: null,
    configModelKnown: null,
    latestVersion: null,
    detail: null,
    checkedAt: '2026-10-01T00:00:00.000Z',
    executableOverride,
  };
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

const lastView = () => events.at(-1)?.view ?? null;

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-agent-probes-')));
  home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') });
  harness = null;
});

afterEach(async () => {
  await harness?.shutdown();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Agent 探测缓存', () => {
  it('从磁盘缓存起步：agents.list 立刻返回上次的结果，不等后台探测；探完推送新结果并写回文件', async () => {
    await seed({ codex: stored('signed-out', '0.9.0') });
    const codex = new FakeDriver('codex');
    codex.hold = gate();
    const h = await open([codex]);

    const view = await h.agents();
    expect(view.checking).toEqual([]);
    expect(view.drivers).toHaveLength(1);
    // 本机事实来自缓存，常量来自 describe()，status 由 state 推出。
    expect(view.drivers[0]).toMatchObject({
      id: 'codex',
      state: 'signed-out',
      version: '0.9.0',
      name: 'Fake codex',
      status: 'unavailable',
      verified: true,
    });
    expect(codex.calls).toHaveLength(1);

    codex.hold.open();
    await until(() => lastView()?.drivers[0]?.state === 'ready');
    expect(lastView()!.drivers[0]).toMatchObject({ version: '1.0.0', status: 'available' });

    await h.shutdown();
    harness = null;
    const file = JSON.parse(await fs.readFile(home.agentProbesFile, 'utf8'));
    expect(file.drivers.codex).toMatchObject({ state: 'ready', version: '1.0.0', executableOverride: null });
    // 只存本机事实，不存 Driver 的常量。
    expect(file.drivers.codex.name).toBeUndefined();
    expect(file.drivers.codex.install).toBeUndefined();
    expect(file.drivers.codex.capabilities).toBeUndefined();
  });

  it('没有缓存：探测快的等它探完，要拉起智能体进程的（slowProbe）列在 checking；慢的不挡快的，各自完成各自推送', async () => {
    const codex = new FakeDriver('codex');
    const gemini = new FakeDriver('gemini', true, true);
    gemini.hold = gate();
    const h = await open([codex, gemini]);

    const view = await h.agents();
    expect(view.drivers.map((d) => d.id)).toEqual(['codex']);
    expect(view.checking).toEqual(['gemini']);
    await until(() => lastView()?.drivers.some((d) => d.id === 'codex'));
    expect(lastView()!.checking).toEqual(['gemini']);
    // 同一个 Driver 的刷新共用一次探测：启动刷新与 agents.list 只探了一次。
    expect(gemini.calls).toHaveLength(1);

    gemini.hold.open();
    await until(() => lastView()?.checking.length === 0);
    expect(lastView()!.drivers.map((d) => d.id)).toEqual(['codex', 'gemini']);
    expect(h.agentsSnapshot().drivers.find((d) => d.id === 'gemini')).toMatchObject({ verified: true, state: 'ready' });
  });

  it('一个 Driver 的探测抛错记成 error，不影响别的', async () => {
    const claude = new FakeDriver('claude');
    claude.fail = '炸了';
    const codex = new FakeDriver('codex');
    const h = await open([claude, codex]);

    const view = await h.agents();
    expect(view.checking).toEqual([]);
    expect(view.drivers.find((d) => d.id === 'claude')).toMatchObject({ state: 'error', status: 'unavailable', name: 'Fake claude' });
    expect(view.drivers.find((d) => d.id === 'claude')!.detail).toContain('炸了');
    expect(view.drivers.find((d) => d.id === 'codex')).toMatchObject({ state: 'ready' });
  });

  it('detect 强制探测并等它完成（可以只探一个），返回前推送', async () => {
    const claude = new FakeDriver('claude');
    const codex = new FakeDriver('codex');
    const h = await open([claude, codex]);
    await h.agents();
    expect(claude.calls).toHaveLength(1);

    codex.version = '2.0.0';
    codex.hold = gate();
    const detecting = h.agents({ fresh: true, driverId: 'codex' });
    let settled = false;
    void detecting.then(() => (settled = true));
    await until(() => codex.calls.length === 2);
    expect(settled).toBe(false);
    expect(codex.calls[1]).toMatchObject({ force: true });
    const before = events.length;
    codex.hold.open();
    const view = await detecting;
    expect(view.drivers.find((d) => d.id === 'codex')!.version).toBe('2.0.0');
    expect(events.length).toBeGreaterThan(before);
    expect(lastView()!.drivers.find((d) => d.id === 'codex')!.version).toBe('2.0.0');
    // 只探了 codex。
    expect(claude.calls).toHaveLength(1);

    await h.agents({ fresh: true });
    expect(claude.calls).toHaveLength(2);
    expect(codex.calls).toHaveLength(3);
  });

  it('强制探测顶替进行中的普通探测：旧的结果回来时丢掉', async () => {
    const codex = new FakeDriver('codex');
    codex.hold = gate();
    codex.version = '1.0.0';
    const h = await open([codex]);
    const first = codex.hold;
    await until(() => codex.calls.length === 1);

    codex.hold = null;
    codex.version = '3.0.0';
    await h.agents({ fresh: true });
    expect(h.agentsSnapshot().drivers[0]!.version).toBe('3.0.0');
    codex.version = '1.0.0';
    first.open();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.agentsSnapshot().drivers[0]!.version).toBe('3.0.0');
  });

  it('改可执行文件：丢掉旧结果，只重新探测这一个，带上新的可执行文件', async () => {
    const claude = new FakeDriver('claude');
    const codex = new FakeDriver('codex');
    const h = await open([claude, codex]);
    await h.agents();
    expect([claude.calls.length, codex.calls.length]).toEqual([1, 1]);

    const view = await h.configureAgent({ driverId: 'codex', executable: '/opt/codex' });
    expect(view.drivers.find((d) => d.id === 'codex')).toMatchObject({ executable: '/opt/codex', executableOverride: '/opt/codex' });
    expect(codex.calls).toHaveLength(2);
    expect(codex.calls[1]).toMatchObject({ executable: '/opt/codex' });
    expect(claude.calls).toHaveLength(1);
  });

  it('缓存里的可执行文件与偏好不一致时丢弃那一条', async () => {
    const prefs = new AgentPrefsStore(home.agentPrefsFile);
    await prefs.load();
    await prefs.update((p) => {
      p.drivers.codex = { enabled: true, defaultModel: null, defaultEffort: null, executable: '/new/codex' };
    });
    await seed({ codex: stored('ready', '0.5.0', '/old/codex'), claude: stored('ready', '0.6.0') });
    const codex = new FakeDriver('codex');
    codex.hold = gate();
    const claude = new FakeDriver('claude');
    claude.hold = gate();
    const h = await open([codex, claude]);

    const snapshot = h.agentsSnapshot();
    expect(snapshot.drivers.map((d) => d.id)).toEqual(['claude']);
    expect(snapshot.checking).toEqual(['codex']);
    codex.hold.open();
    claude.hold.open();
  });

  it('缓存文件坏了当没有缓存', async () => {
    await fs.mkdir(path.dirname(home.agentProbesFile), { recursive: true });
    await fs.writeFile(home.agentProbesFile, '{ 这不是 JSON');
    const codex = new FakeDriver('codex');
    codex.hold = gate();
    const h = await open([codex]);
    expect(h.agentsSnapshot()).toMatchObject({ drivers: [], checking: ['codex'] });
    codex.hold.open();
    expect((await h.agents()).drivers[0]).toMatchObject({ state: 'ready' });
    await h.shutdown();
    harness = null;
    expect(await new AgentProbeStore(home.agentProbesFile).load()).toHaveProperty('codex');
  });

  it('偏好变化推送新视图', async () => {
    const h = await open([new FakeDriver('codex')]);
    await h.agents();
    const before = events.length;
    await h.updateAgentPreferences({ modelAutoUpdate: false });
    expect(events.length).toBe(before + 1);
    expect(lastView()!.preferences.modelAutoUpdate).toBe(false);
    await h.configureAgent({ driverId: 'codex', enabled: false });
    expect(lastView()!.drivers[0]).toMatchObject({ enabled: false, state: 'disabled' });
  });

  it('便宜的纠正：缓存说不可用且超过 60 秒没探过的 Driver，agents.list 与会话创建时后台再探；slowProbe 的不探', async () => {
    const codex = new FakeDriver('codex');
    codex.state = 'signed-out';
    codex.checkedAt = '2026-10-01T00:00:00.000Z';
    const gemini = new FakeDriver('gemini', true, true);
    gemini.state = 'signed-out';
    gemini.checkedAt = '2026-10-01T00:00:00.000Z';
    const h = await open([codex, gemini]);
    await until(() => lastView()?.drivers.length === 2);
    expect(codex.calls).toHaveLength(1);

    await h.createConversation({ driverId: 'codex' });
    await until(() => codex.calls.length === 2);
    expect(codex.calls[1]).not.toMatchObject({ force: true });
    await h.agents();
    await until(() => codex.calls.length === 3);
    expect(gemini.calls).toHaveLength(1);
  });

  it('会话以 AGENT_AUTH_REQUIRED 失败：后台强制重新探测这个 Driver 并推送', async () => {
    const codex = new FakeDriver('codex');
    const claude = new FakeDriver('claude');
    const h = await open([codex, claude]);
    await h.agents();
    expect(h.agentsSnapshot().drivers.find((d) => d.id === 'codex')!.state).toBe('ready');

    codex.sessionError = Object.assign(new Error('需要登录'), { agentCode: 'AGENT_AUTH_REQUIRED' });
    codex.state = 'signed-out';
    const conversation = await h.createConversation({ driverId: 'codex' });
    await h.send({ conversationId: conversation.id, text: '你好', commandId: newId('cmd') });

    await until(() => lastView()?.drivers.find((d) => d.id === 'codex')?.state === 'signed-out');
    expect(codex.calls.at(-1)).toMatchObject({ force: true });
    expect(codex.calls).toHaveLength(2);
    expect(claude.calls).toHaveLength(1);
    const task = h.getConversation(conversation.id).items.find((item) => item.kind === 'task');
    expect(task).toMatchObject({ status: 'failed', errorCode: 'AGENT_AUTH_REQUIRED' });
  });
});
