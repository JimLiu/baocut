import { useCallback, useEffect, useRef, useState } from 'react';
import { DialogTrigger, Popover } from '@react-spectrum/s2';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { ELEMENT_TILES, PROGRESS_KINDS, WAVE_KINDS, type ElementTile, type StyleKind } from '../../model/element-catalog.ts';
import { PROGRESS_STYLES } from '../../render/progress.ts';
import { num, type Json } from '../../render/text-style.ts';
import { WAVE_STYLES, waveStyleKey } from '../../render/visualizer.ts';
import { useEditor } from '../../state/editor-store.ts';
import { ElementThumb } from './element-thumb.tsx';
import { ColorField, Note, PRow, Sec, SecHead, ValueRow } from './inspector-controls.tsx';
import { INSPECTOR_COPY as IC } from './inspector-copy.ts';

/**
 * 进度条与声波的参数（设计稿 panel-element-style.jsx 的颜色段与样式段、panel-element-edit.jsx 的样式目录）：
 * 颜色行的个数与名字跟着样式走（两款彩虹边框一行也没有）；「样式」一行点开是与元素页同一份缩略图的目录，
 * 悬停先叠给预览、点下才提交，换款时主副色（声波还有 dB 窗）一并换成那一款的默认值。
 */

export interface VisualParamProps {
  values: Json;
  isDisabled: boolean;
  /** 画幅：目录缩略图按它摆（方形款的边长是画幅短边的 30%）。 */
  canvas: { width: number; height: number };
  live(patch: Json): void;
  commit(patch: Json): void;
}

type Catalog = 'progress' | 'wave';

