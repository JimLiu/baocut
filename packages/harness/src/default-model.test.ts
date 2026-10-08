import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_DEFAULT_MODEL,
  defaultSettingsSnapshot,
  driverAvailability,
  nowIso,
  type DriverId,
  type DriverModel,
  type DriverProbe,
  type SettingKey,
  type SettingValues,
} from '@baocut/protocol';
import { ConversationStore, ProjectStore, resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { DriverRegistry } from './agent-manager.ts';
import type { AgentDriver, AgentSession, DriverDescription } from './driver.ts';
import { Harness } from './harness.ts';
import { silentLogger } from './logger.ts';

/**
 * 新会话的默认模型（架构设计 §3.11，2026-09-29 用户裁决）：没设过时用推荐模型——Claude Code 的 Sonnet、Codex 的 `-sol`，
 * 不按 CLI 配置落到最贵的模型上；只有明确选了「Agent 默认模型」才不传模型。Driver 是假的，模型表照两家 CLI 的次序摆。
 */

const model = (id: string, patch: Partial<DriverModel> = {}): DriverModel => ({
  id,
  label: id,
  description: null,
  tier: null,
  isDefault: false,
  efforts: [],
  defaultEffort: null,
  ...patch,
});

/** Claude Code 的表：CLI 标的默认是 Opus，Fable 排在 Sonnet 前面。 */
const CLAUDE_MODELS = [
  model('opus', { tier: 'max', isDefault: true }),
  model('claude-fable-5-1[1m]', { tier: 'max' }),
  model('sonnet', { tier: 'balanced' }),
  model('haiku', { tier: 'fast' }),
];
/** Codex 的表：新版的 `-sol` 在前，默认标在最强的那一档上。 */
const CODEX_MODELS = [
  model('gpt-6-astra', { tier: 'max', isDefault: true }),
  model('gpt-6-sol', { tier: 'balanced' }),
  model('gpt-5.6-sol', { tier: 'balanced' }),
];

class ModelsDriver implements AgentDriver {
  readonly id: DriverId;
  readonly verified = true;
  models: DriverModel[];

  constructor(id: DriverId, models: DriverModel[]) {
    this.id = id;
    this.models = models;
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
      verified: true,
      tested: true,
      capabilities: { steer: false, approvals: true, resume: false, images: true },
    };
  }

  async probe(): Promise<DriverProbe> {
    return {
      ...this.describe(),
      state: 'ready',
      ...driverAvailability('ready'),
      version: '1.0.0',
      latestVersion: null,
      detail: null,
      executable: `/usr/local/bin/${this.id}`,
      realExecutable: null,
      account: null,
      models: this.models,
      configModel: null,
      configModelKnown: null,
      checkedAt: nowIso(),
    };
  }

  async createSession(): Promise<AgentSession> {
    throw new Error('这个测试不开会话');
  }
}

let dir: string;
let home: RuntimeHome;
let harness: Harness | null;
let settings: Partial<SettingValues>;

async function open(drivers: ModelsDriver[]): Promise<Harness> {
  const registry = new DriverRegistry();
  for (const driver of drivers) registry.register(driver);
  harness = await Harness.open({
    home,
    conversations: new ConversationStore(home.conversationsDir),
    projects: new ProjectStore(home.projectsFile),
    drivers: registry,
    log: silentLogger,
    settings: {
      snapshot: <K extends SettingKey>(keys: readonly K[]) => {
        const frozen = defaultSettingsSnapshot(keys);
        for (const key of keys) if (key in settings) (frozen.values as Record<string, unknown>)[key] = settings[key];
        return frozen;
      },
    },
  });
  // 先让探测落进缓存：会话创建读的是缓存里的模型表。
  await harness.agents();
  return harness;
}

const claude = () => new ModelsDriver('claude', CLAUDE_MODELS);
const codex = () => new ModelsDriver('codex', CODEX_MODELS);
const defaultOf = (h: Harness, id: DriverId) => h.agentsSnapshot().drivers.find((d) => d.id === id)!.defaultModel;

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-default-model-')));
  home = resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') });
  harness = null;
  settings = {};
});

