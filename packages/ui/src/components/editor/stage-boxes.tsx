import type { CSSProperties, ReactNode } from 'react';
import type { Id } from '@baocut/protocol';
import RotateCW from '@react-spectrum/s2/icons/RotateCW';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { STAGE_COPY } from '../../copy.ts';
import {
  cornerScales,
  handlesFor,
  isCorner,
  resizeCursor,
  smallHandles,
  type Guide,
  type Handle,
  type Pose,
  type Rect,
  type ResizeKind,
} from '../../model/stage-pose.ts';
import './editor.css';

/**
 * 舞台叠加层的画法（原型 ui.css 的 .selbox / .hnd / .rot / .angchip / .selthin / .multichip / .marquee / .gline）：
 * 选中框、把手、旋转钮、角度气泡、多选统一框与它的角标、框选矩形、参考线。只管画，指针由叠加层根节点统一接：
 * 把手带 `data-handle`，旋转钮带 `data-rotate`，统一框带 `data-group`。
 */

/** 序列画布像素 → 舞台显示像素。 */
export interface View {
  kx: number;
  ky: number;
}

const itemBox = style({
  position: 'absolute',
  boxSizing: 'border-box',
  outlineStyle: { default: 'solid', isVideo: 'none' },
  outlineWidth: '[1.5px]',
  outlineColor: 'blue-800',
  outlineOffset: 0,
  cursor: { default: 'pointer', isMovable: 'move', isDragging: 'grabbing' },
});
const thinBox = style({
  position: 'absolute',
  boxSizing: 'border-box',
  outlineStyle: 'solid',
  outlineWidth: 1,
  outlineColor: 'blue-600',
  pointerEvents: 'none',
});
const groupBox = style({
  position: 'absolute',
  boxSizing: 'border-box',
  outlineStyle: 'dashed',
  outlineWidth: '[1.5px]',
  outlineColor: 'blue-800',
  cursor: { default: 'pointer', isMovable: 'move', isDragging: 'grabbing' },
});
const handle = style({
  position: 'absolute',
  boxSizing: 'border-box',
  backgroundColor: 'gray-25',
  borderRadius: 'full',
  outlineStyle: 'solid',
  outlineWidth: '[1.5px]',
  outlineColor: 'blue-800',
  boxShadow: 'elevated',
  zIndex: 2,
});
const knob = style({
  position: 'absolute',
  left: '[calc(50% - 10px)]',
  bottom: '[calc(100% + 10px)]',
  size: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'full',
  backgroundColor: 'gray-25',
  color: 'gray-700',
  boxShadow: 'elevated',
  cursor: 'grab',
  zIndex: 2,
});
const knobIcon = iconStyle({ size: 'XS' });
const angleChip = style({
  position: 'absolute',
  left: '50%',
  bottom: '[calc(100% + 36px)]',
  paddingX: 8,
  paddingY: 2,
  borderRadius: 'sm',
  font: 'code-xs',
  whiteSpace: 'nowrap',
  backgroundColor: 'transparent-black-800',
  color: 'white',
  pointerEvents: 'none',
});
const chip = style({
  position: 'absolute',
  left: '50%',
  top: '[calc(100% + 8px)]',
  paddingX: 8,
  paddingY: 2,
  borderRadius: 'sm',
  font: 'ui-xs',
  whiteSpace: 'nowrap',
  backgroundColor: 'blue-800',
  color: 'gray-25',
  pointerEvents: 'none',
});
const marqueeBox = style({
  position: 'absolute',
  boxSizing: 'border-box',
  borderStyle: 'solid',
  borderWidth: 1,
  borderColor: 'blue-800',
  backgroundColor: 'blue-400',
  borderRadius: 'sm',
  opacity: 0.22,
  pointerEvents: 'none',
});
const guideLine = style({ position: 'absolute', backgroundColor: 'blue-800', pointerEvents: 'none' });

/** 盒在舞台上的位置（未旋转；旋转交给 CSS 绕中心转，与盒的口径一致）。 */
export function displayRect(pose: Pose, view: View): CSSProperties {
  return {
    left: (pose.cx - pose.w / 2) * view.kx,
    top: (pose.cy - pose.h / 2) * view.ky,
    width: pose.w * view.kx,
    height: pose.h * view.ky,
  };
}

/** 把手的落位（照抄原型：四角 12px 圆点压在框角外 7px，边条 4×20 外沿贴着描边；小盒一档 8px）。 */
function handlePlace(h: Handle, small: boolean): CSSProperties {
  if (isCorner(h)) {
    const size = small ? 8 : 12;
    const off = small ? -4 : -7;
    return { width: size, height: size, [h.includes('n') ? 'top' : 'bottom']: off, [h.includes('w') ? 'left' : 'right']: off };
  }
  const long = small ? 8 : 20;
  if (h === 'w' || h === 'e') return { width: 4, height: long, top: '50%', marginTop: -long / 2, [h === 'w' ? 'left' : 'right']: h === 'w' ? -4 : -3 };
  return { width: long, height: 4, left: '50%', marginLeft: -long / 2, [h === 'n' ? 'top' : 'bottom']: h === 'n' ? -4 : -3 };
}

