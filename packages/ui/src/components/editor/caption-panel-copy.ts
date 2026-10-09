import { defineMessages } from '@baocut/protocol';
import type { ActiveMode, SpokenMode, UnspokenMode } from '../../model/caption-word-animation.ts';
import type { MotionStage, MotionTrigger, MotionUnit } from '../../model/caption-style-body.ts';
import { zhHans } from './caption-panel-copy.zh-Hans.ts';
import { zhHant } from './caption-panel-copy.zh-Hant.ts';
import { ja } from './caption-panel-copy.ja.ts';
import { ko } from './caption-panel-copy.ko.ts';
import { es } from './caption-panel-copy.es.ts';
import { fr } from './caption-panel-copy.fr.ts';
import { de } from './caption-panel-copy.de.ts';
import { nl } from './caption-panel-copy.nl.ts';
import { ptBR } from './caption-panel-copy.pt-BR.ts';
import { it } from './caption-panel-copy.it.ts';
import { ru } from './caption-panel-copy.ru.ts';
import { pl } from './caption-panel-copy.pl.ts';
import { tr } from './caption-panel-copy.tr.ts';
import { vi } from './caption-panel-copy.vi.ts';

type SequencePreset = 'standard' | 'light';
type PaletteId = 'classic' | 'neon' | 'paper' | 'ice' | 'custom';

/**
 * 字幕样式画廊的卡片角标与属性页「当前词」「动效」「倒鸭子」三段的文案（原型 panel-subactive.jsx、panel-submotion.jsx、
 * panel-daoyazi.jsx；字幕样式模型设计 §9）。译文在 `caption-panel-copy.zh-Hans.ts` 等。
 */
const en = {
  // 画廊
  modes: { none: 'None', color: 'Color', box: 'Box', scale: 'Scale', lift: 'Lift', underline: 'Underline', sweep: 'Sweep' } as Record<ActiveMode, string>,
  badgeSequence: 'Kinetic',
  badgeTip: (mode: string) => `Active word: ${mode}`,
  modified: 'Modified',
  revert: 'Revert',
  revertLabel: (name: string) => `Revert to “${name}”`,
  galleryHint: 'A card also sets the active word and motion; position, size and timing stay as they are.',

  // 当前词
  active: 'Active word',
  activeAria: 'How the active word looks',
  color: 'Color',
  boxColor: 'Box color',
  tintColor: 'Tint color',
  scale: 'Scale',
  times: '×',
  transition: 'Transition',
  spoken: 'Spoken words',
  spokenModes: { keep: 'Keep', tint: 'Tint', dim: 'Dim' } as Record<SpokenMode, string>,
  unspoken: 'Upcoming words',
  unspokenModes: { keep: 'Keep', dim: 'Dim', hidden: 'Hidden' } as Record<UnspokenMode, string>,
  sweepUnit: 'Sweep by',
  sweepUnits: { grapheme: 'Character', word: 'Word' } as Record<'grapheme' | 'word', string>,
  guide: 'Guide dot',
  guideNote: 'Draw a dot above the swept position',
  nextLine: 'Next line',
  nextLineNote: 'Show the next line smaller below',
  noWordTiming: 'Translation lines have no word timing, so the active word stays plain here.',

  // 动效
  motion: 'Motion',
  stages: { in: 'In', out: 'Out', loop: 'Loop' } as Record<MotionStage, string>,
  stageAria: (stage: string) => `${stage} motion`,
  noMotion: 'None',
  presets: {
    typewriter: 'Typewriter',
    'fade-up': 'Fade up',
    rise: 'Rise',
    cascade: 'Cascade',
    pop: 'Pop',
    'blur-in': 'Soft focus',
    'slide-mask': 'Slide',
    'wave-in': 'Wave in',
    'drop-in': 'Drop in',
    'float-in-top': 'Float from top',
    'float-in-bottom': 'Float from bottom',
    'scale-in': 'Scale in',
    impact: 'Impact',
    flip: 'Flip',
    stomp: 'Stomp',
    stack: 'Stack',
    'fade-down': 'Fade down',
    sink: 'Sink',
    'pop-out': 'Pop out',
    'blur-out': 'Blur out',
    'typewriter-erase': 'Erase',
    pulse: 'Pulse',
    wave: 'Wave',
    shimmer: 'Shimmer',
    swing: 'Swing',
  } as Record<string, string>,
  unit: 'Unit',
  units: { cue: 'Whole', line: 'Line', word: 'Word', grapheme: 'Character' } as Record<MotionUnit, string>,
  trigger: 'Trigger',
  triggers: { enter: 'On appear', spoken: 'When spoken' } as Record<MotionTrigger, string>,
  duration: 'Duration',
  intensity: 'Strength',
  catalogNote: 'This one is drawn word by word as each word is spoken; its trigger, unit and duration are fixed.',
  emptyStage: {
    in: 'The whole line appears at once.',
    out: 'The line disappears when it ends.',
    loop: 'The subtitle stays still while on screen.',
  } as Record<MotionStage, string>,

  // 倒鸭子
  sequencePreset: 'Preset',
  sequencePresets: { standard: 'Standard', light: 'Light' } as Record<SequencePreset, string>,
  energy: 'Energy',
  palette: 'Colors',
  palettes: { classic: 'Classic', neon: 'Neon', paper: 'Warm paper', ice: 'Ice', custom: 'Custom' } as Record<PaletteId, string>,
  primary: 'Text',
  accent: 'Accent',
  secondary: 'Second accent',
  backgroundColor: 'Background color',
  shuffle: 'Shuffle',
  seed: (seed: number) => `Seed ${seed}`,
  reveal: 'Word by word',
  revealOn: 'Words pop in one at a time',
  revealOff: 'Each block appears at once',
  camera: 'Camera & layout',
  turn: 'Rotation',
  turns: { none: 'None', turn: 'Right angles' } as Record<'none' | 'turn', string>,
  lightNote: 'Light keeps the camera level, lingers longer and caps energy at 40.',
  cameraMotion: 'Camera motion',
  cameraMotions: { smooth: 'Smooth', stopAndGo: 'Stop and go' } as Record<'smooth' | 'stopAndGo', string>,
  smoothNote: 'The camera keeps gliding between lines and arrives just as the next one starts.',
  stopNote: 'The camera holds on the current line and moves just before the next one starts.',
  speed: 'Camera speed',
  dwell: 'Camera dwell',
  anticipation: 'Lead time',
  fit: 'Text fill',
  density: 'Text density',
  history: 'Earlier lines',
  rows: 'lines',
  historyOpacity: 'Earlier lines opacity',
  area: 'Caption area',
  areas: { center: 'Center', bottom: 'Bottom', full: 'Full frame' } as Record<'center' | 'bottom' | 'full', string>,
  backdrop: 'Background',
  backdrops: { transparent: 'Transparent', solid: 'Solid' } as Record<'transparent' | 'solid', string>,
  solidNote: 'A solid background only covers the picture inside the caption area; footage and sound are untouched.',
  ending: 'Segment end',
  endings: { hold: 'Hold', overviewIfRoom: 'Zoom out if room' } as Record<'hold' | 'overviewIfRoom', string>,
  perSegment: 'Shuffling one segment, hero words, segment breaks and pinned lines are not in the editor yet.',
};

export type CaptionPanelMessages = typeof en;
export const CAPTION_PANEL_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
