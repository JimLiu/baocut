import { useEffect, useRef } from 'react';
import { THUMB_BACKDROP } from '../../model/caption-presets.ts';
import type { Json, LineKind } from '../../render/text-style.ts';
import { drawImage, scheduleThumb } from '../../render/thumbnails.ts';
import { CaptionLoop, type LoopCell } from './caption-loop.ts';
import { useCanvasSize, useThumbPlanner } from './kernel-thumb.tsx';
import { captionFrame, captionSample, type CaptionSample } from './thumb-scenes.ts';

/** 缩略图的灰底（原型 .sthumb 的渐变）。 */
function backdrop(context: CanvasRenderingContext2D, width: number, height: number): void {
  const fill = context.createLinearGradient(0, 0, width, height);
  fill.addColorStop(0, THUMB_BACKDROP[0]);
  fill.addColorStop(1, THUMB_BACKDROP[1]);
  context.fillStyle = fill;
  context.fillRect(0, 0, width, height);
}

/* ---------- 共用时钟 ----------
   一屏几十张卡共用一个 requestAnimationFrame、一个原点：同一刻每张卡念到同一个词（原型画廊的共用节拍器），
   没有卡在动时它自己停。页面藏起来时浏览器不调 rAF，也就不画。 */

/** `seconds` 是从原点算起的时钟；`spare()` 为假时这一下叫内核画帧的时间已经花完，先不换帧。 */
type Tick = (seconds: number, spare: () => boolean) => void;

const ticks = new Set<Tick>();
let request = 0;
const epoch = performance.now();
/** 一下时钟里各卡叫内核画帧一共最多花多少毫秒：超了的卡留着上一格，下一下再画，不拖住整页。 */
const TICK_BUDGET = 6;

function run(now: number): void {
  request = requestAnimationFrame(run);
  const start = performance.now();
  const spare = () => performance.now() - start < TICK_BUDGET;
  for (const tick of ticks) tick((now - epoch) / 1000, spare);
}

function onTick(tick: Tick): () => void {
  ticks.add(tick);
  request ||= requestAnimationFrame(run);
  return () => {
    ticks.delete(tick);
    if (ticks.size || !request) return;
    cancelAnimationFrame(request);
    request = 0;
  };
}

/**
 * 一张字幕样式缩略图（原型 `SubThumb`）：灰底上按这份样式画英中样张，由渲染内核画（与预览、导出同一套字体、描边、
 * 底板与阴影）。大的那一行 `px` 像素；放不下时整体缩小，不折行。
 *
 * 原文那一句按这份样式的逐词动画一拍一个词地念，念完停一拍再从头（原型 `useSubBeat`）。只有在视野里的卡跟着时钟
 * 走；一圈的帧画过一遍就存着循环贴（`CaptionLoop`），滚出视野就丢掉；没有逐词动画的卡画完一圈就不再走。
 * `prefers-reduced-motion` 下不动，停在第二个词念到三成五的那一格。
 */
export function CaptionThumb({ root, kinds, px }: { root: Json; kinds: readonly LineKind[]; px: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(ref);
  const planner = useThumbPlanner();
  const key = kinds.join(',');
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !size || size.width <= 0 || size.height <= 0 || !planner) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(size.width * ratio);
    const height = Math.round(size.height * ratio);
    const lines = key ? (key.split(',') as LineKind[]) : [];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let sample: CaptionSample | null = null;
    let loop: CaptionLoop | null = null;
    let shown = -1;
    /** 画布上贴着的那一格：下一格是同一份画面（按词变色的一拍里）就不重贴。 */
    let painted: LoopCell | null = null;
    let visible = false;
    let stop: (() => void) | null = null;

    const paint = (cell: LoopCell | null) => {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.clearRect(0, 0, width, height);
      backdrop(context, width, height);
      if (cell?.image) drawImage(context, cell.image, { x: 0, y: 0, width: cell.image.width, height: cell.image.height }, cell.at);
    };
    const frame = (seconds: number): ImageData | null => {
      try {
        return captionFrame(planner, sample!, seconds, width, height).blits[0]!.image;
      } catch (error) {
        console.warn('缩略图画不出来', error); // i18n-ignore: 开发日志
        return null;
      }
    };
    const still = () => {
      if (!sample) return;
      const image = frame(sample.still);
      paint(image && { image, at: { x: 0, y: 0, width, height } });
      shown = -1;
      painted = null;
    };
    const tick: Tick = (seconds, spare) => {
      if (!loop) return;
      const index = loop.index(seconds);
      if (index === shown) return;
      let cell = loop.get(index);
      if (!cell) {
        if (!spare()) return;
        const image = frame(loop.time(index));
        if (!image) {
          // 画不出来（已经报过）：留着上一格，不再跟着时钟走。
          loop = null;
          sync();
          return;
        }
        cell = loop.put(index, image);
      }
      if (cell !== painted) paint(cell);
      painted = cell;
      shown = index;
      // 一圈都是同一份画面（这份样式没有逐词动画）：停在这一格。
      if (loop.still) {
        loop = null;
        sync();
      }
    };
    const sync = () => {
      const moving = !!loop && visible && !reduced.matches;
      if (moving && !stop) stop = onTick(tick);
      if (!moving && stop) {
        stop();
        stop = null;
      }
    };
    const onMotion = () => {
      sync();
      if (reduced.matches) still();
    };

    const first = scheduleThumb(() => {
      try {
        sample = captionSample(planner, root, lines, px * ratio, width, height);
      } catch (error) {
        console.warn('缩略图画不出来', error); // i18n-ignore: 开发日志
        paint(null);
        return;
      }
      still();
      if (sample.period > 0) loop = new CaptionLoop(sample.period);
      sync();
    });
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry!.isIntersecting;
      // 滚出视野的卡不留帧：一屏外的几十张卡不占着内存，滚回来再画。
      if (!visible) loop?.clear();
      sync();
    });
    observer.observe(canvas);
    reduced.addEventListener('change', onMotion);
    return () => {
      first();
      observer.disconnect();
      reduced.removeEventListener('change', onMotion);
      stop?.();
    };
  }, [planner, size, root, key, px]);
  return <canvas ref={ref} aria-hidden style={{ display: 'block', width: '100%', height: '100%' }} />;
}
