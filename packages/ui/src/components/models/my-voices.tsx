import { useEffect, useMemo, useRef, useState, type Key } from 'react';
import { intlLocale, type JobRecord, type LibraryEntrySummary, type MediaHandle } from '@baocut/protocol';
import {
  ActionButton,
  AlertDialog,
  Button,
  Content,
  DialogContainer,
  Heading,
  InlineAlert,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  ProgressCircle,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import AddIcon from '@react-spectrum/s2/icons/Add';
import AlertIcon from '@react-spectrum/s2/icons/AlertTriangle';
import CheckmarkIcon from '@react-spectrum/s2/icons/CheckmarkCircle';
import InfoIcon from '@react-spectrum/s2/icons/InfoCircle';
import ImportIcon from '@react-spectrum/s2/icons/Import';
import MicrophoneIcon from '@react-spectrum/s2/icons/Microphone';
import MoreIcon from '@react-spectrum/s2/icons/More';
import PauseIcon from '@react-spectrum/s2/icons/Pause';
import PlayIcon from '@react-spectrum/s2/icons/Play';
import UploadIcon from '@react-spectrum/s2/icons/Upload';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  cloneProviders,
  cloneRows,
  deleteBody,
  handoffOutcome,
  isVoiceAudioPath,
  rpcErrorText,
  uploadNotice,
  voiceChips,
  voiceMeta,
  voicePackageName,
  VOICE_AUDIO_EXTENSIONS,
  VOICE_PACKAGE_EXTENSION,
  type CloneAttempt,
  type CloneProvider,
  type CloneRow,
  type VoiceEntry,
} from '../../model/voices-library.ts';
import { diagnoseCloneFailure, type CloneDiagnosis } from '../../model/voice-clone-failure.ts';
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useConnection } from '../../state/connection-store.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useVoiceClones } from '../../state/voice-clone-store.ts';
import { useVoiceHandoff } from '../../state/voice-handoff-store.ts';
import { useVoices } from '../../state/voices-store.ts';
import { localSpeechModels } from '../../model/models-tts-local.ts';
import {
  cloneTargets,
  consentLanguageName,
  consentProviders,
  FALLBACK_SEED,
  randomSeed,
  reseedTargets,
  seedGroups,
  voiceIdBindings,
  VOICE_CONSENT_CUSTOM,
  type CloneTarget,
} from '../../model/voice-capture.ts';
import { auditionBundle } from '../../model/tts-quick-test.ts';
import { M } from '../settings/general-settings-copy.ts';
import { TTS_LOCAL_COPY as TTS } from './tts-local-copy.ts';
import { useVoiceEntries } from './use-voice-entries.ts';
import { auditionHandle, deleteVoice, exportVoice, importVoicePackage, removeClone, reseedVoice, uploadClone } from './voice-actions.ts';
import { ConsentCapture, VoiceCapture } from './voice-capture.tsx';
import { VoiceDialog, type VoiceDialogMode } from './voice-dialog.tsx';
import { Card, Chips, EmptyCard, Lede, PageStatus } from './model-parts.tsx';
import { quoted, VOICES_COPY } from './models-copy.ts';
import { CAPTURE_COPY as CC, MY_VOICES_COPY as COPY } from './voices-copy.ts';

const bigIcon = iconStyle({ size: 'XL' });
const row = style({
  paddingY: 12,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const head = style({ display: 'flex', alignItems: 'start', gap: 12 });
const main = style({ flexGrow: 1, flexBasis: 0, minWidth: 0 });
const nameLine = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 });
const nameText = style({ font: 'ui', fontWeight: 'medium', color: 'gray-900', overflowWrap: 'anywhere', userSelect: 'text' });
const meta = style({ marginTop: 4, font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const transcript = style({ marginTop: 4, font: 'ui-xs', color: 'gray-700', overflowWrap: 'anywhere', lineClamp: 2, userSelect: 'text' });
const rowNote = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  marginTop: 4,
  marginBottom: 0,
  paddingStart: 40,
  font: 'ui-xs',
  overflowWrap: 'anywhere',
  color: 'gray-700',
});
const rowEta = style({ color: 'gray-600' });
const rowAlert = style({ marginTop: 8, marginStart: 40 });
const alertBody = style({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 8 });
const alertText = style({ margin: 0, overflowWrap: 'anywhere' });
const alertDetail = style({ margin: 0, font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere', userSelect: 'text' });
const handoffBar = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  marginBottom: 16,
  paddingX: 12,
  paddingY: 8,
  borderRadius: 'lg',
  backgroundColor: { default: 'informative-subtle', tone: { positive: 'positive-subtle', negative: 'negative-subtle' } },
  font: 'ui-sm',
  color: 'gray-900',
});
const handoffText = style({ flexGrow: 1, flexBasis: 0, minWidth: 200 });
const handoffEta = style({ font: 'ui-xs', color: 'gray-700' });
const foot = style({
  marginTop: 16,
  marginBottom: 0,
  paddingTop: 12,
  borderTopWidth: 1,
  borderXWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  font: 'ui-xs',
  color: 'gray-600',
});

