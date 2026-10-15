import { useState } from 'react';
import {
  intlLocale,
  localizeText,
  type ImageModelInfo,
  type ModelInfoBase,
  type OnlineCapability,
  type ProviderAccountView,
  type SpeechModelInfo,
  type TextModelInfo,
} from '@baocut/protocol';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  providerIcon,
  type AccountStatus,
  type AccountTone,
  type ApiProvider,
  type ProviderState,
} from '../../model/api-providers.ts';
import { agoLabel } from '../../model/format.ts';
import type { RefreshLine } from '../../model/models-cloud.ts';
import { probeFromJob, type ProbeState } from '../../model/models-probe.ts';
import { textModelLine } from '../../model/models-text.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useJobs } from '../../state/jobs-store.ts';
import { VendorIcon } from '../vendor-icon.tsx';
import { startProbe } from './model-actions.ts';
import { CLOUD_COPY } from './models-copy.ts';
import { ACCOUNT_STATUS_COPY, PROVIDER_STATE_COPY, PROVIDERS_COPY, PROVIDER_DETAIL_COPY } from './providers-copy.ts';

/*
 * API 提供方几页共用的小件（产品设计 §7.6；设计稿 settings-providers.jsx、settings-provider-detail.jsx、settings-capability.jsx）：
 * 图标、状态点与状态词、账号徽标、模型行的说明、刷新说明与测试的状态。
 */

/** 账号徽标的色调 → S2 Badge 的 variant。 */
export const TONE_BADGE: Record<AccountTone, 'neutral' | 'positive' | 'negative' | 'notice'> = {
  neutral: 'neutral',
  positive: 'positive',
  negative: 'negative',
  notice: 'notice',
};

/** 限速恢复的时刻（按界面语言的时:分）。 */
function clock(iso: string): string {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' }).format(at) : iso;
}

export function accountStatusLabel(status: AccountStatus): string {
  const copy = ACCOUNT_STATUS_COPY;
  switch (status.kind) {
    case 'disabled':
      return copy.disabled;
    case 'invalid-key':
      return copy.invalidKey;
    case 'quota':
      return copy.quota;
    case 'rate-limited':
      return status.until ? copy.rateLimitedUntil(clock(status.until)) : copy.rateLimited;
    case 'ok':
      return copy.ok;
    case 'unverified':
      return copy.unverified;
  }
}

export function stateLabel(state: ProviderState): string {
  const copy = PROVIDER_STATE_COPY;
  switch (state.kind) {
    case 'off':
      return copy.off;
    case 'none':
      return copy.none;
    case 'no-account':
      return copy.noAccount;
    case 'accounts-off':
      return copy.accountsOff;
    case 'warn':
      return accountStatusLabel(state.status);
    case 'ok':
      return copy.ok;
  }
}

/** 账号的名字：起过名的用名字，否则掩码，都没有时「未命名账号」。 */
export function accountName(account: Pick<ProviderAccountView, 'label' | 'masked'>): string {
  return account.label?.trim() || account.masked || PROVIDER_DETAIL_COPY.unnamed;
}

/**
 * 列表行与能力页组头的账号摘要（设计稿 `accountSummary`）：一个账号写它的名字（没起名时是掩码，等宽显示）；几个账号写个数；
 * 没有账号的自建端点写「没有密钥」；其余为空（状态词已经说了）。
 */
export function accountSummary(provider: Pick<ApiProvider, 'kind' | 'accounts' | 'config'>): { text: string; mono: boolean } {
  const { accounts } = provider;
  if (accounts.length > 1) return { text: PROVIDERS_COPY.accounts(accounts.length), mono: false };
  const only = accounts[0];
  if (only) return only.label?.trim() ? { text: only.label.trim(), mono: false } : { text: only.masked, mono: true };
  if (provider.kind === 'custom' && provider.config?.endpoint) return { text: PROVIDERS_COPY.noKey, mono: false };
  return { text: '', mono: false };
}

/** 账号副行里「上次使用」那一段。 */
export function lastUsedText(account: Pick<ProviderAccountView, 'lastUsedAt'>): string {
  return account.lastUsedAt ? PROVIDER_DETAIL_COPY.lastUsed(agoLabel(account.lastUsedAt)) : PROVIDER_DETAIL_COPY.neverUsed;
}

/** 账号上次出错的原话（Runtime 已按界面语言写好）。 */
export function accountDetail(account: ProviderAccountView): string {
  return localizeText(account.status.detail, account.status.detailRef) ?? '';
}

const dot = style({
  display: 'inline-block',
  flexShrink: 0,
  size: 8,
  borderRadius: 'full',
  backgroundColor: { default: 'gray-400', tone: { ok: 'positive', warn: 'notice', off: 'gray-400' } },
});

