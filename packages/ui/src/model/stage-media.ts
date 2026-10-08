import type { AssetRecord, Id, MissingAsset, Sequence, VersionRef } from '@baocut/protocol';
import { itemFrames } from './editor.ts';
import { M } from './stage-media-copy.ts';

/**
 * 主媒体放不出来时的舞台提示（设计稿 model-stage-media.js、stage.jsx 的 `StageMediaNotice`）。纯函数，不碰 React 与 DOM。
 *
 * 主媒体：根序列里启用的视频、音频实例用到的素材版本，按在时间线上出现的先后排。缺了它们视频照常打开，
 * 字幕、元素与时钟照常走（预览的时钟不依赖媒体），只是没有画面或声音——卡片常驻画面正中，播放时也不收。
 * 只缺图片等别的素材时不出卡。没有主媒体的视频（空白、纯元素）不出卡。
 *
 * 四种情形，同一张卡：
 * - `missing` / `changed` / `outside-project`：`videos.assetStatus` 报告读不到（视频格式规范 §4.2），原因原样沿用；
 * - `unplayable`：文件在、地址也取到了，但播放器打不开或解不了码（附播放器原话）。
 *
 * 找回画面：设计稿把「重新关联媒体…」放在 Space 视频卡的 ⋯ 菜单里；但 Space 不打开视频就不知道缺不缺素材，
 * 这里改为桌面端在卡上放「重新关联…」（宿主有 `pickFiles` 才放），网页宿主在卡上说明要到桌面端找回。
 */

export type StageMediaKind = MissingAsset['reason'] | 'unplayable';

export interface StageMediaNotice {
  kind: StageMediaKind;
  title: string;
  /** 第一个读不到的主媒体的文件名（不给整条路径）。 */
  name: string;
  body: string;
  /** 登记了所在的盘时：接上它就能自动恢复。 */
  volume: string | null;
  /** 还有几个主媒体也放不出来。 */
  more: string | null;
  /** 去哪儿找回、或者为什么这一个找不回。 */
  hint: string | null;
  /** 可以在卡上重新关联的那一个（桌面端、链接素材、当前版本）。 */
  relink: { assetId: Id; name: string } | null;
}

/** 卡片的文案（译文在 `stage-media-copy.<语言>.ts`）。 */
export const STAGE_MEDIA_COPY = M;

/** 主媒体：素材版本与它的种类（决定说「画面和原声」还是「这段声音」）。 */
export interface PrimaryMedia {
  ref: VersionRef;
  kind: 'video' | 'audio';
}

export function refKey(ref: VersionRef): string {
  return `${ref.id}@${ref.revision}`;
}

/** 根序列里启用的视频、音频实例用到的素材版本：按起点排（同时开始的视频在前），同一版本只算一次。 */
export function primaryMedia(sequence: Sequence): PrimaryMedia[] {
  const found = sequence.items
    .filter((item) => (item.type === 'video' || item.type === 'audio') && item.enabled)
    .map((item) => ({ item, start: itemFrames(item, sequence.fps).start }))
    .sort(
      (a, b) =>
        a.start - b.start ||
        (a.item.type === b.item.type ? 0 : a.item.type === 'video' ? -1 : 1) ||
        (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0),
    );
  const seen = new Set<string>();
  const out: PrimaryMedia[] = [];
  for (const { item } of found) {
    if (item.type !== 'video' && item.type !== 'audio') continue;
    const key = refKey(item.assetRef);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ref: item.assetRef, kind: item.type });
  }
  return out;
}

/** 路径 → 文件名；取不到文件名就原样给路径。 */
export function fileName(path: string): string {
  const match = /[^/\\]+$/.exec(path);
  return match ? match[0] : path;
}

/** 素材在卡上叫什么：登记的路径的文件名，没有路径（收在视频目录里）时用素材名。 */
function assetName(ref: VersionRef, assets: Record<Id, AssetRecord>, path?: string): string {
  if (path) return fileName(path);
  const asset = assets[ref.id];
  const storage = asset?.revisions[ref.revision]?.storage;
  if (storage?.mode === 'linked') return fileName(storage.locator.path);
  return asset?.name || ref.id;
}

export interface StageMediaInput {
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  /** `videos.assetStatus` 的结果；还没查到时是 null。 */
  missing: readonly MissingAsset[] | null;
  /** 文件在、播放器打不开的素材版本（`refKey` → 播放器原话）。 */
  unplayable: ReadonlyMap<string, string>;
  /** 宿主能选文件（桌面端）：卡上放「重新关联…」。 */
  canPick: boolean;
}

type Problem = { media: PrimaryMedia; missing: MissingAsset } | { media: PrimaryMedia; error: string };