type Confirm =
  | { kind: 'delete'; voice: LibraryEntrySummary }
  | { kind: 'upload'; voice: LibraryEntrySummary; providerId: string; label: string }
  | { kind: 'remove-clone'; voice: LibraryEntrySummary; providerId: string; label: string }
  /** 远端的克隆删不掉：要不要只删本机的（音色整只，或只是这一个克隆的记录）。 */
  | { kind: 'local-only'; scope: 'voice' | 'clone'; voice: LibraryEntrySummary; providerId: string; label: string; message: string };

/**
 * 模型 › 语音合成 › 我的声音（设计稿 settings-voices.jsx:480-541）：用户库里的音色（`library` 主题经 voices-store）。
 * 从音频文件新建、克隆新音色（录一段或上传一段样本，voice-capture.tsx）、导入导出音色包、编辑、删除、试听参考录音，
 * 补录授权声明、换种子，以及在能克隆的云端引擎上建 / 删克隆。宿主没有 `writeRecording` 时克隆新音色置灰。
 * 浏览器里没有这一页的数据：Web 白名单不含 `library.*`，订阅不了 `library` 主题，那里不写「加载中」，直接说浏览器里没有。
 */
export function MyVoices() {
  const runtime = useRuntime();
  const host = runtime.host;
  const connected = useConnection((s) => s.state.status === 'connected');
  const ready = useVoices((s) => s.ready);
  const voices = useVoices((s) => s.voices);
  const capabilities = useModels((s) => s.capabilities);
  const jobs = useJobs((s) => s.jobs);
  const providers = useMemo(() => cloneProviders(capabilities), [capabilities]);
  const entryOf = useVoiceEntries(runtime, connected ? voices : []);
  const audition = useAudition(runtime);
  const [dialog, setDialog] = useState<VoiceDialogMode | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const bundles = useModels((s) => s.bundles);
  const speech = useMemo(() => localSpeechModels(capabilities), [capabilities]);
  const goTo = useShell((s) => s.go);
  const setFocus = useVoiceHandoff((s) => s.setFocus);
  const saved = useVoiceHandoff((s) => s.saved);
  const handoff = useVoiceHandoff((s) => s.handoff);
  const setHandoff = useVoiceHandoff((s) => s.setHandoff);
  const targets = useMemo(() => cloneTargets(capabilities), [capabilities]);
  const attempts = useVoiceClones((s) => s.attempts);
  const canCapture = !!host.writeRecording;
  const [view, setView] = useState<
    | { kind: 'capture'; preselect: string | null }
    /** 补录 / 重录授权声明；从克隆失败的补救过来时带上要重新上传的那家与那次的「怎么办」。 */
    | { kind: 'consent'; voice: LibraryEntrySummary; resubmit?: { providerId: string; label: string }; tip?: string | null }
    | null
  >(null);

  /** 上传建克隆（⋯ 里确认过的、失败后的「重新上传」）：进度与结果在那一行。 */
  const upload = async (voice: LibraryEntrySummary, providerId: string, label: string) => {
    if (await uploadClone(runtime, voice.id, providerId)) ToastQueue.neutral(COPY.cloneStarted(label), { timeout: 4000 });
    else ToastQueue.negative(COPY.cloneRejected(label), { timeout: 8000 });
  };

  /** 克隆失败那一块的一键补救。 */
  const fix = (voice: LibraryEntrySummary, row: CloneRow, diagnosis: CloneDiagnosis) => {
    switch (diagnosis.fix?.kind) {
      case 'reconsent':
      case 'record-consent':
        if (canCapture) setView({ kind: 'consent', voice, resubmit: { providerId: row.providerId, label: row.label }, tip: diagnosis.advice });
        return;
      case 'resample':
        if (canCapture) setView({ kind: 'capture', preselect: row.providerId });
        return;
      case 'retry':
        void upload(voice, row.providerId, row.label);
        return;
      case 'provider':
        goTo({ tab: 'settings', section: 'providers', providerId: row.providerId });
        return;
      case 'privacy':
        goTo({ tab: 'settings', section: 'privacy' });
        return;
      case 'edit':
        setDialog({ kind: 'edit', voice });
        return;
      default:
        return;
    }
  };

  // 从模型页那一行的「克隆新音色」过来：直接打开采集、预选那只模型；打开一次就把 `open` 摘掉，回来不再自动开。
  useEffect(() => {
    if (!handoff?.open || handoff.voiceId) return;
    setHandoff({ ...handoff, open: undefined });
    if (canCapture) setView({ kind: 'capture', preselect: handoff.target?.id ?? null });
  }, [handoff, canCapture, setHandoff]);

  const reseed = async (voice: LibraryEntrySummary, modelId: string) => {
    const entry = entryOf(voice);
    if (!entry) return;
    const seed = randomSeed();
    const engine = modelId === FALLBACK_SEED ? CC.allEngines : (targets.find((t) => t.id === modelId)?.name ?? modelId);
    try {
      await reseedVoice(runtime, entry, modelId, seed);
      ToastQueue.positive(CC.reseeded(engine, seed), { timeout: 4000 });
    } catch (error) {
      ToastQueue.negative(CC.reseedFailed(rpcErrorText(error)), { timeout: 8000 });
    }
  };

  /** 试听克隆：到本地模型页能克隆的那一行，展开试听、选上这只音色；一只都没装时说去下载。 */
  const auditionClone = (voice: LibraryEntrySummary) => {
    const bundleId = auditionBundle(bundles, speech);
    const local = { tab: 'models', category: 'tts' } as const;
    if (!bundleId) {
      ToastQueue.info(TTS.noCloneModel, { actionLabel: TTS.goLocal, onAction: () => goTo(local), shouldCloseOnAction: true });
      return;
    }
    setFocus({ bundleId, voice: `my:${voice.id}` });
    goTo(local);
  };

  const pickAudio = async () => {
    const paths = host.pickFiles
      ? await host.pickFiles({
          title: COPY.pickAudioTitle,
          buttonLabel: COPY.pickButton,
          filters: [{ name: COPY.pickAudioFilter, extensions: [...VOICE_AUDIO_EXTENSIONS] }],
        })
      : await host.pickMediaFiles();
    const path = paths[0];
    if (!path) return;
    if (!isVoiceAudioPath(path)) {
      ToastQueue.negative(COPY.notAudio, { timeout: 5000 });
      return;
    }
    setDialog({ kind: 'create', path });
  };

  const importPackage = async () => {
    if (!host.pickFiles) return;
    const [path] = await host.pickFiles({
      title: COPY.pickPackageTitle,
      buttonLabel: COPY.pickButton,
      filters: [{ name: COPY.pickPackageFilter, extensions: [VOICE_PACKAGE_EXTENSION] }],
    });
    if (!path) return;
    try {
      const entry = await importVoicePackage(runtime, path);
      ToastQueue.positive(COPY.imported(entry.content.name), { timeout: 4000 });
    } catch (error) {
      ToastQueue.negative(COPY.importFailed(rpcErrorText(error)), { timeout: 8000 });
    }
  };

  const exportIt = async (voice: LibraryEntrySummary) => {
    if (!host.pickSavePath) return;
    const path = await host.pickSavePath({
      title: COPY.exportTitle,
      buttonLabel: COPY.exportButton,
      defaultName: voicePackageName(voice.name),
      filters: [{ name: COPY.pickPackageFilter, extensions: [VOICE_PACKAGE_EXTENSION] }],
    });
    if (!path) return;
    try {
      const result = await exportVoice(runtime, voice, path);
      ToastQueue.positive(COPY.exported(result.path), { timeout: 5000 });
    } catch (error) {
      // 目标已存在时 Runtime 拒绝覆盖（`conflict`，没有更细的错误码）。
      const exists = (error as { code?: unknown }).code === 'conflict';
      const text = rpcErrorText(error);
      ToastQueue.negative(exists ? COPY.exportFailedExists(text) : COPY.exportFailed(text), { timeout: 8000 });
    }
  };

  const confirmed = async (c: Confirm) => {
    switch (c.kind) {
      case 'upload':
        await upload(c.voice, c.providerId, c.label);
        return;
      case 'remove-clone':
        try {
          const result = await removeClone(runtime, c.voice, c.providerId);
          ToastQueue.neutral(result.remote === 'not-found' ? COPY.cloneGoneRemote(c.label) : COPY.cloneRemoved(c.label), { timeout: 4000 });
        } catch (error) {
          setConfirm({ kind: 'local-only', scope: 'clone', voice: c.voice, providerId: c.providerId, label: c.label, message: rpcErrorText(error) });
        }
        return;
      case 'delete':
      case 'local-only': {
        if (c.kind === 'local-only' && c.scope === 'clone') {
          try {
            await removeClone(runtime, c.voice, c.providerId, true);
            ToastQueue.neutral(COPY.cloneRemoved(c.label), { timeout: 4000 });
          } catch (error) {
            ToastQueue.negative(COPY.cloneRemoveFailed(rpcErrorText(error)), { timeout: 8000 });
          }
          return;
        }
        try {
          const outcome = await deleteVoice(runtime, c.voice, c.kind === 'local-only');
          if (outcome.kind === 'deleted') {
            ToastQueue.neutral(COPY.deleted(c.voice.name), { timeout: 4000 });
          } else {
            const label = providers.find((p) => p.providerId === outcome.providerId)?.label ?? outcome.providerId;
            setConfirm({ kind: 'local-only', scope: 'voice', voice: c.voice, providerId: outcome.providerId, label, message: outcome.message });
          }
        } catch (error) {
          ToastQueue.negative(COPY.deleteFailed(rpcErrorText(error)), { timeout: 8000 });
        }
        return;
      }
    }
  };

  const recordItem = (
    <MenuItem id="record" textValue={CC.newVoice}>
      <MicrophoneIcon />
      <Text slot="label">{CC.newVoice}</Text>
      <Text slot="description">{CC.newVoiceHint}</Text>
    </MenuItem>
  );
  const addMenu = (
    <MenuTrigger>
      <Button variant="secondary" size="S">
        <AddIcon />
        <Text>{COPY.add}</Text>
      </Button>
      <Menu
        aria-label={COPY.add}
        disabledKeys={[...(canCapture ? [] : ['record']), ...(host.pickFiles ? [] : ['import'])]}
        onAction={(key) => {
          if (key === 'record') setView({ kind: 'capture', preselect: null });
          else if (key === 'file') void pickAudio();
          else if (key === 'import') void importPackage();
        }}>
        <MenuItem id="file" textValue={COPY.fromFile}>
          <UploadIcon />
          <Text slot="label">{COPY.fromFile}</Text>
          <Text slot="description">{COPY.fromFileHint}</Text>
        </MenuItem>
        <MenuItem id="import" textValue={COPY.importPackage}>
          <ImportIcon />
          <Text slot="label">{COPY.importPackage}</Text>
          <Text slot="description">{host.pickFiles ? COPY.importHint : COPY.noPicker}</Text>
        </MenuItem>
        {recordItem}
      </Menu>
    </MenuTrigger>
  );

  let body;
  if (host.platform === 'web') body = <PageStatus>{M.webUnavailable}</PageStatus>;
  else if (!connected) body = <PageStatus>{COPY.offline}</PageStatus>;
  else if (!ready) body = <PageStatus>{COPY.loading}</PageStatus>;
  else if (!voices.length) {
    body = (
      <EmptyCard
        icon={<MicrophoneIcon styles={bigIcon} data-bc-icons="own" />}
        title={VOICES_COPY.emptyTitle}
        body={VOICES_COPY.emptyBody}
        actions={
          <>
            <Button variant="accent" size="S" onPress={() => void pickAudio()}>
              <UploadIcon />
              <Text>{COPY.fromFile}</Text>
            </Button>
            <Button variant="secondary" size="S" isDisabled={!host.pickFiles} onPress={() => void importPackage()}>
              <ImportIcon />
              <Text>{COPY.importPackage}</Text>
            </Button>
            <Button variant="secondary" size="S" isDisabled={!canCapture} onPress={() => setView({ kind: 'capture', preselect: null })}>
              <MicrophoneIcon />
              <Text>{CC.newVoice}</Text>
            </Button>
          </>
        }
        note={host.pickFiles ? null : COPY.noPicker}
      />
    );
  } else {
    body = (
      <Card label={VOICES_COPY.title}>
        {voices.map((voice) => (
          <VoiceRow
            key={voice.id}
            voice={voice}
            entry={entryOf(voice)}
            providers={providers}
            targets={targets}
            jobs={jobs}
            attempts={attempts}
            canCapture={canCapture}
            playing={audition.playing === voice.id}
            canExport={!!host.pickSavePath}
            onPlay={() => void audition.toggle(voice)}
            onAudition={() => auditionClone(voice)}
            onEdit={() => setDialog({ kind: 'edit', voice })}
            onExport={() => void exportIt(voice)}
            onConfirm={setConfirm}
            onReseed={(modelId) => void reseed(voice, modelId)}
            onConsent={() => setView({ kind: 'consent', voice })}
            onFix={(row, diagnosis) => fix(voice, row, diagnosis)}
          />
        ))}
      </Card>
    );
  }

  if (view?.kind === 'capture' && connected) {
    return (
      <>
        <HandoffBar />
        <VoiceCapture
          targets={targets}
          preselect={view.preselect}
          onCancel={() => setView(null)}
          onSaved={(id) => {
            saved(id);
            setView(null);
          }}
        />
      </>
    );
  }
  const consentEntry = view?.kind === 'consent' ? entryOf(view.voice) : null;
  if (view?.kind === 'consent' && consentEntry && connected) {
    return (
      <ConsentCapture
        entry={consentEntry}
        needed={consentProviders(targets).map((t) => t.name)}
        resubmit={view.resubmit ?? null}
        tip={view.tip ?? null}
        onCancel={() => setView(null)}
        onSaved={() => setView(null)}
      />
    );
  }

  return (
    <>
      <HandoffBar />
      <Lede first title={VOICES_COPY.title} desc={VOICES_COPY.lede} action={connected && ready && voices.length ? addMenu : null} />
      {body}
      <p className={foot}>{COPY.foot}</p>

      {dialog ? <VoiceDialog mode={dialog} onClose={() => setDialog(null)} onCreated={saved} /> : null}

      <DialogContainer onDismiss={() => setConfirm(null)}>
        {confirm ? <ConfirmDialog confirm={confirm} entry={entryOf(confirm.voice)} providers={providers} onConfirm={() => void confirmed(confirm)} /> : null}
      </DialogContainer>
    </>
  );
}

