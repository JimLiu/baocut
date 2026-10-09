import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AssetRecord, Id, Sequence } from '@baocut/protocol';
import { ActionButton, DialogTrigger, Picker, PickerItem, Popover, Text, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import VolumeOff from '@react-spectrum/s2/icons/VolumeOff';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { STAGE_TOOLBAR_COPY as COPY } from '../../copy.ts';
import { colorParts, patchShape, patchTextStyle, withAlpha } from '../../model/property-values.ts';
import { aabbOf, poseOf, type PlacedItem, type Rect } from '../../model/stage-pose.ts';
import { itemAsset, toolbarFor, toolbarPlacement, type Size, type Tool, type ToolbarSpec } from '../../model/stage-toolbar.ts';
import { asObject, num } from '../../render/text-style.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useVideo } from '../../state/video-store.ts';
import { useEditorActions } from './editor-context.tsx';
import { ToolbarFontField } from './font-field.tsx';
import { ColorField, ValueRow } from './inspector-controls.tsx';
import { SoundSection, SpeedSection } from './inspector-sections.tsx';
import type { View } from './stage-boxes.tsx';
import type { FrameRect } from './stage-objects.tsx';
import { OffNote, StageToolbarMenu, TOOL_ICON, itemHost, type ToolHost, type ToolProps } from './stage-toolbar-menu.tsx';
import { useItemEdit } from './use-item-edit.ts';
import { EDITOR_COPY as E } from './editor-copy.ts';

/**
 * 画布浮动工具条（原型 stage-toolbar.jsx、model-toolbar.js）：选中画面上的一件时浮在选中框上方，贴着舞台顶就翻到下方；
 * 拖动、改大小、旋转中整条让位（透明、不接指针），松手回来。每一格做什么由 model/stage-toolbar 的规则给出，
 * 改值与属性页同一条写法：拖动中只叠草稿，松手一笔提交。挂在舞台叠加层里，带 `data-stage-editor`，
 * 舞台的点选与框选不接它上面的指针。
 */

const bar = style({
  position: 'absolute',
  zIndex: 4,
  display: 'flex',
  alignItems: 'center',
  gap: '[1px]',
  padding: '[3px]',
  borderRadius: 'default',
  backgroundColor: 'gray-25',
  boxShadow: 'elevated',
  whiteSpace: 'nowrap',
  overflowX: 'auto',
  userSelect: 'none',
  transition: 'opacity',
  opacity: { default: 1, isYield: 0 },
  pointerEvents: { default: 'auto', isYield: 'none' },
});
const sep = style({ flexShrink: 0, width: '[1px]', height: '[15px]', marginX: '[3px]', backgroundColor: 'gray-200' });
const dim = style({ display: 'flex', opacity: 0.4 });
const panel = style({ display: 'flex', flexDirection: 'column', gap: 8, width: 248 });
export const quiet = style({ paddingX: '[6px]' });

/** 字号下拉的常用档（属性页的滑杆是 8–140）；现值不在其中时也列出来。 */
const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96, 120, 140];
/** 原型里条子上只出图标的几格（`icon: true`）。 */
const ICON_ONLY = new Set(['text-styles', 'animation', 'volume', 'speed']);
/** 图标加字的几格（原型字幕条子的 Edit / Styles / Animation）。 */
const ICON_TEXT = new Set(['sub-edit', 'sub-style', 'sub-animation']);
const NO_ASSETS: Record<Id, AssetRecord> = {};

/** 一格按钮：图标格出图标加悬停提示，其余出字。 */
export function ToolButton({ tool, onPress, label }: { tool: Tool; onPress?: () => void; label?: string }) {
  const Icon = TOOL_ICON[tool.id];
  if (ICON_ONLY.has(tool.id) && Icon)
    return (
      <TooltipTrigger placement="top">
        <ActionButton isQuiet size="S" aria-label={label ?? tool.label} onPress={onPress}>
          <Icon />
        </ActionButton>
        <Tooltip>{label ?? tool.label}</Tooltip>
      </TooltipTrigger>
    );
  return (
    <ActionButton isQuiet size="S" aria-label={label} onPress={onPress}>
      {ICON_TEXT.has(tool.id) && Icon ? <Icon /> : null}
      <Text>{tool.label}</Text>
    </ActionButton>
  );
}

