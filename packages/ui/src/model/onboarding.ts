import {
  localizeText,
  type AgentSetupRun,
  type DriverId,
  type DriverInfo,
  type DriverInstallOption,
  type Id,
  type JobRecord,
  type ModelBundleStatus,
  type ModelCapability,
} from '@baocut/protocol';
import { agentProblem, groupDrivers, installPlan, loginCommandOf, type InstallChoice } from '../components/settings/agent-setup.ts';
import { installProgressView, latestBundleJob } from './models-install.ts';
import { bundleCategory, bundleName, hasOwnFiles, isBundleInstalled, sharedComponents } from './models-local.ts';
import { M as LOCAL } from './models-local-copy.ts';
import { M, type BackgroundKind } from './onboarding-copy.ts';
import { fmtSize } from './task-facts.ts';

/**
 * 首次启动引导的纯层（设计稿 designs/baocut/app/model-onboarding.js；产品设计 §7.6）：步骤表、要不要弹、落成什么记录、
 * Agent 每一行能不能勾与勾上意味着什么、每一步的候选与默认勾选、这次要下多少、主按钮怎么写、后台在跑的那一行。
 *
 * 第一次打开桌面应用时弹一次（从没有引导的旧版升级上来的也弹一次）。六步：连接 Agent → 语音识别 → 语音合成 → 语义搜索 →
 * 图像生成 → 音乐生成。每一步都是多选列表：Agent 勾上就启用或在后台安装，模型勾上就下载；模型每一步默认至少勾一只
 * （这一类已经装了或正在下的算勾上）。每一步都能跳过，「退出引导」与 Esc 随时退出；任何一种关掉都记下，以后不再弹。
 * Web 不弹：浏览器里不能安装本机模型与 Agent（`models.install*`、`agents.runSetup` 不在 Web 白名单里）。
 */

export const ONBOARDING_STEPS = ['agent', 'asr', 'tts', 'semantic', 'image', 'music'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
/** 列一类本机模型的那几步（语义搜索是一个包，Agent 一步列 Agent）。 */
export type ModelStep = Exclude<OnboardingStep, 'agent' | 'semantic'>;

export function isModelStep(step: OnboardingStep): step is ModelStep {
  return step !== 'agent' && step !== 'semantic';
}

export function isLastStep(step: OnboardingStep): boolean {
  return step === ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1];
}

// ---- 记录 ----

/**
 * 关掉引导时记下的（界面偏好，存在本机）：`done` 在最后一步点完成或跳过；其余（「退出引导」、Esc）都是 `skipped`。
 * `step` 是关掉时停在哪一步；`downloaded` 是这次引导里开始下载的模型包（本来就装好的不算）。
 */
export interface OnboardingRecord {
  state: 'done' | 'skipped';
  step: OnboardingStep;
  downloaded: string[];
}

export function onboardingRecord(how: 'done' | 'skipped', step: OnboardingStep, downloaded: readonly string[]): OnboardingRecord {
  return { state: how, step, downloaded: [...new Set(downloaded)] };
}

/** 有记录（走完或退出）就不再弹。 */
export function shouldShowOnboarding(record: OnboardingRecord | null): boolean {
  return record === null;
}

/** 本机存着的记录：认不出的当作没有。 */
export function parseOnboardingRecord(raw: unknown): OnboardingRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<OnboardingRecord>;
  if (r.state !== 'done' && r.state !== 'skipped') return null;
  const step = ONBOARDING_STEPS.includes(r.step as OnboardingStep) ? (r.step as OnboardingStep) : ONBOARDING_STEPS[0];
  const downloaded = Array.isArray(r.downloaded) ? r.downloaded.filter((id): id is string => typeof id === 'string') : [];
  return { state: r.state, step, downloaded };
}

// ---- 每一步的候选 ----

const STEP_CAPABILITY: Record<ModelStep, ModelCapability> = { asr: 'transcribe', tts: 'synthesize', image: 'image', music: 'music' };

