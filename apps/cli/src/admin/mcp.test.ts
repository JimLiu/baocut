import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ServiceStatus } from '@baocut/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliError } from '../envelope.ts';
import { FakeClient, captureOutput } from '../testing/fake-client.ts';
import { AdminRun } from './context.ts';
import { mcp } from './mcp.ts';

let home: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-mcp-install-'));
  // PATH 为空：不会调到本机的 claude。
  env = { HOME: home, PATH: '' };
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const off: ServiceStatus = {
  serviceId: 'mcp',
  label: 'MCP 服务',
  available: true,
  state: 'off',
  error: null,
  autostart: false,
  port: 47620,
  endpoint: null,
  policy: { videos: 'all', level: 'ask' },
  clients: [],
  recentRequests: [],
};
const client = { clientId: 'mcl_1', name: 'Cursor', createdAt: '2026-10-06T00:00:00.000Z', lastUsedAt: null };
const project = { id: 'prj_1', name: '已有的项目', path: '/projects/existing' };

function fakeRuntime(service: ServiceStatus = off): FakeClient {
  const fake = new FakeClient();
  let current = service;
  fake.methods['services.list'] = () => ({ services: [current] });
  fake.methods['services.configure'] = (params) => {
    current = {
      ...current,
      autostart: params.autostart as boolean,
      policy: { ...current.policy!, ...(params.level ? { level: params.level } : {}) },
    } as ServiceStatus;
    return { service: current };
  };
  fake.methods['services.start'] = () => {
    current = { ...current, state: 'on', endpoint: 'http://127.0.0.1:47620/mcp' };
    return { service: current };
  };
  fake.methods['services.mcp.createClient'] = (params) => ({ client: { ...client, name: params.name }, token: 'bct_secret' });
  fake.methods['services.mcp.connectionInfo'] = () => ({ url: 'http://127.0.0.1:47620/mcp' });
  fake.methods['services.mcp.revokeClient'] = () => ({ clients: [] });
  fake.methods['projects.list'] = () => ({ projects: [project] });
  return fake;
}

function run(args: string[], values: Record<string, unknown>, fake: FakeClient, json = true) {
  const capture = captureOutput(json);
  const ctx = new AdminRun({ client: fake.client, output: capture.output, cwd: home, home, env, args, values, usage: mcp.usage });
  return { capture, done: mcp.run(ctx as never) };
}

