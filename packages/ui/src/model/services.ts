import {
  defineMessages,
  MCP_DEFAULT_PORT,
  MODEL_API_DEFAULT_PORT,
  NODE_DEFAULT_PORT,
  WEB_DEFAULT_PORT,
  type ServiceId as RuntimeServiceId,
  type ServiceStatus,
  type ShareStatus,
  type WebSession,
} from '@baocut/protocol';
import { SERVICE_COPY, SERVICE_STATE_COPY, SERVICES_PAGE_COPY } from '../copy.ts';
import { agoLabel } from './format.ts';
import { zhHans } from './services.zh-Hans.ts';
import { zhHant } from './services.zh-Hant.ts';
import { ja } from './services.ja.ts';
import { ko } from './services.ko.ts';
import { es } from './services.es.ts';
import { fr } from './services.fr.ts';
import { de } from './services.de.ts';
import { nl } from './services.nl.ts';
import { ptBR } from './services.pt-BR.ts';
import { it } from './services.it.ts';
import { ru } from './services.ru.ts';
import { pl } from './services.pl.ts';
import { tr } from './services.tr.ts';
import { vi } from './services.vi.ts';

/**
 * 「服务」的纯模型（产品设计 §2.1；架构设计 §4.8；原型 designs/baocut/app/model-services.js）。
 * 服务 = 这台 Mac 上由 BaoCut 持有、等别人连进来的常驻进程：MCP 服务、远端算力、Web 服务、模型接口服务。
 * 这里只算：服务目录（界面 ID 与 Runtime ID 的对应）、统一的状态（off / starting / stopping / on / error，外加 Runtime 没有提供的
 * unavailable）、状态点与状态词、总览的汇总、快捷按钮、rail 角标、端口校验。
 * 状态读 `services` 主题（services-store）；远端算力另有 `nodes.share.status` 的轮询（更细：地址、配对码），两者都有时以后者为准。
 */

/** 服务模型自己的文案：端口校验、浏览器会话、Runtime 卡的状态词（译文在 `services.<语言>.ts`）。 */
const en = {
  portRange: 'Enter a port number between 1024 and 65535',
  portTaken: (port: number, service: string) => `${port} is already used by “${service}”; choose another port`,
  browser: 'Browser',
  sessionMeta: (connections: number, ago: string, expires: string | null) =>
    [connections ? `${connections} ${connections === 1 ? 'connection' : 'connections'}` : 'No connections', `Active ${ago}`, expires ? `Expires at ${expires}` : null]
      .filter(Boolean)
      .join(' · '),
  runtime: { connected: 'Connected', incompatible: 'Incompatible version', disconnected: 'Not connected' },
};
export type ServicesMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/** 服务的状态灯：绿 = 在跑、橙 = 出错、灰 = 关着或没有（起停中也是灰，另有呼吸，不靠颜色说话）。 */
export type ServiceTone = 'on' | 'error' | 'off';

export type ServiceId = keyof typeof SERVICE_COPY;

/** 顺序就是侧栏与总览的顺序：原型的三项照旧，模型接口（原型里是 Web 服务页的一节）跟在 Web 服务后面。 */
export const SERVICE_IDS: readonly ServiceId[] = ['mcp', 'remote', 'web', 'model-api'];

/** 界面把节点服务叫「远端算力」（路由 /services/remote），Runtime 叫 `node`。 */
export function runtimeServiceId(id: ServiceId): RuntimeServiceId {
  return id === 'remote' ? 'node' : id;
}

export function uiServiceId(id: RuntimeServiceId): ServiceId {
  return id === 'node' ? 'remote' : id;
}

export type ServicePhase = 'starting' | 'stopping';

export type ServiceState = 'off' | 'starting' | 'stopping' | 'on' | 'error' | 'unavailable';

export type ServiceStates = Record<ServiceId, ServiceState>;

export function isServiceId(value: string | undefined): value is ServiceId {
  return value !== undefined && (SERVICE_IDS as readonly string[]).includes(value);
}

/**
 * 远端算力的运行态：起停中优先；开着却没在监听（端口被占用等）是出错；开着在监听是在跑；其余是关着。
 * 还没读到状态（`null`）按关着算。
 */
export function shareState(status: Pick<ShareStatus, 'enabled' | 'listening'> | null, phase: ServicePhase | null): ServiceState {
  if (phase) return phase;
  if (!status?.enabled) return 'off';
  return status.listening ? 'on' : 'error';
}