/**
 * 回程条（设计稿 settings-voices.jsx `HandoffBar`）：从试听的「克隆新音色…」过来时写从哪儿来；存好一只后带回去用它。
 * 从模型页某家云端过来、存好之后，跟着那家的克隆走：在传（转圈与要多久）、建好了（回去的主按钮）、没建成（原因与补救在那一行）、
 * 这次没上传。不把人送去任务页。
 */
function HandoffBar() {
  const handoff = useVoiceHandoff((s) => s.handoff);
  const setHandoff = useVoiceHandoff((s) => s.setHandoff);
  const goTo = useShell((s) => s.go);
  const voices = useVoices((s) => s.voices);
  const capabilities = useModels((s) => s.capabilities);
  const jobs = useJobs((s) => s.jobs);
  const attempts = useVoiceClones((s) => s.attempts);
  if (!handoff) return null;
  const quick = handoff.key.startsWith('quick:');
  const back = () => {
    // 模型页那一行的回程没人认领：回去时清掉；试听那一行（`quick:`）回去后自己认领再清。
    if (!quick) setHandoff(null);
    goTo(handoff.route);
  };
  const voice = handoff.voiceId ? (voices.find((v) => v.id === handoff.voiceId) ?? null) : null;
  if (!quick && voice && handoff.target?.kind === 'cloud') {
    const rows = cloneRows(voice, cloneProviders(capabilities), jobs, attempts);
    const outcome = handoffOutcome(handoff.target, rows);
    const label = rows.find((r) => r.providerId === handoff.target!.id)?.label ?? handoff.target.id;
    if (outcome !== 'saved') {
      const tone = outcome === 'ready' ? 'positive' : outcome === 'failed' ? 'negative' : undefined;
      return (
        <div className={handoffBar({ tone })} role="status">
          {outcome === 'uploading' ? (
            <ProgressCircle size="S" isIndeterminate aria-label={COPY.cloning(label)} />
          ) : outcome === 'ready' ? (
            <CheckmarkIcon />
          ) : outcome === 'failed' ? (
            <AlertIcon />
          ) : (
            <InfoIcon />
          )}
          <span className={handoffText}>
            {outcome === 'uploading' ? (
              <>
                {CC.handoffUploading(label)} <span className={handoffEta}>{COPY.cloningEta}</span>
              </>
            ) : outcome === 'ready' ? (
              CC.handoffReady(voice.name, label)
            ) : outcome === 'failed' ? (
              CC.handoffFailed(voice.name, label)
            ) : (
              CC.handoffNotUploaded(label)
            )}
          </span>
          <Button variant={outcome === 'ready' ? 'accent' : 'secondary'} size="S" onPress={back}>
            {CC.backTo(handoff.from)}
          </Button>
        </div>
      );
    }
  }
  return (
    <div className={handoffBar({})} role="status">
      <InfoIcon />
      <span className={handoffText}>
        {quick
          ? handoff.voiceId
            ? TTS.handoffSaved(handoff.from)
            : TTS.handoffFrom(handoff.from)
          : handoff.voiceId
            ? CC.handoffSavedModel(handoff.from)
            : CC.handoffFromModel(handoff.from)}
      </span>
      {handoff.voiceId ? (
        <Button variant="accent" size="S" onPress={back}>
          {TTS.handoffBack}
        </Button>
      ) : (
        <ActionButton
          isQuiet
          size="S"
          onPress={() => {
            setHandoff(null);
            back();
          }}>
          <Text>{TTS.handoffCancel}</Text>
        </ActionButton>
      )}
    </div>
  );
}

