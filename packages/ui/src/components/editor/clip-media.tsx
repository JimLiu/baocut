import { useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { mediaTimeToSeconds, type AssetRevision, type VideoItem } from '@baocut/protocol';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { filmstripTiles, sourceClock, waveEnvelope } from '../../model/clip-media.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useVisibleLane } from './use-visible-lane.ts';

/** 波形带的高（像素）。 */
const WAVE_BAND = 16;
/** 波形画布的高：波形带上下各留 2px。写成常数，画的时候不必回头量（一次挂上千段时，逐个量会让浏览器逐个重排）。 */
const WAVE_HEIGHT = WAVE_BAND - 4;
/** 波形每隔这么多像素取一点。 */
const WAVE_STEP = 2;

const layer = style({ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', pointerEvents: 'none' });
const film = style({ position: 'relative', flexGrow: 1, minHeight: 0, overflow: 'hidden' });
const tile = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  boxSizing: 'border-box',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  borderEndWidth: 1,
  borderTopWidth: 0,
  borderBottomWidth: 0,
  borderStartWidth: 0,
  borderStyle: 'solid',
  borderColor: 'transparent-black-200',
});
const band = style({
  position: 'relative',
  flexShrink: 0,
  overflow: 'hidden',
  backgroundColor: { default: 'yellow-300', isSelected: 'yellow-400' },
  borderTopWidth: 1,
  borderBottomWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: { default: 'yellow-400', isSelected: 'yellow-800' },
});
// 画布是替换元素：只给 top/bottom 撑不开，高度要写明（`WAVE_HEIGHT`，写在 style 里）。
const wave = style({
  position: 'absolute',
  top: 2,
  color: 'yellow-900',
  opacity: { default: 1, isMuted: 0.35 },
});
const titleChip = style({
  position: 'absolute',
  top: 4,
  insetStart: 4,
  maxWidth: 'calc(100% - 8px)',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  paddingX: 4,
  borderRadius: 'sm',
  backgroundColor: 'transparent-black-600',
  color: 'white',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});

/**
 * 视频片段里的胶片条与波形带（同旧版网页时间线的 `ElementMedia`）。画面与峰值由 Runtime 用 ffmpeg 算好（`media.thumbnail`、
 * `media.peaks`），这里只取看得见的那几格。片段名压在胶片条左上角。不接指针事件：拖动与裁切照常落在片段上。
 */
export function ClipMedia({
  videoId,
  item,
  record,
  clipLeft,
  clipWidth,
  clipStart,
  contentStart,
  pxPerSecond,
  scrollRef,
  head,
  selected,
  muted,
  title,
}: {
  videoId: string | null;
  item: VideoItem;
  /** 实例引用的素材版本；快照里还没有时只画片段名。 */
  record: AssetRevision | undefined;
  /** 片段在轨道内容里的位置与宽度（像素）。 */
  clipLeft: number;
  clipWidth: number;
  /** 片段左边的序列时间（秒）。 */
  clipStart: number;
  /** 实例内容开始的序列时间（秒）：拖动时跟着片段走，裁切开头时不动。 */
  contentStart: number;
  pxPerSecond: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  head: number;
  selected: boolean;
  muted: boolean;
  title: ReactNode;
}) {
  const media = useRuntime().videos.media;
  useSyncExternalStore(media.subscribe, media.version);
  const view = useVisibleLane(scrollRef, head, 0);
  const clock = useMemo(() => sourceClock(item.timeMap, contentStart), [item.timeMap, contentStart]);
  const asset = item.assetRef;
  const sourceDuration = record?.duration ? mediaTimeToSeconds(record.duration) : null;

  const tiles =
    videoId && record?.video
      ? filmstripTiles({ clipLeft, clipWidth, clipStart, pxPerSecond, clock, sourceDuration, view }).map((t) => ({
          ...t,
          url: media.thumbnail(asset, t.at),
        }))
      : [];

  // 定格没有声音；素材没有声音时不画波形带，胶片条占满。
  const hasWave = !!videoId && !!record?.audio && clock.kind === 'linear';
  const peaks = hasWave ? media.peaks(asset) : null;
  const ready = peaks?.state === 'ready' ? peaks.value : null;
  const canvasLeft = Math.max(clipLeft, view.left);
  const canvasWidth = Math.max(0, Math.round(Math.min(clipLeft + clipWidth, view.right) - canvasLeft));
  // 缩略图陆续到达时会重画，包络只在位置、缩放或峰值变了时重算。
  const points = useMemo(
    () =>
      ready
        ? waveEnvelope({
            canvasLeft,
            width: canvasWidth,
            step: WAVE_STEP,
            clipLeft,
            clipStart,
            pxPerSecond,
            clock,
            peaks: ready.peaks,
            binsPerSecond: ready.binsPerSecond,
            scale: ready.scale,
          })
        : [],
    [ready, canvasLeft, canvasWidth, clipLeft, clipStart, pxPerSecond, clock],
  );

  return (
    <div className={layer}>
      <div className={film}>
        {tiles.map((t) => (
          <i
            key={t.index}
            className={tile}
            style={{ left: t.left, width: t.width, backgroundImage: t.url ? `url(${t.url})` : undefined }}
          />
        ))}
        {title ? <span className={titleChip}>{title}</span> : null}
      </div>
      {hasWave ? (
        <div className={band({ isSelected: selected })} style={{ height: WAVE_BAND }}>
          {points.length > 1 ? <WaveCanvas left={canvasLeft - clipLeft} width={canvasWidth} muted={muted} points={points} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** 峰值包络：上下对称地填满。颜色取画布自己的 `color`，随主题变。 */
function WaveCanvas({ left, width, muted, points }: { left: number; width: number; muted: boolean; points: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    const height = WAVE_HEIGHT;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    if (points.length < 2) return;
    const mid = height / 2;
    const half = (amplitude: number) => Math.max(0.5, (amplitude * height) / 2);
    context.fillStyle = getComputedStyle(canvas).color;
    context.beginPath();
    points.forEach((amplitude, k) => context.lineTo(Math.min(width, k * WAVE_STEP), mid - half(amplitude)));
    for (let k = points.length - 1; k >= 0; k--) context.lineTo(Math.min(width, k * WAVE_STEP), mid + half(points[k]!));
    context.closePath();
    context.fill();
  }, [width, points]);
  return <canvas ref={ref} className={wave({ isMuted: muted })} style={{ left, width, height: WAVE_HEIGHT }} aria-hidden />;
}