/** 字号下拉：常用档，现值不在其中时也列出来（文字元素与字幕共用）。 */
export function SizePicker({ label, size, isDisabled, onChange }: { label: string; size: number; isDisabled: boolean; onChange(size: number): void }) {
  const sizes = SIZES.includes(size) ? SIZES : [...SIZES, size].sort((a, b) => a - b);
  return (
    <span className={quiet}>
      <Picker
        aria-label={label}
        size="S"
        isQuiet
        isDisabled={isDisabled}
        value={String(size)}
        onChange={(key) => key !== null && Number(key) !== size && onChange(Number(key))}>
        {sizes.map((n) => (
          <PickerItem key={n} id={String(n)}>
            {String(n)}
          </PickerItem>
        ))}
      </Picker>
    </span>
  );
}

/** 条子上开弹层改值的格：颜色、字体、字号、描边、音量、变速。 */
function PopTool({ tool, props }: { tool: Tool; props: ToolProps }) {
  const { item, sequence, edit, canChange } = props;
  const target = { sequenceId: sequence.id, itemId: item.id };
  if (item.type === 'text') {
    const style = asObject(item.style);
    const live = (patch: Record<string, unknown>) => edit.live({ style: patchTextStyle(item.style, patch) });
    const commit = (patch: Record<string, unknown>) => edit.commit([{ type: 'setStyle', ...target, style: patchTextStyle(item.style, patch) }]);
    if (tool.id === 'color')
      return (
        <ColorField
          label={COPY.textColor}
          value={style.fontColor}
          fallback="#FFFFFF"
          isDisabled={!canChange}
          onLive={(fontColor) => live({ fontColor })}
          onCommit={(fontColor) => commit({ fontColor })}
        />
      );
    if (tool.id === 'font') {
      return (
        <span className={quiet}>
          <ToolbarFontField
            label={tool.label}
            value={style.fontFamily}
            isDisabled={!canChange}
            onChange={(fontFamily) => commit({ fontFamily })}
          />
        </span>
      );
    }
    if (tool.id === 'size')
      return <SizePicker label={tool.label} size={num(style.fontSize, 30)} isDisabled={!canChange} onChange={(fontSize) => commit({ fontSize })} />;
  }
  if (item.type === 'shape') {
    const shape = asObject(item.shape);
    const live = (patch: Record<string, unknown>) => edit.live({ shape: patchShape(item.shape, patch) });
    const commit = (patch: Record<string, unknown>) => edit.commit([{ type: 'setStyle', ...target, shape: patchShape(item.shape, patch) }]);
    const fill = colorParts(shape.fill, '#00000000');
    const stroke = colorParts(shape.stroke, '#00000000');
    if (tool.id === 'color')
      return (
        <ColorField
          label={COPY.fillColor}
          value={shape.fill}
          fallback="#3B63FB"
          allowAlpha={false}
          isDisabled={!canChange}
          onLive={(hex) => live({ fill: withAlpha(hex, fill.alpha || 1, '#3B63FB') })}
          onCommit={(hex) => commit({ fill: withAlpha(hex, fill.alpha || 1, '#3B63FB') })}
        />
      );
    if (tool.id === 'border')
      return (
        <DialogTrigger>
          <ToolButton tool={tool} />
          <Popover placement="bottom" aria-label={tool.label}>
            <div className={panel}>
              <ColorField
                label={COPY.strokeColor}
                value={shape.stroke}
                fallback="#FFFFFF"
                allowAlpha={false}
                isDisabled={!canChange}
                onLive={(hex) => live({ stroke: withAlpha(hex, stroke.alpha || 1, '#FFFFFF') })}
                onCommit={(hex) => commit({ stroke: withAlpha(hex, stroke.alpha || 1, '#FFFFFF') })}
              />
              <ValueRow
                label={COPY.strokeWidth}
                value={num(shape.strokeWidth, 0)}
                min={0}
                max={40}
                isDisabled={!canChange}
                onLive={(strokeWidth) => live({ strokeWidth })}
                onCommit={(strokeWidth) => commit({ strokeWidth })}
              />
            </div>
          </Popover>
        </DialogTrigger>
      );
  }
  if (item.type === 'video' && (tool.id === 'volume' || tool.id === 'speed')) {
    const muted = tool.id === 'volume' && !item.embeddedAudio.enabled;
    return (
      <DialogTrigger>
        {muted ? (
          <TooltipTrigger placement="top">
            <ActionButton isQuiet size="S" aria-label={E.withNote(tool.label, COPY.muted)}>
              <VolumeOff />
            </ActionButton>
            <Tooltip>{E.withNote(tool.label, COPY.muted)}</Tooltip>
          </TooltipTrigger>
        ) : (
          <ToolButton tool={tool} />
        )}
        <Popover placement="bottom" aria-label={tool.label}>
          <div className={panel}>{tool.id === 'volume' ? <SoundSection {...props} item={item} /> : <SpeedSection {...props} item={item} />}</div>
        </Popover>
      </DialogTrigger>
    );
  }
  return null;
}

