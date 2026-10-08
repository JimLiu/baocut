import { useState, type ComponentType } from 'react';
import type { ArrangeDirection, Id } from '@baocut/protocol';
import {
  ActionButton,
  Content,
  ContextualHelpPopover,
  DialogTrigger,
  Heading,
  Keyboard,
  Menu,
  MenuItem,
  MenuSection,
  Popover,
  Text,
  ToggleButton,
  Tooltip,
  TooltipTrigger,
  UnavailableMenuItemTrigger,
} from '@react-spectrum/s2';
import Animation from '@react-spectrum/s2/icons/Animation';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import Brand from '@react-spectrum/s2/icons/Brand';
import BrightnessContrast from '@react-spectrum/s2/icons/BrightnessContrast';
import Brush from '@react-spectrum/s2/icons/Brush';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import ChevronUp from '@react-spectrum/s2/icons/ChevronUp';
import Clock from '@react-spectrum/s2/icons/Clock';
import CornerRadius from '@react-spectrum/s2/icons/CornerRadius';
import Crop from '@react-spectrum/s2/icons/Crop';
import Delete from '@react-spectrum/s2/icons/Delete';
import Duplicate from '@react-spectrum/s2/icons/Duplicate';
import Effects from '@react-spectrum/s2/icons/Effects';
import Filters from '@react-spectrum/s2/icons/Filters';
import FlipHorizontal from '@react-spectrum/s2/icons/FlipHorizontal';
import FlipVertical from '@react-spectrum/s2/icons/FlipVertical';
import FullScreen from '@react-spectrum/s2/icons/FullScreen';
import LineHeight from '@react-spectrum/s2/icons/LineHeight';
import More from '@react-spectrum/s2/icons/More';
import Order from '@react-spectrum/s2/icons/Order';
import Properties from '@react-spectrum/s2/icons/Properties';
import Replace from '@react-spectrum/s2/icons/Replace';
import SortDown from '@react-spectrum/s2/icons/SortDown';
import SortUp from '@react-spectrum/s2/icons/SortUp';
import SpeedFast from '@react-spectrum/s2/icons/SpeedFast';
import StrokeWidth from '@react-spectrum/s2/icons/StrokeWidth';
import TextAlignCenter from '@react-spectrum/s2/icons/TextAlignCenter';
import TextAlignLeft from '@react-spectrum/s2/icons/TextAlignLeft';
import TextAlignRight from '@react-spectrum/s2/icons/TextAlignRight';
import TextBold from '@react-spectrum/s2/icons/TextBold';
import TextItalic from '@react-spectrum/s2/icons/TextItalic';
import TextVariableFontSettings from '@react-spectrum/s2/icons/TextVariableFontSettings';
import ViewTransparency from '@react-spectrum/s2/icons/ViewTransparency';
import VolumeTwo from '@react-spectrum/s2/icons/VolumeTwo';
import ZoomFitToScreen from '@react-spectrum/s2/icons/ZoomFitToScreen';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { STAGE_TOOLBAR_COPY as COPY } from '../../copy.ts';
import { canArrange } from '../../model/editor-ops.ts';
import { fitCanvas } from '../../model/geometry-panel.ts';
import { patchTextStyle } from '../../model/property-values.ts';
import { placeFields, poseOf, type PlacedItem } from '../../model/stage-pose.ts';
import { ARRANGE_COPY, ARRANGE_ROWS, type InspectorSection, type MenuGroup, type Tool, type ToolId } from '../../model/stage-toolbar.ts';
import { asObject, num } from '../../render/text-style.ts';
import { useEditor } from '../../state/editor-store.ts';
import type { EditorActions } from './editor-context.tsx';
import { ValueRow } from './inspector-controls.tsx';
import { OpacityRow, TimeSection, type ItemPageProps } from './inspector-sections.tsx';
import { MOD_KEY, arrangeItem, deleteItems, duplicateItems } from './timeline-commands.ts';
import { EDITOR_COPY as E } from './editor-copy.ts';
import { ELEMENTS_COPY as EL } from './elements-copy.ts';
import { INSPECTOR_COPY as IC } from './inspector-copy.ts';

