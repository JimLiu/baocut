import { useState, type ComponentType, type MouseEvent, type ReactNode } from 'react';
import { intlLocale, type DriverId, type DriverInfo, type ModelBundleStatus } from '@baocut/protocol';
import {
  ActionButton,
  Badge,
  Button,
  ButtonGroup,
  Checkbox,
  Content,
  Dialog,
  DialogContainer,
  Footer,
  Heading,
  ProgressBar,
  ProgressCircle,
  ToastQueue,
} from '@react-spectrum/s2';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import CheckmarkCircle from '@react-spectrum/s2/icons/CheckmarkCircle';
import Download from '@react-spectrum/s2/icons/Download';
import Image from '@react-spectrum/s2/icons/Image';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { bundleName } from '../../model/models-local.ts';
import { nonCommercial } from '../../model/models-tts-local.ts';
import { M as TTS_LOCAL } from '../../model/models-tts-local-copy.ts';
import {
  ONBOARDING_STEPS,
  agentJobStatus,
  agentLine,
  agentPrimary,
  agentRows,
  bgLine,
  bundleProgress,
  cardState,
  combineStatus,
  downloadPlan,
  initialPicks,
  installPercent,
  isLastStep,
  isModelStep,
  isPartial,
  modelPrimary,
  onboardingRecord,
  planLine,
  planSize,
  stepChoices,
  type AgentInstallJob,
  type AgentRow,
  type BackgroundItem,
  type DownloadPlan,
  type ModelChoice,
  type ModelStep,
} from '../../model/onboarding.ts';
import { M } from '../../model/onboarding-copy.ts';
import { M as SEM } from '../../model/semantic-copy.ts';
import { packageView, TEXT_BUNDLE } from '../../model/semantic-package.ts';
import { configureAgent } from '../../runtime/agent-commands.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useAgentSetup } from '../../state/agent-setup-store.ts';
import { useConnection } from '../../state/connection-store.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useOnboarding } from '../../state/onboarding-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { AgentProviderIcon } from '../agent-provider-icon.tsx';
import { MusicIcon } from '../music-icon.tsx';
import { BatchInstallDialog } from '../models/batch-install-dialog.tsx';
import { CARD_COPY } from '../settings/agent-card-copy.ts';
import { agentBadge, agentOverview } from '../settings/agent-setup.ts';

// 原型 onboarding.css：步骤条（.steps）、状态一句话（.onb-status）、多选卡（.onb-model）、在哪儿用（.onb-where）、底部那一行（.onb-bg）。
const stepsBar = style({ display: 'flex', gap: 4, marginTop: 0, marginBottom: 16, marginX: 0, padding: 0, listStyleType: 'none' });
const stepItem = style({
  flexGrow: 1,
  flexBasis: 0,
  minWidth: 0,
  paddingBottom: 8,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: 2,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', isDone: 'gray-500', isCurrent: 'blue-800' },
  font: 'ui-xs',
  color: { default: 'gray-600', isDone: 'gray-700', isCurrent: 'blue-1000' },
  fontWeight: { default: 'normal', isCurrent: 'bold' },
  truncate: true,
});
const lead = style({ margin: 0, font: 'body', color: 'gray-800' });
const note = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 4,
  marginTop: 12,
  marginBottom: 0,
  font: 'ui-sm',
  color: 'gray-600',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const callout = style({
  display: 'flex',
  alignItems: 'start',
  gap: 12,
  marginTop: 12,
  padding: 12,
  borderRadius: 'lg',
  backgroundColor: { default: 'gray-100', isOk: 'green-100', isWhere: 'blue-100' },
  color: { default: 'gray-700', isOk: 'green-900', isWhere: 'blue-900' },
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const calloutIcon = style({ display: 'flex', flexShrink: 0, marginTop: 2 });
const calloutText = style({ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 });
const calloutTitle = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const calloutBody = style({ margin: 0, font: 'ui-sm', color: 'gray-800', overflowWrap: 'anywhere' });
const cards = style({ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 });
const card = style({
  display: 'flex',
  alignItems: 'start',
  gap: 4,
  paddingStart: 8,
  paddingEnd: 12,
  paddingY: 4,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', isOn: 'blue-800' },
  backgroundColor: { default: 'gray-50', isOn: 'blue-100' },
  transition: 'default',
});
const cardBody = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0, paddingY: 4 });
// 勾选框与图标各占一列、和名字那一行等高居中，下面的说明就与名字对齐（原型 onboarding.css 的 onb-agent）。
const cardCell = style({ display: 'flex', alignItems: 'center', flexShrink: 0, height: 24, marginTop: 4, marginEnd: { default: 0, isIcon: 4 } });
const cardHead = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, minHeight: 24 });
const cardName = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900', minWidth: 0, overflowWrap: 'anywhere' });
const cardIcon = style({ display: 'flex', flexShrink: 0, color: 'gray-700', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const grow = style({ flexGrow: 1 });
const cardDesc = style({ font: 'ui-sm', color: { default: 'gray-700', isPlan: 'gray-800' }, overflowWrap: 'anywhere' });
const trailText = style({ font: 'ui-sm', color: 'gray-600', whiteSpace: 'nowrap' });
const installed = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  font: 'ui-sm',
  fontWeight: 'bold',
  color: 'positive-900',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const progressRow = style({ display: 'inline-flex', alignItems: 'center', gap: 8, width: 160 });
const progressBar = style({ flexGrow: 1, minWidth: 0 });
const pctText = style({ font: 'code-xs', color: 'gray-600' });
const foot = style({ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 });
const bgStyle = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  font: 'ui-sm',
  color: 'gray-700',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});

