import { describe, expect, it } from 'vitest';
import { BAKE_PROVENANCE_ORIGIN, prerenderStaleness, type BakeRecord } from './code-bundle.ts';
import type { AssetRecord, AssetRevision, CompositionItem, Rate } from './video.ts';

/** 替身何时过期（代码包规范 §7.4）：烘焙记录与实例所指代码包清单的身份、帧率。 */

const FPS30: Rate = { num: 30, den: 1 };
const FPS25: Rate = { num: 25, den: 1 };
const NTSC: Rate = { num: 30000, den: 1001 };

function revision(extra: Partial<AssetRevision>): AssetRevision {
  return {
    revision: '1',
    contentHash: 'sha256:0',
    byteLength: 1,
    mediaType: 'video/quicktime',
    storage: { mode: 'managed' },
    provenance: { origin: 'agent-import' },
    ...extra,
  };
}

function asset(id: string, kind: AssetRecord['kind'], revisions: AssetRevision[]): AssetRecord {
  return {
    id,
    kind,
    name: id,
    currentRevision: revisions[revisions.length - 1]!.revision,
    revisions: Object.fromEntries(revisions.map((r) => [r.revision, r])),
  };
}

function bakeRecord(sourceBundleRef: BakeRecord['sourceBundleRef'], fps: Rate): BakeRecord {
  return {
    bakedAssetRef: sourceBundleRef,
    sourceBundleRef,
    parameterValuesHash: 'sha256:p',
    timeMapHash: 'sha256:t',
    outputProfileHash: 'sha256:o',
    bakedAt: '2026-10-17T00:00:00.000Z',
    status: 'current',
    encoding: { container: 'mov', codec: 'prores_ks', pixelFormat: 'yuva444p10le', alpha: true, fps, frames: 120 },
  };
}

const bundle = asset('bundle_a', 'bundle', [
  revision({ revision: '1', mediaType: 'application/x-directory', bundle: { bundleId: 'lower-third', revision: '1' } }),
  revision({ revision: '2', mediaType: 'application/x-directory', bundle: { bundleId: 'lower-third', revision: '2' } }),
]);

function item(source: string, prerender: string | null): Pick<CompositionItem, 'id' | 'source' | 'prerender'> {
  return {
    id: 'item_1',
    source: { kind: 'bundle', assetRef: { id: 'bundle_a', revision: source } },
    ...(prerender ? { prerender: { id: 'prerender_a', revision: prerender } } : {}),
  };
}

function baked(record: BakeRecord): AssetRecord {
  return asset('prerender_a', 'video', [revision({ provenance: { origin: BAKE_PROVENANCE_ORIGIN, source: record } })]);
}

describe('prerenderStaleness', () => {
  it('没有替身，或替身素材的版本不在：missing', () => {
    const assets = { bundle_a: bundle };
    expect(prerenderStaleness(item('1', null), assets, FPS30)).toEqual({ itemId: 'item_1', reason: 'missing' });
    expect(prerenderStaleness(item('1', '1'), assets, FPS30)).toEqual({ itemId: 'item_1', reason: 'missing' });
  });

  it('烘焙记录与实例所指的清单身份一致、帧率相同：可用', () => {
    const assets = { bundle_a: bundle, prerender_a: baked(bakeRecord({ id: 'lower-third', revision: '1' }, FPS30)) };
    expect(prerenderStaleness(item('1', '1'), assets, FPS30)).toBeNull();
  });

  it('实例换到了别的代码包版本：bundle-changed，带烘焙自哪个版本与现在是哪个', () => {
    const assets = { bundle_a: bundle, prerender_a: baked(bakeRecord({ id: 'lower-third', revision: '1' }, FPS30)) };
    expect(prerenderStaleness(item('2', '1'), assets, FPS30)).toEqual({
      itemId: 'item_1',
      reason: 'bundle-changed',
      bakedFrom: { id: 'lower-third', revision: '1' },
      current: { id: 'lower-third', revision: '2' },
    });
  });

  it('替身的帧率与序列不同：fps-mismatch；帧率按有理数比较', () => {
    const assets = { bundle_a: bundle, prerender_a: baked(bakeRecord({ id: 'lower-third', revision: '1' }, FPS30)) };
    expect(prerenderStaleness(item('1', '1'), assets, FPS25)).toMatchObject({ reason: 'fps-mismatch', bakedFrom: { revision: '1' } });
    expect(prerenderStaleness(item('1', '1'), assets, NTSC)).toMatchObject({ reason: 'fps-mismatch' });
    expect(prerenderStaleness(item('1', '1'), assets, { num: 60, den: 2 })).toBeNull();
  });

  it('清单身份先于帧率：两样都不对时报 bundle-changed', () => {
    const assets = { bundle_a: bundle, prerender_a: baked(bakeRecord({ id: 'lower-third', revision: '1' }, FPS25)) };
    expect(prerenderStaleness(item('2', '1'), assets, FPS30)).toMatchObject({ reason: 'bundle-changed' });
  });

  it('替身不是烘焙出来的（没有记录）：只按替身视频的帧率核对', () => {
    const video = (frameRate: NonNullable<AssetRevision['video']>['frameRate']) =>
      revision({
        provenance: { origin: 'agent-import' },
        video: {
          displayWidth: 1920,
          displayHeight: 1080,
          rotation: 0,
          pixelAspectRatio: { num: 1, den: 1 },
          frameRate,
          ptsOrigin: { ticks: '0', timescale: 30 },
          hasAlpha: true,
        },
      });
    const cfr30 = { bundle_a: bundle, prerender_a: asset('prerender_a', 'video', [video({ kind: 'cfr', rate: FPS30 })]) };
    expect(prerenderStaleness(item('2', '1'), cfr30, FPS30)).toBeNull();
    const cfr25 = { bundle_a: bundle, prerender_a: asset('prerender_a', 'video', [video({ kind: 'cfr', rate: FPS25 })]) };
    expect(prerenderStaleness(item('1', '1'), cfr25, FPS30)).toEqual({
      itemId: 'item_1',
      reason: 'fps-mismatch',
      current: { id: 'lower-third', revision: '1' },
    });
    const vfr = { bundle_a: bundle, prerender_a: asset('prerender_a', 'video', [video({ kind: 'vfr' })]) };
    expect(prerenderStaleness(item('1', '1'), vfr, FPS30)).toBeNull();
  });
});
