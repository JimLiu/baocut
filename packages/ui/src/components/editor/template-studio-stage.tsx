import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { framesToSeconds, sequenceDurationFrames, type Sequence, type TemplateBox } from '@baocut/protocol';
import Edit from '@react-spectrum/s2/icons/Edit';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { infoOf, withLayer } from '../../model/template-layers.ts';
import { dragBox, resizeBox, STUDIO_HANDLES, type StudioHandle } from '../../model/template-studio.ts';
import { resizeCursor } from '../../model/stage-pose.ts';
import { useEditor } from '../../state/editor-store.ts';
import { kindLabel } from './elements-templates.tsx';
import { KernelThumb, type ThumbDraw } from './kernel-thumb.tsx';
import { handle as handleStyle, handlePlace } from './stage-boxes.tsx';
import { TEMPLATE_COPY as TC } from './template-copy.ts';
import { useTemplateLogos } from './use-template-logos.ts';
import { demoChapters } from './template-thumb.tsx';
import { TEMPLATE_DEMO_AT, TEMPLATE_DEMO_SECONDS, templateCanvas, templateStage } from './thumb-scenes.ts';

/** 盖住整个舞台：画面外点一下是取消选中。 */
const root = style({ position: 'absolute', inset: 0, userSelect: 'none', touchAction: 'none', zIndex: 1 });
/** 版面的画面：深底、细网格（原型 .frame__bg / .frame__grid），只有模板层。 */
const frame = style({
  position: 'absolute',
  overflow: 'hidden',
  borderRadius: 'sm',
  backgroundColor: 'gray-900',
  boxShadow: 'emphasized',
});
const fill = style({ position: 'absolute', inset: 0, pointerEvents: 'none' });
const GRID = {
  backgroundImage:
    'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
  backgroundSize: '10% 10%',
};
/** 画面上沿外的提示（原型 .peekflag）：放在舞台留白里，不盖住贴顶的层。`font` 简写自带颜色，颜色写在它后面。 */
const flag = style({
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  boxSizing: 'border-box',
  paddingX: 8,
  paddingY: 2,
  borderRadius: 'default',
  backgroundColor: 'transparent-black-800',
  font: 'ui-xs',
  color: 'white',
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  '--iconPrimary': { type: 'fill', value: 'white' },
});
const flagText = style({ truncate: true });
const flagIcon = iconStyle({ size: 'XS' });
/** 字幕会落在哪（原型 .tplguide）：一条虚线，线上写字。 */
const guide = style({
  position: 'absolute',
  insetX: 0,
  borderTopStyle: 'dashed',
  borderTopWidth: 1,
  borderColor: 'transparent-white-500',
  pointerEvents: 'none',
});
const guideText = style({
  position: 'absolute',
  insetEnd: 8,
  bottom: 2,
  font: 'ui-xs',
  color: 'transparent-white-700',
  whiteSpace: 'nowrap',
});
/** 一层的框：没选中时虚线淡框，选中描蓝；关着的层更淡。 */
const layerBox = style({
  position: 'absolute',
  boxSizing: 'border-box',
  outlineStyle: { default: 'dashed', isPicked: 'solid' },
  outlineWidth: { default: 1, isPicked: '[1.5px]' },
  outlineColor: { default: 'transparent-white-400', isPicked: 'blue-800' },
  opacity: { default: 1, isOff: 0.4 },
  cursor: { default: 'move', isDragging: 'grabbing' },
});

type Gesture = { id: string; handle: StudioHandle | null; x0: number; y0: number; box0: TemplateBox; box: TemplateBox | null };

const PADDING = 24;

/**
 * 版面编辑器的舞台（原型 template-render.jsx `TemplateStudioStage`）：替换掉正常舞台的点选层，画面只画草稿里的模板层
 * （与预览同一个渲染内核），视频、字幕与其它元素这时都不可选。层可拖动、可拉八把手改大小（几何在引擎里），拖动中只改
 * 这里的框，松手才写进草稿。从视频进来时画面按视频的画布、读这部视频的章节与播放头；从品牌页进来按模板自己的画幅、读示范章节。
 */