const TONE_BADGE = { positive: 'positive', notice: 'notice', negative: 'negative', neutral: 'neutral' } as const;
const WHERE_ICON: Record<'tts' | 'image' | 'music', ComponentType> = { tts: AudioWave, image: Image, music: MusicIcon };
const NO_PLAN: DownloadPlan = { bundles: [], parts: [], bytes: 0 };

/**
 * 首次启动引导的对话框（设计稿 onboarding.jsx；纯层在 model/onboarding.ts）。顶上是步骤条，六步：连接 Agent → 语音识别 →
 * 语音合成 → 语义搜索 → 图像生成 → 音乐生成，每一步都是多选列表。
 * - 要下载的先过同一个下载确认框（BatchInstallDialog：来源、存放位置、许可），确认后每只模型成为一条后台任务，立刻翻到下一步，
 *   不等下完。确认框打开时引导先收起，取消就回到这一步（不叠两个对话框）。
 * - Agent 勾上要装的交给 OnboardingHost 排队安装；装好的勾选框就是 设置 › Agent 提供方 里那个启用开关，改了立刻生效。
 * - 每一步都可以「跳过」；左下角「退出引导」与 Esc 随时退出（不用右上角的 ×：S2 的可关闭对话框会藏掉 ButtonGroup）。
 *   关掉时还有在后台跑的，弹一句带「查看后台任务」。
 */
