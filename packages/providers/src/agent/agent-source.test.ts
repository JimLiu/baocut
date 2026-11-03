import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDriver, AgentEvent, AgentSession, CreateSessionOptions } from '@baocut/harness';
import type { ModelServiceStore, TextRun } from '@baocut/models';
import type { DriverId, DriverProbe, TextModelInfo } from '@baocut/protocol';
import { AgentProviderSource } from './agent-source.ts';

const PROVIDER = 'agent:claude';
const hooks = { retry: () => {} };

function probe(account: string | null): DriverProbe {
  return {
    status: 'available',
    state: 'ready',
    version: '2.1.300',
    accountRef: account ? { key: `driversClaude.${account}`, params: {} } : undefined,
    models: [
      { id: 'sonnet', label: 'Sonnet', isDefault: true, efforts: [{ id: 'low' }, { id: 'high' }, { id: 'max' }], defaultEffort: 'high' },
      { id: 'opus', label: 'Opus', efforts: [] },
    ],
    configModel: null,
  } as unknown as DriverProbe;
}

function fakeDriver(reply: string, sessions: CreateSessionOptions[]): AgentDriver {
  return {
    id: 'claude',
    createSession: async (options: CreateSessionOptions) => {
      sessions.push(options);
      let listener: (event: AgentEvent) => void = () => {};
      const session = {
        subscribe: (l: (event: AgentEvent) => void) => {
          listener = l;
          return () => {};
        },
        startTurn: async () => {
          queueMicrotask(() => {
            listener({ type: 'item.completed', turnId: 't', item: { kind: 'agent-message', id: 'm', text: reply } });
            listener({ type: 'turn.completed', turnId: 't', outcome: 'completed', error: null });
          });
          return { turnId: 't' };
        },
        interrupt: async () => ({ status: 'requested' }),
        close: async () => {},
      };
      return session as unknown as AgentSession;
    },
  } as unknown as AgentDriver;
}

function sourceOf(options: { enabled?: boolean; registered?: DriverId[]; info?: DriverProbe; reply?: string; textWorkRoot?: string; sessions?: CreateSessionOptions[] } = {}) {
  const { enabled = false, registered = ['claude'], info = probe('subscriptionMax'), reply = '译文', sessions = [] } = options;
  const driver = fakeDriver(reply, sessions);
  return new AgentProviderSource({
    store: { configView: () => ({ enabled, enabledAt: null, credential: 'missing', accounts: [] }) } as unknown as ModelServiceStore,
    drivers: {
      current: async (id) => (registered.includes(id) ? info : null),
      get: (id) => {
        if (!registered.includes(id)) throw new Error('not registered');
        return driver;
      },
      executable: () => null,
    },
    textWorkRoot: options.textWorkRoot,
  });
}

const run = (patch: Partial<TextRun['parameters']> = {}, modelId = 'text-gen'): TextRun =>
  ({
    modelId,
    parameters: { messages: [{ role: 'user', content: 'hi' }], responseFormat: { type: 'text' }, effort: null, ...patch },
  }) as unknown as TextRun;

