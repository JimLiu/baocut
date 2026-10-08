import {
  NODE_DEFAULT_PORT,
  NODE_SHAREABLE_CAPABILITIES,
  REMOTE_NODE_ERROR,
  type DiscoveredNode,
  type ModelCapabilitiesView,
  type PairedNode,
  type ShareStatus,
} from '@baocut/protocol';
import { REMOTE_COPY, REMOTE_TASK_COPY } from '../copy.ts';
import { agoLabel, formatDuration } from './format.ts';
import type { ServiceTone } from './services.ts';

/**
 * 远端算力页的纯模型（产品设计 §2.1；原型 designs/baocut/app/page-shell.jsx `RemotePage`、model-services.js
 * `REMOTE_TASKS`）。读的都是 `nodes.share.status` / `nodes.list` / `nodes.discover` 的真实返回，不编数字。
 */

// ---- 共享这台 Mac ----

/** 「192.168.1.31:47610」；IPv6 加方括号。 */
export function hostPort(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}

/** 此刻能连上的地址，一项一个 `host:port`；没在监听时为空。 */
export function shareAddresses(status: Pick<ShareStatus, 'addresses' | 'port'>): string[] {
  return status.addresses.map((address) => hostPort(address, status.port));
}

/** 配对码三位一组，好念：「481924」→「481 924」。 */
export function formatPairingCode(code: string): string {
  return /^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

function clockTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export type PairingView =
  | { kind: 'code'; code: string; hint: string }
  | { kind: 'locked'; text: string }
  | { kind: 'none'; text: string };

/**
 * 配对码块的内容：有码给码与倒计时；输错太多给锁到几点；码用过、过期（本地按 `expiresAt` 判断，不等下一次轮询）
 * 或 Runtime 重启后没有码，给一句为什么，按钮变成「生成配对码」。
 */
export function pairingView(pairing: ShareStatus['pairing'], now: number): PairingView {
  if (pairing && 'lockedUntil' in pairing && Date.parse(pairing.lockedUntil) > now) {
    return { kind: 'locked', text: REMOTE_COPY.pairingLocked(clockTime(pairing.lockedUntil)) };
  }
  if (pairing && 'code' in pairing) {
    const left = Date.parse(pairing.expiresAt) - now;
    if (left > 0) {
      return { kind: 'code', code: formatPairingCode(pairing.code), hint: REMOTE_COPY.pairingHint(formatDuration(Math.ceil(left / 1000) * 1000)) };
    }
  }
  return { kind: 'none', text: REMOTE_COPY.pairingNone };
}

/** 本机可用的转录模型（本地 Provider 里可用的模型包），节点接的转录任务就用它们；模型视图还没到时为 null。 */
export function localTranscribeModels(capabilities: ModelCapabilitiesView | null): string[] | null {
  if (!capabilities) return null;
  return capabilities.transcribe.providers
    .filter((provider) => provider.kind === 'local' && provider.available)
    .flatMap((provider) => provider.models.filter((model) => model.available !== false).map((model) => model.label));
}

export interface RemoteTaskRow {
  key: string;
  name: string;
  /** 节点协议里的能力名；null = 这个版本不能共享这类任务。 */
  capability: string | null;
  on: boolean;
  disabled: boolean;
  desc: string | null;
  /** 这类任务会用到的本机模型（只给转录）。 */
  models: string[];
}

/**
 * 「提供给其他电脑的任务」的行，顺序同原型的任务目录。能共享的（`NODE_SHAREABLE_CAPABILITIES`）开关读写
 * `capabilities[...].enabled`；没装模型时不禁用开关（后端照样可以开），只在副文里说对方的任务会失败。
 * 其余几类这个版本没有后端，画成关着的禁用开关并说明原因。
 */
export function remoteTaskRows(
  status: Pick<ShareStatus, 'capabilities'>,
  transcribeModels: string[] | null,
): RemoteTaskRow[] {
  const shareable = NODE_SHAREABLE_CAPABILITIES as readonly string[];
  return REMOTE_TASK_COPY.map((task) => {
    const capability = task.capability && shareable.includes(task.capability) ? task.capability : null;
    if (!capability) {
      return { key: task.key, name: task.name, capability: null, on: false, disabled: true, desc: REMOTE_COPY.taskUnsupported, models: [] };
    }
    const models = capability === 'transcribe' ? (transcribeModels ?? []) : [];
    const noun = task.noun;
    const missing = capability === 'transcribe' && transcribeModels !== null && !transcribeModels.length;
    return {
      key: task.key,
      name: task.name,
      capability,
      on: status.capabilities[capability]?.enabled === true,
      disabled: false,
      desc: missing && noun ? REMOTE_COPY.taskNoModel(noun) : null,
      models,
    };
  });
}

/** 段标题右侧的汇总：开着的能力数 / 这个版本能共享的能力数。 */
export function remoteTaskSummary(rows: RemoteTaskRow[]): string {
  const real = rows.filter((row) => row.capability);
  return REMOTE_COPY.taskSummary(real.filter((row) => row.on).length, real.length);
}

export function jobsLabel(jobs: { running: number; queued: number }): string {
  return jobs.running || jobs.queued ? REMOTE_COPY.jobs(jobs.running, jobs.queued) : REMOTE_COPY.idle;
}

export function shareClientMeta(client: ShareStatus['clients'][number], now: number): string {
  return REMOTE_COPY.clientMeta(agoLabel(client.pairedAt, now), client.lastSeenAt ? agoLabel(client.lastSeenAt, now) : null);
}

// ---- 使用其他电脑 ----

const OS_LABEL: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

/** 模型包可用（装好了，不论此刻是否已加载）的状态；`not-installed` 与 `error` 不算。 */
const USABLE_BUNDLE = new Set(['installed', 'loading', 'ready', 'busy', 'unloading']);

export interface NodeCardView {
  address: string;
  tone: ServiceTone;
  chip: { text: string; variant: 'positive' | 'neutral' | 'notice' };
  meta: string;
  /** 用不了时的一句「为什么、怎么办」（按 `problem` 拼，不叫诊断）。 */
  problem: string | null;
}

export function nodeCardView(node: PairedNode): NodeCardView {
  const address = hostPort(node.host, node.port);
  const meta: string[] = [address];
  const health = node.health;
  if (health) {
    meta.push(OS_LABEL[health.platform.os] ?? health.platform.os, health.platform.arch, `BaoCut ${health.runtimeVersion}`);
    const transcribe = health.capabilities.transcribe;
    if (!transcribe.enabled) meta.push(REMOTE_COPY.transcribeOff);
    else meta.push(REMOTE_COPY.transcribeModels(transcribe.bundles.filter((b) => USABLE_BUNDLE.has(b.state)).length));
    if (transcribe.running || transcribe.queued) meta.push(REMOTE_COPY.jobs(transcribe.running, transcribe.queued));
  }
  const problem = node.problem ? REMOTE_COPY.problem[node.problem] : null;
  if (node.problem === 'unreachable' || (!node.problem && !health)) {
    return { address, tone: 'off', chip: { text: REMOTE_COPY.offline, variant: 'neutral' }, meta: meta.join(' · '), problem };
  }
  if (node.problem === 'version') {
    return { address, tone: 'error', chip: { text: REMOTE_COPY.versionMismatch, variant: 'notice' }, meta: meta.join(' · '), problem };
  }
  if (node.problem === 'unpaired') {
    return { address, tone: 'error', chip: { text: REMOTE_COPY.unpaired, variant: 'notice' }, meta: meta.join(' · '), problem };
  }
  return { address, tone: 'on', chip: { text: REMOTE_COPY.online, variant: 'positive' }, meta: meta.join(' · '), problem: null };
}

/** 附近的电脑里去掉已经配对的（按 nodeId，没报 nodeId 的按地址）。 */
export function unpairedNearby(found: DiscoveredNode[], paired: PairedNode[]): DiscoveredNode[] {
  const ids = new Set(paired.map((node) => node.nodeId));
  const addresses = new Set(paired.map((node) => hostPort(node.host, node.port)));
  return found.filter((node) => (node.nodeId ? !ids.has(node.nodeId) : !addresses.has(hostPort(node.host, node.port))));
}

export type ParsedAddress = { host: string; port: number } | { error: string };

/** 「按地址添加」的输入：`host`、`host:port`、`[v6]:port`；可以带 `http://` 与结尾的 `/`。不写端口用节点默认端口。 */
export function parseNodeAddress(text: string): ParsedAddress {
  const raw = text.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!raw) return { error: REMOTE_COPY.addressEmpty };
  let host: string;
  let portText: string | undefined;
  const v6 = /^\[([0-9a-fA-F:.]+)\](?::(\d*))?$/.exec(raw);
  if (v6) {
    host = v6[1] as string;
    portText = v6[2];
  } else if ((raw.match(/:/g) ?? []).length > 1) {
    if (!/^[0-9a-fA-F:.]+$/.test(raw)) return { error: REMOTE_COPY.addressInvalid };
    host = raw;
  } else {
    const plain = /^([^\s:/[\]]+)(?::(\d*))?$/.exec(raw);
    if (!plain) {
      return /^[^\s:/[\]]+:/.test(raw) ? { error: REMOTE_COPY.portInvalid } : { error: REMOTE_COPY.addressInvalid };
    }
    host = plain[1] as string;
    portText = plain[2];
  }
  if (portText === undefined) return { host, port: NODE_DEFAULT_PORT };
  const port = Number(portText);
  if (!/^\d{1,5}$/.test(portText) || port < 1 || port > 65535) return { error: REMOTE_COPY.portInvalid };
  return { host, port };
}

/** 配对码输入：去掉空格与连字符后必须是 6 位数字。 */
export function normalizePairingCode(text: string): string | null {
  const code = text.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(code) ? code : null;
}

/** `nodes.pair` 失败时给人看的话：按 `details.code` / `details.reason` 认得的说清楚怎么办，认不得的带上原话。 */
export function pairErrorMessage(error: unknown): string {
  const details = (error as { details?: unknown } | null)?.details;
  if (details && typeof details === 'object') {
    const { code, reason } = details as { code?: unknown; reason?: unknown };
    if (code === REMOTE_NODE_ERROR.LOST) return REMOTE_COPY.pairErrors.lost;
    if (code === REMOTE_NODE_ERROR.REJECTED && typeof reason === 'string' && reason !== 'lost' && reason in REMOTE_COPY.pairErrors) {
      return REMOTE_COPY.pairErrors[reason as keyof typeof REMOTE_COPY.pairErrors];
    }
  }
  return REMOTE_COPY.pairFailed(error instanceof Error ? error.message : String(error));
}
