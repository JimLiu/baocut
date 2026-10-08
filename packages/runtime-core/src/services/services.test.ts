import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient, applyServicesEvent, applyTasksEvent } from '@baocut/client';
import { writeFakeYtDlp } from '@baocut/jobs';
import { fakeOpenAiHandler, startFakeProviderServer, type FakeProviderServer } from '@baocut/providers/testing';
import {
  MCP_INTERFACE_VERSION,
  MCP_SERVICE_TOOL_NAMES,
  newId,
  type Id,
  type Project,
  type ServicesEvent,
  type ServicesSnapshot,
  type ServiceStatus,
  type TasksSnapshot,
} from '@baocut/protocol';
import { resolveRuntimeHome, type RuntimeHome } from '@baocut/runtime-storage';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { startRuntime, type RunningRuntime, type StartRuntimeOptions } from '../runtime.ts';
import { ToolDriver, tool, until } from '../agent-tools/testing/fake-agent.ts';
import { call, raw, rpc, type Loose } from './testing/mcp-client.ts';

/**
 * 对外服务（架构设计 §4.8、§12.8）：ServiceManager 的生命周期与配置、节点服务的投影，以及 MCP 服务的认证与来源检查。
 * 只用回环地址、系统挑的端口与临时的 Runtime Home；不需要视频引擎。
 */