describe('agent:claude', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-agent-source-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('只在注册了 Claude Driver 时列出；只有文本生成，没有生图', async () => {
    const without = sourceOf({ registered: ['codex'] });
    expect((await without.list('view')).map((v) => v.providerId)).toEqual(['agent:codex']);
    expect(without.resolve(PROVIDER)).toBeNull();
    expect(without.textProvider(PROVIDER)).toBeNull();

    const source = sourceOf();
    expect(source.resolve(PROVIDER)).toBe(PROVIDER);
    const view = (await source.describe(PROVIDER, 'view'))!;
    expect(view).toMatchObject({ kind: 'agent', label: 'Claude Code', vendor: { kind: 'agent', icon: 'anthropic' } });
    expect(view.capabilities.generateImage).toBeUndefined();
    expect(view.capabilities.generateText).toBeDefined();
    expect(source.generator(PROVIDER, 'generateImage')).toBeNull();
  });

  it('没启用：不去探测，只报告没有启用', async () => {
    let probes = 0;
    const source = new AgentProviderSource({
      store: { configView: () => ({ enabled: false, enabledAt: null, credential: 'missing', accounts: [] }) } as unknown as ModelServiceStore,
      drivers: {
        current: async () => {
          probes++;
          return probe('subscriptionMax');
        },
        get: () => fakeDriver('x', []),
        executable: () => null,
      },
    });
    const view = (await source.describe(PROVIDER, 'view'))!;
    expect(view.capabilities.generateText).toMatchObject({ available: false, unavailableReason: 'not-configured' });
    expect(probes).toBe(0);
    // 主动探测时才问 Driver：只差开关。
    expect((await source.describe(PROVIDER, 'probe'))!.capabilities.generateText).toMatchObject({ available: false, unavailableReason: 'not-configured' });
    expect(probes).toBe(1);
  });

  it('模型：「Agent 默认模型」加上探测到的模型表，强度按 TextEffort 认得的那几档', async () => {
    const view = (await sourceOf({ enabled: true }).describe(PROVIDER, 'view'))!;
    const models = view.capabilities.generateText!.models as TextModelInfo[];
    expect(models.map((m) => [m.modelId, m.efforts, m.defaultEffort])).toEqual([
      ['text-gen', ['low', 'high'], 'high'],
      ['sonnet', ['low', 'high'], 'high'],
      ['opus', [], null],
    ]);
    expect(models[0]).toMatchObject({ cost: 'subscription', structuredOutput: true, acceptsTemperature: false, acceptsSeed: false });
  });

  it.each([
    ['subscriptionPro', 'subscription'],
    ['subscriptionTeam', 'subscription'],
    ['claudeAccount', 'subscription'],
    ['longLivedToken', 'subscription'],
    ['apiKey', 'unknown'],
    ['thirdPartyCloud', 'unknown'],
    ['enterpriseGateway', 'unknown'],
  ])('%s 登录时费用是 %s', async (account, cost) => {
    const view = (await sourceOf({ enabled: true, info: probe(account) }).describe(PROVIDER, 'view'))!;
    expect((view.capabilities.generateText!.models as TextModelInfo[])[0]).toMatchObject({ cost });
  });

  it('版本低于 2.0.0：outdated，补救是升级', async () => {
    const info = { ...probe('subscriptionMax'), version: '1.9.0' };
    const view = (await sourceOf({ enabled: true, info }).describe(PROVIDER, 'view'))!;
    expect(view.capabilities.generateText).toMatchObject({ available: false, unavailableReason: 'outdated' });
  });

  it('生成：会话不给工具（no-tools）、不给 MCP；模型与强度原样交给 Driver；用完删掉工作目录', async () => {
    const sessions: CreateSessionOptions[] = [];
    const text = sourceOf({ enabled: true, sessions, textWorkRoot: dir }).textProvider(PROVIDER)!;
    const reply = await text.generateText(run({ effort: 'high' }, 'opus'), new AbortController().signal, hooks);
    expect(reply).toMatchObject({ text: '译文', finishReason: 'stop', workerVersion: `${PROVIDER} 2.1.300` });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ confinement: 'no-tools', model: 'opus', effort: 'high', resume: null });
    expect(sessions[0]!.mcpServers).toBeUndefined();
    expect(sessions[0]!.developerInstructions).toContain('non-interactive text generation backend');
    expect(await fs.readdir(path.join(dir, 'claude'))).toEqual([]);
  });

  it('「Agent 默认模型」不传模型；没启用时不开会话', async () => {
    const sessions: CreateSessionOptions[] = [];
    await sourceOf({ enabled: true, sessions, textWorkRoot: dir })
      .textProvider(PROVIDER)!
      .generateText(run(), new AbortController().signal, hooks);
    expect(sessions[0]).toMatchObject({ model: null, effort: null });

    const off: CreateSessionOptions[] = [];
    const failed = await sourceOf({ enabled: false, sessions: off, textWorkRoot: dir })
      .textProvider(PROVIDER)!
      .generateText(run(), new AbortController().signal, hooks)
      .catch((error: unknown) => error);
    expect(failed).toMatchObject({ details: { reason: 'not-configured' } });
    expect(off).toEqual([]);
  });

  it('结构化输出：去掉包住整段的代码围栏', async () => {
    const text = sourceOf({ enabled: true, reply: '```json\n{"a":1}\n```', textWorkRoot: dir }).textProvider(PROVIDER)!;
    const reply = await text.generateText(run({ responseFormat: { type: 'json', schema: { type: 'object' } } } as never), new AbortController().signal, hooks);
    expect(reply.text).toBe('{"a":1}');
  });
});
