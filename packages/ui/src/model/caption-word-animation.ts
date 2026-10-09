import { asObject, isObject, type Json } from '../render/text-style.ts';

/**
 * 当前词（`activeWord`）与逐词动画目录（Studio 样式的 `wordAnimation`）之间的查表（字幕样式模型设计 §4）。
 *
 * 内核的目录（`crates/subtitle-render/src/word_animation_catalog.rs`）不变：19 格，每格一个 `catalogId` 与一个内核分支名。
 * 这里镜像它的 `word_animation_payload`，再把当前词的颜色、底块、上抬与「念过 / 没念到」两根小轴写成三态覆盖
 * （`spoken` / `active` / `unspoken`，内核按 `merge_visual` 叠在分支默认值上）。目录没有的组合（比如变色 + 没念到的变淡）
 * 也能写：分支给底子，三态覆盖补差。
 */

export type ActiveMode = 'none' | 'color' | 'box' | 'scale' | 'lift' | 'underline' | 'sweep';
export type SpokenMode = 'keep' | 'tint' | 'dim';
export type UnspokenMode = 'keep' | 'dim' | 'hidden';

export interface Sweep {
  unit: 'grapheme' | 'word';
  guide: boolean;
  nextLine: boolean;
}

export interface ActiveWord {
  mode: ActiveMode;
  /** color / underline / sweep / lift 的目标色；box 的字色。 */
  color?: string;
  /** 当前词放大倍数（1 = 不放大）。 */
  scale?: number;
  box?: { color: string; radius: number; padding: [number, number] };
  lift?: number;
  sweep?: Sweep;
  durationSeconds?: number;
  spoken: SpokenMode;
  unspoken: UnspokenMode;
  spokenColor?: string;
  dimOpacity?: number;
  /** 目录里 `rotate*` 那几格的「随机旋转位」（往返查表用）。 */
  tilt?: boolean;
}

export const ACTIVE_MODES: readonly ActiveMode[] = ['none', 'color', 'box', 'scale', 'lift', 'underline', 'sweep'];
export const SPOKEN_MODES: readonly SpokenMode[] = ['keep', 'tint', 'dim'];
export const UNSPOKEN_MODES: readonly UnspokenMode[] = ['keep', 'dim', 'hidden'];

export const ACTIVE_DURATION = 0.16;
export const DIM_OPACITY = 0.5;

/** 补齐默认值：读的人不必每次判空。扫色本身就是染过（§5），与 `spoken: 'tint'` 互斥。 */
export function normalizeActive(aw: Partial<ActiveWord> | null | undefined): ActiveWord {
  const out: ActiveWord = { spoken: 'keep', unspoken: 'keep', durationSeconds: ACTIVE_DURATION, dimOpacity: DIM_OPACITY, ...aw, mode: aw?.mode ?? 'none' };
  if (!ACTIVE_MODES.includes(out.mode)) out.mode = 'none';
  if (!SPOKEN_MODES.includes(out.spoken)) out.spoken = 'keep';
  if (!UNSPOKEN_MODES.includes(out.unspoken)) out.unspoken = 'keep';
  if (out.mode === 'sweep') {
    out.sweep = { unit: 'grapheme', guide: false, nextLine: false, ...out.sweep };
    if (out.spoken === 'tint') out.spoken = 'keep';
  }
  return out;
}

/* ---------- 内核目录（word_animation_catalog.rs 的镜像） ---------- */

/** 目录 id → 内核分支名（同序）。 */
export const WORD_ANIMATIONS: readonly (readonly [string, string])[] = [
  ['none', 'None'],
  ['boxHighlight', 'Highlight'],
  ['flipClock', 'flipClock'],
  ['highlight', 'Highlighter'],
  ['karaoke', 'Karaoke'],
  ['impact', 'impact'],
  ['reveal', 'Reveal'],
  ['floatInTop', 'floatInTop'],
  ['floatInBottom', 'floatInBottom'],
  ['scaleIn', 'scaleIn'],
  ['dropIn', 'dropIn'],
  ['impactPop', 'impactPop'],
  ['colourHighlight', 'Color'],
  ['rotateFlipClock', 'rotateFlipClock'],
  ['rotateHighlight', 'rotateHighlight'],
  ['stack', 'stack'],
  ['stomp', 'stomp'],
  ['bounce', 'Bounce'],
  ['paint', 'Paint'],
];

