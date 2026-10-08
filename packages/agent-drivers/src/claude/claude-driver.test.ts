import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@baocut/harness';
import { createFakeClaude, createFakeClaudeCli, type FakeClaude, type FakeClaudeCli } from '../testing/fake-claude.ts';
import { claudeExec, claudeSearch, describeClaudeAccount, parseClaudeVersion, parseCmdShimTarget } from './claude-binary.ts';
import { ClaudeDriver } from './claude-driver.ts';
import { FALLBACK_CLAUDE_MODELS } from './claude-models.ts';
import { ClaudeSession } from './claude-session.ts';

/**
 * Claude Driver 的探测，对着假 claude（`--version`、`auth status`）与假 Query（`supportedModels()`）。
 * 从不启动本机真实的 claude。
 */

describe('ClaudeDriver 探测（假 claude）', () => {
  let dir: string;
  let cli: FakeClaudeCli;
  let fake: FakeClaude;
  let settingsFile: string;
  let driver: ClaudeDriver;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-claude-driver-'));
    cli = await createFakeClaudeCli(path.join(dir, 'fake'));
    fake = createFakeClaude();
    settingsFile = path.join(dir, 'settings.json');
    driver = new ClaudeDriver(silentLogger, { locate: cli.locate, queryFactory: fake.factory, settingsFile });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('按优先级给出状态：没装、出错、太旧、没登录、可用', async () => {
    cli.scenario({ installed: false });
    expect(await driver.probe()).toMatchObject({ state: 'not-installed', status: 'unavailable', unavailableReason: 'not-installed', version: null });

    cli.scenario({ installed: true, version: null });
    expect(await driver.probe()).toMatchObject({ state: 'error', status: 'unavailable', version: null, executable: cli.command });

    cli.scenario({ version: '1.0.99' });
    expect(await driver.probe()).toMatchObject({ state: 'outdated', unavailableReason: 'unsupported', version: '1.0.99', minVersion: '2.0.0' });

    cli.scenario({ version: '2.1.284', auth: { loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' } });
    const signedOut = await driver.probe();
    expect(signedOut).toMatchObject({ state: 'signed-out', unavailableReason: 'not-connected', version: '2.1.284', account: null });
    // 没登录也拿得到模型表。
    expect(signedOut.models.length).toBeGreaterThan(0);

    cli.scenario({ auth: { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max', email: 'someone@example.com' } });
    const ready = await driver.probe();
    expect(ready).toMatchObject({
      state: 'ready',
      status: 'available',
      unavailableReason: null,
      account: 'Claude Max 订阅',
      plan: 'Claude Pro 或 Max 订阅',
      loginCommand: 'claude',
      capabilities: { steer: true, approvals: true, resume: true, images: true },
      realExecutable: await fs.realpath(cli.command),
    });
    // 账号描述不带邮箱。
    expect(JSON.stringify(ready)).not.toContain('someone@example.com');
    expect(ready.install.map((i) => [i.kind, i.command, i.upgrade])).toEqual([
      ['script', 'curl -fsSL https://claude.ai/install.sh | bash', 'claude update'],
      ['brew', 'brew install --cask claude-code', 'brew upgrade --cask claude-code'],
      ['npm', 'npm install -g @anthropic-ai/claude-code', 'npm install -g @anthropic-ai/claude-code@latest'],
    ]);
    expect(cli.calls()).toContainEqual(['auth', 'status']);
  });

  it('旧版本没有 auth status：不挡着，账号未知', async () => {
    cli.scenario({ auth: null });
    expect(await driver.probe()).toMatchObject({ state: 'ready', account: null });
  });

  it('指定的可执行文件不存在：没装，不再到别处找', async () => {
    const missing = path.join(dir, 'nope', 'claude');
    expect(await driver.probe({ executable: missing })).toMatchObject({ state: 'not-installed', executable: missing });
    expect((await driver.probe({ executable: missing })).detail).toContain(missing);
  });

  it('模型表来自 supportedModels()：default 行不单列，它指向的标为默认；tier、强度；问完就关；同一个 claude 不重问', async () => {
    const probe = await driver.probe();
    expect(probe.models.map((m) => [m.id, m.label, m.tier, m.isDefault])).toEqual([
      ['opus', 'Opus 5.5', 'max', true],
      ['claude-fable-5-1[1m]', 'Fable 5.1', 'max', false],
      ['sonnet', 'Sonnet 5.5', 'balanced', false],
      ['haiku', 'Haiku 4.5', 'fast', false],
    ]);
    const opus = probe.models[0]!;
    expect(opus.description).toBe('Best for everyday, complex tasks · $4/$20 per Mtok');
    expect(opus.efforts.map((e) => e.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(opus.defaultEffort).toBeNull();
    expect(probe.models[3]!.efforts).toEqual([]);
    expect(probe.models[0]).not.toHaveProperty('resolvedModel');

    expect(fake.queries).toHaveLength(1);
    const query = fake.last();
    expect(query.options).toMatchObject({
      pathToClaudeCodeExecutable: cli.command,
      settingSources: ['user'],
      settings: { disableAllHooks: true },
      managedSettings: { allowManagedPermissionRulesOnly: true },
      persistSession: false,
    });
    expect(query.closed).toBe(true);
    expect(query.inputs).toEqual([]);

    await driver.probe();
    expect(fake.queries).toHaveLength(1);
  });

  it('模型表不设时效：过多久都不重问；换了版本、改了 settings.json 或重新检测才重问', async () => {
    await driver.probe();
    expect(fake.queries).toHaveLength(1);

    const later = Date.now() + 24 * 60 * 60_000;
    const now = vi.spyOn(Date, 'now').mockReturnValue(later);
    try {
      await driver.probe();
      expect(fake.queries).toHaveLength(1);
    } finally {
      now.mockRestore();
    }

    cli.scenario({ version: '2.1.300' });
    await driver.probe();
    expect(fake.queries).toHaveLength(2);

    await fs.writeFile(settingsFile, JSON.stringify({ env: {} }));
    await driver.probe();
    expect(fake.queries).toHaveLength(3);
    await driver.probe();
    expect(fake.queries).toHaveLength(3);

    await driver.probe({ force: true });
    expect(fake.queries).toHaveLength(4);
  });

  it('拿不到模型表时退回内置的精简表，且不缓存失败', async () => {
    let calls = 0;
    const failing = new ClaudeDriver(silentLogger, {
      locate: cli.locate,
      settingsFile,
      queryFactory: (params) => {
        calls += 1;
        const query = fake.factory(params);
        query.supportedModels = () => Promise.reject(new Error('spawn failed'));
        return query;
      },
    });
    const probe = await failing.probe();
    expect(probe.state).toBe('ready');
    expect(probe.models.map((m) => m.id)).toEqual(FALLBACK_CLAUDE_MODELS.map((m) => m.id));
    await failing.probe();
    expect(calls).toBe(2);
  });

  it('configModel 读 settings.json 的 model，并标出它在不在模型表里', async () => {
    expect(await driver.probe()).toMatchObject({ configModel: null, configModelKnown: null });
    await fs.writeFile(settingsFile, JSON.stringify({ model: 'sonnet' }));
    expect(await driver.probe()).toMatchObject({ configModel: 'sonnet', configModelKnown: true });
    await fs.writeFile(settingsFile, JSON.stringify({ model: 'claude-opus-5-5[1m]' }));
    expect(await driver.probe()).toMatchObject({ configModel: 'claude-opus-5-5[1m]', configModelKnown: true });
    await fs.writeFile(settingsFile, JSON.stringify({ model: 'claude-opus-3' }));
    expect(await driver.probe()).toMatchObject({ configModel: 'claude-opus-3', configModelKnown: false });
    await fs.writeFile(settingsFile, '{ not json');
    expect(await driver.probe()).toMatchObject({ configModel: null, configModelKnown: null });
  });

  it('settings.json 的 env 里指定的模型并进模型表：已有的不重复，档位按名字或按替代的那一档；configModelKnown 仍比 CLI 的表', async () => {
    await fs.writeFile(
      settingsFile,
      JSON.stringify({
        model: 'gateway-main',
        env: {
          ANTHROPIC_MODEL: 'gateway-main',
          ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5-5',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'corp-sonnet-proxy',
          ANTHROPIC_DEFAULT_HAIKU_MODEL: '  ',
          ANTHROPIC_SMALL_FAST_MODEL: 'tiny',
          OTHER: 'x',
        },
      }),
    );
    const probe = await driver.probe();
    expect(probe.models.map((m) => [m.id, m.tier])).toEqual([
      ['opus', 'max'],
      ['claude-fable-5-1[1m]', 'max'],
      ['sonnet', 'balanced'],
      ['haiku', 'fast'],
      // claude-opus-5-5 是 opus 解析到的完整 id，不重复列。
      ['gateway-main', null],
      ['corp-sonnet-proxy', 'balanced'],
    ]);
    expect(probe.models.at(-1)).toMatchObject({
      label: 'corp-sonnet-proxy',
      description: '来自 Claude Code 设置（env.ANTHROPIC_DEFAULT_SONNET_MODEL）',
      isDefault: false,
      efforts: [],
      defaultEffort: null,
    });
    expect(probe).toMatchObject({ configModel: 'gateway-main', configModelKnown: false });
  });

  it('createSession：找不到 claude 时报 driver-unavailable；找到时不立即起进程', async () => {
    cli.scenario({ installed: false });
    await expect(
      driver.createSession({ cwd: dir, accessMode: 'ask', model: null, effort: null, resume: null }),
    ).rejects.toMatchObject({ code: 'driver-unavailable' });
    cli.scenario({ installed: true });
    const session = await driver.createSession({ cwd: dir, accessMode: 'ask', model: null, effort: null, resume: null });
    expect(session).toBeInstanceOf(ClaudeSession);
    expect(fake.queries).toHaveLength(0);
    await session.close();
  });
});

describe('Claude 的版本与账号描述', () => {
  it('解析 --version', () => {
    expect(parseClaudeVersion('2.1.284 (Claude Code)\n')).toBe('2.1.284');
    expect(parseClaudeVersion('nonsense')).toBeNull();
  });

  it('按登录方式给出账号描述', () => {
    expect(describeClaudeAccount({ authMethod: 'claude.ai', subscriptionType: 'pro' })).toBe('Claude Pro 订阅');
    expect(describeClaudeAccount({ authMethod: 'claude.ai', subscriptionType: 'max' })).toBe('Claude Max 订阅');
    expect(describeClaudeAccount({ authMethod: 'claude.ai' })).toBe('Claude 账号');
    expect(describeClaudeAccount({ authMethod: 'api_key', apiProvider: 'firstParty' })).toBe('Anthropic API 密钥');
    expect(describeClaudeAccount({ authMethod: 'third_party', apiProvider: 'bedrock' })).toBe('Amazon Bedrock');
    expect(describeClaudeAccount({ authMethod: 'claude.ai', apiProvider: 'gateway' })).toBe('企业网关');
  });
});

describe('Windows 上找 claude（纯函数；未在 Windows 上验证）', () => {
  it('文件名与常见位置：claude.exe 与 npm 的 claude.cmd；其他平台不变', () => {
    expect(claudeSearch('win32', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'C:\\Users\\me')).toEqual({
      names: ['claude.exe', 'claude.cmd'],
      locations: ['C:\\Users\\me\\.local\\bin\\claude.exe', 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd'],
    });
    expect(claudeSearch('win32', {}, 'C:\\Users\\me').locations[1]).toBe('C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd');
    expect(claudeSearch('darwin', {}, '/Users/me')).toEqual({
      names: ['claude'],
      locations: ['/Users/me/.claude/local/claude', '/Users/me/.local/bin/claude', '/opt/homebrew/bin/claude', '/usr/local/bin/claude'],
    });
  });

  it('从 npm cmd-shim 里读出真正启动的文件，跳过 node.exe', () => {
    const js = [
      '@ECHO off',
      'GOTO start',
      ':find_dp0',
      'SET dp0=%~dp0',
      'EXIT /b',
      ':start',
      'SETLOCAL',
      'CALL :find_dp0',
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ') ELSE (',
      '  SET "_prog=node"',
      ')',
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
    ].join('\r\n');
    expect(parseCmdShimTarget(js, 'C:\\Users\\me\\AppData\\Roaming\\npm')).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js',
    );
    const exe = '@ECHO off\r\n"%~dp0\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n';
    expect(parseCmdShimTarget(exe, 'C:\\npm')).toBe('C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe');
    expect(parseCmdShimTarget('@ECHO off\r\nclaude %*', 'C:\\npm')).toBeNull();
  });

  it('.js 入口交给 node 跑，其余直接跑', () => {
    expect(claudeExec('C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js')).toEqual({
      file: 'node',
      args: ['C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'],
    });
    expect(claudeExec('/usr/local/bin/claude')).toEqual({ file: '/usr/local/bin/claude', args: [] });
  });
});
