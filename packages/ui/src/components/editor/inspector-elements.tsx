import { useEffect, useState, type ReactNode } from 'react';
import type {
  AssetRecord,
  CompositionItem,
  ConfettiItem,
  CounterProps,
  ProgressItem,
  ShapeItem,
  StickerItem,
  TextItem,
  VersionRef,
  VisualItem,
  VisualizerItem,
} from '@baocut/protocol';
import { ActionButton, Picker, PickerItem, TextArea } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { hasEffects } from '../../model/effects-panel.ts';
import { SHAPE_CHOICES } from '../../model/element-catalog.ts';
import { colorParts, editableTextStyle, patchShape, patchTextStyle, withAlpha } from '../../model/property-values.ts';
import { STICKER_TEMPLATES } from '../../render/sticker-templates.ts';
import { asObject, num, type Json } from '../../render/text-style.ts';
import { Card, ColorField, Note, PRow, Sec, SecHead, Seg, ValueRow } from './inspector-controls.tsx';
import { EffectsSection } from './inspector-effects.tsx';
import { GeometrySection } from './inspector-geometry.tsx';
import { DeleteItem, OpacityRow, SoundSection, TimeSection, type ItemPageProps } from './inspector-sections.tsx';
import { TransitionSection } from './inspector-transition.tsx';
import { TextStyleEditor } from './inspector-text-style.tsx';
import { ConfettiParams } from './inspector-confetti.tsx';
import { ProgressParams, VisualizerParams } from './inspector-visualizers.tsx';
import { useStickerFills } from './use-sticker-fills.ts';
import { INSPECTOR_COPY as IC } from './inspector-copy.ts';

const textArea = style({ width: 'full' });
const shapePicker = style({ flexGrow: 1, minWidth: 0 });
const dots = style({ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' });

/** 片段页的末尾几节：外观之后是效果（有 `fx` 的片段）、转场、几何、时间与删除。 */
function Tail(props: ItemPageProps<VisualItem>) {
  return (
    <>
      {hasEffects(props.item) ? <EffectsSection {...props} item={props.item} /> : null}
      <TransitionSection {...props} />
      <GeometrySection item={props.item} sequence={props.sequence} assets={props.assets} edit={props.edit} isDisabled={!props.canChange} />
      <TimeSection {...props} />
      <DeleteItem {...props} />
    </>
  );
}

/** 编辑文本：文字、样式（与字幕同一套）、不透明度。 */
export function TextPage(props: ItemPageProps<TextItem>) {
  if (props.item.counter) return <CounterPage {...props} counter={props.item.counter} />;
  const { item, sequence, edit, canChange } = props;
  const editable = editableTextStyle(item.style);
  const current = asObject(item.style);
  const patch = (p: Json) => patchTextStyle(item.style, p);
  return (
    <>
      <SecHead first>{IC.text}</SecHead>
      <Sec>
        <TextBody
          text={item.text ?? ''}
          isDisabled={!canChange}
          onCommit={(text) => edit.commit([{ type: 'setText', sequenceId: sequence.id, itemId: item.id, text }])}
        />
      </Sec>
      <SecHead>{IC.style}</SecHead>
      <Sec>
        {editable ? (
          <TextStyleEditor
            style={current}
            isDisabled={!canChange}
            onLive={(p) => edit.live({ style: patch(p) })}
            onCommit={(p) => edit.commit([{ type: 'setStyle', sequenceId: sequence.id, itemId: item.id, style: patch(p) }])}
          />
        ) : (
          <Note>{IC.textSchema(String(current.schema))}</Note>
        )}
        <OpacityRow {...props} />
      </Sec>
      <Tail {...props} />
    </>
  );
}

/** 文字框：失焦提交（⌘↩ 也提交），Esc 放弃。 */
function TextBody({ text, isDisabled, onCommit }: { text: string; isDisabled: boolean; onCommit(text: string): void }) {
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const commit = () => {
    if (draft !== text) onCommit(draft);
  };
  return (
    <TextArea
      aria-label={IC.text}
      styles={textArea}
      value={draft}
      isDisabled={isDisabled}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) commit();
        if (event.key === 'Escape') setDraft(text);
      }}
    />
  );
}

