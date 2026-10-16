import type { TemplateBox, TemplateLayer } from '@baocut/protocol';
import { ActionButton, Button, Switch, Text, TextArea, TextField } from '@react-spectrum/s2';
import Delete from '@react-spectrum/s2/icons/Delete';
import Image from '@react-spectrum/s2/icons/Image';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { layerOpacity, logoAlign, TEMPLATE_VARS } from '../../model/template-layers.ts';
import { patchStudioLayer, quickBox, removeLayer, setLayerBox, type BoxQuick, type TemplateStudio } from '../../model/template-studio.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useLibrary } from '../../state/library-store.ts';
import { kindLabel } from './elements-templates.tsx';
import { ColorField, Note, PRow, Sec, SecHead, Seg, ValueRow } from './inspector-controls.tsx';
import { TEMPLATE_COPY as TC } from './template-copy.ts';

const chips = style({ display: 'flex', flexWrap: 'wrap', gap: 4 });
const push = style({ marginStart: 'auto' });
const grow = style({ flexGrow: 1, minWidth: 0 });

/** 底色只给三档（原型 panel-template-studio `BG`）：深、浅、无。半透明底是画进画面的颜色，不让人在 alpha 里手调。 */
type Shade = 'dark' | 'light' | 'none';
const BG: Record<Shade, string> = { dark: '#00000099', light: '#FFFFFFB8', none: '#00000000' };
const TRACK: Record<Shade, string> = { dark: '#00000059', light: '#FFFFFF40', none: '#00000000' };
const WHITE = '#FFFFFF';
const INK = '#131313';

/** 一个颜色落在哪一档：全透明是「无」，接近白的是「浅」，其余是「深」。 */
function shadeOf(color: string | undefined): Shade {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color ?? '');
  if (!hex || hex[2]?.toLowerCase() === '00') return 'none';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16));
  return r! >= 0xf0 && g! >= 0xf0 && b! >= 0xf0 ? 'light' : 'dark';
}

const SHADES = (): { key: Shade; label: string }[] => [
  { key: 'dark', label: TC.bgDark },
  { key: 'light', label: TC.bgLight },
  { key: 'none', label: TC.bgNone },
];
const ALIGNS = (): { key: 'left' | 'center' | 'right'; label: string }[] => [
  { key: 'left', label: TC.alignLeft },
  { key: 'center', label: TC.alignCenter },
  { key: 'right', label: TC.alignRight },
];

const update = (fn: (s: TemplateStudio) => TemplateStudio) => useEditor.getState().updateStudio(fn);

/** 字号（画面高的百分比）。 */
function SizeRow({ value, fallback, onChange }: { value: number | undefined; fallback: number; onChange(size: number): void }) {
  return (
    <ValueRow
      label={TC.fontSize}
      value={value ?? fallback}
      min={1}
      max={8}
      step={0.2}
      digits={1}
      unit="%"
      onLive={onChange}
      onCommit={onChange}
    />
  );
}

/** 几何段：左、上、宽、高四个百分比，加整宽、贴顶、贴底、水平居中。拖动滑杆时直接改草稿（草稿本来就只在这里）。 */
function Geometry({ layer }: { layer: TemplateLayer }) {
  const set = (patch: Partial<TemplateBox>) => update((s) => setLayerBox(s, layer.id, { ...layer.box, ...patch }));
  const quick = (q: BoxQuick) => update((s) => setLayerBox(s, layer.id, quickBox(layer.box, q)));
  const rows: { key: keyof TemplateBox; label: string }[] = [
    { key: 'x', label: TC.boxX },
    { key: 'y', label: TC.boxY },
    { key: 'w', label: TC.boxW },
    { key: 'h', label: TC.boxH },
  ];
  return (
    <>
      <SecHead>{TC.geometry}</SecHead>
      <Sec>
        {rows.map(({ key, label }) => (
          <ValueRow
            key={key}
            label={label}
            value={layer.box[key]}
            min={key === 'w' || key === 'h' ? 1 : 0}
            max={100}
            step={0.5}
            digits={1}
            unit="%"
            onLive={(value) => set({ [key]: value })}
            onCommit={(value) => set({ [key]: value })}
          />
        ))}
        <div className={chips}>
          <Button variant="secondary" size="S" onPress={() => quick('full')}>
            {TC.fullWidth}
          </Button>
          <Button variant="secondary" size="S" onPress={() => quick('top')}>
            {TC.snapTop}
          </Button>
          <Button variant="secondary" size="S" onPress={() => quick('bottom')}>
            {TC.snapBottom}
          </Button>
          <Button variant="secondary" size="S" onPress={() => quick('center')}>
            {TC.snapCenter}
          </Button>
        </div>
      </Sec>
    </>
  );
}

