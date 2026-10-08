import {
  localizeText,
  type ImageModelInfo,
  type ModelBundleStatus,
  type ModelCapabilitiesView,
  type ModelComponentStatus,
  type ModelLicense,
} from '@baocut/protocol';
import type { ModelCategory } from './settings-nav.ts';
import { M } from './models-local-copy.ts';

/**
 * 模型 › 本地模型（设计稿 settings-local.jsx）：`models` 主题里的模型包按类分「已安装 / 可下载」，加上默认模型菜单。
 * 安装、修复与删除的确认、进度和补救在 models-install.ts，检查在 model-check.ts。
 */

/** 本机 Provider 的 ID（packages/models/src/local-source.ts）。 */
export const LOCAL_PROVIDER = 'local';

/** 本机列出的文生图模型：模型包 ID → 描述（「试画」读提示词上限与可用性）。 */
export function localImageModels(view: ModelCapabilitiesView | null): Map<string, ImageModelInfo> {
  const local = view?.generateImage.providers.find((p) => p.providerId === LOCAL_PROVIDER);
  return new Map((local?.models ?? []).map((m) => [m.modelId, m]));
}

/** 模型包属于哪一类：转写、对齐与说话人区分都是语音识别，合成是语音合成，文生图是图像生成，分离是音源分离。 */
export function bundleCategory(bundle: Pick<ModelBundleStatus, 'capability'>): ModelCategory {
  switch (bundle.capability) {
    case 'transcribe':
    case 'align':
    case 'diarize':
      return 'asr';
    case 'synthesize':
      return 'tts';
    case 'image':
      return 'image';
    case 'separate':
      return 'sep';
  }
}

export interface LocalGroups {
  installed: ModelBundleStatus[];
  available: ModelBundleStatus[];
}

/**
 * 模型包装好了没有：各组件都装好（含加载失败、停用、校验不符的）就算；没有组件信息时按状态，`not-installed` 与第一次下载中的不算。
 * 修复中的模型包组件仍在，留在「已安装」；第一次下载、补齐组件中的在「可下载」，进度显示在那一行。
 */
export function isBundleInstalled(bundle: Pick<ModelBundleStatus, 'state' | 'components'>): boolean {
  const required = bundle.components?.filter((c) => !c.optional);
  if (required?.length) return required.every((c) => c.state === 'installed');
  return bundle.state !== 'not-installed' && bundle.state !== 'downloading';
}

/**
 * 装好了、但还缺的可选组件（对齐器、说话人模型）：模型包照常可用，补上之后多出词级时间、跨块合并说话人（设计稿 settings-local.jsx 的
 * `half`）。`models.install` 只下载缺的这几件。没装好的、这台电脑跑不了的模型包不算（前者走「下载」，后者补了也用不上）。
 */
export function missingParts(bundle: Pick<ModelBundleStatus, 'state' | 'reason' | 'components'>): ModelComponentStatus[] {
  if (!isBundleInstalled(bundle) || bundle.reason === 'unsupported' || bundle.reason === 'worker-missing') return [];
  return (bundle.components ?? []).filter((c) => c.optional && c.state === 'missing');
}

/** 组件给人看的名字；没列的用组件名。 */
export function componentLabel(component: string): string {
  return M.componentName[component] ?? component;
}

/** 这一类的模型包，按装好没有分组（见 `isBundleInstalled`）。 */
export function localGroups(bundles: readonly ModelBundleStatus[], category: ModelCategory): LocalGroups {
  const mine = bundles.filter((b) => bundleCategory(b) === category).sort((a, b) => a.bundleId.localeCompare(b.bundleId));
  return { installed: mine.filter(isBundleInstalled), available: mine.filter((b) => !isBundleInstalled(b)) };
}

export type ChipTone = 'accent' | 'positive' | 'notice' | 'negative' | 'neutral';
export interface ModelChip {
  label: string;
  tone: ChipTone;
}