export function OnboardingDialog({
  agentJobs,
  onInstallAgents,
}: {
  agentJobs: readonly AgentInstallJob[];
  onInstallAgents: (jobs: readonly Omit<AgentInstallJob, 'runId' | 'failed'>[]) => void;
}) {
  const runtime = useRuntime();
  const go = useShell((s) => s.go);
  const finish = useOnboarding((s) => s.finish);
  const bundles = useModels((s) => s.bundles);
  const jobs = useJobs((s) => s.jobs);
  const runs = useAgentSetup((s) => s.runs);
  const drivers = useConnection((s) => s.drivers);
  // 下载确认之后到 Runtime 推来安装任务之间：看这个时刻之后有没有这只的任务（bundleProgress）。
  const [since] = useState(() => new Date().toISOString());
  const [index, setIndex] = useState(0);
  const [picks, setPicks] = useState<Partial<Record<ModelStep, string[]>>>({});
  const [semPick, setSemPick] = useState(true);
  const [agentPicks, setAgentPicks] = useState<DriverId[]>([]);
  const [started, setStarted] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{ bundles: ModelBundleStatus[]; name: string } | null>(null);
  const step = ONBOARDING_STEPS[index] ?? 'agent';

  // ---- 后台在跑的：这次引导里开始的下载与 Agent 安装 ----
  const sem = packageView(bundles.filter((b) => b.capability === 'embed'));
  const semIds = new Set(sem.parts.map((p) => p.bundle.bundleId));
  const backgroundItems = (ids: readonly string[]): BackgroundItem[] => {
    const own = [...new Set(ids)];
    const model = (id: string) => {
      const bundle = bundles.find((b) => b.bundleId === id);
      return { name: bundle ? bundleName(bundle) : id, ...bundleProgress(bundle, jobs, since) };
    };
    const semantic = own.filter((id) => semIds.has(id)).map(model);
    return [
      ...own
        .filter((id) => !semIds.has(id))
        .map((id) => ({ ...model(id), agent: false })),
      ...(semantic.length
        ? [
            {
              name: SEM.settings.packageName,
              status: combineStatus(semantic.map((x) => x.status)),
              pct: semantic.find((x) => x.status === 'running')?.pct ?? null,
              agent: false,
            },
          ]
        : []),
      ...agentJobs.map((j) => ({ name: j.name, pct: null, status: agentJobStatus(j, runs), agent: true })),
    ];
  };
  const bg = bgLine(backgroundItems(started));

  // ---- 关掉、往下走 ----
  const close = (how: 'done' | 'skipped', extra: readonly string[] = []) => {
    const all = [...started, ...extra];
    finish(onboardingRecord(how, step, all));
    const live = backgroundItems(all).filter((x) => x.status === 'running');
    const models = live.filter((x) => !x.agent).length;
    const agents = live.length - models;
    if (!live.length) return;
    ToastQueue.positive(M.closedToast(models, agents), {
      timeout: 8000,
      actionLabel: M.viewTasks,
      onAction: () => go({ tab: 'tasks' }),
      shouldCloseOnAction: true,
    });
  };
  const next = (extra: readonly string[] = []) => {
    if (isLastStep(step)) close('done', extra);
    else setIndex(index + 1);
  };

  // ---- 这一步要做什么 ----
  const choices = isModelStep(step) ? stepChoices(step, bundles) : [];
  const cur = isModelStep(step) ? (picks[step] ?? initialPicks(choices)) : [];
  const semStarted = sem.parts.filter((p) => started.includes(p.bundle.bundleId)).map((p) => bundleProgress(p.bundle, jobs, since).status);
  const semRunning = sem.running !== null || (semStarted.length > 0 && combineStatus(semStarted) === 'running');
  const semUnsupported = sem.parts.length === 0 || sem.state === 'unsupported';
  const semFixed = sem.state === 'installed' || semRunning;
  const rows = agentRows(drivers ?? []);
  const jobOf = (id: DriverId) => agentJobs.find((j) => j.driverId === id);
  const agentStatus = (id: DriverId) => {
    const job = jobOf(id);
    return job ? agentJobStatus(job, runs) : null;
  };
  const toInstall = rows.filter(
    (r) => r.kind === 'install' && r.choice && agentPicks.includes(r.driver.id) && agentStatus(r.driver.id) !== 'running',
  );
  const plan =
    step === 'semantic'
      ? semPick && !semFixed && !semUnsupported
        ? downloadPlan(sem.queue)
        : NO_PLAN
      : isModelStep(step)
        ? downloadPlan(choices.filter((c) => cur.includes(c.bundle.bundleId)).map((c) => c.bundle))
        : NO_PLAN;
  const primary = step === 'agent' ? agentPrimary(toInstall.length) : modelPrimary(step, plan);

  const download = () => {
    const list = plan.bundles;
    if (!list.length) return;
    const name =
      step === 'semantic'
        ? SEM.settings.packageName
        : new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(list.map(bundleName));
    setConfirm({ bundles: list, name });
  };
  const installAgents = () => {
    onInstallAgents(toInstall.map((r) => ({ driverId: r.driver.id, name: r.driver.name, kind: r.choice!.kind })));
    setAgentPicks([]);
    next();
  };
  const onPrimary = () => (primary.kind === 'download' ? download() : primary.kind === 'install' ? installAgents() : next());

  if (confirm) {
    return (
      <BatchInstallDialog
        bundles={confirm.bundles}
        name={confirm.name}
        onStarted={() => {
          const ids = confirm.bundles.map((b) => b.bundleId);
          setStarted((s) => [...s, ...ids]);
          next(ids);
        }}
        onClose={() => setConfirm(null)}
      />
    );
  }

  return (
    <DialogContainer onDismiss={() => close('skipped')}>
      <Dialog size="L" aria-label={M.dialogLabel}>
        <Heading slot="title">{M.title[step]}</Heading>
        <Content>
          <ol className={stepsBar} aria-label={M.stepsLabel}>
            {ONBOARDING_STEPS.map((k, i) => (
              <li key={k} className={stepItem({ isDone: i < index, isCurrent: i === index })} aria-current={i === index ? 'step' : undefined}>
                {`${i + 1} ${M.step[k]}`}
              </li>
            ))}
          </ol>
          {step === 'agent' ? (
            <AgentStep rows={rows} picks={agentPicks} onPick={setAgentPicks} status={agentStatus} />
          ) : step === 'semantic' ? (
            <>
              <p className={lead}>{M.lead.semantic}</p>
              {semUnsupported ? (
                <Unsupported />
              ) : (
                <>
                  <div className={cards}>
                    <PickCard
                      label={SEM.settings.packageName}
                      selected={semPick || semFixed}
                      disabled={semFixed}
                      onToggle={setSemPick}
                      chips={<Badge variant="informative" size="S" fillStyle="subtle">{M.recommended}</Badge>}
                      trail={
                        sem.state === 'installed' ? (
                          <Installed />
                        ) : sem.running ? (
                          <Progress label={M.downloading(SEM.settings.packageName)} pct={installPercent(sem.running)} />
                        ) : semRunning ? (
                          <span className={trailText}>{M.inBackground}</span>
                        ) : (
                          <SizeText partial={sem.state === 'partial'} plan={downloadPlan(sem.queue)} />
                        )
                      }
                      desc={semanticDesc(sem.parts.map((p) => p.bundle))}
                      plan={semPick && !semFixed ? planLine(plan) : null}
                    />
                  </div>
                  {sem.state === 'installed' ? null : <p className={note}>{M.bgNote}</p>}
                </>
              )}
            </>
          ) : isModelStep(step) ? (
            <>
              <p className={lead}>{M.lead[step]}</p>
              {choices.length ? (
                <div className={cards} role="group" aria-label={M.title[step]}>
                  {choices.map((c) => (
                    <ModelCard
                      key={c.bundle.bundleId}
                      choice={c}
                      bundles={bundles}
                      selected={cur.includes(c.bundle.bundleId)}
                      onToggle={(on) =>
                        setPicks((p) => ({ ...p, [step]: on ? [...cur, c.bundle.bundleId] : cur.filter((id) => id !== c.bundle.bundleId) }))
                      }
                    />
                  ))}
                </div>
              ) : (
                <Unsupported />
              )}
              {step !== 'asr' && choices.length ? <Where step={step} /> : null}
              {choices.length ? <p className={note}>{M.bgNote}</p> : null}
              {step === 'asr' ? <p className={note}>{M.asrAlt}</p> : null}
            </>
          ) : null}
        </Content>
        <Footer>
          <div className={foot}>
            <ActionButton isQuiet onPress={() => close('skipped')}>
              {M.exit}
            </ActionButton>
            {bg ? (
              <span className={bgStyle} role="status">
                <Download />
                {bg}
              </span>
            ) : null}
          </div>
        </Footer>
        <ButtonGroup>
          {primary.kind !== 'next' ? (
            <Button variant="secondary" onPress={() => next()}>
              {M.skip}
            </Button>
          ) : null}
          <Button variant="accent" autoFocus onPress={onPrimary}>
            {primary.label}
          </Button>
        </ButtonGroup>
      </Dialog>
    </DialogContainer>
  );
}

