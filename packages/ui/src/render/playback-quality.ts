/**
 * 预览的画质（架构设计 §9.4）：停住时按画布像素画内核的原帧（与导出同一份）；播放中按像素预算降分辨率，画的内容不变，
 * 由画布的 CSS 尺寸放大到显示大小。
 */

/** 停住时画原尺寸；播放中画降过分辨率的。 */
export type PaintQuality = 'exact' | 'playback';

/**
 * 播放中一帧最多画多少像素（960×540）。WASM 内核在主线程上大约每像素 40 ns（送画面加画，1314×739 一帧约 40 ms），
 * 这个预算一帧约 20 ms，加上对元素与界面更新放得进两个 60 Hz 刷新，30 fps 的视频能逐帧画上去。
 */
export const PLAYBACK_PIXELS = 960 * 540;

export interface PaintSize {
  width: number;
  height: number;
}

/**
 * 这一帧画多大：序列画布乘 `scale`（画布像素相对序列画布的比例）取整。播放中超过 `PLAYBACK_PIXELS` 的按同一比例
 * 缩到预算之内（不比停住时大）。
 */
export function paintSize(canvas: PaintSize, scale: number, quality: PaintQuality): PaintSize {
  const pixels = canvas.width * scale * canvas.height * scale;
  const factor = quality === 'playback' && pixels > PLAYBACK_PIXELS ? Math.sqrt(PLAYBACK_PIXELS / pixels) : 1;
  return {
    width: Math.max(1, Math.round(canvas.width * scale * factor)),
    height: Math.max(1, Math.round(canvas.height * scale * factor)),
  };
}