function handleTip(kind: ResizeKind, h: Handle): string {
  if (isCorner(h)) return cornerScales(kind, h) ? STAGE_COPY.cornerScaleTip : STAGE_COPY.cornerFreeTip;
  return h === 'n' || h === 's' ? STAGE_COPY.edgeHeightTip : STAGE_COPY.edgeWidthTip;
}

/** 单件的选中框：可改时带把手与旋转钮；旋转中出角度气泡（反向抵消框的旋转，读数不歪）。 */
export function ItemBox({
  id,
  pose,
  view,
  kind,
  video,
  controls,
  movable,
  dragging,
  angle,
  children,
}: {
  id: Id;
  pose: Pose;
  view: View;
  kind: ResizeKind;
  /** 视频不画描边（原型 .selbox--video），只出把手。 */
  video: boolean;
  /** 出把手与旋转钮（可改、没在播放）。 */
  controls: boolean;
  movable: boolean;
  dragging: boolean;
  angle: number | null;
  children?: ReactNode;
}) {
  const w = pose.w * view.kx;
  const h = pose.h * view.ky;
  const small = smallHandles(w, h);
  return (
    <div
      className={itemBox({ isVideo: video, isMovable: movable, isDragging: dragging })}
      style={{ ...displayRect(pose, view), transform: `rotate(${pose.rotation}deg)` }}
      data-box={id}
    >
      {children}
      {controls
        ? handlesFor(kind, w, h).map((hd) => (
            <div
              key={hd}
              className={`${handle} bc-stage-handle`}
              style={{ ...handlePlace(hd, small), cursor: resizeCursor(hd, pose.rotation) }}
              title={handleTip(kind, hd)}
              data-handle={hd}
            />
          ))
        : null}
      {controls ? (
        <div className={`${knob} bc-stage-rotate`} title={STAGE_COPY.rotateTip} data-rotate={id}>
          <RotateCW styles={knobIcon} data-bc-icons="own" />
        </div>
      ) : null}
      {angle !== null ? (
        <div className={angleChip} style={{ transform: `translateX(-50%) rotate(${-pose.rotation}deg)` }}>
          {STAGE_COPY.degrees(angle)}
        </div>
      ) : null}
    </div>
  );
}

/** 多选时每件只留一条细描边（原型 .selthin）。 */
export function ThinBox({ pose, view }: { pose: Pose; view: View }) {
  return <div className={thinBox} style={{ ...displayRect(pose, view), transform: `rotate(${pose.rotation}deg)` }} />;
}

const GROUP_CORNERS: Handle[] = ['nw', 'ne', 'sw', 'se'];

/** 多选统一框（原型 MultiBox）：虚线外包框，整体拖动、四角整体等比缩放，没有旋转钮；下方角标「已选 N 个」。 */
export function GroupBox({
  bounds,
  view,
  count,
  controls,
  dragging,
}: {
  bounds: Rect;
  view: View;
  count: number;
  controls: boolean;
  dragging: boolean;
}) {
  return (
    <div
      className={groupBox({ isMovable: controls, isDragging: dragging })}
      style={{ left: bounds.x * view.kx, top: bounds.y * view.ky, width: bounds.w * view.kx, height: bounds.h * view.ky }}
      data-group
    >
      {controls
        ? GROUP_CORNERS.map((hd) => (
            <div
              key={hd}
              className={`${handle} bc-stage-handle`}
              style={{ ...handlePlace(hd, false), cursor: resizeCursor(hd, 0) }}
              title={STAGE_COPY.groupCornerTip}
              data-handle={hd}
            />
          ))
        : null}
      <div className={chip} style={{ transform: 'translateX(-50%)' }}>
        {STAGE_COPY.picked(count)}
      </div>
    </div>
  );
}

/** 框选矩形（舞台显示像素）。 */
export function Marquee({ rect }: { rect: Rect }) {
  return <div className={marqueeBox} style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />;
}

/** 对齐参考线：1px，横贯画面；手势中现算，松手消失。 */
export function Guides({ guides, view }: { guides: Guide[]; view: View }) {
  return (
    <>
      {guides.map((g) => (
        <i
          key={`${g.axis}:${g.at}`}
          className={guideLine}
          style={g.axis === 'x' ? { left: g.at * view.kx, top: 0, bottom: 0, width: 1 } : { top: g.at * view.ky, left: 0, right: 0, height: 1 }}
        />
      ))}
    </>
  );
}
