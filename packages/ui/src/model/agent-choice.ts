import {
  isDriverId,
  localizeText,
  recommendedDriverModel,
  type DriverId,
  type DriverInfo,
  type DriverModel,
  type DriverState,
  type ModelTier,
} from '@baocut/protocol';
import { AGENT_PICKER, DRIVER_STATE_REASON, EFFORT_COPY, MODEL_TIER_LABEL } from '../copy.ts';
import { listedInPicker } from './agent-catalog.ts';

/**
 * 输入区的 Agent · 模型 · 推理强度选择（原型 agent-picker.jsx、model-agent.js `providerRows` / `modelRows` / `harnessLabel`）。
 * 这里只算行与文案；选了什么，建好的会话记在 Runtime，新会话的草稿记在 shell-store。
 */

/**
 * 新会话草稿上的选择。没选过的字段不出现，建会话时也不传，由 Runtime 按偏好给默认（默认 Agent、它的默认模型与强度）。
 * `model: null` 是明确选了「Agent 默认模型」（不传模型，按 CLI 配置）；`effort: null` 是模型自己的默认强度。
 */
export interface AgentChoice {
  driverId?: DriverId;
  model?: string | null;
  effort?: string | null;
}

/** 选择器的一次改动。换 Agent 时总是带上模型。 */
export interface AgentChange {
  driverId: DriverId;
  model?: string | null;
  effort?: string | null;
}

/** 读回持久化的草稿选择：写法不对的 Agent id、类型不对的字段都丢掉（没注册的 Agent 由 Runtime 建会话时拒绝）。 */
export function parseAgentChoice(value: unknown): AgentChoice | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const choice: AgentChoice = {};
  if (isDriverId(raw.driverId)) choice.driverId = raw.driverId;
  if (raw.model === null || typeof raw.model === 'string') choice.model = raw.model;
  if (raw.effort === null || typeof raw.effort === 'string') choice.effort = raw.effort;
  return Object.keys(choice).length ? choice : null;
}

/**
 * 新会话实际会用的默认模型（设计稿 model-agent-setup.js `defaultModel`）：`DriverInfo.defaultModel` 没设过时已是推荐模型，
 * null 是明确选了「Agent 默认模型」；设过的模型从模型表里消失了，Runtime 建会话时改用推荐模型，这里同样换成推荐的。
 * 模型表为空（还没检测到）时没法判断，原样返回。
 */
export function effectiveDefaultModel(driver: Pick<DriverInfo, 'id' | 'models' | 'defaultModel'>): string | null {
  const saved = driver.defaultModel;
  if (saved === null || driver.models.length === 0 || driver.models.some((m) => m.id === saved)) return saved;
  return recommendedDriverModel(driver.id, driver.models)?.id ?? saved;
}

/** 草稿当前用的模型与强度：选过的用选过的，否则用这个 Agent 新会话实际会用的默认（与 Runtime 建会话时的取法一致）。 */
export function draftSelection(driver: DriverInfo | null, choice: AgentChoice | undefined): { model: string | null; effort: string | null } {
  const mine = !!choice && (choice.driverId === undefined || choice.driverId === driver?.id);
  return {
    model: mine && choice && 'model' in choice ? (choice.model ?? null) : driver ? effectiveDefaultModel(driver) : null,
    effort: mine && choice && 'effort' in choice ? (choice.effort ?? null) : (driver?.defaultEffort ?? null),
  };
}

/** 草稿上叠一次改动。换了 Agent，原来的模型与强度不再适用，只留这次给的。 */
export function applyAgentChange(choice: AgentChoice | undefined, current: DriverId | null, change: AgentChange): AgentChoice {
  if (change.driverId !== current) {
    const next: AgentChoice = { driverId: change.driverId };
    if (change.model !== undefined) next.model = change.model;
    if (change.effort !== undefined) next.effort = change.effort;
    return next;
  }
  return { ...choice, driverId: change.driverId, ...pick(change) };
}

function pick(change: AgentChange): Partial<AgentChoice> {
  const out: Partial<AgentChoice> = {};
  if (change.model !== undefined) out.model = change.model;
  if (change.effort !== undefined) out.effort = change.effort;
  return out;
}

/**
 * 换模型时的改动：当前强度新模型也有就留着，否则回到模型自己的默认（null）。
 * 不认识新模型（不在列表里）时也回到默认，不替它猜。
 */
export function modelChange(driver: DriverInfo, model: string | null, effort: string | null): AgentChange {
  const next = effectiveModel(driver, model);
  const keeps = effort !== null && !!next?.efforts.some((e) => e.id === effort);
  return { driverId: driver.id, model, effort: keeps ? effort : null };
}

/** 这次实际会用哪个模型：选了的；没选时是 CLI 配置里的那个，再不然 Agent 自己标的默认。 */
export function effectiveModel(driver: DriverInfo | null, model: string | null): DriverModel | undefined {
  if (!driver) return undefined;
  if (model !== null) return driver.models.find((m) => m.id === model);
  return driver.models.find((m) => m.id === driver.configModel) ?? driver.models.find((m) => m.isDefault);
}

