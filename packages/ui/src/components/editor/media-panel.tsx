import { useEffect, useState, type DragEvent, type ReactNode } from 'react';
import type { AssetRecord, Id, Sequence } from '@baocut/protocol';
import { mediaTimeToSeconds } from '@baocut/protocol';
import { ActionButton, Button, Link, Tab, TabList, TabPanel, Tabs, Text, ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import AIMark from '@react-spectrum/s2/icons/AIMark';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import Collection from '@react-spectrum/s2/icons/Collection';
import Image from '@react-spectrum/s2/icons/Image';
import Import from '@react-spectrum/s2/icons/Import';
import Microphone from '@react-spectrum/s2/icons/Microphone';
import MusicNote from '@react-spectrum/s2/icons/MusicNote';
import Pause from '@react-spectrum/s2/icons/Pause';
import Play from '@react-spectrum/s2/icons/Play';
import Translate from '@react-spectrum/s2/icons/Translate';
import Video from '@react-spectrum/s2/icons/Video';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { frameAt } from '../../model/editor.ts';
import { audioAside, dubGroupIds, libraryAssets, placeAsset, usageCount, type PlaceableKind } from '../../model/editor-ops.ts';
import { formatClock } from '../../model/format.ts';
import { formatBytes } from '../../model/space.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditor } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { openAiTool } from './ai-tools-nav.ts';
import { useEditorActions } from './editor-context.tsx';
import { ImageGenPane } from './image-gen-panel.tsx';
import { MediaAssetMenu } from './media-asset-menu.tsx';
import { DubGroupCard } from './media-dub-groups.tsx';
import { AUDIO_GEN_COPY, generatedMark, IMAGE_GEN_COPY } from './media-gen-copy.ts';
import { useMediaGen, useMediaGenStore, type ImageSegment } from './media-gen-store.ts';
import { PanelHead, panelBody } from './panel-head.tsx';
import { ASSET_DRAG_TYPE } from './timeline.tsx';
import { TtsPanel } from './tts-panel.tsx';
import { useAssetUrl } from './use-asset-url.ts';
import { MEDIA_COPY as MC } from './media-copy.ts';

const body = style({ display: 'flex', flexDirection: 'column', gap: 8 });
/** 导入框（原型 .vl-import）：虚线框，左边说明，右边「导入」；文件可以直接拖进来。 */
const importBox = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: 12,
  borderWidth: 1,
  borderStyle: 'dashed',
  borderRadius: 'lg',
  borderColor: { default: 'gray-400', isDropTarget: 'blue-800' },
  backgroundColor: { default: 'gray-75', isDropTarget: 'blue-100' },
  color: 'gray-700',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const importText = style({ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 });
const strong = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-900' });
const small = style({ font: 'ui-xs', color: 'gray-600' });
const heading = style({ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, paddingTop: 8, paddingX: 4 });
const list = style({ display: 'flex', flexDirection: 'column', gap: 4, margin: 0, padding: 0, listStyleType: 'none' });
const empty = style({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, paddingY: 24, textAlign: 'center' });
const foot = style({ font: 'ui-xs', color: 'gray-600', margin: 0, paddingX: 4 });
/** 音频页顶上那一行生成入口（原型 .mact）：生成语音 / 克隆声音。 */
const genRow = style({ display: 'flex', flexWrap: 'wrap', gap: 8 });
/** 图片页的两段（视频素材 | AI 生成）：页签撑满页头下面，各段自己滚动。 */
const sourceTabs = style({ flexGrow: 1, flexShrink: 1, minHeight: 0 });
const sourceTabList = style({ marginX: 12, marginTop: 4 });
const sourcePane = style({ boxSizing: 'border-box', height: 'full', overflowY: 'auto', paddingX: 12, paddingTop: 12, paddingBottom: 12 });
/** 素材卡片（原型 .vl-row）：缩略格 96×54，名字、规格、用在哪里，右边「添加到时间线」。 */
const card = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: 8,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  backgroundColor: { default: 'gray-25', ':hover': 'gray-75' },
  cursor: 'grab',
});
const thumb = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: 96,
  height: 54,
  borderRadius: 'default',
  backgroundColor: 'gray-200',
  color: 'gray-600',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const duration = style({
  position: 'absolute',
  insetEnd: 4,
  bottom: 4,
  paddingX: 4,
  borderRadius: 'sm',
  backgroundColor: 'gray-25',
  color: 'gray-900',
  fontSize: '[10px]',
  lineHeight: '[13px]',
});
const info = style({ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 });
const nameStyle = style({
  font: 'ui-sm',
  fontWeight: 'bold',
  color: 'gray-900',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const meta = style({ font: 'ui-xs', color: 'gray-600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const used = style({ font: 'ui-xs', color: 'gray-700' });
/** 音频卡的缩略格本身就是试听钮（原型 .fthumb--btn）：悬停或在放时露出播放 / 暂停，进度盖在下沿。 */
const thumbButton = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: 96,
  height: 54,
  padding: 0,
  borderWidth: 0,
  borderRadius: 'default',
  backgroundColor: { default: 'gray-200', ':hover': 'gray-300' },
  color: { default: 'gray-600', isPlaying: 'blue-800' },
  cursor: 'pointer',
  overflow: 'hidden',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineWidth: 2,
  outlineColor: 'focus-ring',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const playBadge = style({
  position: 'absolute',
  insetStart: 4,
  top: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  size: 20,
  borderRadius: 'full',
  backgroundColor: 'gray-25',
  color: 'gray-900',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const progress = style({ position: 'absolute', insetX: 0, bottom: 0, height: 4, backgroundColor: 'gray-300' });
const progressFill = style({ display: 'block', height: 'full', backgroundColor: 'blue-800' });
const hint = style({ font: 'ui-xs', color: 'gray-700', margin: 0, paddingX: 4 });
const againRow = style({ display: 'flex', alignItems: 'center', gap: 8, paddingX: 4, paddingTop: 4 });

const KIND_ICON = { video: Video, image: Image, audio: MusicNote };

/**
 * 素材面板（产品设计 §5.9）：图片、视频、音频素材各一页，都是视频自己的素材库。导入与添加到时间线是两个动作：
 * 导入把文件收进素材库；「添加到时间线」放在播放头处，也可以把素材拖到时间线的某一行。
 */
export function MediaPanel({ kind, sequence, assets }: { kind: PlaceableKind; sequence: Sequence; assets: Record<Id, AssetRecord> }) {
  const runtime = useRuntime();
  const { apply } = useEditorActions();
  const editable = useVideo((s) => canEdit(s.video));
  const [over, setOver] = useState(false);
  const available = libraryAssets(assets, kind);
  // 生成语音 / 克隆声音与 AI 生图只在桌面端（网页宿主只留导入，原型 model-surface.js）。
  const videoId = useVideo((s) => s.video?.videoId ?? null);
  const ai = runtime.host.platform !== 'web' && videoId !== null;
  const gen = useMediaGen(videoId);
  const setGen = useMediaGenStore((s) => s.patch);
  // 音频页按配音分组（设计稿 `audioGroups`）：每组配音一张卡，散装文件照旧平铺在组下面。
  const shape = kind === 'audio' ? dubGroupIds(sequence, available) : { groups: [], loose: available };
  // 试听：一次只放一个（状态在列表上）。
  const [audition, setAudition] = useState<Id | null>(null);
  // 翻译配音的家在工具页里（设计稿 2026-09-16）：这里只指路。
  const redub = () => {
    if (videoId) openAiTool(videoId, 'dub');
  };

  const importPaths = async (paths: string[]) => {
    if (!paths.length) return;
    const receipt = await apply(
      paths.map((path) => ({ type: 'importAsset', path })),
      MC.importLabel,
    );
    if (receipt) ToastQueue.positive(MC.imported, { timeout: 4000 });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    setOver(false);
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    const paths = [...event.dataTransfer.files].map((file) => runtime.host.pathForFile(file)).filter(Boolean);
    void importPaths(paths);
  };

  const addToTimeline = (asset: AssetRecord & { kind: PlaceableKind }) => {
    const frame = frameAt(useEditor.getState().playhead, sequence.fps);
    void apply(placeAsset(sequence, asset, frame), MC.addClip);
  };

  if (ai && kind === 'audio' && gen.audio) {
    return <TtsPanel key={gen.audio} videoId={videoId} page={gen.audio} sequence={sequence} assets={assets} />;
  }

  const library = (
    <div className={body}>
      {ai && kind === 'audio' ? (
        <div className={genRow}>
          <TooltipTrigger>
            <Button variant="secondary" size="S" isDisabled={!editable} onPress={() => setGen(videoId, { audio: 'tts' })}>
              <AudioWave />
              <Text>{AUDIO_GEN_COPY.generate}</Text>
            </Button>
            <Tooltip>{AUDIO_GEN_COPY.generateTip}</Tooltip>
          </TooltipTrigger>
          <TooltipTrigger>
            <Button variant="secondary" size="S" isDisabled={!editable} onPress={() => setGen(videoId, { audio: 'clone' })}>
              <Microphone />
              <Text>{AUDIO_GEN_COPY.clone}</Text>
            </Button>
            <Tooltip>{AUDIO_GEN_COPY.cloneTip}</Tooltip>
          </TooltipTrigger>
        </div>
      ) : null}
      <div
        className={importBox({ isDropTarget: over })}
        onDragOver={(event) => {
          if (!editable || !event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}>
        <Import />
        <span className={importText}>
          <span className={strong}>{MC.addKind(kind)}</span>
          <span className={small}>{MC.dropOrPick(kind)}</span>
        </span>
        <Button
          variant="secondary"
          size="S"
          isDisabled={!editable}
          onPress={() => void runtime.host.pickMediaFiles().then(importPaths)}>
          <Import />
          <Text>{MC.import}</Text>
        </Button>
      </div>
      <div className={heading}>
        <span className={strong}>{MC.existing(kind)}</span>
        <span className={small}>{audioAside(shape.groups.length, available.length)}</span>
      </div>
      {shape.groups.map((groupId) => (
        <DubGroupCard key={groupId} groupId={groupId} sequence={sequence} assets={assets} editable={editable} />
      ))}
      {ai && kind === 'audio' ? (
        shape.groups.length ? (
          <div className={againRow}>
            <Button variant="secondary" size="S" onPress={redub}>
              <Translate />
              <Text>{MC.dubAnother}</Text>
            </Button>
            <span className={small}>{MC.dubbedGroups(shape.groups.length)}</span>
          </div>
        ) : (
          <p className={hint}>
            {MC.dubHintBefore}
            <Link onPress={redub}>{MC.dubHintLink}</Link>
            {MC.dubHintAfter}
          </p>
        )
      ) : null}
      {shape.loose.length ? (
        <ul className={list} aria-label={MC.existing(kind)}>
          {shape.loose.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              uses={usageCount(sequence, asset.id)}
              editable={editable}
              onAdd={() => addToTimeline(asset)}
              playing={audition === asset.id}
              onAudition={(on) => setAudition(on ? asset.id : null)}
              menu={<MediaAssetMenu asset={asset} sequence={sequence} assets={assets} editable={editable} />}
            />
          ))}
        </ul>
      ) : shape.groups.length ? null : (
        <div className={empty}>
          <span className={strong}>{MC.emptyLibrary}</span>
          <span className={small}>{MC.emptyHint}</span>
        </div>
      )}
      <p className={foot}>
        {MC.foot}
      </p>
    </div>
  );

  // 图片页：视频素材 | AI 生成两段（设计稿 panel-media.jsx `IMAGE_TABS`），选在哪一段按视频记着。
  if (ai && kind === 'image') {
    return (
      <>
        <PanelHead title={MC.panelTitle(kind)} />
        <Tabs
          aria-label={IMAGE_GEN_COPY.segments}
          styles={sourceTabs}
          density="compact"
          selectedKey={gen.image}
          onSelectionChange={(key) => setGen(videoId, { image: key as ImageSegment })}>
          <TabList aria-label={IMAGE_GEN_COPY.segments} styles={sourceTabList}>
            <Tab id="project">
              <Collection />
              <Text>{IMAGE_GEN_COPY.project}</Text>
            </Tab>
            <Tab id="gen">
              <AIMark />
              <Text>{IMAGE_GEN_COPY.gen}</Text>
            </Tab>
          </TabList>
          <TabPanel id="project">
            <div className={`${sourcePane} bc-scroll`}>{library}</div>
          </TabPanel>
          <TabPanel id="gen">
            <ImageGenPane videoId={videoId} sequence={sequence} assets={assets} />
          </TabPanel>
        </Tabs>
      </>
    );
  }

  return (
    <>
      <PanelHead title={MC.panelTitle(kind)} />
      <div className={`${panelBody} bc-scroll`}>{library}</div>
    </>
  );
}

function AssetRow({
  asset,
  uses,
  editable,
  onAdd,
  playing,
  onAudition,
  menu,
}: {
  asset: AssetRecord & { kind: PlaceableKind };
  uses: number;
  editable: boolean;
  onAdd(): void;
  playing: boolean;
  onAudition(on: boolean): void;
  menu: ReactNode;
}) {
  const revision = asset.revisions[asset.currentRevision];
  const Icon = KIND_ICON[asset.kind];
  const seconds = revision?.duration && asset.kind !== 'image' ? mediaTimeToSeconds(revision.duration) : null;
  const [played, setPlayed] = useState(0);
  const parts: string[] = [];
  if (revision?.video) parts.push(`${revision.video.displayWidth}×${revision.video.displayHeight}`);
  if (revision) parts.push(formatBytes(revision.byteLength));
  // 链接的素材留在原处，没有复制进视频目录。
  if (revision?.storage.mode === 'linked') parts.push(MC.linked);
  // 生成来的（生成语音、AI 生图）带一枚「生成」，出处（任务、模型、参数）随素材记着。
  if (revision?.provenance.origin === 'generated') parts.push(generatedMark());
  return (
    <li
      className={card}
      draggable={editable}
      onDragStart={(event) => {
        event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
        event.dataTransfer.effectAllowed = 'copy';
      }}>
      {asset.kind === 'audio' ? (
        // 音频卡的缩略格就是试听钮（设计稿 2026-09-11）：点一下就地放，不必先加到时间线；时长位在放的时候改成已播时间。
        <button
          type="button"
          className={thumbButton({ isPlaying: playing })}
          aria-label={playing ? MC.pauseAuditionOf(asset.name) : MC.auditionOf(asset.name)}
          aria-pressed={playing}
          title={playing ? MC.pauseAudition : MC.auditionTip}
          onClick={() => {
            setPlayed(0);
            onAudition(!playing);
          }}>
          <AudioWave />
          <span className={playBadge}>{playing ? <Pause /> : <Play />}</span>
          {seconds !== null ? <span className={duration}>{formatClock(playing ? played : seconds)}</span> : null}
          {playing ? (
            <>
              <span className={progress}>
                <span className={progressFill} style={{ width: `${seconds ? Math.min(100, (played / seconds) * 100) : 0}%` }} />
              </span>
              <Audition asset={asset} onTime={setPlayed} onEnd={() => onAudition(false)} />
            </>
          ) : null}
        </button>
      ) : (
        <span className={thumb} aria-hidden>
          <Icon />
          {seconds !== null ? <span className={duration}>{formatClock(seconds)}</span> : null}
        </span>
      )}
      <span className={info}>
        <span className={nameStyle} title={asset.name}>
          {asset.name}
        </span>
        <span className={meta}>{parts.join(' · ') || MC.kindName(asset.kind)}</span>
        <span className={used}>{uses > 0 ? MC.usedTimes(uses) : MC.unused}</span>
      </span>
      <TooltipTrigger>
        <ActionButton isQuiet aria-label={MC.addToTimelineOf(asset.name)} isDisabled={!editable} onPress={onAdd}>
          <Add />
        </ActionButton>
        <Tooltip>{MC.addToTimelineTip}</Tooltip>
      </TooltipTrigger>
      {menu}
    </li>
  );
}

/** 试听中的那一段：地址按素材版本向 Runtime 要，取到就放；放完或出错就停。 */
function Audition({ asset, onTime, onEnd }: { asset: AssetRecord; onTime(seconds: number): void; onEnd(): void }) {
  const videoId = useVideo((s) => s.video?.videoId ?? null);
  const { url, error } = useAssetUrl(videoId, { id: asset.id, revision: asset.currentRevision });
  useEffect(() => {
    if (!error) return;
    ToastQueue.negative(MC.auditionFailed(asset.name, error), { timeout: 4000 });
    onEnd();
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps -- 只在出错那一刻提示一次
  return url && !error ? (
    <audio
      src={url}
      autoPlay
      hidden
      onTimeUpdate={(event) => onTime(event.currentTarget.currentTime)}
      onEnded={onEnd}
      onError={() => {
        ToastQueue.negative(MC.auditionFailedPlain(asset.name), { timeout: 4000 });
        onEnd();
      }}
    />
  ) : null;
}
