import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ImageModelInfo, JobRecord, ModelBundleStatus, SpeechModelInfo } from '@baocut/protocol';
import {
  ActionButton,
  AlertDialog,
  Button,
  DialogContainer,
  Menu,
  MenuItem,
  MenuTrigger,
  Picker,
  PickerItem,
  ProgressBar,
  Text,
  ToastQueue,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import ChevronDownIcon from '@react-spectrum/s2/icons/ChevronDown';
import ChevronRightIcon from '@react-spectrum/s2/icons/ChevronRight';
import DeleteIcon from '@react-spectrum/s2/icons/Delete';
import DownloadIcon from '@react-spectrum/s2/icons/Download';
import MoreIcon from '@react-spectrum/s2/icons/More';
import PauseIcon from '@react-spectrum/s2/icons/Pause';
import SearchIcon from '@react-spectrum/s2/icons/Search';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  bundleActions,
  installFailure,
  installProgressView,
  problemText,
  removalBody,
  removalEstimate,
  removedToast,
  rpcProblem,
} from '../../model/models-install.ts';
import { checkDetailLines, checkLineView, hasCheck, tryNotice } from '../../model/model-check.ts';
import { checkCaption, CHECK_HEAD, CHECK_LABEL, TRY_SUBJECT_IMAGE } from '../../model/model-check-copy.ts';
import {
  bundleChips,
  bundleFacts,
  bundleName,
  canReenable,
  componentLabel,
  isBundleInstalled,
  licenseLines,
  licenseLineText,
  localDefaultPicker,
  localGroups,
  localImageModels,
  LOCAL_PROVIDER,
  VIEW_CAPABILITY,
  type LocalDefaultCapability,
} from '../../model/models-local.ts';
import { canClone, familyDesc, installedBytes, licenseBrief, localSpeechModels, ttsBrief, ttsChips } from '../../model/models-tts-local.ts';
import { chooseVoice, quickDefaults } from '../../model/tts-quick-test.ts';
import { modelCategory, type ModelCategory } from '../../model/settings-nav.ts';
import { fmtSize } from '../../model/task-facts.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useModelCheck } from '../../state/model-check-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useTtsQuick } from '../../state/tts-quick-store.ts';
import { useVoiceHandoff } from '../../state/voice-handoff-store.ts';
import { ImageTryDialog } from './image-try-dialog.tsx';
import { InstallDialog } from './install-dialog.tsx';
import { removeBundle, stopInstall, type InstallMode } from './local-model-actions.ts';
import { LOCAL_INSTALL_COPY as INSTALL } from './local-models-copy.ts';
import { chooseLocalDefault } from './model-actions.ts';
import { ModelCheckLine } from './model-check-line.tsx';
import { Card, Chips, EmptyCard, PageStatus, SettingRow } from './model-parts.tsx';
import { IMAGE_LOCAL_COPY as IMAGE, LOCAL_COPY, MODELS_PAGE_COPY } from './models-copy.ts';
import { TTS_LOCAL_COPY as TTS } from './tts-local-copy.ts';
import { TtsQuickTest } from './tts-quick-test.tsx';
import { startCheck } from './start-check.ts';
import { useBundleCheck } from './use-bundle-check.ts';

const group = style({ marginTop: 24 });
const groupHead = style({ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 });
const groupTitle = style({ margin: 0, font: 'title-sm', color: 'gray-900' });
const groupCount = style({ font: 'ui-sm', color: 'gray-600' });
const groupNote = style({ marginTop: 0, marginBottom: 8, font: 'ui-xs', color: 'gray-600' });
const groupEmpty = style({ margin: 0, paddingY: 12, font: 'ui-sm', color: 'gray-600' });
const modelRow = style({
  paddingY: 12,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const modelHead = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 });
