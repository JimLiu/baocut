/** Dynamic subtitle DTOs. Rust caption-scene owns semantic validation and evaluation. */
export type CaptionValueType = 'scalar' | 'integer' | 'length' | 'time' | 'angle' | 'bool' | 'color';
export type CaptionUnit = 'cue' | 'page' | 'line' | 'word' | 'grapheme';
export type CaptionWordState = 'active' | 'read' | 'unread';
export type CaptionValue = number | boolean | string;
/** Parameter values: a list parameter (`list: true`, `caption-list-pick/1`) takes 1..256 elements of its type. */
export type CaptionParameterValue = CaptionValue | CaptionValue[];
/**
 * Bool paths requiring caption-speech-phase/1. Exactly one cue phase is true when word timing (or the explicit
 * estimated policy) exists; `estimated` marks estimated timing. `word.inSpan` is `start <= t < end` per bound word.
 * Unavailable before layout and in font sizing.
 */
export type CaptionSpeechPhaseReadPath =
  | 'cue.speechPhase.beforeFirst' | 'cue.speechPhase.reading' | 'cue.speechPhase.afterLast'
  | 'cue.speechPhase.estimated' | 'word.inSpan';
/**
 * Per cue and text node choice among fixed word line plans. `word-count`: every candidate but the last declares
 * disjoint inclusive minWords..maxWords and the last is the range-less fallback; `seed`: no ranges, hashed from the
 * instance seed and cue id. The choice is reported as CAPTION_PATTERN_SELECTED.
 */
export interface CaptionPatternSelect {
  by: 'word-count' | 'seed';
  candidates: {
    id: string; wordLinePattern: number[][];
    lastPageRule?: { ifRowCountIs: number; previousPageLines: number[] } | null;
    minWords?: number | null; maxWords?: number | null;
  }[];
}
/** Hard row (`line`) or page (`page`) boundaries around words carrying `tag` in presentation.wordTags. */
export interface CaptionIsolationRule { tag: string; mode: 'none' | 'line' | 'page' }
/** Post-layout paths requiring caption-glyph-envelope/1. Numeric paths are length; unit paths are bool. */
export type CaptionGlyphEnvelopeReadPath =
  | 'layout.lineEnvelopeY' | 'layout.lineEnvelopeHeight' | 'layout.firstInkLeft' | 'layout.lastInkRight'
  | 'unit.lineEnvelopeAvailable' | 'unit.rangeInkAvailable';
/** Only post-size label pose may read these fields; requires caption-bound-label/1. */
export type CaptionBoundLabelReadPath =
  | 'layout.labelWidth' | 'layout.labelHeight'
  | 'layout.labelMaxGlyphInkWidth' | 'layout.labelMaxGlyphInkHeight' | 'unit.labelInkAvailable';
/**
 * Built-in cubic-bezier(progress, x1, y1, x2, y2) accepts five scalars; x controls are in [0, 1].
 * Capability-gated scalar builtins: round (half away from zero), mod/fract (floored, divisor sign),
 * pow (negative base needs an integer exponent). `pick` takes `{ op: 'read', path: 'params.<list>' }`
 * and a scalar/integer index taken modulo the list length.
 */
export type CaptionExpression =
  | { op: 'literal'; type: CaptionValueType; value: CaptionValue }
  | { op: 'read'; path: string }
  | { op: 'call'; function: string; args: CaptionExpression[] }
  | { op: 'if'; condition: CaptionExpression; then: CaptionExpression; else: CaptionExpression };
