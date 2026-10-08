import { AGENT_PROVIDER_PREFIX, localizeText, type DriverInfo, type ModelCapabilitiesView, type ProviderCapabilityView } from '@baocut/protocol';
import { CODEX_IMAGE_COPY } from './agent-copy.ts';

/**
 * 「用 Codex 画图」（设计稿 settings-agent-provider.jsx 的 CodexImageRow）：Codex 卡头下面一行开关。
 * 后端是图片生成的智能体 Provider `agent:codex`（架构设计 §6.9）：开关走 `models.configure`，状态读 `models` 主题的
 * 能力视图。这里只把视图折成这一行要显示的东西，不在界面里写死最低版本——不够新时原因取 Provider 自己给的 `detail`。
 */

export const CODEX_IMAGE_PROVIDER = `${AGENT_PROVIDER_PREFIX}codex`;

/** 能力视图里图片生成的 `agent:codex`；Runtime 没注册它时为 null（这一行就不显示）。 */
export function codexImageProvider(view: ModelCapabilitiesView | null): ProviderCapabilityView | null {
  return view?.generateImage.providers.find((p) => p.providerId === CODEX_IMAGE_PROVIDER) ?? null;
}

/**
 * 这一页有没有主动探测过一次（`models.capabilities`）。没启用、也没探测过时，Provider 只报「没有启用」，
 * 会盖住「没登录」「版本太旧」，所以没探测过之前不敢说能打开。
 */
export type CodexImageProbe = 'pending' | 'done' | 'failed';

export interface CodexImageRowState {
  /** 配置里的开关（用户打开过且没关）。 */
  enabled: boolean;
  /** 开着，而且此刻能画：显示「已打开」。 */
  ready: boolean;
  /** 打开之后能用：开关可以拨。已经开着的总能关掉，不看这一项。 */
  canEnable: boolean;
  /** 还在等第一次探测：开关先不让拨。 */
  checking: boolean;
  /** 不能打开（或开着却画不了）时的一句原因；能用时为 null。 */
  why: string | null;
}

/** Codex 已找到、Runtime 也带着这个 Provider 时才有这一行；否则 null。 */
export function codexImageRow(
  provider: ProviderCapabilityView | null,
  driver: Pick<DriverInfo, 'id' | 'state'>,
  probe: CodexImageProbe,
): CodexImageRowState | null {
  if (driver.id !== 'codex' || driver.state === 'not-installed' || !provider) return null;
  const enabled = provider.config?.enabled ?? false;
  if (provider.available) return { enabled, ready: enabled, canEnable: true, checking: false, why: null };
  const reason = provider.unavailableReason ?? 'unsupported';
  // 开着的时候 Runtime 每次都会问 Driver，原因是准的；没开时只有探测过才准。
  const known = enabled || probe === 'done';
  if (reason === 'not-configured') {
    if (known) return { enabled, ready: false, canEnable: true, checking: false, why: null };
    if (probe === 'pending') return { enabled, ready: false, canEnable: false, checking: true, why: null };
    return { enabled, ready: false, canEnable: false, checking: false, why: CODEX_IMAGE_COPY.probeFailed };
  }
  return { enabled, ready: false, canEnable: false, checking: false, why: codexImageWhy(reason, localizeText(provider.detail, provider.detailRef) ?? undefined) };
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[。！？.!?]$/.test(trimmed) ? trimmed : `${trimmed}${CODEX_IMAGE_COPY.period}`;
}

/** 不能画的原因：设计稿是「原因 · 画图至少要 Codex X 并登录」；最低版本只在 Provider 的 detail 里，版本不够时整句用它。 */
function codexImageWhy(reason: NonNullable<ProviderCapabilityView['unavailableReason']>, detail: string | undefined): string {
  switch (reason) {
    case 'outdated':
      return sentence(detail ?? CODEX_IMAGE_COPY.outdated);
    case 'signed-out':
      return CODEX_IMAGE_COPY.signedOut;
    case 'not-installed':
      return CODEX_IMAGE_COPY.notInstalled;
    default:
      return CODEX_IMAGE_COPY.unavailable(detail ? sentence(detail) : null);
  }
}

/** 开关拨动后的一句提示（设计稿的 toast；模型菜单里出现的名字是 Provider 自己的「Codex」）。 */
export function codexImageToast(enabled: boolean): string {
  return enabled ? CODEX_IMAGE_COPY.turnedOn : CODEX_IMAGE_COPY.turnedOff;
}