function ConfirmDialog({
  confirm,
  entry,
  providers,
  onConfirm,
}: {
  confirm: Confirm;
  entry: VoiceEntry | null;
  providers: readonly CloneProvider[];
  onConfirm: () => void;
}) {
  switch (confirm.kind) {
    case 'delete':
      return (
        <AlertDialog
          variant="destructive"
          title={COPY.deleteTitle(confirm.voice.name)}
          primaryActionLabel={COPY.deleteConfirm}
          cancelLabel={COPY.cancel}
          onPrimaryAction={onConfirm}>
          {deleteBody(confirm.voice, providers)}
        </AlertDialog>
      );
    case 'upload':
      return (
        <AlertDialog
          variant="confirmation"
          title={COPY.uploadTitle(confirm.label)}
          primaryActionLabel={COPY.upload}
          cancelLabel={COPY.cancel}
          onPrimaryAction={onConfirm}>
          {uploadNotice(confirm.voice, confirm.label, entry)}
        </AlertDialog>
      );
    case 'remove-clone':
      return (
        <AlertDialog
          variant="destructive"
          title={COPY.removeCloneTitle(confirm.label)}
          primaryActionLabel={COPY.removeCloneConfirm}
          cancelLabel={COPY.cancel}
          onPrimaryAction={onConfirm}>
          {COPY.removeCloneBody(confirm.label)}
        </AlertDialog>
      );
    case 'local-only':
      return (
        <AlertDialog
          variant="warning"
          title={COPY.localOnlyTitle(confirm.label)}
          primaryActionLabel={COPY.localOnlyConfirm}
          cancelLabel={COPY.later}
          onPrimaryAction={onConfirm}>
          {COPY.localOnlyBody(confirm.label, confirm.message)}
        </AlertDialog>
      );
  }
}