/** 形状：种类、填充与描边（颜色、不透明度、粗细）、圆角，以及不透明度。描边宽与圆角是 540 短边上的像素。 */
export function ShapePage(props: ItemPageProps<ShapeItem>) {
  const { item, sequence, edit, canChange } = props;
  const shape = asObject(item.shape);
  const disabled = !canChange;
  const live = (p: Json) => edit.live({ shape: patchShape(item.shape, p) });
  const commit = (p: Json) =>
    edit.commit([{ type: 'setStyle', sequenceId: sequence.id, itemId: item.id, shape: patchShape(item.shape, p) }]);
  const fill = colorParts(shape.fill, '#00000000');
  const stroke = colorParts(shape.stroke, '#00000000');
  const corners = Array.isArray(shape.cornerRadius) ? shape.cornerRadius : [shape.cornerRadius];
  const corner = num(corners[0], 0);
  return (
    <>
      <SecHead first>{IC.shape}</SecHead>
      <Sec>
        <PRow label={IC.shape}>
          <Picker
            aria-label={IC.shape}
            size="S"
            styles={shapePicker}
            selectedKey={SHAPE_CHOICES.some((choice) => choice.key === shape.shape) ? String(shape.shape) : 'rect'}
            isDisabled={disabled}
            onSelectionChange={(kind) => kind !== null && kind !== shape.shape && commit({ shape: kind })}>
            {SHAPE_CHOICES.map((choice) => (
              <PickerItem key={choice.key} id={choice.key}>
                {choice.label}
              </PickerItem>
            ))}
          </Picker>
        </PRow>
        <Card title={IC.fill}>
          <PRow label={IC.color}>
            <ColorField
              label={IC.fillColor}
              value={shape.fill}
              fallback="#3B63FB"
              allowAlpha={false}
              isDisabled={disabled}
              onLive={(hex) => live({ fill: withAlpha(hex, fill.alpha || 1, '#3B63FB') })}
              onCommit={(hex) => commit({ fill: withAlpha(hex, fill.alpha || 1, '#3B63FB') })}
            />
          </PRow>
          <ValueRow
            label={IC.opacity}
            value={Math.round(fill.alpha * 100)}
            min={0}
            max={100}
            unit="%"
            isDisabled={disabled}
            onLive={(v) => live({ fill: withAlpha(shape.fill, v / 100, '#3B63FB') })}
            onCommit={(v) => commit({ fill: withAlpha(shape.fill, v / 100, '#3B63FB') })}
          />
        </Card>
        <Card title={IC.stroke}>
          <PRow label={IC.color}>
            <ColorField
              label={IC.strokeColor}
              value={shape.stroke}
              fallback="#FFFFFF"
              allowAlpha={false}
              isDisabled={disabled}
              onLive={(hex) => live({ stroke: withAlpha(hex, stroke.alpha || 1, '#FFFFFF') })}
              onCommit={(hex) => commit({ stroke: withAlpha(hex, stroke.alpha || 1, '#FFFFFF') })}
            />
          </PRow>
          <ValueRow
            label={IC.opacity}
            value={Math.round(stroke.alpha * 100)}
            min={0}
            max={100}
            unit="%"
            isDisabled={disabled}
            onLive={(v) => live({ stroke: withAlpha(shape.stroke, v / 100, '#FFFFFF') })}
            onCommit={(v) => commit({ stroke: withAlpha(shape.stroke, v / 100, '#FFFFFF') })}
          />
          <ValueRow
            label={IC.strokeWidth}
            value={num(shape.strokeWidth, 0)}
            min={0}
            max={40}
            isDisabled={disabled}
            onLive={(strokeWidth) => live({ strokeWidth })}
            onCommit={(strokeWidth) => commit({ strokeWidth })}
          />
        </Card>
        {shape.shape === 'rect' ? (
          <ValueRow
            label={IC.corner}
            value={corner}
            min={0}
            max={72}
            isDisabled={disabled}
            onLive={(c) => live({ cornerRadius: [c, c, c, c] })}
            onCommit={(c) => commit({ cornerRadius: [c, c, c, c] })}
          />
        ) : null}
        <OpacityRow {...props} />
      </Sec>
      <Tail {...props} />
    </>
  );
}

