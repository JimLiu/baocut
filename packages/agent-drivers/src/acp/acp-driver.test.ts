import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@baocut/harness';
import { createFakeAcp, type FakeAcp } from '../testing/fake-acp.ts';
import { parseAcpVersion, acpPathVariable } from './acp-binary.ts';
import { AcpDriver, acpDrivers } from './acp-driver.ts';
import { ACP_PRESETS } from './acp-presets.ts';

describe('AcpDriver.probe（假 ACP 智能体）', () => {
  let dir: string;
  let fake: FakeAcp;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-acp-driver-'));
    fake = await createFakeAcp(path.join(dir, 'fake'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const sessionsStarted = () => fake.log().filter((e) => e.kind === 'start').length;

  it('Qwen Code：按原生 --acp 启动，读会话模型表；没有模型表时仍可用', async () => {
    fake.scenario({ version: '0.20.1', models: 'config' });
    const driver = new AcpDriver('qwen', silentLogger, { locate: fake.locate });
    const probe = await driver.probe();
    expect(probe).toMatchObject({ id: 'qwen', name: 'Qwen Code', state: 'ready', loginCommand: 'qwen', minVersion: '0.20.1', tested: false });
    expect(probe.models.map((m) => m.id)).toEqual(['fake-pro', 'fake-flash']);
    expect(fake.log().find((e) => e.kind === 'start')?.args).toEqual(['--acp']);
    fake.scenario({ version: '0.20.2', models: 'none' });
    expect(await driver.probe({ force: true })).toMatchObject({ state: 'ready', models: [] });
  });

  it('Antigravity CLI：按 agy acp 启动，Flash 档标为推荐，官方脚本安装与 agy update 升级', async () => {
    fake.scenario({ version: '1.5.14', models: 'both', mcpHttp: 'undeclared' });
    const driver = new AcpDriver('antigravity', silentLogger, { locate: fake.locate });
    const probe = await driver.probe();
    expect(probe).toMatchObject({ id: 'antigravity', name: 'Antigravity CLI', state: 'ready', loginCommand: 'agy', minVersion: '1.5.10' });
    expect(probe.capabilities).toEqual({ steer: false, approvals: true, resume: true, images: true });
    expect(probe.models.map((m) => [m.id, m.tier])).toEqual([['fake-pro-high', null], ['fake-flash-low', 'balanced']]);
    expect(fake.log().find((e) => e.kind === 'start')?.args).toEqual(['acp']);
    expect(probe.install.map((i) => [i.kind, i.upgrade])).toEqual([['script', 'agy update']]);
    fake.scenario({ version: '1.5.9' });
    expect(await driver.probe({ force: true })).toMatchObject({ state: 'outdated' });
  });

  it('Qwen Code：版本过旧时提示升级；未登录时给出 qwen 登录入口', async () => {
    fake.scenario({ version: '0.0.1' });
    const driver = new AcpDriver('qwen', silentLogger, { locate: fake.locate });
    expect(await driver.probe()).toMatchObject({ state: 'outdated' });
    expect(sessionsStarted()).toBe(0);
    fake.scenario({ version: '0.20.1', loggedIn: false });
    expect(await driver.probe()).toMatchObject({ state: 'signed-out', loginCommand: 'qwen', detail: expect.stringContaining('qwen') });
  });

  it('已安装、已登录：ready，版本、模型表（旧版 models）、能力；共享实现已验证，可以开会话', async () => {
    const driver = new AcpDriver('gemini', silentLogger, { locate: fake.locate });
    const probe = await driver.probe();
    expect(probe).toMatchObject({
      id: 'gemini',
      name: 'Gemini CLI',
      command: 'gemini',
      state: 'ready',
      status: 'available',
      version: '0.46.0',
      verified: true,
      loginCommand: 'gemini',
      capabilities: { steer: false, approvals: true, resume: true, images: true },
    });
    expect(probe.models).toEqual([
      { id: 'fake-pro', label: 'Fake Pro', description: null, tier: null, isDefault: true, efforts: [], defaultEffort: null },
      { id: 'fake-flash', label: 'Fake Flash', description: 'Fast', tier: null, isDefault: false, efforts: [], defaultEffort: null },
    ]);
    // 探测进程不弹浏览器，用完就关（session/close），不发 prompt。
    expect(fake.log().find((e) => e.kind === 'start')?.env).toEqual({ NO_BROWSER: '1', NO_OPEN_BROWSER: '1' });
    expect(fake.requests('session/close')).toHaveLength(1);
    expect(fake.requests('session/prompt')).toEqual([]);
  });

  it('模型表缓存：同一版本 10 分钟内不再起进程', async () => {
    const driver = new AcpDriver('gemini', silentLogger, { locate: fake.locate });
    await driver.probe();
    await driver.probe();
    expect(sessionsStarted()).toBe(1);
  });

  it('模型表来自分类为 model 的配置项（含分组）', async () => {
    fake.scenario({ models: 'config' });
    const probe = await new AcpDriver('kimi', silentLogger, { locate: fake.locate }).probe();
    expect(probe.models.map((m) => [m.id, m.isDefault])).toEqual([
      ['fake-pro', true],
      ['fake-flash', false],
    ]);
  });

  it('Cursor 的模型表走 cursor/list_available_models，取不到时退回会话里的', async () => {
    fake.scenario({ cursorModels: true, version: '2026.04.01' });
    const probe = await new AcpDriver('cursor', silentLogger, { locate: fake.locate }).probe();
    expect(probe.models.map((m) => m.id)).toEqual(['auto', 'cursor-fast']);
    expect(fake.requests('cursor/list_available_models')).toHaveLength(1);

    fake.scenario({ cursorModels: false, version: '2026.04.02' });
    const fallback = await new AcpDriver('cursor', silentLogger, { locate: fake.locate }).probe();
    expect(fallback.models.map((m) => m.id)).toEqual(['fake-pro', 'fake-flash']);
  });

  it('没登录（session/new 回 -32000）：signed-out，给登录命令', async () => {
    fake.scenario({ loggedIn: false });
    const probe = await new AcpDriver('gemini', silentLogger, { locate: fake.locate }).probe();
    expect(probe.state).toBe('signed-out');
    expect(probe.unavailableReason).toBe('not-connected');
    expect(probe.detail).toContain('gemini');
    // Google 账号与 API 密钥两种登录方式都说到。
    expect(probe.detail).toContain('Google');
    expect(probe.detail).toContain('~/.gemini/.env');
    expect(probe.detail).toContain('API key is missing');
  });

  it.skipIf(process.platform === 'win32')('探测结束时，临时进程派生的进程（cursor-agent 启动时跑的 rg 那样）一起结束', async () => {
    fake.scenario({ loggedIn: false, cursorModels: true, version: '2026.04.17', helper: true });
    const helpers = () => fake.log().flatMap((e) => (e.kind === 'start' && e.helper ? [e.helper] : []));
    try {
      const probe = await new AcpDriver('cursor', silentLogger, { locate: fake.locate }).probe();
      expect(probe.state).toBe('signed-out');
      expect(helpers()).toHaveLength(1);
      expect(() => process.kill(helpers()[0]!, 0)).toThrow();
    } finally {
      // 断言失败时也不留下测试自己的进程。
      for (const pid of helpers()) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // 已经结束
        }
      }
    }
  });

  it('没装：not-installed，说怎么装；太旧：outdated', async () => {
    fake.scenario({ installed: false });
    const missing = await new AcpDriver('kimi', silentLogger, { locate: fake.locate }).probe();
    expect(missing.state).toBe('not-installed');
    expect(missing.install).toEqual([]);
    expect(missing.detail).toContain('https://github.com/MoonshotAI/kimi-code');

    fake.scenario({ installed: true, version: '0.40.0' });
    const old = await new AcpDriver('gemini', silentLogger, { locate: fake.locate }).probe();
    expect(old.state).toBe('outdated');
    expect(sessionsStarted()).toBe(0);
  });

  it('ACP 模式起不来：error，原文写进 detail', async () => {
    const broken = path.join(dir, 'broken');
    await fs.writeFile(broken, '#!/bin/sh\necho "unknown flag" >&2\nexit 3\n', { mode: 0o755 });
    const probe = await new AcpDriver('grok', silentLogger, {
      locate: async () => ({ command: broken, version: '9.9.9', env: { PATH: process.env.PATH } }),
    }).probe();
    expect(probe.state).toBe('error');
    expect(probe.detail).toContain('unknown flag');
  });
});

