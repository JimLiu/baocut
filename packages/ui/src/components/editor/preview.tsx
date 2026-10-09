import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { itemRangeSeconds, type AssetRecord, type AudioItem, type DocumentRecord, type Id, type Sequence, type VersionRef } from '@baocut/protocol';
import { ActionButton, Content, ContextualHelp, Heading, StatusLight, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import FullScreen from '@react-spectrum/s2/icons/FullScreen';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { formatFps, videoSlots } from '../../model/editor.ts';
import type { MediaOutcome } from '../../model/stage-media.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditor } from '../../state/editor-store.ts';
import { useEditorActions } from './editor-context.tsx';
import { FULLSCREEN_PLAYER_COPY as F } from './fullscreen-player-copy.ts';
import { FullscreenPlayer, enterPreviewFullscreen, exitPreviewFullscreen } from './fullscreen-player.tsx';
import { audioKey, imageKey, videoKey, type MediaKey, type PreviewStatus } from './preview-engine.ts';
import { StageLoadNotice } from './stage-load-notice.tsx';
import { StageMediaNotice } from './stage-media-notice.tsx';
import { StageObjects } from './stage-objects.tsx';
import { useAssetUrl } from './use-asset-url.ts';
import { useStageMedia } from './use-stage-media.ts';
import { EDITOR_COPY as E } from './editor-copy.ts';

const wrap = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, minWidth: 0, backgroundColor: 'gray-100' });
/** 预览顶部的标志（产品设计 §5.4）：现在看的是当前工作稿，不是候选。 */
const head = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  paddingX: 16,
  height: 32,
  flexShrink: 0,
  font: 'ui-sm',
  color: 'gray-700',
});
const badge = style({
  font: 'ui-xs',
  fontWeight: 'bold',
  color: 'gray-900',
  backgroundColor: 'gray-25',
  borderRadius: 'full',
  paddingX: 8,
  paddingY: 2,
});
const problemsAt = style({ display: 'flex', alignItems: 'center', gap: 2, marginStart: 'auto' });
const problemList = style({ margin: 0, paddingStart: 16 });
/** 舞台：全屏播放时整格进浏览器的全屏（`enterPreviewFullscreen`），画面之外一律纯黑。 */
const stage = style({ position: 'relative', flexGrow: 1, minHeight: 0, backgroundColor: { default: 'transparent', isFullscreen: 'black' } });
const frame = style({
  position: 'absolute',
  overflow: 'hidden',
  borderRadius: { default: 'sm', isFullscreen: 'none' },
  backgroundColor: 'black',
  boxShadow: { default: 'emphasized', isFullscreen: 'none' },
});
/**
 * 舞台下沿的工具条（原型 stage.jsx 的 `StageBar`、ui.css 的 `.stagebar`）：42px 高、上边一道线，紧贴舞台、在走带之上。
 * 原型这一条左边是画幅，右边依次是字幕显隐、音量、倍速、全屏；这里先只有最右端的全屏钮。
 */
const stageBar = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'end',
  boxSizing: 'border-box',
  height: 42,
  flexShrink: 0,
  paddingX: 12,
  backgroundColor: 'gray-100',
  borderTopWidth: 1,
  borderBottomWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const surface = style({ position: 'absolute', inset: 0, width: 'full', height: 'full' });
/** 源元素不显示，只给画布供帧。不用 display: none，免得浏览器不给它解码。 */
const sources = style({
  position: 'absolute',
  top: 0,
  insetStart: 0,
  width: 2,
  height: 2,
  overflow: 'hidden',
  opacity: 0,
  pointerEvents: 'none',
});
const empty = style({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  font: 'ui',
  color: 'gray-400',
  textAlign: 'center',
  pointerEvents: 'none',
});
const notice = style({ font: 'ui-xs', color: 'gray-400' });

const PADDING = 24;

/**
 * 音频实例的源元素：每个 `<audio>` 都是一个媒体播放器，浏览器有上限，上千个（逐句配音）会把页面卡死。不多于
 * `AUDIO_ALL` 个时全挂；多了只挂播放头附近的（往回 `AUDIO_BEHIND`、往前 `AUDIO_AHEAD` 秒，播放头每走 `AUDIO_STEP` 秒挪一次窗口），
 * 播到之前早已挂上、载入好了；离得远的定位过去时新挂的元素载入好了引擎再把它对上。
 */
const AUDIO_ALL = 32;
const AUDIO_STEP = 10;
const AUDIO_BEHIND = 10;
const AUDIO_AHEAD = 30;

/**
 * 预览：按帧计划把各层合成到画布上（WASM 求计划并画成一帧，与导出同一个渲染内核），按画布比例摆在舞台中间。
 * 全屏播放（F 或舞台下沿工具条右端那枚钮）时舞台整格进浏览器的全屏：画面贴边、不画舞台点选层，盖上全屏播放器（fullscreen-player.tsx）。
 */
