import { useEffect, useMemo, useRef, useState, type Key } from 'react';
import type { JobRecord, LibraryEntrySummary, MediaHandle } from '@baocut/protocol';
import {
  ActionButton,
  AlertDialog,
  Button,
  DialogContainer,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import AddIcon from '@react-spectrum/s2/icons/Add';
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
  isVoiceAudioPath,
  rpcErrorText,
  uploadNotice,
  voiceChips,
  voiceMeta,
  voicePackageName,
  VOICE_AUDIO_EXTENSIONS,
  VOICE_PACKAGE_EXTENSION,
  type CloneProvider,
  type VoiceEntry,
} from '../../model/voices-library.ts';
import { useRuntime } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useConnection } from '../../state/connection-store.ts';
import { useJobs } from '../../state/jobs-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useVoiceHandoff } from '../../state/voice-handoff-store.ts';
import { useVoices } from '../../state/voices-store.ts';
import { localSpeechModels } from '../../model/models-tts-local.ts';
import { auditionBundle } from '../../model/tts-quick-test.ts';
import { TTS_LOCAL_COPY as TTS } from './tts-local-copy.ts';
import { auditionHandle, cloneVoice, deleteVoice, exportVoice, importVoicePackage, loadVoice, removeClone } from './voice-actions.ts';
import { VoiceDialog, type VoiceDialogMode } from './voice-dialog.tsx';
import { Card, Chips, EmptyCard, Lede, PageStatus } from './model-parts.tsx';
import { quoted, VOICES_COPY } from './models-copy.ts';
import { MY_VOICES_COPY as COPY } from './voices-copy.ts';

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
  marginTop: 4,
  marginBottom: 0,
  paddingStart: 40,
  font: 'ui-xs',
  overflowWrap: 'anywhere',
  color: { default: 'gray-700', isFailed: 'negative-900' },
});
const handoffBar = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  marginBottom: 16,
  paddingX: 12,
  paddingY: 8,
  borderRadius: 'lg',
  backgroundColor: 'informative-subtle',
  font: 'ui-sm',
  color: 'gray-900',
});
const handoffText = style({ flexGrow: 1, flexBasis: 0, minWidth: 200 });
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
 * 从音频文件新建、导入导出音色包、编辑、删除、试听参考录音，以及在能克隆的云端引擎上建 / 删克隆。
 * 应用里录音与「从视频里分人取一段」还没有接上：入口置灰，原因写在旁边。
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

  /** 试听克隆：到本地模型页能克隆的那一行，展开试听、选上这只音色；一只都没装时说去下载。 */
  const auditionClone = (voice: LibraryEntrySummary) => {
    const bundleId = auditionBundle(bundles, speech);
    const local = { tab: 'models', category: 'tts', page: 'local' } as const;
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
        try {
          await cloneVoice(runtime, c.voice, c.providerId);
          ToastQueue.neutral(COPY.cloneStarted(c.label), { timeout: 4000 });
        } catch (error) {
          ToastQueue.negative(COPY.cloneRejected(rpcErrorText(error)), { timeout: 8000 });
        }
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
    <MenuItem id="record" textValue={COPY.record}>
      <MicrophoneIcon />
      <Text slot="label">{COPY.record}</Text>
      <Text slot="description">{COPY.recordWhy}</Text>
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
        disabledKeys={['record', ...(host.pickFiles ? [] : ['import'])]}
        onAction={(key) => {
          if (key === 'file') void pickAudio();
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
  if (!connected) body = <PageStatus>{COPY.offline}</PageStatus>;
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
            <Button variant="secondary" size="S" isDisabled>
              <MicrophoneIcon />
              <Text>{COPY.record}</Text>
            </Button>
          </>
        }
        note={host.pickFiles ? COPY.recordWhy : COPY.recordWhyNoPicker}
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
            jobs={jobs}
            playing={audition.playing === voice.id}
            canExport={!!host.pickSavePath}
            onPlay={() => void audition.toggle(voice)}
            onAudition={() => auditionClone(voice)}
            onEdit={() => setDialog({ kind: 'edit', voice })}
            onExport={() => void exportIt(voice)}
            onConfirm={setConfirm}
          />
        ))}
      </Card>
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

/** 回程条（设计稿 settings-voices.jsx `HandoffBar`）：从试听的「克隆新音色…」过来时写从哪儿来；存好一只后带回去用它。 */
function HandoffBar() {
  const handoff = useVoiceHandoff((s) => s.handoff);
  const setHandoff = useVoiceHandoff((s) => s.setHandoff);
  const goTo = useShell((s) => s.go);
  if (!handoff) return null;
  const back = () => goTo(handoff.route);
  return (
    <div className={handoffBar} role="status">
      <InfoIcon />
      <span className={handoffText}>{handoff.voiceId ? TTS.handoffSaved(handoff.from) : TTS.handoffFrom(handoff.from)}</span>
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

/** 一行音色：试听、名字与标签、语言 / 录音 / 来源、逐字稿；⋯ 里是编辑、克隆、导出与删除；下面是克隆在跑或失败的一句。 */
function VoiceRow({
  voice,
  entry,
  providers,
  jobs,
  playing,
  canExport,
  onPlay,
  onAudition,
  onEdit,
  onExport,
  onConfirm,
}: {
  voice: LibraryEntrySummary;
  entry: VoiceEntry | null;
  providers: readonly CloneProvider[];
  jobs: readonly JobRecord[];
  playing: boolean;
  canExport: boolean;
  onPlay: () => void;
  onAudition: () => void;
  onEdit: () => void;
  onExport: () => void;
  onConfirm: (confirm: Confirm) => void;
}) {
  const clones = cloneRows(voice, providers, jobs);
  const disabled: string[] = canExport ? [] : ['export'];
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
          <p key={`run:${c.providerId}`} className={rowNote({})}>
            {COPY.cloning(c.label)}
          </p>
        ))}
      {clones
        .filter((c) => c.failure && !c.running)
        .map((c) => (
          <p key={`fail:${c.providerId}`} className={rowNote({ isFailed: true })}>
            {COPY.cloneFailed(c.label, c.failure!)}
          </p>
        ))}
    </div>
  );
}

/**
 * 每只音色的完整条目（语言、逐字稿、录音大小不在摘要里）：按 `id@version` 记着，版本变了才重读；
 * 列表与标签不等它，读到之前那一行写「正在读取…」。
 */
function useVoiceEntries(runtime: RuntimeSession, voices: readonly LibraryEntrySummary[]): (voice: LibraryEntrySummary) => VoiceEntry | null {
  const [entries, setEntries] = useState<Record<string, VoiceEntry>>({});
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const voice of voices) {
      const key = `${voice.id}@${voice.version}`;
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      loadVoice(runtime, voice.id).then(
        (entry) => setEntries((prev) => ({ ...prev, [key]: entry, [`${entry.id}@${entry.version}`]: entry })),
        () => {
          // 读不到（例如刚被删掉）：那一行就不显示细节，不反复重读。
        },
      );
    }
  }, [runtime, voices]);
  return (voice) => entries[`${voice.id}@${voice.version}`] ?? null;
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