/** 行上「种子与 voice ID」那一行：种子按值合并写引擎名，云端写 voice ID，再写授权声明录音。没有时 null。 */
function idsLine(entry: VoiceEntry, targets: readonly CloneTarget[], providers: readonly CloneProvider[]): string | null {
  const engineName = (id: string) => targets.find((t) => t.id === id)?.name ?? id;
  const groups = seedGroups(entry.content);
  const seeds = groups.map((g) => {
    const names = g.ids.map((id) => (id === FALLBACK_SEED ? (groups.length === 1 && g.ids.length === 1 ? CC.allEngines : CC.otherEngines) : engineName(id)));
    return CC.seedGroup(g.value, names.join(' / '));
  });
  const ids = voiceIdBindings(entry.clones).map((b) => {
    const label = providers.find((p) => p.providerId === b.providerId)?.label ?? b.providerId;
    return `${label} ${b.voiceId}${b.stale ? ` (${CC.voiceIdStale})` : ''}`;
  });
  const clip = entry.content.consentClip;
  const clipText = clip
    ? (() => {
        const language = clip.language === VOICE_CONSENT_CUSTOM ? CC.customLanguage : consentLanguageName(clip.language, intlLocale());
        return clip.durationSec === null ? CC.consentClipNoLength(language) : CC.consentClip(language, clip.durationSec.toFixed(1));
      })()
    : null;
  const parts = [...seeds, ...ids, ...(clipText ? [clipText] : [])];
  return parts.length ? parts.join(' · ') : null;
}