const kernelOf = (catalogId: string): string => WORD_ANIMATIONS.find(([id]) => id === catalogId)?.[1] ?? catalogId;
const catalogOf = (name: string): string => WORD_ANIMATIONS.find(([id, kernel]) => id === name || kernel === name)?.[0] ?? name;

/** 选中一格时写进样式根的载荷（`word_animation_payload`）。 */
export function wordAnimationPayload(name: string): Json {
  const catalogId = catalogOf(name);
  const kernel = kernelOf(catalogId);
  const spoken: Json = {};
  const active: Json = {};
  const unspoken: Json = {};
  if (kernel === 'Color') active.color = '#FFD43B';
  else if (kernel === 'Highlight') Object.assign(active, { backgroundColor: '#FFD43B', color: '#0D0D0D', borderRadiusEm: 0.25 });
  else if (kernel === 'Bounce') active.bottomEm = 0.22;
  else if (kernel === 'Paint') Object.assign(spoken, { color: '#FFD43B', underline: true, underlineOffsetEm: 0.18 });
  else if (kernel === 'Reveal') Object.assign(unspoken, { color: 'transparent', shadowOff: true, underline: false, opacity: 0 });
  else if (kernel === 'Karaoke') {
    spoken.opacity = 1;
    active.opacity = 1;
    unspoken.opacity = 0.5;
  } else if (kernel === 'Highlighter') {
    spoken.opacity = 0.5;
    active.opacity = 1;
    unspoken.opacity = 0.5;
  }
  if (catalogId === 'boxHighlight')
    Object.assign(active, {
      backgroundColor: '#FFD43B',
      color: '#0D0D0D',
      borderRadiusEm: 0.5,
      boxScale: [
        [0, 0.9],
        [0.7, 1.1],
        [1, 1],
      ],
      boxOpacity: [
        [0, 0.75],
        [0.7, 1],
        [1, 1],
      ],
      boxEasing: 'sinInOut',
    });
  return { animationId: kernel === 'None' ? 'none' : 'magic-wbw', animationName: kernel, catalogId, spoken, active, unspoken };
}

/* ---------- 19 格 ↔ activeWord + 念到时的入场（§4 那张表） ---------- */

/** 念到时入场（`trigger: 'spoken'`）的动效名，内核由目录格的连续轨画。 */
export const SPOKEN_PRESETS = ['drop-in', 'float-in-top', 'float-in-bottom', 'scale-in', 'impact', 'flip', 'stomp', 'stack'] as const;
export type SpokenPreset = (typeof SPOKEN_PRESETS)[number];

interface Cell {
  aw: Partial<ActiveWord>;
  in?: SpokenPreset;
  intensity?: number;
  tilt?: boolean;
  radius?: number;
}

export const CELLS: Record<string, Cell> = {
  none: { aw: { mode: 'none' } },
  colourHighlight: { aw: { mode: 'color' } },
  boxHighlight: { aw: { mode: 'box' }, radius: 0.5 },
  stack: { aw: { mode: 'box' }, radius: 0.2, in: 'stack' },
  highlight: { aw: { mode: 'none', spoken: 'dim', unspoken: 'dim' } },
  karaoke: { aw: { mode: 'none', unspoken: 'dim' } },
  reveal: { aw: { mode: 'none', unspoken: 'hidden' } },
  bounce: { aw: { mode: 'lift', lift: 0.22 } },
  paint: { aw: { mode: 'none', spoken: 'tint' } },
  dropIn: { aw: { mode: 'color' }, in: 'drop-in' },
  floatInTop: { aw: { mode: 'color' }, in: 'float-in-top' },
  floatInBottom: { aw: { mode: 'color' }, in: 'float-in-bottom' },
  scaleIn: { aw: { mode: 'color' }, in: 'scale-in' },
  impact: { aw: { mode: 'color' }, in: 'impact' },
  impactPop: { aw: { mode: 'color' }, in: 'impact', intensity: 1.3 },
  stomp: { aw: { mode: 'color' }, in: 'stomp' },
  flipClock: { aw: { mode: 'color' }, in: 'flip' },
  rotateFlipClock: { aw: { mode: 'color' }, in: 'flip', tilt: true },
  rotateHighlight: { aw: { mode: 'color', tilt: true } },
};
export const CELL_KEYS = Object.keys(CELLS);

