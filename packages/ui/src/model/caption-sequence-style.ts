import { asObject, isObject, num, type Json } from '../render/text-style.ts';
import { wordAnimationPayload } from './caption-word-animation.ts';

/**
 * 倒鸭子（`layout.mode = 'sequence'`，字幕样式模型设计 §6）的选项与它在 Studio 样式里的落点：
 * `wordAnimation.caption {schema 1, content 'orig', style {id 'caption-daoyazi', version 1}, palette, intensity, speed, seed,
 * options: [{kind: 'object', key: 'daoyazi', value: {preset, sequence, layout, camera, entrance, reveal, presentation}}]}`。
 *
 * 内核解析见 `crates/subtitle-render/src/caption_sequence.rs` 的 `CaptionSequenceOptions::from_value`：显式写出的镜头键
 * 盖过 `preset`（`light` 会把转向、提前量、停留改掉），所以 `dwell` / `anticipation` / `maxTurnDeg` / `fit` / `density`
 * 只在用户改过（正文里有值）时写。
 */

export const SEQUENCE_STYLE_ID = 'caption-daoyazi';

export interface SequencePalette {
  primary: string;
  accent: string;
  secondary: string;
  background: string;
}

export interface SequenceOptions {
  preset: 'standard' | 'light';
  /** 0–100。 */
  intensity: number;
  /** 0.35–2。 */
  speed: number;
  palette: SequencePalette;
  seed: number;
  reveal: 'block' | 'word';
  camera: { motion: 'smooth' | 'stopAndGo'; dwell?: number; anticipation?: number; maxTurnDeg?: number; fit?: number };
  layout: { density?: number; turnEvery: number };
  presentation: {
    viewportMode: 'center' | 'bottom' | 'full';
    background: 'transparent' | 'solid';
    history: { maxBlocks: number; opacity: number };
    ending: 'hold' | 'overviewIfRoom';
  };
  sequence: { maxDurationMs: number; maxBlocks: number; maxWords: number; pauseThresholdMs: number; breakOnSpeakerChange: boolean };
}

/** 内置配色四套（v2 原值；画进视频画面的内容色）。 */
export const SEQUENCE_PALETTES: readonly { id: 'classic' | 'neon' | 'paper' | 'ice'; palette: SequencePalette }[] = [
  { id: 'classic', palette: { primary: '#FFFFFF', accent: '#FF9B42', secondary: '#59BAF2', background: '#111214' } },
  { id: 'neon', palette: { primary: '#F4F4F4', accent: '#C6FF3D', secondary: '#FF4FD8', background: '#0B0B12' } },
  { id: 'paper', palette: { primary: '#F6EFE4', accent: '#FF6A3D', secondary: '#7FD1FF', background: '#2A211C' } },
  { id: 'ice', palette: { primary: '#E8F4FF', accent: '#4CC9FF', secondary: '#FFD166', background: '#0E1A26' } },
];

/** 轻动感的取值（内核 `preset: 'light'`）：不转向、提前量 0.3、停留 0.35、动感上限 40。 */
export const LIGHT_PRESET = { maxTurnDeg: 0, anticipation: 0.3, dwell: 0.35, intensityCap: 40 } as const;
/** 标准档的镜头默认值（内核 `CaptionSequenceOptions::default`）。 */
export const STANDARD_CAMERA = { maxTurnDeg: 90, anticipation: 0.5, dwell: 0.25 } as const;

export const DEFAULT_SEQUENCE: SequenceOptions = {
  preset: 'standard',
  intensity: 60,
  speed: 1,
  palette: SEQUENCE_PALETTES[0]!.palette,
  seed: 137,
  reveal: 'block',
  camera: { motion: 'smooth' },
  layout: { turnEvery: 2 },
  presentation: { viewportMode: 'center', background: 'transparent', history: { maxBlocks: 8, opacity: 1 }, ending: 'hold' },
  sequence: { maxDurationMs: 12000, maxBlocks: 16, maxWords: 48, pauseThresholdMs: 800, breakOnSpeakerChange: true },
};

/** 内核固定的几项（界面不出）：段间淡出、镜头单次运动的上下限与停走档时长、入场。 */
const FIXED = { fadeMs: 200, minTravelMs: 120, maxTravelMs: 1600, travelMs: 300, zoomLog: true, entrance: { durMs: 300, pre: 0.5 } };

/** 镜头某一项的有效值：正文里写了用它，没写按预设档。 */
export function cameraValue(options: SequenceOptions, key: 'dwell' | 'anticipation' | 'maxTurnDeg'): number {
  const own = options.camera[key];
  if (typeof own === 'number') return own;
  return options.preset === 'light' ? LIGHT_PRESET[key] : STANDARD_CAMERA[key];
}

/** 换一版：确定性地换一个种子（u32）。 */
export function reseed(seed: number): number {
  return (Math.imul((seed >>> 0) ^ 0x9e3779b9, 2654435761) >>> 0) % 1_000_000;
}

