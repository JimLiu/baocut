import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { imagePoint } from '../../model/image-preview.ts';
export function useImageZoom(
  stage: RefObject<HTMLDivElement | null>,
  canvas: RefObject<HTMLDivElement | null>,
  percent: number,
  setZoom: (s: string) => void,
  phase: string,
) {
  const state = useRef({ percent, setZoom });
  state.current = { percent, setZoom };
  const touch = useRef<{ distance: number; zoom: number } | null>(null),
    last = useRef(0);
  const around = useCallback(
    (n: number, p?: { x: number; y: number }) => {
      const viewport = stage.current,
        picture = canvas.current;
      if (!viewport || !picture) {
        state.current.setZoom(String(n));
        return;
      }
      const before = picture.getBoundingClientRect(),
        bounds = viewport.getBoundingClientRect();
      const anchorPoint = p || { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 },
        anchor = imagePoint(anchorPoint, before);
      if (!anchor) return;
      flushSync(() => state.current.setZoom(String(Math.max(10, Math.min(400, n)))));
      const after = picture.getBoundingClientRect();
      viewport.scrollLeft += after.left + after.width * anchor.x - anchorPoint.x;
      viewport.scrollTop += after.top + after.height * anchor.y - anchorPoint.y;
    },
    [stage, canvas],
  );
  useEffect(() => {
    const e = stage.current;
    if (!e) return;
    const distance = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const wheel = (ev: WheelEvent) => {
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        around(Math.round(state.current.percent * Math.exp(-ev.deltaY * 0.01)), { x: ev.clientX, y: ev.clientY });
      }
    };
    const start = (ev: TouchEvent) => {
      if (ev.touches.length === 2) {
        ev.preventDefault();
        touch.current = { distance: distance(ev.touches), zoom: state.current.percent };
      }
    };
    const move = (ev: TouchEvent) => {
      if (ev.touches.length === 2 && touch.current && touch.current.distance > 0) {
        ev.preventDefault();
        around((touch.current.zoom * distance(ev.touches)) / touch.current.distance, {
          x: (ev.touches[0]!.clientX + ev.touches[1]!.clientX) / 2,
          y: (ev.touches[0]!.clientY + ev.touches[1]!.clientY) / 2,
        });
        last.current = performance.now();
      }
    };
    const end = () => {
      touch.current = null;
    };
    e.addEventListener('wheel', wheel, { passive: false });
    e.addEventListener('touchstart', start, { passive: false });
    e.addEventListener('touchmove', move, { passive: false });
    e.addEventListener('touchend', end);
    e.addEventListener('touchcancel', end);
    return () => {
      e.removeEventListener('wheel', wheel);
      e.removeEventListener('touchstart', start);
      e.removeEventListener('touchmove', move);
      e.removeEventListener('touchend', end);
      e.removeEventListener('touchcancel', end);
    };
  }, [around, phase, stage]);
  return { around, isPinching: () => !!touch.current || performance.now() - last.current < 250 };
}