/** 念到时入场的那一段（只看决定格子的几位）。 */
export interface SpokenEntrance {
  preset: string;
  intensity?: number;
  tilt?: boolean;
}

const SPOKEN_CELL: Record<string, string> = {
  'drop-in': 'dropIn',
  'float-in-top': 'floatInTop',
  'float-in-bottom': 'floatInBottom',
  'scale-in': 'scaleIn',
  stomp: 'stomp',
  stack: 'stack',
};

/** activeWord + 念到时的入场 → 最近的目录格；目录没有这个组合时是 null（`wordAnimationOf` 另拼）。 */
export function toCell(activeWord: Partial<ActiveWord>, entrance: SpokenEntrance | null): string | null {
  const aw = normalizeActive(activeWord);
  const plain = aw.spoken === 'keep' && aw.unspoken === 'keep';
  if (entrance) {
    if (entrance.preset === 'stack') return aw.mode === 'box' && plain ? 'stack' : null;
    if (!plain || (aw.mode !== 'color' && aw.mode !== 'none')) return null;
    if (entrance.preset === 'impact') return (entrance.intensity ?? 1) >= 1.2 ? 'impactPop' : 'impact';
    if (entrance.preset === 'flip') return entrance.tilt ? 'rotateFlipClock' : 'flipClock';
    return SPOKEN_CELL[entrance.preset] ?? null;
  }
  if (aw.mode === 'none') {
    const key = `${aw.spoken}/${aw.unspoken}`;
    return ({ 'keep/keep': 'none', 'dim/dim': 'highlight', 'keep/dim': 'karaoke', 'keep/hidden': 'reveal', 'tint/keep': 'paint' } as Record<string, string>)[key] ?? null;
  }
  if (!plain) return null;
  if (aw.mode === 'color') return aw.tilt ? 'rotateHighlight' : 'colourHighlight';
  if (aw.mode === 'box') return 'boxHighlight';
  if (aw.mode === 'lift') return 'bounce';
  return null;
}

/** 一格目录 → activeWord ＋ 念到时的入场（不含颜色；颜色由三态覆盖给）。 */
export function fromCell(cell: string): { activeWord: ActiveWord; entrance: SpokenEntrance | null } {
  const row = CELLS[cell === 'bgHighlight' ? 'stack' : cell] ?? CELLS.none!;
  const aw = normalizeActive(row.aw);
  if (aw.mode === 'box') aw.box = { color: '#FFD43B', radius: row.radius ?? 0.5, padding: [0.2, 0.08] };
  const entrance = row.in ? { preset: row.in, ...(row.intensity ? { intensity: row.intensity } : {}), ...(row.tilt ? { tilt: true } : {}) } : null;
  return { activeWord: aw, entrance };
}

/** 底子格：目录没有这个组合时，按当前词模式（念到时的入场优先）挑一格，再用三态覆盖补差。 */
function baseCell(aw: ActiveWord, entrance: SpokenEntrance | null): string {
  if (entrance) {
    if (entrance.preset === 'impact') return (entrance.intensity ?? 1) >= 1.2 ? 'impactPop' : 'impact';
    if (entrance.preset === 'flip') return entrance.tilt ? 'rotateFlipClock' : 'flipClock';
    if (SPOKEN_CELL[entrance.preset]) return SPOKEN_CELL[entrance.preset]!;
  }
  if (aw.mode === 'color' || aw.mode === 'underline') return aw.tilt ? 'rotateHighlight' : 'colourHighlight';
  if (aw.mode === 'box') return 'boxHighlight';
  if (aw.mode === 'lift') return 'bounce';
  return 'none';
}

