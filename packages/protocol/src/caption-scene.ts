/** Dynamic subtitle DTOs. Rust caption-scene owns semantic validation and evaluation. */
export type CaptionValueType = 'scalar' | 'integer' | 'length' | 'time' | 'angle' | 'bool' | 'color';
export type CaptionUnit = 'cue' | 'page' | 'line' | 'word' | 'grapheme';
export type CaptionWordState = 'active' | 'read' | 'unread';
export type CaptionValue = number | boolean | string;
/** Post-layout paths requiring caption-glyph-envelope/1. Numeric paths are length; unit paths are bool. */
export type CaptionGlyphEnvelopeReadPath =
  | 'layout.lineEnvelopeY' | 'layout.lineEnvelopeHeight' | 'layout.firstInkLeft' | 'layout.lastInkRight'
  | 'unit.lineEnvelopeAvailable' | 'unit.rangeInkAvailable';
/** Only post-size label pose may read these fields; requires caption-bound-label/1. */
export type CaptionBoundLabelReadPath =
  | 'layout.labelWidth' | 'layout.labelHeight'
  | 'layout.labelMaxGlyphInkWidth' | 'layout.labelMaxGlyphInkHeight' | 'unit.labelInkAvailable';
/** Built-in cubic-bezier(progress, x1, y1, x2, y2) accepts five scalars; x controls are in [0, 1]. */
export type CaptionExpression =
  | { op: 'literal'; type: CaptionValueType; value: CaptionValue }
  | { op: 'read'; path: string }
  | { op: 'call'; function: string; args: CaptionExpression[] }
  | { op: 'if'; condition: CaptionExpression; then: CaptionExpression; else: CaptionExpression };
export interface CaptionClock {
  unit: CaptionUnit;
  origin: 'start' | 'end';
  offset?: { ticks: number; timescale: number };
  stagger?: { ticks: number; timescale: number };
  repeat?: { iterations: number; mode: 'loop' | 'yoyo' } | null;
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
export type CaptionScenePaint =
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
    letterSpacing?: number; lineHeight?: number; fill?: string;
    stroke?: { width: number; color: string } | null;
    paints?: { id: string; strokeWidth?: number; offset?: [number, number]; paint: CaptionScenePaint }[];
  };
  /** Shape-only; requires caption-shape-paint/1. Linear from/to are normalized to the drawn shape rect. */
  fillPaint?: CaptionScenePaint | null;
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
  blend: 'source-over' | 'screen';
}
export interface CaptionScene {
  schema: 'baocut.caption-scene/1';
  materials?: CaptionMaterial[];
  evaluationVersion: 1;
  requiredCapabilities?: string[];
  resources?: CaptionImageResource[];
  sequences?: CaptionImageSequenceResource[];
  renderLayers?: CaptionRenderLayer[];
  parameters?: { id: string; type: CaptionValueType; default: CaptionValue; min?: number | null; max?: number | null }[];
  layout: {
    width: CaptionLength; x: CaptionLength; y: CaptionLength; maxLines?: number;
    layoutEvaluation?: 'static' | 'per-sample'; overflow?: 'error' | 'visible';
    /** Opt-in windows over real, ordered, nonoverlapping words and fixed logical lines. */
    pageWindow?: { gapThreshold: { ticks: number; timescale: number }; shortGap: { before: number; after: number };
      longGap: { before: number; after: number }; boundary: 'start-inclusive-end-exclusive' | 'first-start-inclusive-end-inclusive' } | null;
    bindings?: { nodeId?: string | null; property: 'width' | 'x' | 'y' | 'fontSize' | 'letterSpacing' | 'lineHeight'; value: CaptionDynamicValue }[];
    /** Ordered replacement sizes on frozen page/line/word membership; requires caption-unit-font-size/1. */
    fontSizeBindings?: { id: string; nodeId: string; selectorId: string; value: CaptionDynamicValue }[];
    fontStyleBindings?: { id: string; nodeId: string; selectorId: string; style: { fontFamily?: string; fontWeight?: number; italic?: boolean } }[];
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
      fixedLineOverflow?: 'wrap' | null };
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
  parameters?: Record<string, CaptionValue>;
}
export interface CaptionPresentation {
  parameters?: Record<string, CaptionValue>;
  cueOverrides?: { cueId: string; occurrenceId?: string | null; parameters: Record<string, CaptionValue> }[];
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
  | { kind: 'wave-displace'; id: string; amplitude: CaptionDynamicValue; wavelength: CaptionDynamicValue; phase: CaptionDynamicValue; axis: 'x' | 'y' }
  | { kind: 'soft-band'; id: string; contextNodeId: string; axis: 'x' | 'y'; center: CaptionDynamicValue; halfWidth: CaptionDynamicValue; feather: CaptionDynamicValue; amount: CaptionDynamicValue; opacity: CaptionDynamicValue }
  | { kind: 'noise-palette-mix'; id: string; contextNodeId: string; paletteResourceId: string; palettePosition: CaptionDynamicValue; phase: CaptionDynamicValue; domain: { x: CaptionDynamicValue; y: CaptionDynamicValue; width: CaptionDynamicValue; height: CaptionDynamicValue } }
  | { kind: 'angular-sample-blend'; id: string; contextNodeId: string; domain: { x: CaptionDynamicValue; y: CaptionDynamicValue; width: CaptionDynamicValue; height: CaptionDynamicValue }; aspect: CaptionDynamicValue; angle: CaptionDynamicValue }
  | { kind: 'noisy-sweep'; id: string; contextNodeId: string; domain: CaptionMaterialDomain; position: CaptionDynamicValue; maskScale: [number, number]; reveal: boolean; uvY: 'up' | 'down' }
  | { kind: 'gradient-smear'; id: string; contextNodeId: string; domain: { x: CaptionDynamicValue; y: CaptionDynamicValue; width: CaptionDynamicValue; height: CaptionDynamicValue }; rectScale: [CaptionDynamicValue, CaptionDynamicValue]; evolution: CaptionDynamicValue; seed: CaptionDynamicValue; stretch: CaptionDynamicValue; progress: CaptionDynamicValue; strength: [CaptionDynamicValue, CaptionDynamicValue]; uvY: 'up' | 'down'; noise: { complexity: number; cycle: number; brightness: number; range: number; scale1: [number, number]; scale2: [number, number]; offset: [number, number]; rotation: number; subImpact: number; subScale: number; subRotation: number; subOffset: [number, number] } }
  | { kind: 'gaussian-axis'; id: string; contextNodeId: string; axis: 'x' | 'y'; samples: CaptionDynamicValue; stepUv: CaptionDynamicValue; sigmaUv: CaptionDynamicValue; gamma: number; boundary: 'normalize' | 'replicate' | 'transparent' }
  | { kind: 'glow-cascade'; id: string; contextNodeId: string; levels: { horizontal: CaptionGaussianStage; vertical: CaptionGaussianStage }[]; gamma: number; intensity: CaptionDynamicValue; originalOpacity: CaptionDynamicValue; glowTint?: CaptionDynamicValue; glowColorMatrix?: [number, number, number, number, number, number, number, number, number]; composite: 'screen' | 'source-over-glow' }
  | { kind: 'feedback'; id: string; samples: number; step: { ticks: number; timescale: number }; decay: number; offset?: [number, number] };
