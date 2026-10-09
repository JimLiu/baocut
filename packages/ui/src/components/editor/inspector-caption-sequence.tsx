import { Button, Switch } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useState } from 'react';
import { Button as RACButton } from 'react-aria-components';
import { CAPTION_PRESETS } from '../../model/caption-presets.ts';
import {
  DEFAULT_SEQUENCE,
  LIGHT_PRESET,
  SEQUENCE_PALETTES,
  cameraValue,
  normalizeSequence,
  reseed,
  type SequenceOptions,
  type SequencePalette,
} from '../../model/caption-sequence-style.ts';
import { CAPTION_PANEL_COPY as P } from './caption-panel-copy.ts';
import { useSectionFocus, useWordEdit, type WordSectionProps } from './inspector-caption-active.tsx';
import { ColorField, Note, PRow, Sec, SecHead, Seg, ValueRow } from './inspector-controls.tsx';

type PaletteId = (typeof SEQUENCE_PALETTES)[number]['id'] | 'custom';

/** 画幅档的版面默认（内核 `LayoutTokens`：横 / 方 / 竖），属性页没有排版计划，按画布比例取。 */
function layoutTokens(canvas: { width: number; height: number }): { density: number; fit: number } {
  const ratio = canvas.width / Math.max(1, canvas.height);
  if (ratio > 1.2) return { density: 0.65, fit: 0.6 };
  if (ratio < 0.85) return { density: 0.55, fit: 0.66 };
  return { density: 0.6, fit: 0.62 };
}

