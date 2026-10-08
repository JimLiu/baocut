import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale, type McpConnectionInfo, type ServiceStatus } from '@baocut/protocol';
import {
  browserCommand,
  formatAccessLink,
  formatLaunchCode,
  formatConnectionInfo,
  formatNewClient,
  formatServices,
  formatWebSessions,
  parseServicesArgs,
  splitAccessLink,
  webOpen,
} from './services-output.ts';

const base: ServiceStatus = {
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

describe('baocut services 的参数', () => {
  it('列表、开关与客户端', () => {
    expect(parseServicesArgs([])).toEqual({ kind: 'list' });
    expect(parseServicesArgs(['status'])).toEqual({ kind: 'list' });
    expect(parseServicesArgs(['start', 'mcp'])).toEqual({ kind: 'start', serviceId: 'mcp' });
    expect(parseServicesArgs(['stop', 'node'])).toEqual({ kind: 'stop', serviceId: 'node' });
    expect(parseServicesArgs(['mcp', 'add-client', 'Claude', 'Desktop'])).toEqual({
      kind: 'add-client',
      service: 'mcp',
      name: 'Claude Desktop',
    });
    expect(parseServicesArgs(['mcp', 'clients'])).toEqual({ kind: 'clients', service: 'mcp' });
    expect(parseServicesArgs(['mcp', 'revoke', 'mcl_1'])).toEqual({ kind: 'revoke', service: 'mcp', clientId: 'mcl_1' });
    expect(parseServicesArgs(['mcp', 'connection'])).toEqual({ kind: 'connection', service: 'mcp' });
    expect(parseServicesArgs(['mcp', 'connection', 'mcl_1'])).toEqual({ kind: 'connection', service: 'mcp', clientId: 'mcl_1' });
    expect(parseServicesArgs(['model-api', 'add-client', '字幕工具'])).toEqual({
      kind: 'add-client',
      service: 'model-api',
      name: '字幕工具',
    });
    expect(parseServicesArgs(['model-api', 'revoke', 'mcl_2'])).toEqual({ kind: 'revoke', service: 'model-api', clientId: 'mcl_2' });
  });

  it('model-api 的别名', () => {
    expect(parseServicesArgs(['model-api', 'aliases'])).toEqual({ kind: 'aliases' });
    expect(parseServicesArgs(['model-api', 'alias', 'whisper-1', 'transcribe', 'local'])).toEqual({
      kind: 'alias',
      alias: { alias: 'whisper-1', capability: 'transcribe', providerId: 'local', modelId: null },
    });
    expect(parseServicesArgs(['model-api', 'alias', 'tts-1', 'synthesizeSpeech', 'openai/gpt-4o-mini-tts'])).toEqual({
      kind: 'alias',
      alias: { alias: 'tts-1', capability: 'synthesizeSpeech', providerId: 'openai', modelId: 'gpt-4o-mini-tts' },
    });
    expect(parseServicesArgs(['model-api', 'unalias', 'tts-1'])).toEqual({ kind: 'unalias', alias: 'tts-1' });
    expect(() => parseServicesArgs(['model-api', 'alias', 'x', 'dance', 'local'])).toThrow(/不认识的能力：dance/);
    expect(() => parseServicesArgs(['model-api', 'alias', 'x', 'transcribe'])).toThrow(/alias <名字> <能力>/);
    expect(() => parseServicesArgs(['mcp', 'aliases'])).toThrow(/用法/);
  });

  it('configure：端口、等级、范围与随 Runtime 启动', () => {
    expect(
      parseServicesArgs(['configure', 'mcp'], { port: '47700', level: 'auto', videos: 'vid_a, vid_b,vid_a', autostart: 'on' }),
    ).toEqual({
      kind: 'configure',
      params: { serviceId: 'mcp', port: 47700, level: 'auto', videos: { ids: ['vid_a', 'vid_b'] }, autostart: true },
    });
    expect(parseServicesArgs(['configure', 'mcp'], { videos: 'all', autostart: 'off' })).toEqual({
      kind: 'configure',
      params: { serviceId: 'mcp', videos: 'all', autostart: false },
    });
    expect(parseServicesArgs(['configure', 'model-api'], { routeOnline: 'on', routeAgent: 'off', maxConcurrent: '2' })).toEqual({
      kind: 'configure',
      params: { serviceId: 'model-api', routing: { online: true, agent: false }, maxConcurrentPerClient: 2 },
    });
    expect(() => parseServicesArgs(['configure', 'mcp'], { routeOnline: 'on' })).toThrow(/只适用于 model-api/);
    expect(() => parseServicesArgs(['configure', 'model-api'], { routeNodes: 'yes' })).toThrow(/--route-nodes/);
    expect(() => parseServicesArgs(['configure', 'model-api'], { maxConcurrent: '0' })).toThrow(/--max-concurrent/);
  });

  it('写错时给出用法', () => {
    expect(() => parseServicesArgs(['start'])).toThrow(/用法/);
    expect(() => parseServicesArgs(['start', 'ftp'])).toThrow(/不认识的服务：ftp/);
    expect(() => parseServicesArgs(['configure', 'mcp'])).toThrow(/没有要改的配置/);
    expect(() => parseServicesArgs(['configure', 'mcp'], { port: '70000' })).toThrow(/--port/);
    expect(() => parseServicesArgs(['configure', 'mcp'], { level: 'admin' })).toThrow(/--level/);
    expect(() => parseServicesArgs(['configure', 'mcp'], { autostart: 'yes' })).toThrow(/--autostart/);
    expect(() => parseServicesArgs(['configure', 'mcp'], { videos: ',' })).toThrow(/--videos/);
    expect(() => parseServicesArgs(['mcp', 'add-client'])).toThrow(/add-client <名字>/);
    expect(() => parseServicesArgs(['mcp', 'revoke'])).toThrow(/用法/);
    expect(() => parseServicesArgs(['mcp', 'tokens'])).toThrow(/用法/);
  });

  it('web：会话、吊销，以及只读与方法白名单的配置', () => {
    expect(parseServicesArgs(['web', 'sessions'])).toEqual({ kind: 'web-sessions' });
    expect(parseServicesArgs(['web', 'revoke', 'wses_1'])).toEqual({ kind: 'web-revoke', sessionId: 'wses_1' });
    expect(parseServicesArgs(['configure', 'web'], { port: '47700', readOnly: 'on' })).toEqual({
      kind: 'configure',
      params: { serviceId: 'web', port: 47700, readOnly: true },
    });
    expect(parseServicesArgs(['configure', 'web'], { readOnly: 'off', methods: 'runtime.info, videos.*,runtime.info' })).toEqual({
      kind: 'configure',
      params: { serviceId: 'web', readOnly: false, methods: ['runtime.info', 'videos.*'] },
    });
    expect(parseServicesArgs(['configure', 'web'], { methods: 'default' })).toEqual({
      kind: 'configure',
      params: { serviceId: 'web', methods: null },
    });
    expect(() => parseServicesArgs(['configure', 'web'], { readOnly: 'yes' })).toThrow(/--read-only/);
    expect(() => parseServicesArgs(['configure', 'web'], { methods: 'videos.*;rm' })).toThrow(/--methods/);
    expect(() => parseServicesArgs(['configure', 'mcp'], { readOnly: 'on' })).toThrow(/只用于 web/);
    expect(() => parseServicesArgs(['web', 'revoke'])).toThrow(/用法/);
    expect(() => parseServicesArgs(['web', 'tokens'])).toThrow(/用法/);
  });
});

describe('baocut services 的输出', () => {
  it('状态、原因、等级与范围；没有提供的服务与节点服务各一行说明', () => {
    const lines = formatServices([
      { ...base, state: 'error', error: '端口 47620 已被占用', autostart: true, policy: { videos: { ids: ['vid_a'] }, level: 'auto' } },
      { ...base, serviceId: 'model-api', label: '模型接口服务', available: false, port: 47621, policy: null },
      { ...base, serviceId: 'node', label: '局域网节点', state: 'on', port: 47630, endpoint: 'http://192.168.1.2:47630', policy: null },
    ]);
    expect(lines).toEqual([
      'mcp  MCP 服务  出错  端口 47620',
      '  原因：端口 47620 已被占用',
      '  随 Runtime 启动：是',
      '  等级：auto（直接执行）  范围：1 个视频（vid_a）',
      '  客户端：0 个',
      'model-api  模型接口服务  这个版本不提供',
      'node  局域网节点  开着  http://192.168.1.2:47630',
      '  端口、能力与配对用 baocut share',
    ]);
    const modelApi = formatServices([
      {
        ...base,
        serviceId: 'model-api',
        label: '模型接口服务',
        state: 'on',
        port: 47621,
        endpoint: 'http://127.0.0.1:47621/v1',
        modelApi: {
          routing: { online: true, nodes: false, agent: false },
          aliases: [{ alias: 'whisper-1', capability: 'transcribe', providerId: 'local', modelId: null }],
          maxConcurrentPerClient: 4,
          maxUploadBytes: 1,
          maxJsonBytes: 1,
          interfaceVersion: '1',
        },
      },
    ]);
    expect(modelApi).toEqual([
      'model-api  模型接口服务  开着  http://127.0.0.1:47621/v1',
      '  随 Runtime 启动：否',
      '  等级：ask（生成请求逐次确认）',
      '  路由到：本机、在线服务  每个客户端同时 4 个请求',
      '  别名：whisper-1 → local/默认模型（transcribe）',
      '  客户端：0 个',
    ]);
  });

  it('新客户端的令牌只在创建时出现；连接信息不含令牌', () => {
    const info: McpConnectionInfo = {
      url: 'http://127.0.0.1:47620/mcp',
      headers: { Authorization: 'Bearer <甲 的令牌>' },
      snippet: '{"mcpServers":{}}',
      interfaceVersion: '1',
      notice: null,
    };
    const client = { clientId: 'mcl_1', name: '甲', createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null };
    const created = formatNewClient(client, 'mcl_1.secret', info).join('\n');
    expect(created).toContain('mcl_1.secret');
    expect(created).toContain('只显示这一次');
    const shown = formatConnectionInfo(info).join('\n');
    expect(shown).toContain('Bearer <甲 的令牌>');
    expect(shown).not.toContain('secret');
  });
});

describe('baocut web', () => {
  const web: ServiceStatus = {
    ...base,
    serviceId: 'web',
    label: 'Web 服务',
    state: 'on',
    port: 47622,
    endpoint: 'http://127.0.0.1:47622/',
    policy: null,
    web: { readOnly: true, methods: ['runtime.info', 'videos.*'] },
    clients: [{ clientId: 'wses_1', name: '浏览器会话', createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null }],
  };
  const link = { url: 'http://127.0.0.1:47622/#code=abcdefghijklmnopqrstuvwxyz', expiresAt: '2026-01-01T00:02:00.000Z' };

  it('状态里有只读、白名单与会话数', () => {
    expect(formatServices([web])).toEqual([
      'web  Web 服务  开着  http://127.0.0.1:47622/',
      '  随 Runtime 启动：否',
      '  只读：是  方法白名单：runtime.info、videos.*',
      '  浏览器会话：1 个（访问链接：baocut web open）',
    ]);
    expect(formatWebSessions([])).toEqual(['没有浏览器会话。用 baocut web open 取得访问链接']);
    expect(
      formatWebSessions([
        {
          sessionId: 'wses_1',
          createdAt: 'a',
          lastUsedAt: 'b',
          expiresAt: 'c',
          connections: 2,
          userAgent: 'Firefox',
        },
      ]),
    ).toEqual(['wses_1  登录于 a  最近使用 b  到期 c  连接 2 个  Firefox']);
  });

  it('web open：先开服务，再打印访问链接；--launch 打开不带代码的登录页，代码只打在终端里', async () => {
    const calls: string[] = [];
    const client = {
      start: async () => {
        calls.push('start');
        return web;
      },
      createAccessLink: async () => {
        calls.push('link');
        return link;
      },
    };
    const printed: string[] = [];
    const launched: string[] = [];
    await webOpen(client, { launch: false, launcher: async (url) => void launched.push(url), print: (line) => printed.push(line) });
    expect(calls).toEqual(['start', 'link']);
    expect(printed).toEqual(formatAccessLink(link));
    expect(printed[0]).toBe(link.url);
    expect(launched).toEqual([]);

    // --launch：浏览器打开不带代码的登录页，代码只打在终端里。
    const launchedLines: string[] = [];
    await webOpen(client, { launch: true, launcher: async (url) => void launched.push(url), print: (line) => launchedLines.push(line) });
    const code = link.url.split('#code=')[1]!;
    expect(launched).toEqual([link.url.split('#')[0]]);
    expect(launched[0]).not.toContain(code);
    expect(launchedLines).toEqual(formatLaunchCode(launched[0]!, code, link.expiresAt));
    expect(launchedLines[0]).toBe(`访问代码：${code}`);
    expect(launchedLines.join('\n')).not.toContain('#code=');
    expect(() => splitAccessLink('http://127.0.0.1:47622/?code=x')).toThrow(/格式不对/);
  });

  it('web open --video：链接的路径与查询直达视频的编辑器；--launch 打开的登录页保留路径与查询，代码仍只在终端里', async () => {
    const deep = {
      url: 'http://127.0.0.1:47622/home?video=%7B%22projectId%22%3A%22p1%22%2C%22path%22%3A%22a%22%7D#code=Zm9vYmFyYmF6cXV4MTIzNDU2',
      expiresAt: 'soon',
    };
    const client = { start: async () => web, createAccessLink: async () => deep };
    const printed: string[] = [];
    await webOpen(client, { launch: false, video: 'video_1', launcher: async () => {}, print: (line) => printed.push(line) });
    expect(printed).toEqual(formatAccessLink(deep, 'video_1'));
    expect(printed[0]).toBe(deep.url);
    expect(printed[1]).toContain('video_1');

    const launched: string[] = [];
    const lines: string[] = [];
    await webOpen(client, {
      launch: true,
      video: 'video_1',
      launcher: async (url) => void launched.push(url),
      print: (line) => lines.push(line),
    });
    expect(launched).toEqual([deep.url.split('#')[0]]);
    expect(launched[0]).toContain('/home?video=');
    expect(lines.join('\n')).not.toContain('#code=');
    expect(lines).toEqual(formatLaunchCode(launched[0]!, 'Zm9vYmFyYmF6cXV4MTIzNDU2', 'soon', 'video_1'));
    expect(splitAccessLink(deep.url)).toEqual({ loginUrl: deep.url.split('#')[0], code: 'Zm9vYmFyYmF6cXV4MTIzNDU2' });
  });

  it('服务开不起来时说明原因，不发链接', async () => {
    let linked = false;
    const client = {
      start: async () => ({ ...web, state: 'error' as const, endpoint: null, error: 'Web 客户端还没有构建' }),
      createAccessLink: async () => {
        linked = true;
        return link;
      },
    };
    await expect(webOpen(client, { launch: true, launcher: async () => {}, print: () => {} })).rejects.toThrow(/Web 客户端还没有构建/);
    expect(linked).toBe(false);
  });

  it('各平台用默认浏览器打开', () => {
    expect(browserCommand('darwin', link.url)).toEqual({ command: 'open', args: [link.url] });
    expect(browserCommand('linux', link.url)).toEqual({ command: 'xdg-open', args: [link.url] });
    expect(browserCommand('win32', link.url)).toEqual({ command: 'cmd', args: ['/c', 'start', '""', link.url] });
  });
});

describe('英文', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  });

  it('用法错误与服务状态是英文', () => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    expect(() => parseServicesArgs(['bogus'])).toThrow(/^Usage: baocut services \[status/);
    expect(() => parseServicesArgs(['configure', 'mcp'], { port: '0' })).toThrow('--port must be an integer from 1 to 65535');
    expect(formatServices([base])[0]).toContain('Off');
    expect(formatWebSessions([])).toEqual(['No browser sessions. Get an access link with baocut web open']);
  });
});