/** 一项 Runtime 服务的状态：这个版本没有提供的是 unavailable；还没读到按关着算。 */
export function statusState(status: Pick<ServiceStatus, 'available' | 'state'> | undefined): ServiceState {
  if (!status) return 'off';
  if (!status.available) return 'unavailable';
  return status.state;
}

export function findService(services: readonly ServiceStatus[], id: ServiceId): ServiceStatus | undefined {
  const runtimeId = runtimeServiceId(id);
  return services.find((s) => s.serviceId === runtimeId);
}

/**
 * 四项服务此刻的状态。远端算力：本地的起停中优先，其次 `nodes.share.status`（轮询来的，更新），再其次 `services` 主题里节点服务的投影。
 */
export function serviceStates(
  services: readonly ServiceStatus[],
  share: Pick<ShareStatus, 'enabled' | 'listening'> | null,
  sharePhase: ServicePhase | null,
): ServiceStates {
  const remote = sharePhase || share ? shareState(share, sharePhase) : statusState(findService(services, 'remote'));
  return {
    mcp: statusState(findService(services, 'mcp')),
    remote,
    web: statusState(findService(services, 'web')),
    'model-api': statusState(findService(services, 'model-api')),
  };
}

export function serviceTone(state: ServiceState): ServiceTone {
  if (state === 'on') return 'on';
  return state === 'error' ? 'error' : 'off';
}

export function serviceBusy(state: ServiceState): boolean {
  return state === 'starting' || state === 'stopping';
}

/** 状态词：远端算力说「共享」，其余说「运行」。 */
export function serviceStateLabel(id: ServiceId, state: ServiceState): string {
  if (state === 'unavailable') return SERVICE_STATE_COPY.unavailable;
  return (id === 'remote' ? SERVICE_STATE_COPY.share : SERVICE_STATE_COPY.service)[state];
}

export interface ServiceLight {
  id: ServiceId;
  tone: ServiceTone;
  busy: boolean;
  /** 侧栏行的提示与读屏：「远端算力 · 正在共享」 */
  label: string;
}

/** 一项一颗信号灯，顺序同目录。 */
export function serviceLights(states: ServiceStates): ServiceLight[] {
  return SERVICE_IDS.map((id) => ({
    id,
    tone: serviceTone(states[id]),
    busy: serviceBusy(states[id]),
    label: `${SERVICE_COPY[id].name} · ${serviceStateLabel(id, states[id])}`,
  }));
}

export interface ServicesSummary {
  text: string;
  tone: 'error' | 'on' | 'off';
}

/** 总览标题旁的一小句：有出错的先说出错，其次说几项在跑，全关着说「全部未启动」。没有提供的服务不计入。 */
export function servicesSummary(states: ServiceStates): ServicesSummary {
  const all = SERVICE_IDS.map((id) => states[id]);
  const errors = all.filter((s) => s === 'error').length;
  const running = all.filter((s) => s === 'on').length;
  if (errors) return { text: SERVICES_PAGE_COPY.errors(errors), tone: 'error' };
  if (running) return { text: SERVICES_PAGE_COPY.running(running), tone: 'on' };
  return { text: SERVICES_PAGE_COPY.allOff, tone: 'off' };
}

/**
 * rail「服务」的角标（原型 apprail.jsx 的 `badge`）：有服务出错时亮；外部客户端的请求在等确认（服务审批，50 秒时限）时也亮，
 * 免得用户不在 MCP 服务页时错过。返回读屏用的说法，没有就是 null。
 */
export function servicesAlert(states: ServiceStates, pendingApprovals = 0): string | null {
  const summary = servicesSummary(states);
  if (summary.tone === 'error') return SERVICES_PAGE_COPY.railAlert(summary.text);
  return pendingApprovals > 0 ? SERVICES_PAGE_COPY.railApprovals(pendingApprovals) : null;
}

export type ServiceQuickAction =
  | { kind: 'start' | 'stop'; label: string }
  | { kind: 'busy'; label: string }
  | { kind: 'unavailable'; label: string };

/**
 * 服务行行尾的快捷按钮：开着给停、关着给起、出错给「重新…」、起停中给一个转圈的禁用按钮；
 * 没有提供的服务不给按钮，原因由行的副文说。
 */
export function serviceQuickAction(id: ServiceId, state: ServiceState): ServiceQuickAction {
  const copy = SERVICE_COPY[id];
  if (state === 'starting') return { kind: 'busy', label: copy.starting };
  if (state === 'stopping') return { kind: 'busy', label: copy.stopping };
  if (state === 'unavailable') return { kind: 'unavailable', label: copy.start };
  if (state === 'on') return { kind: 'stop', label: copy.stop };
  return { kind: 'start', label: state === 'error' ? SERVICES_PAGE_COPY.restart(copy.start) : copy.start };
}