const swatches = style({ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' });
const swatch = style({
  width: 24,
  height: 24,
  padding: 0,
  borderWidth: 0,
  borderRadius: 'full',
  cursor: { default: 'pointer', isDisabled: 'default' },
  outlineStyle: 'solid',
  outlineWidth: { default: 0, isOn: 2, isFocusVisible: 2 },
  outlineOffset: 2,
  outlineColor: { default: 'transparent', isOn: 'blue-800', isFocusVisible: 'focus-ring' },
});
const seedText = style({ font: 'ui-xs', color: 'gray-600' });

const samePalette = (a: SequencePalette, b: SequencePalette) =>
  a.primary.toUpperCase() === b.primary.toUpperCase() &&
  a.accent.toUpperCase() === b.accent.toUpperCase() &&
  a.secondary.toUpperCase() === b.secondary.toUpperCase() &&
  a.background.toUpperCase() === b.background.toUpperCase();

const pct = (value: number) => Math.round(value * 100);

/**
 * 字幕属性页「倒鸭子」（原型 panel-daoyazi.jsx，字幕样式模型设计 §6 / §9）：`layout.mode === 'sequence'` 时代替「当前词」
 * 与「动效」两段。整条轨的选项（预设、动感、配色、换一版、镜头与排版）落在 `wordAnimation.caption` 里；只写用户改过的
 * 镜头键（显式写出的会盖过预设档）。
 *
 * TODO（逐段操作）：只给当前动画段换一版（`seqSeeds`）、主角词、断段与固定行要按段落实例记录，Studio 样式还没有落点，
 * 先不出。
 */
export function CaptionSequenceSection(props: WordSectionProps & { canvas: { width: number; height: number } }) {
  const { isDisabled, onLive, onCommit, canvas } = props;
  const { body, edit } = useWordEdit(props);
  const ref = useSectionFocus();
  const o = normalizeSequence(body.layout.sequence ?? DEFAULT_SEQUENCE);
  const known = SEQUENCE_PALETTES.find((p) => samePalette(p.palette, o.palette))?.id;
  const [custom, setCustom] = useState(false);
  const paletteId: PaletteId = custom || !known ? 'custom' : known;
  const tokens = layoutTokens(canvas);
  const light = o.preset === 'light';
  const name = CAPTION_PRESETS.find((p) => p.id === 'daoyazi')?.name ?? '';

  const next = (change: (s: SequenceOptions) => SequenceOptions) =>
    edit((b) => ({ ...b, layout: { ...b.layout, mode: 'sequence', sequence: change(normalizeSequence(b.layout.sequence)) } }));
  const commit = (change: (s: SequenceOptions) => SequenceOptions) => onCommit(next(change));
  const live = (change: (s: SequenceOptions) => SequenceOptions) => onLive(next(change));
  const camera = (patch: Partial<SequenceOptions['camera']>) => (s: SequenceOptions) => ({ ...s, camera: { ...s.camera, ...patch } });
  const presentation = (patch: Partial<SequenceOptions['presentation']>) => (s: SequenceOptions) => ({
    ...s,
    presentation: { ...s.presentation, ...patch },
  });
  const history = (patch: Partial<SequenceOptions['presentation']['history']>) => (s: SequenceOptions) => ({
    ...s,
    presentation: { ...s.presentation, history: { ...s.presentation.history, ...patch } },
  });
  const palette = (patch: Partial<SequencePalette>) => (s: SequenceOptions) => ({ ...s, palette: { ...s.palette, ...patch } });
  const turned = cameraValue(o, 'maxTurnDeg') > 0;
  const colorRow = (key: keyof SequencePalette, label: string) => (
    <PRow key={key} label={label}>
      <ColorField
        label={label}
        value={o.palette[key]}
        fallback={DEFAULT_SEQUENCE.palette[key]}
        allowAlpha={false}
        isDisabled={isDisabled}
        onLive={(color) => live(palette({ [key]: color }))}
        onCommit={(color) => commit(palette({ [key]: color }))}
      />
    </PRow>
  );

  return (
    <>
      <div ref={ref}>
        <SecHead>{name}</SecHead>
      </div>
      <Sec>
        <PRow label={P.sequencePreset}>
          <Seg
            label={P.sequencePreset}
            value={o.preset}
            options={(['standard', 'light'] as const).map((key) => ({ key, label: P.sequencePresets[key] }))}
            isDisabled={isDisabled}
            // 换预设档时清掉显式的镜头键：写出来的会盖过预设档（内核 `from_value`）。
            onChange={(preset) =>
              commit((s) => ({
                ...s,
                preset,
                intensity: preset === 'light' ? Math.min(s.intensity, LIGHT_PRESET.intensityCap) : s.intensity,
                camera: { motion: s.camera.motion, ...(s.camera.fit !== undefined ? { fit: s.camera.fit } : {}) },
              }))
            }
          />
        </PRow>
        <ValueRow
          label={P.energy}
          value={light ? Math.min(o.intensity, LIGHT_PRESET.intensityCap) : o.intensity}
          min={0}
          max={light ? LIGHT_PRESET.intensityCap : 100}
          isDisabled={isDisabled}
          onLive={(intensity) => live((s) => ({ ...s, intensity }))}
          onCommit={(intensity) => commit((s) => ({ ...s, intensity }))}
        />
        <PRow label={P.palette}>
          <div className={swatches} role="group" aria-label={P.palette}>
            {SEQUENCE_PALETTES.map((p) => (
              <RACButton
                key={p.id}
                aria-label={P.palettes[p.id]}
                aria-pressed={paletteId === p.id}
                isDisabled={isDisabled}
                className={({ isFocusVisible, isDisabled: off }) => swatch({ isOn: paletteId === p.id, isFocusVisible, isDisabled: off })}
                // 配色色块画的是视频画面里的颜色，不随界面主题变。
                style={{
                  background: `linear-gradient(135deg, ${p.palette.accent} 0 50%, ${p.palette.secondary} 50% 100%)`,
                  boxShadow: `inset 0 0 0 3px ${p.palette.primary}`,
                }}
                onPress={() => {
                  setCustom(false);
                  commit((s) => ({ ...s, palette: p.palette }));
                }}
              />
            ))}
            <Button variant="secondary" size="S" isDisabled={isDisabled} onPress={() => setCustom(true)}>
              {P.palettes.custom}
            </Button>
          </div>
        </PRow>
        {paletteId === 'custom' ? (
          <>
            {colorRow('primary', P.primary)}
            {colorRow('accent', P.accent)}
            {colorRow('secondary', P.secondary)}
            {colorRow('background', P.backgroundColor)}
          </>
        ) : null}
        <PRow label={P.shuffle}>
          <Button variant="secondary" size="S" isDisabled={isDisabled} onPress={() => commit((s) => ({ ...s, seed: reseed(s.seed) }))}>
            {P.shuffle}
          </Button>
          <span className={seedText}>{P.seed(o.seed)}</span>
        </PRow>
        <PRow label={P.reveal}>
          <Switch size="S" isSelected={o.reveal === 'word'} isDisabled={isDisabled} onChange={(on) => commit((s) => ({ ...s, reveal: on ? 'word' : 'block' }))}>
            {o.reveal === 'word' ? P.revealOn : P.revealOff}
          </Switch>
        </PRow>
      </Sec>

      <SecHead>{P.camera}</SecHead>
      <Sec>
        <PRow label={P.turn}>
          <Seg
            label={P.turn}
            value={turned && !light ? 'turn' : 'none'}
            options={(['none', 'turn'] as const).map((key) => ({ key, label: P.turns[key] }))}
            isDisabled={isDisabled || light}
            onChange={(key) => commit(camera({ maxTurnDeg: key === 'none' ? 0 : 90 }))}
          />
        </PRow>
        {light ? <Note>{P.lightNote}</Note> : null}
        <PRow label={P.cameraMotion}>
          <Seg
            label={P.cameraMotion}
            value={o.camera.motion}
            options={(['smooth', 'stopAndGo'] as const).map((key) => ({ key, label: P.cameraMotions[key] }))}
            isDisabled={isDisabled}
            onChange={(motion) => commit(camera({ motion }))}
          />
        </PRow>
        <Note>{o.camera.motion === 'smooth' ? P.smoothNote : P.stopNote}</Note>
        <ValueRow
          label={P.speed}
          value={o.speed}
          min={0.5}
          max={2}
          step={0.1}
          digits={1}
          unit="×"
          isDisabled={isDisabled}
          onLive={(speed) => live((s) => ({ ...s, speed }))}
          onCommit={(speed) => commit((s) => ({ ...s, speed }))}
        />
        {o.camera.motion === 'smooth' ? (
          <ValueRow
            label={P.dwell}
            value={pct(cameraValue(o, 'dwell'))}
            min={0}
            max={60}
            step={5}
            unit="%"
            isDisabled={isDisabled}
            onLive={(v) => live(camera({ dwell: v / 100 }))}
            onCommit={(v) => commit(camera({ dwell: v / 100 }))}
          />
        ) : (
          <ValueRow
            label={P.anticipation}
            value={pct(cameraValue(o, 'anticipation'))}
            min={0}
            max={100}
            step={5}
            unit="%"
            isDisabled={isDisabled}
            onLive={(v) => live(camera({ anticipation: v / 100 }))}
            onCommit={(v) => commit(camera({ anticipation: v / 100 }))}
          />
        )}
        <ValueRow
          label={P.fit}
          value={pct(o.camera.fit ?? tokens.fit)}
          min={50}
          max={95}
          unit="%"
          isDisabled={isDisabled}
          onLive={(v) => live(camera({ fit: v / 100 }))}
          onCommit={(v) => commit(camera({ fit: v / 100 }))}
        />
        <ValueRow
          label={P.density}
          value={pct(o.layout.density ?? tokens.density)}
          min={30}
          max={100}
          step={5}
          unit="%"
          isDisabled={isDisabled}
          onLive={(v) => live((s) => ({ ...s, layout: { ...s.layout, density: v / 100 } }))}
          onCommit={(v) => commit((s) => ({ ...s, layout: { ...s.layout, density: v / 100 } }))}
        />
        <ValueRow
          label={P.history}
          value={o.presentation.history.maxBlocks}
          min={0}
          max={12}
          unit={P.rows}
          isDisabled={isDisabled}
          onLive={(maxBlocks) => live(history({ maxBlocks }))}
          onCommit={(maxBlocks) => commit(history({ maxBlocks }))}
        />
        <ValueRow
          label={P.historyOpacity}
          value={pct(o.presentation.history.opacity)}
          min={0}
          max={100}
          step={5}
          unit="%"
          isDisabled={isDisabled}
          onLive={(v) => live(history({ opacity: v / 100 }))}
          onCommit={(v) => commit(history({ opacity: v / 100 }))}
        />
        <PRow label={P.area}>
          <Seg
            label={P.area}
            value={o.presentation.viewportMode}
            options={(['center', 'bottom', 'full'] as const).map((key) => ({ key, label: P.areas[key] }))}
            isDisabled={isDisabled}
            onChange={(viewportMode) => commit(presentation({ viewportMode }))}
          />
        </PRow>
        <PRow label={P.backdrop}>
          <Seg
            label={P.backdrop}
            value={o.presentation.background}
            options={(['transparent', 'solid'] as const).map((key) => ({ key, label: P.backdrops[key] }))}
            isDisabled={isDisabled}
            onChange={(background) => commit(presentation({ background }))}
          />
        </PRow>
        {o.presentation.background === 'solid' ? (
          <>
            {paletteId === 'custom' ? null : colorRow('background', P.backgroundColor)}
            <Note>{P.solidNote}</Note>
          </>
        ) : null}
        <PRow label={P.ending}>
          <Seg
            label={P.ending}
            value={o.presentation.ending}
            options={(['hold', 'overviewIfRoom'] as const).map((key) => ({ key, label: P.endings[key] }))}
            isDisabled={isDisabled}
            onChange={(ending) => commit(presentation({ ending }))}
          />
        </PRow>
        <Note>{P.perSegment}</Note>
      </Sec>
    </>
  );
}
