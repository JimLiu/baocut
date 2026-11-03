import {
  AGENT_PROVIDER_PREFIX,
  localizeText,
  type DriverId,
  type DriverInfo,
  type ModelCapabilitiesView,
  type OnlineCapability,
  type ProviderCapabilityView,
} from '@baocut/protocol';
import { CLAUDE_TEXT_COPY, CODEX_IMAGE_COPY } from './agent-copy.ts';

/**
 * 智能体的开关：「用 Codex 画图和写文字」「用 Claude Code 写文字」（设计稿 settings-agent-provider.jsx 的 CodexImageRow、ClaudeTextRow），
 * 各是 Agent 卡头下面一行。后端是智能体 Provider（架构设计 §6.9）：开关走 `models.configure`，状态读 `models` 主题的能力视图。
 * 这里只把视图折成这一行要显示的东西，不在界面里写死最低版本——不够新时原因取 Provider 自己给的 `detail`。
 */

/** 有开关的能力。 */
export type AgentSwitchCapability = Extract<OnlineCapability, 'generateImage' | 'generateText'>;

export type AgentSwitchCopy = Pick<
  typeof CODEX_IMAGE_COPY,
  'title' | 'body' | 'checking' | 'probeFailed' | 'outdated' | 'signedOut' | 'notInstalled' | 'unavailable' | 'turnedOn' | 'turnedOff' | 'toggleFailed'
>;

export interface AgentSwitchSpec {
  driverId: DriverId;
  providerId: string;
  /** 设置 › Agent 那一行看哪种能力（Codex 两种共用一个开关，Claude Code 只有文本生成）。 */
  capability: AgentSwitchCapability;
  copy: AgentSwitchCopy;
}

export const CODEX_SWITCH: AgentSwitchSpec = {
  driverId: 'codex',
  providerId: `${AGENT_PROVIDER_PREFIX}codex`,
  capability: 'generateImage',
  copy: CODEX_IMAGE_COPY,
};

export const CLAUDE_SWITCH: AgentSwitchSpec = {
  driverId: 'claude',
  providerId: `${AGENT_PROVIDER_PREFIX}claude`,
  capability: 'generateText',
  copy: CLAUDE_TEXT_COPY,
};

/** 这个 Agent 有没有开关；别的 Driver 做不到受限的一次性调用（§6.9），没有。 */
export function agentSwitchOf(driverId: DriverId): AgentSwitchSpec | null {
  return [CODEX_SWITCH, CLAUDE_SWITCH].find((spec) => spec.driverId === driverId) ?? null;
}

/**
 * 能力视图里这种能力的这个智能体 Provider；Runtime 没注册它、或它没有这种能力时为 null（这一行、这张卡就不显示）。
 * 同一个 Provider 能不能用，各种能力一样；`caution` 取这种能力的模型说明。
 */
export function agentSwitchProvider(
  view: ModelCapabilitiesView | null,
  spec: AgentSwitchSpec,
  capability: AgentSwitchCapability = spec.capability,
): ProviderCapabilityView | null {
  return view?.[capability].providers.find((p) => p.providerId === spec.providerId) ?? null;
}

/**
 * 这一页有没有主动探测过一次（`models.capabilities`）。没启用、也没探测过时，Provider 只报「没有启用」，
 * 会盖住「没登录」「版本太旧」，所以没探测过之前不敢说能打开。
 */
export type AgentSwitchProbe = 'pending' | 'done' | 'failed';

export interface AgentSwitchState {
  /** 配置里的开关（用户打开过且没关）。 */
  enabled: boolean;
  /** 开着，而且此刻能用：显示「已打开」。 */
  ready: boolean;
  /** 打开之后能用：开关可以拨。已经开着的总能关掉，不看这一项。 */
  canEnable: boolean;
  /** 还在等第一次探测：开关先不让拨。 */
  checking: boolean;
  /** 不能打开（或开着却画不了）时的一句原因；能用时为 null。 */
  why: string | null;
  /** 能用但不是以订阅登录（模型的 `cost` 不是 `subscription`）：Provider 给的说明。 */
  caution?: string;
}

/** 这个 Agent 已找到、Runtime 也带着它的 Provider 时才有这一行；否则 null。 */
export function agentSwitchRow(
  spec: AgentSwitchSpec,
  provider: ProviderCapabilityView | null,
  driver: Pick<DriverInfo, 'id' | 'state'>,
  probe: AgentSwitchProbe,
): AgentSwitchState | null {
  if (driver.id !== spec.driverId || driver.state === 'not-installed' || !provider) return null;
  const enabled = provider.config?.enabled ?? false;
  if (provider.available) {
    const model = provider.models[0] as (ProviderCapabilityView['models'][number] & { cost?: string; notes?: string }) | undefined;
    const caution = enabled && model && model.cost !== 'subscription' ? model.notes : undefined;
    return { enabled, ready: enabled, canEnable: true, checking: false, why: null, ...(caution ? { caution } : {}) };
  }
  const reason = provider.unavailableReason ?? 'unsupported';
  // 开着的时候 Runtime 每次都会问 Driver，原因是准的；没开时只有探测过才准。
  const known = enabled || probe === 'done';
  if (reason === 'not-configured') {
    if (known) return { enabled, ready: false, canEnable: true, checking: false, why: null };
    if (probe === 'pending') return { enabled, ready: false, canEnable: false, checking: true, why: null };
    return { enabled, ready: false, canEnable: false, checking: false, why: spec.copy.probeFailed };
  }
  return { enabled, ready: false, canEnable: false, checking: false, why: agentSwitchWhy(spec.copy, reason, localizeText(provider.detail, provider.detailRef) ?? undefined) };
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[。！？.!?]$/.test(trimmed) ? trimmed : `${trimmed}${CODEX_IMAGE_COPY.period}`;
}

/** 不能用的原因：设计稿是「原因 · 至少要 X 版并登录」；最低版本只在 Provider 的 detail 里，版本不够时整句用它。 */
function agentSwitchWhy(copy: AgentSwitchCopy, reason: NonNullable<ProviderCapabilityView['unavailableReason']>, detail: string | undefined): string {
  switch (reason) {
    case 'outdated':
      return sentence(detail ?? copy.outdated);
    case 'signed-out':
      return copy.signedOut;
    case 'not-installed':
      return copy.notInstalled;
    default:
      return copy.unavailable(detail ? sentence(detail) : null);
  }
}

/** 开关拨动后的一句提示（设计稿的 toast；模型菜单里出现的名字是 Provider 自己的）。 */
export function agentSwitchToast(spec: AgentSwitchSpec, enabled: boolean): string {
  return enabled ? spec.copy.turnedOn : spec.copy.turnedOff;
}