export type CaptionClockTail = 'none' | 'clamp' | 'repeat';
export interface CaptionClock {
  unit: CaptionUnit;
  origin: 'start' | 'end';
  offset?: { ticks: number; timescale: number };
  stagger?: { ticks: number; timescale: number };
  repeat?: { iterations: number; mode: 'loop' | 'yoyo' } | null;
  /** Post-origin progress policy; omitted means `none`. Non-`none` requires `caption-clock-tail/1` and excludes `repeat`. */
  tail?: CaptionClockTail;
  duration: { kind: 'fixed'; ticks: number; timescale: number } | { kind: 'unit-span' };
}
export type CaptionDynamicValue =
  | { kind: 'constant'; value: CaptionValue }
  | { kind: 'expression'; expression: CaptionExpression }
  | { kind: 'keyframes'; clock: CaptionClock; keys: { at: number; value: CaptionValue }[];
      interpolation?: 'linear' | 'step' | 'ease-out-quad' | { 'cubic-bezier': { x1: number; y1: number; x2: number; y2: number } }; fill?: { before?: 'none' | 'hold'; after?: 'none' | 'hold' } };
export interface CaptionLength { value: number; parameter?: string | null; basis: 'absolute' | 'canvasWidth' | 'canvasHeight' | 'canvasShortEdge'; offset?: number }
export type CaptionFilter =
  | { kind: 'all' }
  | { kind: 'state'; value: CaptionWordState }
  | { kind: 'tag'; value: string }
  | { kind: 'range'; start: number; end: number }
  | { kind: 'parity'; odd: boolean }
  | { kind: 'and' | 'or'; filters: CaptionFilter[] }
  | { kind: 'not'; filter: CaptionFilter };
/** Exact registered font resource; requires `caption-font-source/1`. Missing resource/face rejects before shaping; uncovered glyphs retain script fallback. */
export interface CaptionFontSource {
  /** Lowercase 64-digit SHA-256 of the complete font binary. */
  sha256: string;
  /** Integer collection face index in 0..1023, default 0. */
  faceIndex?: number;
}
export type CaptionColorPaint =
  | { kind: 'solid'; color: string }
  | { kind: 'linear'; from: [number, number]; to: [number, number]; stops: { at: number; color: string }[];
      /** normalized needs `caption-gradient-space/1`; omitted/local preserves pixel projection. */
      space?: 'local' | 'normalized';
      /** page needs `caption-gradient-space/1`, glyph needs `caption-gradient-glyph/1`; labels use their own single-line bounds for line/page. */
      domain?: 'line' | 'page' | 'glyph';
      /** Glyph domain only: control-box growth per side in the glyph's resolved font size, 0..4, default 0. */
      glyphOutset?: number }
  | { kind: 'node-fill' };
export type CaptionScenePaint = CaptionColorPaint | {
  kind: 'image';
  /** Declared frozen PNG resource; Text/Label only and requires `caption-image-paint/1`. */
  resourceId: string;
  /** Explicit [a,b,c,d,e,f]: U=a*x+c*y+e, V=b*x+d*y+f. */
  uvTransform: [number, number, number, number, number, number];
  space: 'glyph-em' | 'glyph-normalized' | 'line-normalized' | 'page-normalized';
  wrap?: 'clamp' | 'repeat' | 'mirror';
  filter?: 'nearest' | 'bilinear';
  /** Default 1, affects sampled image before over onto base; one coverage follows composition. */
  opacity?: number;
  /** Default 1 in [0,1], scales image over base once; isolated effects apply it after blur. */
  compositeOpacity?: number;
  base?: CaptionColorPaint;
  /** Cluster's logical scalar start in the complete transformed cue; labels use their own text. */
  phase?: { period: number; source: 'cue-scalar-index';
    /** Float32 input conversion/addition/division/fract; needs `caption-image-phase-float32/1`. */
    arithmetic?: 'integer-modulo' | 'float32'; indexOffset?: number };
  /** Static U offset in [0,1], default 0, added after uvTransform and index phase. */
  phaseOffset?: number;
};
/** Shape fill: solid or linear only, with from/to normalized to the drawn shape rect. */
export type CaptionShapePaint =
  | { kind: 'solid'; color: string }
  | { kind: 'linear'; from: [number, number]; to: [number, number]; stops: { at: number; color: string }[] };