export function normalizeSequence(value: Partial<SequenceOptions> | null | undefined): SequenceOptions {
  const v = value ?? {};
  return {
    ...DEFAULT_SEQUENCE,
    ...v,
    palette: { ...DEFAULT_SEQUENCE.palette, ...v.palette },
    camera: { ...DEFAULT_SEQUENCE.camera, ...v.camera },
    layout: { ...DEFAULT_SEQUENCE.layout, ...v.layout },
    presentation: {
      ...DEFAULT_SEQUENCE.presentation,
      ...v.presentation,
      history: { ...DEFAULT_SEQUENCE.presentation.history, ...v.presentation?.history },
    },
    sequence: { ...DEFAULT_SEQUENCE.sequence, ...v.sequence },
    // 内核的取值域：动感 0–100、速度 0.35–2、种子非负整数。
    intensity: Math.min(100, Math.max(0, finite(v.intensity, DEFAULT_SEQUENCE.intensity))),
    speed: Math.min(2, Math.max(0.35, finite(v.speed, DEFAULT_SEQUENCE.speed))),
    seed: Math.max(0, Math.round(finite(v.seed, DEFAULT_SEQUENCE.seed))),
  };
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function defined(value: Json): Json {
  const out: Json = {};
  for (const [key, item] of Object.entries(value)) if (item !== undefined) out[key] = item;
  return out;
}

/** 倒鸭子 → Studio 的 `wordAnimation`（无逐词动画的载荷去掉 `catalogId` ＋ `caption`）。 */
export function sequenceWordAnimation(value: SequenceOptions): Json {
  const o = normalizeSequence(value);
  const solid = o.presentation.background === 'solid';
  const daoyazi: Json = {
    preset: o.preset,
    sequence: { ...o.sequence, fadeMs: FIXED.fadeMs },
    layout: defined({ turnEvery: o.layout.turnEvery, density: o.layout.density }),
    camera: defined({
      motion: o.camera.motion,
      dwell: o.camera.dwell,
      anticipation: o.camera.anticipation,
      maxTurnDeg: o.camera.maxTurnDeg,
      fit: o.camera.fit,
      minTravelMs: FIXED.minTravelMs,
      maxTravelMs: FIXED.maxTravelMs,
      travelMs: FIXED.travelMs,
      zoomLog: FIXED.zoomLog,
    }),
    entrance: { ...FIXED.entrance },
    reveal: o.reveal,
    presentation: defined({
      mode: solid ? 'stage' : 'overlay',
      viewportMode: o.presentation.viewportMode,
      background: solid ? o.palette.background : undefined,
      history: { ...o.presentation.history },
      ending: o.presentation.ending,
    }),
  };
  // 内核只认 `wordAnimation.caption`（`style.id` 以 caption- 开头即走设计字幕分支）；不写 `catalogId`，否则内核按它另设逐词底块。
  const { catalogId: _catalog, ...envelope } = wordAnimationPayload('none');
  return {
    ...envelope,
    caption: {
      schema: 1,
      content: 'orig',
      style: { id: SEQUENCE_STYLE_ID, version: 1 },
      palette: { primary: o.palette.primary, accent: o.palette.accent, secondary: o.palette.secondary },
      intensity: o.intensity,
      speed: o.speed,
      seed: o.seed,
      options: [{ kind: 'object', key: 'daoyazi', value: daoyazi }],
    },
  };
}

/** `wordAnimation.caption`（倒鸭子那一份）→ 选项（尽力；`sequenceWordAnimation` 的反向）。 */
export function parseSequence(caption: Json): SequenceOptions {
  const options = Array.isArray(caption.options) ? caption.options : [];
  const entry = options.find((o) => isObject(o) && o.key === 'daoyazi');
  const v = asObject(isObject(entry) ? entry.value : undefined);
  const palette = asObject(caption.palette);
  const camera = asObject(v.camera);
  const layout = asObject(v.layout);
  const presentation = asObject(v.presentation);
  const history = asObject(presentation.history);
  const sequence = asObject(v.sequence);
  const d = DEFAULT_SEQUENCE;
  const str = <const T extends string>(value: unknown, allowed: readonly T[], fallback: NoInfer<T>): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  const opt = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const solid = presentation.mode === 'stage';
  return normalizeSequence({
    preset: str(v.preset, ['standard', 'light'], 'standard'),
    intensity: num(caption.intensity, d.intensity),
    speed: num(caption.speed, d.speed),
    palette: {
      primary: typeof palette.primary === 'string' ? palette.primary : d.palette.primary,
      accent: typeof palette.accent === 'string' ? palette.accent : d.palette.accent,
      secondary: typeof palette.secondary === 'string' ? palette.secondary : d.palette.secondary,
      background: solid && typeof presentation.background === 'string' ? presentation.background : d.palette.background,
    },
    seed: num(caption.seed, d.seed),
    reveal: str(v.reveal, ['block', 'word'], d.reveal),
    camera: {
      motion: str(camera.motion, ['smooth', 'stopAndGo'], 'smooth'),
      dwell: opt(camera.dwell),
      anticipation: opt(camera.anticipation),
      maxTurnDeg: opt(camera.maxTurnDeg),
      fit: opt(camera.fit),
    },
    layout: { turnEvery: num(layout.turnEvery, d.layout.turnEvery), density: opt(layout.density) },
    presentation: {
      viewportMode: str(presentation.viewportMode, ['center', 'bottom', 'full'], 'center'),
      background: solid ? 'solid' : 'transparent',
      history: { maxBlocks: num(history.maxBlocks, d.presentation.history.maxBlocks), opacity: num(history.opacity, d.presentation.history.opacity) },
      ending: str(presentation.ending, ['hold', 'overviewIfRoom'], 'hold'),
    },
    sequence: {
      maxDurationMs: num(sequence.maxDurationMs, d.sequence.maxDurationMs),
      maxBlocks: num(sequence.maxBlocks, d.sequence.maxBlocks),
      maxWords: num(sequence.maxWords, d.sequence.maxWords),
      pauseThresholdMs: num(sequence.pauseThresholdMs, d.sequence.pauseThresholdMs),
      breakOnSpeakerChange: typeof sequence.breakOnSpeakerChange === 'boolean' ? sequence.breakOnSpeakerChange : d.sequence.breakOnSpeakerChange,
    },
  });
}
