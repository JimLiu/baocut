import {
  itemRangeSeconds,
  prerenderStaleness,
  type AssetRecord,
  type CompositionItem,
  type Id,
  type Rate,
  type Sequence,
  type VersionRef,
} from '@baocut/protocol';

/**
 * 实时合成层（动效视频设计 §4）里界面这一侧的判定，与 `render-graph` 的 `stand_in_state` 同一规则：
 * 代码包合成的替身可不可用（停住时画替身还是实时层）、哪些合成要实时播、它们的清单、播放头附近该预载哪几个。
 * 播放中一律实时播（§4.3），所以预载名单不看替身。替身过不过期只问 `prerenderStaleness`（代码包规范 §7.4），这里不另写一套。
 */

export type StandInState = 'none' | 'stale' | 'usable';

/** 实时播要知道的清单字段（代码包规范 §2.1 的浏览器合成）。 */
export interface LiveManifest {
  contract: string;
  width: number;
  height: number;
  fps: Rate;
  durationFrames: number;
}

/** 预览引擎要宿主预载的一个合成。 */
export interface LiveCandidate extends LiveManifest {
  itemId: Id;
  asset: VersionRef;
  /** 实例在序列上的区间（秒），挑播放头附近的用。 */
  start: number;
  end: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRate(value: unknown): value is Rate {
  return isRecord(value) && typeof value.num === 'number' && typeof value.den === 'number' && value.den > 0;
}

/** 素材版本上的代码包清单里实时播要的几项；不是浏览器合成、缺字段时 null。 */
export function liveManifestOf(assets: Record<Id, AssetRecord>, asset: VersionRef): LiveManifest | null {
  const manifest = assets[asset.id]?.revisions[asset.revision]?.bundle;
  if (!isRecord(manifest) || !isRecord(manifest.runtime) || manifest.runtime.engine !== 'browser') return null;
  const { contract } = manifest.runtime;
  const intrinsic = manifest.intrinsic;
  if (typeof contract !== 'string' || !isRecord(intrinsic)) return null;
  const { width, height, fps, durationFrames } = intrinsic;
  if (!(
    typeof width === 'number' &&
    width > 0 &&
    typeof height === 'number' &&
    height > 0 &&
    isRate(fps) &&
    typeof durationFrames === 'number'
  ))
    return null;
  return { contract, width, height, fps, durationFrames };
}

/**
 * 替身能不能用（代码包规范 §7.4 的 `prerenderStaleness`）：没有预渲染、或素材版本不在是 `none`；换了代码包版本没重烘、
 * 或帧率与序列不同是 `stale`；其余是 `usable`。
 */
export function standInState(assets: Record<Id, AssetRecord>, item: CompositionItem, sequenceFps: Rate): StandInState {
  const stale = prerenderStaleness(item, assets, sequenceFps);
  if (!stale) return 'usable';
  return stale.reason === 'missing' ? 'none' : 'stale';
}

/**
 * 序列里要实时播的合成（清单齐全、没被拉黑的），按开始时刻排。有可用替身的也在内：播放中照样实时播，只在停住时才画替身
 * （动效视频设计 §4.3），所以 iframe 要先挂好，不然一按播放就要等它就绪。
 */
export function liveCandidates(sequence: Sequence, assets: Record<Id, AssetRecord>, blocked: ReadonlySet<Id> = new Set()): LiveCandidate[] {
  const out: LiveCandidate[] = [];
  for (const item of sequence.items) {
    if (item.type !== 'composition' || blocked.has(item.id)) continue;
    const manifest = liveManifestOf(assets, item.source.assetRef);
    if (!manifest) continue;
    const { start, end } = itemRangeSeconds(item, sequence.fps);
    out.push({ itemId: item.id, asset: item.source.assetRef, start, end, ...manifest });
  }
  return out.sort((a, b) => a.start - b.start || a.itemId.localeCompare(b.itemId));
}

/**
 * 播放头附近该预载的（动效视频设计 §4.1：当前章与前后各一章）：在视的那个（没有就是下一个要来的）排第一，
 * 然后是它前面与后面各一个；最多 `limit` 个。
 */
export function preloadSet(candidates: readonly LiveCandidate[], seconds: number, limit = 3): LiveCandidate[] {
  if (candidates.length === 0) return [];
  let current = candidates.findIndex((c) => seconds >= c.start && seconds < c.end);
  if (current < 0) current = candidates.findIndex((c) => c.start >= seconds);
  if (current < 0) current = candidates.length - 1;
  const picked = [current, current + 1, current - 1].filter((i) => i >= 0 && i < candidates.length);
  return picked.slice(0, limit).map((i) => candidates[i]!);
}
