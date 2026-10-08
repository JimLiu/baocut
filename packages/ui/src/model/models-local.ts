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
 * 模型 › 本地模型（设计稿 settings-local.jsx）：`models` 主题里的模型包按类分「已安装 / 可下载」（自己的文件在不在盘上，见
 * `localGroups`），加上默认模型菜单。
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
 * 模型包装好了没有（能用）：必需组件都装好（含加载失败、停用、校验不符的）就算；没有组件信息时按状态，`not-installed` 与第一次
 * 下载中的不算。分组不看它：权重在、缺公共组件的也在「已安装」（`localGroups`）。
 */
export function isBundleInstalled(bundle: Pick<ModelBundleStatus, 'state' | 'components'>): boolean {
  const required = bundle.components?.filter((c) => !c.optional);
  if (required?.length) return required.every((c) => c.state === 'installed');
  return bundle.state !== 'not-installed' && bundle.state !== 'downloading';
}

/**
 * 「补齐」要下载的组件（设计稿 settings-local.jsx 的 `half`）：模型包自己的文件在盘上（`ownFiles`，见 `hasOwnFiles`；默认按装好
 * 没有算），还缺的组件。装好了的只会缺可选组件（对齐器、说话人模型），照常可用，补上之后多出词级时间、跨块合并说话人；权重在、缺
 * 公共组件的补上才能用。`models.install` 只下载缺的这几件。自己的文件不在的、这台电脑跑不了的不算（前者走「下载」，后者补了也
 * 用不上）。
 */
export function missingParts(
  bundle: Pick<ModelBundleStatus, 'state' | 'reason' | 'components'>,
  ownFiles = isBundleInstalled(bundle),
): ModelComponentStatus[] {
  if (!ownFiles || bundle.reason === 'unsupported' || bundle.reason === 'worker-missing') return [];
  return (bundle.components ?? []).filter((c) => c.state === 'missing');
}

/** 组件给人看的名字；没列的用组件名。 */
export function componentLabel(component: string): string {
  return M.componentName[component] ?? component;
}

/** 组件做什么的一句（公共组件那一行）；没列的 null。 */
export function componentDesc(component: string): string | null {
  return M.componentDesc[component] ?? null;
}

/**
 * 这一类的模型包分「已安装 / 可下载」（设计稿 model-local-models.js `catalog`）：自己的文件在盘上的（`hasOwnFiles`）在「已安装」，
 * 权重在、缺公共组件的也是，行上「补齐」。`placed`：下载中的模型包上一次在哪一组（true 为「已安装」）。Runtime 每装好一个组件
 * 就更新一次状态，第一次下载时权重先到，行会在下载途中跳进「已安装」；记着的按记着的放，下载结束（或丢掉）再按文件归组。
 */
export function localGroups(
  bundles: readonly ModelBundleStatus[],
  category: ModelCategory,
  placed?: ReadonlyMap<string, boolean>,
): LocalGroups {
  const mine = bundles.filter((b) => bundleCategory(b) === category).sort((a, b) => a.bundleId.localeCompare(b.bundleId));
  const shared = sharedComponents(bundles, category);
  const installed = (b: ModelBundleStatus) => (b.install ? placed?.get(b.bundleId) : undefined) ?? hasOwnFiles(b, shared);
  return { installed: mine.filter(installed), available: mine.filter((b) => !installed(b)) };
}

/** 下载中的模型包这一次在哪一组：交给下一次 `localGroups` 的 `placed`。 */
export function installingPlacement(groups: LocalGroups): Map<string, boolean> {
  const placed = new Map<string, boolean>();
  for (const b of groups.installed) if (b.install) placed.set(b.bundleId, true);
  for (const b of groups.available) if (b.install) placed.set(b.bundleId, false);
  return placed;
}

export type ChipTone = 'accent' | 'positive' | 'notice' | 'negative' | 'neutral';
export interface ModelChip {
  label: string;
  tone: ChipTone;
}