/**
 * 一行音色：试听、名字与标签、语言 / 录音 / 来源、逐字稿、种子与 voice ID；⋯ 里是编辑、换种子、授权声明、克隆、导出与删除；
 * 下面是克隆在跑（转圈与要多久）或没建成（原因、怎么办、一键补救与原话）。
 */
function VoiceRow({
  voice,
  entry,
  providers,
  targets,
  jobs,
  attempts,
  canCapture,
  playing,
  canExport,
  onPlay,
  onAudition,
  onEdit,
  onExport,
  onConfirm,
  onReseed,
  onConsent,
  onFix,
}: {
  voice: LibraryEntrySummary;
  entry: VoiceEntry | null;
  providers: readonly CloneProvider[];
  targets: readonly CloneTarget[];
  jobs: readonly JobRecord[];
  attempts: Readonly<Record<string, CloneAttempt>>;
  canCapture: boolean;
  playing: boolean;
  canExport: boolean;
  onPlay: () => void;
  onAudition: () => void;
  onEdit: () => void;
  onExport: () => void;
  onConfirm: (confirm: Confirm) => void;
  onReseed: (modelId: string) => void;
  onConsent: () => void;
  onFix: (row: CloneRow, diagnosis: CloneDiagnosis) => void;
}) {
  const clones = cloneRows(voice, providers, jobs, attempts);
  const disabled: string[] = canExport ? [] : ['export'];
  if (!entry || !canCapture) disabled.push('consent');
  const reseedItems = entry
    ? reseedTargets(entry.content, targets).map((modelId) => {
        const id = `reseed:${modelId}`;
        const engine = targets.find((t) => t.id === modelId)?.name ?? modelId;
        const now = entry.content.seeds?.[modelId] ?? entry.content.seed;
        return (
          <MenuItem key={id} id={id} textValue={CC.reseed(engine)}>
            <Text slot="label">{CC.reseed(engine)}</Text>
            {now !== undefined ? <Text slot="description">{CC.reseedNow(now)}</Text> : null}
          </MenuItem>
        );
      })
    : [];
  const ids = entry ? idsLine(entry, targets, providers) : null;
  const cloneItems = clones.flatMap((c) => {
    const items = [];
    if (c.create) {
      const id = `${c.state === 'stale' ? 'reclone' : 'clone'}:${c.providerId}`;
      if (!c.create.enabled) disabled.push(id);
      const label = c.state === 'stale' ? COPY.recloneTo(c.label) : COPY.cloneTo(c.label);
      const hint = c.create.why ?? (c.state === 'stale' ? COPY.recloneHint : null);
      items.push(
        <MenuItem key={id} id={id} textValue={label}>
          <Text slot="label">{label}</Text>
          {hint ? <Text slot="description">{hint}</Text> : null}
        </MenuItem>,
      );
    }
    if (c.state !== 'none') {
      const id = `unclone:${c.providerId}`;
      if (!c.removable) disabled.push(id);
      items.push(
        <MenuItem key={id} id={id} textValue={COPY.removeClone(c.label)}>
          <Text slot="label">{COPY.removeClone(c.label)}</Text>
        </MenuItem>,
      );
    }
    return items;
  });

  const act = (key: Key) => {
    const k = String(key);
    if (k === 'edit') return onEdit();
    if (k === 'export') return onExport();
    if (k === 'delete') return onConfirm({ kind: 'delete', voice });
    if (k === 'consent') return onConsent();
    if (k.startsWith('reseed:')) return onReseed(k.slice('reseed:'.length));
    const [action, providerId] = k.split(':') as [string, string];
    const label = clones.find((c) => c.providerId === providerId)?.label ?? providerId;
    if (action === 'clone' || action === 'reclone') onConfirm({ kind: 'upload', voice, providerId, label });
    else if (action === 'unclone') onConfirm({ kind: 'remove-clone', voice, providerId, label });
  };

  return (
    <div className={row}>
      <div className={head}>
        <ActionButton isQuiet size="S" aria-label={playing ? COPY.stop(voice.name) : COPY.play(voice.name)} onPress={onPlay}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </ActionButton>
        <div className={main}>
          <div className={nameLine}>
            <span className={nameText}>{voice.name}</span>
            <Chips chips={voiceChips(voice, providers)} />
          </div>
          <div className={meta}>{entry ? voiceMeta(entry) : COPY.loadingMeta}</div>
          {entry?.content.transcript ? <div className={transcript}>{quoted(entry.content.transcript)}</div> : null}
          {ids ? (
            <div className={meta} aria-label={CC.ids}>
              {ids}
            </div>
          ) : null}
        </div>
        <Button variant="secondary" size="S" aria-label={TTS.auditionCloneLabel(voice.name)} onPress={onAudition}>
          {TTS.auditionClone}
        </Button>
        <MenuTrigger>
          <ActionButton isQuiet size="S" aria-label={COPY.more(voice.name)}>
            <MoreIcon />
          </ActionButton>
          <Menu aria-label={COPY.more(voice.name)} disabledKeys={disabled} onAction={act}>
            <MenuSection>
              <MenuItem id="edit" textValue={COPY.edit}>
                <Text slot="label">{COPY.edit}</Text>
              </MenuItem>
              {reseedItems}
              <MenuItem id="consent" textValue={entry?.content.consentClip ? CC.redoConsent : CC.recordConsent}>
                <Text slot="label">{entry?.content.consentClip ? CC.redoConsent : CC.recordConsent}</Text>
                <Text slot="description">{CC.consentMenuHint}</Text>
              </MenuItem>
            </MenuSection>
            {cloneItems.length ? <MenuSection>{cloneItems}</MenuSection> : null}
            <MenuSection>
              <MenuItem id="export" textValue={COPY.export}>
                <Text slot="label">{COPY.export}</Text>
                <Text slot="description">{canExport ? voicePackageName(voice.name) : COPY.noPicker}</Text>
              </MenuItem>
              <MenuItem id="delete" textValue={COPY.remove}>
                <Text slot="label">{COPY.remove}</Text>
              </MenuItem>
            </MenuSection>
          </Menu>
        </MenuTrigger>
      </div>
      {clones
        .filter((c) => c.running)
        .map((c) => (
          <div key={`run:${c.providerId}`} className={rowNote} role="status">
            <ProgressCircle size="S" isIndeterminate aria-label={COPY.cloning(c.label)} />
            <span>{COPY.cloning(c.label)}</span>
            <span className={rowEta}>{COPY.cloningEta}</span>
          </div>
        ))}
      {clones
        .filter((c) => c.failure && !c.running)
        .map((c) => (
          <CloneFailureAlert
            key={`fail:${c.providerId}`}
            row={c}
            diagnosis={diagnoseCloneFailure(c.failure!)}
            canCapture={canCapture}
            onFix={onFix}
          />
        ))}
    </div>
  );
}