const LIFT = 0.22;
const UNDERLINE_OFFSET = 0.18;
const PAINT_COLOR = '#FFD43B';

/** 当前词 ＋ 念到时的入场 → Studio 的 `wordAnimation`（目录格 ＋ 三态覆盖）。 */
export function wordAnimationOf(activeWord: Partial<ActiveWord>, entrance: SpokenEntrance | null): Json {
  const aw = normalizeActive(activeWord);
  const cell = toCell(aw, entrance) ?? baseCell(aw, entrance);
  const payload = wordAnimationPayload(cell);
  const spoken = asObject(payload.spoken);
  const active = asObject(payload.active);
  const unspoken = asObject(payload.unspoken);
  if (aw.mode === 'color' || aw.mode === 'lift' || aw.mode === 'underline') {
    if (aw.color) active.color = aw.color;
  }
  if (aw.mode === 'box' && aw.box) {
    active.backgroundColor = aw.box.color;
    active.borderRadiusEm = aw.box.radius;
    if (aw.color) active.color = aw.color;
  }
  if (aw.mode === 'lift') active.bottomEm = aw.lift ?? LIFT;
  if (aw.mode === 'underline') {
    active.underline = true;
    active.underlineOffsetEm = UNDERLINE_OFFSET;
  }
  const dim = aw.dimOpacity ?? DIM_OPACITY;
  if (aw.spoken === 'tint') Object.assign(spoken, { color: aw.spokenColor ?? aw.color ?? PAINT_COLOR, underline: true, underlineOffsetEm: UNDERLINE_OFFSET });
  else if (aw.spoken === 'dim') {
    spoken.opacity = dim;
    active.opacity = 1;
  }
  if (aw.unspoken === 'dim') {
    unspoken.opacity = dim;
    active.opacity = 1;
  } else if (aw.unspoken === 'hidden') Object.assign(unspoken, { color: 'transparent', shadowOff: true, underline: false, opacity: 0 });
  return { ...payload, spoken, active, unspoken };
}

/**
 * Studio 的 `wordAnimation`（或旧键 `anim`）→ 当前词 ＋ 念到时的入场（尽力；`wordAnimationOf` 的反向）。
 * 都没有时照内核：`Color`，当前词色取 `karaokeColor`，再退回 `#8CAAFF`。
 */
