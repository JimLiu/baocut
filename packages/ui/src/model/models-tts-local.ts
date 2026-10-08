import type { ModelBundleStatus, ModelCapabilitiesView, ModelLicense, SpeechModelInfo } from '@baocut/protocol';
import { LOCAL_PROVIDER, bundleChips, type ModelChip } from './models-local.ts';
import { M } from './models-tts-local-copy.ts';

/**
 * 设置 › 模型 › 语音合成 › 本地模型的一行（设计稿 settings-local.jsx 的 ModelRow、model-tts.js 的 `modelBrief`）：
 * 行上只写「能拿它做什么」——出声方式、要不要自己给录音、风格、会念哪些语言、体积；许可不许商用的标出来。
 * 事实都从 `local` Provider 的 `synthesizeSpeech` 模型描述（`SpeechModelInfo.local`）来，不按模型名猜。
 */

/** `local` Provider 列出的合成模型，按模型包 ID 取（本地模型的 `modelId` 就是 `bundleId`）。 */
export function localSpeechModels(view: ModelCapabilitiesView | null): Map<string, SpeechModelInfo> {
  const local = view?.synthesizeSpeech.providers.find((p) => p.providerId === LOCAL_PROVIDER);
  return new Map((local?.models ?? []).map((m) => [m.modelId, m]));
}

/** 试听面板怎么出声：模型自带说话人（`preset`）、按描述造声（`describe`），或内置音色与克隆（`clone`）。 */
export type QuickKind = 'preset' | 'describe' | 'clone';

export function quickKind(model: Pick<SpeechModelInfo, 'voiceModes' | 'local'>): QuickKind {
  if (model.voiceModes.includes('clone')) return 'clone';
  if (model.voiceModes.includes('describe')) return 'describe';
  return 'preset';
}

/** 能用一段录音克隆（「我的声音」能在它上面试）。 */
export function canClone(model: Pick<SpeechModelInfo, 'voiceModes'>): boolean {
  return model.voiceModes.includes('clone');
}

/** 会念哪些语言：不限时写「语言不限」；多于五种只写前四种和总数。 */
export function languagesFact(languages: SpeechModelInfo['languages']): string {
  if (languages === 'any') return M.languagesAny;
  const short = languages.map((c) => M.languageShort(c));
  return short.length > 5 ? M.languagesMore(short.slice(0, 4), short.length) : short.join(' / ');
}

export interface TtsBrief {
  summary: string;
  facts: string[];
}

/**
 * 行上的简介（设计稿 `modelBrief`）。情绪控制这一版的请求还不带（`LocalSpeechTraits.emotion` 只描述引擎），行上不写「情绪可调」。
 */
export function ttsBrief(model: SpeechModelInfo): TtsBrief {
  const local = model.local;
  const builtins = model.voices.filter((v) => v.source === 'builtin').length;
  const speakers = model.voices.filter((v) => v.source !== 'builtin').length;
  const style = local?.instructions === 'style';
  const kind = quickKind(model);
  const describe = model.voiceModes.includes('describe');
  let summary: string;
  let mode: string;
  if (kind === 'clone' && describe) {
    summary = M.summaryCloneDescribe(builtins, !!local?.maxDurationSec);
    mode = M.modeCloneDescribe;
  } else if (kind === 'clone') {
    summary = M.summaryClone(builtins, style);
    mode = M.modeClone;
  } else if (kind === 'describe') {
    summary = M.summaryDescribe(builtins);
    mode = M.modeDescribe;
  } else {
    summary = M.summaryPreset(speakers, style);
    mode = M.modePreset;
  }
  const facts = [mode];
  if (style && kind === 'clone') facts.push(M.factStyle);
  facts.push(languagesFact(model.languages));
  if (local) facts.push(`${local.sampleRate / 1000} kHz`);
  if (local?.slow) facts.push(M.factSlow);
  return { summary, facts };
}

/** 装好的组件一共多大（没装齐或没报大小时 null；共享组件按它占的算）。 */
export function installedBytes(bundle: Pick<ModelBundleStatus, 'components'>): number | null {
  const comps = bundle.components;
  if (!comps?.length || comps.some((c) => c.bytes === null)) return null;
  return comps.reduce((sum, c) => sum + (c.bytes ?? 0), 0);
}

/** 只许非商业用途的许可（行上标「仅限非商用」，下载前要让人看到）；可商用的给 null。 */
export function nonCommercial(license: ModelLicense | undefined | null): ModelLicense | null {
  return license && !license.commercialUse ? license : null;
}

/** 许可地址里的上游主（huggingface.co/k2-fsa/OmniVoice → k2-fsa），找不到就写许可名。 */
export function licenseOwner(license: Pick<ModelLicense, 'url' | 'name'>): string {
  try {
    const owner = new URL(license.url).pathname.split('/').filter(Boolean)[0];
    return owner || license.name;
  } catch {
    return license.name;
  }
}

/** 许可提要一行（设计稿 `ttsLicenseBrief`）：「CC-BY-NC-4.0 · 只许非商业用途 · 商用要向 k2-fsa 另行申请」。 */
export function licenseBrief(license: ModelLicense): string {
  return license.commercialUse ? M.licenseCommercial(license.name) : M.licenseNonCommercial(license.name, licenseOwner(license));
}

/** 合成模型包一行的标签：默认、Worker 状态、缺的组件（`ownFiles` 同 `bundleChips`），再加「仅限非商用」。 */
export function ttsChips(bundle: ModelBundleStatus, isDefault: boolean, ownFiles?: boolean): ModelChip[] {
  const chips = bundleChips(bundle, isDefault, ownFiles);
  if (nonCommercial(bundle.license)) chips.push({ label: M.nonCommercialChip, tone: 'notice' });
  return chips;
}

/**
 * 引擎家族的说明（设计稿 model-tts.js 的 ENGINES `desc`，按 `LocalSpeechTraits.family` 取）。
 * 只写这一版能用上的：情绪控制、按目标时长合成这些引擎能力还没接到请求里，不写。
 */
export function familyDesc(model: Pick<SpeechModelInfo, 'local'>): string | null {
  return model.local ? (M.familyDesc[model.local.family] ?? null) : null;
}

/**
 * 试听前要先说清楚的一句（设计稿 `quickSlow`）；没有就是 null。模型描述的 `notes` 优先（candle 在 CPU 上比实时慢几倍到上百倍，
 * 一次试听要等几分钟，这时 VoxCPM2 的实时率与大模型的说法都不对），其次按描述造声的说明、VoxCPM2 的实时率、不许商用，
 * 最后是大模型的慢。
 */
export function quickNote(model: SpeechModelInfo): string | null {
  if (model.notes) return model.notes;
  if (quickKind(model) === 'describe') return M.quickDescribe;
  if (model.local?.family === 'voxcpm2') return M.quickVoxcpm;
  const license = nonCommercial(model.local?.license);
  if (license) return M.quickNonCommercial(license.name);
  if (model.local?.slow) return M.quickSlow;
  return null;
}