/**
 * 工具条的溢出菜单（原型 stage-toolbar-menu.jsx）与工具条、菜单共用的动作：
 * 第一段是图标钮一行（翻转 · 适应画布，或 B / I · 三对齐），其余是菜单项；滑杆与时间这几项在同一个弹层里下钻一层
 * （原型是向右展开的子菜单，这里收在弹层里，免得盖住画面）。不能用的项灰着，点开说明原因。
 */

export type ToolProps = ItemPageProps<PlacedItem>;

const pop = style({ display: 'flex', flexDirection: 'column', width: 232 });
const row = style({ display: 'flex', alignItems: 'center', gap: 12, paddingX: 4, paddingY: '[2px]' });
const cluster = style({ display: 'flex', alignItems: 'center', gap: '[2px]' });
const rule = style({ height: '[1px]', backgroundColor: 'gray-100', marginY: 4, marginX: '[2px]' });
const subHead = style({ display: 'flex', alignItems: 'center', gap: 4, font: 'ui', fontWeight: 'bold', color: 'gray-900', paddingBottom: 4 });
const subBody = style({ display: 'flex', flexDirection: 'column', gap: 8, paddingX: 4, paddingBottom: 4 });

/** 每一格的图标（原型 `Ic`）；菜单项与条子上的图标钮共用。 */
export const TOOL_ICON: Partial<Record<ToolId, ComponentType>> = {
  'text-styles': Brush,
  animation: Animation,
  volume: VolumeTwo,
  speed: SpeedFast,
  adjust: BrightnessContrast,
  border: StrokeWidth,
  properties: Properties,
  copy: Duplicate,
  arrange: Order,
  'save-to-brand-kit': Brand,
  'adjust-timing': Clock,
  delete: Delete,
  bold: TextBold,
  italic: TextItalic,
  'align-left': TextAlignLeft,
  'align-center': TextAlignCenter,
  'align-right': TextAlignRight,
  'line-height': LineHeight,
  'letter-spacing': TextVariableFontSettings,
  'flip-vertical': FlipVertical,
  'flip-horizontal': FlipHorizontal,
  'fit-canvas': ZoomFitToScreen,
  'fill-canvas': FullScreen,
  opacity: ViewTransparency,
  'round-corners': CornerRadius,
  filters: Filters,
  effects: Effects,
  'crop-video': Crop,
  'replace-video': Replace,
  'replace-image': Replace,
  'detach-audio': AudioWave,
};

/** 属性页所在的那一栏（side-panel 的 aria-label，跟着界面语言）。 */
const panelSelector = () => `[aria-label="${EL.currentTool}"]`;

/** 属性页里节头的标题（跟着界面语言）；`jump()` 传的是稳定的节 key。 */
const SECTION_TITLES: Record<InspectorSection, () => string> = {
  style: () => IC.style,
  transition: () => IC.transition,
  effects: () => IC.effects,
};

/** 节头：标题是节头里的第一个 span（inspector-controls 的 SecHead）。 */
function sectionHead(panel: Element, section: InspectorSection): HTMLElement | null {
  const title = SECTION_TITLES[section]();
  for (const span of panel.querySelectorAll('span')) {
    if (span.textContent === title && span.parentElement?.firstElementChild === span) return span.parentElement;
  }
  return null;
}

/**
 * 打开这一件的属性页并滚到某一节（`null` 是页首）。选区里还带着别的（主视频）时先只选它，属性页才是它的那一页。
 * 页面刚挂上时节头还没出来：逐帧找几次，找不到就停在页首。
 */