/** 生成类元素页的标题（贴纸、计数器、进度条、声波；计数器与时间线块的类别同名）。素材贴纸按素材分：Lottie 与 GIF 是动态贴纸。 */
export function elementTitle(item: VisualItem, assets: Record<string, AssetRecord> = {}): string {
  switch (item.type) {
    case 'sticker':
      return item.sticker.source === 'asset' && isAnimatedAsset(item.assetRef, assets) ? IC.titleAnimatedSticker : IC.titleSticker;
    case 'text':
      return item.counter ? IC.titleCounter : IC.titleText;
    case 'progress':
      return IC.titleProgress;
    case 'visualizer':
      return IC.titleVisualizer;
    case 'confetti':
      return IC.titleConfetti;
    case 'draw':
      return IC.titleDraw;
    case 'placeholder':
      return IC.titlePlaceholder;
    case 'whiteboard':
      return IC.titleWhiteboard;
    default:
      return IC.titleComposition;
  }
}

/** 种类参数（`sticker`、`progress`、`visualizer`、`confetti`）的改法：拖动叠给预览，松手 `setProps` 整体替换，改一项时其余照抄。 */
function kindParams(props: ItemPageProps<VisualItem>, values: Json) {
  const { item, sequence, edit, canChange } = props;
  return {
    values,
    live: (p: Json) => edit.live({ props: { ...values, ...p } }),
    commit: (p: Json) => edit.commit([{ type: 'setProps', sequenceId: sequence.id, itemId: item.id, props: { ...values, ...p } }]),
    isDisabled: !canChange,
  };
}

/** 生成类元素页：参数，之后是外观（不透明度）、几何、时间。 */
function ElementPage({ children, ...props }: ItemPageProps<VisualItem> & { children: ReactNode }) {
  return (
    <>
      {children}
      <SecHead>{IC.appearance}</SecHead>
      <Sec>
        <OpacityRow {...props} />
      </Sec>
      <Tail {...props} />
    </>
  );
}

/** 素材贴纸动不动：Lottie 与 GIF 动；素材还没到（或不认得）时按动的算，播放方式那一节照给。 */
function isAnimatedAsset(ref: VersionRef | undefined, assets: Record<string, AssetRecord>): boolean {
  const asset = ref ? assets[ref.id] : undefined;
  if (!asset) return true;
  return asset.kind === 'lottie' || asset.revisions[ref!.revision]?.mediaType === 'image/gif';
}

/** 贴纸：模板贴纸按模板的颜色换色；素材贴纸（SVG、Lottie）按素材里读出来的颜色换色，会动的再选播放方式。 */
export function StickerPage(props: ItemPageProps<StickerItem>) {
  const params = kindParams(props, asObject(props.item.sticker));
  const { item, assets } = props;
  const fills = useStickerFills(item.sticker.source === 'asset' ? item.assetRef : undefined, assets);
  if (item.sticker.source !== 'asset') {
    return (
      <ElementPage {...props}>
        <StickerParams {...params} />
      </ElementPage>
    );
  }
  return (
    <ElementPage {...props}>
      {fills.length ? <FillColors first sources={fills} {...params} /> : null}
      {isAnimatedAsset(item.assetRef, assets) ? <LottieParams first={!fills.length} {...params} /> : null}
    </ElementPage>
  );
}

/** 进度条。 */
export function ProgressPage(props: ItemPageProps<ProgressItem>) {
  return (
    <ElementPage {...props}>
      <ProgressParams {...kindParams(props, asObject(props.item.progress))} canvas={props.sequence.canvas} />
    </ElementPage>
  );
}