/** 状态点：能用的绿，首选账号出过错的橙，其余灰（设计稿 `TONE_DOT`）。 */
export function StateDot({ state }: { state: ProviderState }) {
  const tone = state.kind === 'ok' ? 'ok' : state.kind === 'warn' ? 'warn' : 'off';
  return <span className={dot({ tone })} aria-hidden />;
}

const iconBox = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  color: 'gray-800',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});

/** 一家的图标：20px 跟着图标块的档（app.css `data-bc-icons="primary"`），32px 是详情页头。单色的跟文字颜色。 */
export function ProviderIcon({ provider, size = 20 }: { provider: Pick<ApiProvider, 'providerId' | 'label' | 'vendor'>; size?: 20 | 32 }) {
  const spec = providerIcon(provider);
  return size === 32 ? (
    <span className={iconBox} data-bc-icons="own" aria-hidden>
      <VendorIcon spec={spec} UNSAFE_style={{ width: 32, height: 32 }} />
    </span>
  ) : (
    <span className={iconBox} data-bc-icons="primary" aria-hidden>
      <VendorIcon spec={spec} />
    </span>
  );
}

/** 一只模型名字后面那句：显示名、预置音色数、尺寸与张数、上下文与推理强度，不能用时的原因。 */
export function modelLeadText(capability: OnlineCapability, model: ModelInfoBase): string {
  const parts: string[] = [];
  if (model.label && model.label !== model.modelId) parts.push(model.label);
  if (capability === 'synthesizeSpeech') parts.push(CLOUD_COPY.modelVoices((model as SpeechModelInfo).voices?.length ?? 0));
  if (capability === 'generateImage') {
    const image = model as ImageModelInfo;
    parts.push(CLOUD_COPY.modelSizes(image.sizes ?? [], image.maxCount ?? 1));
  }
  if (capability === 'generateText') parts.push(textModelLine(model as TextModelInfo));
  if (model.available === false && model.detail) parts.push(localizeText(model.detail, model.detailRef));
  return parts.filter(Boolean).join(' · ');
}

/** 能力行说明里与刷新有关的那一段。 */
export function refreshText(line: RefreshLine): string {
  switch (line.state) {
    case 'refreshing':
      return CLOUD_COPY.refreshing[line.kind];
    case 'failed':
      return line.error ? `${CLOUD_COPY.refreshFailedLine[line.kind]} · ${line.error}` : CLOUD_COPY.refreshFailedLine[line.kind];
    case 'builtin':
      return line.kind === 'models' ? CLOUD_COPY.builtinModels : CLOUD_COPY.builtinVoices(line.models, line.voices);
    case 'fresh': {
      const ago = agoLabel(line.at);
      const text = line.kind === 'models' ? CLOUD_COPY.freshModels(line.models, ago) : CLOUD_COPY.freshVoices(line.models, line.voices, ago);
      return line.unusable ? text + CLOUD_COPY.unusable(line.unusable) : text;
    }
  }
}

/** 测试对话框打开着的那一只模型。 */
export interface ProbeTarget {
  capability: OnlineCapability;
  providerId: string;
  providerLabel: string;
  model: ModelInfoBase;
}

/**
 * 这次打开页面以来的测试（能力 / 提供方 / 模型 → 状态）：提交中、失败的记在这里，在跑的从 `jobs` 主题读。
 * 详情页与能力页各用一份；关掉对话框后判词留在模型行上。
 */
export function useProbeRuns() {
  const runtime = useRuntime();
  const jobs = useJobs((s) => s.jobs);
  const [runs, setRuns] = useState<Record<string, ProbeState>>({});
  const keyOf = (capability: OnlineCapability, providerId: string, modelId: string) => `${capability}/${providerId}/${modelId}`;

  const state = (capability: OnlineCapability, providerId: string, modelId: string): ProbeState | undefined => {
    const run = runs[keyOf(capability, providerId, modelId)];
    return run?.status === 'running' ? probeFromJob(run.jobId, jobs.find((j) => j.jobId === run.jobId)) : run;
  };

  const start = async ({ capability, providerId, model }: ProbeTarget, voice: string) => {
    const key = keyOf(capability, providerId, model.modelId);
    setRuns((old) => ({ ...old, [key]: { status: 'submitting' } }));
    try {
      const jobId = await startProbe(runtime, capability, providerId, model, voice);
      setRuns((old) => ({ ...old, [key]: { status: 'running', jobId } }));
    } catch (err) {
      setRuns((old) => ({ ...old, [key]: { status: 'failed', message: (err as Error).message } }));
    }
  };

  return { state, start };
}
