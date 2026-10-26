import { expect, expectTypeOf, test } from 'vitest';
import type {
  CaptionClock, CaptionClockTail, CaptionExpression, CaptionIsolationRule, CaptionTagRuns, CaptionPatternSelect, CaptionImageSequenceResource, CaptionLayerSource, CaptionMaterial,
  CaptionParameterValue, CaptionPresentation, CaptionRenderLayer, CaptionScene, CaptionSceneNode, CaptionSceneStyleBody, CaptionSceneSummary,
  CaptionSpeechPhaseReadPath, CaptionWordState,
  CaptionPaintMask, CaptionPaintLayer,
  CaptionGlyphDistanceBand, CaptionGlyphDistanceCoverage, CaptionGlyphDistanceAa,
} from './caption-scene.ts';

const domain = {
  x: { kind: 'constant', value: 0 }, y: { kind: 'constant', value: 0 },
  width: { kind: 'constant', value: 160 }, height: { kind: 'constant', value: 90 },
} as const;
const fixture = {
  schema: 'baocut.caption-scene-style/1',
  scene: { kind: 'inline', value: {
    schema: 'baocut.caption-scene/1', evaluationVersion: 1,
    requiredCapabilities: ['caption-render-layers/1', 'caption-image-sequence/1', 'caption-noisy-sweep/1'],
    layout: {
      width: { value: 140, basis: 'absolute' }, x: { value: 80, basis: 'absolute' }, y: { value: 45, basis: 'absolute' },
    },
    nodes: [{ id: 'text', type: 'text' }],
    sequences: [{ id: 'frames', premultiply: 'shifted-byte', frames: [
      { id: 'frame0', assetRef: { id: 'image', revision: 'frozen' }, contentHash: `sha256:${'a'.repeat(64)}` },
    ] }],
    renderLayers: [
      { id: 'body', source: { kind: 'nodes', nodeIds: ['text'] }, blend: 'source-over', materials: [
        { kind: 'noisy-sweep', id: 'edge', contextNodeId: 'text', domain,
          position: { kind: 'expression', expression: { op: 'read', path: 'time.progress' } },
          maskScale: [1.3125, 1.3125], reveal: false, uvY: 'up' },
      ] },
      { id: 'spark', source: { kind: 'image-sequence', contextNodeId: 'text', sequenceId: 'frames',
        frame: { kind: 'constant', value: 0 }, domain, uvScale: [0.75, 0.75], uvOffset: [0.12, -0.06] }, blend: 'screen' },
    ],
  } },
} satisfies CaptionSceneStyleBody;

test('isolated layer and sequence DTOs retain the Rust JSON field names', () => {
  const serialized = JSON.parse(JSON.stringify(fixture)) as typeof fixture;
  expect(serialized.scene.value.sequences[0]?.premultiply).toBe('shifted-byte');
  expect(serialized.scene.value.sequences[0]?.frames[0]?.assetRef).toEqual({ id: 'image', revision: 'frozen' });
  expect(serialized.scene.value.renderLayers.map(layer => layer.blend)).toEqual(['source-over', 'screen']);
  expect(serialized.scene.value.renderLayers[1]?.source).toMatchObject({
    kind: 'image-sequence', contextNodeId: 'text', sequenceId: 'frames', uvScale: [0.75, 0.75], uvOffset: [0.12, -0.06],
  });
});

test('layer sources, premultiplication and the binary reveal policy are explicit types', () => {
  expectTypeOf<CaptionImageSequenceResource['premultiply']>().toEqualTypeOf<'rounded' | 'shifted-byte'>();
  expectTypeOf<CaptionLayerSource['kind']>().toEqualTypeOf<'nodes' | 'image-sequence'>();
  expectTypeOf<CaptionRenderLayer['blend']>().toEqualTypeOf<'source-over' | 'screen' | 'add'>();
  type Sweep = Extract<CaptionMaterial, { kind: 'noisy-sweep' }>;
  expectTypeOf<Sweep['maskScale']>().toEqualTypeOf<[number, number]>();
  expectTypeOf<Sweep['reveal']>().toEqualTypeOf<boolean>();
  expectTypeOf<Sweep['uvY']>().toEqualTypeOf<'up' | 'down'>();
});