/**
 * 每一步推荐的那只（排第一、带「推荐」），按模型族：
 * - 转录：所有平台的默认转写模型包都是 MOSS Transcribe（packages/models `defaultTranscribeBundle`），转录时自己区分说话人；
 * - 语音合成：CustomVoice 有 9 个预设音色，不用参考录音就能念，最容易上手；
 * - 图像生成：Turbo 是蒸馏版，比基础版快 2 倍多。
 */
export const RECOMMENDED_FAMILY: Partial<Record<ModelStep, string>> = {
  asr: 'moss-transcribe-diarize',
  tts: 'qwen3-tts-1.7b-customvoice',
  image: 'qwen-image-2.1-turbo',
};

/** 语音合成那一步只列三只：三种出声方式各一只（预设音色 / 克隆 / 多语言），都可商用；其余在设置里下。 */
export const TTS_HIGHLIGHTS: readonly string[] = ['qwen3-tts-1.7b-customvoice', 'qwen3-tts-0.6b-base', 'voxcpm2'];

/** 自己区分说话人的转写模型族（bundle-registry.ts：自带说话人）；其余转写要另装说话人区分模型包。 */
const SELF_DIARIZING: readonly string[] = ['moss-transcribe-diarize'];

/** 模型族：模型包 ID 里 `@` 前面那段（`qwen3-tts-0.6b-base@audio-cpp-q8` → `qwen3-tts-0.6b-base`）。 */
export function familyOf(bundleId: string): string {
  const at = bundleId.indexOf('@');
  return at < 0 ? bundleId : bundleId.slice(0, at);
}

/** 这台电脑跑得了（跑不了的、缺推理程序的不列）。 */
function runnable(bundle: Pick<ModelBundleStatus, 'reason'>): boolean {
  return bundle.reason !== 'unsupported' && bundle.reason !== 'worker-missing';
}

export interface ModelChoice {
  bundle: ModelBundleStatus;
  recommended: boolean;
  /** 候选下面那一句；没有时 null。 */
  note: string | null;
}

/**
 * 一步的候选：推荐的排第一，其余保持 Runtime 给的次序（Runtime 只列这台电脑上的模型包）；跑不了的不列。
 * 转录不含对齐、说话人区分这类辅助包。
 */
export function stepChoices(step: ModelStep, bundles: readonly ModelBundleStatus[]): ModelChoice[] {
  let list = bundles.filter((b) => b.capability === STEP_CAPABILITY[step] && runnable(b));
  if (step === 'tts') list = TTS_HIGHLIGHTS.flatMap((family) => list.filter((b) => familyOf(b.bundleId) === family));
  const rec = RECOMMENDED_FAMILY[step];
  const isRec = (b: ModelBundleStatus) => !!rec && familyOf(b.bundleId) === rec;
  const pack = bundles.find((b) => b.capability === 'diarize' && runnable(b));
  return [...list.filter(isRec), ...list.filter((b) => !isRec(b))].map((bundle) => ({
    bundle,
    recommended: isRec(bundle),
    note: noteOf(step, bundle, pack ? bundleName(pack) : null),
  }));
}

function noteOf(step: ModelStep, bundle: ModelBundleStatus, pack: string | null): string | null {
  const family = familyOf(bundle.bundleId);
  if (step !== 'asr') return M.familyNote[family] ?? null;
  if (SELF_DIARIZING.includes(family)) return M.diarizes;
  return pack ? M.needsDiarization(pack) : null;
}

/** 一张卡的状态：正在下（排队、下载、校验）、装好了（必需组件都在），或可以下（含下到一半停着的、缺组件的）。 */
export type CardState = 'installing' | 'installed' | 'available';

export function cardState(bundle: Pick<ModelBundleStatus, 'state' | 'components' | 'install'>): CardState {
  if (bundle.install && bundle.install.state !== 'paused') return 'installing';
  return isBundleInstalled(bundle) ? 'installed' : 'available';
}