describe('ACP 预设', () => {
  it('内置预设：启动参数、安装方式、覆盖变量', () => {
    expect(acpDrivers(silentLogger).map((d) => d.id)).toEqual(['copilot', 'antigravity', 'qwen', 'gemini', 'cursor', 'grok', 'kimi']);
    expect(Object.values(ACP_PRESETS).map((p) => [p.id, p.command, p.args.join(' ')])).toEqual([
      ['copilot', 'copilot', '--acp'],
      ['antigravity', 'agy', 'acp'],
      ['qwen', 'qwen', '--acp'],
      ['gemini', 'gemini', '--acp'],
      ['cursor', 'cursor-agent', 'acp'],
      ['grok', 'grok', 'agent stdio'],
      ['kimi', 'kimi', 'acp'],
    ]);
    expect(ACP_PRESETS.gemini.install!.map((i) => i.command)).toEqual(['brew install gemini-cli', 'npm install -g @google/gemini-cli']);
    expect(ACP_PRESETS.cursor.install!.map((i) => i.kind)).toEqual(['script']);
    expect(ACP_PRESETS.copilot.install!.map((i) => [i.command, i.upgrade])).toEqual([
      ['npm install -g @github/copilot', 'npm install -g @github/copilot@latest'],
    ]);
    expect(ACP_PRESETS.copilot.permissionOption).toEqual({ configId: 'allow_all', on: 'on', off: 'off' });
    // #autopilot 比完全访问还宽，不在候选里。
    expect(
      Object.values(ACP_PRESETS.copilot.modes)
        .flat()
        .some((id) => id.endsWith('#autopilot')),
    ).toBe(false);
    expect(acpPathVariable(ACP_PRESETS.cursor)).toBe('BAOCUT_CURSOR_PATH');
    // 不放比 BaoCut 模式更宽的原生模式：ask 只有 default。
    expect(ACP_PRESETS.gemini.modes.ask).toEqual(['default']);
    // 共享实现已验证：都能开会话；各家都还没以自家智能体在 BaoCut 上实测过。
    expect(acpDrivers(silentLogger).map((d) => [d.id, d.verified, d.slowProbe, d.preset.tested])).toEqual([
      ['copilot', true, true, false],
      ['antigravity', true, true, false],
      ['qwen', true, true, false],
      ['gemini', true, true, false],
      ['cursor', true, true, false],
      ['grok', true, true, false],
      ['kimi', true, true, false],
    ]);
    expect(new AcpDriver('kimi', silentLogger, { verified: false }).describe().verified).toBe(false);
    expect(new AcpDriver({ ...ACP_PRESETS.grok, verified: false }, silentLogger).verified).toBe(false);
  });

  it('版本号取输出里的第一个', () => {
    expect(parseAcpVersion('0.46.0\n')).toBe('0.46.0');
    expect(parseAcpVersion('2026.03.30-a1b2c3')).toBe('2026.03.30');
    expect(parseAcpVersion('kimi, version 0.11.0')).toBe('0.11.0');
    expect(parseAcpVersion('nothing')).toBeNull();
  });
});