/** 文字层的内容：多行框，下面一排插变量的钮。 */
function TextContent({ text, onChange }: { text: string; onChange(text: string): void }) {
  return (
    <>
      <SecHead>{TC.content}</SecHead>
      <Sec>
        <TextArea aria-label={TC.content} size="S" styles={grow} value={text} onChange={onChange} />
        <div className={chips}>
          {TEMPLATE_VARS.map((name) => (
            <Button key={name} variant="secondary" size="S" aria-label={TC.insertVar(name)} onPress={() => onChange(`${text}{${name}}`)}>
              {`{${name}}`}
            </Button>
          ))}
        </div>
      </Sec>
      <Note>{TC.varsHelp}</Note>
    </>
  );
}

/**
 * 版面编辑器里选中那一层的属性（原型 panel-template-studio `LayerProps`）：位置与大小人人有，其余按层的种类。
 * 改的都是草稿，「完成」才写回。
 */
export function StudioLayerProps({ layer }: { layer: TemplateLayer }) {
  const brandImages = useLibrary((s) => s.brand).filter((entry) => entry.kind === 'image');
  const set = (patch: Partial<TemplateLayer>) => update((s) => patchStudioLayer(s, layer.id, patch));
  const name = kindLabel(layer.kind);
  return (
    <>
      <SecHead
        aside={layer.on === false ? TC.layerOff : undefined}
        action={
          <ActionButton isQuiet size="S" aria-label={TC.deleteLayer} onPress={() => update((s) => removeLayer(s, layer.id))}>
            <Delete />
          </ActionButton>
        }>
        {name}
      </SecHead>
      <Geometry layer={layer} />

      {layer.kind === 'chapters' ? (
        <>
          <SecHead>{TC.look}</SecHead>
          <Sec>
            <PRow label={TC.fill}>
              <Seg<'bar' | 'dim'>
                label={TC.fill}
                value={layer.fill ?? 'bar'}
                options={[
                  { key: 'bar', label: TC.fillBar },
                  { key: 'dim', label: TC.fillDim },
                ]}
                onChange={(fill) => set({ fill })}
              />
            </PRow>
            <PRow label={layer.fill === 'dim' ? TC.playedBase : TC.barColor}>
              <ColorField
                label={layer.fill === 'dim' ? TC.playedBase : TC.barColor}
                value={layer.accent}
                fallback={WHITE}
                onLive={(accent) => set({ accent })}
                onCommit={(accent) => set({ accent })}
              />
            </PRow>
            <PRow label={TC.background}>
              <Seg<Shade>
                label={TC.background}
                value={shadeOf(layer.bg)}
                options={SHADES()}
                // 浅底配深字，播过的那几章换回白字（原型 inkFor）。
                onChange={(shade) =>
                  set({ bg: BG[shade], color: shade === 'light' ? INK : WHITE, colorDone: shade === 'light' ? WHITE : undefined })
                }
              />
            </PRow>
            <PRow label={TC.divider}>
              <Switch
                size="S"
                aria-label={TC.divider}
                styles={push}
                isSelected={layer.divider !== false}
                onChange={(divider) => set({ divider })}
              />
            </PRow>
            <SizeRow value={layer.size} fallback={2.6} onChange={(size) => set({ size })} />
          </Sec>
        </>
      ) : null}

      {layer.kind === 'progress' ? (
        <>
          <SecHead>{TC.look}</SecHead>
          <Sec>
            <PRow label={TC.color}>
              <ColorField
                label={TC.color}
                value={layer.accent}
                fallback={WHITE}
                onLive={(accent) => set({ accent })}
                onCommit={(accent) => set({ accent })}
              />
            </PRow>
            <PRow label={TC.track}>
              <Seg<Shade>
                label={TC.track}
                value={shadeOf(layer.track)}
                options={SHADES()}
                onChange={(shade) => set({ track: TRACK[shade] })}
              />
            </PRow>
          </Sec>
        </>
      ) : null}

      {layer.kind === 'logo' ? <LogoLook layer={layer} images={brandImages} set={set} /> : null}

      {layer.kind === 'text' ? (
        <>
          <TextContent text={layer.text} onChange={(text) => set({ text })} />
          <SecHead>{TC.look}</SecHead>
          <Sec>
            <PRow label={TC.align}>
              <Seg label={TC.align} value={layer.align ?? 'left'} options={ALIGNS()} onChange={(align) => set({ align })} />
            </PRow>
            <PRow label={TC.textColor}>
              <ColorField
                label={TC.textColor}
                value={layer.color}
                fallback={WHITE}
                onLive={(color) => set({ color })}
                onCommit={(color) => set({ color })}
              />
            </PRow>
            <PRow label={TC.background}>
              <ColorField
                label={TC.background}
                value={layer.bg}
                fallback={BG.none}
                onLive={(bg) => set({ bg })}
                onCommit={(bg) => set({ bg })}
              />
            </PRow>
            <PRow label={TC.monoDigits}>
              <Switch size="S" aria-label={TC.monoDigits} styles={push} isSelected={!!layer.mono} onChange={(mono) => set({ mono })} />
            </PRow>
            <SizeRow value={layer.size} fallback={2.8} onChange={(size) => set({ size })} />
          </Sec>
        </>
      ) : null}
    </>
  );
}

