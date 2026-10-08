import { useEffect, useRef, useState, type ReactNode } from 'react';
import { localizeText, type AgentSetupAction, type DriverInfo, type DriverInstallOption } from '@baocut/protocol';
import {
  ActionButton,
  AlertDialog,
  Badge,
  Button,
  DialogContainer,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
  Picker,
  PickerItem,
  SegmentedControl,
  SegmentedControlItem,
  Switch,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import CheckmarkCircle from '@react-spectrum/s2/icons/CheckmarkCircle';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronUp from '@react-spectrum/s2/icons/ChevronUp';
import Clock from '@react-spectrum/s2/icons/Clock';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import OpenIn from '@react-spectrum/s2/icons/OpenIn';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { ACP_CATALOG } from '../../model/acp-catalog.ts';
import { isCustomDriver, launcherOf, launchLine, type Launcher } from '../../model/agent-catalog.ts';
import {
  cancelAgentSetup,
  configureAgent,
  detectAgents,
  openAgentTerminal,
  removeAgentProvider,
  runAgentSetup,
  setDefaultAgent,
} from '../../runtime/agent-commands.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useAgentSetup } from '../../state/agent-setup-store.ts';
import { AgentProviderIcon } from '../agent-provider-icon.tsx';
import { CommandBlock, ExecutableField, RunCommandDialog, copyText, type CommandRunner } from './agent-command-block.tsx';
import { SettingRow } from './agent-panels.tsx';
import { CodexImageRow } from './codex-image-row.tsx';
import { CARD_COPY } from './agent-card-copy.ts';
import { AGENT_COPY, ADDED_COPY, UNTESTED } from './agent-copy.ts';
import {
  agentBadge,
  agentProblem,
  configModelGate,
  diagnose,
  diagnosisVerdict,
  effortChoices,
  hasUpdate,
  installPlan,
  isBlocked,
  isInstalled,
  latestSetupRun,
  loginCommandOf,
  modelChoices,
  selectedEffortKey,
  selectedModelKey,
  type InstallChoice,
  type InstallPlan,
  type ProblemAction,
} from './agent-setup.ts';

// 卡片在提供方列表那张无内边距的卡里一张接一张，之间一条分隔线（settings-agent.css .agset-provider）。
const card = style({
  borderTopWidth: { default: 1, ':first-child': 0 },
  borderXWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const head = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: 20 });
const avatar = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  size: 40,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', isReady: 'green-200' },
  backgroundColor: { default: 'transparent', isReady: 'green-100' },
  // 头像里是 Agent 自己的图标（AgentProviderIcon）：「能用」只由底色和边框表示，单色图标不跟着染绿（原型 .agset-avatar.is-ready）。
  color: 'gray-700',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const headText = style({ flexGrow: 1, flexBasis: 0, minWidth: 200 });
const nameRow = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 });
const name = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const sub = style({ marginTop: 4, marginBottom: 0, font: 'ui-sm', color: 'gray-600', overflowWrap: 'anywhere' });
const headControls = style({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginStart: 'auto' });
// 问题条、配置模型提示、新版本提示：通栏贴在卡头下面，上面一条分隔线（.agp-problem / .agp-update）。
const problemStrip = style({
  display: 'flex',
  alignItems: 'start',
  flexWrap: 'wrap',
  gap: 12,
  paddingX: 20,
  paddingY: 12,
  borderTopWidth: 1,
  borderXWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: { default: 'orange-100', isNegative: 'red-100' },
});
const problemIcon = style({
  display: 'flex',
  flexShrink: 0,
  marginTop: 2,
  color: { default: 'orange-1000', isNegative: 'red-1000' },
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const problemText = style({ flexGrow: 1, flexBasis: 0, minWidth: 200 });
const problemTitle = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-900' });
const problemBody = style({ marginTop: 4, marginBottom: 0, font: 'ui-sm', color: 'gray-800', overflowWrap: 'anywhere' });
const problemAction = style({ flexShrink: 0, alignSelf: 'center' });
const strip = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 16,
  paddingX: 20,
  paddingY: 12,
  borderTopWidth: 1,
  borderXWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: 'gray-50',
  font: 'ui-sm',
  color: 'gray-800',
});
const stripText = style({ flexGrow: 1, flexBasis: 0, minWidth: 200 });
const detail = style({
  padding: 20,
  borderTopWidth: 1,
  borderXWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: 'gray-50',
  minWidth: 0,
});
const stack = style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 });
const hint = style({ margin: 0, font: 'ui-sm', color: 'gray-600' });
const steps = style({ display: 'flex', flexDirection: 'column', gap: 16, marginY: 12, paddingStart: 20, font: 'ui-sm', color: 'gray-700' });
const stepTitle = style({ display: 'block', font: 'ui', fontWeight: 'medium', color: 'gray-900', marginBottom: 4 });
const note = style({ marginY: 12, font: 'ui-sm', color: 'gray-700' });
const codeInline = style({ font: 'code-sm', color: 'gray-900', userSelect: 'text' });
const diag = style({
  marginTop: 20,
  paddingTop: 16,
  borderTopWidth: 1,
  borderXWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const checks = style({ display: 'flex', flexDirection: 'column', gap: 8, marginY: 0, paddingStart: 0, listStyleType: 'none' });
const check = style({ display: 'flex', alignItems: 'start', gap: 8, font: 'ui-sm', color: 'gray-700' });
const checkIcon = style({ flexShrink: 0, color: { default: 'gray-500', isOk: 'positive-900', isFail: 'negative-900' } });
const checkLabel = style({ font: 'ui-sm', fontWeight: 'medium', color: 'gray-900' });
const checkDetail = style({ margin: 0, overflowWrap: 'anywhere', userSelect: 'text' });
const verdict = style({ marginTop: 12, marginBottom: 0, font: 'ui-sm', fontWeight: 'medium', color: { default: 'negative-900', isOk: 'positive-900' } });
const pickers = style({ display: 'flex', flexWrap: 'wrap', gap: 8 });
// 详情顶上的说明条（.agp-note）：图标加一段话；`isNotice` 是要留意的那种（只能完全访问）。
const noteBox = style({
  display: 'flex',
  alignItems: 'start',
  gap: 8,
  marginBottom: 12,
  padding: 12,
  borderRadius: 'default',
  backgroundColor: { default: 'gray-100', isNotice: 'orange-100' },
  font: 'ui-sm',
  color: 'gray-800',
});
const noteIcon = style({
  display: 'flex',
  flexShrink: 0,
  marginTop: 2,
  color: { default: 'gray-700', isNotice: 'orange-1000' },
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const docsLink = style({ marginTop: 8 });

const TONE_BADGE = { positive: 'positive', notice: 'notice', negative: 'negative', neutral: 'neutral' } as const;

/**
 * 一家 Agent（设计稿 settings-agent-provider.jsx）：一行回答装没装、能不能用、开没开；有问题时问题条直接露在行下面。
 * 展开后是日常会动的几样：默认模型、版本与升级、账号、安装位置、排查。没装时展开的是安装说明。
 *
 * 安装、升级与登录（架构设计 §12.9，经 Runtime 的 `agents.*` 命令）：
 * - brew、npm 这类安装、升级命令左边有 ▶：先弹确认（显示完整命令），确认后由 Runtime 在应用内运行，输出显示在命令下面，
 *   跑完 Runtime 自动重新检测。失败时给「在终端里运行」。问题条的「升级到 X」与配置模型提示的升级按钮也走同一条路。
 * - `curl … | bash` 这类官方脚本不给 ▶，只给复制。
 * - 登录（「打开终端登录」「换一个账号…」）打开系统终端运行登录命令；打不开时退回复制并说明。回到窗口时重新检测一次。
 * 运行状态在 Runtime（`agent-setup` 主题，`useAgentSetup` 镜像），同一个 Agent 同一时间只跑一条。
 */
export function AgentProviderCard({
  driver,
  open,
  onToggle,
  connected,
}: {
  driver: DriverInfo;
  open: boolean;
  onToggle: (open: boolean) => void;
  connected: boolean;
}) {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const [busy, setBusy] = useState<null | Busy>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const installed = isInstalled(driver);
  // 用户添加的（产品设计 §7.6）：BaoCut 没有它的安装命令，只知道怎么启动它；npx / uvx 现取现用的不用单独装。
  const added = isCustomDriver(driver);
  const launch = added ? (driver.custom?.command ?? [driver.command]) : null;
  const launcher = launch ? launcherOf(launch) : null;
  const blocked = isBlocked(driver);
  const badge = agentBadge(driver);
  const problem = agentProblem(driver);
  const gate = configModelGate(driver);
  const update = hasUpdate(driver);
  const disabled = !connected || busy !== null;

  // ---- 安装、升级：方式由卡片记着（问题条的「升级到 X」跟着分段里选的那一种），运行状态来自 Runtime ----
  const plan = installPlan(driver);
  const [picked, setPicked] = useState<InstallKind | null>(null);
  const choice = plan.choices.find((c) => c.kind === (picked ?? plan.initial)) ?? plan.choices[0] ?? null;
  const setupAction: AgentSetupAction = plan.upgrading ? 'upgrade' : 'install';
  const latest = useAgentSetup((s) => latestSetupRun(s.runs, driver.id));
  const shown = useAgentSetup((s) => s.shown);
  const setupRunning = latest?.state === 'running';
  const visibleRun = latest && (setupRunning || shown.has(latest.runId)) ? latest : null;
  const [confirm, setConfirm] = useState<InstallChoice | null>(null);

  const askRun = () => {
    if (choice?.runnable && !setupRunning) setConfirm(choice);
  };
  const startRun = async (c: InstallChoice) => {
    try {
      await runAgentSetup(runtime, driver.id, setupAction, c.kind);
    } catch (error) {
      ToastQueue.negative(CARD_COPY.runFailed((error as Error).message), { timeout: 5000 });
    }
  };
  const stopRun = async () => {
    if (!latest || latest.state !== 'running') return;
    try {
      await cancelAgentSetup(runtime, latest.runId);
    } catch (error) {
      ToastQueue.negative(CARD_COPY.stopFailed((error as Error).message), { timeout: 5000 });
    }
  };

  // ---- 系统终端：登录、失败后改在终端里运行。打开后用户回到这个窗口时重新检测一次 ----
  const stopWatchingReturn = useRef<(() => void) | null>(null);
  useEffect(() => () => stopWatchingReturn.current?.(), []);
  const recheckOnReturn = () => {
    stopWatchingReturn.current?.();
    const onFocus = () => {
      stopWatchingReturn.current?.();
      void detectAgents(runtime, driver.id).catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    stopWatchingReturn.current = () => {
      window.removeEventListener('focus', onFocus);
      stopWatchingReturn.current = null;
    };
  };
  const inTerminal = async (action: 'login' | AgentSetupAction, kind?: InstallKind) => {
    const label = action === 'login' ? CARD_COPY.loginCommand : action === 'install' ? CARD_COPY.installCommand : CARD_COPY.upgradeCommand;
    // 探测结果里没有登录命令时 Runtime 不收，直接让用户复制（loginCommandOf 退回直接起 CLI）。
    if (action === 'login' && !driver.loginCommand) return void copyText(loginCommandOf(driver), label);
    try {
      const result = await openAgentTerminal(runtime, driver.id, action, kind);
      if (result.status === 'opened') {
        ToastQueue.neutral(action === 'login' ? CARD_COPY.terminalLogin(result.command) : CARD_COPY.terminalRun(result.command), {
          timeout: 5000,
        });
        recheckOnReturn();
        return;
      }
      // 这台电脑上打不开终端（或不认识的系统）：退回复制。
      try {
        await navigator.clipboard.writeText(result.command);
        ToastQueue.neutral(CARD_COPY.terminalCopied(label), { timeout: 5000 });
      } catch {
        ToastQueue.neutral(CARD_COPY.terminalManual(result.command), { timeout: 8000 });
      }
    } catch (error) {
      ToastQueue.negative(CARD_COPY.terminalFailed((error as Error).message), { timeout: 5000 });
    }
  };

  const runnerFor = (c: InstallChoice): CommandRunner | undefined =>
    c.runnable
      ? {
          run: visibleRun && visibleRun.command === c.command && visibleRun.kind === c.kind ? visibleRun : null,
          isDisabled: !connected || setupRunning,
          onRun: () => setConfirm(c),
          onStop: () => void stopRun(),
          onTerminal: () => void inTerminal(setupAction, c.kind),
        }
      : undefined;
  const setup: SetupControls = { plan, choice, pick: setPicked, runnerFor, running: setupRunning };

  const run = async (kind: Busy, task: () => Promise<unknown>, failure: (message: string) => string) => {
    setBusy(kind);
    try {
      await task();
      return true;
    } catch (error) {
      ToastQueue.negative(failure((error as Error).message), { timeout: 5000 });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const setEnabled = (enabled: boolean) =>
    void run('enable', () => configureAgent(runtime, driver.id, { enabled }), enabled ? CARD_COPY.enableFailed : CARD_COPY.disableFailed).then(
      (ok) => ok && ToastQueue.neutral(enabled ? CARD_COPY.enabled(driver.name) : CARD_COPY.disabled(driver.name), { timeout: 3000 }),
    );

  const recheck = () =>
    void run('detect', () => detectAgents(runtime, driver.id), CARD_COPY.recheckFailed).then((ok) => {
      if (ok) setDiagnosing(true);
    });

  const remove = async () => {
    try {
      await removeAgentProvider(runtime, driver.id);
      ToastQueue.neutral(ADDED_COPY.removed(driver.name), { timeout: 3000 });
    } catch (error) {
      ToastQueue.negative(ADDED_COPY.removeFailed((error as Error).message), { timeout: 5000 });
    }
  };

  const act = (action: ProblemAction) => {
    if (action === 'login') return void inTerminal('login');
    onToggle(true);
    if (action === 'diagnose') recheck();
    // 能在应用内运行就直接弹确认；官方脚本类只展开详情，让用户看到复制入口（设计稿 runPlan）。
    else if (action === 'upgrade') askRun();
  };

  return (
    <div className={card}>
      <div className={head}>
        <span className={avatar({ isReady: driver.state === 'ready' })} data-bc-icons="primary" aria-hidden>
          <AgentProviderIcon driver={driver} />
        </span>
        <div className={headText}>
          <div className={nameRow}>
            <span className={name}>{driver.name}</span>
            {driver.isDefault ? (
              <Badge variant="accent" size="S" fillStyle="subtle">
                {CARD_COPY.defaultBadge}
              </Badge>
            ) : null}
            <Badge variant={TONE_BADGE[badge.tone]} size="S" fillStyle="subtle">
              {badge.label}
            </Badge>
            {added ? (
              <Badge variant="neutral" size="S" fillStyle="outline">
                {ADDED_COPY.chip}
              </Badge>
            ) : null}
            {driver.tested ? null : (
              <Badge variant="notice" size="S" fillStyle="outline">
                {UNTESTED.badge}
              </Badge>
            )}
          </div>
          <p className={sub}>
            {added
              ? installed
                ? ADDED_COPY.subFound(driver.version)
                : launcher
                  ? ADDED_COPY.subLauncher(launcher.kind, launcher.needs)
                  : ADDED_COPY.subMissing(launch?.[0] ?? driver.command)
              : installed
                ? CARD_COPY.subInstalled(driver.version ?? null, localizeText(driver.account, driver.accountRef) ?? null)
                : CARD_COPY.subMissing(driver.command, localizeText(driver.plan, driver.planRef))}
          </p>
        </div>
        <div className={headControls}>
          {installed ? (
            <Switch
              aria-label={CARD_COPY.enable(driver.name)}
              size="S"
              isSelected={driver.enabled && !blocked}
              isDisabled={blocked || disabled}
              onChange={setEnabled}
            />
          ) : null}
          <ActionButton isQuiet={installed} size="S" aria-expanded={open} onPress={() => onToggle(!open)}>
            <Text>{installed ? CARD_COPY.details : added ? ADDED_COPY.detect : CARD_COPY.install}</Text>
            {open ? <ChevronUp /> : <ChevronDown />}
          </ActionButton>
          {/* 移除只给用户添加的；浏览器里不给（`agents.removeProvider` 不在 Web 白名单里）。 */}
          {added && !web ? (
            <ActionButton isQuiet size="S" isDisabled={!connected} onPress={() => setRemoving(true)}>
              {ADDED_COPY.remove}
            </ActionButton>
          ) : null}
        </div>
      </div>

      {/* 用 Codex 画图（settings-agent-provider.jsx:200-203）：只在 Codex 已找到时出现，挂在卡头下、问题条之前。 */}
      {driver.id === 'codex' && installed ? <CodexImageRow driver={driver} connected={connected} /> : null}

      {problem ? (
        <div className={problemStrip({ isNegative: problem.tone === 'negative' })} role="alert">
          <span className={problemIcon({ isNegative: problem.tone === 'negative' })} aria-hidden>
            <AlertTriangle styles={iconStyle({ size: 'S' })} />
          </span>
          <div className={problemText}>
            <div className={problemTitle}>{problem.title}</div>
            <p className={problemBody}>{problem.body}</p>
          </div>
          <Button
            variant="accent"
            size="S"
            styles={problemAction}
            isDisabled={(problem.action !== 'login' && disabled) || (problem.action === 'upgrade' && setupRunning)}
            onPress={() => act(problem.action)}>
            {busy === 'detect' && problem.action === 'diagnose' ? CARD_COPY.checking : problem.cta}
          </Button>
        </div>
      ) : gate ? (
        <div className={problemStrip({ isNegative: false })} role="status">
          <span className={problemIcon({ isNegative: false })} aria-hidden>
            <AlertTriangle styles={iconStyle({ size: 'S' })} />
          </span>
          <div className={problemText}>
            <div className={problemTitle}>{CARD_COPY.gateTitle(driver.name, gate.model)}</div>
            <p className={problemBody}>
              {CARD_COPY.gateBody(gate.version ?? '—', gate.model)}
              {gate.latest ? CARD_COPY.gateUpgrade : CARD_COPY.gateNoUpgrade}
            </p>
          </div>
          {gate.latest ? (
            <Button variant="accent" size="S" styles={problemAction} isDisabled={disabled || setupRunning} onPress={() => act('upgrade')}>
              {CARD_COPY.upgradeTo(gate.latest)}
            </Button>
          ) : null}
        </div>
      ) : update && !open ? (
        <div className={strip}>
          <span className={stripText}>
            {CARD_COPY.updateStrip(driver.latestVersion ?? '', driver.version ?? '')}
          </span>
          <Button variant="secondary" size="S" onPress={() => onToggle(true)}>
            {CARD_COPY.viewUpgrade}
          </Button>
        </div>
      ) : null}

      {open ? (
        <div className={detail} id={`agent-detail-${driver.id}`}>
          {installed ? (
            <InstalledDetail
              launch={launch}
              launcher={launcher}
              driver={driver}
              disabled={disabled}
              busy={busy}
              run={run}
              onRecheck={recheck}
              setup={setup}
              onLogin={() => void inTerminal('login')}
              canLogin={connected}
            />
          ) : launch ? (
            <AddedInstallPanel
              driver={driver}
              launch={launch}
              launcher={launcher}
              disabled={disabled}
              busy={busy === 'detect'}
              onDetect={recheck}
            />
          ) : (
            <InstallPanel driver={driver} disabled={disabled} busy={busy === 'detect'} onRecheck={recheck} setup={setup} />
          )}
          {diagnosing ? <Diagnosis driver={driver} /> : null}
        </div>
      ) : null}

      <DialogContainer onDismiss={() => setConfirm(null)}>
        {confirm ? <RunCommandDialog action={setupAction} name={driver.name} command={confirm.command} onRun={() => void startRun(confirm)} /> : null}
      </DialogContainer>
      {/* 移除先确认（不做撤销：Runtime 只回环境变量名，撤销补不回值；正在用它的任务也已经结束）。 */}
      <DialogContainer onDismiss={() => setRemoving(false)}>
        {removing ? (
          <AlertDialog
            title={ADDED_COPY.removeTitle(driver.name)}
            variant="destructive"
            primaryActionLabel={ADDED_COPY.remove}
            cancelLabel={CARD_COPY.cancel}
            onPrimaryAction={() => void remove()}>
            {ADDED_COPY.removeBody(driver.name)}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </div>
  );
}

type InstallKind = DriverInstallOption['kind'];

/** 卡片交给安装、升级那一段的：方式、选中的那一种、每条命令的 ▶。 */
interface SetupControls {
  plan: InstallPlan;
  choice: InstallChoice | null;
  pick: (kind: InstallKind) => void;
  runnerFor: (choice: InstallChoice) => CommandRunner | undefined;
  /** 这个 Agent 有命令正在跑：分段不让换。 */
  running: boolean;
}

/** 卡片上同一时间只跑一件事；刷新模型单独一档，不跟「运行排查」共用文案，也不展开排查结果。 */
type Busy = 'enable' | 'detect' | 'models' | 'default' | 'model';
type Run = (kind: Busy, task: () => Promise<unknown>, failure: (message: string) => string) => Promise<boolean>;

function InstalledDetail({
  launch,
  launcher,
  driver,
  disabled,
  busy,
  run,
  onRecheck,
  setup,
  onLogin,
  canLogin,
}: {
  /** 用户添加的那一家的启动命令；内置的为 null。 */
  launch: readonly string[] | null;
  launcher: Launcher | null;
  driver: DriverInfo;
  disabled: boolean;
  busy: string | null;
  run: Run;
  onRecheck: () => void;
  setup: SetupControls;
  onLogin: () => void;
  canLogin: boolean;
}) {
  const runtime = useRuntime();
  const models = modelChoices(driver);
  const efforts = effortChoices(driver);
  const plan = setup.plan;
  const update = hasUpdate(driver);
  const signedOut = driver.state === 'signed-out';

  const setModel = (key: string) => {
    const choice = models.find((m) => m.key === key);
    if (!choice || choice.missing || choice.model === driver.defaultModel) return;
    void run('model', () => configureAgent(runtime, driver.id, { defaultModel: choice.model }), CARD_COPY.saveModelFailed);
  };
  const setEffort = (key: string) => {
    const choice = efforts?.find((e) => e.key === key);
    if (!choice || choice.missing || choice.effort === driver.defaultEffort) return;
    // 只传强度：Runtime 只改强度、存的模型不动（没设过的仍跟着推荐模型走）。带上 `driver.defaultModel` 会把推荐模型钉成设过的。
    void run('model', () => configureAgent(runtime, driver.id, { defaultEffort: choice.effort }), CARD_COPY.saveEffortFailed);
  };
  // 协议没有单独的「刷新模型」，模型表随检测一起更新，所以这里也走 agents.detect。
  const refreshModels = () =>
    void run('models', () => detectAgents(runtime, driver.id), CARD_COPY.refreshFailed).then(
      (ok) => ok && ToastQueue.neutral(CARD_COPY.refreshed(driver.name), { timeout: 3000 }),
    );
  const setDefault = () =>
    void run('default', () => setDefaultAgent(runtime, driver.id), CARD_COPY.setDefaultFailed).then(
      (ok) => ok && ToastQueue.positive(CARD_COPY.nowDefault(driver.name), { timeout: 3000 }),
    );

  return (
    <>
      {driver.capabilities.approvals ? null : <Note notice>{AGENT_COPY.fullAccessOnly}</Note>}
      {driver.tested ? null : <Note>{UNTESTED.body}</Note>}
      <SettingRow label={CARD_COPY.defaultModel} desc={CARD_COPY.defaultModelDesc}>
        <div className={pickers}>
          <Picker
            aria-label={CARD_COPY.defaultModelOf(driver.name)}
            size="S"
            align="end"
            selectedKey={selectedModelKey(driver)}
            disabledKeys={models.filter((m) => m.missing).map((m) => m.key)}
            isDisabled={disabled}
            onSelectionChange={(key) => setModel(String(key))}
            styles={style({ width: 200 })}>
            {models.map((m) => (
              <PickerItem key={m.key} id={m.key} textValue={m.label}>
                <Text slot="label">{m.tag ? `${m.label} · ${m.tag}` : m.label}</Text>
                {m.description ? <Text slot="description">{m.description}</Text> : null}
              </PickerItem>
            ))}
          </Picker>
          {efforts ? (
            <Picker
              aria-label={CARD_COPY.defaultEffortOf(driver.name)}
              size="S"
              align="end"
              selectedKey={selectedEffortKey(driver)}
              disabledKeys={efforts.filter((e) => e.missing).map((e) => e.key)}
              isDisabled={disabled}
              onSelectionChange={(key) => setEffort(String(key))}
              styles={style({ width: 140 })}>
              {efforts.map((e) => (
                <PickerItem key={e.key} id={e.key} textValue={e.label}>
                  {e.label}
                </PickerItem>
              ))}
            </Picker>
          ) : null}
        </div>
      </SettingRow>
      <SettingRow
        label={CARD_COPY.modelsOf(driver.name, driver.models.length)}
        desc={
          driver.models.length
            ? CARD_COPY.modelsList(driver.models.map((m) => m.label).join(' / '))
            : CARD_COPY.modelsNone
        }>
        <Button variant="secondary" size="S" isDisabled={disabled || isBlocked(driver)} onPress={refreshModels}>
          {busy === 'models' ? CARD_COPY.refreshing : CARD_COPY.refreshModels}
        </Button>
      </SettingRow>
      {launch ? (
        <SettingRow
          label={CARD_COPY.version(driver.version ?? null)}
          desc={launcher ? ADDED_COPY.versionPinned(launcher.spec) : ADDED_COPY.versionOwn}
        />
      ) : (
        <SettingRow
          label={CARD_COPY.version(driver.version ?? null)}
          desc={CARD_COPY.versionDesc(update ? String(driver.latestVersion) : null, driver.minVersion || null, upgradeSource(plan))}
          below={plan.choices.length ? <InstallCommands setup={setup} copyLabel={CARD_COPY.upgradeCommand} /> : null}
        />
      )}
      <SettingRow
        label={CARD_COPY.account}
        desc={
          launch
            ? ADDED_COPY.account(driver.name, signedOut)
            : CARD_COPY.accountDesc(signedOut, localizeText(driver.account, driver.accountRef) ?? null, localizeText(driver.plan, driver.planRef))
        }>
        <Button variant="secondary" size="S" isDisabled={!canLogin} onPress={onLogin}>
          {signedOut ? CARD_COPY.loginInTerminal : CARD_COPY.switchAccount}
        </Button>
      </SettingRow>
      <SettingRow
        label={CARD_COPY.location}
        desc={CARD_COPY.locationDesc}
        below={
          <div className={stack}>
            {driver.executable ? <CommandBlock value={driver.executable} copyLabel={AGENT_COPY.pathLabel} /> : null}
            {driver.realExecutable && driver.realExecutable !== driver.executable ? (
              <p className={hint}>
                {CARD_COPY.realLocation} <span className={codeInline}>{driver.realExecutable}</span>
              </p>
            ) : null}
            <Disclosure size="S" isQuiet defaultExpanded={!!driver.executableOverride}>
              <DisclosureTitle>{CARD_COPY.setLocation}</DisclosureTitle>
              <DisclosurePanel>
                <ExecutableField driver={driver} isDisabled={disabled} />
              </DisclosurePanel>
            </Disclosure>
          </div>
        }
      />
      {launch ? (
        <SettingRow
          label={ADDED_COPY.launchRow}
          desc={ADDED_COPY.launchRowHint}
          below={<CommandBlock value={launchLine(launch, driver.custom?.envKeys ?? [])} copyLabel={ADDED_COPY.launchCopy} />}
        />
      ) : null}
      <SettingRow label={CARD_COPY.troubleshoot} desc={CARD_COPY.troubleshootDesc}>
        {!driver.isDefault && driver.state === 'ready' ? (
          <Button variant="secondary" size="S" isDisabled={disabled} onPress={setDefault}>
            {CARD_COPY.setDefault}
          </Button>
        ) : null}
        <Button variant="secondary" size="S" isDisabled={disabled} onPress={onRecheck}>
          {busy === 'detect' ? CARD_COPY.checking : CARD_COPY.runChecks}
        </Button>
      </SettingRow>
    </>
  );
}

/** 升级说明的最后一句：认出了来源就点名，否则请用户用当初的方式。 */
function upgradeSource(plan: InstallPlan): string {
  const via = plan.choices.find((c) => c.kind === plan.detected);
  return via ? CARD_COPY.sourceKnown(via.label) : CARD_COPY.sourceUnknown;
}

/**
 * 安装或升级的方式（多于一种时分段切换，运行中不让换）与命令。起手选认出来的那一种。
 * 文案按设计稿（settings-agent-provider.jsx:89-94、259-266）：安装时先说 ▶ 能做什么；不能在应用内运行的给一句复制说明。
 */
function InstallCommands({ setup, copyLabel }: { setup: SetupControls; copyLabel: string }) {
  const { plan, choice } = setup;
  if (!choice) return null;
  const installing = !plan.upgrading;
  const scriptHint = choice.runnable
    ? null
    : choice.downloadsScript
      ? installing
        ? CARD_COPY.scriptInstall
        : CARD_COPY.scriptUpgrade
      : // 官方脚本类自带的升级命令（例如 claude update）：不下载脚本，但同样不在应用内运行。设计稿没有这一种。
        installing
        ? null
        : CARD_COPY.copyUpgrade;
  return (
    <div className={stack}>
      {installing ? (
        <p className={hint}>
          {choice.runnable ? CARD_COPY.runnableHint : CARD_COPY.copyHint}
        </p>
      ) : null}
      {plan.choices.length > 1 ? (
        <SegmentedControl
          aria-label={installing ? CARD_COPY.installMethod : CARD_COPY.upgradeMethod}
          selectedKey={choice.kind}
          isDisabled={setup.running}
          onSelectionChange={(key) => setup.pick(String(key) as InstallKind)}>
          {plan.choices.map((c) => (
            <SegmentedControlItem key={c.kind} id={c.kind}>
              {c.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      ) : null}
      <CommandBlock
        value={choice.command}
        copyLabel={copyLabel}
        runner={setup.runnerFor(choice)}
        note={choice.needs ? <p className={hint}>{CARD_COPY.needs(choice.needs)}</p> : null}
      />
      {scriptHint ? <p className={hint}>{scriptHint}</p> : null}
    </div>
  );
}

/** 详情顶上的一段说明（.agp-note）。 */
function Note({ notice = false, children }: { notice?: boolean; children: ReactNode }) {
  return (
    <div className={noteBox({ isNotice: notice })} role="note">
      <span className={noteIcon({ isNotice: notice })} aria-hidden>
        {notice ? <AlertTriangle styles={iconStyle({ size: 'S' })} /> : <InfoCircle styles={iconStyle({ size: 'S' })} />}
      </span>
      <span>{children}</span>
    </div>
  );
}

/**
 * 用户添加的、还没检测到的那一家（原型 `AddedInstallPanel`，产品设计 §7.6）：BaoCut 没有它的安装命令，只知道怎么启动它。
 * 由 npx / uvx 现取现用的不用单独装；其余按它自己的说明装好（目录里的给「打开官方说明」），回来点检测。
 */
function AddedInstallPanel({
  driver,
  launch,
  launcher,
  disabled,
  busy,
  onDetect,
}: {
  driver: DriverInfo;
  launch: readonly string[];
  launcher: Launcher | null;
  disabled: boolean;
  busy: boolean;
  onDetect: () => void;
}) {
  const runtime = useRuntime();
  const docs = ACP_CATALOG.find((e) => e.id === driver.id)?.docs ?? null;
  const envKeys = driver.custom?.envKeys ?? [];
  const openDocs = () => {
    if (!docs) return;
    const open = runtime.host.openExternal;
    if (open) return void open(docs).catch((error: Error) => ToastQueue.negative(CARD_COPY.openFailed(error.message), { timeout: 5000 }));
    if (!window.open(docs, '_blank', 'noopener,noreferrer')) copyText(docs, CARD_COPY.linkLabel);
  };
  return (
    <>
      <Note>{ADDED_COPY.note(driver.name)}</Note>
      <ol className={steps}>
        <li>
          {launcher ? (
            <>
              <span className={stepTitle}>{ADDED_COPY.noInstall}</span>
              {ADDED_COPY.noInstallBody(launcher.kind, launcher.spec, launcher.needs)}
            </>
          ) : (
            <>
              <span className={stepTitle}>{ADDED_COPY.install}</span>
              {ADDED_COPY.installBody(launch[0] ?? driver.command)}
              {docs ? (
                <div className={docsLink}>
                  <Button variant="secondary" size="S" onPress={openDocs}>
                    <OpenIn />
                    <Text>{ADDED_COPY.docs}</Text>
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </li>
        <li>
          <span className={stepTitle}>{ADDED_COPY.launch}</span>
          <div className={stack}>
            <CommandBlock value={launchLine(launch, envKeys)} copyLabel={ADDED_COPY.launchCopy} />
            {envKeys.length ? <p className={hint}>{ADDED_COPY.envNote(envKeys)}</p> : null}
          </div>
        </li>
        <li>
          <span className={stepTitle}>{ADDED_COPY.login}</span>
          {ADDED_COPY.loginBody}
        </li>
        <li>
          <span className={stepTitle}>{ADDED_COPY.detectStep}</span>
          <div className={stack}>
            <span>{ADDED_COPY.detectBody}</span>
            <div>
              <Button variant="secondary" size="S" isDisabled={disabled} onPress={onDetect}>
                {busy ? ADDED_COPY.detecting : ADDED_COPY.detect}
              </Button>
            </div>
          </div>
        </li>
      </ol>
    </>
  );
}

function InstallPanel({
  driver,
  disabled,
  busy,
  onRecheck,
  setup,
}: {
  driver: DriverInfo;
  disabled: boolean;
  busy: boolean;
  onRecheck: () => void;
  setup: SetupControls;
}) {
  const plan = setup.plan;
  return (
    <>
      <p className={note}>{CARD_COPY.installIntro(driver.name, localizeText(driver.plan, driver.planRef))}</p>
      <ol className={steps}>
        <li>
          {plan.choices.length ? (
            <>
              <span className={stepTitle}>{CARD_COPY.stepInstall}</span>
              <InstallCommands setup={setup} copyLabel={CARD_COPY.installCommand} />
            </>
          ) : (
            <>
              <span className={stepTitle}>{CARD_COPY.stepInstallOfficial}</span>
              {CARD_COPY.installOfficialBody(<span className={codeInline}>{driver.command}</span>)}
            </>
          )}
        </li>
        <li>
          <span className={stepTitle}>{CARD_COPY.stepLogin}</span>
          <div className={stack}>
            <span>{CARD_COPY.stepLoginBody}</span>
            <CommandBlock value={loginCommandOf(driver)} copyLabel={CARD_COPY.loginCommand} />
          </div>
        </li>
        <li>
          <span className={stepTitle}>{CARD_COPY.stepBack}</span>
          <div className={stack}>
            <span>{CARD_COPY.stepBackBody}</span>
            <div>
              <Button variant="secondary" size="S" isDisabled={disabled} onPress={onRecheck}>
                {busy ? CARD_COPY.detecting : CARD_COPY.recheck}
              </Button>
            </div>
          </div>
        </li>
      </ol>
      <Disclosure size="S" isQuiet defaultExpanded={!!driver.executableOverride}>
        <DisclosureTitle>{CARD_COPY.notDetected}</DisclosureTitle>
        <DisclosurePanel>
          <div className={stack}>
            <p className={hint}>{CARD_COPY.notDetectedBody}</p>
            <ExecutableField driver={driver} isDisabled={disabled} />
          </div>
        </DisclosurePanel>
      </Disclosure>
    </>
  );
}

const STEP_ICON: Record<'ok' | 'fail' | 'skip', ReactNode> = {
  ok: <CheckmarkCircle />,
  fail: <AlertTriangle />,
  skip: <Clock />,
};

/** 排查清单：按依赖顺序五步，前一步不过后面的标「上一步通过后再检查」，结论一句话。 */
function Diagnosis({ driver }: { driver: DriverInfo }) {
  const list = diagnose(driver);
  const result = diagnosisVerdict(list);
  return (
    <div className={diag}>
      <ol className={checks} aria-label={CARD_COPY.diagnosisOf(driver.name)}>
        {list.map((s) => (
          <li key={s.key} className={check}>
            <span className={checkIcon({ isOk: s.state === 'ok', isFail: s.state === 'fail' })}>{STEP_ICON[s.state]}</span>
            <div>
              <div className={checkLabel}>{s.label}</div>
              <p className={checkDetail}>{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className={verdict({ isOk: result.ok })} role="status">
        {result.text}
      </p>
    </div>
  );
}
