import { describe, expect, it } from 'vitest';
import { RpcError, type ServiceStatus } from '@baocut/protocol';
import {
  browserLabel,
  findService,
  isPortError,
  isServiceId,
  parsePort,
  runtimeServiceId,
  runtimeTone,
  SERVICE_IDS,
  serviceErrorMessage,
  serviceLights,
  servicePorts,
  serviceQuickAction,
  servicesAlert,
  serviceStateLabel,
  serviceStates,
  servicesSummary,
  serviceTone,
  shareState,
  statusState,
  uiServiceId,
  webSessionMeta,
  type ServiceStates,
} from './services.ts';

const share = (enabled: boolean, listening: boolean) => ({ enabled, listening });
const states = (remote: ServiceStates['remote'], rest: Partial<ServiceStates> = {}): ServiceStates => ({
  mcp: 'off',
  remote,
  web: 'off',
  'model-api': 'off',
  ...rest,
});

function status(serviceId: ServiceStatus['serviceId'], patch: Partial<ServiceStatus> = {}): ServiceStatus {
  return {
    serviceId,
    label: serviceId,
    available: true,
    state: 'off',
    error: null,
    autostart: false,
    port: null,
    endpoint: null,
    policy: serviceId === 'node' || serviceId === 'web' ? null : { videos: 'all', level: 'ask' },
    clients: [],
    recentRequests: [],
    ...patch,
  };
}

describe('服务目录', () => {
  it('四项，顺序是 MCP / 远端算力 / Web / 模型接口；不认识的键不算服务', () => {
    expect(SERVICE_IDS).toEqual(['mcp', 'remote', 'web', 'model-api']);
    expect(isServiceId('model-api')).toBe(true);
    expect(isServiceId('runtime')).toBe(false);
    expect(isServiceId(undefined)).toBe(false);
  });

  it('界面的远端算力就是 Runtime 的节点服务，其余同名', () => {
    expect(runtimeServiceId('remote')).toBe('node');
    expect(runtimeServiceId('model-api')).toBe('model-api');
    expect(uiServiceId('node')).toBe('remote');
    expect(uiServiceId('web')).toBe('web');
    expect(findService([status('node', { state: 'on' })], 'remote')?.state).toBe('on');
  });
});

describe('运行态', () => {
  it('远端算力：起停中优先，其次开着没监听是出错，开着在监听是在跑', () => {
    expect(shareState(null, null)).toBe('off');
    expect(shareState(share(false, false), null)).toBe('off');
    expect(shareState(share(true, true), null)).toBe('on');
    expect(shareState(share(true, false), null)).toBe('error');
    expect(shareState(share(true, false), 'stopping')).toBe('stopping');
    expect(shareState(null, 'starting')).toBe('starting');
  });

  it('Runtime 服务：没读到按关着；这个版本没有提供的是「尚未提供」；其余照 Runtime', () => {
    expect(statusState(undefined)).toBe('off');
    expect(statusState({ available: false, state: 'off' })).toBe('unavailable');
    expect(statusState({ available: true, state: 'error' })).toBe('error');
  });

  it('四项一起算：MCP / Web / 模型接口读 services 主题；远端算力有共享状态时以它为准，否则用节点服务的投影', () => {
    const services = [status('mcp', { state: 'on' }), status('web', { state: 'error' }), status('node', { state: 'on' })];
    expect(serviceStates(services, null, null)).toEqual({ mcp: 'on', remote: 'on', web: 'error', 'model-api': 'off' });
    expect(serviceStates(services, share(false, false), null).remote).toBe('off');
    expect(serviceStates(services, null, 'stopping').remote).toBe('stopping');
    expect(serviceStates([status('model-api', { available: false })], null, null)['model-api']).toBe('unavailable');
  });
});

describe('状态灯与状态词', () => {
  it('绿 = 在跑、橙 = 出错，其余都是灰', () => {
    expect(serviceTone('on')).toBe('on');
    expect(serviceTone('error')).toBe('error');
    expect(serviceTone('starting')).toBe('off');
    expect(serviceTone('unavailable')).toBe('off');
  });

  it('远端算力说「共享」，其余说「运行」，没有提供的说「尚未提供」', () => {
    expect(serviceStateLabel('remote', 'on')).toBe('正在共享');
    expect(serviceStateLabel('remote', 'error')).toBe('共享意外停止');
    expect(serviceStateLabel('web', 'error')).toBe('启动失败');
    expect(serviceStateLabel('model-api', 'on')).toBe('运行中');
    expect(serviceStateLabel('mcp', 'unavailable')).toBe('尚未提供');
  });

  it('侧栏一项一颗灯，起停中的那颗 busy', () => {
    const lights = serviceLights(states('starting', { 'model-api': 'on' }));
    expect(lights.map((l) => l.id)).toEqual(['mcp', 'remote', 'web', 'model-api']);
    expect(lights.map((l) => l.busy)).toEqual([false, true, false, false]);
    expect(lights[1]?.label).toBe('远端算力 · 正在开始共享…');
    expect(lights[3]).toMatchObject({ tone: 'on', label: '模型接口 · 运行中' });
  });
});