test('word page quotas keep the strict wire field name and optional legacy shape', () => {
  type Pagination = NonNullable<CaptionScene['layout']['pagination']>;
  expectTypeOf<Pagination['wordPagePattern']>().toEqualTypeOf<number[] | null | undefined>();
  const pagination: Pagination = { unit: 'word', wordPagePattern: [4, 5, 4] };
  expect(JSON.parse(JSON.stringify(pagination))).toEqual({ unit: 'word', wordPagePattern: [4, 5, 4] });
  const legacy: Pagination = { maxUnitsPerPage: 3 };
  expect(JSON.parse(JSON.stringify(legacy))).toEqual({ maxUnitsPerPage: 3 });
});

test('remaining word page plans are row lists indexed by unpaged word count', () => {
  type Pagination = NonNullable<CaptionScene['layout']['pagination']>;
  expectTypeOf<Pagination['remainingWordPagePlans']>().toEqualTypeOf<number[][] | null | undefined>();
  const pagination: Pagination = { remainingWordPagePlans: [[1], [2], [1, 1, 1]] };
  expect(JSON.parse(JSON.stringify(pagination))).toEqual({ remainingWordPagePlans: [[1], [2], [1, 1, 1]] });
});

test('fixed line overflow is an opt-in wrap of fixed rows', () => {
  type Pagination = NonNullable<CaptionScene['layout']['pagination']>;
  expectTypeOf<Pagination['fixedLineOverflow']>().toEqualTypeOf<'wrap' | null | undefined>();
  const pagination: Pagination = { wordLinePattern: [[4], [5]], fixedLineOverflow: 'wrap' };
  expect(JSON.parse(JSON.stringify(pagination))).toEqual({ wordLinePattern: [[4], [5]], fixedLineOverflow: 'wrap' });
});

test('fixed line fit scales fixed rows to the widest row', () => {
  type Pagination = NonNullable<CaptionScene['layout']['pagination']>;
  expectTypeOf<NonNullable<Pagination['fixedLineFit']>>().toEqualTypeOf<{
    lastLineWidthRatio: number; lastLineMaxScale: number; extraLineHeight: number;
  }>();
  const pagination: Pagination = {
    wordLinePattern: [[4, 3, 3, 3]],
    fixedLineFit: { lastLineWidthRatio: 0.5, lastLineMaxScale: 1.3, extraLineHeight: 0.1 },
  };
  expect(JSON.parse(JSON.stringify(pagination))).toEqual(pagination);
});

test('page tags label each word line pattern page', () => {
  type Pagination = NonNullable<CaptionScene['layout']['pagination']>;
  expectTypeOf<NonNullable<Pagination['pageTags']>>().toEqualTypeOf<number[]>();
  const pagination: Pagination = { wordLinePattern: [[1], [2], [1, 1]], pageTags: [7, 0, 3] };
  expect(JSON.parse(JSON.stringify(pagination))).toEqual(pagination);
});

test('list parameters and pick keep the Rust JSON shape', () => {
  const scene = {
    schema: 'baocut.caption-scene/1', evaluationVersion: 1,
    requiredCapabilities: ['caption-list-pick/1', 'caption-modular-expression/1'],
    parameters: [{ id: 'palette', type: 'color', list: true, default: ['#FFE600', '#4DD2FF'] }],
    layout: { width: { value: 140, basis: 'absolute' }, x: { value: 80, basis: 'absolute' }, y: { value: 45, basis: 'absolute' } },
    nodes: [{ id: 'text', type: 'text' }],
    animations: [{ id: 'color', target: { nodeId: 'text' }, property: 'fill', composite: 'replace', value: { kind: 'expression',
      expression: { op: 'call', function: 'pick', args: [{ op: 'read', path: 'params.palette' },
        { op: 'call', function: 'mod', args: [{ op: 'read', path: 'unit.index' }, { op: 'literal', type: 'scalar', value: 2 }] }] } } }],
  } satisfies CaptionScene;
  const presentation = { parameters: { palette: ['#FFFFFF'] } } satisfies CaptionPresentation;
  expect(JSON.parse(JSON.stringify(scene)).parameters[0]).toEqual({ id: 'palette', type: 'color', list: true, default: ['#FFE600', '#4DD2FF'] });
  expect(presentation.parameters.palette).toHaveLength(1);
  expectTypeOf<CaptionParameterValue>().toEqualTypeOf<number | boolean | string | (number | boolean | string)[]>();
});