/** 语义搜索那张卡下面一句：文字模型 + 多模态模型的名字。 */
function semanticDesc(parts: readonly ModelBundleStatus[]): string | null {
  const text = parts.find((b) => b.bundleId === TEXT_BUNDLE);
  const multimodal = parts.find((b) => b.bundleId !== TEXT_BUNDLE);
  return text && multimodal ? M.semanticParts(bundleName(text), bundleName(multimodal)) : null;
}

/**
 * 第一步：这台电脑上的 Agent，主列表每家一行、都能勾（行怎么分、下面那句怎么写在 model/onboarding.ts）。
 * 装好的勾选框就是启用开关，改了立刻生效；没装的勾上记在 `picks`，按「后台安装」时才装；这次引导里在装的勾上且不能改。
 */
function AgentStep({
  rows,
  picks,
  onPick,
  status,
}: {
  rows: readonly AgentRow[];
  picks: readonly DriverId[];
  onPick: (picks: DriverId[]) => void;
  status: (id: DriverId) => 'running' | 'done' | 'error' | null;
}) {
  const runtime = useRuntime();
  const drivers = useConnection((s) => s.drivers);
  const checking = useConnection((s) => s.checking);
  const [saving, setSaving] = useState<DriverId[]>([]);
  // 还没有就绪的、又有 Driver 在首次探测时不下结论（同 设置 › Agent 提供方）。
  const settled = !!drivers && (!checking.length || drivers.some((d) => d.state === 'ready'));
  const ov = drivers && settled ? agentOverview(drivers) : null;

  const setEnabled = async (driver: DriverInfo, enabled: boolean) => {
    setSaving((s) => [...s, driver.id]);
    try {
      await configureAgent(runtime, driver.id, { enabled });
    } catch (error) {
      ToastQueue.negative((enabled ? CARD_COPY.enableFailed : CARD_COPY.disableFailed)((error as Error).message), { timeout: 5000 });
    } finally {
      setSaving((s) => s.filter((id) => id !== driver.id));
    }
  };

  return (
    <>
      <p className={lead}>{M.lead.agent}</p>
      <div className={callout({ isOk: ov?.state === 'ready' })} role="status">
        <span className={calloutIcon}>
          {!ov ? (
            <ProgressCircle size="S" isIndeterminate aria-label={M.agentChecking} />
          ) : ov.state === 'ready' ? (
            <CheckmarkCircle />
          ) : ov.state === 'attention' ? (
            <AlertTriangle />
          ) : (
            <InfoCircle />
          )}
        </span>
        <span className={calloutText}>
          <span className={calloutTitle}>{ov ? ov.title : M.agentChecking}</span>
          {ov ? <p className={calloutBody}>{ov.state === 'missing' ? M.agentMissingBody : ov.body}</p> : null}
        </span>
      </div>
      {rows.length ? (
        <div className={cards} role="group" aria-label={M.agentListLabel}>
          {rows.map((row) => {
            const { driver, kind } = row;
            const now = status(driver.id);
            const running = now === 'running';
            const can = !running && (kind === 'use' || kind === 'install');
            const on = running || (kind === 'use' ? driver.enabled : kind === 'install' && picks.includes(driver.id));
            const badge = agentBadge(driver);
            return (
              <PickCard
                key={driver.id}
                label={driver.name}
                icon={
                  <span className={cardIcon} data-bc-icons="primary" aria-hidden>
                    <AgentProviderIcon driver={driver} />
                  </span>
                }
                selected={on}
                disabled={!can || saving.includes(driver.id)}
                fixed={!can}
                onToggle={(v) => {
                  if (!can) return;
                  if (kind === 'use') void setEnabled(driver, v);
                  else onPick(v ? [...picks, driver.id] : picks.filter((id) => id !== driver.id));
                }}
                trail={
                  running ? (
                    <Progress label={M.agentInstallingLabel(driver.name)} pct={null} />
                  ) : (
                    <Badge variant={TONE_BADGE[badge.tone]} size="S" fillStyle="subtle">
                      {badge.label}
                    </Badge>
                  )
                }
                desc={on && kind === 'install' && !running ? null : agentLine(row, { picked: on, running, failed: now === 'error' })}
                plan={on && kind === 'install' && !running ? agentLine(row, { picked: true, running: false, failed: false }) : null}
              />
            );
          })}
        </div>
      ) : null}
      <p className={note}>{M.agentNote}</p>
    </>
  );
}