describe('总览汇总与 rail 角标', () => {
  it('出错先说，其次在跑的数，全关说「全部未启动」', () => {
    expect(servicesSummary(states('off'))).toEqual({ text: '全部未启动', tone: 'off' });
    expect(servicesSummary(states('on', { mcp: 'on' }))).toEqual({ text: '2 项运行中', tone: 'on' });
    expect(servicesSummary(states('on', { web: 'error' }))).toEqual({ text: '1 项出错', tone: 'error' });
    expect(servicesSummary(states('starting', { mcp: 'unavailable' }))).toEqual({ text: '全部未启动', tone: 'off' });
  });

  it('角标：出错优先；没有出错时有请求在等确认也亮；都没有是 null', () => {
    expect(servicesAlert(states('error'))).toBe('服务，1 项出错');
    expect(servicesAlert(states('error'), 2)).toBe('服务，1 项出错');
    expect(servicesAlert(states('on'), 2)).toBe('服务，2 个请求等你确认');
    expect(servicesAlert(states('on'))).toBeNull();
  });
});

describe('行尾的快捷按钮', () => {
  it('开着给停、关着给起、出错给「重新…」、起停中转圈、没有提供的不给', () => {
    expect(serviceQuickAction('remote', 'on')).toEqual({ kind: 'stop', label: '停止共享' });
    expect(serviceQuickAction('remote', 'error')).toEqual({ kind: 'start', label: '重新开始共享' });
    expect(serviceQuickAction('model-api', 'off')).toEqual({ kind: 'start', label: '启动服务' });
    expect(serviceQuickAction('web', 'stopping')).toEqual({ kind: 'busy', label: '正在停止…' });
    expect(serviceQuickAction('web', 'unavailable')).toEqual({ kind: 'unavailable', label: '启动服务' });
  });
});

describe('端口', () => {
  it('只收 1024–65535 的整数；和别的 BaoCut 服务撞口时说是谁', () => {
    expect(parsePort(' 8080 ', 'web', {})).toEqual({ port: 8080 });
    expect(parsePort('80', 'web', {}).error).toBe('端口要填 1024–65535 之间的数字');
    expect(parsePort('70000', 'web', {}).error).toBe('端口要填 1024–65535 之间的数字');
    expect(parsePort('80a', 'web', {}).error).toBe('端口要填 1024–65535 之间的数字');
    expect(parsePort('47620', 'web', { mcp: 47620 }).error).toBe('47620 已经留给「MCP 服务」，换一个端口');
    expect(parsePort('47622', 'web', { web: 47622 })).toEqual({ port: 47622 });
  });

  it('只有监听失败才算端口的事，别的原因不指向端口', () => {
    expect(isPortError({ errorRef: { key: 'rcServices.portInUse', params: { port: 47622 } } })).toBe(true);
    expect(isPortError({ errorRef: { key: 'rcServices.cannotListen', params: { port: 47620, reason: 'EACCES' } } })).toBe(true);
    expect(isPortError({ errorRef: { key: 'rcWeb.clientNotBuilt' } })).toBe(false);
    expect(isPortError({})).toBe(false);
  });

  it('各服务配置的端口：远端算力以共享状态为准', () => {
    const ports = servicePorts([status('mcp', { port: 47620 }), status('node', { port: 1 })], { port: 47610 });
    expect(ports).toEqual({ mcp: 47620, remote: 47610 });
  });
});

describe('操作失败的说法', () => {
  it('没有提供与没开着说人话，其余照 Runtime 的消息', () => {
    expect(serviceErrorMessage(new RpcError('conflict', 'x', { code: 'SERVICE_NOT_AVAILABLE' }))).toBe('这个版本的 BaoCut Runtime 还没有提供这项服务');
    expect(serviceErrorMessage(new RpcError('conflict', 'x', { code: 'SERVICE_NOT_RUNNING' }))).toBe('服务没有开着，先启动它');
    expect(serviceErrorMessage(new RpcError('invalid-request', '端口不对'))).toBe('端口不对');
    expect(serviceErrorMessage('坏了')).toBe('坏了');
  });
});

describe('浏览器会话', () => {
  it('从 User-Agent 认出浏览器与系统，认不出说「浏览器」', () => {
    const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
    const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0';
    expect(browserLabel(chrome)).toBe('Chrome · macOS');
    expect(browserLabel(safari)).toBe('Safari · macOS');
    expect(browserLabel(edge)).toBe('Edge · Windows');
    expect(browserLabel('curl/8.0')).toBe('浏览器');
    expect(browserLabel(null)).toBe('浏览器');
  });

  it('副行：连接数 · 多久前活跃 · 几点过期', () => {
    const now = Date.parse('2026-10-03T08:00:00Z');
    const expires = new Date(now + 3 * 3_600_000);
    const hhmm = `${String(expires.getHours()).padStart(2, '0')}:${String(expires.getMinutes()).padStart(2, '0')}`;
    expect(webSessionMeta({ connections: 2, lastUsedAt: new Date(now - 3 * 60_000).toISOString(), expiresAt: expires.toISOString() }, now)).toBe(
      `2 个连接 · 3 分钟前活跃 · ${hhmm} 过期`,
    );
    expect(webSessionMeta({ connections: 0, lastUsedAt: new Date(now).toISOString(), expiresAt: 'x' }, now)).toBe('没有连接 · 刚刚活跃');
  });
});

describe('BaoCut Runtime', () => {
  it('只有协议不兼容才算出错', () => {
    expect(runtimeTone('connected')).toBe('on');
    expect(runtimeTone('disconnected')).toBe('off');
    expect(runtimeTone('incompatible')).toBe('error');
  });
});