test('clock tail is optional and accepts the three policies', () => {
  const clock = { unit: 'word', origin: 'start', duration: { kind: 'fixed', ticks: 600, timescale: 1000 }, tail: 'repeat' } satisfies CaptionClock;
  const legacy = { unit: 'cue', origin: 'start', duration: { kind: 'unit-span' } } satisfies CaptionClock;
  expect(JSON.parse(JSON.stringify(clock)).tail).toBe('repeat');
  expect('tail' in legacy).toBe(false);
  expectTypeOf<NonNullable<CaptionClock['tail']>>().toEqualTypeOf<CaptionClockTail>();
  expectTypeOf<CaptionClockTail>().toEqualTypeOf<'none' | 'clamp' | 'repeat'>();
});

test('speech phase paths are plain bool reads, not a fourth word state', () => {
  const read = { op: 'read', path: 'cue.speechPhase.reading' } satisfies CaptionExpression;
  expect(read.path).toBe('cue.speechPhase.reading');
  expectTypeOf<CaptionSpeechPhaseReadPath>().toEqualTypeOf<
    'cue.speechPhase.beforeFirst' | 'cue.speechPhase.reading' | 'cue.speechPhase.afterLast'
    | 'cue.speechPhase.estimated' | 'word.inSpan'>();
  expectTypeOf<CaptionWordState>().toEqualTypeOf<'active' | 'read' | 'unread'>();
});

test('pagination programs select fixed word line plans and isolate tagged words', () => {
  const pagination = {
    patternSelect: { by: 'word-count', candidates: [
      { id: 'two', minWords: 0, maxWords: 2, wordLinePattern: [[2]] },
      { id: 'rest', wordLinePattern: [[3], [2, 2]] },
    ] },
    isolation: [{ tag: 'keyword', mode: 'page' }, { tag: 'aside', mode: 'line' }],
  } satisfies NonNullable<CaptionScene['layout']['pagination']>;
  expect(pagination.patternSelect.candidates.at(-1)).not.toHaveProperty('minWords');
  expectTypeOf<CaptionPatternSelect['by']>().toEqualTypeOf<'word-count' | 'seed'>();
  expectTypeOf<CaptionIsolationRule['mode']>().toEqualTypeOf<'none' | 'line' | 'page'>();
  expectTypeOf<NonNullable<NonNullable<CaptionScene['layout']['pagination']>['isolation']>>()
    .toEqualTypeOf<CaptionIsolationRule[]>();
});

test('tag runs keep same-state words together on width-wrapped pages', () => {
  const pagination = {
    maxUnitsPerPage: 8, maxUnitsPerLine: 3,
    tagRuns: { tag: 'keyword', mode: 'line' },
  } satisfies NonNullable<CaptionScene['layout']['pagination']>;
  expect(pagination.tagRuns.mode).toBe('line');
  expectTypeOf<CaptionTagRuns['mode']>().toEqualTypeOf<'line' | 'page'>();
  expectTypeOf<NonNullable<NonNullable<CaptionScene['layout']['pagination']>['tagRuns']>>()
    .toEqualTypeOf<CaptionTagRuns>();
});

