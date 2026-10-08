import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@baocut/harness';
import { createFakePi, type FakePi } from '../testing/fake-pi.ts';
import { parsePiVersion } from './pi-binary.ts';
import { derivePiModels, parseModelReference, piThinkingLevels } from './pi-models.ts';
import { PiDriver, PI_MIN_VERSION } from './pi-driver.ts';

/** Pi Driver 的探测对着假 pi：安装、版本、登录状态（按可用模型表）、模型表与缓存。 */
describe('PiDriver.probe（假 pi）', () => {
  let dir: string;
  let fake: FakePi;
  let driver: PiDriver;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-pi-driver-'));
    fake = await createFakePi(path.join(dir, 'fake'));
    driver = new PiDriver(silentLogger, { locate: fake.locate, probeTimeoutMs: 10_000 });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('有可用模型：ready，模型表是 provider/id，默认模型与推理档位来自 get_state 与 thinkingLevelMap', async () => {
    const probe = await driver.probe();
    expect(probe).toMatchObject({
      id: 'pi',
      name: 'Pi',
      command: 'pi',
      state: 'ready',
      version: '1.0.4',
      minVersion: PI_MIN_VERSION,
      verified: true,
      plan: 'Pi 里的模型账号',
      loginCommand: 'pi',
      capabilities: { steer: true, approvals: false, resume: true, images: true },
      detail: null,
    });
    expect(driver.verified).toBe(true);
    expect(driver.tested).toBe(false);
    expect(driver.describe().verified).toBe(true);
    expect(probe.install).toEqual([
      {
        kind: 'npm',
        label: 'npm',
        needs: 'Node.js',
        command: 'npm install -g @earendil-works/pi-coding-agent',
        upgrade: 'npm install -g @earendil-works/pi-coding-agent@latest',
      },
    ]);
    expect(probe.models).toEqual([
      {
        id: 'anthropic/claude-sonnet-5',
        label: 'Claude Sonnet 5',
        description: 'anthropic/claude-sonnet-5',
        tier: null,
        isDefault: true,
        efforts: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].map((id) => ({ id, label: id })),
        defaultEffort: 'medium',
      },
      {
        id: 'openai/gpt-mini',
        label: 'GPT Mini',
        description: 'openai/gpt-mini',
        tier: null,
        isDefault: false,
        efforts: [],
        defaultEffort: null,
      },
    ]);
    // 探测进程：RPC 模式、不写会话文件、在主目录、不查新版本。
    const start = fake.log().find((e) => e.kind === 'start')!;
    expect(start.args).toEqual(['--mode', 'rpc', '--no-session']);
    expect(start.cwd).toBe(await fs.realpath(os.homedir()));
    expect(start.env).toEqual({ PI_SKIP_VERSION_CHECK: '1' });
    expect(fake.commands('prompt')).toEqual([]);
  });

  it('没有可用模型：signed-out，提示 /login 或 API 密钥', async () => {
    fake.scenario({ models: [], current: null });
    const probe = await driver.probe();
    expect(probe.state).toBe('signed-out');
    expect(probe.detail).toContain('/login');
    expect(probe.models).toEqual([]);
  });

  it('模型表缓存 10 分钟，同时到来的探测共用一次；force 重新起进程', async () => {
    await Promise.all([driver.probe(), driver.probe()]);
    await driver.probe();
    expect(fake.commands('get_available_models')).toHaveLength(1);
    await driver.probe({ force: true });
    expect(fake.commands('get_available_models')).toHaveLength(2);
  });

  it('没装：not-installed；太旧：outdated；起不来：error 带 stderr', async () => {
    fake.scenario({ installed: false });
    expect((await driver.probe()).state).toBe('not-installed');
    fake.scenario({ installed: true, version: '0.62.0' });
    const outdated = await driver.probe();
    expect(outdated.state).toBe('outdated');
    expect(outdated.detail).toContain(PI_MIN_VERSION);
    fake.scenario({ version: '1.0.5', crashOnStart: true });
    const broken = await driver.probe();
    expect(broken.state).toBe('error');
    expect(broken.detail).toContain('fake pi failed to start');
  });

  it('手动指定的可执行文件不存在：not-installed', async () => {
    const probe = await driver.probe({ executable: path.join(dir, 'nope', 'pi') });
    expect(probe.state).toBe('not-installed');
    expect(probe.detail).toContain('不存在');
  });
});

describe('pi 模型与版本的解析', () => {
  it('--version 输出', () => {
    expect(parsePiVersion('1.0.4\n')).toBe('1.0.4');
    expect(parsePiVersion('pi v0.84.4')).toBe('0.84.4');
    expect(parsePiVersion('nothing')).toBeNull();
  });

  it('provider/id 与 provider:id', () => {
    expect(parseModelReference('anthropic/claude-sonnet-5')).toEqual({ provider: 'anthropic', id: 'claude-sonnet-5' });
    expect(parseModelReference('openrouter/meta/llama')).toEqual({ provider: 'openrouter', id: 'meta/llama' });
    expect(parseModelReference('ollama:qwen3')).toEqual({ provider: 'ollama', id: 'qwen3' });
    expect(parseModelReference('gpt-5')).toEqual({ provider: null, id: 'gpt-5' });
  });

  it('推理档位：null 表示不支持，xhigh / max 要映射里有；默认 medium 不支持时先往上取', () => {
    const base = { id: 'm', provider: 'p', reasoning: true };
    expect(piThinkingLevels({ ...base })).toEqual({ efforts: ['off', 'minimal', 'low', 'medium', 'high'], defaultEffort: 'medium' });
    expect(piThinkingLevels({ ...base, thinkingLevelMap: { medium: null, low: null, max: 'max' } })).toEqual({
      efforts: ['off', 'minimal', 'high', 'max'],
      defaultEffort: 'high',
    });
    expect(piThinkingLevels({ ...base, thinkingLevelMap: { medium: null, high: null } })).toEqual({
      efforts: ['off', 'minimal', 'low'],
      defaultEffort: 'low',
    });
    expect(piThinkingLevels({ ...base, reasoning: false })).toEqual({ efforts: [], defaultEffort: null });
  });

  it('get_state 的模型是 unknown（没配模型）时没有默认', () => {
    const models = derivePiModels([{ id: 'a', provider: 'p' }], { provider: 'unknown', id: 'unknown' });
    expect(models[0]!.isDefault).toBe(false);
  });
});