const drill = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: 'full',
  boxSizing: 'border-box',
  padding: 8,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', isHovered: 'gray-400' },
  backgroundColor: 'gray-25',
  textAlign: 'start',
  cursor: { default: 'pointer', isDisabled: 'default' },
  opacity: { default: 1, isDisabled: 0.5 },
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  transition: 'default',
});
const drillThumb = style({
  display: 'block',
  flexShrink: 0,
  boxSizing: 'border-box',
  width: 56,
  height: 40,
  padding: 4,
  borderRadius: 'default',
  backgroundColor: 'gray-100',
});
const drillText = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 });
const drillName = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-900' });
const drillNote = style({ font: 'ui-xs', color: 'gray-600' });
const drillChevron = style({ display: 'flex', color: 'gray-500', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const catalogBox = style({ display: 'flex', flexDirection: 'column', gap: 12, width: '[288px]' });
/** 与元素页同一套格子：进度三列、条形两款横跨两列；声波两列 2:1 宽格。 */
const progressGrid = style({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gridAutoFlow: 'row dense', gap: 8 });
const waveGrid = style({ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 });
const span2 = style({ gridColumnEnd: 'span 2' });
const tile = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  cursor: 'pointer',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  borderRadius: 'lg',
  transform: { default: 'none', isPressed: 'scale(0.96)' },
  transition: 'default',
});
const face = style({
  display: 'block',
  boxSizing: 'border-box',
  width: 'full',
  flexGrow: { default: 0, shape: { stretch: 1 } },
  aspectRatio: { default: 'square', shape: { wave: '[2 / 1]', stretch: 'auto' } },
  minHeight: { default: 0, shape: { stretch: 48 } },
  padding: '[6px]',
  borderRadius: 'lg',
  borderWidth: 2,
  borderStyle: 'solid',
  borderColor: { default: 'transparent', isSelected: 'blue-800' },
  backgroundColor: { default: 'gray-100', isHovered: 'gray-200' },
  transition: 'default',
});
const tileLabel = style({
  font: 'ui-xs',
  color: { default: 'gray-700', isSelected: 'gray-900' },
  fontWeight: { default: 'normal', isSelected: 'bold' },
  textAlign: 'center',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const tileOf = (catalog: Catalog, key: string): ElementTile | undefined => ELEMENT_TILES.find((t) => t.key === `${catalog}.${key}`);
const kindOf = (kinds: readonly StyleKind[], key: string): StyleKind => kinds.find((k) => k.key === key) ?? kinds[0]!;

/** 换到某一款时一并写下的参数：主副色跟着款走；声波的 dB 窗也跟着款走（示波器与环形波是 −120 / −10 那扇窄窗）。 */
function stylePatch(catalog: Catalog, key: string): Json {
  if (catalog === 'wave') {
    const preset = WAVE_STYLES[key]!;
    return { style: key, mainColor: preset.mainColor, secondaryColor: preset.secondaryColor, minDb: preset.minDb, maxDb: preset.maxDb };
  }
  const preset = PROGRESS_STYLES[key]!;
  return { style: key, mainColor: preset.mainColor, secondaryColor: preset.secondaryColor };
}

/** 进度条：颜色、样式、区间（起点、终点 0–100%，终点可以小于起点：倒着走）。 */
export function ProgressParams(props: VisualParamProps) {
  const { values, isDisabled, live, commit } = props;
  const key = typeof values.style === 'string' && PROGRESS_STYLES[values.style] ? values.style : 'normal';
  const preset = PROGRESS_STYLES[key]!;
  return (
    <>
      <ColorRows kind={kindOf(PROGRESS_KINDS, key)} main={preset.mainColor} secondary={preset.secondaryColor} {...props} />
      <StylePicker catalog="progress" current={key} {...props} />
      <SecHead aside={IC.rangeAside}>{IC.progressRange}</SecHead>
      <Sec>
        <ValueRow
          label={IC.rangeStart}
          value={Math.round(num(values.startProgress, 0) * 100)}
          min={0}
          max={100}
          step={5}
          unit="%"
          isDisabled={isDisabled}
          onLive={(v) => live({ startProgress: v / 100 })}
          onCommit={(v) => commit({ startProgress: v / 100 })}
        />
        <ValueRow
          label={IC.rangeEnd}
          value={Math.round(num(values.endProgress, 1) * 100)}
          min={0}
          max={100}
          step={5}
          unit="%"
          isDisabled={isDisabled}
          onLive={(v) => live({ endProgress: v / 100 })}
          onCommit={(v) => commit({ endProgress: v / 100 })}
        />
      </Sec>
    </>
  );
}

/**
 * 声波：颜色、样式、控制（dB 窗最低 −120–0、最高 −40–60，平滑 0–99%；示波器与环形波画的是波形，没有 dB 两行）。
 * 声波听的是这一刻在响的声音。平滑到 100% 时频谱就停在第一帧，所以封顶 99%。
 */
export function VisualizerParams(props: VisualParamProps) {
  const { values, isDisabled, live, commit } = props;
  const key = waveStyleKey(typeof values.style === 'string' ? values.style : 'bars') ?? 'bars';
  const preset = WAVE_STYLES[key]!;
  const minDb = num(values.minDb, preset.minDb);
  const maxDb = num(values.maxDb, preset.maxDb);
  return (
    <>
      <ColorRows kind={kindOf(WAVE_KINDS, key)} main={preset.mainColor} secondary={preset.secondaryColor} {...props} />
      <StylePicker catalog="wave" current={key} {...props} />
      <SecHead>{IC.controls}</SecHead>
      <Sec>
        {preset.hasControl ? (
          <>
            <ValueRow
              label={IC.minimum}
              value={minDb}
              min={-120}
              max={0}
              unit="dB"
              isDisabled={isDisabled}
              onLive={(v) => live({ minDb: Math.min(v, maxDb - 1) })}
              onCommit={(v) => commit({ minDb: Math.min(v, maxDb - 1) })}
            />
            <ValueRow
              label={IC.maximum}
              value={maxDb}
              min={-40}
              max={60}
              unit="dB"
              isDisabled={isDisabled}
              onLive={(v) => live({ maxDb: Math.max(v, minDb + 1) })}
              onCommit={(v) => commit({ maxDb: Math.max(v, minDb + 1) })}
            />
          </>
        ) : null}
        <ValueRow
          label={IC.smoothing}
          value={Math.round(num(values.smoothing, 0.8) * 100)}
          min={0}
          max={99}
          unit="%"
          isDisabled={isDisabled}
          onLive={(v) => live({ smoothing: v / 100 })}
          onCommit={(v) => commit({ smoothing: v / 100 })}
        />
      </Sec>
    </>
  );
}

/** 颜色段：一色一行（`mainColor`，第二色是 `secondaryColor`）；这一款没有颜色控件时说明为什么。 */
function ColorRows({ kind, main, secondary, values, isDisabled, live, commit }: VisualParamProps & { kind: StyleKind; main: string; secondary: string }) {
  if (!kind.colors.length) {
    return (
      <>
        <SecHead first>{IC.color}</SecHead>
        <Note>{IC.noColorControls(kind.label)}</Note>
      </>
    );
  }
  const fields = [
    { field: 'mainColor', fallback: main },
    { field: 'secondaryColor', fallback: secondary },
  ];
  return (
    <>
      <SecHead first>{IC.color}</SecHead>
      <Sec>
        {kind.colors.map((label, index) => {
          const { field, fallback } = fields[index]!;
          return (
            <PRow key={field} label={label}>
              <ColorField
                label={label}
                value={values[field]}
                fallback={fallback}
                isDisabled={isDisabled}
                onLive={(color) => live({ [field]: color })}
                onCommit={(color) => commit({ [field]: color })}
              />
            </PRow>
          );
        })}
      </Sec>
    </>
  );
}

/** 样式段：当前那一款的缩略图、名字与「N 种 · 点开选」，点开是目录。 */
function StylePicker({ catalog, current, isDisabled, canvas, live, commit }: VisualParamProps & { catalog: Catalog; current: string }) {
  const [open, setOpen] = useState(false);
  const kinds = catalog === 'wave' ? WAVE_KINDS : PROGRESS_KINDS;
  const kind = kindOf(kinds, current);
  const thumb = tileOf(catalog, kind.key);
  return (
    <>
      <SecHead>{IC.style}</SecHead>
      <DialogTrigger isOpen={open} onOpenChange={setOpen}>
        <RACButton className={drill} isDisabled={isDisabled} aria-label={IC.styleTile(kind.label, kinds.length)}>
          <span className={drillThumb}>{thumb ? <ElementThumb tile={thumb} canvas={canvas} /> : null}</span>
          <span className={drillText}>
            <span className={drillName}>{kind.label}</span>
            <span className={drillNote}>{IC.styleCount(kinds.length)}</span>
          </span>
          <span className={drillChevron}>
            <ChevronRight />
          </span>
        </RACButton>
        <Popover placement="bottom" padding="default" aria-label={catalog === 'wave' ? IC.waveStyles : IC.progressStyles}>
          <StyleCatalog
            catalog={catalog}
            kinds={kinds}
            current={current}
            canvas={canvas}
            onPeek={(key) => live(stylePatch(catalog, key))}
            onPick={(key) => commit(stylePatch(catalog, key))}
            onClose={() => setOpen(false)}
          />
        </Popover>
      </DialogTrigger>
    </>
  );
}

/**
 * 目录里的悬停预览：`peek` 记下叠过草稿，`unpeek` 撤掉（清编辑器的草稿），目录卸载（点外面、Esc、选中换了）时也撤；
 * `keep` 用在点下提交时——草稿留着等新版本到来（失败时编辑器自己丢草稿），免得画面先闪回旧款。
 */
export function usePeekDraft(): { peek(): void; keep(): void; unpeek(): void } {
  const peeked = useRef(false);
  const unpeek = useCallback(() => {
    if (!peeked.current) return;
    peeked.current = false;
    useEditor.getState().clearDrafts();
  }, []);
  useEffect(() => unpeek, [unpeek]);
  return {
    peek: () => {
      peeked.current = true;
    },
    keep: () => {
      peeked.current = false;
    },
    unpeek,
  };
}

/**
 * 样式目录：悬停的那一格先叠给预览（草稿），移出目录或关掉目录就撤掉；点下提交。选中框停在打开目录时的那一款上，
 * 不跟着悬停走（属性页看到的值叠了草稿，悬停时会变成悬停的那一款）。
 */
function StyleCatalog({
  catalog,
  kinds,
  current,
  canvas,
  onPeek,
  onPick,
  onClose,
}: {
  catalog: Catalog;
  kinds: readonly StyleKind[];
  current: string;
  canvas: { width: number; height: number };
  onPeek(key: string): void;
  /** 选了另一款（点回打开时那一款不算）。 */
  onPick(key: string): void;
  onClose(): void;
}) {
  const [opened] = useState(current);
  const { peek, keep, unpeek } = usePeekDraft();
  const wave = catalog === 'wave';
  return (
    <div className={catalogBox}>
      <div className={wave ? waveGrid : progressGrid} onPointerLeave={unpeek}>
        {kinds.map((kind) => {
          const item = tileOf(catalog, kind.key);
          if (!item) return null;
          const isSelected = kind.key === opened;
          const wide = !!item.wide;
          return (
            <RACButton
              key={kind.key}
              className={(state) => `${tile(state)}${wide ? ` ${span2}` : ''}`}
              aria-label={isSelected ? IC.current(kind.label) : kind.label}
              onHoverStart={() => {
                peek();
                onPeek(kind.key);
              }}
              onPress={() => {
                if (isSelected) {
                  unpeek();
                } else {
                  keep();
                  onPick(kind.key);
                }
                onClose();
              }}>
              {({ isHovered }) => (
                <>
                  <span className={face({ isHovered, isSelected, shape: wave ? 'wave' : wide ? 'stretch' : 'square' })}>
                    <ElementThumb tile={item} canvas={canvas} />
                  </span>
                  <span className={tileLabel({ isSelected })}>{kind.label}</span>
                </>
              )}
            </RACButton>
          );
        })}
      </div>
      <Note>
        {wave
          ? IC.waveNote
          : IC.progressNote}
      </Note>
    </div>
  );
}
