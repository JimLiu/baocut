import type { ReactNode } from 'react';
import { Picker, PickerItem, ToggleButton } from '@react-spectrum/s2';
import TextBold from '@react-spectrum/s2/icons/TextBold';
import TextItalic from '@react-spectrum/s2/icons/TextItalic';
import TextUnderline from '@react-spectrum/s2/icons/TextUnderline';
import { style as macro } from '@react-spectrum/s2/style' with { type: 'macro' };
import { colorParts, nested, withAlpha } from '../../model/property-values.ts';
import { asObject, num, parseColor, type Json } from '../../render/text-style.ts';
import { FontField } from './font-field.tsx';
import { ColorField, Note, PRow, Seg, SwitchCard, ValueRow } from './inspector-controls.tsx';
import { CAPTION_STYLE_COPY as CAPTION } from './subtitle-copy.ts';
import { INSPECTOR_COPY as IC } from './inspector-copy.ts';

const toggles = macro({ display: 'flex', gap: 4, marginStart: 'auto' });
const picker = macro({ flexGrow: 1, minWidth: 0 });

export { FONTS, FONT_ALIASES } from './font-field.tsx';

const ALIGNS = [
  {
    key: 'left',
    get label() {
      return IC.alignLeft;
    },
  },
  {
    key: 'center',
    get label() {
      return IC.alignCenter;
    },
  },
  {
    key: 'right',
    get label() {
      return IC.alignRight;
    },
  },
] as const;

/** 阴影的距离与模糊存的是字号的比例：界面 0–100 对应 0–0.3 与 0–0.5（baocut-app 的口径）。 */
const SHADOW_DISTANCE_MAX = 0.3;
const SHADOW_BLUR_MAX = 0.5;

function visible(value: unknown): boolean {
  return (parseColor(value)?.a ?? 0) > 0;
}

/** 这几个开关与 text-style.ts 的 resolveLineStyle（渲染内核同一个判法）一致，所以开着就一定画得出来。 */
export function backgroundOn(style: Json): boolean {
  if (typeof style.background === 'boolean') return style.background;
  if (typeof style.bgOn === 'boolean') return style.bgOn;
  return visible(style.backgroundColor);
}
export function outlineOn(style: Json): boolean {
  const outline = asObject(style.textOutline);
  if (typeof outline.on === 'boolean') return outline.on;
  if (typeof style.outline === 'boolean') return style.outline;
  return num(outline.width, 0) > 0 && (parseColor(outline.color)?.a ?? 224 / 255) > 0;
}
export function glowOn(style: Json): boolean {
  const glow = asObject(style.glow);
  return typeof glow.on === 'boolean' ? glow.on : num(glow.intensity, 0) > 0;
}
export function shadowOn(style: Json): boolean {
  const shadow = asObject(style.dropShadow);
  return typeof shadow.on === 'boolean' ? shadow.on : num(shadow.blur, 0) > 0 || num(shadow.distance, 0) > 0;
}

/**
 * 文字样式（文字实例的 `style` 与 Studio 字幕样式的根对象，字段同一套）：字体、字号、颜色、粗斜下划线、
 * 对齐、行高、字间距，以及背景 · 描边 · 发光 · 阴影四张开关卡。显示的缺省值与渲染器一致，开着的效果都画得出来。
 * `onLive` / `onCommit` 收到的是根对象上的补丁（嵌套字段整组给出），由调用方叠进样式再提交。
 */
