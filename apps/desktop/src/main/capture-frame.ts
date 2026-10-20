/**
 * 轻量编辑器的标记截图（lite-editor §4.1）：渲染进程给出预览画面在窗口视口里的位置（CSS 像素），主进程用 `webContents.capturePage`
 * 截那一块此刻在屏幕上的像素。预览里 HTML 动画的实时合成层画在沙箱 iframe 里、不在画布上，只有截窗口才截得到它。
 * 位置不信渲染进程给的形状，这里重新校验：四个数都要有限，取整后不出窗口左上角、有面积、不超过上限。
 */

export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 一边最多截这么多 CSS 像素（远大于任何窗口）。 */
export const CAPTURE_MAX_SIDE = 16384;

/** 只收有限的数字矩形：取整，左上角不为负，宽高大于 0 且不超过上限。 */
export function captureRect(value: unknown): CaptureRect {
  if (!value || typeof value !== 'object') throw new Error('the capture rect is missing');
  const raw = value as Record<string, unknown>;
  const pick = (key: keyof CaptureRect): number => {
    const v = raw[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`the capture rect's ${key} is not a number`);
    return Math.round(v);
  };
  const rect = { x: pick('x'), y: pick('y'), width: pick('width'), height: pick('height') };
  if (rect.x < 0 || rect.y < 0) throw new Error('the capture rect is outside the window');
  if (rect.width <= 0 || rect.height <= 0 || rect.width > CAPTURE_MAX_SIDE || rect.height > CAPTURE_MAX_SIDE) {
    throw new Error('the capture rect has no usable size');
  }
  return rect;
}