/**
 * 一行模型包的标签：默认、Worker 状态、不可用的原因，缺的组件（`missingParts`，`ownFiles` 同它）。只是「已安装、没加载」时不加
 * 标签；正在下载的不写缺什么。
 */
export function bundleChips(bundle: ModelBundleStatus, isDefault: boolean, ownFiles = isBundleInstalled(bundle)): ModelChip[] {
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
      // 装过但文件不对的给个提示；从没装过的不加标签。缺组件（`incomplete`）的由下面「缺 …」说清楚是哪几件，别人装上了
      // 公共组件、自己一件没有的也不算装过。
      if (bundle.reason && bundle.reason !== 'missing-manifest' && bundle.reason !== 'incomplete') {
        chips.push({ label: M.reason[bundle.reason], tone: 'notice' });
      }
      break;
    case 'installed':
      break;
  }
  const missing = bundle.install && bundle.install.state !== 'paused' ? [] : missingParts(bundle, ownFiles);
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

// ---- 公共组件 ----

/**
 * 同一个组件：组件名 + 仓库 + 版本。只看仓库会把 IndexTTS2 的权重（`tts`）与 IndexTTS 2.5 借来的辅助件（`aux`）算成公共组件，
 * 设计稿把后者算作 2.5 自己的（model-local-models.js `layout`）。
 */
function componentKey(c: Pick<ModelComponentStatus, 'component' | 'repo' | 'revision'>): string {
  return `${c.component}:${c.repo}@${c.revision}`;
}

/** 公共组件区里的顺序（设计稿 data.js `setComponents`：VAD、对齐器、分词器、声纹嵌入……）；没列的排后面。 */
const SHARED_ORDER = ['vad', 'aligner', 'tokenizer', 'speaker', 'segmentation', 'codec', 'aux'];

export interface SharedComponent {
  key: string;
  /** 组件名（`vad`、`aligner`……）。 */
  component: string;
  repo: string;
  installed: boolean;
  /** 装好时占的，没装时要下载的；都不知道时 null。 */
  bytes: number | null;
  /** 声明它的模型包，按 ID 排（与「已安装 / 可下载」同序）。 */
  users: ModelBundleStatus[];
}

/**
 * 一类的公共组件（设计稿 model-local-models.js `layout`）：这一类里两只及以上模型包声明的同一个组件。公共与否只看目录、不看装没装，
 * 删掉一只模型不会让组件从这里消失。没有组件信息的旧快照没有公共组件。
 */
export function sharedComponents(bundles: readonly ModelBundleStatus[], category: ModelCategory): SharedComponent[] {
  const byKey = new Map<string, { status: ModelComponentStatus[]; users: ModelBundleStatus[] }>();
  const mine = bundles.filter((b) => bundleCategory(b) === category).sort((a, b) => a.bundleId.localeCompare(b.bundleId));
  for (const bundle of mine) {
    for (const c of bundle.components ?? []) {
      const key = componentKey(c);
      const entry = byKey.get(key) ?? { status: [], users: [] };
      entry.status.push(c);
      if (!entry.users.includes(bundle)) entry.users.push(bundle);
      byKey.set(key, entry);
    }
  }
  const rank = (component: string) => {
    const i = SHARED_ORDER.indexOf(component);
    return i < 0 ? SHARED_ORDER.length : i;
  };
  return [...byKey.entries()]
    .filter(([, e]) => e.users.length >= 2)
    .map(([key, e]) => {
      const first = e.status[0]!;
      const installed = e.status.some((c) => c.state === 'installed');
      const sized = e.status.find((c) => (installed ? c.state === 'installed' && c.bytes !== null : c.estimatedBytes != null));
      const bytes = installed ? (sized?.bytes ?? first.estimatedBytes ?? null) : (sized?.estimatedBytes ?? null);
      return { key, component: first.component, repo: first.repo, installed, bytes, users: e.users };
    })
    .sort((a, b) => rank(a.component) - rank(b.component) || a.key.localeCompare(b.key));
}

