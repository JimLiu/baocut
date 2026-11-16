import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ActionButton, ToggleButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import AspectRatio from '@react-spectrum/s2/icons/AspectRatio';
import Circle from '@react-spectrum/s2/icons/Circle';
import Close from '@react-spectrum/s2/icons/Close';
import FlipHorizontal from '@react-spectrum/s2/icons/FlipHorizontal';
import Maximize from '@react-spectrum/s2/icons/Maximize';
import Minimize from '@react-spectrum/s2/icons/Minimize';
import { CAMERA, cameraBox, nextShape, resizeCamera, toggleCameraSize } from '../../model/recording-area.ts';
import { useRecordingPrefs } from '../../state/recordings-store.ts';
import { deviceName, useCameraStream } from './recording-media.ts';
import { RS } from './recording-surface-copy.ts';
import { useSurface } from './recording-surface.tsx';

/*
 * 摄像头预览浮窗（屏幕录制设计 §11「摄像头预览」）：缺省 230，拖四角在 150–600 间缩放，任意处拖动并记住位置；悬停时出现工具条：
 * 关闭（开始前是不用摄像头，录制中只是收起预览）、大小（230 ↔ 400）、形状（圆 → 方 → 宽屏 16:9）、镜像。形状与镜像只是预览的样子，
 * 不改录下的画面。开始录制后留在屏幕上。画面只在系统已经允许摄像头时才取；取不到时只显示设备名。
 */

/** 小窗在画面外留的边：上面给工具条，四周给缩放的角。 */
const PAD = { side: 8, top: 56 } as const;

export function SurfaceCamera() {
  const s = useSurface();
  const cam = useRecordingPrefs((p) => p.camera);
  const r = s.state.recording;
  const id = r ? r.options.camera : (s.choice?.camera ?? null);
  const name = deviceName(s.sources, 'camera', id);
  const { stream, failed } = useCameraStream(name, s.sources);
  const videoRef = useRef<HTMLVideoElement>(null);
  const box = cameraBox(cam.size, cam.shape);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);
  // 大小、形状变了：告诉主进程小窗该多大、摆在哪。
  useEffect(() => {
    void s.act({ type: 'camera-bounds', box, pos: cam.pos, pad: PAD });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.width, box.height, cam.pos?.x, cam.pos?.y]);

  const origin = () => ({ x: window.screenX + PAD.side, y: window.screenY + PAD.top });
  const drag = (e: ReactPointerEvent, onMove: (dx: number, dy: number) => void, onEnd: () => void) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.screenX;
    const y0 = e.screenY;
    const move = (ev: PointerEvent) => onMove(ev.screenX - x0, ev.screenY - y0);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onEnd();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onMoveStart = (e: ReactPointerEvent) => {
    if ((e.target as Element).closest('.bc-rcam__tools, .bc-rcam__corner')) return;
    const p0 = origin();
    let pos = p0;
    drag(
      e,
      (dx, dy) => {
        pos = { x: p0.x + dx, y: p0.y + dy };
        void s.act({ type: 'camera-bounds', box, pos, pad: PAD });
      },
      () => useRecordingPrefs.getState().setCamera({ pos }),
    );
  };
  const onCorner = (corner: 'nw' | 'ne' | 'sw' | 'se') => (e: ReactPointerEvent) => {
    e.stopPropagation();
    const p0 = origin();
    const right = p0.x + box.width;
    const bottom = p0.y + box.height;
    let next = { size: cam.size, pos: p0 };
    drag(
      e,
      (dx, dy) => {
        const size = resizeCamera(cam.size, corner, dx, dy);
        const b = cameraBox(size, cam.shape);
        // 往左上缩放时，右下角不动。
        const pos = { x: corner.includes('w') ? right - b.width : p0.x, y: corner.includes('n') ? bottom - b.height : p0.y };
        next = { size, pos };
        void s.act({ type: 'camera-bounds', box: b, pos, pad: PAD });
      },
      () => useRecordingPrefs.getState().setCamera(next),
    );
  };
  const set = useRecordingPrefs.getState().setCamera;
  const shapeName = cam.shape === 'round' ? RS.shapeRound : cam.shape === 'square' ? RS.shapeSquare : RS.shapeWide;
  const big = cam.size >= CAMERA.big;

  return (
    <div
      className={`bc-rcam bc-rcam--${cam.shape}`}
      style={{ left: PAD.side, top: PAD.top, width: box.width, height: box.height }}
      onPointerDown={onMoveStart}
      role="region"
      aria-label={RS.cameraPreview(name ?? '')}>
      <div className="bc-rcam__tools" role="toolbar" aria-label={RS.cameraTools}>
        <Tip label={r ? RS.cameraHideTip : RS.cameraCloseTip}>
          <ActionButton isQuiet size="S" aria-label={RS.cameraClose} onPress={() => void s.act({ type: 'camera-close' })}>
            <Close />
          </ActionButton>
        </Tip>
        <Tip label={big ? RS.sizeSmaller : RS.sizeLarger}>
          <ActionButton isQuiet size="S" aria-label={big ? RS.sizeSmaller : RS.sizeLarger} onPress={() => set({ size: toggleCameraSize(cam.size) })}>
            {big ? <Minimize /> : <Maximize />}
          </ActionButton>
        </Tip>
        <Tip label={RS.shapeTip(shapeName)}>
          <ActionButton isQuiet size="S" aria-label={RS.shape} onPress={() => set({ shape: nextShape(cam.shape) })}>
            {cam.shape === 'round' ? <Circle /> : <AspectRatio />}
          </ActionButton>
        </Tip>
        <Tip label={RS.mirror}>
          <ToggleButton isQuiet size="S" aria-label={RS.mirror} isSelected={cam.mirror} onChange={(mirror) => set({ mirror })}>
            <FlipHorizontal />
          </ToggleButton>
        </Tip>
      </div>
      <div className={`bc-rcam__view${cam.mirror ? ' is-mirror' : ''}`}>
        {stream && !failed ? <video ref={videoRef} className="bc-rcam__video" autoPlay muted playsInline /> : null}
      </div>
      {stream && !failed ? null : <span className="bc-rcam__name">{name ?? ''}</span>}
      {(['nw', 'ne', 'sw', 'se'] as const).map((k) => (
        <span key={k} className={`bc-rcam__corner bc-rcam__corner--${k}`} onPointerDown={onCorner(k)} />
      ))}
    </div>
  );
}

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipTrigger placement="bottom">
      {children}
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
  );
}