type LogoLayer = Extract<TemplateLayer, { kind: 'logo' }>;

/** 台标的样子：来源（文字 / 品牌库图片）、平铺、不透明度、对齐，文字的再加形状、颜色与字号。 */
function LogoLook({
  layer,
  images,
  set,
}: {
  layer: LogoLayer;
  images: readonly { id: string; name: string }[];
  set(patch: Partial<TemplateLayer>): void;
}) {
  const text = layer.src === undefined || layer.src === 'text';
  const picked = layer.src && typeof layer.src === 'object' && 'brandLogo' in layer.src ? layer.src.brandLogo : null;
  return (
    <>
      <SecHead>{TC.look}</SecHead>
      <Sec>
        <PRow label={TC.source}>
          <Seg<'text' | 'image'>
            label={TC.source}
            value={text ? 'text' : 'image'}
            options={[
              { key: 'text', label: TC.sourceText },
              { key: 'image', label: TC.sourceImage },
            ]}
            onChange={(next) => {
              if (next === 'text') set({ src: 'text' });
              else if (images[0]) set({ src: { brandLogo: images[0].id } });
            }}
          />
        </PRow>
        <PRow label={TC.tile}>
          <Switch size="S" aria-label={TC.tile} styles={push} isSelected={!!layer.tile} onChange={(tile) => set({ tile })} />
        </PRow>
        <ValueRow
          label={TC.opacity}
          value={Math.round(layerOpacity(layer) * 100)}
          min={5}
          max={100}
          step={5}
          unit="%"
          onLive={(value) => set({ opacity: Math.min(1, Math.max(0.05, value / 100)) })}
          onCommit={(value) => set({ opacity: Math.min(1, Math.max(0.05, value / 100)) })}
        />
        {!layer.tile ? (
          <PRow label={TC.align}>
            <Seg label={TC.align} value={logoAlign(layer)} options={ALIGNS()} onChange={(align) => set({ align })} />
          </PRow>
        ) : null}
        {text ? (
          <>
            <PRow label={TC.text}>
              <TextField aria-label={TC.text} size="S" styles={grow} value={layer.text ?? ''} onChange={(value) => set({ text: value })} />
            </PRow>
            <PRow label={TC.shape}>
              <Seg<'badge' | 'plain'>
                label={TC.shape}
                value={layer.shape ?? 'plain'}
                options={[
                  { key: 'badge', label: TC.badge },
                  { key: 'plain', label: TC.plainText },
                ]}
                onChange={(shape) => set({ shape })}
              />
            </PRow>
            <PRow label={TC.background}>
              <ColorField
                label={TC.background}
                value={layer.bg}
                fallback={BG.none}
                onLive={(bg) => set({ bg })}
                onCommit={(bg) => set({ bg })}
              />
            </PRow>
            <PRow label={TC.textColor}>
              <ColorField
                label={TC.textColor}
                value={layer.color}
                fallback={WHITE}
                onLive={(color) => set({ color })}
                onCommit={(color) => set({ color })}
              />
            </PRow>
            <SizeRow value={layer.size} fallback={3} onChange={(size) => set({ size })} />
          </>
        ) : images.length ? (
          <div className={chips} role="group" aria-label={TC.pickBrandImage}>
            {images.map((entry) => (
              <Button
                key={entry.id}
                size="S"
                variant={picked === entry.id ? 'accent' : 'secondary'}
                onPress={() => set({ src: { brandLogo: entry.id } })}>
                <Image />
                <Text>{entry.name}</Text>
              </Button>
            ))}
          </div>
        ) : (
          <Note>{TC.noBrandImages}</Note>
        )}
      </Sec>
    </>
  );
}