export interface CaptionSceneNode {
  id: string;
  type: 'group' | 'text' | 'label' | 'shape' | 'image' | 'repeat';
  resourceId?: string | null;
  fit?: 'contain' | 'cover' | 'stretch';
  zIndex?: number;
  children?: CaptionSceneNode[];
  selectorId?: string | null;
  /** Text may bind the cue. A label requires static one-line text and a direct Repeat parent. */
  text?: { source: 'cue' } | { source: 'static'; text: string } | null;
  style?: {
    fontFamily?: string; fontSize?: CaptionLength; fontWeight?: number; italic?: boolean;
    /** Text/Label only; exact resource overrides display fontFamily. Omission preserves named-family resolution. */
    fontSource?: CaptionFontSource;
    /** Text/Label outlines and atlas masks; none needs `caption-font-hinting/1`. Does not change shaping or advances. */
    fontHinting?: 'default' | 'none';
    /** Text/Label only; nominal cmap mapping requires `caption-font-shaping/1`, with no cross-scalar OpenType substitutions/kerning. */
    fontShaping?: 'advanced' | 'nominal';
    letterSpacing?: number; lineHeight?: number; fill?: string;
    /** Enclose actual glyph font metrics with optional em floors; needs `caption-font-line-box/1`. */
    lineBox?: { minAscent?: number; minDescent?: number; metricSource?: 'font' | 'typographic'; fallbackProbe?: string };
    /** Case mapping before layout; needs `caption-text-transform/1`. */
    textTransform?: 'none' | 'uppercase' | 'lowercase';
    stroke?: { width: number; color: string } | null;
    /** Ordered layers drawn across the whole node. unit/spread/blur/node-fill need `caption-paint-effects/1`. */
    paints?: { id: string; strokeWidth?: number; offset?: [number, number];
      unit?: 'px' | 'em'; spread?: number; blur?: number;
      /** clamp((coverage - lo)/(hi - lo), 0, 1), before opacity. Needs `caption-paint-coverage/1`. */
      coverage?: { lo: number; hi: number }; paint: CaptionScenePaint
    }[];
  };
  /** Shape-only; requires caption-shape-paint/1. Linear from/to are normalized to the drawn shape rect. */
  fillPaint?: CaptionShapePaint | null;
  stateStyles?: { unit?: 'word'; active?: { fill: string } | null; read?: { fill: string } | null; unread?: { fill: string } | null };
  /** Label-only fontSize is a length; its pose sees bound-unit geometry and post-size label metrics. */
  properties?: Record<string, CaptionDynamicValue>;
}
/** Explicit local texture rectangle, in canvas length units. */
export interface CaptionMaterialDomain {
  x: CaptionDynamicValue; y: CaptionDynamicValue;
  width: CaptionDynamicValue; height: CaptionDynamicValue;
}
export interface CaptionImageResource {
  id: string;
  assetRef: { id: string; revision: string };
  contentHash: string;
}
/** Every frame is a frozen dependency, even when the current sample selects another frame. */
export interface CaptionImageSequenceResource {
  id: string;
  frames: CaptionImageResource[];
  premultiply: 'rounded' | 'shifted-byte';
}
export type CaptionLayerSource =
  | { kind: 'nodes'; nodeIds: string[] }
  | { kind: 'image-sequence'; contextNodeId: string; sequenceId: string;
      frame: CaptionDynamicValue; domain: CaptionMaterialDomain;
      uvScale: [number, number]; uvOffset: [number, number] };