export function modelLabel(driver: DriverInfo | null, model: string | null): string {
  if (model === null) return AGENT_PICKER.agentDefault;
  return driver?.models.find((m) => m.id === model)?.label ?? model;
}

/** 选择器收起时的字样（原型 `harnessLabel`）：`Claude Code · Sonnet`。 */
export function harnessLabel(driver: DriverInfo | null, model: string | null): string {
  if (!driver) return AGENT_PICKER.detecting;
  return `${driver.name} · ${modelLabel(driver, model)}`;
}

/** 模型名打头常带的厂商或系列名：后面还有别的词时去掉（`Claude Opus 5.5` → `Opus`、`GPT-5.6 Sol` → `Sol`）。 */
const MODEL_BRAND_WORDS = new Set(['claude', 'gpt', 'gemini', 'grok', 'kimi', 'codex']);

/**
 * 输入区窄的时候模型只留级别名，不要版本号（原型 model-agent.js `compactModelLabel`，产品设计 §3.2.3）：
 * 去掉末尾的 `[1m]`、`(1M context)` 这类标注，带大写的词按连字符拆开（`GPT-6.1-Sol`），再去掉带数字的词（版本）和打头的厂商名。
 * 认不出的（剩下不是一两个词、原名超过四个词，或是 `gpt-6.1-sol` 这样全小写的一整个 id）原样返回，由样式截断。
 */