test('noise-displace material carries a domain, static noise scale and four uniforms', () => {
  const constant = (value: number) => ({ kind: 'constant', value }) as const;
  const material = {
    kind: 'noise-displace', id: 'shimmer', contextNodeId: 'text', domain,
    noiseScale: [4, 2], phase: constant(0), brightness: constant(0), contrast: constant(0.016), strength: constant(0.6),
  } satisfies CaptionMaterial;
  expect(material.noiseScale).toEqual([4, 2]);
  expectTypeOf<Extract<CaptionMaterial, { kind: 'noise-displace' }>['noiseScale']>().toEqualTypeOf<[number, number]>();
});

test('scan-warp material groups the noise warp, stripe and scanline uniforms', () => {
  const constant = (value: number) => ({ kind: 'constant', value }) as const;
  const material = {
    kind: 'scan-warp', id: 'glitch', contextNodeId: 'text', domain, uvY: 'down',
    warp: {
      scale: 0.25, complexity: 3, subImpact: 0.85, subScale: 40,
      evolution: constant(1.5), offset: [constant(0), constant(0.1)], strength: [constant(0.07), constant(0.06)],
    },
    stripe: {
      center: constant(0.5), coreHalfHeight: constant(0.5), falloff: constant(5.6), gate: constant(0.2),
      amount: constant(0.04), side: 'above',
    },
    scanlines: { amount: constant(0.05), pitch: 2.5, phase: constant(0) },
    gain: constant(1),
  } satisfies CaptionMaterial;
  expect(material.stripe.side).toBe('above');
  expectTypeOf<Extract<CaptionMaterial, { kind: 'scan-warp' }>['warp']['swapAxes']>().toEqualTypeOf<boolean | undefined>();
  expectTypeOf<Extract<CaptionMaterial, { kind: 'scan-warp' }>['stripe']['side']>().toEqualTypeOf<'above' | 'below'>();
});

test('radial-warp material carries a radial strength and a two-axis shift', () => {
  const constant = (value: number) => ({ kind: 'constant', value }) as const;
  const material = {
    kind: 'radial-warp', id: 'lens', contextNodeId: 'text', domain, uvY: 'down',
    strength: constant(0.26), shift: [constant(0), constant(-0.05)],
  } satisfies CaptionMaterial;
  expect(material.shift).toHaveLength(2);
  expectTypeOf<Extract<CaptionMaterial, { kind: 'radial-warp' }>['shift']['length']>().toEqualTypeOf<2>();
  expectTypeOf<Extract<CaptionMaterial, { kind: 'radial-warp' }>['uvY']>().toEqualTypeOf<'up' | 'down'>();
});

test('feedback composite defaults to decay-over and opts into an equal-weight mean', () => {
  const material = {
    kind: 'feedback', id: 'motion', samples: 10, step: { ticks: 25, timescale: 1000 }, decay: 1, offset: [2, 0], composite: 'mean',
  } satisfies CaptionMaterial;
  expect(material.composite).toBe('mean');
  expectTypeOf<Extract<CaptionMaterial, { kind: 'feedback' }>['composite']>().toEqualTypeOf<'decay-over' | 'mean' | undefined>();
});

test('render layers accept the add blend', () => {
  const layer = {
    id: 'ghost', source: { kind: 'nodes', nodeIds: ['text'] }, materials: [], blend: 'add',
  } satisfies CaptionRenderLayer;
  expect(layer.blend).toBe('add');
});