/** Ordered isolated surfaces composite directly into the actual scene target. */
export interface CaptionRenderLayer {
  id: string;
  source: CaptionLayerSource;
  materials?: CaptionMaterial[];
  /** 'add' needs caption-layer-add/1: per-component S + D on the real backdrop, clamped. */
  blend: 'source-over' | 'screen' | 'add';
}
export interface CaptionScene {
  schema: 'baocut.caption-scene/1';
  materials?: CaptionMaterial[];
  evaluationVersion: 1;
  requiredCapabilities?: string[];
  resources?: CaptionImageResource[];
  sequences?: CaptionImageSequenceResource[];
  renderLayers?: CaptionRenderLayer[];
  parameters?: { id: string; type: CaptionValueType; default: CaptionParameterValue; min?: number | null; max?: number | null;
    /** Element type is `type`; readable only through `pick`. Omitted means false. */
    list?: boolean }[];
  layout: {
    width: CaptionLength; x: CaptionLength; y: CaptionLength; maxLines?: number;
    layoutEvaluation?: 'static' | 'per-sample'; overflow?: 'error' | 'visible';
    /** Opt-in windows over real, ordered, nonoverlapping words and fixed logical lines. */
    pageWindow?: { gapThreshold: { ticks: number; timescale: number }; shortGap: { before: number; after: number };
      longGap: { before: number; after: number }; boundary: 'start-inclusive-end-exclusive' | 'first-start-inclusive-end-inclusive' } | null;
    bindings?: { nodeId?: string | null; property: 'width' | 'x' | 'y' | 'fontSize' | 'letterSpacing' | 'lineHeight'; value: CaptionDynamicValue }[];
    /** Ordered replacement sizes on frozen page/line/word membership; requires caption-unit-font-size/1. */
    fontSizeBindings?: { id: string; nodeId: string; selectorId: string; value: CaptionDynamicValue }[];
    fontStyleBindings?: { id: string; nodeId: string; selectorId: string; style: {
      fontFamily?: string; fontWeight?: number; italic?: boolean;
      /** Exact static face override; a source-only patch is valid, and a family-only patch uses named-family resolution. */
      fontSource?: CaptionFontSource;
    } }[];
    /** maxUnitsPerLine also ends width-wrapped lines at a word quota; requires caption-line-unit-quota/1. */
    pagination?: { unit?: 'word'; maxUnitsPerPage?: number | null; maxUnitsPerLine?: number | null;
      /** Cyclic fixed word counts per page, with width-wrapped lines; requires caption-word-page-layout/1. */
      wordPagePattern?: number[] | null; wordLinePattern?: number[][] | null;
      textLinePattern?: { unit: 'unicode-scalar' | 'grapheme' | 'scalar-cluster'; lines: number[][];
        clusterRules?: { attachments?: { next: [number, number][]; previous?: [number, number][] | null; headExcluded?: [number, number][] | null }[];
          consumeFollowingAfter?: [number, number][]; joiners?: number[] } | null } | null;
      lastPageRule?: { ifRowCountIs: number; previousPageLines: number[] } | null;
      /** A lone word on the last row of an incomplete final page joins the row before; requires caption-word-line-tail-join/1. */
      tailWordRule?: 'join-previous-line' | null;
      /** Entry i holds the rows of the page that starts while i + 1 words remain; the last entry covers larger counts.
       * Requires caption-remaining-word-page-plan/1. */
      remainingWordPagePlans?: number[][] | null;
      /** 'wrap' lets a fixed row wider than the layout width continue on further display lines;
       * row and page members stay frozen. Requires caption-fixed-line-wrap/1. */
      fixedLineOverflow?: 'wrap' | null;
      /** Scales every fixed row of a page to the widest row; a last row narrower than lastLineWidthRatio of it
       * grows by at most lastLineMaxScale, and rows add extraLineHeight over the page's largest scale.
       * Requires caption-fixed-line-fit/1. */
      fixedLineFit?: { lastLineWidthRatio: number; lastLineMaxScale: number; extraLineHeight: number } | null;
      /** One integer of 0..65535 per wordLinePattern page, read as unit.pageTag; page p reads entry p mod the
       * pattern length. Requires caption-page-tag/1. */
      pageTags?: number[] | null;
      /** caption-pattern-select/1; exclusive with wordLinePattern, textLinePattern, maxUnitsPerPage, lastPageRule
       * and the other word page and row plans above. */
      patternSelect?: CaptionPatternSelect | null;
      /** caption-keyword-isolation/1; fixed word line plans only, never with lastPageRule or the other word page and row plans above. */
      isolation?: CaptionIsolationRule[] };
    align?: 'left' | 'center' | 'right'; leadingGap?: 'show' | 'hide';
  };
  speechState?: { gapPolicy?: 'none' | 'hold-previous'; tailPolicy?: 'none' | 'hold-last'; timingPolicy?: 'require-word-timing' | 'estimated' };
  nodes: CaptionSceneNode[];
  selectors?: { id: string; nodeId: string; unit: CaptionUnit; includeWhitespace?: boolean; filter?: CaptionFilter }[];
  functions?: { id: string; arguments: { name: string; type: CaptionValueType }[]; returns: CaptionValueType; body: CaptionExpression }[];
  animations?: { id: string; target: { nodeId: string; selectorId?: string | null }; property: string;
    value: CaptionDynamicValue; composite: 'replace' | 'add' | 'multiply'; priority?: number }[];
}
export interface CaptionSceneStyleBody {
  schema: 'baocut.caption-scene-style/1';
  scene: { kind: 'inline'; value: CaptionScene };
  parameters?: Record<string, CaptionParameterValue>;
}
export interface CaptionPresentation {
  parameters?: Record<string, CaptionParameterValue>;
  cueOverrides?: { cueId: string; occurrenceId?: string | null; parameters: Record<string, CaptionParameterValue> }[];
  wordTags?: Record<string, string[]>;
  /** 16 hexadecimal digits; omitted values resolve to zero. */
  seed?: string;
}

