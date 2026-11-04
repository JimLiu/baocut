import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger, type AgentEvent } from '@baocut/harness';
import { createFakeCodex, fakeModel, type FakeCodex } from '../testing/fake-codex.ts';
import { codexCommand, codexSearch, describeCodexAccount } from './codex-binary.ts';
import { CodexDriver } from './codex-driver.ts';
import { CODEX_TOOL_TIMEOUT_SEC, codexPolicy } from './codex-session.ts';

/**
 * Codex Driver 对着假 codex（`testing/fake-codex.ts`）：探测的几种状态、模型目录与配置里的模型，与受限的一次性会话（§6.9）
 * 在 `thread/start` 里实际发出的参数。从不启动本机真实的 codex。会话本身的行为见 `codex-session.test.ts`。
 */

async function until<T>(read: () => T | undefined | null | false, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('CodexDriver（假 codex）', () => {
  let dir: string;
  let fake: FakeCodex;
  let driver: CodexDriver;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-codex-driver-'));
    fake = await createFakeCodex(path.join(dir, 'fake'));
    driver = new CodexDriver(silentLogger, { locate: fake.locate });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('探测：没有安装、没有登录、可用', async () => {
    fake.scenario({ installed: false });
    expect(await driver.probe()).toMatchObject({ state: 'not-installed', status: 'unavailable', unavailableReason: 'not-installed', version: null });
    fake.scenario({ installed: true, loggedIn: false });
    expect(await driver.probe()).toMatchObject({ state: 'signed-out', status: 'unavailable', unavailableReason: 'not-connected', version: '0.160.0' });
    fake.scenario({ loggedIn: true });
    expect(await driver.probe()).toMatchObject({ state: 'ready', status: 'available', unavailableReason: null, version: '0.160.0', minVersion: '0.158.0' });
  });

  /** 手动指定的位置是一个包装脚本（issue #124）：`body` 是脚本内容，`CODEX` 是假 codex 的路径。 */
  async function wrapperDriver(body: string): Promise<CodexDriver> {
    const install = (await fake.locate())!;
    const command = path.join(dir, 'codex-wrapper');
    await fs.writeFile(command, `#!/bin/sh\nCODEX="${install.command}"\n${body}\n`, { mode: 0o755 });
    return new CodexDriver(silentLogger, { locate: async () => ({ ...install, command }) });
  }

  it('探测：包装脚本在参数后面多加旗标时，报 login status 的真实原因，不说未登录', async () => {
    const wrapped = await wrapperDriver('"$CODEX" "$@" --yolo');
    const probe = await wrapped.probe();
    expect(probe).toMatchObject({ state: 'error', status: 'unavailable', version: '0.160.0', models: [] });
    expect(probe.detail).toContain("error: unexpected argument '--yolo' found");
    expect(probe.detail).toContain('login status');
    // 只要原因那一行，不带 clap 的用法说明。
    expect(probe.detail).not.toContain('Usage:');
  });

  it('探测：login status 因为别的原因失败（包装脚本里找不到命令）也不算未登录', async () => {
    const wrapped = await wrapperDriver('case "$1" in --version) exec "$CODEX" "$@" ;; esac\necho "codex: command not found" >&2\nexit 127');
    expect((await wrapped.probe()).state).toBe('error');
  });

  it('探测：包装脚本原样转发时走通；login status 仍是未登录的，按未登录报', async () => {
    fake.scenario({ loggedIn: false });
    const wrapped = await wrapperDriver('exec "$CODEX" "$@"');
    expect(await wrapped.probe()).toMatchObject({ state: 'signed-out', models: expect.arrayContaining([expect.objectContaining({ id: 'fake-sol' })]) });
  });

  it('探测：配置选了自定义提供方（requiresOpenaiAuth 为 false）时不需要登录，账号写自定义提供方', async () => {
    fake.scenario({ loggedIn: false, requiresOpenaiAuth: false });
    const probe = await driver.probe();
    expect(probe).toMatchObject({ state: 'ready', status: 'available', account: '自定义模型提供方', accountRef: { key: 'driversCodex.customProvider' } });
    expect(fake.requests('account/read').map((r) => r.params)).toEqual([{ refreshToken: false }]);
    await until(() => fake.log().some((e) => e.kind === 'account-exit'));
    expect(fake.log().some((e) => e.kind === 'start')).toBe(false);
  });

  it('探测：已登录时不多问 account/read', async () => {
    expect(await driver.probe()).toMatchObject({ state: 'ready' });
    expect(fake.requests('account/read')).toEqual([]);
  });

  it('探测：问不出要不要登录时（app-server 起不来）按未登录报', async () => {
    fake.scenario({ loggedIn: false, requiresOpenaiAuth: false });
    const wrapped = await wrapperDriver('case "$1" in app-server) echo "cannot start" >&2; exit 3 ;; esac\nexec "$CODEX" "$@"');
    expect(await wrapped.probe()).toMatchObject({ state: 'signed-out', models: [] });
  });

  it('探测：账号描述取登录方式，不带 login status 的原文（可能有打码的密钥）', async () => {
    expect(await driver.probe()).toMatchObject({ state: 'ready', account: 'ChatGPT 账号' });
    expect(describeCodexAccount('Logged in using an API key - sk-proj-***ABCD')).toBe('OpenAI API 密钥');
    expect(describeCodexAccount('Logged in using Amazon Bedrock API key')).toBe('Amazon Bedrock');
    expect(describeCodexAccount('Logged in using personal access token')).toBe('访问令牌');
    expect(describeCodexAccount('Logged in using workload identity')).toBe('工作负载身份');
    expect(describeCodexAccount('')).toBe('Codex 账号');
  });

  it('探测：经临时 app-server 的 model/list 取模型表（含分页），隐藏的不列；进程用完就关，不算会话', async () => {
    const probe = await driver.probe();
    expect(probe.capabilities).toEqual({ steer: true, approvals: true, resume: true, images: true });
    expect(probe.models).toEqual([
      {
        id: 'fake-sol',
        label: 'FAKE-SOL',
        description: 'Balanced workhorse.',
        tier: 'balanced',
        isDefault: true,
        efforts: [
          { id: 'low', label: 'low' },
          { id: 'medium', label: 'medium' },
          { id: 'high', label: 'high' },
        ],
        defaultEffort: 'medium',
      },
      expect.objectContaining({ id: 'fake-luna', tier: 'fast', isDefault: false }),
    ]);
    // 没有 config.toml。
    expect(probe).toMatchObject({ configModel: null, configModelKnown: null });
    const lists = fake.requests('model/list');
    expect(lists.map((r) => r.params)).toEqual([{ includeHidden: true }, { includeHidden: true, cursor: '2' }]);
    const init = fake.requests('initialize')[0]!.params;
    expect(init.capabilities).toBeNull();
    await until(() => fake.log().some((e) => e.kind === 'catalog-exit'));
    expect(fake.log().filter((e) => e.kind === 'catalog-start')).toHaveLength(1);
    expect(fake.log().some((e) => e.kind === 'start')).toBe(false);
  });

  it('探测：未登录也列模型；版本太旧时不起 app-server', async () => {
    fake.scenario({ loggedIn: false });
    const signedOut = await driver.probe();
    expect(signedOut).toMatchObject({ state: 'signed-out' });
    expect(signedOut.models.map((m) => m.id)).toEqual(['fake-sol', 'fake-luna']);
    fake.scenario({ version: '0.120.0' });
    const outdated = await driver.probe();
    expect(outdated).toMatchObject({ state: 'outdated', models: [], configModelKnown: null });
    expect(fake.log().filter((e) => e.kind === 'catalog-start')).toHaveLength(1);
  });

  it('探测：模型表缓存，同时到来的探测共用一次请求', async () => {
    await Promise.all([driver.probe(), driver.probe()]);
    await driver.probe();
    expect(fake.log().filter((e) => e.kind === 'catalog-start')).toHaveLength(1);
  });

  it('探测：config.toml 顶层的 model，与它在不在目录里（隐藏模型也算认得）', async () => {
    const config = path.join(fake.codexHome, 'config.toml');
    await fs.writeFile(config, 'model = "fake-hidden"\nmodel_reasoning_effort = "high"\n');
    expect(await driver.probe()).toMatchObject({ configModel: 'fake-hidden', configModelKnown: true });
    await fs.writeFile(config, '# 新客户端写的\nmodel = "gpt-from-the-future"\n');
    expect(await driver.probe()).toMatchObject({ configModel: 'gpt-from-the-future', configModelKnown: false });
    // profile 表里的不算。
    await fs.writeFile(config, '[profiles.fast]\nmodel = "fake-luna"\n');
    expect(await driver.probe()).toMatchObject({ configModel: null, configModelKnown: null });
  });

  it('探测：model/list 出错时模型表为空，探测照常；configModelKnown 说不清为 null', async () => {
    fake.scenario({ models: 'error' });
    await fs.writeFile(path.join(fake.codexHome, 'config.toml'), 'model = "fake-sol"\n');
    expect(await driver.probe()).toMatchObject({ state: 'ready', models: [], configModel: 'fake-sol', configModelKnown: null });
    // 失败也缓存一会儿，不每次探测都起进程。
    await driver.probe();
    expect(fake.log().filter((e) => e.kind === 'catalog-start')).toHaveLength(1);
  });

  it('探测：model/list 空表时 configModelKnown 为 null', async () => {
    fake.scenario({ models: [] });
    await fs.writeFile(path.join(fake.codexHome, 'config.toml'), 'model = "fake-sol"\n');
    expect(await driver.probe()).toMatchObject({ state: 'ready', models: [], configModel: 'fake-sol', configModelKnown: null });
  });

  it('探测：model/list 不应答时按时限放弃，并关掉临时进程', async () => {
    fake.scenario({ models: 'hang' });
    const slow = new CodexDriver(silentLogger, { locate: fake.locate, modelListTimeoutMs: 300 });
    const started = Date.now();
    expect(await slow.probe()).toMatchObject({ state: 'ready', models: [] });
    expect(Date.now() - started).toBeLessThan(4_000);
    await until(() => fake.log().some((e) => e.kind === 'catalog-exit'));
  });

  it('探测：只列可见模型，未知的说明不臆测定位', async () => {
    fake.scenario({ models: [fakeModel('gpt-5.5', { description: 'Older model.' }), fakeModel('codex-auto-review', { hidden: true })] });
    const probe = await driver.probe();
    expect(probe.models).toEqual([expect.objectContaining({ id: 'gpt-5.5', tier: null, description: 'Older model.' })]);
  });

  it('受限的会话：工作目录、从不审批、只写工作目录（不含临时目录、不联网），没有 MCP 服务；关闭后进程退出', async () => {
    const cwd = path.join(dir, 'staging');
    await fs.mkdir(cwd);
    const session = await driver.createSession({
      cwd,
      accessMode: 'fullAccess',
      model: null,
      effort: null,
      resume: null,
      developerInstructions: 'make one image',
      confinement: 'cwd-write-only',
    });
    const [start] = fake.requests('thread/start');
    expect(start!.params).toEqual({
      cwd,
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
      developerInstructions: 'make one image',
      config: {
        sandbox_workspace_write: { writable_roots: [], network_access: false, exclude_tmpdir_env_var: true, exclude_slash_tmp: true },
      },
    });
    expect(fake.log().find((e) => e.kind === 'start')!.cwd).toBe(await fs.realpath(cwd));
    await session.close();
    await until(() => fake.log().some((e) => e.kind === 'exit'));
  });

  it('关不掉工具：no-tools 在开会话时拒绝，不当成没有限制，也不启动 codex', async () => {
    const cwd = path.join(dir, 'staging');
    await fs.mkdir(cwd);
    const failed = await driver
      .createSession({ cwd, accessMode: 'fullAccess', model: null, effort: null, resume: null, confinement: 'no-tools' })
      .catch((error: unknown) => error);
    expect(failed).toMatchObject({ code: 'driver-unavailable' });
    expect(fake.log().filter((e) => e.kind === 'start')).toEqual([]);
  });

  it('普通会话不受影响：按访问模式给策略，带上 MCP 服务与放宽的工具时限，没有沙箱的细项', async () => {
    const cwd = path.join(dir, 'project');
    await fs.mkdir(cwd);
    const session = await driver.createSession({
      cwd,
      accessMode: 'ask',
      model: null,
      effort: null,
      resume: null,
      mcpServers: { baocut: { url: 'http://127.0.0.1:1/mcp', headers: { authorization: 'Bearer test-token' } } },
    });
    const [start] = fake.requests('thread/start');
    expect(start!.params).toMatchObject({ cwd, approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: 'workspace-write' });
    const config = start!.params.config as Record<string, unknown>;
    expect(Object.keys(config)).toEqual(['mcp_servers']);
    // 工具调用可能在等用户批准：不用 Codex 默认的 60 秒上限。
    expect(config.mcp_servers).toMatchObject({ baocut: { default_tools_approval_mode: 'approve', tool_timeout_sec: CODEX_TOOL_TIMEOUT_SEC } });
    expect(CODEX_TOOL_TIMEOUT_SEC).toBe(86400);
    await session.close();
  });

  it('访问模式 → Codex 的审批策略与沙箱（取更严的一方），旧值先换成新值', () => {
    expect(codexPolicy('plan')).toEqual({ approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: 'read-only' });
    expect(codexPolicy('ask')).toEqual({ approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: 'workspace-write' });
    expect(codexPolicy('autoAcceptEdits')).toEqual({ approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: 'workspace-write' });
    expect(codexPolicy('auto')).toEqual({ approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' });
    expect(codexPolicy('fullAccess')).toEqual({ approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'workspace-write' });
    expect(codexPolicy('controlled')).toEqual(codexPolicy('ask'));
    expect(codexPolicy('authorized')).toEqual(codexPolicy('fullAccess'));
  });

  it('auto 下 Codex 来问的只有越出沙箱的动作：审批请求带 escalation；ask 下不带', async () => {
    const cwd = path.join(dir, 'project');
    await fs.mkdir(cwd);
    fake.scenario({ turn: { askApproval: true, reply: 'done' } });
    for (const [accessMode, escalation] of [
      ['auto', true],
      ['ask', undefined],
    ] as const) {
      const session = await driver.createSession({ cwd, accessMode, model: null, effort: null, resume: null });
      const events: AgentEvent[] = [];
      session.subscribe((event) => events.push(event));
      await session.startTurn({ text: 'go' }, { accessMode, model: null, effort: null });
      const asked = await until(() => events.find((e) => e.type === 'approval.requested'));
      expect(asked.type === 'approval.requested' && asked.escalation).toBe(escalation);
      if (asked.type === 'approval.requested') await session.respondToApproval(asked.approvalId, { decision: 'decline' });
      await until(() => events.find((e) => e.type === 'turn.completed'));
      await session.close();
    }
  });
});

describe('Windows 上找 codex（纯函数；未在 Windows 上验证）', () => {
  it('文件名与常见位置：codex.exe 与 npm 的 codex.cmd；macOS 看随桌面应用装的；Linux 只看 PATH', () => {
    expect(codexSearch('win32', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'C:\\Users\\me')).toEqual({
      names: ['codex.exe', 'codex.cmd'],
      locations: ['C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd'],
    });
    expect(codexSearch('win32', {}, 'C:\\Users\\用户 甲').locations).toEqual(['C:\\Users\\用户 甲\\AppData\\Roaming\\npm\\codex.cmd']);
    expect(codexSearch('darwin', {}, '/Users/me')).toEqual({
      names: ['codex'],
      locations: [
        '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
        '/Users/me/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
        '/Applications/Codex.app/Contents/Resources/codex',
        '/Users/me/Applications/Codex.app/Contents/Resources/codex',
      ],
    });
    expect(codexSearch('linux', {}, '/home/me')).toEqual({ names: ['codex'], locations: [] });
  });

  it('npm 垫片还原出的 codex.js 交给 node 跑，子命令跟在后面；其余直接跑', () => {
    const js = 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js';
    expect(codexCommand(js, ['app-server'])).toEqual({ file: 'node', args: [js, 'app-server'] });
    expect(codexCommand('/opt/homebrew/bin/codex', ['login', 'status'])).toEqual({ file: '/opt/homebrew/bin/codex', args: ['login', 'status'] });
  });
});
