import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { localizeText, type ImageModelInfo, type JobRecord, type ModelBundleStatus, type ModelComponentStatus, type MusicModelInfo, type SpeechModelInfo } from '@baocut/protocol';
import {
  ActionButton,
  AlertDialog,
  Button,
  DialogContainer,
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
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
import AlertTriangleIcon from '@react-spectrum/s2/icons/AlertTriangle';
import CheckmarkCircleIcon from '@react-spectrum/s2/icons/CheckmarkCircle';
import ChevronDownIcon from '@react-spectrum/s2/icons/ChevronDown';
import ChevronRightIcon from '@react-spectrum/s2/icons/ChevronRight';
import DeleteIcon from '@react-spectrum/s2/icons/Delete';
import DownloadIcon from '@react-spectrum/s2/icons/Download';
import MoreIcon from '@react-spectrum/s2/icons/More';
import PauseIcon from '@react-spectrum/s2/icons/Pause';
import SearchIcon from '@react-spectrum/s2/icons/Search';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  bundleActions,
  installFailure,
  installFailureText,
  installProgressView,
  problemText,
  removalBody,
  removalEstimate,
  removedToast,
  rpcProblem,
} from '../../model/models-install.ts';
import { checkDetailLines, checkLineView, hasCheck, tryNotice, type CheckAbilities } from '../../model/model-check.ts';
import { checkCaption, CHECK_HEAD, CHECK_LABEL, TRY_SUBJECT_IMAGE, TRY_SUBJECT_MUSIC } from '../../model/model-check-copy.ts';
import {
  bundleChips,
  bundleFacts,
  bundleName,
  canReenable,
  componentDesc,
  componentLabel,
  componentSource,
  hasOwnFiles,
  installingPlacement,
  isBundleInstalled,
  licenseLines,
  licenseLineText,
  localDefaultPicker,
  localGroups,
  localImageModels,
  localMusicModels,
  LOCAL_PROVIDER,
  missingParts,
  needBytes,
  sharedAction,
  sharedComponents,
  sharedRepair,
  sharedUsage,
  VIEW_CAPABILITY,
  type LocalDefaultCapability,
  type SharedComponent,
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
import { useMusicQuick } from '../../state/music-quick-store.ts';
import { useTtsQuick } from '../../state/tts-quick-store.ts';
import { useVoiceHandoff } from '../../state/voice-handoff-store.ts';
import { ImageTryDialog } from './image-try-dialog.tsx';
import { InstallDialog } from './install-dialog.tsx';
import { removeBundle, stopInstall, type InstallMode } from './local-model-actions.ts';
import { LOCAL_INSTALL_COPY as INSTALL, LOCAL_SHARED_COPY as SHARED } from './local-models-copy.ts';
import { chooseLocalDefault } from './model-actions.ts';
import { ModelCheckLine } from './model-check-line.tsx';
import { Card, Chips, EmptyCard, PageStatus, SettingRow } from './model-parts.tsx';
import { DownloadSourcesFold } from './download-sources.tsx';
import { IMAGE_LOCAL_COPY as IMAGE, LOCAL_COPY, MODELS_PAGE_COPY } from './models-copy.ts';
import { TTS_LOCAL_COPY as TTS } from './tts-local-copy.ts';
import { TtsQuickTest } from './tts-quick-test.tsx';
import { MusicQuickTest } from './music-quick-test.tsx';
import { MUSIC_LOCAL_COPY as MUSIC } from './music-local-copy.ts';
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
const fold = style({ marginTop: 24 });
const foldSummary = style({ marginStart: 8, font: 'ui-sm', fontWeight: 'normal', color: 'gray-600' });
const sideNote = style({ font: 'ui-xs', color: 'gray-600' });
/** 浏览器里为什么这些按钮是灰的：与通用页、下载来源一行的原因同一档。 */
const webNote = style({ marginTop: 0, marginBottom: 16, font: 'ui-sm', color: 'gray-800', overflowWrap: 'anywhere' });
const okIcon = iconStyle({ size: 'S', color: 'positive' });
const missIcon = iconStyle({ size: 'S', color: 'notice' });

type Confirm = { kind: 'remove' | 'discard'; bundle: ModelBundleStatus };
/** 打开着的下载 / 补齐 / 修复对话框；`note` 是从公共组件那一行借模型补齐时换上的那一句。 */
type Install = { bundle: ModelBundleStatus; mode: InstallMode; note?: string };
/** 浏览器里：检查状态与试用的提示里不给「修复」「重新检查」。 */
const NO_CHECK: CheckAbilities = { repair: false, recheck: false };

/**
 * 模型 › 本地模型（设计稿 settings-local.jsx:200-308）：`models` 主题里的模型包按「已安装 / 可下载」分组（权重在、缺公共组件的
 * 也在「已安装」，行上「补齐」），顶上是默认模型（只有音源分离与音乐生成在这里设，其余在能力页顶上统一设），下面是折叠的「公共组件」（这一类两只及以上模型共用的组件；缺的借一只用到它的
 * 模型补齐）。
 * 下载与修复先看计划再确认（install-dialog.tsx）；进度、检查结论与模型包状态都从 `models` / `jobs` 主题读，
 * 这里不轮询、不在本地改状态。现在语音识别、语音合成、图像生成与音源分离有本机模型包，其余类给空态。
 * 音源分离的默认模型与语音识别一样有「自动选择」（配音的分离一步用它）；行与语音识别一样在行上露「检查」。
 * 语音合成（设计稿 settings-tts.jsx）的每一行装好后有「试听」（tts-quick-test.tsx）。
 * 图像生成的「试画」还没做（设计稿 model-local-check.js 的 `TRY.image`），所以它的行像语音识别一样在行上露「检查」。
 * 「检查」与「试听」是两件事（设计稿 model-local-check.js）：试听是行上的主操作，检查在 ⋯ 里紧挨「修复…」；
 * 没有试用的语音识别在行上另有一个安静的「检查」。模型能不能用只写在行上那一条状态里（model-check-line.tsx）。
 * 浏览器里只看与试用（产品设计 §7.6）：Web 白名单不含安装管理（`models.install`、`repair`、`cancelInstall`、`remove`、`test`、
 * `enable`）与 `models.setDefault`，这些按钮与默认模型选择器置灰，页面顶上写一句原因；试听、试画照常。
 */
export function LocalModels({ category }: { category: ModelCategory }) {
  if (category === 'asr') return <LocalPage key="asr" category="asr" kind="transcribe" />;
  if (category === 'tts') return <LocalPage key="tts" category="tts" kind="synthesize" />;
  if (category === 'image') return <LocalPage key="image" category="image" kind="image" />;
  if (category === 'sep') return <LocalPage key="sep" category="sep" kind="separate" />;
  if (category === 'music') return <LocalPage key="music" category="music" kind="music" />;
  const label = modelCategory(category).label;
  return <EmptyCard title={LOCAL_COPY.emptyTitle(label)} body={LOCAL_COPY.emptyBody} />;
}

function LocalPage({ category, kind }: { category: ModelCategory; kind: LocalDefaultCapability }) {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const connected = useConnection((s) => s.state.status === 'connected');
  const ready = useModels((s) => s.ready);
  const view = useModels((s) => s.capabilities);
  const bundles = useModels((s) => s.bundles);
  const jobs = useJobs((s) => s.jobs);
  const [busy, setBusy] = useState<string | null>(null);
  const [install, setInstall] = useState<Install | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // 公共组件区：没动过时有待补全的就展开（设计稿 settings-local.jsx `sharedExpanded`）。
  const [sharedOpen, setSharedOpen] = useState<boolean | null>(null);
  // 下载中的行不换组（`localGroups` 的 `placed`）：每次画完记下它们这一次在哪一组。
  const placed = useRef<ReadonlyMap<string, boolean>>(new Map());
  const groups = localGroups(bundles, category, placed.current);
  useEffect(() => {
    placed.current = installingPlacement(groups);
  });
  const speech = useMemo(() => (kind === 'synthesize' ? localSpeechModels(view) : new Map<string, SpeechModelInfo>()), [kind, view]);
  const images = useMemo(() => (kind === 'image' ? localImageModels(view) : new Map<string, ImageModelInfo>()), [kind, view]);
  const musics = useMemo(() => (kind === 'music' ? localMusicModels(view) : new Map<string, MusicModelInfo>()), [kind, view]);
  const ttsOpen = useTtsQuick((s) => s.open);
  const setTtsOpen = useTtsQuick((s) => s.setOpen);
  const musicOpen = useMusicQuick((s) => s.open);
  const setMusicOpen = useMusicQuick((s) => s.setOpen);
  // 试听展开着的行：语音合成与音乐生成各记各的。
  const quickOpen = kind === 'music' ? musicOpen : ttsOpen;
  const setQuickOpen = kind === 'music' ? setMusicOpen : setTtsOpen;
  useClaimAudition(kind === 'synthesize' && ready, speech);

  if (!connected) return <PageStatus>{MODELS_PAGE_COPY.offline}</PageStatus>;
  if (!ready) return <PageStatus>{MODELS_PAGE_COPY.loading}</PageStatus>;

  const synth = kind === 'synthesize';
  const ownDefault = kind === 'separate' || kind === 'music';
  const picker = localDefaultPicker(view, bundles, kind);
  const shared = sharedComponents(bundles, category);
  const repair = sharedRepair(shared).length;
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

  const noAuto = synth ? TTS : kind === 'image' ? IMAGE : kind === 'music' ? MUSIC : null;
  const desc = (
    noAuto
      ? [noAuto.defaultDesc, picker.other ? noAuto.cloudDefault(picker.other) : null, picker.items.length || web ? null : noAuto.noInstalled]
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
      ownFiles={hasOwnFiles(bundle, shared)}
      kind={kind}
      speech={synth ? { model: speech.get(bundle.bundleId) ?? null, cloneNames } : null}
      image={kind === 'image' ? (images.get(bundle.bundleId) ?? null) : null}
      music={kind === 'music' ? (musics.get(bundle.bundleId) ?? null) : null}
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
      {web ? <p className={webNote}>{INSTALL.webNote}</p> : null}
      {/* 语音识别、语音合成、图像生成的默认模型在能力页顶上统一设（capability-default.tsx）；音源分离、音乐生成只有本机，在这里设。 */}
      {ownDefault ? (
        <Card label={LOCAL_COPY.defaultLabel}>
          <SettingRow label={LOCAL_COPY.defaultLabel} desc={desc}>
            <Picker
              aria-label={LOCAL_COPY.defaultLabel}
              size="S"
              align="end"
              menuWidth={280}
              selectedKey={picker.selectedKey}
              placeholder={picker.other ?? (picker.hasAuto ? LOCAL_COPY.auto : TTS.unset)}
              isDisabled={web || busy === 'default'}
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
      ) : null}

      <section className={group} aria-label={LOCAL_COPY.installed}>
        <div className={groupHead}>
          <h2 className={groupTitle}>{LOCAL_COPY.installed}</h2>
          <span className={groupCount}>{groups.installed.length}</span>
        </div>
        {groups.installed.length ? (
          <>
            {web ? null : <p className={groupNote}>{checkCaption()}</p>}
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
            {web ? null : <p className={groupNote}>{INSTALL.availableNote}</p>}
            <Card>{groups.available.map(row)}</Card>
          </>
        ) : (
          <p className={groupEmpty}>{LOCAL_COPY.emptyAvailable}</p>
        )}
      </section>

      {shared.length ? (
        <Disclosure isQuiet size="S" styles={fold} isExpanded={sharedOpen ?? repair > 0} onExpandedChange={setSharedOpen}>
          <DisclosureTitle>
            {SHARED.title}
            <span className={foldSummary}>{repair ? SHARED.summaryRepair(repair) : SHARED.summaryCount(shared.length)}</span>
          </DisclosureTitle>
          <DisclosurePanel>
            <p className={groupNote}>{SHARED.note}</p>
            <Card label={SHARED.title}>
              {shared.map((c) => (
                <SharedRow
                  key={c.key}
                  component={c}
                  shared={shared}
                  web={web}
                  onGet={(target) => setInstall({ bundle: target, mode: 'complete', note: SHARED.completeNote(bundleName(target)) })}
                />
              ))}
            </Card>
          </DisclosurePanel>
        </Disclosure>
      ) : null}

      <DownloadSourcesFold />

      {install ? (
        <InstallDialog
          bundleId={install.bundle.bundleId}
          name={bundleName(install.bundle)}
          license={install.bundle.license ?? speech.get(install.bundle.bundleId)?.local?.license ?? null}
          {...(kind === 'image' ? { licenseUse: IMAGE.licenseUse } : kind === 'music' ? { licenseUse: MUSIC.licenseUse } : {})}
          mode={install.mode}
          {...(install.note ? { note: install.note } : {})}
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

/** 组成明细里的大小：装好的写占了多少，缺的写要下多少（设计稿「缺 · 大小」）；不知道时不写。 */
function componentSize(c: ModelComponentStatus): string | null {
  const bytes = c.state === 'installed' ? c.bytes : (c.estimatedBytes ?? null);
  return bytes !== null ? fmtSize(bytes) : null;
}

/**
 * 公共组件区的一行（设计稿 settings-local.jsx `SharedCard`）：装没装、名字、做什么与谁在用，右边是已装的大小、借来补齐的那只模型的进度、
 * 「下载 {大小}」（= 补齐 `sharedAction` 挑的那只模型，走同一个确认对话框）或「装模型时一起下载」。组件不单独装。
 */
function SharedRow({
  component: c,
  shared,
  web,
  onGet,
}: {
  component: SharedComponent;
  shared: readonly SharedComponent[];
  web: boolean;
  onGet: (target: ModelBundleStatus) => void;
}) {
  const action = sharedAction(c, shared);
  const usage = sharedUsage(c, shared);
  const size = c.bytes !== null ? fmtSize(c.bytes) : null;
  const progress = action.kind === 'running' && action.bundle.install ? installProgressView(action.bundle.install) : null;
  const status = INSTALL.componentLine(c.installed ? 'installed' : 'missing', null);
  const sub = [componentDesc(c.component), usage.live ? SHARED.usage(usage.live, usage.all) : SHARED.usageNone(usage.all)];
  return (
    <div className={modelRow}>
      <div className={modelHead}>
        {c.installed ? (
          <CheckmarkCircleIcon styles={okIcon} aria-label={status} />
        ) : (
          <AlertTriangleIcon styles={missIcon} aria-label={status} />
        )}
        <div className={modelMain}>
          <div className={modelId}>{componentLabel(c.component)}</div>
          <div className={modelFacts}>{sub.filter(Boolean).join(' · ')}</div>
        </div>
        <div className={modelActions}>
          {action.kind === 'installed' ? <span className={sideNote}>{INSTALL.componentLine('installed', size)}</span> : null}
          {action.kind === 'get' ? (
            <Button variant="secondary" size="S" isDisabled={web} onPress={() => onGet(action.target)}>
              <DownloadIcon />
              <Text>{size ? INSTALL.downloadSize(size) : INSTALL.download}</Text>
            </Button>
          ) : null}
          {action.kind === 'later' ? <span className={sideNote}>{SHARED.withModel(size)}</span> : null}
        </div>
      </div>
      {progress ? (
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
    </div>
  );
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
  ownFiles,
  kind,
  speech,
  image,
  music,
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
  /** 模型包自己的文件在盘上（`hasOwnFiles`）：权重在、缺组件的给「补齐」不给「下载」。 */
  ownFiles: boolean;
  kind: LocalDefaultCapability;
  /** 语音合成的行：本机列出的模型（没装好时可能没有）与装好了的克隆模型名；语音识别的行为 null。 */
  speech: { model: SpeechModelInfo | null; cloneNames: readonly string[] } | null;
  /** 图像生成的行：本机列出的模型（没装好时可能没有）；别的行为 null。 */
  image: ImageModelInfo | null;
  /** 音乐生成的行：本机列出的模型（没装好时可能没有）；别的行为 null。 */
  music: MusicModelInfo | null;
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
  const actions = bundleActions(bundle, ownFiles);
  const check = useBundleCheck(bundle, kind, jobs, ownFiles);
  // 浏览器里管不了安装（见 LocalModels）：下面的按钮置灰，检查状态与试用的提示里不给修复与重新检查；取消检查（`jobs.cancel`）照常。
  const web = runtime.host.platform === 'web';
  const can = web ? NO_CHECK : check.can;
  // 缺组件的（设计稿 settings-local.jsx 的 `half`）自动展开详情，看得到缺的是哪几件、各多大。
  const half = missingParts(bundle, ownFiles).length > 0;
  useEffect(() => {
    if (half) setOpen(true);
  }, [half]);
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
  // 引擎没找到时模型不可用（`available: false`，原因写在模型的 detail 里）：不给试听，原因照实写在行上。
  const canTryMusic = !!music && music.available !== false && isBundleInstalled(bundle) && bundle.state !== 'error';
  const musicWhy = music && music.available === false && isBundleInstalled(bundle) ? (localizeText(music.detail, music.detailRef) ?? null) : null;
  const buttons: ReactNode[] = [];
  if (canAudition || canTryMusic) {
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
      <Button key="reenable" variant="secondary" size="S" isDisabled={web} isPending={reenabling} onPress={onReenable}>
        {LOCAL_COPY.reenable}
      </Button>,
    );
  }
  // 没有试用的（语音识别，或这一刻试不了的图像模型）：检查在行上露一个安静的按钮；有试听、试画的，检查只在 ⋯ 里。
  if (!speech && !canTryImage && !canTryMusic && check.can.recheck) {
    buttons.push(
      <TooltipTrigger key="check" placement="top" delay={300}>
        <ActionButton isQuiet size="S" isDisabled={web || checkBusy} onPress={() => void check.start()}>
          <SearchIcon />
          <Text>{CHECK_LABEL.check}</Text>
        </ActionButton>
        <Tooltip>{CHECK_LABEL.checkFull}</Tooltip>
      </TooltipTrigger>,
    );
  }
  // 下载与补齐的按钮写上还要下多少（设计稿 settings-local.jsx「补齐 {大小}」）；有组件不知道大小时只写动作。
  const need = needBytes(bundle);
  const needSize = need !== null && need > 0 ? fmtSize(need) : null;
  // 自己的文件在盘上、还缺组件（装好了缺可选的对齐器、说话人模型，或权重在、缺公共组件）：「补齐」只下载缺的那几件，不再给「下载」
  // （设计稿 settings-local.jsx 的 `half`）。
  if (actions.complete) {
    buttons.push(
      <Button key="complete" variant="accent" size="S" isDisabled={web} onPress={() => onInstall('complete')}>
        <DownloadIcon />
        <Text>{needSize ? INSTALL.completeSize(needSize) : INSTALL.complete}</Text>
      </Button>,
    );
  }
  if (actions.install) {
    buttons.push(
      <Button key="install" variant="secondary" size="S" isDisabled={web} onPress={() => onInstall('install')}>
        <DownloadIcon />
        <Text>{needSize ? INSTALL.downloadSize(needSize) : INSTALL.download}</Text>
      </Button>,
    );
  }
  if (actions.resume) {
    buttons.push(
      <Button key="resume" variant="accent" size="S" isDisabled={web} onPress={() => onInstall(ownFiles ? 'complete' : 'install')}>
        <DownloadIcon />
        <Text>{INSTALL.resume}</Text>
      </Button>,
    );
  }
  if (actions.stop && !repairing) {
    buttons.push(
      <ActionButton key="pause" size="S" isDisabled={web} isPending={pending === 'pause'} onPress={() => void pause()}>
        <PauseIcon />
        <Text>{INSTALL.pause}</Text>
      </ActionButton>,
      <ActionButton key="cancel" isQuiet size="S" isDisabled={web} onPress={() => onConfirm('discard')}>
        <Text>{INSTALL.cancelDownload}</Text>
      </ActionButton>,
    );
  }
  if (actions.discard) {
    buttons.push(
      <ActionButton key="discard" isQuiet size="S" isDisabled={web} onPress={() => onConfirm('discard')}>
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
        <ActionButton isQuiet size="S" isDisabled={web} aria-label={INSTALL.more(name)}>
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
      <ActionButton key="remove" isQuiet size="S" isDisabled={web} aria-label={`${LOCAL_COPY.remove} ${name}`} onPress={() => onConfirm('remove')}>
        <DeleteIcon />
      </ActionButton>,
    );
  }

  const brief = model ? ttsBrief(model) : null;
  const size = speech ? installedBytes(bundle) : null;
  const weights = bundle.license ?? model?.local?.license ?? music?.local?.license ?? null;
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
            <Chips chips={kind !== 'transcribe' ? ttsChips(bundle, isDefault, ownFiles) : bundleChips(bundle, isDefault, ownFiles)} />
          </div>
          {brief ? <div className={modelSummary}>{brief.summary}</div> : null}
          <div className={modelFacts}>
            {brief ? [...brief.facts, ...(size !== null ? [fmtSize(size)] : [])].join(' · ') : bundleFacts(bundle)}
          </div>
          {restricted ? <div className={modelFacts}>{licenseBrief(restricted)}</div> : null}
          {musicWhy ? <div className={modelFacts}>{musicWhy}</div> : null}
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
          view={checkLineView(check.state, can)}
          detailLines={checkDetailLines(check.state, id)}
          label={`${repairing ? CHECK_HEAD.repairing : CHECK_HEAD.running} ${name}`}
          onAction={(k) => (k === 'cancel' ? check.cancel() : k === 'repair' ? onInstall('repair') : void check.start())}
        />
      ) : null}
      {failure ? <p className={rowNote({ tone: 'failed' })}>{INSTALL.installFailed(installFailureText(failure, half))}</p> : null}
      {quickOpen && canAudition && model ? (
        <TtsQuickTest
          bundleId={id}
          name={name}
          model={model}
          cloneNames={speech?.cloneNames ?? []}
          notice={tryNotice(check.state, can)}
          canCheck={can.recheck}
          onCheck={(k) => (k === 'repair' ? onInstall('repair') : void check.start())}
        />
      ) : null}
      {quickOpen && canTryMusic && music ? (
        <MusicQuickTest
          bundleId={id}
          name={name}
          model={music}
          notice={tryNotice(check.state, can, TRY_SUBJECT_MUSIC)}
          canCheck={can.recheck}
          onCheck={(k) => (k === 'repair' ? onInstall('repair') : void check.start())}
        />
      ) : null}
      {trying && canTryImage && image ? (
        <ImageTryDialog
          bundleId={id}
          name={name}
          chip={bundle.backend.toUpperCase()}
          model={image}
          notice={tryNotice(check.state, can, TRY_SUBJECT_IMAGE)}
          canCheck={can.recheck}
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
                {!c.sharedWith.length && componentDesc(c.component) ? <span>{componentDesc(c.component)}</span> : null}
                <span className={detailRepo}>{componentSource(c)}</span>
                <span>{INSTALL.componentLine(c.state, componentSize(c))}</span>
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