export function jumpToSection(itemId: Id, section: InspectorSection | null): void {
  const editor = useEditor.getState();
  if (editor.selection.length !== 1 || editor.selection[0] !== itemId) editor.select([itemId]);
  editor.showPanel('props');
  let tries = 0;
  const seek = () => {
    const panel = document.querySelector(panelSelector());
    const head = panel && section ? sectionHead(panel, section) : null;
    if (head) return head.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (tries++ < 10) return void requestAnimationFrame(seek);
    panel?.querySelector('.bc-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  };
  if (section) requestAnimationFrame(seek);
  else requestAnimationFrame(() => document.querySelector(panelSelector())?.querySelector('.bc-scroll')?.scrollTo({ top: 0, behavior: 'smooth' }));
}

/** 开关类的格现在是不是开着（翻转、粗斜体、对齐）。 */
export function toolIsOn(id: ToolId, item: PlacedItem): boolean {
  const style = item.type === 'text' ? asObject(item.style) : {};
  const align = style.textAlign ?? style.align;
  switch (id) {
    case 'flip-horizontal':
      return !!item.place.flipX;
    case 'flip-vertical':
      return !!item.place.flipY;
    case 'bold':
      return style.bold === true;
    case 'italic':
      return style.italic === true || style.fontStyle === 'italic';
    case 'align-left':
      return align === 'left';
    case 'align-right':
      return align === 'right';
    case 'align-center':
      return align !== 'left' && align !== 'right';
    default:
      return false;
  }
}

/** 一下就生效的格：命令、开关、跳到属性页。改值的写法与属性页同一条（`edit.commit`）。 */
export function runTool(tool: Tool, { item, sequence, assets, edit }: ToolProps, actions: EditorActions): void {
  const target = { sequenceId: sequence.id, itemId: item.id };
  const text = (patch: Record<string, unknown>) =>
    item.type === 'text' && edit.commit([{ type: 'setStyle', ...target, style: patchTextStyle(item.style, patch) }]);
  switch (tool.action.kind) {
    case 'jump':
      return jumpToSection(item.id, tool.action.section);
    case 'command':
      if (tool.id === 'copy') return void duplicateItems(actions, [item.id]);
      if (tool.id === 'delete') return void deleteItems(actions, [item.id]);
      if (tool.id === 'fit-canvas' || tool.id === 'fill-canvas') {
        const pose = poseOf(item, sequence.canvas, assets);
        const fields = placeFields(
          item,
          { ...pose, ...fitCanvas(pose, sequence.canvas, tool.id === 'fill-canvas') },
          sequence.canvas,
          assets,
        );
        if (!Object.keys(fields).length) return;
        return edit.commit([{ type: 'setTransform', ...target, ...fields }], tool.id === 'fill-canvas' ? COPY.labelFill : COPY.labelFit);
      }
      return;
    case 'toggle': {
      const on = toolIsOn(tool.id, item);
      if (tool.id === 'flip-horizontal') return edit.commit([{ type: 'setTransform', ...target, flipX: !on }], COPY.labelFlip);
      if (tool.id === 'flip-vertical') return edit.commit([{ type: 'setTransform', ...target, flipY: !on }], COPY.labelFlip);
      if (tool.id === 'bold') return void text({ bold: !on });
      if (tool.id === 'italic') return void text(on ? { italic: false, fontStyle: 'normal' } : { italic: true });
      if (tool.id === 'align-left') return void text({ textAlign: 'left' });
      if (tool.id === 'align-center') return void text({ textAlign: 'center' });
      if (tool.id === 'align-right') return void text({ textAlign: 'right' });
      return;
    }
    default:
      return;
  }
}

/** 不能用的格的说明弹层（条子上与菜单里共用）。 */
export function OffNote({ tool }: { tool: Tool }) {
  return (
    <ContextualHelpPopover>
      <Heading>
        {tool.label} · {COPY.unavailable}
      </Heading>
      <Content>{tool.action.kind === 'off' ? tool.action.reason : null}</Content>
    </ContextualHelpPopover>
  );
}

/** 菜单第一段那一行图标钮：开关用 ToggleButton，命令用 ActionButton；不能用的灰着、点开说原因。 */
function RowTool({ tool, props, actions }: { tool: Tool; props: ToolProps; actions: EditorActions }) {
  const Icon = TOOL_ICON[tool.id];
  const icon = Icon ? <Icon /> : <Text>{tool.label}</Text>;
  if (tool.action.kind === 'off')
    return (
      <DialogTrigger>
        <ActionButton isQuiet size="S" aria-label={E.withNote(tool.label, COPY.unavailable)}>
          {icon}
        </ActionButton>
        <OffNote tool={tool} />
      </DialogTrigger>
    );
  const button =
    tool.action.kind === 'toggle' ? (
      <ToggleButton isQuiet size="S" aria-label={tool.label} isSelected={toolIsOn(tool.id, props.item)} onChange={() => runTool(tool, props, actions)}>
        {icon}
      </ToggleButton>
    ) : (
      <ActionButton isQuiet size="S" aria-label={tool.label} onPress={() => runTool(tool, props, actions)}>
        {icon}
      </ActionButton>
    );
  return (
    <TooltipTrigger placement="top">
      {button}
      <Tooltip>{tool.label}</Tooltip>
    </TooltipTrigger>
  );
}

const KEYS: Partial<Record<ToolId, string>> = { copy: `${MOD_KEY}D`, delete: '⌫' };

function MenuTool({ tool }: { tool: Tool }) {
  const Icon = TOOL_ICON[tool.id];
  const item = (
    // DialogTrigger 也给菜单提供了「选中即收起」的状态：下钻项要留在弹层里换页，不能跟着收起。
    <MenuItem id={tool.id} textValue={tool.label} shouldCloseOnSelect={tool.action.kind !== 'sub'}>
      {Icon ? <Icon /> : null}
      <Text slot="label">{tool.label}</Text>
      {KEYS[tool.id] ? <Keyboard>{KEYS[tool.id]}</Keyboard> : null}
    </MenuItem>
  );
  if (tool.action.kind !== 'off') return item;
  return (
    <UnavailableMenuItemTrigger isUnavailable>
      {item}
      <OffNote tool={tool} />
    </UnavailableMenuItemTrigger>
  );
}

/** 「层级」四行的图标与快捷键（原型 OrderSub：移到最前 F、前移一层 ⌘↑、后移一层 ⌘↓、移到最后 B）。 */
const ARRANGE_ICON: Record<ArrangeDirection, ComponentType> = { front: SortUp, forward: ChevronUp, backward: ChevronDown, back: SortDown };
const ARRANGE_KEY: Record<ArrangeDirection, string> = { front: 'F', forward: `${MOD_KEY}↑`, backward: `${MOD_KEY}↓`, back: 'B' };

/**
 * 「层级」下钻页：往前的两行、一条线、往后的两行。走不动的方向灰着（独占一条轨道、已经在同类轨道的最上 / 最下）；
 * 点一行就提交一笔并收起弹层。
 */
function ArrangeSub({ props, actions, onDone }: { props: ToolProps; actions: EditorActions; onDone(): void }) {
  const { item, sequence, canChange } = props;
  const disabled = ARRANGE_ROWS.flat().filter((direction) => !canChange || !canArrange(sequence, item.id, direction));
  return (
    <Menu
      aria-label={ARRANGE_COPY.label}
      size="S"
      disabledKeys={disabled}
      onAction={(key) => {
        onDone();
        arrangeItem(actions, item.id, key as ArrangeDirection);
      }}>
      {ARRANGE_ROWS.map((group, i) => (
        <MenuSection key={i}>
          {group.map((direction) => {
            const Icon = ARRANGE_ICON[direction];
            return (
              <MenuItem key={direction} id={direction} textValue={ARRANGE_COPY[direction]}>
                <Icon />
                <Text slot="label">{ARRANGE_COPY[direction]}</Text>
                <Keyboard>{ARRANGE_KEY[direction]}</Keyboard>
              </MenuItem>
            );
          })}
        </MenuSection>
      ))}
    </Menu>
  );
}

/** 下钻一层的编辑：不透明度、行高、字距、调整时间。与属性页同一套控件，拖动中只叠草稿，松手一笔提交。 */
function SubPage({ tool, props, actions, onBack, onDone }: { tool: Tool; props: ToolProps; actions: EditorActions; onBack(): void; onDone(): void }) {
  const { item, sequence, edit, canChange } = props;
  const style = item.type === 'text' ? asObject(item.style) : {};
  const textCommit = (patch: Record<string, unknown>) =>
    item.type === 'text' && edit.commit([{ type: 'setStyle', sequenceId: sequence.id, itemId: item.id, style: patchTextStyle(item.style, patch) }]);
  const textLive = (patch: Record<string, unknown>) => item.type === 'text' && edit.live({ style: patchTextStyle(item.style, patch) });
  return (
    <>
      <div className={subHead}>
        <ActionButton isQuiet size="S" aria-label={COPY.back} onPress={onBack}>
          <ChevronLeft />
        </ActionButton>
        <span>{tool.label}</span>
      </div>
      <div className={subBody}>
        {tool.id === 'opacity' ? <OpacityRow {...props} /> : null}
        {tool.id === 'line-height' ? (
          <ValueRow
            label={IC.lineHeight}
            value={Math.round(num(style.lineHeight, 1.2) * 100)}
            min={90}
            max={200}
            unit="%"
            isDisabled={!canChange}
            onLive={(v) => void textLive({ lineHeight: v / 100 })}
            onCommit={(v) => void textCommit({ lineHeight: v / 100 })}
          />
        ) : null}
        {tool.id === 'letter-spacing' ? (
          <ValueRow
            label={IC.letterSpacing}
            value={num(style.letterSpacing, 0)}
            min={-10}
            max={30}
            step={0.5}
            digits={1}
            isDisabled={!canChange}
            onLive={(letterSpacing) => void textLive({ letterSpacing })}
            onCommit={(letterSpacing) => void textCommit({ letterSpacing })}
          />
        ) : null}
        {tool.id === 'adjust-timing' ? <TimeSection {...props} /> : null}
        {tool.id === 'arrange' ? <ArrangeSub props={props} actions={actions} onDone={onDone} /> : null}
      </div>
    </>
  );
}

/** 溢出菜单：⋯ 钮开一个弹层。命令与跳转点了就收起；下钻项留在弹层里换一页。 */
export function StageToolbarMenu({ groups, props, actions }: { groups: MenuGroup[]; props: ToolProps; actions: EditorActions }) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<Tool | null>(null);
  const tools = new Map(groups.flatMap((g) => (g.kind === 'row' ? g.clusters.flat() : g.tools)).map((t) => [t.id, t]));
  const rows = groups.filter((g): g is Extract<MenuGroup, { kind: 'row' }> => g.kind === 'row');
  const lists = groups.filter((g): g is Extract<MenuGroup, { kind: 'list' }> => g.kind === 'list');
  const onAction = (key: string | number) => {
    const tool = tools.get(String(key) as ToolId);
    if (!tool || tool.action.kind === 'off') return;
    if (tool.action.kind === 'sub') return setSub(tool);
    setOpen(false);
    runTool(tool, props, actions);
  };
  return (
    <DialogTrigger
      isOpen={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSub(null);
      }}>
      <TooltipTrigger placement="top">
        <ActionButton isQuiet size="S" aria-label={COPY.more}>
          <More />
        </ActionButton>
        <Tooltip>{COPY.more}</Tooltip>
      </TooltipTrigger>
      <Popover placement="bottom end" aria-label={COPY.more}>
        <div className={pop}>
          {sub ? (
            <SubPage tool={sub} props={props} actions={actions} onBack={() => setSub(null)} onDone={() => setOpen(false)} />
          ) : (
            <>
              {rows.map((g, i) => (
                <div key={i} className={row}>
                  {g.clusters.map((c, j) => (
                    <span key={j} className={cluster}>
                      {c.map((tool) => (
                        <RowTool key={tool.id} tool={tool} props={props} actions={actions} />
                      ))}
                    </span>
                  ))}
                </div>
              ))}
              {rows.length && lists.length ? <div className={rule} /> : null}
              {lists.length ? (
                <Menu aria-label={COPY.more} size="S" onAction={onAction}>
                  {lists.map((g, i) => (
                    <MenuSection key={i}>
                      {g.tools.map((tool) => (
                        <MenuTool key={tool.id} tool={tool} />
                      ))}
                    </MenuSection>
                  ))}
                </Menu>
              ) : null}
            </>
          )}
        </div>
      </Popover>
    </DialogTrigger>
  );
}