/** Ordered cue-local materials. Feedback evaluates finite past samples of the preceding stack. */
export interface CaptionGaussianStage {
  scale: { num: number; den: number };
  samples: CaptionDynamicValue;
  stepUv: CaptionDynamicValue;
  sigmaUv: CaptionDynamicValue;
}
export type CaptionMaterial =
  | { kind: 'blur'; id: string; radius: CaptionDynamicValue; passes?: number }
  | { kind: 'wave-displace'; id: string; amplitude: CaptionDynamicValue; wavelength: CaptionDynamicValue; phase: CaptionDynamicValue; axis: 'x' | 'y'; contextNodeId?: string }
  | { kind: 'soft-band'; id: string; contextNodeId: string; axis: 'x' | 'y'; center: CaptionDynamicValue; halfWidth: CaptionDynamicValue; feather: CaptionDynamicValue; amount: CaptionDynamicValue; opacity: CaptionDynamicValue }
  | { kind: 'noise-palette-mix'; id: string; contextNodeId: string; paletteResourceId: string; palettePosition: CaptionDynamicValue; phase: CaptionDynamicValue; domain: { x: CaptionDynamicValue; y: CaptionDynamicValue; width: CaptionDynamicValue; height: CaptionDynamicValue } }
  /** caption-noise-displace/1: CPU raster only; the GPU material plan rejects it. */
  | { kind: 'noise-displace'; id: string; contextNodeId: string; domain: CaptionMaterialDomain; noiseScale: [number, number]; phase: CaptionDynamicValue; brightness: CaptionDynamicValue; contrast: CaptionDynamicValue; strength: CaptionDynamicValue }
  | { kind: 'angular-sample-blend'; id: string; contextNodeId: string; domain: { x: CaptionDynamicValue; y: CaptionDynamicValue; width: CaptionDynamicValue; height: CaptionDynamicValue }; aspect: CaptionDynamicValue; angle: CaptionDynamicValue }
  | { kind: 'affine-over'; id: string; contextNodeId: string; sampling: { input: CaptionMaterialDomain; output: CaptionMaterialDomain }; foreground: [CaptionDynamicValue, CaptionDynamicValue, CaptionDynamicValue, CaptionDynamicValue, CaptionDynamicValue, CaptionDynamicValue]; background: [CaptionDynamicValue, CaptionDynamicValue, CaptionDynamicValue, CaptionDynamicValue, CaptionDynamicValue, CaptionDynamicValue]; backgroundOpacity: CaptionDynamicValue; backgroundRgbScale: CaptionDynamicValue; boundary: 'replicate' | 'transparent' }
  | { kind: 'affine-sample-blend'; id: string; contextNodeId: string; sampling: { input: CaptionMaterialDomain; output: CaptionMaterialDomain }; transforms: [CaptionDynamicValue, CaptionDynamicValue, CaptionDynamicValue, CaptionDynamicValue, CaptionDynamicValue, CaptionDynamicValue][]; sampleRange: [number, number]; distanceRange: [number, number]; boundary: 'normalize' | 'replicate' | 'transparent' }
  | { kind: 'noisy-sweep'; id: string; contextNodeId: string; domain: CaptionMaterialDomain; position: CaptionDynamicValue; maskScale: [number, number]; reveal: boolean; uvY: 'up' | 'down' }
  | { kind: 'gradient-smear'; id: string; contextNodeId: string; domain: { x: CaptionDynamicValue; y: CaptionDynamicValue; width: CaptionDynamicValue; height: CaptionDynamicValue }; rectScale: [CaptionDynamicValue, CaptionDynamicValue]; evolution: CaptionDynamicValue; seed: CaptionDynamicValue; stretch: CaptionDynamicValue; progress: CaptionDynamicValue; strength: [CaptionDynamicValue, CaptionDynamicValue]; uvY: 'up' | 'down'; noise: { complexity: number; cycle: number; brightness: number; range: number; scale1: [number, number]; scale2: [number, number]; offset: [number, number]; rotation: number; subImpact: number; subScale: number; subRotation: number; subOffset: [number, number] } }
  | { kind: 'gaussian-uv'; id: string; contextNodeId: string; sampling: { input: CaptionMaterialDomain; output: CaptionMaterialDomain }; samples: CaptionDynamicValue; stepUv: [CaptionDynamicValue, CaptionDynamicValue]; sigmaUv: CaptionDynamicValue; rgbGain: CaptionDynamicValue; boundary: 'normalize' | 'replicate' | 'transparent' }
  | { kind: 'gaussian-axis'; id: string; contextNodeId: string; axis: 'x' | 'y'; samples: CaptionDynamicValue; stepUv: CaptionDynamicValue; sigmaUv: CaptionDynamicValue; gamma: number; boundary: 'normalize' | 'replicate' | 'transparent'; spacingRamp?: { domain: CaptionMaterialDomain; axis: 'x' | 'y'; start: CaptionDynamicValue; end: CaptionDynamicValue; reverse: boolean; evaluation: 'center' | 'previous-sample'; sampleOrder?: 'negative-first' | 'positive-first' }; sampling?: { input: CaptionMaterialDomain; output: CaptionMaterialDomain } }
  | { kind: 'glow-cascade'; id: string; contextNodeId: string; levels: { horizontal: CaptionGaussianStage; vertical: CaptionGaussianStage }[]; gamma: number; intensity: CaptionDynamicValue; originalOpacity: CaptionDynamicValue; glowTint?: CaptionDynamicValue; glowColorMatrix?: [number, number, number, number, number, number, number, number, number]; gammaChannels?: 'rgb' | 'rgba'; aggregation?: 'encoded' | 'linear'; levelGains?: number[]; levelColor?: CaptionDynamicValue; composite: 'screen' | 'source-over-glow' | 'original-over-screen' }
  /** composite 'mean' (caption-feedback-mean/1, decay 1) averages in-cue samples with equal weight; omitted keeps decaying source-over. */
  | { kind: 'feedback'; id: string; samples: number; step: { ticks: number; timescale: number }; decay: number; offset?: [number, number]; composite?: 'decay-over' | 'mean' };