const modelMain = style({ flexGrow: 1, flexBasis: 0, minWidth: 220 });
const modelName = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 });
const modelId = style({ font: 'ui', fontWeight: 'medium', color: 'gray-900', overflowWrap: 'anywhere', userSelect: 'text' });
const modelFacts = style({ marginTop: 4, font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const modelActions = style({ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 });
const progressRow = style({ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 });
const progressBar = style({ flexGrow: 1, minWidth: 120 });
const rowNote = style({
  marginTop: 4,
  marginBottom: 0,
  font: 'ui-xs',
  overflowWrap: 'anywhere',
  userSelect: 'text',
  color: { default: 'gray-700', tone: { failed: 'negative-900', running: 'gray-700' } },
});
const detailList = style({ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, marginBottom: 0, paddingStart: 32 });
const detailLine = style({ display: 'flex', flexWrap: 'wrap', gap: 8, font: 'ui-xs', color: 'gray-700' });
const detailRepo = style({ font: 'code-xs', color: 'gray-800', overflowWrap: 'anywhere', userSelect: 'text' });
const modelSummary = style({ marginTop: 4, font: 'ui-sm', color: 'gray-700', overflowWrap: 'anywhere' });
const detailKey = style({ flexShrink: 0, color: 'gray-600' });
const detailLink = style({ color: 'gray-800', overflowWrap: 'anywhere', userSelect: 'text' });

type Confirm = { kind: 'remove' | 'discard'; bundle: ModelBundleStatus };

/**
 * 模型 › 本地模型（设计稿 settings-local.jsx:200-308）：`models` 主题里的模型包按「已安装 / 可下载」分组，顶上是默认模型。
 * 下载与修复先看计划再确认（install-dialog.tsx）；进度、检查结论与模型包状态都从 `models` / `jobs` 主题读，
 * 这里不轮询、不在本地改状态。现在语音识别、语音合成、图像生成与音源分离有本机模型包，其余类给空态。
 * 音源分离的默认模型与语音识别一样有「自动选择」（配音的分离一步用它）；行与语音识别一样在行上露「检查」。
 * 语音合成（设计稿 settings-tts.jsx）与图像生成的默认模型没有「自动选择」；合成的每一行装好后有「试听」（tts-quick-test.tsx）。
 * 图像生成的「试画」还没做（设计稿 model-local-check.js 的 `TRY.image`），所以它的行像语音识别一样在行上露「检查」。
 * 「检查」与「试听」是两件事（设计稿 model-local-check.js）：试听是行上的主操作，检查在 ⋯ 里紧挨「修复…」；
 * 没有试用的语音识别在行上另有一个安静的「检查」。模型能不能用只写在行上那一条状态里（model-check-line.tsx）。
 */
export function LocalModels({ category }: { category: ModelCategory }) {
  if (category === 'asr') return <LocalPage key="asr" category="asr" kind="transcribe" />;
  if (category === 'tts') return <LocalPage key="tts" category="tts" kind="synthesize" />;
  if (category === 'image') return <LocalPage key="image" category="image" kind="image" />;
  if (category === 'sep') return <LocalPage key="sep" category="sep" kind="separate" />;
  const label = modelCategory(category).label;
  return <EmptyCard title={LOCAL_COPY.emptyTitle(label)} body={LOCAL_COPY.emptyBody} />;
}

function LocalPage({ category, kind }: { category: ModelCategory; kind: LocalDefaultCapability }) {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const ready = useModels((s) => s.ready);
  const view = useModels((s) => s.capabilities);
  const bundles = useModels((s) => s.bundles);
  const jobs = useJobs((s) => s.jobs);
  const [busy, setBusy] = useState<string | null>(null);
  const [install, setInstall] = useState<{ bundle: ModelBundleStatus; mode: InstallMode } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const speech = useMemo(() => (kind === 'synthesize' ? localSpeechModels(view) : new Map<string, SpeechModelInfo>()), [kind, view]);
  const images = useMemo(() => (kind === 'image' ? localImageModels(view) : new Map<string, ImageModelInfo>()), [kind, view]);
  const quickOpen = useTtsQuick((s) => s.open);
  const setQuickOpen = useTtsQuick((s) => s.setOpen);
  useClaimAudition(kind === 'synthesize' && ready, speech);

  if (!connected) return <PageStatus>{MODELS_PAGE_COPY.offline}</PageStatus>;
  if (!ready) return <PageStatus>{MODELS_PAGE_COPY.loading}</PageStatus>;

  const synth = kind === 'synthesize';
  const picker = localDefaultPicker(view, bundles, kind);
  const groups = localGroups(bundles, category);
  const current = view?.[VIEW_CAPABILITY[kind]].default;
  const defaultId = current?.providerId === LOCAL_PROVIDER ? current.modelId : null;
  const cloneNames = synth
    ? groups.installed.filter((b) => isBundleInstalled(b) && canCloneModel(speech.get(b.bundleId))).map((b) => bundleName(b))
    : [];

  const choose = async (key: string) => {
    setBusy('default');
    try {
      await chooseLocalDefault(runtime, key, bundles, kind);
      ToastQueue.neutral(LOCAL_COPY.defaultSet, { timeout: 3000 });
    } catch (err) {
      ToastQueue.negative(LOCAL_COPY.defaultFailed((err as Error).message), { timeout: 5000 });
    } finally {
      setBusy(null);
    }
  };

  const reenable = async (bundleId: string) => {
    setBusy(bundleId);
    try {
      await runtime.enableModelBundle(bundleId);
      const bundle = bundles.find((b) => b.bundleId === bundleId);
      ToastQueue.neutral(LOCAL_COPY.reenabled(bundle ? bundleName(bundle) : bundleId), { timeout: 3000 });
    } catch (err) {
      ToastQueue.negative(LOCAL_COPY.reenableFailed((err as Error).message), { timeout: 5000 });
    } finally {
      setBusy(null);
    }
  };

  const confirmed = async ({ kind: action, bundle }: Confirm) => {
    try {
      if (action === 'discard') {
        await stopInstall(runtime, bundle.bundleId, true);
        ToastQueue.neutral(INSTALL.discarded(bundleName(bundle)), { timeout: 3000 });
      } else {
        const result = await removeBundle(runtime, bundle.bundleId);
        ToastQueue.positive(removedToast(bundleName(bundle), result), { timeout: 4000 });
      }
    } catch (err) {
      const text = problemText(rpcProblem(err));
      ToastQueue.negative(action === 'discard' ? INSTALL.stopFailed(text) : INSTALL.removeFailed(text), { timeout: 8000 });
    }
  };

  const noAuto = synth ? TTS : kind === 'image' ? IMAGE : null;
  const desc = (
    noAuto
      ? [noAuto.defaultDesc, picker.other ? noAuto.cloudDefault(picker.other) : null, picker.items.length ? null : noAuto.noInstalled]
      : [
          kind === 'separate' ? LOCAL_COPY.separateDefaultDesc : LOCAL_COPY.defaultDesc,
          picker.selectedKey === 'auto' && picker.autoUses ? LOCAL_COPY.autoUses(picker.autoUses) : null,
          picker.other ? LOCAL_COPY.otherDefault(picker.other) : null,
        ]
  )
    .filter(Boolean)
    .join(' ');

  const row = (bundle: ModelBundleStatus) => (
    <BundleRow
      key={bundle.bundleId}
      bundle={bundle}
      name={bundleName(bundle)}
      bundles={bundles}
      jobs={jobs}
      isDefault={bundle.bundleId === defaultId}
      kind={kind}
      speech={synth ? { model: speech.get(bundle.bundleId) ?? null, cloneNames } : null}
      image={kind === 'image' ? (images.get(bundle.bundleId) ?? null) : null}
      quickOpen={quickOpen.includes(bundle.bundleId)}
      onQuick={(open) => setQuickOpen(bundle.bundleId, open)}
      reenabling={busy === bundle.bundleId}
      onReenable={() => void reenable(bundle.bundleId)}
      onInstall={(mode) => setInstall({ bundle, mode })}
      onConfirm={(what) => setConfirm({ kind: what, bundle })}
    />
  );

  return (
    <>
      <Card label={LOCAL_COPY.defaultLabel}>
        <SettingRow label={LOCAL_COPY.defaultLabel} desc={desc}>
          <Picker
            aria-label={LOCAL_COPY.defaultLabel}
            size="S"
            align="end"
            menuWidth={280}
            selectedKey={picker.selectedKey}
            placeholder={picker.other ?? (picker.hasAuto ? LOCAL_COPY.auto : TTS.unset)}
            isDisabled={busy === 'default'}
            onSelectionChange={(key) => {
              if (key !== null && key !== picker.selectedKey) void choose(String(key));
            }}>
            {picker.items.map((item) => (
              <PickerItem key={item.key} id={item.key} textValue={item.label}>
                <Text slot="label">{item.label}</Text>
              </PickerItem>
            ))}
          </Picker>
        </SettingRow>
      </Card>

      <section className={group} aria-label={LOCAL_COPY.installed}>
        <div className={groupHead}>
          <h2 className={groupTitle}>{LOCAL_COPY.installed}</h2>
          <span className={groupCount}>{groups.installed.length}</span>
        </div>
        {groups.installed.length ? (
          <>
            <p className={groupNote}>{checkCaption()}</p>
            <Card>{groups.installed.map(row)}</Card>
          </>
        ) : (
          <p className={groupEmpty}>{LOCAL_COPY.emptyInstalled}</p>
        )}
      </section>

      <section className={group} aria-label={LOCAL_COPY.available}>
        <div className={groupHead}>
          <h2 className={groupTitle}>{LOCAL_COPY.available}</h2>
          <span className={groupCount}>{groups.available.length}</span>
        </div>
        {groups.available.length ? (
          <>
            <p className={groupNote}>{INSTALL.availableNote}</p>
            <Card>{groups.available.map(row)}</Card>
          </>
        ) : (
          <p className={groupEmpty}>{LOCAL_COPY.emptyAvailable}</p>
        )}
      </section>

      {install ? (
        <InstallDialog
          bundleId={install.bundle.bundleId}
          name={bundleName(install.bundle)}
          license={install.bundle.license ?? speech.get(install.bundle.bundleId)?.local?.license ?? null}
          {...(kind === 'image' ? { licenseUse: IMAGE.licenseUse } : {})}
          mode={install.mode}
          onClose={() => setInstall(null)}
          onStarted={install.mode === 'repair' ? (jobId) => useModelCheck.getState().setRepair(install.bundle.bundleId, jobId) : undefined}
          onRecheck={install.mode === 'repair' ? () => void startCheck(runtime, install.bundle.bundleId) : undefined}
        />
      ) : null}

      <DialogContainer onDismiss={() => setConfirm(null)}>
        {confirm ? (
          <AlertDialog
            variant="destructive"
            title={
              confirm.kind === 'remove' ? INSTALL.removeTitle(bundleName(confirm.bundle)) : INSTALL.discardTitle(bundleName(confirm.bundle))
            }
            primaryActionLabel={confirm.kind === 'remove' ? INSTALL.removeConfirm : INSTALL.discard}
            cancelLabel={INSTALL.cancel}
            onPrimaryAction={() => void confirmed(confirm)}>
            {confirm.kind === 'remove' ? removalBody(removalEstimate(confirm.bundle, bundles)) : INSTALL.discardBody}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </>
  );
}

function canCloneModel(model: SpeechModelInfo | undefined): boolean {
  return !!model && canClone(model);
}

/** 试听面板的锚点：「我的声音」的试听克隆与「克隆新音色…」回来时滚到这一行。 */
function quickAnchor(bundleId: string): string {
  return `tts-quick-${bundleId}`;
}

/**
 * 认领从「我的声音」带过来的音色：「试听克隆」（`focus`）与「克隆新音色…」存好回来（`handoff.voiceId`）都是展开那一行的试听、
 * 选上这只音色、滚过去，然后清掉。模型还没列出来时先不动，等 `models` 主题送到。
 */
function useClaimAudition(enabled: boolean, speech: ReadonlyMap<string, SpeechModelInfo>) {
  const focus = useVoiceHandoff((s) => s.focus);
  const handoff = useVoiceHandoff((s) => s.handoff);
  useEffect(() => {
    if (!enabled) return;
    const claim = focus
      ? { bundleId: focus.bundleId, voice: focus.voice, done: () => useVoiceHandoff.getState().setFocus(null) }
      : handoff?.voiceId && handoff.key.startsWith('quick:')
        ? {
            bundleId: handoff.key.slice('quick:'.length),
            voice: `my:${handoff.voiceId}`,
            done: () => useVoiceHandoff.getState().setHandoff(null),
          }
        : null;
    if (!claim) return;
    const model = speech.get(claim.bundleId);
    if (!model) return;
    const quick = useTtsQuick.getState();
    const draft = quick.drafts[claim.bundleId] ?? { pick: quickDefaults(model), run: null, last: null };
    quick.setDraft(claim.bundleId, { ...draft, pick: chooseVoice(draft.pick, claim.voice) });
    quick.setOpen(claim.bundleId, true);
    claim.done();
    requestAnimationFrame(() =>
      document.getElementById(quickAnchor(claim.bundleId))?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
  }, [enabled, focus, handoff, speech]);
}

/**
 * 一行模型包：名字与标签、事实、右边的操作；下面是进度、检查状态、上次下载失败的原因与组成明细。语音合成的行多写一句说明、
 * 能做什么、体积与许可，装好后有「试听」。
 */
function BundleRow({
  bundle,
  name,
  bundles,
  jobs,
  isDefault,
  kind,
  speech,
  image,
  quickOpen,
  onQuick,
  reenabling,
  onReenable,
  onInstall,
  onConfirm,
}: {
  bundle: ModelBundleStatus;
  name: string;
  bundles: readonly ModelBundleStatus[];
  jobs: readonly JobRecord[];
  isDefault: boolean;
  kind: LocalDefaultCapability;
  /** 语音合成的行：本机列出的模型（没装好时可能没有）与装好了的克隆模型名；语音识别的行为 null。 */
  speech: { model: SpeechModelInfo | null; cloneNames: readonly string[] } | null;
  /** 图像生成的行：本机列出的模型（没装好时可能没有）；别的行为 null。 */
  image: ImageModelInfo | null;
  quickOpen: boolean;
  onQuick: (open: boolean) => void;
  reenabling: boolean;
  onReenable: () => void;
  onInstall: (mode: InstallMode) => void;
  onConfirm: (kind: Confirm['kind']) => void;
}) {
  const runtime = useRuntime();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<'pause' | null>(null);
  const [trying, setTrying] = useState(false);
  const actions = bundleActions(bundle);
  const check = useBundleCheck(bundle, kind, jobs);
  // 这一行发起的修复在跑：进度与取消写在检查那一条状态里，不再另起一条下载进度。
  const repairing = check.state.phase === 'repairing';
  const checkBusy = repairing || check.state.phase === 'checking' || check.starting;
  const progress = bundle.install && !repairing ? installProgressView(bundle.install) : null;
  const failure = installFailure(bundle, jobs);
  const id = bundle.bundleId;

  const pause = async () => {
    setPending('pause');
    try {
      await stopInstall(runtime, id, false);
      ToastQueue.neutral(INSTALL.paused(name), { timeout: 3000 });
    } catch (err) {
      ToastQueue.negative(INSTALL.stopFailed(problemText(rpcProblem(err))), { timeout: 8000 });
    } finally {
      setPending(null);
    }
  };

  const model = speech?.model ?? null;
  const canAudition = !!model && model.available && isBundleInstalled(bundle) && bundle.state !== 'error';
  const canTryImage = !!image && image.available !== false && isBundleInstalled(bundle) && bundle.state !== 'error';
  const buttons: ReactNode[] = [];
  if (canAudition) {
    buttons.push(
      <Button
        key="quick"
        variant={quickOpen ? 'secondary' : 'accent'}
        size="S"
        aria-expanded={quickOpen}
        onPress={() => onQuick(!quickOpen)}>
        {quickOpen ? TTS.hideAudition : TTS.audition}
      </Button>,
    );
  }
  if (canTryImage) {
    buttons.push(
      <Button key="try" variant="accent" size="S" onPress={() => setTrying(true)}>
        {IMAGE.tryButton}
      </Button>,
    );
  }
  if (canReenable(bundle)) {
    buttons.push(
      <Button key="reenable" variant="secondary" size="S" isPending={reenabling} onPress={onReenable}>
        {LOCAL_COPY.reenable}
      </Button>,
    );
  }
  // 没有试用的（语音识别，或这一刻试不了的图像模型）：检查在行上露一个安静的按钮；有试听、试画的，检查只在 ⋯ 里。
  if (!speech && !canTryImage && check.can.recheck) {
    buttons.push(
      <TooltipTrigger key="check" placement="top" delay={300}>
        <ActionButton isQuiet size="S" isDisabled={checkBusy} onPress={() => void check.start()}>
          <SearchIcon />
          <Text>{CHECK_LABEL.check}</Text>
        </ActionButton>
        <Tooltip>{CHECK_LABEL.checkFull}</Tooltip>
      </TooltipTrigger>,
    );
  }
  // 装好了、缺可选组件（对齐器、说话人模型）：「补齐」只下载缺的那几件（设计稿 settings-local.jsx 的 `half`）。
  if (actions.complete) {
    buttons.push(
      <Button key="complete" variant="accent" size="S" onPress={() => onInstall('complete')}>
        <DownloadIcon />
        <Text>{INSTALL.complete}</Text>
      </Button>,
    );
  }
  if (actions.install) {
    buttons.push(
      <Button key="install" variant="secondary" size="S" onPress={() => onInstall('install')}>
        <DownloadIcon />
        <Text>{INSTALL.download}</Text>
      </Button>,
    );
  }
  if (actions.resume) {
    buttons.push(
      <Button key="resume" variant="accent" size="S" onPress={() => onInstall(isBundleInstalled(bundle) ? 'complete' : 'install')}>
        <DownloadIcon />
        <Text>{INSTALL.resume}</Text>
      </Button>,
    );
  }
  if (actions.stop && !repairing) {
    buttons.push(
      <ActionButton key="pause" size="S" isPending={pending === 'pause'} onPress={() => void pause()}>
        <PauseIcon />
        <Text>{INSTALL.pause}</Text>
      </ActionButton>,
      <ActionButton key="cancel" isQuiet size="S" onPress={() => onConfirm('discard')}>
        <Text>{INSTALL.cancelDownload}</Text>
      </ActionButton>,
    );
  }
  if (actions.discard) {
    buttons.push(
      <ActionButton key="discard" isQuiet size="S" onPress={() => onConfirm('discard')}>
        <Text>{INSTALL.discard}</Text>
      </ActionButton>,
    );
  }
  // 「说话人区分」没有检查：⋯ 里只有修复（设计稿 settings-local.jsx）。
  const checkable = hasCheck(bundle);
  if (actions.repair || check.can.recheck) {
    const disabled = [...(checkBusy || !check.can.recheck ? ['check'] : []), ...(checkBusy || !check.can.repair ? ['repair'] : [])];
    buttons.push(
      <MenuTrigger key="more">
        <ActionButton isQuiet size="S" aria-label={INSTALL.more(name)}>
          <MoreIcon />
        </ActionButton>
        <Menu
          aria-label={INSTALL.more(name)}
          disabledKeys={disabled}
          onAction={(key) => (key === 'repair' ? onInstall('repair') : key === 'check' ? void check.start() : undefined)}>
          {checkable ? (
            <MenuItem id="check" textValue={CHECK_LABEL.checkFull}>
              <SearchIcon />
              <Text slot="label">{CHECK_LABEL.checkFull}</Text>
            </MenuItem>
          ) : null}
          <MenuItem id="repair" textValue={CHECK_LABEL.repair}>
            <DownloadIcon />
            <Text slot="label">{CHECK_LABEL.repair}</Text>
            <Text slot="description">{CHECK_LABEL.repairSub}</Text>
          </MenuItem>
        </Menu>
      </MenuTrigger>,
    );
  }
  if (actions.remove) {
    buttons.push(
      <ActionButton key="remove" isQuiet size="S" aria-label={`${LOCAL_COPY.remove} ${name}`} onPress={() => onConfirm('remove')}>
        <DeleteIcon />
      </ActionButton>,
    );
  }

  const brief = model ? ttsBrief(model) : null;
  const size = speech ? installedBytes(bundle) : null;
  const weights = bundle.license ?? model?.local?.license ?? null;
  const license = kind !== 'transcribe' ? weights : null;
  const restricted = license && !license.commercialUse ? license : null;
  // 详情的「许可」一行：所有类都列权重的许可，再加上与它不同或要署名的组件（设计稿 settings-local.jsx `lics`）。
  const licenses = licenseLines(bundle, weights);
  const engine = model ? familyDesc(model) : null;

  return (
    <div className={modelRow} id={speech ? quickAnchor(id) : undefined}>
      <div className={modelHead}>
        <ActionButton
          isQuiet
          size="XS"
          aria-label={open ? INSTALL.hideDetails : INSTALL.details}
          aria-expanded={open}
          onPress={() => setOpen((v) => !v)}>
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </ActionButton>
        <div className={modelMain}>
          <div className={modelName}>
            <span className={modelId}>{name}</span>
            <Chips chips={kind !== 'transcribe' ? ttsChips(bundle, isDefault) : bundleChips(bundle, isDefault)} />
          </div>
          {brief ? <div className={modelSummary}>{brief.summary}</div> : null}
          <div className={modelFacts}>
            {brief ? [...brief.facts, ...(size !== null ? [fmtSize(size)] : [])].join(' · ') : bundleFacts(bundle)}
          </div>
          {restricted ? <div className={modelFacts}>{licenseBrief(restricted)}</div> : null}
        </div>
        <div className={modelActions}>{buttons}</div>
      </div>
      {progress && progress.state !== 'paused' ? (
        <div className={progressRow}>
          <ProgressBar
            size="S"
            aria-label={progress.label}
            isIndeterminate={progress.percent === null}
            value={progress.percent ?? undefined}
            styles={progressBar}
          />
          <span className={rowNote({ tone: 'running' })}>{progress.label}</span>
        </div>
      ) : null}
      {progress?.state === 'paused' ? <p className={rowNote({})}>{progress.label}</p> : null}
      {isBundleInstalled(bundle) || checkBusy ? (
        <ModelCheckLine
          view={checkLineView(check.state, check.can)}
          detailLines={checkDetailLines(check.state, id)}
          label={`${repairing ? CHECK_HEAD.repairing : CHECK_HEAD.running} ${name}`}
          onAction={(k) => (k === 'cancel' ? check.cancel() : k === 'repair' ? onInstall('repair') : void check.start())}
        />
      ) : null}
      {failure ? <p className={rowNote({ tone: 'failed' })}>{INSTALL.installFailed(problemText(failure))}</p> : null}
      {quickOpen && canAudition && model ? (
        <TtsQuickTest
          bundleId={id}
          name={name}
          model={model}
          cloneNames={speech?.cloneNames ?? []}
          notice={tryNotice(check.state, check.can)}
          canCheck={check.can.recheck}
          onCheck={(k) => (k === 'repair' ? onInstall('repair') : void check.start())}
        />
      ) : null}
      {trying && canTryImage && image ? (
        <ImageTryDialog
          bundleId={id}
          name={name}
          chip={bundle.backend.toUpperCase()}
          model={image}
          notice={tryNotice(check.state, check.can, TRY_SUBJECT_IMAGE)}
          canCheck={check.can.recheck}
          onCheck={(k) => (k === 'repair' ? onInstall('repair') : void check.start())}
          onClose={() => setTrying(false)}
        />
      ) : null}
      {open ? (
        <ul className={detailList} aria-label={INSTALL.details}>
          {speech && name !== id ? (
            <li className={detailLine}>
              <span className={detailKey}>ID</span>
              <span className={detailRepo}>{id}</span>
            </li>
          ) : null}
          {engine ? (
            <li className={detailLine}>
              <span className={detailKey}>{TTS.engine}</span>
              <span>{engine}</span>
            </li>
          ) : null}
          {licenses.map((line) => (
            <li key={line.part} className={detailLine}>
              <span className={detailKey}>{TTS.license}</span>
              <span>{licenseLineText(line, licenses.length)}</span>
              <span className={detailLink}>{line.license.url}</span>
            </li>
          ))}
          {bundle.components?.length ? (
            bundle.components.map((c) => (
              <li key={`${c.component}:${c.repo}`} className={detailLine}>
                <span>{componentLabel(c.component)}</span>
                <span className={detailRepo}>
                  {c.repo}@{c.revision.slice(0, 7)}
                </span>
                <span>{INSTALL.componentLine(c.state, c.bytes !== null ? fmtSize(c.bytes) : null)}</span>
                {c.sharedWith.length ? <span>{INSTALL.sharedWith(c.sharedWith)}</span> : null}
              </li>
            ))
          ) : (
            <li className={detailLine}>{INSTALL.noComponents}</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