/** 一张模型卡：右边是状态（已安装 / 进度 / 要下多少），下面一句说明，勾上时再写这次一起下哪几件。已装好的、正在下的勾上且不能改。 */
function ModelCard({
  choice,
  bundles,
  selected,
  onToggle,
}: {
  choice: ModelChoice;
  bundles: readonly ModelBundleStatus[];
  selected: boolean;
  onToggle: (on: boolean) => void;
}) {
  const { bundle } = choice;
  const state = cardState(bundle);
  const fixed = state !== 'available';
  const plan = downloadPlan([bundle]);
  const name = bundleName(bundle);
  return (
    <PickCard
      label={name}
      selected={selected || fixed}
      disabled={fixed}
      onToggle={onToggle}
      chips={
        <>
          {choice.recommended ? (
            <Badge variant="informative" size="S" fillStyle="subtle">
              {M.recommended}
            </Badge>
          ) : null}
          {nonCommercial(bundle.license) ? (
            <Badge variant="notice" size="S" fillStyle="subtle">
              {TTS_LOCAL.nonCommercialChip}
            </Badge>
          ) : null}
        </>
      }
      trail={
        state === 'installing' ? (
          <Progress label={M.downloading(name)} pct={installPercent(bundle)} />
        ) : state === 'installed' ? (
          <Installed />
        ) : (
          <SizeText partial={isPartial(bundle, bundles)} plan={plan} />
        )
      }
      desc={choice.note}
      plan={selected && !fixed ? planLine(plan) : null}
    />
  );
}

