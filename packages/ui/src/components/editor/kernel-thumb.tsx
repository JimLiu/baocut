import { useEffect, useRef, useState } from 'react';
import type { RenderPlanner } from '../../render/render-planner.ts';
import { drawImage, scheduleThumb, thumbnailPlanner } from '../../render/thumbnails.ts';
import type { ThumbPicture } from './thumb-scenes.ts';

/** 画一张缩略图：尺寸是格子的设备像素，`ratio` 是像素密度。还没有可画的东西时返回 null（格子留空）。 */
export type ThumbDraw = (planner: RenderPlanner, width: number, height: number, ratio: number) => ThumbPicture | null;

/** 在缩略图下面先铺的底（设备像素）。 */
export type ThumbBackdrop = (context: CanvasRenderingContext2D, width: number, height: number) => void;

type Size = { width: number; height: number };

let loaded: RenderPlanner | null = null;

/** 缩略图共用的渲染内核实例：载入（含字体）之前为 null。 */
function useThumbPlanner(): RenderPlanner | null {
  const [planner, setPlanner] = useState(loaded);
  useEffect(() => {
    if (planner) return;
    let live = true;
    thumbnailPlanner().then(
      (value) => {
        loaded = value;
        if (live) setPlanner(value);
      },
      (error: unknown) => console.warn('缩略图的渲染内核载入失败', error), // i18n-ignore: 开发日志
    );
    return () => {
      live = false;
    };
  }, [planner]);
  return planner;
}

/**
 * 由渲染内核画的缩略图画布：按自己的 CSS 尺寸铺满设备像素，尺寸或 `draw` 变了就重画。平时排队画（一屏几十个格子
 * 不一口气卡住界面）；`live` 时（悬停播放，每一帧都换 `draw`）直接画。内核载入之前格子留空。
 */
export function KernelThumb({ draw, live = false, backdrop }: { draw: ThumbDraw; live?: boolean; backdrop?: ThumbBackdrop }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const planner = useThumbPlanner();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry!.contentRect;
      setSize((old) => (old && old.width === box.width && old.height === box.height ? old : { width: box.width, height: box.height }));
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !size || size.width <= 0 || size.height <= 0) return;
    const paint = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.round(size.width * ratio);
      const height = Math.round(size.height * ratio);
      let picture: ThumbPicture | null = null;
      if (planner) {
        try {
          picture = draw(planner, width, height, ratio);
        } catch (error) {
          console.warn('缩略图画不出来', error); // i18n-ignore: 开发日志
        }
      }
      // 尺寸没变就不重设（重设会重新分配位图）：悬停播放时每帧都要重画。
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.clearRect(0, 0, width, height);
      backdrop?.(context, width, height);
      for (const blit of picture?.blits ?? []) drawImage(context, blit.image, blit.source, blit.target);
    };
    if (live || !planner) {
      paint();
      return;
    }
    return scheduleThumb(paint);
  }, [draw, planner, size, live, backdrop]);
  return <canvas ref={ref} aria-hidden style={{ display: 'block', width: '100%', height: '100%' }} />;
}
