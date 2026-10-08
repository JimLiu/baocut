import { useCallback, useEffect, useState } from 'react';
import type { LibraryEntrySummary, Rate } from '@baocut/protocol';
import type { ElementTile } from '../../model/element-catalog.ts';
import type { TextPreset } from '../../model/text-presets.ts';
import { useLibraryFileUrl } from '../use-library-entry.ts';
import { KernelThumb, type ThumbDraw } from './kernel-thumb.tsx';
import { CONFETTI_LOOP, CONFETTI_STILL, confettiThumb, layerThumb, lottieThumb, presetThumb } from './thumb-scenes.ts';
import { ELEMENTS_COPY as EL } from './elements-copy.ts';

type Size = { width: number; height: number };

/** 元素格的缩略图：新建出来的那一层按真实比例画，缩到格子里（四周留一点边）。彩纸格走 `ConfettiThumb`，`playing` 时动起来。 */
export function ElementThumb({ tile, canvas, playing = false }: { tile: ElementTile; canvas: Size; playing?: boolean }) {
  if (tile.confetti) return <ConfettiThumb styleKey={tile.confetti} playing={playing} />;
  return <LayerThumb tile={tile} canvas={canvas} />;
}

function LayerThumb({ tile, canvas }: { tile: ElementTile; canvas: Size }) {
  const { width: canvasWidth, height: canvasHeight } = canvas;
  const draw = useCallback<ThumbDraw>(
    (planner, width, height) => {
      const frame = { width: canvasWidth, height: canvasHeight };
      return layerThumb(planner, tile.layer(frame), frame, width, height);
    },
    [tile, canvasWidth, canvasHeight],
  );
  return <KernelThumb draw={draw} />;
}

/** 悬停时从 `from` 秒起按 `loop` 秒循环往前走的时刻（`loop` 为 null 时一直往前）；不播时停在 `from`。 */
function usePlayhead(playing: boolean, from: number, loop: number | null): number {
  const [time, setTime] = useState(from);
  useEffect(() => {
    if (!playing) {
      setTime(from);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const elapsed = (now - start) / 1000;
      setTime(from + (loop === null ? elapsed : elapsed % loop));
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, from, loop]);
  return time;
}

/**
 * 彩纸的缩略图（设计稿 `ConfettiTile`）：按格子自己的像素尺寸画一帧，同一枚种子恒得同一幅；`playing` 时从 4.5 秒起
 * 播 4 秒循环。底色由外面的格子给（深底衬亮色粒子）。
 */
export function ConfettiThumb({ styleKey, playing = false }: { styleKey: string; playing?: boolean }) {
  const time = usePlayhead(playing, CONFETTI_STILL, CONFETTI_LOOP);
  const draw = useCallback<ThumbDraw>((planner, width, height) => confettiThumb(planner, styleKey, time, width, height), [styleKey, time]);
  return <KernelThumb draw={draw} live={playing} />;
}

/**
 * 品牌库贴纸的缩略图（元素页「我的贴纸」）：图片直接摆那个文件；Lottie 停在动画正中那一帧（开头常常还是空的），
 * `playing` 时从那一帧起循环播。读不出来就留空格子。
 */
export function BrandStickerThumb({
  summary,
  lottie,
  playing = false,
}: {
  summary: LibraryEntrySummary;
  lottie: boolean;
  playing?: boolean;
}) {
  const url = useLibraryFileUrl(summary);
  if (lottie) return <LottieThumb url={url} playing={playing} />;
  return url ? (
    <img src={url} alt="" draggable={false} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
  ) : null;
}

function LottieThumb({ url, playing }: { url: string | null; playing: boolean }) {
  const [file, setFile] = useState<{ url: string; bytes: Uint8Array } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(EL.lottieFetchFailed(response.status));
        return response.arrayBuffer();
      })
      .then(
        (buffer) => live && setFile({ url, bytes: new Uint8Array(buffer) }),
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [url]);
  const current = file && file.url === url ? file : null;
  const elapsed = usePlayhead(playing && !!current, 0, null);
  const draw = useCallback<ThumbDraw>(
    (planner, width, height) => (current ? lottieThumb(planner, current.url, current.bytes, elapsed, width, height) : null),
    [current, elapsed],
  );
  return <KernelThumb draw={draw} live={playing} />;
}

/** 文字预设卡的缩略图。框宽由画它的内核实例量（与新建时同一个量法）。 */
export function PresetThumb({ preset, fps }: { preset: TextPreset; fps: Rate }) {
  const draw = useCallback<ThumbDraw>(
    (planner, width, height, ratio) => presetThumb(planner, preset, fps, ratio, width, height),
    [preset, fps],
  );
  return <KernelThumb draw={draw} />;
}