/** 克隆没建成：原因与怎么办、一键补救，Provider 的原话放在最后（字小一些，能选中复制）。 */
function CloneFailureAlert({
  row,
  diagnosis,
  canCapture,
  onFix,
}: {
  row: CloneRow;
  diagnosis: CloneDiagnosis;
  canCapture: boolean;
  onFix: (row: CloneRow, diagnosis: CloneDiagnosis) => void;
}) {
  const fix = diagnosis.fix;
  // 要录音的补救在没有录音能力的宿主上不给。
  const usable = fix && (canCapture || !['reconsent', 'record-consent', 'resample'].includes(fix.kind));
  return (
    <InlineAlert variant="negative" styles={rowAlert}>
      <Heading>{COPY.cloneFailedTitle(row.label)}</Heading>
      <Content>
        <div className={alertBody}>
          <p className={alertText}>{diagnosis.advice ? `${diagnosis.cause} ${diagnosis.advice}` : diagnosis.cause}</p>
          {diagnosis.detail ? <p className={alertDetail}>{diagnosis.detail}</p> : null}
          {usable ? (
            <Button variant="secondary" size="S" onPress={() => onFix(row, diagnosis)}>
              {fix.label}
            </Button>
          ) : null}
        </div>
      </Content>
    </InlineAlert>
  );
}

/** 试听参考录音：同一时间只放一只；受限地址按录音摘要记着，到期了再要。 */
function useAudition(runtime: RuntimeSession) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const handles = useRef(new Map<string, MediaHandle>());
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(
    () => () => {
      audio.current?.pause();
    },
    [],
  );

  const toggle = async (voice: LibraryEntrySummary) => {
    const el = audio.current ?? (audio.current = new Audio());
    el.pause();
    if (playing === voice.id) {
      setPlaying(null);
      return;
    }
    const key = `${voice.id}@${voice.contentHash}`;
    try {
      const handle = await auditionHandle(runtime, voice, handles.current.get(key) ?? null);
      handles.current.set(key, handle);
      el.src = handle.url;
      el.onended = () => setPlaying(null);
      setPlaying(voice.id);
      await el.play();
    } catch (error) {
      setPlaying(null);
      ToastQueue.negative(COPY.playFailed(rpcErrorText(error)), { timeout: 5000 });
    }
  };

  return { playing, toggle };
}
