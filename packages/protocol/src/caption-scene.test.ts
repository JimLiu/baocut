import { expect, expectTypeOf, test } from 'vitest';
import type {
  CaptionImageSequenceResource, CaptionLayerSource, CaptionMaterial,
  CaptionRenderLayer, CaptionScene, CaptionSceneStyleBody,
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
  expectTypeOf<CaptionRenderLayer['blend']>().toEqualTypeOf<'source-over' | 'screen'>();
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