/** 条子上的一格：`render` 给了的（开弹层改值的格等）照它画，其余按动作画成按钮。 */
function BarTool({ tool, host, render }: { tool: Tool; host: ToolHost; render(tool: Tool): ReactNode | undefined }) {
  const own = render(tool);
  if (own !== undefined) return <>{own}</>;
  switch (tool.action.kind) {
    case 'pop':
      return null;
    case 'off':
      return (
        <span className={dim}>
          <DialogTrigger>
            <ToolButton tool={tool} label={E.withNote(tool.label, COPY.unavailable)} />
            <OffNote tool={tool} />
          </DialogTrigger>
        </span>
      );
    default:
      return <ToolButton tool={tool} onPress={() => host.run(tool)} />;
  }
}

/** 条子的内容：分组之间画竖分隔线，最后是 ⋯ 溢出菜单。 */
export function ToolbarBody({ spec, host, render }: { spec: ToolbarSpec; host: ToolHost; render(tool: Tool): ReactNode | undefined }) {
  return (
    <>
      {spec.visible.map((group, i) => (
        <Fragment key={i}>
          {i ? <span className={sep} /> : null}
          {group.map((tool) => (
            <BarTool key={tool.id} tool={tool} host={host} render={render} />
          ))}
        </Fragment>
      ))}
      {spec.more ? (
        <>
          <span className={sep} />
          <StageToolbarMenu groups={spec.more} host={host} />
        </>
      ) : null}
    </>
  );
}

/**
 * 浮在选中框旁边的那根条子（画面元素与字幕共用）：量自己与舞台，按 `box`（舞台像素的外包盒）落位；
 * `knob` 是选框上方有旋转钮，条子抬高跨过它。拖动中让位（透明、不接指针）。
 */
export function FloatingBar({ box, knob, yielding, label, children }: { box: Rect; knob: boolean; yielding: boolean; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ bar: Size; area: Size } | null>(null);

  // 量条子与舞台：条子换了内容、舞台改了尺寸都重量一次。
  useLayoutEffect(() => {
    const node = ref.current;
    const area = node?.parentElement;
    if (!node || !area) return;
    const measure = () => {
      const next = { bar: { w: node.scrollWidth, h: node.offsetHeight }, area: { w: area.clientWidth, h: area.clientHeight } };
      setSize((old) => (old && old.bar.w === next.bar.w && old.bar.h === next.bar.h && old.area.w === next.area.w && old.area.h === next.area.h ? old : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  const place = size ? toolbarPlacement(box, size.area, size.bar, knob) : null;
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      data-stage-editor
      className={bar({ isYield: yielding })}
      style={place ? { left: place.left, top: place.top, maxWidth: place.maxWidth } : { left: 0, top: 0, visibility: 'hidden' }}>
      {children}
    </div>
  );
}

/** 舞台叠加层里的工具条。`frame` 是画面在舞台里的位置，`view` 是画布像素到显示像素的比例。 */
export function StageToolbar({
  item,
  sequence,
  frame,
  view,
  yielding,
}: {
  item: PlacedItem;
  sequence: Sequence;
  frame: FrameRect;
  view: View;
  yielding: boolean;
}) {
  const runtime = useRuntime();
  const actions = useEditorActions();
  const edit = useItemEdit(sequence, item);
  const assets = useVideo((s) => s.video?.state?.video.assets) ?? NO_ASSETS;
  const asset = itemAsset(item, assets);
  const web = runtime.host.platform === 'web';
  const spec = useMemo(() => toolbarFor(item, { asset, web }), [item, asset, web]);

  const aabb = aabbOf(poseOf(item, sequence.canvas, assets));
  const box = { x: frame.left + aabb.x * view.kx, y: frame.top + aabb.y * view.ky, w: aabb.w * view.kx, h: aabb.h * view.ky };
  const props: ToolProps = { item, sequence, assets, edit, canChange: true };

  // 选中框上方有旋转钮（能改的才出工具条，能改的一定有旋转钮）：条子抬高跨过它。
  return (
    <FloatingBar box={box} knob yielding={yielding} label={COPY.label}>
      <ToolbarBody
        spec={spec}
        host={itemHost(props, actions, runtime)}
        render={(tool) => (tool.action.kind === 'pop' ? <PopTool tool={tool} props={props} /> : undefined)}
      />
    </FloatingBar>
  );
}