/**
 * 服务操作失败时给人看的一句：这个版本没有的服务（`SERVICE_NOT_AVAILABLE`）与没开着的服务（`SERVICE_NOT_RUNNING`）说人话，
 * 其余照 Runtime 的消息。
 */
export function serviceErrorMessage(error: unknown): string {
  const details = (error as { details?: unknown } | null)?.details;
  const code = details && typeof details === 'object' ? (details as { code?: unknown }).code : undefined;
  if (code === 'SERVICE_NOT_AVAILABLE') return SERVICES_PAGE_COPY.unavailableDetail;
  if (code === 'SERVICE_NOT_RUNNING') return SERVICES_PAGE_COPY.notRunning;
  return error instanceof Error ? error.message : String(error);
}

// ---- 端口（原型 model-services.js `parsePort`） ----

/** 各服务的默认端口（Runtime 的常量）：被占用时服务进入 error，不换端口。 */
export const SERVICE_DEFAULT_PORT: Readonly<Record<ServiceId, number>> = {
  mcp: MCP_DEFAULT_PORT,
  remote: NODE_DEFAULT_PORT,
  web: WEB_DEFAULT_PORT,
  'model-api': MODEL_API_DEFAULT_PORT,
};

export type PortParse = { port: number; error?: undefined } | { error: string; port?: undefined };

/**
 * 端口输入 → `{port}` 或 `{error}`。只收 1024–65535 的整数；和这台 Mac 上其他 BaoCut 服务（配置的端口）撞口的直接说是谁。
 * `others`：其他服务此刻配置的端口。
 */
export function parsePort(text: string, self: ServiceId, others: Partial<Record<ServiceId, number | null>>): PortParse {
  const t = text.trim();
  if (!/^\d{1,5}$/.test(t)) return { error: M.portRange };
  const n = Number(t);
  if (n < 1024 || n > 65535) return { error: M.portRange };
  for (const id of SERVICE_IDS) {
    if (id !== self && others[id] === n) return { error: M.portTaken(n, SERVICE_COPY[id].name) };
  }
  return { port: n };
}

/** 各服务配置的端口（总览里校验撞口用）；远端算力取共享状态里的端口。 */
export function servicePorts(services: readonly ServiceStatus[], share: Pick<ShareStatus, 'port'> | null): Partial<Record<ServiceId, number | null>> {
  const ports: Partial<Record<ServiceId, number | null>> = {};
  for (const status of services) ports[uiServiceId(status.serviceId)] = status.port;
  if (share) ports.remote = share.port;
  return ports;
}

/** Runtime 监听失败的两种原因（service-clients.ts 的 `listenError`）：端口被占用、不能在端口上监听。 */
const PORT_ERRORS = new Set(['rcServices.portInUse', 'rcServices.cannotListen']);

/**
 * 出错的原因是不是端口的事（按 `errorRef` 的键认）。是才给「换个端口」的建议与「换回默认端口」；别的原因（例如 Web 客户端
 * 没有构建）照 Runtime 的原话，不乱指路。
 */
export function isPortError(status: Pick<ServiceStatus, 'errorRef'>): boolean {
  return !!status.errorRef && PORT_ERRORS.has(status.errorRef.key);
}

// ---- 浏览器 ----

/** 从登录时的 User-Agent 认出是哪个浏览器（Web 服务的会话列表）；认不出时说「浏览器」。 */
export function browserLabel(userAgent: string | null): string {
  if (!userAgent) return M.browser;
  const ua = userAgent;
  const os = /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null;
  const name = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  if (!name) return M.browser;
  return os ? `${name} · ${os}` : name;
}

/** 浏览器会话的副行：「2 个连接 · 3 分钟前活跃 · 21:40 过期」（会话从登录起 12 小时有效）。 */
export function webSessionMeta(session: Pick<WebSession, 'connections' | 'lastUsedAt' | 'expiresAt'>, now: number): string {
  const at = new Date(session.expiresAt);
  const expires = Number.isNaN(at.getTime()) ? null : `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return M.sessionMeta(session.connections, agoLabel(session.lastUsedAt, now), expires);
}

// ---- BaoCut Runtime（设置 › 诊断复用的 Runtime 卡） ----

export function runtimeTone(status: string): ServiceTone {
  if (status === 'connected') return 'on';
  return status === 'incompatible' ? 'error' : 'off';
}

export function runtimeStateLabel(status: string): string {
  if (status === 'connected') return M.runtime.connected;
  return status === 'incompatible' ? M.runtime.incompatible : M.runtime.disconnected;
}
