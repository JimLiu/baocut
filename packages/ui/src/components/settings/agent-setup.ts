import { live, localizeText, type AgentSetupRun, type DriverInfo, type DriverInstallOption, type DriverState, type ModelTier } from '@baocut/protocol';
import { customLoginCommand, MORE_BUILTIN_IDS } from '../../model/agent-catalog.ts';
import { effectiveDefaultModel, modelTierOf } from '../../model/agent-choice.ts';
import { M } from './agent-setup-copy.ts';

/**
 * 设置 › Agent 提供方的纯层（设计稿 designs/baocut/app/model-agent-setup.js）：一个 Agent 现在处于什么状态、
 * 该给用户看哪句话和哪颗按钮、排查清单怎么列、默认模型与强度有哪些选项、装与升级给哪条命令。视图只组合，不在 JSX 里判断。
 *
 * 状态本身由 Runtime 按设计稿的优先级算好（`DriverState`：没装 > 出错 > 版本太旧 > 没登录 > 已停用 > 可用），
 * 这里只把它翻成标签、色调与修法，不重算。
 */

export type AgentTone = 'positive' | 'notice' | 'negative' | 'neutral';

/** 设计稿的状态优先级（model-agent-setup.js:13），从最需要处理的到可用。 */
export const STATE_PRIORITY: readonly DriverState[] = ['not-installed', 'error', 'outdated', 'signed-out', 'disabled', 'ready'];