/** 一行模型包的标签：默认、Worker 状态、不可用的原因。只是「已安装、没加载」时不加标签。 */
export function bundleChips(bundle: ModelBundleStatus, isDefault: boolean): ModelChip[] {
  const chips: ModelChip[] = isDefault ? [{ label: M.chipDefault, tone: 'accent' }] : [];
  switch (bundle.state) {
    case 'loading':
      chips.push({ label: M.chipLoading, tone: 'neutral' });
      break;
    case 'ready':
      chips.push({ label: M.chipReady, tone: 'positive' });
      break;
    case 'busy':
      chips.push({ label: M.chipBusy, tone: 'neutral' });
      break;
    case 'unloading':
      chips.push({ label: M.chipUnloading, tone: 'neutral' });
      break;
    case 'error':
      chips.push({ label: bundle.reason ? M.reason[bundle.reason] : M.chipUnavailable, tone: 'negative' });
      break;
    case 'not-installed':
      // 装过但文件不对的给个提示；从没装过的不加标签。
      if (bundle.reason && bundle.reason !== 'missing-manifest') chips.push({ label: M.reason[bundle.reason], tone: 'notice' });
      break;
    case 'installed':
      break;
  }
  const missing = missingParts(bundle);
  if (missing.length) chips.push({ label: M.chipMissing(missing.map((c) => componentLabel(c.component))), tone: 'notice' });
  return chips;
}

const BACKEND_LABEL: Record<ModelBundleStatus['backend'], string> = { mlx: 'MLX', coreml: 'Core ML', candle: 'Candle', ggml: 'GGML' };

/** 一行模型包的事实：用途 · 后端 · 设备 · 补充说明。 */
export function bundleFacts(bundle: ModelBundleStatus): string {
  return [M.capability[bundle.capability], BACKEND_LABEL[bundle.backend], bundle.device, localizeText(bundle.detail, bundle.detailRef)]
    .filter(Boolean)
    .join(' · ');
}

/** 反复崩溃停用、或加载失败的模型包可以重新启用（`models.enable`）。它会清掉校验记录，下次加载重新校验，所以只在这时调。 */
export function canReenable(bundle: Pick<ModelBundleStatus, 'state' | 'reason'>): boolean {
  return bundle.state === 'error' && (bundle.reason === 'resource' || bundle.reason === 'load-failed');
}

/** 本地页默认菜单里「自动选择」的键。 */
export const AUTO_DEFAULT = 'auto';

export interface LocalDefaultPicker {
  /** null：没有勾着的项——默认是云端或节点的模型（Picker 显示 `other`），或语音合成还没设默认（显示「未设置」）。 */
  selectedKey: string | null;
  items: { key: string; label: string }[];
  /** 默认不是本机模型时它的名字（服务商 · 模型）。 */
  other: string | null;
  /** 「自动选择」此刻落到哪只本机模型。 */
  autoUses: string | null;
  /** 菜单里有没有「自动选择」：语音识别与音源分离有出厂默认（架构设计 §6.2），语音合成没有。 */
  hasAuto: boolean;
}

/** 本地页能设默认的几种模型包与它们在能力视图里的名字。 */
export type LocalDefaultCapability = 'transcribe' | 'synthesize' | 'image' | 'separate';
export const VIEW_CAPABILITY = {
  transcribe: 'transcribe',
  synthesize: 'synthesizeSpeech',
  image: 'generateImage',
  separate: 'separateAudio',
} as const;

/** 模型包给人看的名字：登记的模型包都有 `label`；旧的快照没有时退回 `bundleId`。 */
export function bundleName(bundle: Pick<ModelBundleStatus, 'bundleId' | 'label'>): string {
  return bundle.label ?? bundle.bundleId;
}

/**
 * 本地页的默认模型菜单。
 * - 语音识别与音源分离：「自动选择」= 不设默认，用出厂默认的本机模型包；其余是装好的这一类模型包。
 * - 语音合成与图像生成：没有出厂默认（架构设计 §6.2），菜单里没有「自动选择」；没设或设的那只已不可选时什么都不勾、显示
 *   「未设置」，只列装好的这一类模型包。
 *   想清掉默认在云端页选「每次选择」。
 * 一种能力只有一个默认值，与云端页共用——默认是云端或节点的模型时这里不勾任何一项，如实说出来；选一只本地的会替换它。
 */
