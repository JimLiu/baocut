import type { AssetRecord, CompositionItem, Sequence } from '@baocut/protocol';
import { expect, test } from 'vitest';
import { liveCandidates, liveManifestOf, preloadSet, standInState, type LiveCandidate } from './live-composition.ts';

const manifest = (bundleId: string, revision: string, engine = 'browser') => ({
  bundleId,
  revision,
  runtime: { engine, contract: 'hyperframes/1', entry: 'index.html' },
  intrinsic: { width: 1280, height: 720, fps: { num: 30, den: 1 }, durationFrames: 60 },
});

const bake = (revision: string, fps = { num: 30, den: 1 }) => ({
  origin: 'composition-bake',
  source: { sourceBundleRef: { id: 'b', revision }, encoding: { fps } },
});

function assets(
  records: Record<string, Record<string, { bundle?: unknown; origin?: string; source?: unknown; frameRate?: unknown }>>,
): Record<string, AssetRecord> {
  const out: Record<string, AssetRecord> = {};
  for (const [id, revisions] of Object.entries(records)) {
    out[id] = {
      id,
      kind: 'video',
      name: id,
      currentRevision: Object.keys(revisions)[0]!,
      revisions: Object.fromEntries(
        Object.entries(revisions).map(([revision, extra]) => [
          revision,
          {
            revision,
            bundle: extra.bundle,
            provenance: { origin: extra.origin ?? 'x', source: extra.source },
            ...(extra.frameRate ? { video: { frameRate: extra.frameRate } } : {}),
          },
        ]),
      ),
    } as unknown as AssetRecord;
  }
  return out;
}

function composition(id: string, fromFrame: number, prerender?: { id: string; revision: string }, asset = 'bundle'): CompositionItem {
  return {
    id,
    type: 'composition',
    enabled: true,
    trackId: 't',
    span: { fromFrame, durationFrames: 60 },
    source: { kind: 'bundle', assetRef: { id: asset, revision: '1' } },
    parameterValues: {},
    timeMap: { kind: 'identity' },
    ...(prerender ? { prerender } : {}),
  } as unknown as CompositionItem;
}

const base = { id: 'seq', fps: { num: 30, den: 1 }, canvas: { width: 1920, height: 1080 }, tracks: [] } as unknown as Sequence;

test('替身可不可用：没有预渲染是 none，换了代码包版本或帧率与序列不同是 stale，一致或没有烘焙记录且帧率相同是 usable', () => {
  const records = assets({
    bundle: { '1': { bundle: manifest('b', '7') } },
    baked: {
      '1': bake('7'),
      '2': bake('6'),
      '3': { origin: 'x', source: {} },
      '4': bake('7', { num: 25, den: 1 }),
      '5': { origin: 'import', frameRate: { kind: 'cfr', rate: { num: 24, den: 1 } } },
      '6': { origin: 'import', frameRate: { kind: 'cfr', rate: { num: 60, den: 2 } } },
    },
  });
  const fps = { num: 30, den: 1 };
  expect(standInState(records, composition('c', 0), fps)).toBe('none');
  expect(standInState(records, composition('c', 0, { id: 'missing', revision: '1' }), fps)).toBe('none');
  expect(standInState(records, composition('c', 0, { id: 'baked', revision: '1' }), fps)).toBe('usable');
  expect(standInState(records, composition('c', 0, { id: 'baked', revision: '2' }), fps)).toBe('stale');
  expect(standInState(records, composition('c', 0, { id: 'baked', revision: '3' }), fps)).toBe('usable');
  expect(standInState(records, composition('c', 0, { id: 'baked', revision: '4' }), fps)).toBe('stale');
  expect(standInState(records, composition('c', 0, { id: 'baked', revision: '1' }), { num: 25, den: 1 })).toBe('stale');
  expect(standInState(records, composition('c', 0, { id: 'baked', revision: '5' }), fps)).toBe('stale');
  expect(standInState(records, composition('c', 0, { id: 'baked', revision: '6' }), fps)).toBe('usable');
});

test('清单：只认浏览器合成、固有尺寸齐全的', () => {
  const records = assets({
    ok: { '1': { bundle: manifest('b', '1') } },
    native: { '1': { bundle: manifest('b', '1', 'native') } },
    broken: { '1': { bundle: { ...manifest('b', '1'), intrinsic: { width: 0 } } } },
    plain: { '1': {} },
  });
  expect(liveManifestOf(records, { id: 'ok', revision: '1' })).toEqual({
    contract: 'hyperframes/1',
    width: 1280,
    height: 720,
    fps: { num: 30, den: 1 },
    durationFrames: 60,
  });
  expect(liveManifestOf(records, { id: 'native', revision: '1' })).toBeNull();
  expect(liveManifestOf(records, { id: 'broken', revision: '1' })).toBeNull();
  expect(liveManifestOf(records, { id: 'plain', revision: '1' })).toBeNull();
  expect(liveManifestOf(records, { id: 'ok', revision: '2' })).toBeNull();
});

test('要实时播的合成：清单齐全、没拉黑的，按开始时刻排；有可用替身的也在内（播放中照样实时播）', () => {
  const records = assets({
    bundle: { '1': { bundle: manifest('b', '7') } },
    baked: {
      '1': bake('7'),
      '2': bake('6'),
    },
    native: { '1': { bundle: manifest('n', '1', 'native') } },
  });
  const sequence = {
    ...base,
    items: [
      composition('late', 600),
      composition('usable', 300, { id: 'baked', revision: '1' }),
      composition('stale', 120, { id: 'baked', revision: '2' }),
      composition('native', 0, undefined, 'native'),
      composition('blocked', 0),
      composition('early', 0),
      { id: 'text', type: 'text', enabled: true, trackId: 't', span: { fromFrame: 0, durationFrames: 30 } },
    ],
  } as unknown as Sequence;
  const picked = liveCandidates(sequence, records, new Set(['blocked']));
  expect(picked.map((c) => [c.itemId, c.start, c.end])).toEqual([
    ['early', 0, 2],
    ['stale', 4, 6],
    ['usable', 10, 12],
    ['late', 20, 22],
  ]);
  expect(picked[0]).toMatchObject({
    asset: { id: 'bundle', revision: '1' },
    contract: 'hyperframes/1',
    width: 1280,
    height: 720,
    durationFrames: 60,
  });
});

test('预载：在视的排第一，然后是后一个与前一个；播放头落在空档时取下一个要来的，过了末尾取最后一个；最多三个', () => {
  const c = (itemId: string, start: number): LiveCandidate => ({
    itemId,
    start,
    end: start + 2,
    asset: { id: 'b', revision: '1' },
    contract: 'hyperframes/1',
    width: 1,
    height: 1,
    fps: { num: 30, den: 1 },
    durationFrames: 60,
  });
  const all = [c('a', 0), c('b', 10), c('c', 20), c('d', 30)];
  const ids = (picked: LiveCandidate[]) => picked.map((p) => p.itemId);
  expect(ids(preloadSet(all, 10.5))).toEqual(['b', 'c', 'a']);
  expect(ids(preloadSet(all, 0))).toEqual(['a', 'b']);
  expect(ids(preloadSet(all, 5))).toEqual(['b', 'c', 'a']);
  expect(ids(preloadSet(all, 99))).toEqual(['d', 'c']);
  expect(ids(preloadSet(all, 21, 2))).toEqual(['c', 'd']);
  expect(preloadSet([], 0)).toEqual([]);
});