export function TextStyleEditor({
  style,
  isDisabled,
  onLive,
  onCommit,
  caption,
  sizeNote,
}: {
  style: Json;
  isDisabled: boolean;
  onLive(patch: Json): void;
  onCommit(patch: Json): void;
  /** 字幕样式：多给大小写与背景形态两项（原型 panel-subprops.jsx；Studio 字幕样式的 `textTransform`、`backgroundStyle`）。 */
  caption?: boolean;
  /** 字号下面的一句说明（字幕属性页的比例链）。 */
  sizeNote?: ReactNode;
}) {
  const legacyOutline = style.outline === true;
  const align = style.textAlign ?? style.align;
  const outline = asObject(style.textOutline);
  const glow = asObject(style.glow);
  const shadow = asObject(style.dropShadow);
  const background = backgroundOn(style);
  const bgColor = style.backgroundColor ?? 'rgba(0, 0, 0, 0.8)';
  const bgAlpha = colorParts(bgColor, '#000000').alpha;
  const both = glowOn(style) && shadowOn(style);
  const transform = style.textTransform;
  const casing = transform === 'uppercase' || transform === 'lowercase' ? transform : transform === 'title' || transform === 'capitalize' ? 'title' : 'none';
  const plate = style.backgroundStyle === 'block' ? 'block' : 'wrap';
  const set = (patch: Json) => onCommit(patch);
  const group = (name: string, patch: Json) => nested(style, name, patch);

  return (
    <>
      <FontField value={style.fontFamily} isDisabled={isDisabled} onChange={(fontFamily) => set({ fontFamily })} />
      <ValueRow
        label={IC.fontSize}
        value={num(style.fontSize, 30)}
        min={8}
        max={140}
        hardMax={400}
        isDisabled={isDisabled}
        onLive={(fontSize) => onLive({ fontSize })}
        onCommit={(fontSize) => set({ fontSize })}
      />
      {sizeNote}
      <PRow label={IC.color}>
        <ColorField
          label={IC.textColor}
          value={style.fontColor}
          fallback="#FFFFFF"
          isDisabled={isDisabled}
          onLive={(fontColor) => onLive({ fontColor })}
          onCommit={(fontColor) => set({ fontColor })}
        />
        <span className={toggles}>
          <ToggleButton
            isQuiet
            size="S"
            aria-label={IC.bold}
            isDisabled={isDisabled}
            isSelected={style.bold === true}
            onChange={(bold) => set({ bold })}>
            <TextBold />
          </ToggleButton>
          <ToggleButton
            isQuiet
            size="S"
            aria-label={IC.italic}
            isDisabled={isDisabled}
            isSelected={style.italic === true || style.fontStyle === 'italic'}
            onChange={(italic) => set(italic ? { italic } : { italic, fontStyle: 'normal' })}>
            <TextItalic />
          </ToggleButton>
          <ToggleButton
            isQuiet
            size="S"
            aria-label={IC.underline}
            isDisabled={isDisabled}
            isSelected={style.underline === true}
            onChange={(underline) => set({ underline })}>
            <TextUnderline />
          </ToggleButton>
        </span>
      </PRow>
      <PRow label={IC.align}>
        <Seg
          label={IC.align}
          value={align === 'left' || align === 'right' ? align : 'center'}
          options={ALIGNS}
          isDisabled={isDisabled}
          onChange={(textAlign) => set({ textAlign })}
        />
      </PRow>
      <ValueRow
        label={IC.lineHeight}
        value={Math.round(num(style.lineHeight, 1.2) * 100)}
        min={90}
        max={200}
        unit="%"
        isDisabled={isDisabled}
        onLive={(v) => onLive({ lineHeight: v / 100 })}
        onCommit={(v) => set({ lineHeight: v / 100 })}
      />
      <ValueRow
        label={IC.letterSpacing}
        value={num(style.letterSpacing, 0)}
        min={-10}
        max={30}
        step={0.5}
        digits={1}
        isDisabled={isDisabled}
        onLive={(letterSpacing) => onLive({ letterSpacing })}
        onCommit={(letterSpacing) => set({ letterSpacing })}
      />
      {caption ? (
        <PRow label={CAPTION.casing}>
          <Picker
            aria-label={CAPTION.casing}
            size="S"
            styles={picker}
            isDisabled={isDisabled}
            value={casing}
            onChange={(key) => key !== null && key !== casing && set({ textTransform: String(key) })}>
            {CAPTION.cases.map((c) => (
              <PickerItem key={c.key} id={c.key}>
                {c.label}
              </PickerItem>
            ))}
          </Picker>
        </PRow>
      ) : null}

      <SwitchCard title={IC.background} isOn={background} isDisabled={isDisabled} onToggle={(on) => set({ background: on })}>
        {caption ? (
          <>
            <PRow label={CAPTION.plate}>
              <Seg
                label={IC.backgroundPlate}
                value={plate}
                options={CAPTION.plates}
                isDisabled={isDisabled}
                onChange={(backgroundStyle) => set({ backgroundStyle })}
              />
            </PRow>
            <Note>{CAPTION.plates.find((p) => p.key === plate)!.note}</Note>
          </>
        ) : null}
        <PRow label={IC.color}>
          <ColorField
            label={IC.backgroundColor}
            value={bgColor}
            fallback="#000000"
            allowAlpha={false}
            isDisabled={isDisabled}
            onLive={(hex) => onLive({ backgroundColor: withAlpha(hex, bgAlpha, '#000000') })}
            onCommit={(hex) => set({ backgroundColor: withAlpha(hex, bgAlpha, '#000000') })}
          />
        </PRow>
        <ValueRow
          label={IC.opacity}
          value={Math.round(bgAlpha * 100)}
          min={1}
          max={100}
          unit="%"
          isDisabled={isDisabled}
          onLive={(v) => onLive({ backgroundColor: withAlpha(bgColor, v / 100, '#000000') })}
          onCommit={(v) => set({ backgroundColor: withAlpha(bgColor, v / 100, '#000000') })}
        />
        <ValueRow
          label={IC.corner}
          value={num(style.borderRadius, 10)}
          min={0}
          max={50}
          isDisabled={isDisabled}
          onLive={(borderRadius) => onLive({ borderRadius })}
          onCommit={(borderRadius) => set({ borderRadius })}
        />
        <ValueRow
          label={IC.padding}
          value={num(style.backgroundPadding, 10)}
          min={0}
          max={50}
          isDisabled={isDisabled}
          onLive={(backgroundPadding) => onLive({ backgroundPadding })}
          onCommit={(backgroundPadding) => set({ backgroundPadding })}
        />
      </SwitchCard>

      <SwitchCard
        title={IC.stroke}
        isOn={outlineOn(style)}
        isDisabled={isDisabled}
        onToggle={(on) => set({ outline: on, ...group('textOutline', { on }) })}>
        <PRow label={IC.color}>
          <ColorField
            label={IC.strokeColor}
            value={outline.color}
            fallback="#000000E0"
            isDisabled={isDisabled}
            onLive={(color) => onLive(group('textOutline', { color }))}
            onCommit={(color) => set(group('textOutline', { color }))}
          />
        </PRow>
        <ValueRow
          label={IC.strokeWidth}
          value={num(outline.width, legacyOutline ? 14 : 0)}
          min={0}
          max={40}
          isDisabled={isDisabled}
          onLive={(width) => onLive(group('textOutline', { width }))}
          onCommit={(width) => set(group('textOutline', { width }))}
        />
      </SwitchCard>

      <SwitchCard title={IC.glow} isOn={glowOn(style)} isDisabled={isDisabled} onToggle={(on) => set(group('glow', { on }))}>
        <PRow label={IC.color}>
          <ColorField
            label={IC.glowColor}
            value={glow.color}
            fallback="#FFFFFF"
            allowAlpha={false}
            isDisabled={isDisabled}
            onLive={(color) => onLive(group('glow', { color }))}
            onCommit={(color) => set(group('glow', { color }))}
          />
        </PRow>
        <ValueRow
          label={IC.intensity}
          value={num(glow.intensity, 50)}
          min={0}
          max={100}
          step={5}
          isDisabled={isDisabled}
          onLive={(intensity) => onLive(group('glow', { intensity }))}
          onCommit={(intensity) => set(group('glow', { intensity }))}
        />
        <ValueRow
          label={IC.range}
          value={num(glow.range, 40)}
          min={0}
          max={100}
          isDisabled={isDisabled}
          onLive={(range) => onLive(group('glow', { range }))}
          onCommit={(range) => set(group('glow', { range }))}
        />
        {both ? <Note>{IC.glowShadowNote}</Note> : null}
      </SwitchCard>

      <SwitchCard title={IC.shadow} isOn={shadowOn(style)} isDisabled={isDisabled} onToggle={(on) => set(group('dropShadow', { on }))}>
        <PRow label={IC.color}>
          <ColorField
            label={IC.shadowColor}
            value={shadow.color}
            fallback="#000000"
            allowAlpha={false}
            isDisabled={isDisabled}
            onLive={(color) => onLive(group('dropShadow', { color }))}
            onCommit={(color) => set(group('dropShadow', { color }))}
          />
        </PRow>
        <ValueRow
          label={IC.distance}
          value={Math.round((num(shadow.distance, 0.04) / SHADOW_DISTANCE_MAX) * 100)}
          min={0}
          max={100}
          isDisabled={isDisabled}
          onLive={(v) => onLive(group('dropShadow', { distance: (v / 100) * SHADOW_DISTANCE_MAX }))}
          onCommit={(v) => set(group('dropShadow', { distance: (v / 100) * SHADOW_DISTANCE_MAX }))}
        />
        <ValueRow
          label={IC.blur}
          value={Math.round((num(shadow.blur, legacyOutline ? 0.12 : 0.08) / SHADOW_BLUR_MAX) * 100)}
          min={0}
          max={100}
          isDisabled={isDisabled}
          onLive={(v) => onLive(group('dropShadow', { blur: (v / 100) * SHADOW_BLUR_MAX }))}
          onCommit={(v) => set(group('dropShadow', { blur: (v / 100) * SHADOW_BLUR_MAX }))}
        />
        <ValueRow
          label={IC.angle}
          value={num(shadow.rotation, 90)}
          min={0}
          max={360}
          step={5}
          unit="°"
          isDisabled={isDisabled}
          onLive={(rotation) => onLive(group('dropShadow', { rotation }))}
          onCommit={(rotation) => set(group('dropShadow', { rotation }))}
        />
        <ValueRow
          label={IC.opacity}
          value={Math.round(num(shadow.opacity, legacyOutline ? 0.48 : 0.6) * 100)}
          min={0}
          max={100}
          unit="%"
          isDisabled={isDisabled}
          onLive={(v) => onLive(group('dropShadow', { opacity: v / 100 }))}
          onCommit={(v) => set(group('dropShadow', { opacity: v / 100 }))}
        />
      </SwitchCard>
    </>
  );
}