describe('baocut mcp install', () => {
  it('开服务（随 Runtime 启动）、建客户端、写宿主配置', async () => {
    const fake = fakeRuntime();
    const { capture, done } = run(['install'], { agent: 'cursor', level: 'auto' }, fake);
    expect(await done).toBe(0);
    expect(fake.calls.map((call) => call.method)).toEqual([
      'services.list',
      'services.configure',
      'services.start',
      'projects.list',
      'services.mcp.createClient',
      'services.mcp.connectionInfo',
    ]);
    expect(fake.calls[1]!.params).toEqual({ serviceId: 'mcp', autostart: true, level: 'auto' });
    expect(fake.calls[4]!.params).toEqual({ name: 'Cursor' });
    const envelope = capture.envelope();
    expect(envelope.result).toMatchObject({ agent: 'cursor', entry: 'baocut', tokenStorage: 'plaintext', replaced: false, level: 'auto' });
    expect(envelope.next).toBe('baocut mcp status');
    const config = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'mcp.json'), 'utf8'));
    expect(config.mcpServers.baocut.headers.Authorization).toBe('Bearer bct_secret');
  });

  it('已有 baocut 条目、没给 --yes：拒绝，不建客户端', async () => {
    fs.mkdirSync(path.join(home, '.gemini'));
    fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), JSON.stringify({ mcpServers: { baocut: {} } }));
    const fake = fakeRuntime();
    await expect(run(['install'], { agent: 'gemini' }, fake).done).rejects.toSatisfy(
      (error: unknown) => error instanceof CliError && error.code === 'CONFIRMATION_REQUIRED',
    );
    expect(fake.calls).toEqual([]);
  });

  it('--yes 替换已有条目：从旧令牌认出旧客户端，新条目写好后吊销它', async () => {
    fs.mkdirSync(path.join(home, '.cursor'));
    const file = path.join(home, '.cursor', 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { baocut: { url: 'x', headers: { Authorization: 'Bearer mcl_old.c2VjcmV0' } } } }));
    const old = { clientId: 'mcl_old', name: 'Cursor', createdAt: '2026-10-01T00:00:00.000Z', lastUsedAt: null };
    const fake = fakeRuntime({ ...off, state: 'on', autostart: true, clients: [old] });
    const { capture, done } = run(['install'], { agent: 'cursor', yes: true }, fake, false);
    expect(await done).toBe(0);
    expect(fake.calls.map((call) => call.method)).toEqual([
      'services.list',
      'projects.list',
      'services.mcp.createClient',
      'services.mcp.connectionInfo',
      'services.mcp.revokeClient',
    ]);
    expect(fake.calls.at(-1)!.params).toEqual({ clientId: 'mcl_old' });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers.baocut.headers.Authorization).toBe('Bearer bct_secret');
    expect(capture.out()).toContain('已吊销它用的客户端：Cursor（mcl_old）');
  });

  it('--yes 替换 Claude Code 的条目：令牌从 settings.json 的 env 里认出来', async () => {
    fs.writeFileSync(
      path.join(home, '.claude.json'),
      JSON.stringify({ mcpServers: { baocut: { type: 'http', url: 'x', headers: { Authorization: 'Bearer ${BAOCUT_MCP_TOKEN}' } } } }),
    );
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ env: { BAOCUT_MCP_TOKEN: 'mcl_cc.c2VjcmV0' } }));
    const old = { clientId: 'mcl_cc', name: 'Claude Code', createdAt: '2026-10-01T00:00:00.000Z', lastUsedAt: null };
    const fake = fakeRuntime({ ...off, state: 'on', autostart: true, clients: [old] });
    const { capture, done } = run(['install'], { agent: 'claude-code', yes: true }, fake);
    expect(await done).toBe(0);
    expect(fake.calls.at(-1)).toEqual({ method: 'services.mcp.revokeClient', params: { clientId: 'mcl_cc' } });
    expect(capture.envelope().result).toMatchObject({ replaced: true, revokedClient: { clientId: 'mcl_cc' } });
  });

  it('--yes 替换认不出令牌的条目：不吊销，列出同名的客户端', async () => {
    fs.mkdirSync(path.join(home, '.gemini'));
    fs.writeFileSync(
      path.join(home, '.gemini', 'settings.json'),
      JSON.stringify({ mcpServers: { baocut: { url: 'x', headers: { Authorization: 'Bearer 手写的令牌' } } } }),
    );
    const same = { clientId: 'mcl_g', name: 'Gemini CLI', createdAt: '2026-10-01T00:00:00.000Z', lastUsedAt: null };
    const fake = fakeRuntime({ ...off, state: 'on', autostart: true, clients: [same] });
    const { capture, done } = run(['install'], { agent: 'gemini', yes: true }, fake);
    expect(await done).toBe(0);
    expect(fake.calls.map((call) => call.method)).not.toContain('services.mcp.revokeClient');
    expect(capture.envelope().result).toMatchObject({
      replaced: true,
      revokedClient: null,
      previousClientUnknown: true,
      staleClients: [same],
    });
  });

  it('--yes 替换认不出令牌的条目、也没有同名的客户端：结果里说明没有吊销', async () => {
    fs.mkdirSync(path.join(home, '.gemini'));
    fs.writeFileSync(
      path.join(home, '.gemini', 'settings.json'),
      JSON.stringify({ mcpServers: { baocut: { url: 'x', headers: { Authorization: 'Bearer 手写的令牌' } } } }),
    );
    const fake = fakeRuntime({ ...off, state: 'on', autostart: true, clients: [] });
    const { capture, done } = run(['install'], { agent: 'gemini', yes: true }, fake, false);
    expect(await done).toBe(0);
    expect(fake.calls.map((call) => call.method)).not.toContain('services.mcp.revokeClient');
    expect(capture.out()).toContain('认不出它用的是哪个客户端，没有吊销');
  });

  it('写配置失败：吊销刚建的客户端', async () => {
    fs.mkdirSync(path.join(home, '.cursor'));
    fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), '{ broken');
    const fake = fakeRuntime();
    // 读配置时就失败：在发令牌之前。
    await expect(run(['install'], { agent: 'cursor' }, fake).done).rejects.toThrow(/不是合法的 JSON/);
    expect(fake.calls).toEqual([]);

    // 发令牌之后才失败：吊销它，配置不动。
    const again = fakeRuntime();
    again.methods['services.mcp.connectionInfo'] = () => {
      throw new Error('连接信息取不到');
    };
    fs.rmSync(path.join(home, '.cursor', 'mcp.json'));
    await expect(run(['install'], { agent: 'cursor' }, again).done).rejects.toThrow(/连接信息取不到/);
    expect(again.calls.at(-1)).toEqual({ method: 'services.mcp.revokeClient', params: { clientId: 'mcl_1' } });
    expect(fs.existsSync(path.join(home, '.cursor', 'mcp.json'))).toBe(false);
  });

  it('Claude Code：令牌只在 settings.json 的 env 里', async () => {
    const fake = fakeRuntime({ ...off, state: 'on', autostart: true });
    const { capture, done } = run(['install'], { agent: 'claude-code' }, fake);
    expect(await done).toBe(0);
    // 已开着、已随 Runtime 启动、没给等级：不改服务。
    expect(fake.calls.map((call) => call.method)).toEqual([
      'services.list',
      'projects.list',
      'services.mcp.createClient',
      'services.mcp.connectionInfo',
    ]);
    expect(capture.envelope().result).toMatchObject({ tokenStorage: 'env', envVar: 'BAOCUT_MCP_TOKEN' });
    expect(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).not.toContain('bct_secret');
    expect(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8')).toContain('bct_secret');
  });

  it('还没有任何项目：登记默认项目目录下的 CLI 项目，外部 Agent 新建视频才有项目可用', async () => {
    const projectsDir = path.join(home, 'BaoCut Projects');
    const fake = fakeRuntime({ ...off, state: 'on', autostart: true });
    fake.methods['projects.list'] = () => ({ projects: [] });
    fake.methods['runtime.info'] = () => ({ projectsDir });
    fake.methods['projects.open'] = (params) => ({ project: { id: 'prj_cli', name: 'CLI', path: params.path } });
    const { capture, done } = run(['install'], { agent: 'cursor' }, fake);
    expect(await done).toBe(0);
    const dir = path.join(projectsDir, 'CLI');
    expect(fs.statSync(dir).isDirectory()).toBe(true);
    expect(fake.calls.map((call) => call.method)).toEqual([
      'services.list',
      'projects.list',
      'runtime.info',
      'projects.open',
      'services.mcp.createClient',
      'services.mcp.connectionInfo',
    ]);
    expect(fake.calls[3]!.params).toEqual({ path: dir });
    expect(capture.envelope().result).toMatchObject({ defaultProject: { projectId: 'prj_cli', name: 'CLI', path: dir } });
  });

  it('已有项目：不登记新项目，结果里 defaultProject 为 null', async () => {
    const fake = fakeRuntime({ ...off, state: 'on', autostart: true });
    const { capture, done } = run(['install'], { agent: 'cursor' }, fake);
    expect(await done).toBe(0);
    expect(fake.calls.map((call) => call.method)).not.toContain('projects.open');
    expect(capture.envelope().result).toMatchObject({ defaultProject: null });
  });

  it('等级只认 ask、auto', async () => {
    await expect(run(['install'], { agent: 'codex', level: 'readonly' }, fakeRuntime()).done).rejects.toSatisfy(
      (error: unknown) => error instanceof CliError && error.code === 'INVALID_ARGUMENTS',
    );
  });
});

describe('baocut mcp status', () => {
  it('服务、客户端与各宿主有没有条目，不含令牌', async () => {
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { baocut: { url: 'x' } } }));
    const fake = fakeRuntime({ ...off, state: 'on', endpoint: 'http://127.0.0.1:47620/mcp', clients: [client] });
    const { capture, done } = run(['status'], {}, fake, false);
    expect(await done).toBe(0);
    const text = capture.out();
    expect(text).toContain('mcl_1');
    expect(text).toMatch(/Claude Code\s+有/);
    expect(text).toMatch(/Codex\s+没有/);
    expect(text).not.toContain('bct_');
  });
});
