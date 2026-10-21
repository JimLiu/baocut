import { expect, expectTypeOf, test } from 'vitest';
import type {
  CaptionClock, CaptionClockTail, CaptionExpression, CaptionIsolationRule, CaptionPatternSelect, CaptionImageSequenceResource, CaptionLayerSource, CaptionMaterial,
  CaptionParameterValue, CaptionPresentation, CaptionRenderLayer, CaptionScene, CaptionSceneNode, CaptionSceneStyleBody,
  CaptionSpeechPhaseReadPath, CaptionWordState,
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

test('noise-displace material carries a domain, static noise scale and four uniforms', () => {
  const constant = (value: number) => ({ kind: 'constant', value }) as const;
  const material = {
    kind: 'noise-displace', id: 'shimmer', contextNodeId: 'text', domain,
    noiseScale: [4, 2], phase: constant(0), brightness: constant(0), contrast: constant(0.016), strength: constant(0.6),
  } satisfies CaptionMaterial;
  expect(material.noiseScale).toEqual([4, 2]);
  expectTypeOf<Extract<CaptionMaterial, { kind: 'noise-displace' }>['noiseScale']>().toEqualTypeOf<[number, number]>();
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