export function Preview({
  videoId,
  sequence,
  assets,
  documents,
}: {
  videoId: Id | null;
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  documents: Record<Id, DocumentRecord>;
}) {
  const { engine } = useEditorActions();
  const fullscreen = useEditor((s) => s.fullscreen);
  const [status, setStatus] = useState<PreviewStatus>({ kind: 'loading' });
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  // 主媒体放不出来：画面正中的常驻卡；找回之后按素材重挂源元素，重新取地址。
  const stageMedia = useStageMedia(videoId, sequence);
  // 预览卡住时的「重试」（产品设计 §5.1）：引擎重新接渲染内核、重新交视频；这部视频的媒体地址丢掉重新要，源元素全部重挂。
  const mediaUrls = useRuntime().videos.mediaUrls;
  const [reload, setReload] = useState(0);
  const retry = useCallback(() => {
    if (videoId) mediaUrls.forgetVideo(videoId);
    engine.retry();
    setReload((n) => n + 1);
  }, [engine, mediaUrls, videoId]);

  useEffect(() => engine.onStatus(setStatus), [engine]);
  // 全屏以浏览器的 `fullscreenchange` 为准：浏览器自己的 Esc 退出不经过我们的键盘层。
  // 预览卸下（换视频、离开编辑器）时舞台还在全屏就退出来，不留一个没有播放器的全屏。
  useEffect(() => {
    const element = stageRef.current;
    const { setFullscreen } = useEditor.getState();
    const sync = () => setFullscreen(!!element && document.fullscreenElement === element);
    document.addEventListener('fullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      if (element && document.fullscreenElement === element) exitPreviewFullscreen();
      setFullscreen(false);
    };
  }, []);
  useEffect(() => {
    engine.attachCanvas(canvasRef.current);
    return () => engine.attachCanvas(null);
  }, [engine]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect;
      if (rect) setBox({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { width: cw, height: ch } = sequence.canvas;
  const padding = fullscreen ? 0 : PADDING;
  const scale = Math.max(0, Math.min((box.width - padding * 2) / cw, (box.height - padding * 2) / ch));
  const fw = Math.floor(cw * scale);
  const fh = Math.floor(ch * scale);
  // 画布按显示尺寸（乘设备像素比）画，不超过序列画布本身。
  const pixelScale = Math.min(1, scale * (window.devicePixelRatio || 1));
  useEffect(() => engine.setScale(pixelScale), [engine, pixelScale]);

  // 视频按素材分槽（同一时刻用到几处就几个元素）；图片按素材一个；音频轨道上的实例各一个（多了只挂播放头附近的）。
  const visuals = useMemo(() => {
    const videos = videoSlots(sequence).flatMap(({ asset, count }) =>
      Array.from({ length: count }, (_, slot) => ({ key: videoKey(asset, slot), asset })),
    );
    const images = new Map<MediaKey, VersionRef>();
    for (const item of sequence.items) if (item.type === 'image') images.set(imageKey(item.assetRef), item.assetRef);
    return { videos, images: [...images.entries()] };
  }, [sequence]);
  const audioWindow = useEditor((s) => Math.floor(s.playhead / AUDIO_STEP));
  const audios = useMemo(() => {
    let items = sequence.items.filter((item): item is AudioItem => item.type === 'audio');
    if (items.length > AUDIO_ALL) {
      const from = audioWindow * AUDIO_STEP - AUDIO_BEHIND;
      const to = (audioWindow + 1) * AUDIO_STEP + AUDIO_AHEAD;
      items = items.filter((item) => {
        const { start, end } = itemRangeSeconds(item, sequence.fps);
        return end > from && start < to;
      });
    }
    return items.map((item) => ({ key: audioKey(item.id), asset: item.assetRef }));
  }, [sequence, audioWindow]);
  const media = { ...visuals, audios };
  const frameRect = { left: (box.width - fw) / 2, top: (box.height - fh) / 2, width: fw, height: fh };
  // 舞台上的提示卡；全屏时夹在播放器的画面点击层与控件之间（点不到卡下面的画面，卡上的钮照常点）。
  const notices =
    fw > 0 && fh > 0 ? (
      <>
        <StageMediaNotice media={stageMedia} frame={frameRect} />
        {/* 载入与卡住盖在画面与舞台点选层之上，接住指针。 */}
        <StageLoadNotice
          engine={engine}
          videoId={videoId}
          status={status}
          frame={frameRect}
          suppressed={stageMedia.notice !== null}
          onRetry={retry}
        />
      </>
    ) : null;

  return (
    <div className={wrap}>
      <div className={head}>
        <span className={badge}>{E.workingDraft}</span>
        <span>
          {sequence.name} · {cw}×{ch} · {formatFps(sequence.fps)}
        </span>
        {status.kind === 'ready' && status.problems ? <Problems problems={status.problems} /> : null}
      </div>
      <div ref={stageRef} className={stage({ isFullscreen: fullscreen })} data-preview-stage>
        <div className={frame({ isFullscreen: fullscreen })} style={frameRect}>
          <canvas ref={canvasRef} className={surface} aria-label={E.previewCanvas} data-preview-status={status.kind} />
          <div className={sources} aria-hidden>
            {media.videos.map(({ key, asset }) => (
              <MediaSource
                key={`${key}#${stageMedia.revived(asset.id)}.${reload}`}
                kind="video"
                mediaKey={key}
                videoId={videoId}
                asset={asset}
                onOutcome={stageMedia.report}
              />
            ))}
            {media.images.map(([key, asset]) => (
              <MediaSource key={`${key}#${stageMedia.revived(asset.id)}.${reload}`} kind="image" mediaKey={key} videoId={videoId} asset={asset} />
            ))}
            {media.audios.map(({ key, asset }) => (
              <MediaSource
                key={`${key}#${stageMedia.revived(asset.id)}.${reload}`}
                kind="audio"
                mediaKey={key}
                videoId={videoId}
                asset={asset}
                onOutcome={stageMedia.report}
              />
            ))}
          </div>
          {status.kind === 'error' ? (
            <div className={empty} role="alert">
              <span>{E.previewFailed}</span>
              <span className={notice}>{status.message}</span>
            </div>
          ) : sequence.items.length === 0 ? (
            <div className={empty}>
              <span>{E.emptyDrag}</span>
              <span className={notice}>{E.emptyOr}</span>
            </div>
          ) : null}
        </div>
        {fw > 0 && fh > 0 && !fullscreen ? <StageObjects sequence={sequence} frame={frameRect} /> : null}
        {fullscreen ? (
          <FullscreenPlayer stage={stageRef} sequence={sequence} assets={assets} documents={documents}>
            {notices}
          </FullscreenPlayer>
        ) : (
          notices
        )}
      </div>
      <div className={stageBar}>
        {/* 进全屏要在这一下点击里向浏览器要（只认瞬时的用户激活），不能挪进状态或副作用。 */}
        <TooltipTrigger placement="top">
          <ActionButton size="S" isQuiet aria-label={F.enter} onPress={() => enterPreviewFullscreen(stageRef.current)}>
            <FullScreen />
          </ActionButton>
          <Tooltip>{F.enterTip}</Tooltip>
        </TooltipTrigger>
      </div>
    </div>
  );
}

/** 这一帧有画不出来的东西：画面照常出，在这里说明哪些没画、为什么（视频格式规范 §3.7）。 */
function Problems({ problems }: { problems: string[] }) {
  return (
    <span className={problemsAt}>
      <StatusLight size="S" variant="notice">
        {E.problemsCount(problems.length)}
      </StatusLight>
      <ContextualHelp variant="info" placement="bottom end">
        <Heading>{E.problemsTitle}</Heading>
        <Content>
          <ul className={problemList}>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Content>
      </ContextualHelp>
    </span>
  );
}

/**
 * 一个隐藏的源元素，交给预览引擎驱动。取帧要过 CORS（媒体通道按来源放行），画布才不会被「污染」。
 * 地址失效（Runtime 重启）时报错，重新取一次。视频、音频的载入结果报给舞台提示（取不到地址、解不了码）。
 */
function MediaSource({
  kind,
  mediaKey,
  videoId,
  asset,
  onOutcome,
}: {
  kind: 'video' | 'image' | 'audio';
  mediaKey: MediaKey;
  videoId: Id | null;
  asset: VersionRef;
  onOutcome?: (mediaKey: MediaKey, asset: VersionRef, outcome: MediaOutcome) => void;
}) {
  const { engine } = useEditorActions();
  const { url, error, retry } = useAssetUrl(videoId, asset);
  const [element, setElement] = useState<HTMLVideoElement | HTMLImageElement | HTMLAudioElement | null>(null);
  useEffect(() => {
    engine.register(mediaKey, element);
    return () => engine.register(mediaKey, null);
  }, [engine, mediaKey, element]);
  const { id, revision } = asset;
  useEffect(() => {
    if (error) onOutcome?.(mediaKey, { id, revision }, { kind: 'unresolved' });
  }, [error, onOutcome, mediaKey, id, revision]);
  if (!url) return null;
  if (kind === 'image') return <img ref={setElement} src={url} crossOrigin="anonymous" alt="" draggable={false} onError={retry} />;
  const failed = (event: SyntheticEvent<HTMLMediaElement>) => {
    const problem = event.currentTarget.error;
    onOutcome?.(mediaKey, asset, { kind: 'error', code: problem?.code ?? 0, message: problem?.message ?? '' });
    retry();
  };
  const loaded = () => onOutcome?.(mediaKey, asset, { kind: 'loaded' });
  if (kind === 'audio') return <audio ref={setElement} src={url} crossOrigin="anonymous" preload="auto" onError={failed} onLoadedData={loaded} />;
  return <video ref={setElement} src={url} crossOrigin="anonymous" preload="auto" playsInline muted onError={failed} onLoadedData={loaded} />;
}