/** 声波。 */
export function VisualizerPage(props: ItemPageProps<VisualizerItem>) {
  return (
    <ElementPage {...props}>
      <VisualizerParams {...kindParams(props, asObject(props.item.visualizer))} canvas={props.sequence.canvas} />
    </ElementPage>
  );
}

/** 彩纸。 */
export function ConfettiPage(props: ItemPageProps<ConfettiItem>) {
  return (
    <ElementPage {...props}>
      <ConfettiParams {...kindParams(props, asObject(props.item.confetti))} />
    </ElementPage>
  );
}

/** 计数器（带计时读数的文字）：计时方式与钟面走 `setText` 的 `counter`，数字的样式走 `setStyle`。 */
function CounterPage(props: ItemPageProps<TextItem> & { counter: CounterProps }) {
  const { item, sequence, edit, canChange, counter } = props;
  const values: Json = { ...counter, style: asObject(item.style) };
  const live = (p: Json) => {
    if (p.style !== undefined) edit.live({ style: asObject(p.style) });
  };
  const commit = (p: Json) => {
    const { style: nextStyle, ...rest } = p;
    if (nextStyle !== undefined) edit.commit([{ type: 'setStyle', sequenceId: sequence.id, itemId: item.id, style: asObject(nextStyle) }]);
    if (Object.keys(rest).length)
      edit.commit([{ type: 'setText', sequenceId: sequence.id, itemId: item.id, counter: { ...counter, ...rest } as CounterProps }]);
  };
  return (
    <ElementPage {...props}>
      <CounterParams values={values} live={live} commit={commit} isDisabled={!canChange} />
    </ElementPage>
  );
}

/** 属性页还没有专门一页的元素（手绘、占位框、白板）：只给外观、几何与时间。 */
export function OtherElementPage(props: ItemPageProps<VisualItem>) {
  return (
    <ElementPage {...props}>
      <SecHead first>{IC.params}</SecHead>
      <Note>{IC.paramsReadOnly(elementTitle(props.item, props.assets))}</Note>
    </ElementPage>
  );
}

/** 合成：代码包的参数要按它的 Schema 校验，引擎还不支持，只读。之后是声音（有的话）、不透明度、几何、时间。 */
export function CompositionPage(props: ItemPageProps<CompositionItem>) {
  return (
    <>
      <SecHead first>{IC.params}</SecHead>
      <Note>{IC.compositionReadOnly}</Note>
      <SoundSection {...props} />
      <SecHead>{IC.appearance}</SecHead>
      <Sec>
        <OpacityRow {...props} />
      </Sec>
      <Tail {...props} />
    </>
  );
}

interface ParamProps {
  values: Json;
  isDisabled: boolean;
  live(patch: Json): void;
  commit(patch: Json): void;
}

/** 贴纸：模板里的每一种颜色一枚色点，换色写进 `fillOverrides`（键是模板原色）。 */
function StickerParams(props: ParamProps) {
  const templateId = typeof props.values.templateId === 'string' ? props.values.templateId : '';
  const layers = STICKER_TEMPLATES[templateId];
  if (!layers) {
    return (
      <>
        <SecHead first aside={templateId || undefined}>
          {IC.color}
        </SecHead>
        <Sec>
          <Note>{IC.stickerUnknown(templateId)}</Note>
        </Sec>
      </>
    );
  }
  const sources = [...new Set(layers.flatMap((layer) => [layer.fill, layer.stroke]).filter((c): c is string => !!c))];
  return <FillColors first aside={templateId} sources={sources} {...props} />;
}