export function localDefaultPicker(
  view: ModelCapabilitiesView | null,
  bundles: readonly ModelBundleStatus[],
  kind: LocalDefaultCapability = 'transcribe',
): LocalDefaultPicker {
  const hasAuto = kind === 'transcribe' || kind === 'separate';
  // 语音识别与音源分离沿用原来的判法（不是 not-installed 就列）；语音合成与图像生成只列装齐了的，第一次下载中的不算。
  const installed = bundles.filter((b) => b.capability === kind && (hasAuto ? b.state !== 'not-installed' : isBundleInstalled(b)));
  const items = [...(hasAuto ? [{ key: AUTO_DEFAULT, label: M.auto }] : []), ...installed.map((b) => ({ key: b.bundleId, label: bundleName(b) }))];
  const capability = view?.[VIEW_CAPABILITY[kind]];
  const effective = capability?.effective;
  const autoUses =
    hasAuto && effective && effective.source === 'factory-default' && effective.providerId === LOCAL_PROVIDER ? effective.modelId : null;
  const current = capability?.default ?? null;
  if (!current) return { selectedKey: hasAuto ? AUTO_DEFAULT : null, items, other: null, autoUses, hasAuto };
  if (current.providerId === LOCAL_PROVIDER) {
    // 语音合成与图像生成没有出厂默认：存着的默认已不在可选里（在别处删了或缺组件）按「未设置」算（设计稿 `defaultView`）。删除模型包时
    // Runtime 已经清掉指向它的默认值（架构设计 §6.8），这里兜住没经 `models.remove` 的情况。
    if (!hasAuto && !items.some((i) => i.key === current.modelId)) return { selectedKey: null, items, other: null, autoUses, hasAuto };
    if (!items.some((i) => i.key === current.modelId)) {
      const known = bundles.find((b) => b.bundleId === current.modelId);
      items.push({ key: current.modelId, label: M.notInstalled(known ? bundleName(known) : current.modelId) });
    }
    return { selectedKey: current.modelId, items, other: null, autoUses, hasAuto };
  }
  const provider = capability?.providers.find((p) => p.providerId === current.providerId);
  return { selectedKey: null, items, other: `${provider?.label ?? current.providerId} · ${current.modelId}`, autoUses, hasAuto };
}

/** 本地菜单的一项 → `models.setDefault` 的参数。 */
export function localDefaultChoice(key: string): { providerId: string | null; modelId?: string } {
  return key === AUTO_DEFAULT ? { providerId: null } : { providerId: LOCAL_PROVIDER, modelId: key };
}

// ---- 许可 ----

export interface LicenseLine {
  /** 「模型权重」或组件的名字。 */
  part: string;
  /** 是组件的许可（不是权重的）。 */
  component: boolean;
  license: ModelLicense;
}

/**
 * 详情「许可」那一行列什么（设计稿 model-local-models.js `licenseLines`）：权重的许可，再加上组件里要署名（CC-BY）或与权重许可
 * 不同的，每件一条。`weights`：权重的许可（模型包登记的，语音合成的再看模型描述）。都没有许可时空表，这一行不画。
 */
export function licenseLines(bundle: Pick<ModelBundleStatus, 'components'>, weights: ModelLicense | null): LicenseLine[] {
  const lines: LicenseLine[] = weights ? [{ part: M.weights, component: false, license: weights }] : [];
  for (const c of bundle.components ?? []) {
    const license = c.license;
    if (!license) continue;
    if (!weights || license.name !== weights.name || /^CC-BY/.test(license.name)) {
      lines.push({ part: componentLabel(c.component), component: true, license });
    }
  }
  return lines;
}

/** 一条许可的说法：只有一条且是权重的不写「模型权重 · 」。 */
export function licenseLineText(line: LicenseLine, count: number): string {
  return `${count > 1 || line.component ? `${line.part} · ` : ''}${line.license.name} · ${line.license.summary}`;
}
