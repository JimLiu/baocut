import type { AreaPayload } from '../main/recording/area-picker.ts';

/*
 * 录制区域的选框页面（屏幕录制设计 §11 第 1 项）：按下拖出一个框，松手交回两个点（页面坐标，即逻辑点）；Esc 取消。
 * 太小的框、换算成屏幕坐标与夹在屏幕里都在主进程（recording-rules.ts）；这里只画框和尺寸。
 */

interface AreaBridge {
  onView(listener: (view: AreaPayload) => void): () => void;
  done(drag: { from: Point; to: Point } | null): void;
}
type Point = { x: number; y: number };

const bridge = (window as unknown as { recordingArea: AreaBridge }).recordingArea;
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const dim = $('dim');
const sel = $('sel');
const size = $('size');
const hint = $('hint');

let from: Point | null = null;
let sent = false;

const finish = (drag: { from: Point; to: Point } | null) => {
  if (sent) return;
  sent = true;
  bridge.done(drag);
};

const draw = (to: Point) => {
  if (!from) return;
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const w = Math.abs(to.x - from.x);
  const h = Math.abs(to.y - from.y);
  Object.assign(sel.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  sel.hidden = false;
  dim.hidden = true;
  hint.hidden = true;
  size.textContent = `${Math.round(w)} × ${Math.round(h)}`;
  size.hidden = false;
  // 尺寸标在框的右下角外侧；贴着屏幕底边时放到框里。
  const below = y + h + 28 < window.innerHeight;
  Object.assign(size.style, { left: `${Math.max(4, Math.min(x + w - size.offsetWidth, window.innerWidth - size.offsetWidth - 4))}px`, top: `${below ? y + h + 6 : y + h - 28}px` });
};

window.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || sent) return;
  from = { x: event.clientX, y: event.clientY };
  document.body.setPointerCapture(event.pointerId);
  draw(from);
});
window.addEventListener('pointermove', (event) => {
  if (from) draw({ x: event.clientX, y: event.clientY });
});
window.addEventListener('pointerup', (event) => {
  if (!from || event.button !== 0) return;
  const start = from;
  from = null;
  finish({ from: start, to: { x: event.clientX, y: event.clientY } });
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') finish(null);
});

bridge.onView((view) => {
  $('hint-text').textContent = view.hint;
  $('hint-cancel').textContent = view.cancel;
});