describe('对外服务', () => {
  let dir: string;
  let home: RuntimeHome;
  let runtime: RunningRuntime | undefined;
  let client: BaoCutClient | undefined;
  let driver: ToolDriver;
  let blocker: net.Server | undefined;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-services-'));
    home = resolveRuntimeHome({ BAOCUT_HOME: dir });
  });

  afterEach(async () => {
    client?.close();
    await runtime?.close();
    await new Promise((resolve) => (blocker ? blocker.close(resolve) : resolve(undefined)));
    client = runtime = blocker = undefined;
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function boot(options: Partial<StartRuntimeOptions> = {}): Promise<{ runtime: RunningRuntime; client: BaoCutClient }> {
    driver = new ToolDriver();
    runtime = await startRuntime({
      home,
      drivers: () => [driver],
      watchSpace: false,
      engineHost: null,
      modelWorker: null,
      initiator: { discoverer: null },
      ...options,
      nodes: { host: '127.0.0.1', advertiser: null, ...options.nodes },
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    return { runtime, client };
  }

  async function restart(): Promise<{ runtime: RunningRuntime; client: BaoCutClient }> {
    client?.close();
    await runtime?.close();
    return boot();
  }

  async function occupyPort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    blocker = server;
    return (server.address() as net.AddressInfo).port;
  }

  async function portFree(port: number): Promise<boolean> {
    const probe = net.createServer();
    return new Promise((resolve) => {
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
  }

  function find(services: ServiceStatus[], id: string): ServiceStatus {
    return services.find((s) => s.serviceId === id)!;
  }

  /** 开着的 MCP 服务（系统挑的端口）、一个客户端令牌。 */
  async function openMcp(level: 'read' | 'ask' | 'auto' = 'auto'): Promise<{ url: string; token: string; clientId: string }> {
    await client!.request('services.configure', { serviceId: 'mcp', port: 0, level });
    const { service } = await client!.request('services.start', { serviceId: 'mcp' });
    expect(service.state).toBe('on');
    const { client: issued, token } = await client!.request('services.mcp.createClient', { name: '测试客户端' });
    return { url: service.endpoint!, token, clientId: issued.clientId };
  }

  it('默认全部关闭：四个服务都列出，都可以开启', async () => {
    const { client } = await boot();
    const { services } = await client.request('services.list', {});
    expect(services.map((s) => s.serviceId)).toEqual(['mcp', 'model-api', 'web', 'node']);
    expect(services.every((s) => s.state === 'off' && s.error === null && s.endpoint === null)).toBe(true);
    expect(find(services, 'mcp')).toMatchObject({
      available: true,
      autostart: false,
      port: 47620,
      policy: { videos: 'all', level: 'ask' },
      clients: [],
    });
    expect(find(services, 'model-api')).toMatchObject({
      available: true,
      autostart: false,
      port: 47621,
      policy: { videos: 'all', level: 'ask' },
      clients: [],
      modelApi: { routing: { online: false, nodes: false, agent: false }, maxConcurrentPerClient: 4, interfaceVersion: '1' },
    });
    expect(find(services, 'model-api').modelApi!.aliases).toEqual([
      { alias: 'whisper-1', capability: 'transcribe', providerId: 'local', modelId: null },
    ]);
    expect(find(services, 'web')).toMatchObject({ available: true, autostart: false, port: 47622, policy: null, clients: [] });
    // 节点服务的配置用 nodes.share.*。
    expect(await client.request('services.configure', { serviceId: 'node', port: 1234 }).catch((e: unknown) => e)).toMatchObject({
      code: 'invalid-request',
    });
    // 只是列出，不落盘。
    expect(await fs.stat(home.servicesFile).catch(() => null)).toBeNull();
  });

  it('开启与停止 MCP；配置原子落盘（0600），重启后恢复并随 Runtime 开启；Runtime 停止时释放端口', async () => {
    const { client } = await boot();
    const { url, token, clientId } = await openMcp('read');
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect((await rpc(url, token, 'ping')).status).toBe(200);

    const stopped = await client.request('services.stop', { serviceId: 'mcp' });
    expect(stopped.service).toMatchObject({ state: 'off', endpoint: null });
    expect((await raw(url, { body: {} }).catch(() => null))?.status ?? 0).toBe(0);

    await client.request('services.configure', { serviceId: 'mcp', autostart: true, videos: { ids: ['vid_a', 'vid_a', 'vid_b'] } });
    const stat = await fs.stat(home.servicesFile);
    expect(stat.mode & 0o777).toBe(0o600);
    const stored = await fs.readFile(home.servicesFile, 'utf8');
    expect(stored).not.toContain(token.split('.')[1]!);
    expect(JSON.parse(stored).services.mcp).toMatchObject({
      autostart: true,
      port: 0,
      policy: { level: 'read', videos: { ids: ['vid_a', 'vid_b'] } },
    });

    const { runtime: second, client: again } = await restart();
    const mcp = find((await again.request('services.list', {})).services, 'mcp');
    expect(mcp).toMatchObject({ state: 'on', autostart: true, policy: { level: 'read', videos: { ids: ['vid_a', 'vid_b'] } } });
    expect(mcp.clients.map((c) => c.clientId)).toEqual([clientId]);
    // 令牌跨重启有效（只存哈希）。
    const restored = mcp.endpoint!;
    expect((await rpc(restored, token, 'ping')).status).toBe(200);
    const port = Number(new URL(restored).port);
    await second.close();
    runtime = undefined;
    expect(await portFree(port)).toBe(true);
  });

  it('端口被占用：随 Runtime 开启的 MCP 进入 error 并说明原因，不换端口；Runtime 照常启动', async () => {
    const taken = await occupyPort();
    const { client } = await boot();
    await client.request('services.configure', { serviceId: 'mcp', port: taken, autostart: true });
    const { client: again } = await restart();
    expect((await again.request('runtime.info', {})).instanceId).toBeTruthy();
    const mcp = find((await again.request('services.list', {})).services, 'mcp');
    expect(mcp).toMatchObject({ state: 'error', port: taken, endpoint: null });
    expect(mcp.error).toContain(`端口 ${taken} 已被占用`);

    // 手动开启同样失败；换一个端口之后能开（改端口时按新端口重新开启）。
    expect((await again.request('services.start', { serviceId: 'mcp' })).service.state).toBe('error');
    const moved = await again.request('services.configure', { serviceId: 'mcp', port: 0 });
    expect(moved.service.state).toBe('on');
    expect(moved.service.error).toBeNull();
  });

  it('services 主题：快照与状态变化；节点服务的状态与 nodes.share.status 一致', async () => {
    const { client } = await boot();
    let mirror: ServicesSnapshot | null = null;
    const events: ServicesEvent[] = [];
    client.subscribeServices({
      snapshot: (snapshot) => {
        mirror = snapshot;
      },
      event: (event) => {
        events.push(event);
        if (mirror) mirror = applyServicesEvent(mirror, event);
      },
    });
    const initial = await until(() => mirror);
    expect(initial.services).toHaveLength(4);
    expect(initial.approvals).toEqual([]);

    await openMcp();
    await until(() => mirror && find(mirror.services, 'mcp').state === 'on' && find(mirror.services, 'mcp').clients.length === 1);
    const states = events
      .filter((e) => e.type === 'service.updated' && e.service.serviceId === 'mcp')
      .map((e) => (e as { service: ServiceStatus }).service.state);
    expect(states).toContain('starting');
    expect(states).toContain('on');

    // 节点服务：nodes.share.* 是权威，services 只是投影。
    const share = await client.request('nodes.share.start', { port: 0 });
    expect(share.listening).toBe(true);
    const node = find((await client.request('services.list', {})).services, 'node');
    expect(node).toMatchObject({ state: 'on', autostart: true, port: share.port, error: null, policy: null });
    await until(() => mirror && find(mirror.services, 'node').state === 'on');
    // 投影里没有配对码。
    expect(JSON.stringify(node)).not.toContain((share.pairing as { code: string }).code);

    // 经 services.stop 关闭等同 nodes.share.stop。
    await client.request('services.stop', { serviceId: 'node' });
    expect((await client.request('nodes.share.status', {})).enabled).toBe(false);
    expect(find((await client.request('services.list', {})).services, 'node').state).toBe('off');
    await client.request('services.start', { serviceId: 'node' });
    const status = await client.request('nodes.share.status', {});
    expect(status).toMatchObject({ enabled: true, listening: true });
    expect(find((await client.request('services.list', {})).services, 'node')).toMatchObject({ state: 'on', port: status.port });
    await client.request('nodes.share.stop', {});
    await until(() => mirror && find(mirror.services, 'node').state === 'off');
  });

  it('MCP 认证与来源：没有令牌、令牌错误 → 401；带 Origin、Host 不是回环 → 403；吊销后失效', async () => {
    const { client } = await boot();
    const { url, token, clientId } = await openMcp();
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    const port = new URL(url).port;

    expect((await raw(url, { body })).status).toBe(401);
    expect((await raw(url, { body, headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
    const [id, secret] = token.split('.');
    const flipped = secret!.startsWith('A') ? `B${secret!.slice(1)}` : `A${secret!.slice(1)}`;
    expect((await raw(url, { body, headers: { Authorization: `Bearer ${id}.${flipped}` } })).status).toBe(401);
    expect((await raw(url, { body, headers: { Authorization: `Basic ${token}` } })).status).toBe(401);

    const auth = { Authorization: `Bearer ${token}` };
    expect((await raw(url, { body, headers: auth })).status).toBe(200);
    expect((await raw(url, { body, headers: { ...auth, Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await raw(url, { body, headers: { ...auth, Origin: 'null' } })).status).toBe(403);
    expect((await raw(url, { body, headers: { ...auth, Host: `evil.example:${port}` } })).status).toBe(403);
    expect((await raw(url, { body, headers: { ...auth, Host: `192.168.1.10:${port}` } })).status).toBe(403);
    expect((await raw(url, { body, headers: { ...auth, Host: `localhost:${port}` } })).status).toBe(200);
    expect((await raw(url.replace('/mcp', '/other'), { body, headers: auth })).status).toBe(404);
    expect((await raw(url, { method: 'GET', headers: auth })).status).toBe(405);

    const { clients } = await client.request('services.mcp.revokeClient', { clientId });
    expect(clients).toEqual([]);
    expect((await raw(url, { body, headers: auth })).status).toBe(401);
    expect(await client.request('services.mcp.revokeClient', { clientId }).catch((e: unknown) => e)).toMatchObject({ code: 'not-found' });
  });

  it('服务令牌与会话令牌互不通用；网关的令牌也不能当服务令牌', async () => {
    const { runtime, client } = await boot();
    const { url, token } = await openMcp();
    const gatewayMcp = `${runtime.discovery.endpoint.replace(/^ws:/, 'http:')}/mcp`;
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    expect((await raw(gatewayMcp, { body, headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await raw(url, { body, headers: { Authorization: `Bearer ${runtime.discovery.token}` } })).status).toBe(401);

    const { project } = await client.request('projects.create', { name: '令牌' });
    const { conversation } = await client.request('conversations.create', { projectId: project.id });
    await client.request('conversations.send', { conversationId: conversation.id, text: 'hi', commandId: newId('cmd') });
    const session = await until(() => driver.sessions[0]);
    const agentHeader = session.options.mcpServers!.baocut!.headers;
    expect((await raw(gatewayMcp, { body, headers: agentHeader })).status).toBe(200);
    expect((await raw(url, { body, headers: agentHeader })).status).toBe(401);
  });

  it('initialize 报告接口版本；tools/list 按等级过滤：read 下没有写工具，看不到的工具调用时与不存在一样', async () => {
    const { client } = await boot();
    const { url, token } = await openMcp('read');
    const init = await rpc(url, token, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 't', version: '0' },
    });
    expect(init.result).toMatchObject({
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'baocut', version: MCP_INTERFACE_VERSION },
      _meta: { 'baocut.interfaceVersion': MCP_INTERFACE_VERSION },
    });

    const names = async () => ((await rpc(url, token, 'tools/list')).result!.tools as { name: string }[]).map((t) => t.name).sort();
    const allowed = (effects?: string[]) =>
      MCP_SERVICE_TOOL_NAMES.filter((t) => !effects || effects.includes(t.effect))
        .map((t) => t.name)
        .sort();
    expect(await names()).toEqual(allowed(['query']));
    const hidden = await rpc(url, token, 'tools/call', { name: 'edits_apply', arguments: {} });
    expect(hidden.result!.isError).toBe(true);
    expect(JSON.parse((hidden.result!.content as { text: string }[])[0]!.text).error.code).toBe('UNKNOWN_TOOL');

    await client.request('services.configure', { serviceId: 'mcp', level: 'ask' });
    expect(await names()).toEqual(allowed());
    await client.request('services.configure', { serviceId: 'mcp', level: 'auto' });
    const auto = await names();
    expect(auto).toEqual(allowed());
    // 目录项的 surfaces 不含 mcp 的工具不开放：删除视频、写文件、装模型、申请授权、存下载件。
    for (const name of ['videos_delete', 'artifacts_save', 'models_install', 'grants_request', 'downloads_save']) {
      expect(auto).not.toContain(name);
    }
    // 任务合同的工具只在工具桥一面（§3.2）：对外服务没有任务，调用时与不存在一样。
    for (const name of ['tasks_contract', 'tasks_update_contract', 'tasks_record_check']) {
      expect(auto).not.toContain(name);
      const call = await rpc(url, token, 'tools/call', { name, arguments: {} });
      expect(JSON.parse((call.result!.content as { text: string }[])[0]!.text).error.code).toBe('UNKNOWN_TOOL');
    }
    // 对外的说明不提会话与工作目录。
    const tools = (await rpc(url, token, 'tools/list')).result!.tools as { name: string; description: string }[];
    expect(tools.find((t) => t.name === 'videos_list')!.description).not.toContain('工作目录');
  });

  it('令牌只出现一次：不在 services.list、主题、连接信息、日志、配置文件与错误里', async () => {
    const { client } = await boot();
    const events: unknown[] = [];
    let snapshot: unknown = null;
    client.subscribeServices({ snapshot: (s) => (snapshot = s), event: (e) => events.push(e) });
    const { url, token, clientId } = await openMcp('auto');
    const secret = token.split('.')[1]!;
    expect(token.startsWith(`${clientId}.`)).toBe(true);

    // 一次成功、一次被拒绝的工具调用，留下审计与错误。
    expect((await rpc(url, token, 'tools/call', { name: 'videos_list', arguments: {} })).status).toBe(200);
    const refused = await rpc(url, token, 'tools/call', { name: 'videos_inspect', arguments: { video: 'vid_missing' } });
    expect(JSON.stringify(refused)).not.toContain(secret);
    await raw(url, { body: {}, headers: { Authorization: `Bearer ${clientId}.${secret}x` } });

    const info = await client.request('services.mcp.connectionInfo', { clientId });
    expect(info).toMatchObject({
      url,
      headers: { Authorization: 'Bearer <测试客户端 的令牌>' },
      interfaceVersion: MCP_INTERFACE_VERSION,
      notice: null,
    });
    expect(JSON.parse(info.snippet)).toEqual({ mcpServers: { baocut: { type: 'http', url, headers: info.headers } } });

    const mcp = find((await client.request('services.list', {})).services, 'mcp');
    expect(mcp.recentRequests.map((r) => [r.tool, r.outcome])).toEqual([
      ['videos_inspect', 'VIDEO_NOT_FOUND'],
      ['videos_list', 'ok'],
    ]);
    await until(() => events.length > 3);
    const listed = await client.request('services.mcp.listClients', {});
    for (const text of [
      JSON.stringify(mcp),
      JSON.stringify(listed),
      JSON.stringify(info),
      JSON.stringify(events),
      JSON.stringify(snapshot),
      await fs.readFile(home.servicesFile, 'utf8'),
      await fs.readFile(path.join(home.logsDir, 'runtime.log'), 'utf8'),
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('Runtime 停止时 MCP 服务先停：待处理的审批取消，端口释放', async () => {
    const { runtime: running, client } = await boot();
    const { url } = await openMcp('ask');
    const port = Number(new URL(url).port);
    void client;
    await running.close();
    runtime = undefined;
    expect(await portFree(port)).toBe(true);
  });
});

// ---- 需要真实引擎与 ffmpeg 的部分 ----

const engine = resolveEngineHostCommand();
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!engine || !ffmpeg) console.warn('跳过对外服务的视频测试：没有 engine-host 或 ffmpeg');

describe.skipIf(!engine || !ffmpeg)('对外服务：范围、等级与审批（真实引擎）', () => {
  let fixtures: string;
  let clip: string;
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let project: Project;
  let a: { videoId: Id; relPath: string };
  let b: { videoId: Id; relPath: string };
  let url: string;
  let token: string;

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-fixtures-'));
    clip = path.join(fixtures, 'clip.mp4');
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', clip],
    ]);
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-services-video-'));
    const emptyPath = path.join(dir, 'empty-path');
    await fs.mkdir(emptyPath);
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') }),
      drivers: () => [new ToolDriver()],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
      modelWorker: null,
      initiator: { discoverer: null },
      nodes: { host: '127.0.0.1', advertiser: null },
      services: { approvalTimeoutMs: 400 },
      // PATH 只有一个空目录：yt-dlp 只有测试指定的假工具，链接的主机解析成公网地址。
      externalTools: { env: async () => ({ PATH: emptyPath }), overrides: {}, lookup: async () => ['93.184.216.34'] },
    });
    const { endpoint, token: gatewayToken } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token: gatewayToken }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    ({ project } = await client.request('projects.create', { name: '对外服务' }));
    await fs.copyFile(clip, path.join(project.path, 'clip.mp4'));
    const first = await client.request('videos.create', { projectId: project.id, name: '样片' });
    const second = await client.request('videos.create', { projectId: project.id, name: '私密' });
    a = { videoId: first.ref.videoId, relPath: first.ref.relPath };
    b = { videoId: second.ref.videoId, relPath: second.ref.relPath };
    // 界面关掉两个视频：外部请求自己打开。
    await client.request('videos.close', { videoId: a.videoId });
    await client.request('videos.close', { videoId: b.videoId });
    await client.request('services.configure', { serviceId: 'mcp', port: 0, level: 'auto', videos: { ids: [a.videoId] } });
    const { service } = await client.request('services.start', { serviceId: 'mcp' });
    url = service.endpoint!;
    ({ token } = await client.request('services.mcp.createClient', { name: '剪辑助手' }));
  });

  afterEach(async () => {
    client.close();
    await runtime.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('名单之外的视频不可见：列表里没有，按 ID 与路径都是 VIDEO_NOT_FOUND，写入也一样', async () => {
    const listed = await call(url, token, 'videos_list', {});
    expect(listed.isError).toBe(false);
    expect(listed.body.videos).toEqual([
      { videoId: a.videoId, name: '样片', projectId: project.id, project: '对外服务', path: `${project.id}/${a.relPath}`, open: false },
    ]);

    for (const video of [b.videoId, `${project.id}/${b.relPath}`, '../elsewhere', 'vid_nope']) {
      const inspected = await call(url, token, 'videos_inspect', { video });
      expect(inspected.body.error.code, video).toBe('VIDEO_NOT_FOUND');
    }
    const write = await call(url, token, 'edits_apply', {
      video: b.videoId,
      expectedRevision: '1',
      label: 'x',
      operations: [{ type: 'renameVideo', name: '改名' }],
    });
    expect(write.body.error.code).toBe('VIDEO_NOT_FOUND');
    // 没有因此被打开。
    expect(runtime.videos.ref(b.videoId)).toBeNull();

    // 改成全部视频立即生效。
    await client.request('services.configure', { serviceId: 'mcp', videos: 'all' });
    const all = await call(url, token, 'videos_list', {});
    expect(all.body.videos.map((v: Loose) => v.videoId).sort()).toEqual([a.videoId, b.videoId].sort());
    expect((await call(url, token, 'videos_inspect', { video: `${project.id}/${b.relPath}` })).body.videoId).toBe(b.videoId);
  });

  it('videos_create：对外服务要给 project；建好的视频加进服务的名单，列表与按 ID 都看得见', async () => {
    const missing = await call(url, token, 'videos_create', { name: '新片' });
    expect(missing.body.error).toMatchObject({ code: 'INVALID_ARGUMENTS' });
    expect(missing.body.error.next).toContain('project');
    expect((await call(url, token, 'videos_create', { name: '新片', project: 'prj_nope' })).body.error.code).toBe('PROJECT_NOT_FOUND');

    const created = await call(url, token, 'videos_create', { name: '新片', project: project.id });
    expect(created.isError).toBe(false);
    const videoId = created.body.videoId as Id;
    expect(runtime.videos.ref(videoId)?.source.projectId).toBe(project.id);
    expect((await call(url, token, 'videos_list', {})).body.videos.map((v: Loose) => v.videoId).sort()).toEqual(
      [a.videoId, videoId].sort(),
    );
    expect((await call(url, token, 'videos_inspect', { video: videoId })).body.videoId).toBe(videoId);
    // 名单落进服务配置：界面看得到，b 仍然不在里面。
    const { services } = await client.request('services.list', {});
    expect(services.find((s) => s.serviceId === 'mcp')!.policy).toMatchObject({ videos: { ids: [a.videoId, videoId] } });
  });

  it('download：对外服务的落点只能是范围之内的视频或已登记的项目，newVideo 要给 project；yt-dlp 没装或用户没同意时直接拒绝，不代为安装或同意', async () => {
    const link = 'https://video.example.com/watch?v=abc';
    for (const args of [{ url: link }, { url: link, newVideo: true }]) {
      const refused = await call(url, token, 'download', args);
      expect(refused.body.error).toMatchObject({ code: 'INVALID_ARGUMENTS' });
      expect(refused.body.error.next).toContain('projects_list');
    }
    // transcribe 给 url 默认新建视频：不给 project 同样拒绝。
    expect((await call(url, token, 'transcribe', { url: link })).body.error).toMatchObject({ code: 'INVALID_ARGUMENTS' });
    // 新的 Runtime Home 里没有同意的记录：不生成审批、不提交安装。
    for (const [name, args] of [
      ['download', { url: link, video: a.videoId }],
      ['download', { url: link, project: project.id }],
      ['download', { url: link, newVideo: true, project: project.id }],
      ['transcribe', { url: link, project: project.id, language: 'en' }],
    ] as const) {
      const unavailable = await call(url, token, name, args);
      expect(unavailable.body.error, `${name} ${JSON.stringify(args)}`).toMatchObject({ code: 'TOOL_UNAVAILABLE', tool: 'yt-dlp' });
    }
    expect(runtime.harness.approvals.pending()).toEqual([]);
    expect((await client.request('jobs.list', {})).jobs).toEqual([]);
  });

  it('download newVideo 带 project：新视频建在那个项目里，登记进服务的名单，videos_list 与按 ID 都看得见', async () => {
    const fake = await writeFakeYtDlp(path.join(dir, 'bin'));
    await client.request('externalTools.setPath', { name: 'yt-dlp', path: fake.command });
    await client.request('externalTools.consent', { name: 'yt-dlp', grant: true });

    const started = await call(url, token, 'download', {
      url: 'https://video.example.com/watch?v=new',
      newVideo: true,
      project: project.id,
    });
    expect(started.isError, JSON.stringify(started.body)).toBe(false);
    const waited = await call(url, token, 'jobs_wait', { jobId: started.body.jobId, timeoutSec: 50 });
    expect(waited.body.state, JSON.stringify(waited.body.error)).toBe('completed');
    const videoId = waited.body.videoId as Id;
    expect(waited.body.pipeline.summary).toMatchObject({ createdVideo: true, videoId });

    const listed = (await call(url, token, 'videos_list', {})).body.videos as Loose[];
    expect(listed.map((v) => v.videoId).sort()).toEqual([a.videoId, videoId].sort());
    expect(listed.find((v) => v.videoId === videoId)).toMatchObject({ projectId: project.id });
    const inspected = await call(url, token, 'videos_inspect', { video: videoId });
    expect(inspected.isError, JSON.stringify(inspected.body)).toBe(false);
    const { services } = await client.request('services.list', {});
    expect(services.find((s) => s.serviceId === 'mcp')!.policy).toMatchObject({ videos: { ids: [a.videoId, videoId] } });
  });

  it('一级动词：对外服务不能给本机路径（file、outDir），next 指向 video 与 url；transcode 不在 MCP 面', async () => {
    for (const [name, args] of [
      ['transcribe', { file: '/etc/hosts' }],
      ['transcribe', { file: 'talk.mp4', noVideo: true }],
      ['translate', { file: '/tmp/talk.srt', to: 'zh-CN' }],
    ] as const) {
      const refused = await call(url, token, name, args);
      expect(refused.body.error, `${name} ${JSON.stringify(args)}`).toMatchObject({ code: 'INVALID_ARGUMENTS' });
      expect(refused.body.error.next).toContain('video');
      expect(refused.body.error.next).toContain('url');
    }
    // 名单之外的视频：与不存在的一样回答，不启动流程。
    const outside = await call(url, token, 'transcribe', { video: b.videoId });
    expect(outside.body.error.code).toMatch(/VIDEO_NOT_FOUND|VIDEO_OUTSIDE/);
    expect((await call(url, token, 'transcode', { files: ['a.mp4'] })).body.error.code).toBe('UNKNOWN_TOOL');
    expect((await client.request('jobs.list', {})).jobs).toEqual([]);
  });

  it('space_list / space_search：只看范围之内的视频与它们的条目，名单之外的视频检索不到', async () => {
    for (const [video, text] of [
      [a, '样片里讲剪辑'],
      [b, '私密里也讲剪辑'],
    ] as const) {
      const opened = await client.request('videos.open', { projectId: project.id, path: video.relPath });
      await client.request('edits.apply', {
        videoId: video.videoId,
        commandId: newId('cmd'),
        expectedRevision: opened.snapshot.video.revision,
        operations: [
          {
            type: 'putDocument',
            kind: 'caption',
            name: '字幕',
            language: 'zh',
            body: {
              schema: 'baocut.caption/1',
              clock: 'sequence',
              timescale: 1_000_000,
              cues: [{ id: 'c1', start: 0, end: 1_000_000, text }],
            },
          },
        ],
      });
      await client.request('videos.close', { videoId: video.videoId });
    }
    await client.request('space.rescan', {});
    await runtime.space.idle();

    const searched = await call(url, token, 'space_search', { query: '剪辑' });
    expect(searched.isError).toBe(false);
    expect(searched.body).toMatchObject({ complete: true, pendingVideos: 0, hits: [{ videoId: a.videoId, snippet: '样片里讲剪辑' }] });
    expect(searched.body.hits).toHaveLength(1);
    expect(JSON.stringify(searched.body)).not.toContain(project.path);

    const listed = await call(url, token, 'space_list', { kind: ['video'] });
    expect(listed.body.entries.map((e: Loose) => e.videoId)).toEqual([a.videoId]);
    expect((await call(url, token, 'space_list', { videoId: b.videoId })).body.entries).toEqual([]);
    // 用户在界面里看得到全部。
    expect((await client.request('space.search', { query: '剪辑' })).hits).toHaveLength(2);
  });

  it('auto：edits_apply 直接执行，历史里的操作者是 external:mcp；文档读写；项目之外的素材文件被拒绝', async () => {
    const inspected = await call(url, token, 'videos_inspect', { video: a.videoId });
    expect(inspected.isError).toBe(false);
    const applied = await call(url, token, 'edits_apply', {
      video: a.videoId,
      expectedRevision: inspected.body.revision,
      label: '放入 clip.mp4',
      operations: [
        { type: 'importAsset', path: 'clip.mp4', ref: 'c' },
        { type: 'addItem', asset: { ref: 'c' }, at: 0 },
      ],
    });
    expect(applied.isError).toBe(false);
    expect(applied.body).toMatchObject({ status: 'committed', label: '放入 clip.mp4' });

    const { entries } = await client.request('videos.history', { videoId: a.videoId });
    const entry = entries.find((e) => e.transactionId === applied.body.transactionId)!;
    expect(entry.actor).toEqual({ kind: 'agent', id: 'external:mcp' });

    // 译文：putDocument 写入，documents_read 读回。
    const put = await call(url, token, 'edits_apply', {
      video: a.videoId,
      expectedRevision: applied.body.revision.after,
      label: '写入译文',
      operations: [{ type: 'putDocument', kind: 'translation', name: '英文', language: 'en', body: { segments: [{ text: 'hello' }] } }],
    });
    expect(put.isError).toBe(false);
    const after = await call(url, token, 'videos_inspect', { video: a.videoId });
    const document = after.body.documents.find((d: Loose) => d.kind === 'translation');
    expect(document).toMatchObject({ name: '英文', language: 'en' });
    const read = await call(url, token, 'documents_read', { video: a.videoId, documentId: document.id });
    expect(read.body).toMatchObject({ videoId: a.videoId, body: { segments: [{ text: 'hello' }] } });
    expect((await call(url, token, 'documents_read', { video: a.videoId, documentId: 'doc_nope' })).body.error.code).toBe(
      'DOCUMENT_NOT_FOUND',
    );

    // 素材文件只能在项目目录里。
    const outside = path.join(fixtures, 'clip.mp4');
    for (const file of [outside, '../outside.mp4', path.relative(project.path, outside)]) {
      const refused = await call(url, token, 'edits_apply', {
        video: a.videoId,
        expectedRevision: '1',
        label: '外面的文件',
        operations: [{ type: 'importAsset', path: file }],
      });
      expect(refused.body.error.code, file).toBe('PATH_OUTSIDE_PROJECT');
    }

    // 审计：服务里记下请求与视频。
    const mcp = (await client.request('services.list', {})).services.find((s) => s.serviceId === 'mcp')!;
    expect(mcp.recentRequests[0]).toMatchObject({
      clientName: '剪辑助手',
      tool: 'edits_apply',
      videoId: a.videoId,
      outcome: 'PATH_OUTSIDE_PROJECT',
    });
    expect(mcp.recentRequests.some((r) => r.tool === 'edits_apply' && r.outcome === 'ok')).toBe(true);
  });

  it('assets_import 只收项目里的文件；videos_frames 把帧写进视频所属项目的 exports/.baocut-out/frames/<videoId>/', async () => {
    const outside = await call(url, token, 'assets_import', { video: a.videoId, path: path.join(fixtures, 'clip.mp4'), place: {} });
    expect(outside.body.error.code).toBe('PATH_OUTSIDE_PROJECT');
    const imported = await call(url, token, 'assets_import', { video: a.videoId, path: 'clip.mp4', place: { at: '0' } });
    expect(imported.isError).toBe(false);
    expect(imported.body).toMatchObject({ status: 'committed', assetId: expect.any(String), itemId: expect.any(String) });

    const frames = await call(url, token, 'videos_frames', { video: a.videoId, at: ['0.5', '3'] });
    expect(frames.isError).toBe(false);
    const framesDir = await fs.realpath(path.join(project.path, 'exports', '.baocut-out', 'frames', a.videoId));
    expect(frames.body).toMatchObject({
      composited: false,
      frames: [
        { at: '0.5', item: imported.body.itemId },
        { at: '3', file: null },
      ],
    });
    expect(path.dirname(frames.body.frames[0].file)).toBe(framesDir);
    expect((await fs.stat(frames.body.frames[0].file)).size).toBeGreaterThan(0);
    // 名单之外的视频与不存在一样。
    expect((await call(url, token, 'videos_frames', { video: b.videoId, at: ['0'] })).body.error.code).toBe('VIDEO_NOT_FOUND');
  });

  it('export：导出到视频所属项目的 exports/；目录出不去；名单之外的视频不存在；ask 下先审批', async () => {
    const inspected = await call(url, token, 'videos_inspect', { video: a.videoId });
    const placed = await call(url, token, 'edits_apply', {
      video: a.videoId,
      expectedRevision: inspected.body.revision,
      label: '放入 clip.mp4',
      operations: [
        { type: 'importAsset', path: 'clip.mp4', ref: 'c' },
        { type: 'addItem', asset: { ref: 'c' }, at: 0 },
      ],
    });
    expect(placed.isError).toBe(false);

    const submitted = await call(url, token, 'export', { video: a.videoId, kind: 'audio', format: 'wav', commandId: 'once' });
    expect(submitted.isError).toBe(false);
    const exportsDir = path.join(await fs.realpath(project.path), 'exports');
    expect(submitted.body).toMatchObject({ kind: 'export', videoId: a.videoId, dir: exportsDir, files: ['样片.audio.wav'] });
    // 同一个客户端带同一个 commandId 重试：同一个任务。
    expect((await call(url, token, 'export', { video: a.videoId, kind: 'audio', format: 'wav', commandId: 'once' })).body.jobId).toBe(
      submitted.body.jobId,
    );
    const job = await until(async () => {
      const { body } = await call(url, token, 'jobs_inspect', { jobId: submitted.body.jobId });
      return ['completed', 'failed', 'cancelled', 'interrupted'].includes(body.state) ? body : null;
    }, 15_000);
    expect(job).toMatchObject({ state: 'completed', submittedBy: 'external' });
    expect(job.outputs[0].path).toBe(path.join(exportsDir, '样片.audio.wav'));
    expect((await fs.stat(job.outputs[0].path)).size).toBeGreaterThan(0);
    expect((await client.request('jobs.inspect', { jobId: submitted.body.jobId })).submitter).toMatchObject({ kind: 'service', id: 'mcp' });

    // 目录只能是 exports/ 里已有的子目录：出项目、出 exports/、经符号链接出去都拒绝。
    await fs.mkdir(path.join(exportsDir, 'sub'));
    await fs.symlink(fixtures, path.join(exportsDir, 'away'));
    const codeOf = async (args: Record<string, unknown>) =>
      (await call(url, token, 'export', { video: a.videoId, kind: 'audio', format: 'wav', ...args })).body;
    for (const dir of ['..', '../..', fixtures, 'away']) expect((await codeOf({ dir })).error.code, dir).toBe('PATH_OUTSIDE_PROJECT');
    expect((await codeOf({ dir: 'missing' })).error.code).toBe('INVALID_PATH');
    expect((await codeOf({ dir: 'sub', fileName: '片段' })).files).toEqual(['片段.wav']);

    // 名单之外的视频：不存在，不会因此被打开。
    expect((await codeOf({ video: b.videoId })).error.code).toBe('VIDEO_NOT_FOUND');
    expect(runtime.videos.ref(b.videoId)).toBeNull();

    // ask：先生成服务审批，拒绝时不建任务。
    await client.request('services.configure', { serviceId: 'mcp', level: 'ask' });
    let mirror: ServicesSnapshot | null = null;
    client.subscribeServices({
      snapshot: (snapshot) => (mirror = snapshot),
      event: (event) => {
        if (mirror) mirror = applyServicesEvent(mirror, event);
      },
    });
    await until(() => mirror);
    const before = (await client.request('exports.list', { videoId: a.videoId })).jobs.length;
    const pending = codeOf({ format: 'mp3' });
    const approval = await until(() => mirror?.approvals[0]);
    expect(approval).toMatchObject({
      tool: 'export',
      video: { videoId: a.videoId, name: '样片' },
      summary: expect.stringContaining('音频'),
    });
    await client.request('services.respondToApproval', { approvalId: approval.approvalId, decision: 'deny' });
    expect((await pending).error).toMatchObject({ code: 'SERVICE_APPROVAL_DENIED', reason: 'denied' });
    expect((await client.request('exports.list', { videoId: a.videoId })).jobs).toHaveLength(before);
  });

  it('ask：写入先生成服务审批；同意后执行，拒绝与超时都以 SERVICE_APPROVAL_DENIED 回答；查询不需要审批', async () => {
    await client.request('services.configure', { serviceId: 'mcp', level: 'ask' });
    let mirror: ServicesSnapshot | null = null;
    const resolved: ServicesEvent[] = [];
    client.subscribeServices({
      snapshot: (snapshot) => (mirror = snapshot),
      event: (event) => {
        if (event.type === 'approval.resolved') resolved.push(event);
        if (mirror) mirror = applyServicesEvent(mirror, event);
      },
    });
    await until(() => mirror);

    const inspected = await call(url, token, 'videos_inspect', { video: a.videoId });
    expect(inspected.isError).toBe(false);
    expect(mirror!.approvals).toEqual([]);
    const rename = async (name: string) => {
      const expectedRevision = (await call(url, token, 'videos_inspect', { video: a.videoId })).body.revision;
      return call(url, token, 'edits_apply', {
        video: a.videoId,
        expectedRevision,
        label: '改名',
        operations: [{ type: 'renameVideo', name }],
      });
    };

    // 同意：执行。
    const allowed = rename('新名字');
    const approval = await until(() => mirror?.approvals[0]);
    expect(approval).toMatchObject({
      serviceId: 'mcp',
      clientName: '剪辑助手',
      tool: 'edits_apply',
      video: { videoId: a.videoId, name: '样片' },
      summary: expect.any(String),
    });
    expect(Date.parse(approval.expiresAt) - Date.parse(approval.createdAt)).toBe(400);
    expect(await client.request('services.respondToApproval', { approvalId: approval.approvalId, decision: 'allow' })).toEqual({
      status: 'allowed',
    });
    expect((await allowed).body).toMatchObject({ status: 'committed' });
    await until(() => mirror?.approvals.length === 0);
    expect(await client.request('services.respondToApproval', { approvalId: approval.approvalId, decision: 'deny' })).toEqual({
      status: 'already-resolved',
    });

    // 拒绝：不执行。
    const before = (await call(url, token, 'videos_inspect', { video: a.videoId })).body.revision;
    const denied = rename('不该改');
    const second = await until(() => mirror?.approvals[0]);
    await client.request('services.respondToApproval', { approvalId: second.approvalId, decision: 'deny' });
    expect((await denied).body.error).toMatchObject({ code: 'SERVICE_APPROVAL_DENIED', serviceId: 'mcp', reason: 'denied' });

    // 超时：按拒绝处理。
    const timedOut = await rename('也不该改');
    expect(timedOut.body.error).toMatchObject({ code: 'SERVICE_APPROVAL_DENIED', serviceId: 'mcp', reason: 'timeout' });
    expect(resolved.map((e) => (e as { outcome: string }).outcome)).toEqual(['allowed', 'denied', 'timeout']);
    expect((await call(url, token, 'videos_inspect', { video: a.videoId })).body.revision).toBe(before);
    expect(mirror!.approvals).toEqual([]);

    // 范围之外的视频：直接不存在，不生成审批。
    const outside = await call(url, token, 'edits_apply', {
      video: b.videoId,
      expectedRevision: '1',
      label: 'x',
      operations: [{ type: 'renameVideo', name: 'x' }],
    });
    expect(outside.body.error.code).toBe('VIDEO_NOT_FOUND');
    expect(resolved).toHaveLength(3);

    // 服务停止时，待处理的审批取消。
    const pending = rename('停服务').catch(() => null);
    await until(() => mirror?.approvals[0]);
    await client.request('services.stop', { serviceId: 'mcp' });
    await pending;
    await until(() => resolved.length === 4);
    expect((resolved[3] as { outcome: string }).outcome).toBe('cancelled');
    expect(mirror!.approvals).toEqual([]);
  });

  it('服务审批由统一的审批产生：同一条也在 tasks 主题与 approvals.list 里，用 approvals.respond 处理与 services.respondToApproval 一样', async () => {
    await client.request('services.configure', { serviceId: 'mcp', level: 'ask' });
    let services: ServicesSnapshot | null = null;
    let tasks: TasksSnapshot | null = null;
    client.subscribeServices({
      snapshot: (snapshot) => (services = snapshot),
      event: (event) => {
        if (services) services = applyServicesEvent(services, event);
      },
    });
    client.subscribeTasks({
      snapshot: (snapshot) => (tasks = snapshot),
      event: (event) => {
        if (tasks) tasks = applyTasksEvent(tasks, event);
      },
    });
    await until(() => services && tasks);
    expect(tasks!.approvals).toEqual([]);
    const rename = async (name: string) => {
      const expectedRevision = (await call(url, token, 'videos_inspect', { video: a.videoId })).body.revision;
      return call(url, token, 'edits_apply', {
        video: a.videoId,
        expectedRevision,
        label: '改名',
        operations: [{ type: 'renameVideo', name }],
      });
    };

    // 统一列表里的一条：主体是服务与客户端，依据是服务等级，有时限；与服务主题里的是同一个号。
    const allowed = rename('经统一列表允许');
    const unified = await until(() => tasks?.approvals?.[0]);
    expect(unified).toMatchObject({
      subject: { kind: 'service', serviceId: 'mcp', clientName: '剪辑助手' },
      action: { kind: 'tool', name: 'edits_apply', targets: ['样片'] },
      risk: 'edit',
      basis: { kind: 'service', level: 'ask' },
    });
    expect(unified.approvalId).toMatch(/^sap_/);
    expect(unified.expiresAt).not.toBeNull();
    expect((await until(() => services?.approvals[0])).approvalId).toBe(unified.approvalId);
    expect((await client.request('approvals.list', {})).approvals).toEqual([unified]);
    expect(await client.request('approvals.respond', { approvalId: unified.approvalId, decision: 'allow' })).toEqual({ status: 'allowed' });
    expect((await allowed).body).toMatchObject({ status: 'committed' });
    expect(await client.request('services.respondToApproval', { approvalId: unified.approvalId, decision: 'deny' })).toEqual({
      status: 'already-resolved',
    });
    await until(() => tasks?.approvals?.length === 0 && services?.approvals.length === 0);

    // approvals.respond 拒绝：外部请求得到 SERVICE_APPROVAL_DENIED。
    const denied = rename('不该改');
    const second = await until(() => tasks?.approvals?.[0]);
    expect(await client.request('approvals.respond', { approvalId: second.approvalId, decision: 'deny' })).toEqual({ status: 'denied' });
    expect((await denied).body.error).toMatchObject({ code: 'SERVICE_APPROVAL_DENIED', reason: 'denied' });

    // services.respondToApproval 处理的：统一列表里同样消失。
    const viaServices = rename('经服务允许');
    const third = await until(() => services?.approvals[0]);
    await until(() => tasks?.approvals?.some((p) => p.approvalId === third.approvalId));
    await client.request('services.respondToApproval', { approvalId: third.approvalId, decision: 'allow' });
    expect((await viaServices).body).toMatchObject({ status: 'committed' });
    await until(() => tasks?.approvals?.length === 0);
    expect(runtime.harness.approvals.pending()).toEqual([]);
  });
});

// ---- 任务：本机回环地址上的假供应商 ----

const OPENAI_KEY = 'sk-test-ONLY-FOR-TESTS-services-0123456789';

describe('对外服务：任务的提交者与可见性', () => {
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let driver: ToolDriver;
  let openai: FakeProviderServer;

  beforeEach(async () => {
    openai = await startFakeProviderServer(fakeOpenAiHandler());
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-services-jobs-'));
    driver = new ToolDriver();
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: dir }),
      drivers: () => [driver],
      watchSpace: false,
      engineHost: null,
      modelWorker: null,
      jobIdleMs: 60_000,
      initiator: { discoverer: null },
      nodes: { host: '127.0.0.1', advertiser: null },
      online: { baseUrls: { openai: `${openai.origin}/v1` }, http: { backoffMs: () => 10 } },
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
  });

  afterEach(async () => {
    client.close();
    await runtime.close();
    await openai.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('服务商要用户先启用；提交者是服务的客户端；客户端只看得到自己的任务', async () => {
    await client.request('services.configure', { serviceId: 'mcp', port: 0, level: 'auto' });
    const url = (await client.request('services.start', { serviceId: 'mcp' })).service.endpoint!;
    const first = await client.request('services.mcp.createClient', { name: '甲' });
    const second = await client.request('services.mcp.createClient', { name: '乙' });

    const refused = await call(url, first.token, 'speak', { text: 'hi', provider: 'openai' });
    expect(refused.body.error.code).toBe('CAPABILITY_NOT_CONFIGURED');
    expect(await client.request('jobs.list', {})).toEqual({ jobs: [] });

    await client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    const submitted = await call(url, first.token, 'speak', { text: 'hi', provider: 'openai', commandId: 'same' });
    expect(submitted.isError).toBe(false);
    const { jobId } = submitted.body;
    expect((await client.request('jobs.inspect', { jobId })).submitter).toEqual({
      kind: 'service',
      id: 'mcp',
      clientId: first.client.clientId,
    });

    // 同一个 commandId：同一个客户端重试得到同一个任务，别的客户端不会撞上。
    expect((await call(url, first.token, 'speak', { text: 'hi', provider: 'openai', commandId: 'same' })).body.jobId).toBe(jobId);
    const other = await call(url, second.token, 'speak', { text: 'hi', provider: 'openai', commandId: 'same' });
    expect(other.body.jobId).not.toBe(jobId);

    expect((await call(url, first.token, 'jobs_inspect', { jobId })).body).toMatchObject({ jobId, submittedBy: 'external' });
    expect((await call(url, second.token, 'jobs_inspect', { jobId })).body.error.code).toBe('JOB_NOT_FOUND');

    // 界面连接与智能体会话提交的任务，服务的客户端都看不到。
    const { jobId: fromUi } = await client.request('models.synthesizeSpeech', { text: 'hi', provider: 'openai' });
    const { project } = await client.request('projects.create', { name: '会话' });
    const { conversation } = await client.request('conversations.create', { projectId: project.id });
    await client.request('conversations.send', { conversationId: conversation.id, text: '做点事', commandId: newId('cmd') });
    const session = await until(() => driver.sessions[0]);
    await until(() => session.turnId);
    const fromAgent = (await tool(session, 'speak', { text: 'hi', provider: 'openai' })).body.jobId as string;
    expect(fromAgent).toEqual(expect.any(String));
    for (const hidden of [fromUi, fromAgent]) {
      expect((await call(url, first.token, 'jobs_inspect', { jobId: hidden })).body.error.code).toBe('JOB_NOT_FOUND');
    }
    // 智能体也看不到服务的任务。
    expect((await tool(session, 'jobs_inspect', { jobId })).body.error.code).toBe('JOB_NOT_FOUND');

    // 停止服务不取消它提交的任务（任务归 JobManager）。
    await client.request('services.stop', { serviceId: 'mcp' });
    expect((await client.request('jobs.inspect', { jobId })).state).not.toBe('cancelled');

    for (const file of [path.join(dir, 'logs', 'runtime.log'), path.join(dir, 'store', 'services.json')]) {
      const text = await fs.readFile(file, 'utf8').catch(() => '');
      expect(text).not.toContain(OPENAI_KEY);
      expect(text).not.toContain(first.token.split('.')[1]!);
    }
  });

  it('数据外发的授权（§12.5）：auto 等级下没有授权覆盖 → GRANT_REQUIRED；ask 下是带外发的高风险审批，允许后点名使用', async () => {
    await client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    await client.request('services.configure', { serviceId: 'mcp', port: 0, level: 'auto' });
    const url = (await client.request('services.start', { serviceId: 'mcp' })).service.endpoint!;
    const { token } = await client.request('services.mcp.createClient', { name: '甲' });

    // 启用时的默认授权覆盖：照常提交，任务记录带着授权。
    const [byDefault] = (await client.request('grants.list', { recipient: 'openai' })).grants;
    expect(byDefault).toMatchObject({ origin: 'provider-enable', state: 'active' });
    const covered = await call(url, token, 'speak', { text: 'hi', provider: 'openai' });
    expect(covered.isError).toBe(false);
    expect((await client.request('jobs.inspect', { jobId: covered.body.jobId })).grant).toMatchObject({ grantId: byDefault!.grantId });

    // 撤销之后：auto 等级免的是逐次确认，不是外发授权。
    await client.request('grants.revoke', { grantId: byDefault!.grantId });
    const refused = await call(url, token, 'speak', { text: 'hi', provider: 'openai' });
    expect(refused.body.error).toMatchObject({
      code: 'GRANT_REQUIRED',
      recipient: 'openai',
      dataKinds: ['document'],
      remedy: { action: 'create-grant' },
      next: expect.stringContaining('不要换服务商'),
    });
    expect((await client.request('jobs.list', {})).jobs).toHaveLength(1);

    // ask 等级：一条带外发的高风险审批；允许（只这一次）后提交，任务点名用那条「只这一次」的授权。
    await client.request('services.configure', { serviceId: 'mcp', level: 'ask' });
    const pending = call(url, token, 'speak', { text: 'hi', provider: 'openai' });
    const approval = await until(() => runtime.harness.approvals.pending()[0]);
    expect(approval).toMatchObject({
      risk: 'high',
      subject: { kind: 'service', serviceId: 'mcp' },
      grants: [{ recipient: 'openai', dataKinds: ['document'], reason: 'revoked', capability: 'synthesizeSpeech' }],
    });
    await client.request('approvals.respond', { approvalId: approval.approvalId, decision: 'allow' });
    const allowed = await pending;
    expect(allowed.isError).toBe(false);
    const record = await client.request('jobs.inspect', { jobId: allowed.body.jobId });
    const { grants } = await client.request('grants.list', { includeEnded: true });
    expect(grants.find((g) => g.grantId === record.grant!.grantId)).toMatchObject({ once: true, origin: 'approval', recipient: 'openai' });

    // 合并申请只给会话：对外服务看不到这个工具。
    const request = await call(url, token, 'grants_request', { items: [{ capability: 'synthesizeSpeech', calls: 2, purpose: '旁白' }] });
    expect(request.body.error.code).toBe('UNKNOWN_TOOL');
  });
});