/**
 * 模型包自己的文件在盘上（设计稿的 `on[m.id]`，权重在）：装好了，或者公共组件、可选组件以外有装好的组件——权重在、缺公共组件的
 * （`incomplete`）也算。只是公共组件被别的模型装上了的、只有可选组件的不算。
 */
export function hasOwnFiles(bundle: ModelBundleStatus, shared: readonly SharedComponent[]): boolean {
  if (isBundleInstalled(bundle)) return true;
  const keys = new Set(shared.map((c) => c.key));
  return (bundle.components ?? []).some((c) => c.state === 'installed' && !c.optional && !keys.has(componentKey(c)));
}

/**
 * 装齐这只模型包还要下载多少（设计稿 `needSize`）：缺的组件的清单大小之和，可选的也算（安装与补齐都下载它）。有组件不知道大小，
 * 或没有组件信息时 null。
 */
export function needBytes(bundle: Pick<ModelBundleStatus, 'components'>): number | null {
  if (!bundle.components?.length) return null;
  let total = 0;
  for (const c of bundle.components) {
    if (c.state !== 'missing') continue;
    if (c.estimatedBytes == null) return null;
    total += c.estimatedBytes;
  }
  return total;
}

/**
 * 就地下载那一处写多大（与设置页那一行同一个数）：有组件信息时就是 `needBytes`——权重在、缺公共组件的只算缺的，有缺的组件不知道
 * 大小时不写；没有组件信息的旧快照用随附清单估的 `estimatedBytes`。不知道、或什么都不缺时 null。
 */
export function downloadBytes(bundle: Pick<ModelBundleStatus, 'components' | 'estimatedBytes'>): number | null {
  return (bundle.components?.length ? needBytes(bundle) : bundle.estimatedBytes) || null;
}

const installing = (b: ModelBundleStatus) => !!b.install && b.install.state !== 'paused';
const cannotRun = (b: ModelBundleStatus) => b.reason === 'unsupported' || b.reason === 'worker-missing';

export type SharedAction =
  | { kind: 'installed' }
  /** 用到它的模型包正在下载（这里点的补齐，或行上的下载、补齐）：缺的组件跟着它下，显示它的进度。 */
  | { kind: 'running'; bundle: ModelBundleStatus }
  /** 「下载」= 补齐 `target`（只下它缺的）。 */
  | { kind: 'get'; target: ModelBundleStatus }
  /** 没有自己文件在盘上的模型用它：不给按钮，等装模型时一起下载。 */
  | { kind: 'later' };

/**
 * 公共组件那一行右边做什么（设计稿 model-local-models.js `compAction`）。组件不单独装：缺的时候借一只文件在盘上、用到它、这台电脑
 * 跑得了的模型包去补齐，挑要下得最少的那只（大小不知道的排后面），一样多按 ID 顺序。
 */
export function sharedAction(c: SharedComponent, shared: readonly SharedComponent[]): SharedAction {
  if (c.installed) return { kind: 'installed' };
  const running = c.users.find(installing);
  if (running) return { kind: 'running', bundle: running };
  let target: ModelBundleStatus | null = null;
  let best = Infinity;
  for (const b of c.users) {
    if (cannotRun(b) || !hasOwnFiles(b, shared)) continue;
    const need = needBytes(b) ?? Infinity;
    if (!target || need < best) {
      target = b;
      best = need;
    }
  }
  return target ? { kind: 'get', target } : { kind: 'later' };
}

/** 公共组件那一行的副题（设计稿 `compUsage`）：文件在盘上的模型几只在用、一共几只需要。 */
export function sharedUsage(c: SharedComponent, shared: readonly SharedComponent[]): { live: number; all: number } {
  return { live: c.users.filter((b) => hasOwnFiles(b, shared)).length, all: c.users.length };
}

/** 待补全的公共组件（设计稿 `catalog.repair`）：缺着，又有文件在盘上的模型要用它。有的话公共组件区自动展开。 */
export function sharedRepair(shared: readonly SharedComponent[]): SharedComponent[] {
  return shared.filter((c) => !c.installed && c.users.some((b) => hasOwnFiles(b, shared)));
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