/** 版本号逐段按数字比：`2.1.284` < `2.2.0`；非数字的段（`-rc.2`）按 parseInt 截断。 */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const pa = String(a || '0').split('.');
  const pb = String(b || '0').split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (Number.parseInt(pa[i] ?? '', 10) || 0) - (Number.parseInt(pb[i] ?? '', 10) || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

type Probe = Pick<DriverInfo, 'state' | 'version' | 'latestVersion'>;

/** 装着、知道上游最新版本、而且比本机新。有新版本不是问题，只换一个状态词。 */
export function hasUpdate(driver: Probe): boolean {
  return driver.state !== 'not-installed' && !!driver.version && !!driver.latestVersion && compareVersions(driver.version, driver.latestVersion) < 0;
}

/** 装着却用不了（出错、版本太旧、没登录）：启用开关置灰，新会话跳过它。 */
export function isBlocked(driver: Pick<DriverInfo, 'state'>): boolean {
  return driver.state === 'error' || driver.state === 'outdated' || driver.state === 'signed-out';
}

export function isInstalled(driver: Pick<DriverInfo, 'state'>): boolean {
  return driver.state !== 'not-installed';
}

/**
 * CLI 能用，但它配置里的默认模型这一版不认得（`configModelKnown === false`，model-agent-setup.js:55-58）。
 * 不挡发送，只有选了「Agent 默认模型」的会话会撞上，所以单独一条提示。`latest`：确实有更新的版本时才给。
 */
export function configModelGate(
  driver: Pick<DriverInfo, 'state' | 'version' | 'latestVersion' | 'configModel' | 'configModelKnown'>,
): { model: string; version: string | null; latest: string | null } | null {
  if (driver.state !== 'ready' || !driver.configModel || driver.configModelKnown !== false) return null;
  return { model: driver.configModel, version: driver.version, latest: hasUpdate(driver) ? driver.latestVersion : null };
}

const BADGE_TONE: Record<Exclude<DriverState, 'ready'>, AgentTone> = {
  'not-installed': 'neutral',
  error: 'negative',
  outdated: 'negative',
  'signed-out': 'notice',
  disabled: 'neutral',
};

/**
 * 卡头那枚状态词（model-agent-setup.js:73-85）。默认模型要更新的 CLI 优先于「有新版本」。
 * 用户添加的没检测到时说「还没检测」：npx 现取现用的谈不上「安装」（产品设计 §7.6）。
 */
export function agentBadge(driver: Parameters<typeof configModelGate>[0] & Partial<Pick<DriverInfo, 'source'>>): {
  label: string;
  tone: AgentTone;
} {
  if (driver.state === 'not-installed' && driver.source === 'custom') return { label: M.badgeNotChecked, tone: 'neutral' };
  if (driver.state !== 'ready') return { label: M.badge[driver.state], tone: BADGE_TONE[driver.state] };
  if (configModelGate(driver)) return { label: hasUpdate(driver) ? M.badgeModelUpgrade : M.badgeModelUnavailable, tone: 'notice' };
  return hasUpdate(driver) ? { label: M.badgeUpdate, tone: 'notice' } : { label: M.badgeReady, tone: 'positive' };
}

/**
 * 在终端里登录的命令；Driver 没给就直接起 CLI，它没登录时自己会引导（model-agent-setup.js:340-343）。
 * 用户添加的、由 npx / uvx 现取现用的起它自己的包（不带 ACP 的参数）。
 */
export function loginCommandOf(driver: Pick<DriverInfo, 'loginCommand' | 'command'> & Partial<Pick<DriverInfo, 'custom'>>): string {
  if (driver.loginCommand) return driver.loginCommand;
  return driver.custom ? customLoginCommand(driver.custom.command) || driver.command : driver.command;
}

/**
 * 问题条的修法（model-agent-setup.js:88-94）：`diagnose` 重新检测并列出排查清单；`upgrade` 展开详情，
 * 升级命令能在应用内运行（brew、npm）时直接弹出运行确认，否则露出命令给用户复制；`login` 打开系统终端运行登录命令。
 */
export type ProblemAction = 'diagnose' | 'upgrade' | 'login';

export interface AgentProblem {
  kind: 'error' | 'outdated' | 'signed-out';
  tone: 'negative' | 'notice';
  title: string;
  body: string;
  action: ProblemAction;
  cta: string;
}

/** 卡头下面那条问题说明：一句发生了什么、一句怎么办、一颗主按钮（model-agent-setup.js:88-94）。没问题返回 null。 */
export function agentProblem(
  driver: Pick<DriverInfo, 'state' | 'name' | 'version' | 'minVersion' | 'latestVersion' | 'detail' | 'detailRef' | 'loginCommand' | 'command'>,
): AgentProblem | null {
  const { name } = driver;
  const detail = localizeText(driver.detail, driver.detailRef);
  if (driver.state === 'error') {
    return {
      kind: 'error',
      tone: 'negative',
      title: M.errorTitle(name),
      body: M.errorBody(detail || null),
      action: 'diagnose',
      cta: M.errorCta,
    };
  }
  if (driver.state === 'outdated') {
    return {
      kind: 'outdated',
      tone: 'negative',
      title: M.outdatedTitle(name, driver.version || null),
      // Driver 给了说明就用它（OpenCode 1.x 换了发行包、要改装 @opencode/cli，探测结果里没有单独的字段，只在 detail 里说）。
      body: M.outdatedBody(detail ? detail.trim() : null, driver.minVersion),
      action: 'upgrade',
      cta: M.outdatedCta(driver.latestVersion || driver.minVersion),
    };
  }
  if (driver.state === 'signed-out') {
    return {
      kind: 'signed-out',
      tone: 'notice',
      title: M.signedOutTitle(name),
      body: M.signedOutBody(name),
      action: 'login',
      cta: M.signedOutCta,
    };
  }
  return null;
}

// ---- 排查清单 ----

export type DiagnosisStepKey = 'find' | 'run' | 'version' | 'login' | 'models';

export interface DiagnosisStep {
  key: DiagnosisStepKey;
  label: string;
  state: 'ok' | 'fail' | 'skip';
  detail: string;
}

/**
 * 五步按依赖顺序排（model-agent-setup.js:96-117）：前一步不过，后面的没法测，标 skip 而不是 fail——
 * 用户只需要看第一条红的。全部来自探测结果，不另外跑命令。
 */
export function diagnose(
  driver: Pick<DriverInfo, 'state' | 'command' | 'executable' | 'version' | 'minVersion' | 'detail' | 'detailRef' | 'account' | 'accountRef' | 'models'>,
): DiagnosisStep[] {
  const found = driver.state !== 'not-installed';
  const runs = found && driver.state !== 'error';
  const versionOk = runs && driver.state !== 'outdated';
  const loggedIn = versionOk && driver.state !== 'signed-out';
  const step = (key: DiagnosisStepKey, label: string, pass: boolean, reachable: boolean, ok: string, fail: string): DiagnosisStep => ({
    key,
    label,
    state: !reachable ? 'skip' : pass ? 'ok' : 'fail',
    detail: !reachable ? M.stepSkipped : pass ? ok : fail,
  });
  const models = driver.models.length;
  return [
    step('find', M.stepFind, found, true, driver.executable ?? driver.command, M.stepFindFail(driver.command)),
    step('run', M.stepRun, runs, found, M.stepRunOk(driver.command, driver.version ?? '—'), localizeText(driver.detail, driver.detailRef) ?? M.stepRunFail),
    step(
      'version',
      M.stepVersion,
      versionOk,
      runs,
      M.stepVersionOk(driver.version ?? '—', driver.minVersion),
      M.stepVersionFail(driver.version ?? '—', driver.minVersion),
    ),
    step('login', M.stepLogin, loggedIn, versionOk, localizeText(driver.account, driver.accountRef) ?? M.stepLoginOk, M.stepLoginFail),
    step('models', M.stepModels, loggedIn, loggedIn, models ? M.stepModelsOk(models) : M.stepModelsNone, ''),
  ];
}

/** 排查结果一句话：全过，或卡在哪一步。 */
export function diagnosisVerdict(steps: readonly DiagnosisStep[]): { ok: boolean; text: string } {
  const bad = steps.find((s) => s.state === 'fail');
  return bad ? { ok: false, text: M.verdictFail(bad.label, bad.detail) } : { ok: true, text: M.verdictOk };
}

// ---- 页顶状态卡与卡片次序 ----

/** 装了的在前，其余保持 Runtime 给的次序（`DRIVER_IDS` 的顺序，model-agent-setup.js:358-368）。 */
export function orderDrivers<T extends Pick<DriverInfo, 'state'>>(drivers: readonly T[]): T[] {
  return [...drivers.filter(isInstalled), ...drivers.filter((d) => !isInstalled(d))];
}

export interface DriverGroups<T> {
  /** 主列表：检测到的（在前）、常驻的内置几家里没装的、用户添加的（没检测到也不折叠）。 */
  main: T[];
  /** 「更多」折叠段：收进「更多」的四家里没检测到的。装上任何一家它就自己挪进主列表。 */
  more: T[];
  /** 内置的家数与用户添加的家数。 */
  builtin: number;
  added: number;
  /** 检测到的家数。 */
  found: number;
}

/** 完整 Agent 表的分组（model-agent-setup.js `groups`，产品设计 §7.6）。次序保持 Runtime 给的。 */
export function groupDrivers<T extends Pick<DriverInfo, 'id' | 'state' | 'source'>>(drivers: readonly T[]): DriverGroups<T> {
  const found = drivers.filter(isInstalled);
  const missing = drivers.filter((d) => !isInstalled(d));
  const folded = (d: T) => d.source !== 'custom' && MORE_BUILTIN_IDS.includes(d.id);
  return {
    main: [...found, ...missing.filter((d) => d.source !== 'custom' && !folded(d)), ...missing.filter((d) => d.source === 'custom')],
    more: missing.filter(folded),
    builtin: drivers.filter((d) => d.source !== 'custom').length,
    added: drivers.filter((d) => d.source === 'custom').length,
    found: found.length,
  };
}

/** 「更多」折叠段标题里点名的前三家。 */
export function moreSummary(more: readonly Pick<DriverInfo, 'name'>[]): string {
  return M.moreSummary(
    more.slice(0, 3).map((d) => d.name),
    more.length > 3,
  );
}

export interface AgentOverview {
  state: 'ready' | 'attention' | 'off' | 'missing';
  /** 这句话说的是哪一个 Agent；没检测到任何 Agent 时为 null。 */
  driverId: DriverInfo['id'] | null;
  title: string;
  body: string;
  /** `start` 去新会话，`enable` 启用它，`open` 展开那一张卡。 */
  action: 'start' | 'enable' | 'open' | null;
  cta: string | null;
}

/** 新会话默认用哪个模型的说法：指定了的用模型名，没指定是「Agent 默认模型」。 */
export function defaultModelLabel(driver: Pick<DriverInfo, 'id' | 'models' | 'defaultModel'>): string {
  // 新会话实际用的模型：偏好里的模型消失了就说推荐模型（见 `effectiveDefaultModel`）。
  const model = effectiveDefaultModel(driver);
  if (!model) return M.agentDefaultModel;
  return driver.models.find((m) => m.id === model)?.label ?? model;
}

/** 页顶状态卡（model-agent-setup.js:346-356）：有能用的就说准备好了；否则先说出问题的那一家，再说停用的，最后才是都没装。 */
export function agentOverview(drivers: readonly DriverInfo[]): AgentOverview {
  const list = orderDrivers(drivers);
  const usable = list.filter((d) => d.state === 'ready');
  const current = usable.find((d) => d.isDefault) ?? usable[0];
  if (current) {
    return {
      state: 'ready',
      driverId: current.id,
      title: M.readyTitle,
      body: M.readyBody(current.name, defaultModelLabel(current), localizeText(current.plan, current.planRef)),
      action: 'start',
      cta: M.readyCta,
    };
  }
  const bad = list.find(isBlocked);
  const problem = bad ? agentProblem(bad) : null;
  if (bad && problem) {
    return {
      state: 'attention',
      driverId: bad.id,
      title: problem.title,
      body: M.attentionBody(bad.name),
      action: 'open',
      cta: M.attentionCta,
    };
  }
  const off = list.find((d) => d.state === 'disabled');
  if (off) {
    return {
      state: 'off',
      driverId: off.id,
      title: M.offTitle(off.name),
      body: M.offBody,
      action: 'enable',
      cta: M.offCta(off.name),
    };
  }
  return {
    state: 'missing',
    driverId: null,
    title: M.missingTitle,
    body: list.length > 1 ? M.missingBodyMany : M.missingBodyOne,
    action: null,
    cta: null,
  };
}

// ---- 安装与升级 ----

type InstallKind = DriverInstallOption['kind'];

const norm = (raw: string | null | undefined) => String(raw ?? '').replace(/\\/g, '/').toLowerCase();

/**
 * 已装那一份归谁管：看**真实位置**（链接解析到底），不看链接本身（model-agent-setup.js:169-223 的简化版）。
 * 只认得出 Driver 给得出命令的三种（官方脚本、Homebrew、npm）；版本管理器的 shim、bun / pnpm / yarn / volta
 * 装的认不出就是 null，让用户自己选——给一条升不到这一份的命令只会再装一份。
 */
export function installKindOf(executable: string | null, realExecutable: string | null): InstallKind | null {
  const link = norm(executable);
  const real = norm(realExecutable ?? executable);
  if (!link && !real) return null;
  const any = (needles: string[]) => needles.some((n) => link.includes(n) || real.includes(n));
  if (['/mise/shims/', '/.asdf/shims/', '/.nodenv/shims/'].some((n) => link.includes(n))) return null;
  if (any(['/.volta/', '/.bun/', '/.pnpm/', '/pnpm/global/', '/library/pnpm/', '/.local/share/pnpm/', '/.yarn/', '/.config/yarn/', '/yarn/data/global/'])) {
    return null;
  }
  if (real.includes('/cellar/') || real.includes('/caskroom/')) return 'brew';
  if (real.includes('/lib/node_modules/') || (/^[a-z]:\//.test(real) && real.includes('/node_modules/'))) return 'npm';
  if (link.includes('/.nvm/') || link.includes('/fnm/')) return 'npm';
  if (['/.local/share/claude/', '/.claude/'].some((n) => real.includes(n)) || link.includes('/.local/bin/')) return 'script';
  return null;
}

export interface InstallChoice {
  kind: InstallKind;
  label: string;
  /** 前提，例如 Homebrew、Node.js。 */
  needs: string | null;
  /** 原样展示的命令：没装时是安装命令，装了是升级命令。 */
  command: string;
  /** 从网络下载脚本再交给 shell 运行（`curl … | bash`）：提醒用户复制后自己运行。 */
  downloadsScript: boolean;
  /**
   * 能在设置页里直接运行（▶，`agents.runSetup`）：只有 brew、npm 这类。官方脚本类（`script`）一律不行，
   * 连它的 `claude update` 也只给复制——Runtime 按类别拒绝，这里与它一致（设计稿 `S.runnable` 只看 `| bash`）。
   */
  runnable: boolean;
}

export interface InstallPlan {
  /** 装了就是升级。 */
  upgrading: boolean;
  choices: InstallChoice[];
  /** 从可执行文件的真实位置认出来的安装方式（只在升级、且方式表里有它时给）。 */
  detected: InstallKind | null;
  /** 分段起手选哪一种：认出来的那一种，否则第一种。 */
  initial: InstallKind | null;
}

/** 安装或升级这一段给哪些命令（model-agent-setup.js:260-278）：命令一律用 Driver 给的原文，不推导新命令。 */
export function installPlan(driver: Pick<DriverInfo, 'state' | 'install' | 'executable' | 'realExecutable'>): InstallPlan {
  const upgrading = isInstalled(driver);
  const choices = driver.install.map((option) => {
    const command = upgrading ? option.upgrade : option.command;
    const downloadsScript = /\|\s*(ba|z)?sh\b/.test(command);
    return {
      kind: option.kind,
      label: localizeText(option.label, option.labelRef),
      needs: localizeText(option.needs, option.needsRef) ?? null,
      command,
      downloadsScript,
      runnable: option.kind !== 'script' && !downloadsScript,
    };
  });
  const kind = upgrading ? installKindOf(driver.executable, driver.realExecutable) : null;
  const detected = kind && choices.some((c) => c.kind === kind) ? kind : null;
  return { upgrading, choices, detected, initial: detected ?? choices[0]?.kind ?? null };
}

// ---- 应用内运行（agents.runSetup） ----

/** 这个 Agent 最近的一次运行（快照与事件都是新的在前）。 */
export function latestSetupRun(runs: readonly AgentSetupRun[], driverId: DriverInfo['id']): AgentSetupRun | null {
  return runs.find((run) => run.driverId === driverId) ?? null;
}

/** 日志框的内容：第一行是 `$ 命令`（设计稿 useCmdRun），之后是输出；更早的行被丢掉时先说一句。 */
export function setupLog(run: Pick<AgentSetupRun, 'command' | 'output' | 'droppedLines'>): string {
  const head = [`$ ${run.command}`];
  if (run.droppedLines) head.push(M.logDropped(run.droppedLines));
  return [...head, ...run.output].join('\n');
}

/**
 * 运行成功、重新探测之后的那句 toast（settings-agent-provider.jsx:126-139）。失败与停止不弹（结果留在日志框里）。
 * 装好了但还是没检测到（例如装进了不在 PATH 上的目录）时，提示去手动指定位置。
 */
export function setupDoneToast(
  run: Pick<AgentSetupRun, 'action' | 'state'>,
  driver: Pick<DriverInfo, 'name' | 'state' | 'version'>,
): { tone: 'positive' | 'neutral'; text: string } | null {
  if (run.state !== 'completed') return null;
  if (driver.state === 'not-installed') return { tone: 'neutral', text: M.doneNotDetected(driver.name) };
  const version = driver.version ?? '';
  if (run.action === 'install') {
    return { tone: 'positive', text: driver.state === 'signed-out' ? M.doneSignIn(driver.name, version) : M.doneInstalled(driver.name, version) };
  }
  return { tone: 'positive', text: M.doneUpgraded(driver.name, version) };
}

// ---- 默认模型与强度 ----

/** Picker 的键必须是字符串：「Agent 默认模型」（不传模型）与「模型默认强度」各用一个不会撞上原生 id 的哨兵。 */
export const AGENT_DEFAULT_MODEL_KEY = '__agent-default__';
export const MODEL_DEFAULT_EFFORT_KEY = '__model-default__';

/** 模型的定位（model-agent-setup.js:122-126）。 */
export const TIER_COPY: Record<ModelTier, { label: string; description: string }> = live(() => M.tier);

export interface ModelChoice {
  key: string;
  /** 交给 `agents.configure` 的 `defaultModel`；null = Agent 默认模型。 */
  model: string | null;
  label: string;
  tag: string | null;
  description: string | null;
  /** 偏好里的模型已经不在模型表里：原样露出、注明新会话改用推荐模型，不能再选。 */
  missing: boolean;
}

/**
 * 默认模型下拉：「Agent 默认模型」打头，再是模型表（与会话里的模型菜单同一个次序，设计稿 model-agent.js:712-724）；
 * 偏好里的模型从模型表里消失了也要原样露出来。模型表为空时只有「Agent 默认模型」一项。
 * 「推荐」只标推荐的那一个（设计稿 model-agent-setup.js `modelChoices`，见 `modelTierOf`）。
 */
export function modelChoices(
  driver: Pick<DriverInfo, 'id' | 'state' | 'version' | 'latestVersion' | 'models' | 'defaultModel' | 'configModel' | 'configModelKnown'>,
): ModelChoice[] {
  const gate = configModelGate(driver);
  const rows: ModelChoice[] = [
    {
      key: AGENT_DEFAULT_MODEL_KEY,
      model: null,
      label: M.agentDefaultModel,
      tag: null,
      description: gate ? M.cliConfigGate(gate.model) : driver.configModel ? M.cliConfigModel(driver.configModel) : M.cliConfig,
      missing: false,
    },
  ];
  if (driver.defaultModel && !driver.models.some((m) => m.id === driver.defaultModel)) {
    rows.push({ key: driver.defaultModel, model: driver.defaultModel, label: driver.defaultModel, tag: null, description: M.modelMissing, missing: true });
  }
  const tierOf = modelTierOf(driver);
  for (const m of driver.models) {
    const tierId = tierOf(m);
    const tier = tierId ? TIER_COPY[tierId] : null;
    rows.push({ key: m.id, model: m.id, label: m.label, tag: tier?.label ?? null, description: m.description ?? tier?.description ?? null, missing: false });
  }
  return rows;
}

/** 选中的是新会话实际会用的模型：偏好里的模型消失了就是推荐模型，不选那条停用的「已不在模型表里」。 */
export function selectedModelKey(driver: Pick<DriverInfo, 'id' | 'models' | 'defaultModel'>): string {
  return effectiveDefaultModel(driver) ?? AGENT_DEFAULT_MODEL_KEY;
}

/** 推理强度的名字；认不得的 id 用 Driver 给的标签。 */
export const EFFORT_LABEL: Record<string, string> = live(() => M.effort);

export function effortLabel(effort: { id: string; label: string }): string {
  return EFFORT_LABEL[effort.id] ?? effort.label;
}

export interface EffortChoice {
  key: string;
  effort: string | null;
  label: string;
  missing: boolean;
}

/**
 * 默认强度下拉。只有指定了模型、而且这个模型分强度时才有；否则返回 null，界面不显示这一项
 * （Agent 默认模型由 CLI 自己决定强度）。
 */
export function effortChoices(driver: Pick<DriverInfo, 'id' | 'models' | 'defaultModel' | 'defaultEffort'>): EffortChoice[] | null {
  const current = effectiveDefaultModel(driver);
  const model = driver.models.find((m) => m.id === current);
  if (!model || model.efforts.length === 0) return null;
  const fallback = model.efforts.find((e) => e.id === model.defaultEffort);
  const rows: EffortChoice[] = [
    { key: MODEL_DEFAULT_EFFORT_KEY, effort: null, label: fallback ? M.modelDefaultEffortOf(effortLabel(fallback)) : M.modelDefaultEffort, missing: false },
  ];
  if (driver.defaultEffort && !model.efforts.some((e) => e.id === driver.defaultEffort)) {
    rows.push({ key: driver.defaultEffort, effort: driver.defaultEffort, label: driver.defaultEffort, missing: true });
  }
  for (const e of model.efforts) rows.push({ key: e.id, effort: e.id, label: effortLabel(e), missing: false });
  return rows;
}

export function selectedEffortKey(driver: Pick<DriverInfo, 'defaultEffort'>): string {
  return driver.defaultEffort ?? MODEL_DEFAULT_EFFORT_KEY;
}

// ---- 「总是允许」的规则 ----

export interface RulesView {
  /** 去重、去掉空串，保持添加顺序；移除时原样交回 `agents.removeRule`。 */
  rules: string[];
  title: string;
  body: string;
}

/** 规则列表（page-settings-agent.jsx:162-166）。 */
export function rulesView(rules: readonly string[] | null | undefined): RulesView {
  const list = [...new Set((rules ?? []).filter((r) => r.length > 0))];
  return {
    rules: list,
    title: M.rulesTitle(list.length),
    body: list.length ? M.rulesBody : M.rulesEmpty,
  };
}

// ---- 高级 › 技术信息 ----

/** 「复制诊断信息」的文本：每个 Agent 一行，状态、版本与路径（page-settings-agent.jsx:174-176）。 */
export function diagnosticsText(drivers: readonly Pick<DriverInfo, 'name' | 'state' | 'version' | 'executable' | 'realExecutable'>[]): string {
  return drivers
    .map((d) => {
      const parts = [`${d.name}: ${d.state}`];
      if (d.version) parts.push(`v${d.version}`);
      if (d.executable) parts.push(d.executable);
      if (d.realExecutable && d.realExecutable !== d.executable) parts.push(`→ ${d.realExecutable}`);
      return parts.join(' ');
    })
    .join('\n');
}