/**
 * 可以下、但模型包自己的文件已经在盘上（下到一半停着、缺组件）：卡片右边写「缺组件」（同 设置 › 本机模型 的「补齐」）。
 * 只是公共组件被别的模型装上了的不算。
 */
export function isPartial(bundle: ModelBundleStatus, bundles: readonly ModelBundleStatus[]): boolean {
  if (cardState(bundle) !== 'available') return false;
  const category = bundleCategory(bundle);
  return hasOwnFiles(bundle, category ? sharedComponents(bundles, category) : []);
}

/** 正在下的那一只的百分比；不知道大小、排队、校验时 null。 */
export function installPercent(bundle: Pick<ModelBundleStatus, 'install'>): number | null {
  return bundle.install && bundle.install.state !== 'paused' ? installProgressView(bundle.install).percent : null;
}

/**
 * 打开这一步时默认勾哪几只（「默认至少选择一个模型」）：这一类已经有装好的或正在下的，它就显示成勾上的，不再替人多勾；
 * 一只都没有时勾推荐的那只，没有推荐的勾第一只。
 */
export function initialPicks(choices: readonly ModelChoice[]): string[] {
  if (!choices.length || choices.some((c) => cardState(c.bundle) !== 'available')) return [];
  return [(choices.find((c) => c.recommended) ?? choices[0]!).bundle.bundleId];
}

// ---- 要下多少 ----

export interface PlanPart {
  key: string;
  label: string;
  bytes: number | null;
}

export interface DownloadPlan {
  /** 要下的模型包（勾上、还没装好、也不在下的）。 */
  bundles: ModelBundleStatus[];
  /** 各自缺的部分：权重带上模型名，共用的组件只算一份。 */
  parts: PlanPart[];
  /** 合计字节；有不知道大小的部分时 null。 */
  bytes: number | null;
}

/**
 * 勾上的这几只要下什么（与下载确认框同一张清单：缺的组件，可选的也下）。已经装好或正在下的不算。
 * 确认框里 Runtime 会再按实际情况列一遍（续传、换来源），这里只用来写按钮上的大小。
 */