/** 卡片内容；主媒体都放得出来时是 null。 */
export function stageMediaNotice({ sequence, assets, missing, unplayable, canPick }: StageMediaInput): StageMediaNotice | null {
  const lost = new Map((missing ?? []).map((m) => [refKey({ id: m.assetId, revision: m.revision }), m]));
  const problems: Problem[] = [];
  for (const media of primaryMedia(sequence)) {
    const key = refKey(media.ref);
    const gone = lost.get(key);
    const error = unplayable.get(key);
    if (gone) problems.push({ media, missing: gone });
    else if (error !== undefined) problems.push({ media, error });
  }
  const first = problems[0];
  if (!first) return null;
  const C = STAGE_MEDIA_COPY;
  const more = problems.length > 1 ? C.more(problems.length - 1) : null;
  const tail = C.tail[first.media.kind];
  if ('error' in first) {
    return {
      kind: 'unplayable',
      title: C.titles.unplayable,
      name: assetName(first.media.ref, assets),
      body: C.body(C.unplayable(first.error), tail),
      volume: null,
      more,
      hint: null,
      relink: null,
    };
  }
  const m = first.missing;
  const name = assetName(first.media.ref, assets, m.path);
  // 重新关联只认链接素材（有登记的路径），且只改素材的当前版本（引擎 relink_asset）。
  const current = assets[m.assetId]?.currentRevision === m.revision;
  const relinkable = !!m.path && current;
  return {
    kind: m.reason,
    title: C.titles[m.reason],
    name,
    body: C.body(C.causes[m.reason], tail),
    volume: m.reason === 'missing' && m.volume ? C.volume(m.volume) : null,
    more,
    hint: relinkable ? (canPick ? C.relinkHint : C.desktopOnly) : m.path ? C.oldRevision : C.managed,
    relink: relinkable && canPick ? { assetId: m.assetId, name } : null,
  };
}

/**
 * 素材登记的指纹：素材的增删、换当前版本、收进视频、换位置都会变。视频事件每次都重建 `assets`，
 * 身份不能用来判断「提交了素材类操作」，按这个字符串判断要不要重查 `videos.assetStatus`。
 */
export function assetsFingerprint(assets: Record<Id, AssetRecord>): string {
  return Object.keys(assets)
    .sort()
    .map((id) => {
      const asset = assets[id]!;
      const revisions = Object.keys(asset.revisions)
        .sort()
        .map((r) => {
          const storage = asset.revisions[r]!.storage;
          return `${r}:${storage.mode === 'linked' ? `L${storage.locator.path}` : 'M'}`;
        });
      return `${id}=${asset.currentRevision}|${revisions.join(',')}`;
    })
    .join(';');
}

/** 上一次读不到、这一次读得到的素材（重新关联了、盘接上了）：预览要重新取它们的地址。 */
export function recoveredAssets(before: readonly MissingAsset[] | null, after: readonly MissingAsset[]): Id[] {
  if (!before) return [];
  const still = new Set(after.map((m) => m.assetId));
  return [...new Set(before.map((m) => m.assetId))].filter((id) => !still.has(id));
}

/** 源元素一次载入的结果：载入了；出错了（`MediaError` 的 code 与原话）；地址取不到（`media.resolve` 失败）。 */
export type MediaOutcome = { kind: 'loaded' } | { kind: 'error'; code: number; message: string } | { kind: 'unresolved' };

/** 每个源元素（按预览的媒体键）连续几次解不了，最后一次的原话。 */
export type PlaybackLog = Readonly<Record<string, { ref: string; failures: number; message: string }>>;

const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;
/** 换了新地址还是解不了才算放不出来：媒体句柄过期（Runtime 重启）时第一次也会报错，重取一次就好。 */
const UNPLAYABLE_AFTER = 2;

/**
 * 记一次载入结果。只有解码失败、格式不支持算数（网络中断、中止不算）；载入成功清零。
 * 媒体地址每次重取都是新的，元素报错后会重取，所以「连续两次」就是换了地址还是不行。
 */
export function notePlayback(log: PlaybackLog, key: string, ref: VersionRef, outcome: MediaOutcome): PlaybackLog {
  if (outcome.kind === 'loaded') {
    if (!(key in log)) return log;
    const rest = { ...log };
    delete rest[key];
    return rest;
  }
  if (outcome.kind !== 'error' || (outcome.code !== MEDIA_ERR_DECODE && outcome.code !== MEDIA_ERR_SRC_NOT_SUPPORTED)) return log;
  const previous = log[key];
  const failures = previous && previous.ref === refKey(ref) ? previous.failures + 1 : 1;
  return { ...log, [key]: { ref: refKey(ref), failures, message: mediaErrorText(outcome.code, outcome.message) } };
}

/** 放不出来的素材版本（`refKey` → 播放器原话）。 */
export function unplayableRefs(log: PlaybackLog): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of Object.values(log)) if (entry.failures >= UNPLAYABLE_AFTER && !out.has(entry.ref)) out.set(entry.ref, entry.message);
  return out;
}

/** 播放器原话；浏览器没给时按错误码说一句。 */
export function mediaErrorText(code: number, message: string): string {
  const said = message.trim();
  if (said) return said;
  return code === MEDIA_ERR_DECODE ? M.decodeFailed : M.unsupported;
}
