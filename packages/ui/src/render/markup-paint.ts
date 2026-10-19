import type { VideoAnnotationColor } from '@baocut/protocol';
import { MARKUP_TEXT_SIZE, stepNumber, type Mark } from '../model/markup.ts';
import type { Size } from '../model/video-annotations.ts';

/**
 * 标记截图（docs/design/lite-editor §4.1）：把一帧的底图与这一帧的标记画成一张 PNG，随视频标注作为图片附件交给智能体。
 * 底图是画第一条标记时从预览画布（或 Electron 窗口）拷下的那一帧；标记按归一化坐标落到底图像素，线宽、字号与印章按底图比画面
 * 的比例放大，样子同标记层上的 SvgMark 与 HTML 标记。只有画布 2D，没有 React；标注草稿 store 在标注增删时用它重画。
 */

/** 截图上印章的颜色（画布 2D 用不了 S2 的色票，取与 red-900 等相近的值）。 */
export const SHOT_COLORS: Record<VideoAnnotationColor, string> = {
  red: '#d31510',
  blue: '#3b63fb',
  green: '#05834e',
  black: '#000000',
  white: '#ffffff',
};

/** 一帧的图：底图（留下的 PNG 或画布）画到新画布上，再把这一帧的标记画上去（序号按整组 `group` 数），存成 `frame-<毫秒>.png`。 */
export async function paintFrame(
  base: Blob | HTMLCanvasElement | null | undefined,
  marks: readonly Mark[],
  group: readonly Mark[],
  timeMs: number,
  layer: Size,
  initials: string,
): Promise<File | null> {
  if (!base) return null;
  const image = base instanceof Blob ? await loadImage(base) : base;
  const w = image.width;
  const h = image.height;
  if (!w || !h) return null;
  const copy = document.createElement('canvas');
  copy.width = w;
  copy.height = h;
  const ctx = copy.getContext('2d');
  let out: HTMLCanvasElement = base instanceof Blob ? copy : base;
  if (ctx) {
    ctx.drawImage(image, 0, 0);
    paintMarks(ctx, marks, { w, h }, layer, initials, group);
    out = copy;
  }
  if (typeof out.toBlob !== 'function') return null;
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return new File([blob], `frame-${timeMs}.png`, { type: 'image/png' });
}
function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('frame image failed to decode'));
    };
    image.src = url;
  });
}

/**
 * 把一帧的标记画到画布上（同 SvgMark 与 HTML 标记的样子）：坐标按归一化值落到画布像素，线宽、字号与印章按画布比画面的比例放大，
 * 文字描一圈反色边代替网页里的阴影；序号按 `group`（整组标记，默认就是这些）数。
 */
export function paintMarks(
  ctx: CanvasRenderingContext2D,
  marks: readonly Mark[],
  size: Size,
  layer: Size,
  initials: string,
  group: readonly Mark[] = marks,
): void {
  const X = (v: number) => v * size.w;
  const Y = (v: number) => v * size.h;
  const scale = layer.w > 0 ? size.w / layer.w : 1;
  for (const m of marks) {
    const fill = SHOT_COLORS[m.color];
    const sw = m.width * scale;
    ctx.save();
    ctx.strokeStyle = fill;
    ctx.fillStyle = fill;
    ctx.lineWidth = sw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (m.kind === 'pen' && m.points?.length) {
      ctx.beginPath();
      m.points.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
      ctx.stroke();
    } else if ((m.kind === 'line' || m.kind === 'arrow') && m.to) {
      const x1 = X(m.x);
      const y1 = Y(m.y);
      const x2 = X(m.to.x);
      const y2 = Y(m.to.y);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (m.kind === 'arrow') {
        const headSize = sw * 3 + 6 * scale;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - headSize * Math.cos(angle - 0.45), y2 - headSize * Math.sin(angle - 0.45));
        ctx.lineTo(x2 - headSize * Math.cos(angle + 0.45), y2 - headSize * Math.sin(angle + 0.45));
        ctx.closePath();
        ctx.lineWidth = scale;
        ctx.fill();
        ctx.stroke();
      }
    } else if (m.kind === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(X(m.x + m.w / 2), Y(m.y + m.h / 2), X(m.w) / 2, Y(m.h) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (m.kind === 'box' || m.kind === 'element') {
      ctx.beginPath();
      ctx.roundRect(X(m.x), Y(m.y), X(m.w), Y(m.h), (m.kind === 'element' ? 4 : 2) * scale);
      ctx.stroke();
    } else if (m.kind === 'pin') {
      const r = 12 * scale;
      const cx = X(m.x);
      const cy = Y(m.y);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = fill === SHOT_COLORS.white ? '#000000' : '#ffffff';
      ctx.lineWidth = 2 * scale;
      ctx.stroke();
      ctx.fillStyle = fill === SHOT_COLORS.white ? '#000000' : '#ffffff';
      ctx.font = `bold ${Math.round(12 * scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(stepNumber(group, m.id) ?? ''), cx, cy);
    } else if (m.kind === 'comment') {
      drawStamp(ctx, X(m.x), Y(m.y), Math.max(14, Math.round(Math.min(size.w, size.h) / 40)), fill, initials);
    } else if (m.kind === 'text' && m.text) {
      const px = MARKUP_TEXT_SIZE[m.width] * scale;
      ctx.font = `bold ${Math.round(px)}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.strokeStyle = fill === SHOT_COLORS.white ? 'rgb(0 0 0 / 0.9)' : 'rgb(255 255 255 / 0.9)';
      ctx.lineWidth = Math.max(2, px / 6);
      m.text.split('\n').forEach((line, i) => {
        const y = Y(m.y) + i * px * 1.2;
        ctx.strokeText(line, X(m.x), y);
        ctx.fillText(line, X(m.x), y);
      });
    }
    ctx.restore();
  }
}

/** 印章：半径 r 的圆，左下角收成尖角落在 (x, y)；白边，写缩写。 */
function drawStamp(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, initials: string): void {
  const cx = x + r;
  const cy = y - r;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, cy);
  ctx.arc(cx, cy, r, Math.PI, Math.PI / 2, false);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill === SHOT_COLORS.white ? '#000000' : '#ffffff';
  ctx.lineWidth = Math.max(2, r / 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = fill === SHOT_COLORS.white ? '#000000' : '#ffffff';
  ctx.font = `bold ${Math.round(r * 0.9)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials, cx, cy);
  ctx.restore();
}