/** 一种源色一枚色点（原型的色卡）：换色写进 `fillOverrides`，键是源色，比较时不分大小写。 */
function FillColors({
  sources,
  aside,
  first,
  values,
  isDisabled,
  live,
  commit,
}: ParamProps & { sources: readonly string[]; aside?: string; first?: boolean }) {
  const overrides = asObject(values.fillOverrides);
  const overrideOf = (source: string) => Object.entries(overrides).find(([from]) => from.toLowerCase() === source.toLowerCase());
  const withOverride = (source: string, color: string) => {
    const next = Object.fromEntries(Object.entries(overrides).filter(([from]) => from.toLowerCase() !== source.toLowerCase()));
    return { fillOverrides: { ...next, [source]: color } };
  };
  return (
    <>
      <SecHead
        first={first}
        aside={aside || undefined}
        action={
          Object.keys(overrides).length ? (
            <ActionButton isQuiet size="XS" isDisabled={isDisabled} onPress={() => commit({ fillOverrides: {} })}>
              {IC.restoreColors}
            </ActionButton>
          ) : undefined
        }>
        {IC.color}
      </SecHead>
      <Sec>
        <div className={dots}>
          {sources.map((source) => (
            <ColorField
              key={source}
              label={IC.replaceColor(source)}
              value={overrideOf(source)?.[1] ?? source}
              fallback={source}
              isDisabled={isDisabled}
              onLive={(color) => live(withOverride(source, color))}
              onCommit={(color) => commit(withOverride(source, color))}
            />
          ))}
        </div>
      </Sec>
    </>
  );
}

const LOOPS = [
  {
    key: 'loop',
    get label() {
      return IC.loopLoop;
    },
  },
  {
    key: 'once',
    get label() {
      return IC.loopOnce;
    },
  },
  {
    key: 'hold',
    get label() {
      return IC.loopHold;
    },
  },
] as const;

/** Lottie：循环播放、只播一次（停在最后一帧）或定格在开头。 */
function LottieParams({ values, isDisabled, commit, first }: ParamProps & { first?: boolean }) {
  const loop = values.loop === 'once' || values.loop === 'hold' ? values.loop : 'loop';
  return (
    <>
      <SecHead first={first}>{IC.playback}</SecHead>
      <Sec>
        <Seg label={IC.playMode} value={loop} options={LOOPS} isDisabled={isDisabled} onChange={(key) => commit({ loop: key })} />
      </Sec>
    </>
  );
}

const MODES = [
  {
    key: 'countdown',
    get label() {
      return IC.countdown;
    },
  },
  {
    key: 'countup',
    get label() {
      return IC.countup;
    },
  },
] as const;
const FORMATS = [
  {
    key: 's',
    get label() {
      return IC.formatS;
    },
  },
  {
    key: 'mm:ss',
    get label() {
      return IC.formatMmss;
    },
  },
  {
    key: 'hh:mm:ss',
    get label() {
      return IC.formatHmmss;
    },
  },
] as const;

/** 计数器：倒计时或正计时、钟面格式，以及数字的文字样式（与文字片段同一套）。 */
function CounterParams({ values, isDisabled, live, commit }: ParamProps) {
  const style = asObject(values.style);
  return (
    <>
      <SecHead first>{IC.titleCounter}</SecHead>
      <Sec>
        <PRow label={IC.timing}>
          <Seg
            label={IC.timingMode}
            value={values.mode === 'countup' ? 'countup' : 'countdown'}
            options={MODES}
            isDisabled={isDisabled}
            onChange={(mode) => commit({ mode })}
          />
        </PRow>
        <PRow label={IC.clockFace}>
          <Seg
            label={IC.clockFace}
            value={values.format === 'mm:ss' || values.format === 'hh:mm:ss' ? values.format : 's'}
            options={FORMATS}
            isDisabled={isDisabled}
            onChange={(format) => commit({ format })}
          />
        </PRow>
      </Sec>
      <SecHead>{IC.style}</SecHead>
      <Sec>
        <TextStyleEditor
          style={style}
          isDisabled={isDisabled}
          onLive={(p) => live({ style: { ...style, ...p } })}
          onCommit={(p) => commit({ style: { ...style, ...p } })}
        />
      </Sec>
    </>
  );
}