export function downloadPlan(bundles: readonly ModelBundleStatus[]): DownloadPlan {
  const want = bundles.filter((b) => cardState(b) === 'available');
  const seen = new Set<string>();
  const parts: PlanPart[] = [];
  for (const bundle of want) {
    if (!bundle.components?.length) {
      parts.push({ key: bundle.bundleId, label: bundleName(bundle), bytes: bundle.estimatedBytes ?? null });
      continue;
    }
    for (const c of bundle.components) {
      if (c.state !== 'missing') continue;
      const key = `${c.repo}@${c.revision}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push({ key, label: LOCAL.componentName[c.component] ?? bundleName(bundle), bytes: c.estimatedBytes ?? null });
    }
  }
  const bytes = parts.some((p) => p.bytes === null) ? null : parts.reduce((n, p) => n + (p.bytes ?? 0), 0);
  return { bundles: want, parts, bytes };
}

/** 卡片下面的一行：「一起下载：MOSS Transcribe 1.7 GB · Speaker embedding 26 MB」；什么都不缺时 null。 */
export function planLine(plan: Pick<DownloadPlan, 'parts'>): string | null {
  if (!plan.parts.length) return null;
  return M.planLine(plan.parts.map((p) => (p.bytes === null ? p.label : `${p.label} ${fmtSize(p.bytes)}`)).join(' · '));
}

/** 卡片右边的大小：还要下的（不知道大小时 null）。 */
export function planSize(plan: Pick<DownloadPlan, 'bytes'>): string | null {
  return plan.bytes === null ? null : fmtSize(plan.bytes);
}

// ---- 主按钮 ----

export interface Primary {
  /** `download` 先过下载确认框，`install` 在后台安装勾上的 Agent，`next` 往下走（最后一步是完成）。 */
  kind: 'download' | 'install' | 'next';
  label: string;
}

/** 模型那几步与语义搜索：有要下的就「后台下载 1.7 GB 并继续」（最后一步是「并完成」）；没有就往下走。 */
export function modelPrimary(step: OnboardingStep, plan: Pick<DownloadPlan, 'bundles' | 'bytes'>): Primary {
  const last = isLastStep(step);
  if (plan.bundles.length) return { kind: 'download', label: M.download(plan.bytes === null ? null : fmtSize(plan.bytes), last) };
  return { kind: 'next', label: last ? M.finish : M.next };
}

/** Agent 一步：勾了要装的就「后台安装 2 个并继续」，否则往下走。 */
export function agentPrimary(installs: number): Primary {
  return installs ? { kind: 'install', label: M.install(installs) } : { kind: 'next', label: M.next };
}

// ---- Agent 一步 ----

/**
 * - `use`：装好、能用或停用着——勾上就是在 BaoCut 里启用（设置里那个开关，改了立刻生效）；
 * - `fix`：装了但要先处理（没登录、版本过旧、跑不起来）——不给勾，写出问题，处理在设置里；
 * - `install`：没装、BaoCut 能在后台装（Homebrew、npm）——勾上 = 后台安装，装好后还要在终端里登录一次；
 * - `manual`：没装、只有官方脚本——BaoCut 不替你运行从网络下载的脚本，不给勾，安装说明在设置里。
 */
export type AgentRowKind = 'use' | 'fix' | 'install' | 'manual';

export interface AgentRow {
  driver: DriverInfo;
  kind: AgentRowKind;
  /** `install` 时用哪一种（方式表里第一种能在应用内运行的，同 设置 › Agent 提供方）。 */
  choice: InstallChoice | null;
}

/** 主列表（同 设置 › Agent 提供方）每家一行；用户添加的、还没检测到的不列（它们由 npx 现取现用，谈不上安装）。 */
export function agentRows(drivers: readonly DriverInfo[]): AgentRow[] {
  return groupDrivers(drivers)
    .main.filter((d) => !(d.source === 'custom' && d.state === 'not-installed'))
    .map((driver) => {
      if (driver.state === 'ready' || driver.state === 'disabled') return { driver, kind: 'use', choice: null };
      if (driver.state !== 'not-installed') return { driver, kind: 'fix', choice: null };
      const choice = installPlan(driver).choices.find((c) => c.runnable) ?? null;
      return { driver, kind: choice ? 'install' : 'manual', choice };
    });
}

/**
 * 一行下面那一句：装好的写版本与账号；要处理的写问题；没装的写用什么订阅，勾上后写这次怎么装、装好后怎么登录；
 * 正在装的写用什么装；这次引导里没装成的说一声。
 */
export function agentLine(row: AgentRow, state: { picked: boolean; running: boolean; failed: boolean }): string {
  const { driver, kind, choice } = row;
  const login = loginCommandOf(driver);
  if (state.running) return M.agentInstalling(choice?.label ?? driver.command, login);
  if (kind === 'use') {
    const account = localizeText(driver.account, driver.accountRef)?.split(' · ')[0];
    return [M.agentInstalled, driver.version ? `v${driver.version}` : null, account || null].filter(Boolean).join(' · ');
  }
  if (kind === 'fix') return M.agentFix(agentProblem(driver)?.title ?? driver.name);
  if (kind === 'manual') return M.agentManual;
  if (state.picked && choice) return M.agentWillInstall(choice.label, choice.command, login);
  if (state.failed) return M.agentInstallFailed;
  return M.agentNotInstalled(localizeText(driver.plan, driver.planRef) || null);
}

// ---- 后台在跑的那一行 ----

export type BackgroundStatus = 'running' | 'done' | 'error';

export interface BackgroundItem {
  name: string;
  /** 0–100；不知道时 null（Agent 安装没有进度）。 */
  pct: number | null;
  status: BackgroundStatus;
  /** 安装 Agent；其余是下载模型。 */
  agent: boolean;
}

/**
 * 这次引导里开始下载的一只走到哪了。确认之后到 Runtime 推来安装进度之间有一小段空档，那时它既没在装也没装好：
 * 看 `since` 之后有没有这只的安装任务，有任务结束了却没装好算没下成，还没有任务算在跑。
 */
export function bundleProgress(
  bundle: ModelBundleStatus | undefined,
  jobs: readonly JobRecord[],
  since: string,
): { status: BackgroundStatus; pct: number | null } {
  if (!bundle) return { status: 'error', pct: null };
  if (cardState(bundle) === 'installing') return { status: 'running', pct: installPercent(bundle) };
  if (isBundleInstalled(bundle)) return { status: 'done', pct: 100 };
  const job = latestBundleJob(jobs, bundle.bundleId, 'modelInstall');
  if (!job || job.createdAt < since || job.state === 'queued' || job.state === 'running') return { status: 'running', pct: null };
  return { status: job.state === 'completed' ? 'done' : 'error', pct: null };
}

/** 这次引导里开始的 Agent 安装走到哪了（还没收到这次运行时算在跑）。 */
export function setupProgress(run: Pick<AgentSetupRun, 'state'> | undefined): BackgroundStatus {
  if (!run || run.state === 'running') return 'running';
  return run.state === 'completed' ? 'done' : 'error';
}

/**
 * 引导里勾上要装的一家 Agent（OnboardingHost 排队，一家装完再装下一家：Homebrew 同一时间只能跑一个）。
 * `runId` 是开始运行后 Runtime 给的；`failed` 是没能开始运行（请求被拒）。
 */
export interface AgentInstallJob {
  driverId: DriverId;
  name: string;
  kind: DriverInstallOption['kind'];
  runId: Id | null;
  failed: boolean;
}

/** 排着队的一家走到哪了：还没轮到、正在装都算在跑。 */
export function agentJobStatus(job: AgentInstallJob, runs: readonly Pick<AgentSetupRun, 'runId' | 'state'>[]): BackgroundStatus {
  if (job.failed) return 'error';
  return job.runId ? setupProgress(runs.find((r) => r.runId === job.runId)) : 'running';
}

/** 几件合成一件（语义搜索一个包）：有在跑的算在跑，有没成的算没成。 */
export function combineStatus(statuses: readonly BackgroundStatus[]): BackgroundStatus {
  if (statuses.includes('running')) return 'running';
  return statuses.includes('error') ? 'error' : 'done';
}

function kindOf(items: readonly BackgroundItem[]): BackgroundKind {
  const agents = items.filter((x) => x.agent).length;
  return agents === items.length ? 'install' : agents ? 'mixed' : 'download';
}

/**
 * 对话框底部那一行（和按钮挤一排，要短）：只有一件在跑时写名字与百分比，几件同时在跑只写个数（各自的进度在后台任务里），
 * 跑完的、没成的只计数。用词跟着那几件走：全是 Agent 写「安装」，全是模型写「下载」。一件都没有时 null。
 */
export function bgLine(items: readonly BackgroundItem[]): string | null {
  if (!items.length) return null;
  const live = items.filter((x) => x.status === 'running');
  const failed = items.filter((x) => x.status === 'error');
  const done = items.filter((x) => x.status === 'done');
  const head =
    live.length === 1
      ? M.bg.one(kindOf(live), live[0]!.name, live[0]!.pct === null ? null : Math.round(live[0]!.pct))
      : live.length
        ? M.bg.many(kindOf(live), live.length)
        : M.bg.idle(kindOf(items));
  return [head, ...(done.length ? [M.bg.done(kindOf(done), done.length)] : []), ...(failed.length ? [M.bg.failed(kindOf(failed), failed.length)] : [])].join(' · ');
}