export function parseWordAnimation(root: Json): { activeWord: ActiveWord; entrance: SpokenEntrance | null } {
  const value = root.wordAnimation ?? root.anim;
  if (value === undefined || value === null) {
    const color = typeof root.karaokeColor === 'string' ? root.karaokeColor : '#8CAAFF';
    return { activeWord: normalizeActive({ mode: 'color', color }), entrance: null };
  }
  const anim = asObject(value);
  const name = typeof anim.animationName === 'string' ? anim.animationName : typeof anim.name === 'string' ? anim.name : 'None';
  const cell = typeof anim.catalogId === 'string' && CELLS[anim.catalogId] ? anim.catalogId : catalogOf(name);
  const { activeWord: aw, entrance } = fromCell(CELLS[cell] ? cell : 'none');
  const payload = wordAnimationPayload(cell);
  const spoken = { ...asObject(payload.spoken), ...asObject(anim.spoken) };
  const active = { ...asObject(payload.active), ...asObject(anim.active) };
  const unspoken = { ...asObject(payload.unspoken), ...asObject(anim.unspoken) };
  if (!CELLS[cell] && name === 'Highlight') aw.mode = 'box';
  if (typeof active.color === 'string' && aw.mode !== 'none') aw.color = active.color;
  if (aw.mode === 'box') {
    aw.box = {
      color: typeof active.backgroundColor === 'string' ? active.backgroundColor : '#FFD43B',
      radius: typeof active.borderRadiusEm === 'number' ? active.borderRadiusEm : (aw.box?.radius ?? 0.5),
      padding: aw.box?.padding ?? [0.2, 0.08],
    };
  }
  if (aw.mode === 'lift' && typeof active.bottomEm === 'number') aw.lift = active.bottomEm;
  if (aw.mode === 'color' && active.underline === true) aw.mode = 'underline';
  if (aw.mode === 'none' && typeof active.color === 'string') {
    // 没有底子分支、只有覆盖色的（念到时入场那几格不带颜色时是 none）：当成变色。
    aw.mode = 'color';
    aw.color = active.color;
  }
  if (spoken.underline === true || (typeof spoken.color === 'string' && spoken.color !== 'transparent')) {
    aw.spoken = 'tint';
    if (typeof spoken.color === 'string') aw.spokenColor = spoken.color;
  } else if (typeof spoken.opacity === 'number' && spoken.opacity < 1) {
    aw.spoken = 'dim';
    aw.dimOpacity = spoken.opacity;
  } else aw.spoken = 'keep';
  if (unspoken.opacity === 0 || unspoken.color === 'transparent') aw.unspoken = 'hidden';
  else if (typeof unspoken.opacity === 'number' && unspoken.opacity < 1) {
    aw.unspoken = 'dim';
    aw.dimOpacity = unspoken.opacity;
  } else aw.unspoken = 'keep';
  if (aw.spoken === 'tint' && aw.spokenColor && aw.spokenColor === aw.color) delete aw.spokenColor;
  return { activeWord: normalizeActive(aw), entrance };
}

/** `wordAnimation` 带不带倒鸭子这类设计字幕的 `caption`。 */
export function designedCaptionOf(root: Json): Json | null {
  const caption = asObject(root.wordAnimation).caption;
  if (!isObject(caption)) return null;
  const id = asObject(caption.style).id;
  return typeof id === 'string' && id.startsWith('caption-') ? caption : null;
}

/** 底块上的字用黑还是白（按底块亮度）。 */
export function inkOn(color: string): string {
  const hex = /^#([0-9a-f]{6})/i.exec(color)?.[1];
  if (!hex) return '#FFFFFF';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#111111' : '#FFFFFF';
}

/**
 * 换到某个当前词模式：补齐那个模式必需的参数（原型 panel-subactive.jsx `modeDefaults`），颜色取这一行现有的当前词色，
 * 退回 `fallback`（文字色）。念过 / 没念到两根小轴与过渡照旧。
 */
export function activeForMode(mode: ActiveMode, activeWord: Partial<ActiveWord>, fallback: string): ActiveWord {
  const a = normalizeActive(activeWord);
  const color = a.color ?? a.box?.color ?? fallback;
  const keep = { spoken: a.spoken, unspoken: a.unspoken, durationSeconds: a.durationSeconds, dimOpacity: a.dimOpacity, spokenColor: a.spokenColor };
  if (mode === 'box') {
    const box = a.box ?? { color, radius: 0.2, padding: [0.2, 0.08] as [number, number] };
    return normalizeActive({ ...keep, mode, box, color: inkOn(box.color) });
  }
  if (mode === 'lift') return normalizeActive({ ...keep, mode, color, lift: a.lift ?? LIFT });
  if (mode === 'scale') return normalizeActive({ ...keep, mode, color, scale: a.scale && a.scale > 1 ? a.scale : 1.15 });
  if (mode === 'sweep') return normalizeActive({ ...keep, mode, color, sweep: a.sweep ?? { unit: 'grapheme', guide: false, nextLine: false } });
  if (mode === 'none') return normalizeActive({ ...keep, mode });
  return normalizeActive({ ...keep, mode, color, ...(a.scale !== undefined ? { scale: a.scale } : {}) });
}