/**
 * 多选卡（原型 .onb-model）：左边勾选框，右边名字、标签、状态，下面一两句。点卡片空白处也能勾（点在勾选框上交给它自己）。
 * `disabled` 只是勾不了（正在保存）；`fixed` 还要换成不可改的样子（已装好、正在下、不能勾的 Agent）。
 */
function PickCard({
  label,
  icon,
  chips,
  trail,
  desc,
  plan,
  selected,
  disabled,
  fixed = disabled,
  onToggle,
}: {
  label: string;
  icon?: ReactNode;
  chips?: ReactNode;
  trail: ReactNode;
  desc: string | null;
  plan: string | null;
  selected: boolean;
  disabled: boolean;
  fixed?: boolean;
  onToggle: (on: boolean) => void;
}) {
  const click = (e: MouseEvent<HTMLDivElement>) => {
    if (!disabled && !(e.target as Element).closest('label')) onToggle(!selected);
  };
  return (
    // 键盘与读屏走勾选框本身；整张卡可点只是加大点击范围。
    <div className={card({ isOn: selected && !fixed })} onClick={click}>
      <span className={cardCell({})}>
        <Checkbox aria-label={label} isSelected={selected} isDisabled={disabled} onChange={onToggle} />
      </span>
      {icon ? <span className={cardCell({ isIcon: true })}>{icon}</span> : null}
      <div className={cardBody}>
        <div className={cardHead}>
          <span className={cardName}>{label}</span>
          {chips}
          <span className={grow} />
          {trail}
        </div>
        {desc ? <span className={cardDesc({})}>{desc}</span> : null}
        {plan ? <span className={cardDesc({ isPlan: true })}>{plan}</span> : null}
      </div>
    </div>
  );
}

function Progress({ label, pct }: { label: string; pct: number | null }) {
  return (
    <span className={progressRow}>
      <ProgressBar size="S" aria-label={label} isIndeterminate={pct === null} {...(pct === null ? {} : { value: pct })} styles={progressBar} />
      {pct === null ? null : <span className={pctText}>{`${Math.round(pct)}%`}</span>}
    </span>
  );
}

function Installed() {
  return (
    <span className={installed}>
      <CheckmarkCircle />
      {M.installed}
    </span>
  );
}

function SizeText({ partial, plan }: { partial: boolean; plan: DownloadPlan }) {
  const size = planSize(plan);
  const text = [partial ? M.missingParts : null, size].filter(Boolean).join(' · ');
  return text ? <span className={trailText}>{text}</span> : null;
}

function Unsupported() {
  return (
    <p className={note}>
      <InfoCircle />
      {M.unsupported}
    </p>
  );
}

/** 下好之后在哪儿用（只写工具页里有入口的那几类）。 */
function Where({ step }: { step: 'tts' | 'image' | 'music' }) {
  const Icon = WHERE_ICON[step];
  const where = M.where[step];
  return (
    <div className={callout({ isWhere: true })}>
      <span className={calloutIcon}>
        <Icon />
      </span>
      <span className={calloutText}>
        <span className={calloutTitle}>{where.title}</span>
        <p className={calloutBody}>{where.body}</p>
      </span>
    </div>
  );
}