export function compactModelLabel(label: string): string {
  const full = label.trim();
  const bare = full.replace(/(\s*(\[[^\]]*\]|\([^)]*\)))+$/, '').trim();
  const words = bare
    .split(/\s+/)
    .flatMap((word) => (/[A-Z]/.test(word) ? word.split('-') : [word]))
    .filter(Boolean);
  if (!words.length || words.length > 4) return full;
  if (words.length === 1) return /\d/.test(words[0]!) ? full : words[0]!;
  const kept = words.filter((word) => !/\d/.test(word));
  const named = kept.length > 1 && MODEL_BRAND_WORDS.has(kept[0]!.toLowerCase()) ? kept.slice(1) : kept;
  if (!named.length || named.length > 2 || named.some((word) => !/^\p{L}[\p{L}'’.-]*$/u.test(word))) return full;
  return named.join(' ');
}

/** 窄的时候收起来的字样：Agent 只剩图标，这里只给模型——「Agent 默认模型」写「默认」，其余取级别名。 */
export function compactHarnessLabel(driver: DriverInfo | null, model: string | null): string {
  if (!driver) return AGENT_PICKER.detecting;
  if (model === null) return AGENT_PICKER.defaultMark;
  return compactModelLabel(modelLabel(driver, model));
}

/** Agent 图标（lobe-icons，`components/vendor-icons/<file>.svg`）：mono 的跟文字颜色，彩色的原样显示。 */
export type AgentIconSpec = { kind: 'vendor'; file: string; mono: boolean } | { kind: 'letter'; letter: string };

/** 内置 Agent → 图标文件（与原型 model-vendors.js `AGENT_ICONS` 是同一张表）。 */
export const AGENT_ICON_FILES: Readonly<Record<string, { file: string; mono: boolean }>> = {
  claude: { file: 'anthropic', mono: true },
  codex: { file: 'codex', mono: false },
  copilot: { file: 'githubcopilot', mono: true },
  pi: { file: 'pi', mono: true },
  opencode: { file: 'opencode', mono: true },
  gemini: { file: 'google', mono: false },
  cursor: { file: 'cursor', mono: true },
  grok: { file: 'xai', mono: true },
  kimi: { file: 'moonshot', mono: true },
};

/** 这个 Agent 用哪个图标：内置的查表；用户添加的 ACP 智能体（以及没有图标的）用名字首字母。 */
export function agentIcon(driver: Pick<DriverInfo, 'id' | 'name'> & { source?: DriverInfo['source'] }): AgentIconSpec {
  const known = driver.source === 'custom' ? undefined : AGENT_ICON_FILES[driver.id];
  if (known) return { kind: 'vendor', ...known };
  const letter = [...(driver.name.trim() || driver.id)][0] ?? '?';
  return { kind: 'letter', letter: letter.toLocaleUpperCase() };
}

/** 账号描述的第一段（去掉「已登录」这类状态词）；没有时说「本机」。 */
export function accountLabel(driver: DriverInfo): string {
  return (localizeText(driver.account, driver.accountRef) ?? '').split(' · ')[0]!.trim() || AGENT_PICKER.localAccount;
}

/** 行的状态（原型 `providerState`）：能用、没装、要处理（没登录 / 太旧 / 出错）、在设置里停用。行尾的图标据此画。 */
export type ProviderState = 'ready' | 'missing' | 'attention' | 'off';

export function providerState(state: DriverState): ProviderState {
  if (state === 'ready') return 'ready';
  if (state === 'not-installed') return 'missing';
  return state === 'disabled' ? 'off' : 'attention';
}

export interface ProviderRow {
  id: DriverId;
  name: string;
  sub: string;
  state: ProviderState;
  /** 能进第二级选模型。 */
  ready: boolean;
  /** 会话已经开始，不能换成它。 */
  locked: boolean;
  selected: boolean;
}

/**
 * 第一级：每个 Agent 一行（原型 `providerRows`）。能用的写当前模型与账号；用不了的写原因，点了去设置。
 * `lockedTo`：会话有任务后 Agent 固定，其他 Agent 的行标出原因、不能选。
 * 「更多」四家与用户添加的没检测到时不列（`listedInPicker`）；当前选着的那个照列，免得收起时的字样找不到行。
 */
export function providerRows(
  drivers: readonly DriverInfo[],
  selected: DriverId | null,
  model: string | null,
  lockedTo: DriverId | null,
): ProviderRow[] {
  return drivers
    .filter((driver) => driver.id === selected || listedInPicker(driver))
    .map((driver) => {
      const isSelected = driver.id === selected;
      const ready = driver.state === 'ready';
      const locked = lockedTo !== null && driver.id !== lockedTo;
      const sub = locked
        ? AGENT_PICKER.locked
        : driver.state === 'ready'
          ? `${isSelected ? `${modelLabel(driver, model)} · ` : ''}${accountLabel(driver)}`
          : DRIVER_STATE_REASON[driver.state];
      return { id: driver.id, name: driver.name, sub, state: providerState(driver.state), ready, locked, selected: isSelected };
    });
}

export interface ModelRow {
  /** null = Agent 默认模型。 */
  model: string | null;
  label: string;
  sub: string | null;
}

const TIER_ORDER: ModelTier[] = ['balanced', 'max', 'fast'];

/**
 * 模型显示的定位（设计稿 model-agent-setup.js `modelChoices` 的 `tierOf`）：「推荐」只挂在 `recommendedDriverModel` 选中的那一个上，
 * 模型表里别的 `balanced` 不标；「最强」「最快」照模型表。设置页的默认模型下拉用同一条规则。
 */
export function modelTierOf(driver: Pick<DriverInfo, 'id' | 'models'>): (model: DriverModel) => ModelTier | null {
  const recommended = recommendedDriverModel(driver.id, driver.models)?.id ?? null;
  return (model) => (model.id === recommended ? 'balanced' : model.tier === 'balanced' ? null : (model.tier ?? null));
}

/**
 * 第二级的模型表（原型 `modelRows`）：「Agent 默认模型」打头；选中却不在列表里的模型也露出来；
 * 其余按定位排（推荐、最强、最快，再是没标的），副文案标定位和 Agent 自己的默认。
 */
export function modelRows(driver: DriverInfo, selected: string | null): ModelRow[] {
  const config = driver.configModel;
  const defaultSub =
    config && driver.configModelKnown === false
      ? `${AGENT_PICKER.agentDefaultSub} · ${AGENT_PICKER.configModelGate(config)}`
      : config
        ? `${AGENT_PICKER.agentDefaultSub} · ${modelLabel(driver, config)}`
        : AGENT_PICKER.agentDefaultSub;
  const rows: ModelRow[] = [{ model: null, label: AGENT_PICKER.agentDefault, sub: defaultSub }];
  if (selected !== null && !driver.models.some((m) => m.id === selected)) {
    rows.push({ model: selected, label: selected, sub: AGENT_PICKER.notListed });
  }
  // 次序按模型表自己的定位排；标签只给推荐的那一个挂「推荐」（`modelTierOf`）。
  const tierOf = modelTierOf(driver);
  const rank = (m: DriverModel) => (m.tier ? TIER_ORDER.indexOf(m.tier) : TIER_ORDER.length);
  const sorted = driver.models.map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i);
  for (const { m } of sorted) {
    const tier = tierOf(m);
    const sub = [tier ? MODEL_TIER_LABEL[tier] : null, m.isDefault ? AGENT_PICKER.defaultMark : null].filter(Boolean).join(' · ');
    rows.push({ model: m.id, label: m.label, sub: sub || null });
  }
  return rows;
}

/** 推理强度的中文：低、中、高；认不出的原样显示（原生标签，没有就是 id）。 */
export function effortLabel(id: string, nativeLabel?: string | null): string {
  return EFFORT_COPY[id]?.label ?? (nativeLabel || id);
}

export interface EffortRow {
  id: string;
  label: string;
  sub: string | null;
}

/** 这个模型的推理强度（原型 data.js `efforts` 的下拉）。模型自己的默认那一行标「默认」。空表 = 不分强度。 */
export function effortRows(model: DriverModel | undefined): EffortRow[] {
  if (!model) return [];
  return model.efforts.map((effort) => {
    const sub = [EFFORT_COPY[effort.id]?.sub ?? null, effort.id === model.defaultEffort ? AGENT_PICKER.defaultMark : null]
      .filter(Boolean)
      .join(' · ');
    return { id: effort.id, label: effortLabel(effort.id, effort.label), sub: sub || null };
  });
}

/** 当前生效的强度：选了的；没选时是模型自己的默认。 */
export function currentEffort(model: DriverModel | undefined, effort: string | null): string | null {
  return effort ?? model?.defaultEffort ?? null;
}