afterEach(async () => {
  await harness?.shutdown();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('新会话的默认模型', () => {
  it('没设过：Claude Code 用 Sonnet、Codex 用第一个 -sol，界面读到的默认就是它', async () => {
    const h = await open([claude(), codex()]);
    expect(defaultOf(h, 'claude')).toBe('sonnet');
    expect(defaultOf(h, 'codex')).toBe('gpt-6-sol');
    expect((await h.createConversation({ driverId: 'claude' })).model).toBe('sonnet');
    expect((await h.createConversation({})).model).toBe('gpt-6-sol');
  });

  it('其余几家：第一个 balanced，再是 Agent 标的默认，再是第一个；模型表为空时不传模型', async () => {
    const pi = new ModelsDriver('pi', [model('a'), model('b', { tier: 'balanced' }), model('c', { isDefault: true })]);
    const kimi = new ModelsDriver('kimi', [model('k1'), model('k2', { isDefault: true })]);
    const grok = new ModelsDriver('grok', [model('g1'), model('g2')]);
    const gemini = new ModelsDriver('gemini', []);
    const h = await open([pi, kimi, grok, gemini]);
    expect(defaultOf(h, 'pi')).toBe('b');
    expect(defaultOf(h, 'kimi')).toBe('k2');
    expect(defaultOf(h, 'grok')).toBe('g1');
    expect(defaultOf(h, 'gemini')).toBeNull();
    expect((await h.createConversation({ driverId: 'gemini' })).model).toBeNull();
  });

  it('会话草稿明确选了「Agent 默认模型」（model: null）：不传模型', async () => {
    const h = await open([claude()]);
    expect((await h.createConversation({ driverId: 'claude', model: null })).model).toBeNull();
  });

  it('设置里选「Agent 默认模型」存成 AGENT_DEFAULT_MODEL：视图里是 null，新会话不传模型；改选具体模型照常', async () => {
    const h = await open([claude()]);
    const view = await h.configureAgent({ driverId: 'claude', defaultModel: null });
    expect(view.preferences.drivers.claude?.defaultModel).toBe(AGENT_DEFAULT_MODEL);
    expect(view.drivers[0]!.defaultModel).toBeNull();
    expect((await h.createConversation({ driverId: 'claude' })).model).toBeNull();
    // 只改强度：仍是 Agent 默认模型。
    await h.configureAgent({ driverId: 'claude', defaultEffort: null });
    expect(defaultOf(h, 'claude')).toBeNull();

    await h.configureAgent({ driverId: 'claude', defaultModel: 'opus' });
    expect(defaultOf(h, 'claude')).toBe('opus');
    expect((await h.createConversation({ driverId: 'claude' })).model).toBe('opus');
  });

  it('偏好文件里旧的 null 当作没设过；设过的模型从模型表里消失了：视图原样给出，新会话改用推荐模型', async () => {
    await fs.mkdir(path.dirname(home.agentPrefsFile), { recursive: true });
    await fs.writeFile(
      home.agentPrefsFile,
      JSON.stringify({
        schemaVersion: 1,
        drivers: {
          codex: { enabled: true, defaultModel: null, defaultEffort: null, executable: null },
          claude: { enabled: true, defaultModel: 'claude-gone', defaultEffort: null, executable: null },
        },
      }),
    );
    const h = await open([claude(), codex()]);
    expect(defaultOf(h, 'codex')).toBe('gpt-6-sol');
    expect(defaultOf(h, 'claude')).toBe('claude-gone');
    expect((await h.createConversation({ driverId: 'claude' })).model).toBe('sonnet');
  });

  it('偏好设置 agent.defaultModel 只用于默认 Agent 且它自己没设过时；AGENT_DEFAULT_MODEL 表示不传模型', async () => {
    settings['agent.defaultModel'] = 'gpt-5.6-sol';
    const h = await open([claude(), codex()]);
    expect(defaultOf(h, 'codex')).toBe('gpt-5.6-sol');
    expect((await h.createConversation({})).model).toBe('gpt-5.6-sol');
    expect(defaultOf(h, 'claude')).toBe('sonnet');

    settings['agent.defaultModel'] = AGENT_DEFAULT_MODEL;
    expect(defaultOf(h, 'codex')).toBeNull();
    expect((await h.createConversation({})).model).toBeNull();
  });

  it('还没用过的会话换 Agent：换成新 Agent 的默认模型（没设过就是推荐模型）', async () => {
    const h = await open([claude(), codex()]);
    const conversation = await h.createConversation({ driverId: 'claude' });
    expect(conversation.model).toBe('sonnet');
    expect((await h.updateConversation({ conversationId: conversation.id, driverId: 'codex' })).model).toBe('gpt-6-sol');
  });
});