test('shape fill paint stays solid or linear while text layers take the richer paints', () => {
  type Fill = NonNullable<CaptionSceneNode['fillPaint']>;
  expectTypeOf<Fill['kind']>().toEqualTypeOf<'solid' | 'linear'>();
  const fill = { kind: 'linear', from: [0, 0], to: [1, 0], stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#FFFFFF' }] } satisfies Fill;
  expect(JSON.parse(JSON.stringify(fill))).toEqual(fill);
});

test('glyph fill masks use the owning paint layer unit and retain an optional spread', () => {
  const layers = [
    { id: 'offset', unit: 'em', offset: [0.1, -0.1], blur: 0.05,
      mask: { kind: 'glyph-fill' }, paint: { kind: 'solid', color: '#00000080' } },
    { id: 'grown', mask: { kind: 'glyph-fill', spread: 2 }, paint: { kind: 'node-fill' } },
    { id: 'texture', mask: { kind: 'glyph-fill', spread: 0 }, paint: { kind: 'image', resourceId: 'texture',
      uvTransform: [1, 0, 0, 1, 0, 0], space: 'glyph-normalized', compositeOpacity: 0.5 } },
  ] satisfies CaptionPaintLayer[];
  const serialized = JSON.parse(JSON.stringify(layers));
  expect(serialized[0].mask).toEqual({ kind: 'glyph-fill' });
  expect(serialized[1].mask).toEqual({ kind: 'glyph-fill', spread: 2 });
  expect(serialized[2].paint.compositeOpacity).toBe(0.5);
  expectTypeOf<CaptionPaintMask['kind']>().toEqualTypeOf<'glyph-fill'>();
  expectTypeOf<CaptionPaintMask['spread']>().toEqualTypeOf<number | undefined>();
  expectTypeOf<NonNullable<CaptionSceneNode['style']>['paints']>().toEqualTypeOf<CaptionPaintLayer[] | undefined>();
});

test('legacy paint layers serialize without introducing a mask field', () => {
  const layer = { id: 'fill', paint: { kind: 'solid', color: '#FFFFFF' } } satisfies CaptionPaintLayer;
  expect(JSON.stringify(layer)).toBe('{"id":"fill","paint":{"kind":"solid","color":"#FFFFFF"}}');
  // @ts-expect-error A mask requires a glyph-fill object; null is not an omission.
  const nullMask: CaptionPaintMask = null;
  // @ts-expect-error A string is not a mask object.
  const stringMask: CaptionPaintMask = 'glyph-fill';
  // @ts-expect-error Mask kinds are closed to the original-position glyph fill.
  const unknownKind: CaptionPaintMask = { kind: 'glyph-stroke' };
  // @ts-expect-error Mask fields remain closed; paint blur does not belong to the mask.
  const unknownField: CaptionPaintMask = { kind: 'glyph-fill', blur: 1 };
  expect([nullMask, stringMask, unknownKind, unknownField]).toHaveLength(4);
});

test('mask transforms retain independent offset and explicit inversion DTO fields', () => {
  const layer = { id: 'inside', unit: 'em', offset: [0.25, 0],
    mask: { kind: 'glyph-fill', spread: 0.1, offset: [-0.1, 0.2], inverted: true },
    paint: { kind: 'solid', color: '#00000080' } } satisfies CaptionPaintLayer;
  const serialized = JSON.parse(JSON.stringify(layer));
  expect(serialized.offset).toEqual([0.25, 0]);
  expect(serialized.mask).toEqual({ kind: 'glyph-fill', spread: 0.1, offset: [-0.1, 0.2], inverted: true });
  expectTypeOf<CaptionPaintMask['offset']>().toEqualTypeOf<[number, number] | undefined>();
  expectTypeOf<CaptionPaintMask['inverted']>().toEqualTypeOf<boolean | undefined>();
  // @ts-expect-error Null does not mean the default zero offset.
  const nullOffset: CaptionPaintMask = { kind: 'glyph-fill', offset: null };
  // @ts-expect-error An offset has exactly two components.
  const shortOffset: CaptionPaintMask = { kind: 'glyph-fill', offset: [1] };
  // @ts-expect-error Inversion must be boolean; null does not mean false.
  const nullInverted: CaptionPaintMask = { kind: 'glyph-fill', inverted: null };
  // @ts-expect-error Inversion does not accept a string policy.
  const stringInverted: CaptionPaintMask = { kind: 'glyph-fill', inverted: 'alpha-inverted' };
  expect([nullOffset, shortOffset, nullInverted, stringInverted]).toHaveLength(4);
});


test('distance coverage DTO preserves explicit bands, shared AA and zero-width policy', () => {
  const distance = {
    source: 'glyph-contours',
    bands: [
      { offset: [2, -3], distanceClamp: [-8, 9], threshold: -1, halfWidth: 1.5, thresholdClamp: [-4, 5], edgeClamp: [-6, 7] },
      { offset: [0, 0], threshold: 0, halfWidth: 0 },
    ],
    aa: { kind: 'quad-derivative', sourceBand: 0, scale: 0.75 },
    combine: 'multiply', zeroWidth: 'error',
  } satisfies CaptionGlyphDistanceCoverage;
  const layer = { id: 'distance', distanceCoverage: distance, paint: { kind: 'solid', color: '#33669980' } } satisfies CaptionPaintLayer;
  const serialized = JSON.parse(JSON.stringify(layer));
  expect(serialized.distanceCoverage).toEqual(distance);
  expect(serialized.distanceCoverage.bands[0].distanceClamp).toEqual([-8, 9]);
  expect(serialized.distanceCoverage.bands[1]).not.toHaveProperty('distanceClamp');
  expect(serialized.distanceCoverage.bands[1]).not.toHaveProperty('thresholdClamp');
  expect(serialized.distanceCoverage.bands[1]).not.toHaveProperty('edgeClamp');
  expectTypeOf<CaptionGlyphDistanceCoverage['source']>().toEqualTypeOf<'glyph-contours'>();
  expectTypeOf<CaptionGlyphDistanceCoverage['combine']>().toEqualTypeOf<'multiply'>();
  expectTypeOf<CaptionGlyphDistanceCoverage['zeroWidth']>().toEqualTypeOf<'error' | 'step-inclusive'>();
  expectTypeOf<CaptionGlyphDistanceBand['offset']>().toEqualTypeOf<[number, number]>();
  expectTypeOf<CaptionGlyphDistanceBand['distanceClamp']>().toEqualTypeOf<[number, number] | undefined>();
  expectTypeOf<CaptionGlyphDistanceAa['kind']>().toEqualTypeOf<'quad-derivative'>();
  expectTypeOf<CaptionPaintLayer['distanceCoverage']>().toEqualTypeOf<CaptionGlyphDistanceCoverage | undefined>();
});

test('distance coverage types require a named source, one/two bands and an explicit collapsed-band policy', () => {
  const band = { offset: [0, 0], threshold: 0, halfWidth: 0 } satisfies CaptionGlyphDistanceBand;
  const valid = { source: 'glyph-contours', bands: [band], aa: { kind: 'quad-derivative', sourceBand: 0, scale: 0 },
    combine: 'multiply', zeroWidth: 'step-inclusive' } satisfies CaptionGlyphDistanceCoverage;
  const { zeroWidth: _, ...missingPolicy } = valid;
  // @ts-expect-error The zero-width policy is required, even with nonzero AA.
  const implicitPolicy: CaptionGlyphDistanceCoverage = missingPolicy;
  // @ts-expect-error Distance coverage is optional by omission; null is not a value.
  const nullDistance: CaptionGlyphDistanceCoverage = null;
  // @ts-expect-error Glyph outlines are not the named contour-distance provider.
  const unknownSource: CaptionGlyphDistanceCoverage = { ...valid, source: 'glyph-outline' };
  // @ts-expect-error Exactly one or two bands are supported.
  const noBands: CaptionGlyphDistanceCoverage = { ...valid, bands: [] };
  // @ts-expect-error Three bands exceed the shared model's bounded arity.
  const threeBands: CaptionGlyphDistanceCoverage = { ...valid, bands: [band, band, band] };
  // @ts-expect-error Offset has two mandatory finite components, not an omitted default.
  const missingOffset: CaptionGlyphDistanceBand = { threshold: 0, halfWidth: 1 };
  // @ts-expect-error Optional clamp fields do not accept null.
  const nullClamp: CaptionGlyphDistanceBand = { ...band, edgeClamp: null };
  // @ts-expect-error An optional sample clamp cannot be explicitly null.
  const nullDistanceClamp: CaptionGlyphDistanceBand = { ...band, distanceClamp: null };
  // @ts-expect-error A sample clamp has exactly two bounds.
  const shortDistanceClamp: CaptionGlyphDistanceBand = { ...band, distanceClamp: [0] };
  expect([implicitPolicy, nullDistance, unknownSource, noBands, threeBands, missingOffset, nullClamp, nullDistanceClamp, shortDistanceClamp]).toHaveLength(9);
  const legacy = { id: 'fill', paint: { kind: 'solid', color: '#FFFFFF' } } satisfies CaptionPaintLayer;
  expect(JSON.stringify(legacy)).toBe('{"id":"fill","paint":{"kind":"solid","color":"#FFFFFF"}}');
  expect(JSON.parse(JSON.stringify(valid))).toEqual(valid);
});


test('static word paint bindings retain complete layer replacements', () => {
  const bindings = [{ id: 'accent', nodeId: 'text', selectorId: 'marked',
    style: { fill: '#FFFFFFFF', paints: [{ id: 'fill', paint: { kind: 'node-fill' } }] },
  }] satisfies NonNullable<CaptionScene['paintStyleBindings']>;
  expect(JSON.parse(JSON.stringify(bindings))).toEqual(bindings);
  // @ts-expect-error Null is not an omitted fill override.
  const invalid: NonNullable<CaptionScene['paintStyleBindings']>[number]['style'] = { fill: null, paints: [] };
  expect(invalid.fill).toBeNull();
});


test('local glyph mask rasterization is explicit and retains legacy omission', () => {
  const mask = { kind: 'glyph-fill', rasterization: 'glyph-bounds' } satisfies CaptionPaintMask;
  expect(JSON.parse(JSON.stringify(mask))).toEqual({ kind: 'glyph-fill', rasterization: 'glyph-bounds' });
  expectTypeOf<CaptionPaintMask['rasterization']>().toEqualTypeOf<'canvas' | 'glyph-bounds' | undefined>();
  // @ts-expect-error Rasterization modes are closed.
  const invalid: CaptionPaintMask = { kind: 'glyph-fill', rasterization: 'auto' };
  expect(invalid.rasterization).toBe('auto');
});

test('layout sampling clock carries a typed expression without changing legacy DTOs', () => {
  type Clock = NonNullable<CaptionScene['layout']['clock']>;
  expectTypeOf<Clock>().toEqualTypeOf<{ time: CaptionExpression }>();
  const clock: Clock = { time: { op: 'literal', type: 'time', value: 0.25 } };
  expect(JSON.parse(JSON.stringify(clock))).toEqual({ time: { op: 'literal', type: 'time', value: 0.25 } });
  expect(fixture.scene.value.layout).not.toHaveProperty('clock');
});

test('template adjustments and provenance use the Rust field names', () => {
  const adjusted = {
    ...fixture,
    adjust: {
      colors: [{ from: '#000000CC', to: '#3355FF' }],
      fonts: [{ from: 'Display Sans', to: { family: 'Serif Two', weight: 600 } }],
      fontScale: 1.25,
      placement: { x: 0.5, y: 0.82, width: 0.8 },
    },
    origin: { pack: { id: 'demo', version: '1.0.0' }, template: { id: 'outline', revision: 2 }, sceneSha256: 'b'.repeat(64) },
  } satisfies CaptionSceneStyleBody;
  expect(Object.keys(adjusted.adjust)).toEqual(['colors', 'fonts', 'fontScale', 'placement']);
  expectTypeOf<NonNullable<CaptionSceneSummary['adjustable']>['placement']>().toEqualTypeOf<('x' | 'y' | 'width')[]>();
  expectTypeOf<CaptionSceneSummary['pagination']['mode']>().toEqualTypeOf<'auto' | 'fixed'>();
});
