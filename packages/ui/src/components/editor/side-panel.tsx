import { useEffect, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from 'react';
import type { AssetRecord, DocumentRecord, Id, Sequence } from '@baocut/protocol';
import { ToggleButton, ToggleButtonGroup, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import Apps from '@react-spectrum/s2/icons/Apps';
import Brand from '@react-spectrum/s2/icons/Brand';
import CloseCaptions from '@react-spectrum/s2/icons/CloseCaptions';
import Image from '@react-spectrum/s2/icons/Image';
import MagicWand from '@react-spectrum/s2/icons/MagicWand';
import MusicNote from '@react-spectrum/s2/icons/MusicNote';
import Properties from '@react-spectrum/s2/icons/Properties';
import TextIcon from '@react-spectrum/s2/icons/Text';
import TranscriptIcon from '@react-spectrum/s2/icons/Transcript';
import Video from '@react-spectrum/s2/icons/Video';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useRuntime } from '../../runtime/context.tsx';
import { hostPanelTab, PANEL_WIDTH_DEFAULT, useEditor, type PanelTab } from '../../state/editor-store.ts';
import { AiToolsPanel } from './ai-tools-panel.tsx';
import { BrandPanel } from './brand-panel.tsx';
import { ElementsPanel } from './elements-panel.tsx';
import { Inspector } from './inspector.tsx';
import { MediaPanel } from './media-panel.tsx';
import { SubtitlePanel } from './subtitle-panel.tsx';
import { TextPanel } from './text-panel.tsx';
import { TranscriptPanel } from './transcript-panel.tsx';
import { ELEMENTS_COPY as EL } from './elements-copy.ts';

/** 工具栏上的页，次序与原型一致。AI 工具（`aitools`）是第三个，网页宿主不显示（产品设计 §5.10）。 */
const TABS: { key: PanelTab; label: string; Icon: ComponentType }[] = [
  {
    key: 'transcript',
    get label() {
      return EL.tabTranscript;
    },
    Icon: TranscriptIcon,
  },
  {
    key: 'subtitle',
    get label() {
      return EL.tabSubtitle;
    },
    Icon: CloseCaptions,
  },
  {
    key: 'aitools',
    get label() {
      return EL.tabAiTools;
    },
    Icon: MagicWand,
  },
  {
    key: 'elements',
    get label() {
      return EL.elements;
    },
    Icon: Apps,
  },
  {
    key: 'text',
    get label() {
      return EL.text;
    },
    Icon: TextIcon,
  },
  {
    key: 'image',
    get label() {
      return EL.tabImage;
    },
    Icon: Image,
  },
  {
    key: 'video',
    get label() {
      return EL.tabVideo;
    },
    Icon: Video,
  },
  {
    key: 'audio',
    get label() {
      return EL.tabAudio;
    },
    Icon: MusicNote,
  },
  {
    key: 'brand',
    get label() {
      return EL.tabBrand;
    },
    Icon: Brand,
  },
  {
    key: 'props',
    get label() {
      return EL.tabProps;
    },
    Icon: Properties,
  },
];

/** 编辑列与面板之间的缝：自己不画线（线是面板的左边框），悬停或拖动时浮出一条蓝色把手。 */
const seam = style({ position: 'relative', flexShrink: 0, width: '[7px]', cursor: 'col-resize' });
const seamBar = style({
  position: 'absolute',
  top: 2,
  bottom: 2,
  insetStart: 2,
  width: '[3px]',
  borderRadius: 'full',
  backgroundColor: { default: 'transparent', isActive: 'blue-800' },
  transition: 'default',
});
/** 放不下时面板先变窄（收缩权重远大于预览那一列），到 300 为止，给预览留 320（见 video-editor 的 `column`）。 */
const panel = style({
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 1000,
  boxSizing: 'border-box',
  minWidth: '[300px]',
  minHeight: 0,
  backgroundColor: 'gray-25',
  borderStartWidth: 1,
  borderTopWidth: 0,
  borderBottomWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
/** 最右边的工具道（原型 .rail）：宽 68，内边距 12/8。道本身不画底色与边线，工具栏不会盖住预览、面板与时间线。 */
const rail = style({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'start',
  flexShrink: 0,
  boxSizing: 'border-box',
  width: '[68px]',
  minHeight: 0,
  paddingY: 12,
  paddingX: 8,
});
/** 浮动工具栏（原型 .editor-tools）：只有图标，悬停用 tooltip 说名字；只有这一小块有投影。 */
const tools = style({
  flexShrink: 0,
  maxHeight: 'full',
  boxSizing: 'border-box',
  padding: 8,
  borderRadius: '[10px]',
  backgroundColor: 'gray-25',
  boxShadow: 'emphasized',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
});

/**
 * 编辑器右侧（原型 §13）：缝、面板、浮动工具栏。点工具栏换页，再点当前页收起面板；
 * 选中片段时翻到属性页（面板收着时不自己展开）。
 */
export function SidePanel({
  sequence,
  assets,
  documents,
}: {
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  documents: Record<Id, DocumentRecord>;
}) {
  const web = useRuntime().host.platform === 'web';
  // 网页宿主没有工具页：记着的若是它，落回文稿（不改记着的值）。
  const stored = useEditor((s) => s.panelTab);
  const tab = hostPanelTab(stored, web);
  const width = useEditor((s) => s.panelWidth);
  const hidden = useEditor((s) => s.panelHidden);
  const showPanel = useEditor((s) => s.showPanel);
  const hasSelection = useEditor((s) => s.selection.length > 0);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (hasSelection) useEditor.setState({ panelTab: 'props' });
  }, [hasSelection]);

  return (
    <>
      {hidden ? null : (
        <>
          <PanelSeam panel={panelRef} />
          <section ref={panelRef} className={panel} style={{ width }} aria-label={EL.currentTool}>
            {tab === 'props' ? (
              <Inspector sequence={sequence} assets={assets} documents={documents} />
            ) : tab === 'transcript' ? (
              <TranscriptPanel sequence={sequence} assets={assets} documents={documents} />
            ) : tab === 'subtitle' ? (
              <SubtitlePanel sequence={sequence} assets={assets} documents={documents} />
            ) : tab === 'elements' ? (
              <ElementsPanel sequence={sequence} />
            ) : tab === 'text' ? (
              <TextPanel sequence={sequence} />
            ) : tab === 'brand' ? (
              <BrandPanel sequence={sequence} assets={assets} documents={documents} />
            ) : tab === 'aitools' ? (
              <AiToolsPanel sequence={sequence} documents={documents} />
            ) : (
              <MediaPanel kind={tab} sequence={sequence} assets={assets} />
            )}
          </section>
        </>
      )}
      <div className={rail}>
        <div className={`${tools} bc-scroll`}>
          <ToggleButtonGroup
            aria-label={EL.videoTools}
            orientation="vertical"
            selectionMode="single"
            isQuiet
            size="M"
            selectedKeys={hidden ? [] : [tab]}
            onSelectionChange={(keys) => showPanel(([...keys][0] as PanelTab | undefined) ?? null)}>
            {TABS.filter(({ key }) => hostPanelTab(key, web) === key).map(({ key, label, Icon }) => (
              <TooltipTrigger key={key} placement="start" delay={300}>
                <ToggleButton id={key} aria-label={label}>
                  <Icon />
                </ToggleButton>
                <Tooltip>{label}</Tooltip>
              </TooltipTrigger>
            ))}
          </ToggleButtonGroup>
        </div>
      </div>
    </>
  );
}

/** 拖动改面板宽度；拖窄到收起线以下就收起，双击回到默认宽。 */
function PanelSeam({ panel: panelRef }: { panel: { current: HTMLElement | null } }) {
  const dragPanel = useEditor((s) => s.dragPanel);
  const width = useEditor((s) => s.panelWidth);
  const start = useRef<{ x: number; width: number } | null>(null);
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const resize = (clientX: number) => {
    if (start.current) dragPanel(start.current.width - (clientX - start.current.x));
  };
  const stop = () => {
    start.current = null;
    setDragging(false);
  };
  return (
    <div
      className={seam}
      role="separator"
      aria-orientation="vertical"
      aria-label={EL.resizePanel}
      aria-valuenow={width}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        // 从面板的实际宽度起算：窗口窄时面板可能比记住的宽度窄。
        start.current = { x: event.clientX, width: panelRef.current?.offsetWidth ?? width };
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (start.current && event.buttons === 0) stop();
        else resize(event.clientX);
      }}
      onPointerUp={(event) => {
        // 松开的位置也要算上：快速拖动时浏览器会合并 pointermove。
        resize(event.clientX);
        stop();
      }}
      onLostPointerCapture={stop}
      onDoubleClick={() => dragPanel(PANEL_WIDTH_DEFAULT)}>
      <span className={seamBar({ isActive: hover || dragging })} />
    </div>
  );
}
