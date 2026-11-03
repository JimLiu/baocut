import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDriver, AgentEvent, AgentItem, AgentSession, CreateSessionOptions } from '@baocut/harness';
import type { GenerationAttempt, GenerationProvider, GenerationRun, ModelServiceStore, TextRun } from '@baocut/models';
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

describe('agent:codex 生图：输出只来自这个回合生成的图片', () => {
  const CODEX = 'agent:codex';
  const REAL = Buffer.from('image generated in this turn');
  const STALE = Buffer.from('image of an earlier job');
  let root: string;
  let staging: string;
  let generated: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-agent-image-'));
    staging = path.join(root, 'staging');
    await fs.mkdir(staging);
    // 原生侧保存图片的目录（`~/.codex/generated_images/<thread>/`），在工作目录之外。
    generated = path.join(root, 'generated_images', 'thread', 'image.png');
    await fs.mkdir(path.dirname(generated), { recursive: true });
    await fs.writeFile(generated, REAL);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  /** 一个 Codex 回合：先跑 `act`（智能体在工作目录里做的事），再发这些条目，然后结束。 */
  function generator(items: AgentItem[], act: (cwd: string) => Promise<void> = async () => {}, sessions: CreateSessionOptions[] = []) {
    const driver = {
      id: 'codex',
      createSession: async (options: CreateSessionOptions) => {
        sessions.push(options);
        let listener: (event: AgentEvent) => void = () => {};
        return {
          subscribe: (l: (event: AgentEvent) => void) => {
            listener = l;
            return () => {};
          },
          startTurn: async () => {
            await act(options.cwd);
            queueMicrotask(() => {
              for (const item of items) listener({ type: 'item.completed', turnId: 't', item });
              listener({ type: 'turn.completed', turnId: 't', outcome: 'completed', error: null });
            });
            return { turnId: 't' };
          },
          interrupt: async () => ({ status: 'requested' }),
          close: async () => {},
        } as unknown as AgentSession;
      },
    } as unknown as AgentDriver;
    const info = { status: 'available', state: 'ready', version: '0.166.0', accountRef: { key: 'driversCodex.chatgptAccount', params: {} }, models: [] } as unknown as DriverProbe;
    const source = new AgentProviderSource({
      store: { configView: () => ({ enabled: true, enabledAt: null, credential: 'missing', accounts: [] }) } as unknown as ModelServiceStore,
      drivers: { current: async () => info, get: () => driver, executable: () => null },
    });
    return source.generator(CODEX, 'generateImage')!;
  }

  const imageItem = (savedPath: string | null, status: 'completed' | 'failed' = 'completed'): AgentItem => ({ kind: 'generated-image', id: `img-${savedPath}`, status, path: savedPath });

  const generate = (provider: GenerationProvider) =>
    provider.generate(
      {
        jobId: 'job_1',
        modelId: 'image-gen',
        staging,
        parameters: { capability: 'generateImage', prompt: 'a fox', count: 1, size: null, seed: null, format: 'png' },
      } as unknown as GenerationRun,
      { generating: () => {}, progress: () => {} },
      new AbortController().signal,
    );

  async function expectRealImage(attempt: GenerationAttempt) {
    expect(attempt.outcome).toBe('completed');
    const [output] = attempt.outcome === 'completed' ? attempt.outputs : [];
    expect(output).toMatchObject({ path: 'output.png', byteLength: REAL.length, sha256: crypto.createHash('sha256').update(REAL).digest('hex') });
    expect(await fs.readFile(path.join(staging, 'output.png'))).toEqual(REAL);
  }

  it('智能体把更早任务的图片抄成 output.png：交出的仍是这个回合生成的那张', async () => {
    const provider = generator([imageItem(generated)], (cwd) => fs.writeFile(path.join(cwd, 'output.png'), STALE));
    await expectRealImage(await generate(provider));
  });

  it('智能体说找不到文件、没有写 output.png：图片在原生侧的目录里，照样交出', async () => {
    const provider = generator([imageItem(generated), { kind: 'agent-message', id: 'm', text: 'The image tool did not return an accessible file.' }]);
    await expectRealImage(await generate(provider));
  });

  it('回合里生成了几张：取最后一张', async () => {
    const earlier = path.join(path.dirname(generated), 'earlier.png');
    await fs.writeFile(earlier, STALE);
    await expectRealImage(await generate(generator([imageItem(earlier), imageItem(generated)])));
  });

  it('工作目录里的 output.png 是符号链接：不跟着写到外面去', async () => {
    const outside = path.join(root, 'outside.png');
    await fs.writeFile(outside, STALE);
    await expectRealImage(await generate(generator([imageItem(generated)], (cwd) => fs.symlink(outside, path.join(cwd, 'output.png')))));
    expect(await fs.readFile(outside)).toEqual(STALE);
  });

  it('回合里没有生成图片：工作目录里的文件不算输出（PROVIDER_REJECTED，no-image）', async () => {
    const provider = generator([{ kind: 'agent-message', id: 'm', text: 'Created output.png' }], (cwd) => fs.writeFile(path.join(cwd, 'output.png'), STALE));
    await expect(generate(provider)).rejects.toMatchObject({ details: { code: 'PROVIDER_REJECTED', reason: 'no-image', reply: 'Created output.png' } });
  });

  it('生成失败的条目不算生成了图片', async () => {
    await expect(generate(generator([imageItem(null, 'failed')]))).rejects.toMatchObject({ details: { code: 'PROVIDER_REJECTED', reason: 'no-image' } });
  });

  it.each([
    ['没有保存路径', () => null],
    ['文件不见了', () => generated.replace('image.png', 'missing.png')],
  ])('生成了但读不到（%s）：明确失败，不拿工作目录里的文件顶替（image-unavailable）', async (_name, savedPath) => {
    const provider = generator([imageItem(savedPath())], (cwd) => fs.writeFile(path.join(cwd, 'output.png'), STALE));
    await expect(generate(provider)).rejects.toMatchObject({ details: { code: 'PROVIDER_REJECTED', reason: 'image-unavailable' } });
  });

  it('保存路径是符号链接：不跟随', async () => {
    const link = path.join(root, 'link.png');
    await fs.symlink(generated, link);
    await expect(generate(generator([imageItem(link)]))).rejects.toMatchObject({ details: { reason: 'image-unavailable' } });
  });

  it('开发者指令不再让智能体找文件、抄文件', async () => {
    const sessions: CreateSessionOptions[] = [];
    await generate(generator([imageItem(generated)], async () => {}, sessions));
    expect(sessions[0]!.developerInstructions).not.toMatch(/output\.png/);
    expect(sessions[0]!.developerInstructions).toMatch(/Do not look for, copy, move or write any image file/);
  });
});