export function TemplateStudioStage({ sequence, stage }: { sequence: Sequence; stage: { width: number; height: number } }) {
  const studio = useEditor((s) => s.templateStudio);
  const playhead = useEditor((s) => s.playhead);
  const [live, setLive] = useState<{ id: string; box: TemplateBox } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const draft = studio?.draft ?? null;
  const fromVideo = studio?.source === 'video' || studio?.source === 'new-video';
  const canvas = useMemo(
    () => (fromVideo || !draft ? { width: sequence.canvas.width, height: sequence.canvas.height } : templateCanvas(draft)),
    [fromVideo, draft, sequence.canvas.width, sequence.canvas.height],
  );
  const scale = Math.max(0, Math.min((stage.width - PADDING * 2) / canvas.width, (stage.height - PADDING * 2) / canvas.height));
  const fw = Math.floor(canvas.width * scale);
  const fh = Math.floor(canvas.height * scale);
  const shown = useMemo(() => (draft && live ? withLayer(draft, live.id, { box: live.box }) : draft), [draft, live]);
  const markers = fromVideo ? sequence.markers : demoChapters();
  const moment = useMemo(
    () =>
      fromVideo
        ? {
            markers,
            title: sequence.name,
            seconds: playhead,
            duration: Math.max(1, framesToSeconds(sequenceDurationFrames(sequence), sequence.fps)),
          }
        : { markers, title: TC.demoTitle, seconds: TEMPLATE_DEMO_SECONDS * TEMPLATE_DEMO_AT, duration: TEMPLATE_DEMO_SECONDS },
    [fromVideo, markers, sequence, playhead],
  );
  const logos = useTemplateLogos(draft);
  const draw = useCallback<ThumbDraw>(
    (planner, w, h) => (shown ? templateStage(planner, shown, canvas, moment, w, h, logos) : null),
    [shown, canvas, moment, logos],
  );
  if (!studio || !shown || fw <= 0 || fh <= 0) return null;
  const select = (id: string | null) => useEditor.getState().updateStudio((s) => (s.layer === id ? s : { ...s, layer: id }));
  const portraitCanvas = canvas.height > canvas.width;
  const drawnFor = shown.canvas ?? '16:9';
  const mismatch = fromVideo && (drawnFor === '9:16') !== portraitCanvas;
  const subsAt = infoOf({ ...shown, subsAvoid: true }).subsBottom;
  const left = (stage.width - fw) / 2;
  const top = (stage.height - fh) / 2;

  const start = (event: ReactPointerEvent<HTMLElement>, id: string, handle: StudioHandle | null) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const layer = shown.layers.find((l) => l.id === id);
    if (!layer) return;
    select(id);
    gesture.current = { id, handle, x0: event.clientX, y0: event.clientY, box0: layer.box, box: null };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.x0;
    const dy = event.clientY - g.y0;
    if (!g.box && Math.hypot(dx, dy) < 3) return;
    const size = { width: fw, height: fh };
    g.box = g.handle ? resizeBox(g.box0, g.handle, dx, dy, size) : dragBox(g.box0, dx, dy, size);
    setLive({ id: g.id, box: g.box });
  };
  const end = () => {
    const g = gesture.current;
    gesture.current = null;
    setLive(null);
    const box = g?.box;
    if (g && box) useEditor.getState().updateStudio((s) => ({ ...s, draft: withLayer(s.draft, g.id, { box }) }));
  };

  return (
    <div className={root} onPointerDown={() => select(null)}>
      <div className={flag} style={{ left, top: top - 2, maxWidth: fw, transform: 'translateY(-100%)' }}>
        <Edit styles={flagIcon} />
        <span className={flagText}>
          {TC.studioHint}
          {mismatch ? ` · ${TC.studioDrawnFor(drawnFor)}` : ''}
        </span>
      </div>
      <div
        className={frame}
        style={{ left, top, width: fw, height: fh }}
        role="group"
        aria-label={TC.studioCanvasLabel}
        data-template-studio>
        <div className={fill} style={GRID} />
        <div className={fill}>
          <KernelThumb draw={draw} live={live !== null} />
        </div>
        {subsAt ? (
          <div className={guide} style={{ bottom: `${subsAt}%` }}>
            <span className={guideText}>{TC.subtitleGuide}</span>
          </div>
        ) : null}
        {shown.layers.map((layer) => {
          const picked = studio.layer === layer.id;
          const name = kindLabel(layer.kind);
          return (
            <div
              key={layer.id}
              className={layerBox({ isPicked: picked, isOff: layer.on === false, isDragging: live?.id === layer.id })}
              style={{ left: `${layer.box.x}%`, top: `${layer.box.y}%`, width: `${layer.box.w}%`, height: `${layer.box.h}%` }}
              role="button"
              aria-label={TC.layerOnCanvas(name)}
              aria-pressed={picked}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') select(layer.id);
              }}
              onPointerDown={(event) => start(event, layer.id, null)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}>
              {/* 把手按下时指针归把手，移动与松开冒泡到这一层的框上处理。 */}
              {picked
                ? STUDIO_HANDLES.map((h) => (
                    <div
                      key={h}
                      className={`${handleStyle} bc-stage-handle`}
                      style={{ ...handlePlace(h, false), cursor: resizeCursor(h, 0) }}
                      title={TC.resizeHandle(name)}
                      onPointerDown={(event) => start(event, layer.id, h)}
                    />
                  ))
                : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
