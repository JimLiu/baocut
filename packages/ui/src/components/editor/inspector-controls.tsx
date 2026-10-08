import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActionButton,
  ColorArea,
  ColorField as HexField,
  ColorSlider,
  ColorSwatch,
  ColorSwatchPicker,
  DialogTrigger,
  NumberField,
  Popover,
  SegmentedControl,
  SegmentedControlItem,
  Slider,
  Switch,
  parseColor,
} from '@react-spectrum/s2';
import Edit from '@react-spectrum/s2/icons/Edit';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { colorParts, colorString } from '../../model/property-values.ts';
import { BrandSwatches } from './brand-swatches.tsx';
import { INSPECTOR_COPY as IC } from './inspector-copy.ts';

/**
 * 属性页的共用件（原型 panel-shared.jsx）：分节头、带标签的行、滑杆加精确输入的数值行、开关卡、取色、分段与删除钮。
 * 拖动中的值走 `onLive`（只叠给预览，不提交），松手、回车、失焦才 `onCommit`。
 */

type Color = ReturnType<typeof parseColor>;

const secHead = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: '[6px]',
  paddingTop: { default: 16, isFirst: 4 },
  paddingBottom: '[6px]',
  paddingX: '[2px]',
  font: 'ui-sm',
  fontWeight: 'bold',
  color: 'gray-900',
});
const secTitle = style({ flexShrink: 0 });
const secAside = style({
  minWidth: 0,
  font: 'ui-xs',
  fontWeight: 'normal',
  color: 'gray-600',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const secAction = style({ flexShrink: 0, marginStart: 'auto', paddingStart: 8 });
const sec = style({ display: 'flex', flexDirection: 'column', gap: 8 });
const prow = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 });
const label = style({ flexShrink: 0, width: '[62px]', font: 'ui-sm', color: 'gray-700' });
/** 数值行（原型 .bc-value-row）：滑杆自带标签与读数，右边一枚精确输入钮；说明另起一行靠右。 */
const valueRow = style({
  display: 'grid',
  gridTemplateColumns: ['minmax(0, 1fr)', 'auto'],
  alignItems: 'end',
  rowGap: 4,
  columnGap: 8,
  paddingY: 8,
});
const valueSlider = style({ width: 'full', minWidth: 0 });
const valueDetail = style({ gridColumnEnd: 'span 2', font: 'ui-xs', color: 'gray-600', textAlign: 'end' });
const valueInput = style({ padding: 16 });
const card = style({
  marginTop: 8,
  borderRadius: '[10px]',
  backgroundColor: 'gray-25',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const cardHead = style({ display: 'flex', alignItems: 'center', gap: 8, paddingX: 12, paddingY: '[10px]' });
const cardTitle = style({ flexGrow: 1, font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const cardBody = style({ display: 'flex', flexDirection: 'column', gap: 8, paddingX: 12, paddingBottom: 12 });
const colorTrigger = style({ display: 'flex', alignItems: 'center', gap: '[6px]' });
const swatchChip = style({ font: 'code-xs', color: 'gray-700' });
const colorPanel = style({ display: 'flex', flexDirection: 'column', gap: 12, width: 192 });
const note = style({ margin: 0, font: 'ui-xs', color: 'gray-600' });
const danger = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '[6px]',
  width: 'full',
  height: 32,
  marginTop: 16,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'red-300', isDisabled: 'gray-200' },
  backgroundColor: { default: 'red-100', isHovered: 'red-200', isDisabled: 'gray-75' },
  font: 'ui-sm',
  color: { default: 'red-1000', isDisabled: 'gray-500' },
  fontWeight: 'bold',
  cursor: { default: 'pointer', isDisabled: 'default' },
});

/** 分节头：左边标题加紧跟的说明，右边一件动作。 */
export function SecHead({
  children,
  aside,
  action,
  first,
}: {
  children: ReactNode;
  aside?: ReactNode;
  action?: ReactNode;
  first?: boolean;
}) {
  return (
    <div className={secHead({ isFirst: !!first })}>
      <span className={secTitle}>{children}</span>
      {aside ? <span className={secAside}>{aside}</span> : null}
      {action ? <span className={secAction}>{action}</span> : null}
    </div>
  );
}

/** 一节的内容：竖排，间距 8。 */
export function Sec({ children }: { children: ReactNode }) {
  return <div className={sec}>{children}</div>;
}

/** 左边 62 宽的标签，右边是控件。 */
export function PRow({ label: text, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <div className={prow}>
      {text ? <span className={label}>{text}</span> : null}
      {children}
    </div>
  );
}

/** 灰色的小字说明（「预览暂不体现」这一类）。 */
export function Note({ children }: { children: ReactNode }) {
  return <p className={note}>{children}</p>;
}

/** 滑杆与输入框的读数格式：Intl 认得的单位直接带上，其余单位写在说明行里。秒按当前语言的写法认。 */
function intlUnitOf(suffix: string): string | undefined {
  if (suffix === '%') return 'percent';
  if (suffix === '°') return 'degree';
  if (suffix === IC.seconds) return 'second';
  return undefined;
}

function format(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

/**
 * 数值行（原型 bbf8d82）：S2 滑杆自带标签、读数与键盘步进，精确值在原生弹层的数字框里敲。
 * 滑杆只到 `max`，数字框可以越过它到 `hardMax`（音量）；越过时说明行写出当前值。
 * 拖动中的值走 `onLive`，松手才提交；数字框失焦、回车或按步进钮时提交。
 */
export function ValueRow({
  label: text,
  value,
  min,
  max,
  hardMax,
  step = 1,
  digits = 0,
  unit: suffix,
  extra,
  isDisabled,
  normalize,
  onLive,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  hardMax?: number;
  step?: number;
  digits?: number;
  unit?: string;
  extra?: ReactNode;
  isDisabled?: boolean;
  /** 敲进来的数怎么归位（缺省钳进 [min, hardMax]；旋转角是折回）。 */
  normalize?(value: number): number;
  onLive?(value: number): void;
  onCommit(value: number): void;
}) {
  const top = hardMax ?? max;
  const [drag, setDrag] = useState<number | null>(null);
  // 刚提交、视频还没回来的值：显示它，不闪回旧值（失败或被引擎改过时过一会儿放弃）。
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    if (pending !== null && value === pending) setPending(null);
  }, [value, pending]);
  useEffect(() => {
    if (pending === null) return;
    const timer = setTimeout(() => setPending(null), 1500);
    return () => clearTimeout(timer);
  }, [pending]);
  const current = pending ?? value;
  // 拖动开始前的值：拖动中预览叠了草稿，`value` 已经是拖到的值，松手时要跟拖之前比。
  const dragFrom = useRef<number | null>(null);
  const clampTo = (n: number) => (normalize ? normalize(n) : Math.min(top, Math.max(min, n)));
  const shown = drag ?? current;
  const commit = (n: number) => {
    if (n === current) return;
    setPending(n);
    onCommit(n);
  };
  const intlUnit = suffix ? intlUnitOf(suffix) : undefined;
  const formatOptions: Intl.NumberFormatOptions = {
    maximumFractionDigits: digits,
    ...(intlUnit ? { style: 'unit', unit: intlUnit } : {}),
  };
  const over = shown > max;
  const detail = [
    over ? IC.overMax(`${format(shown, digits)}${suffix ?? ''}`, `${max}${suffix ?? ''}`) : null,
    suffix && !intlUnit ? suffix : null,
  ];
  return (
    <div className={valueRow}>
      <Slider
        size="S"
        label={text}
        styles={valueSlider}
        minValue={min}
        maxValue={max}
        step={step}
        formatOptions={formatOptions}
        isDisabled={isDisabled}
        value={Math.min(max, Math.max(min, shown))}
        onChange={(v) => {
          dragFrom.current ??= current;
          setDrag(v);
          onLive?.(v);
        }}
        onChangeEnd={(v) => {
          const from = dragFrom.current ?? current;
          dragFrom.current = null;
          setDrag(null);
          if (v === from) return;
          setPending(v);
          onCommit(v);
        }}
      />
      <DialogTrigger>
        <ActionButton isQuiet size="S" aria-label={IC.exactInput(text)} isDisabled={isDisabled}>
          <Edit />
        </ActionButton>
        <Popover placement="bottom end" aria-label={IC.exactInput(text)}>
          <div className={valueInput}>
            <NumberField
              label={suffix && !intlUnit ? IC.withUnit(text, suffix) : text}
              autoFocus
              value={current}
              minValue={normalize ? undefined : min}
              maxValue={normalize ? undefined : top}
              step={step}
              formatOptions={formatOptions}
              onChange={(n) => {
                if (Number.isFinite(n)) commit(clampTo(n));
              }}
            />
          </div>
        </Popover>
      </DialogTrigger>
      {over || (suffix && !intlUnit) || extra !== undefined ? (
        <span className={`${valueDetail} bc-tabular`}>
          {detail.filter(Boolean).join(' · ')}
          {extra !== undefined ? (
            <>
              {detail.some(Boolean) ? ' · ' : null}
              {extra}
            </>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/** 开关卡（原型 .stcard）：标题加开关，开着时下面是这一组的参数。 */
export function SwitchCard({
  title,
  isOn,
  isDisabled,
  onToggle,
  children,
}: {
  title: string;
  isOn: boolean;
  isDisabled?: boolean;
  onToggle(on: boolean): void;
  children?: ReactNode;
}) {
  return (
    <section className={card} aria-label={title}>
      <div className={cardHead}>
        <span className={cardTitle}>{title}</span>
        <Switch aria-label={title} size="S" isSelected={isOn} isDisabled={isDisabled} onChange={onToggle} />
      </div>
      {isOn && children ? <div className={cardBody}>{children}</div> : null}
    </section>
  );
}

/** 不带开关的卡（图形的填充、描边）。 */
export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={card} aria-label={title}>
      <div className={cardHead}>
        <span className={cardTitle}>{title}</span>
      </div>
      <div className={cardBody}>{children}</div>
    </section>
  );
}

/** 分段控件没有选中项时用的键：S2 在 `selectedKey` 为空时会自己选中第一项并回调，那等于一打开页面就改了视频。 */
const NO_SEGMENT = '\u0000none';

/** 分段：几个互斥的选项。`value` 为 null（当前值不是其中任何一项）时一项也不选中。 */
export function Seg<K extends string>({
  label: text,
  value,
  options,
  isDisabled,
  onChange,
}: {
  label: string;
  value: K | null;
  options: readonly { key: K; label: string }[];
  isDisabled?: boolean;
  onChange(key: K): void;
}) {
  return (
    <SegmentedControl
      aria-label={text}
      selectedKey={value ?? NO_SEGMENT}
      isDisabled={isDisabled}
      onSelectionChange={(key) => {
        if (key !== value && key !== NO_SEGMENT) onChange(key as K);
      }}>
      {options.map((option) => (
        <SegmentedControlItem key={option.key} id={option.key}>
          {option.label}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

const SWATCHES = ['#FFFFFF', '#000000', '#FF4C45', '#FF9F0A', '#FACC15', '#22C55E', '#3CADFF', '#3B63FB', '#A855F7', '#FF6B9A'];

/**
 * 取色：一枚色块加 hex 的小按钮，点开是取色面板（饱和度 / 明度方块、色相条、不透明度条、hex 输入与常用色）。
 * 拖动中走 `onLive`，松手、点常用色或敲完 hex 才 `onCommit`。写回 `#RRGGBB`，不透明时 `#RRGGBBAA`。
 */
export function ColorField({
  label: text,
  value,
  fallback,
  allowAlpha = true,
  isDisabled,
  onLive,
  onCommit,
}: {
  label: string;
  value: unknown;
  fallback: string;
  allowAlpha?: boolean;
  isDisabled?: boolean;
  onLive?(color: string): void;
  onCommit(color: string): void;
}) {
  const parts = colorParts(value, fallback);
  const current = colorString(parts.hex, allowAlpha ? parts.alpha : 1);
  const [color, setColor] = useState<Color>(() => toColor(current));
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) setColor(toColor(current));
  }, [current, dragging]);
  // 拖动开始前的颜色：拖动中预览叠了草稿，`value` 已经是拖到的颜色。
  const liveFrom = useRef<string | null>(null);
  const write = (next: Color) => fromColor(next, allowAlpha);
  const live = (next: Color) => {
    liveFrom.current ??= current;
    setDragging(true);
    setColor(next);
    onLive?.(write(next));
  };
  const commit = (next: Color) => {
    const from = liveFrom.current ?? current;
    liveFrom.current = null;
    setDragging(false);
    setColor(next);
    if (write(next) !== from) onCommit(write(next));
  };
  return (
    <DialogTrigger>
      <ActionButton size="S" aria-label={IC.colorValue(text, current)} isDisabled={isDisabled}>
        <span className={colorTrigger}>
          <ColorSwatch color={current} size="XS" rounding="default" />
          <span className={swatchChip}>{parts.hex}</span>
        </span>
      </ActionButton>
      <Popover placement="bottom start" padding="default">
        <div className={colorPanel}>
          <ColorArea
            aria-label={IC.saturationBrightness(text)}
            value={color.toFormat('hsb')}
            xChannel="saturation"
            yChannel="brightness"
            onChange={live}
            onChangeEnd={commit}
          />
          <ColorSlider channel="hue" value={color.toFormat('hsb')} onChange={live} onChangeEnd={commit} />
          {allowAlpha ? <ColorSlider channel="alpha" value={color} onChange={live} onChangeEnd={commit} /> : null}
          <HexField
            label="Hex"
            size="S"
            value={color}
            onChange={(next) => next && commit(allowAlpha ? next.withChannelValue('alpha', color.getChannelValue('alpha')) : next)}
          />
          <BrandSwatches color={color} allowAlpha={allowAlpha} onPick={commit} />
          <ColorSwatchPicker
            aria-label={IC.commonColors}
            size="XS"
            rounding="default"
            density="compact"
            value={color.toString('hex')}
            onChange={(next) => commit(allowAlpha ? next.withChannelValue('alpha', color.getChannelValue('alpha')) : next)}>
            {SWATCHES.map((swatch) => (
              <ColorSwatch key={swatch} color={swatch} />
            ))}
          </ColorSwatchPicker>
        </div>
      </Popover>
    </DialogTrigger>
  );
}

function toColor(value: string): Color {
  const { hex, alpha } = colorParts(value, '#000000');
  const n = Number.parseInt(hex.slice(1), 16);
  return parseColor(`rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`);
}

function fromColor(color: Color, allowAlpha: boolean): string {
  const rgb = color.toFormat('rgb');
  const hex = colorString(
    `#${[rgb.getChannelValue('red'), rgb.getChannelValue('green'), rgb.getChannelValue('blue')]
      .map((n) => Math.round(n).toString(16).padStart(2, '0'))
      .join('')}`,
    1,
  );
  return colorString(hex, allowAlpha ? rgb.getChannelValue('alpha') : 1);
}

/** 页底的删除钮（原型 .danger）：红色整宽。 */
export function DangerButton({ children, isDisabled, onPress }: { children: ReactNode; isDisabled?: boolean; onPress(): void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      className={danger({ isHovered: hovered && !isDisabled, isDisabled: !!isDisabled })}
      disabled={isDisabled}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onClick={onPress}>
      {children}
    </button>
  );
}
