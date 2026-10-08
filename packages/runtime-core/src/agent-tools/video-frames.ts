// i18n-ignore-file: 给模型的工具说明、错误与下一步
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { mediaTimeToSeconds, type Id, type VideoItem, type VideoSnapshot } from '@baocut/protocol';
import type { MediaAnalysis, FrameAsset } from '../media-analysis.ts';
import { inside, refuseVideoDirectory } from './artifact-save.ts';
import { ToolError } from './tool-catalog.ts';

/**
 * `videos_frames` 的取帧（Agent 面设计 §4.3）：时间线上的时刻 → 画面上最上层的视频片段 → 素材时间 → 素材的一帧。
 * 不合成：字幕、文字、贴纸与叠加的元素都不在帧里，画中画的位置与效果也不套，只是那个片段的素材画面。
 */

/** 单次最多取这么多帧。 */
export const MAX_FRAMES = 24;
/** 不给 `maxWidth` 时帧的长边上限（像素）。 */
export const DEFAULT_FRAME_EDGE = 1280;
/** `range` 不给 `count` 时取几帧。 */
export const DEFAULT_RANGE_COUNT = 6;

/** 帧写到写文件目录下的这里，再按 videoId 分开。 */
export const FRAMES_DIR = path.join('.baocut-out', 'frames');

export const FRAMES_NOTE =
  '帧是时间线上最上层的那个视频片段的素材画面，不是合成后的画面：字幕、文字、贴纸与叠加的元素不在里面，画中画的位置、裁剪与效果也没有套用（composited: false）。没有视频片段的时刻 file 为 null。';

/** 时间线上一个时刻取到的源：片段、素材版本与素材时间。 */
export interface FrameSource {
  item: VideoItem;
  asset: FrameAsset;
  assetId: Id;
  revision: string;
  sourceSeconds: number;
}

/** 要取的时刻（十进制秒字符串）：`at` 原样，`range` 在 [起, 止) 里等间隔取 `count` 个，第一个在起点。 */
export function frameTimes(args: { at?: string[] | undefined; range?: string | undefined; count?: number | undefined }): string[] {
  if ((args.at === undefined) === (args.range === undefined)) {
    throw new ToolError('INVALID_ARGUMENTS', 'at 与 range 给且只给一个：at 是时刻的列表，range 是 "起:止"');
  }
  if (args.at !== undefined) {
    if (args.count !== undefined) throw new ToolError('INVALID_ARGUMENTS', 'count 只和 range 一起用');
    return args.at;
  }
  const [from, to] = args.range!.split(':').map(Number) as [number, number];
  if (!(to > from)) throw new ToolError('INVALID_ARGUMENTS', 'range 的终点要大于起点');
  const count = args.count ?? DEFAULT_RANGE_COUNT;
  return Array.from({ length: count }, (_, i) => decimal(from + ((to - from) * i) / count));
}

/**
 * 时间线上 `seconds` 处的源：根序列上盖住这一帧（`floor(秒 × 帧率)`）的、启用着、轨道可见、素材有画面的视频片段里最上层的
 * 那个（视觉轨的 `order` 越大越靠上，同一轨上按 `paintOrder`），按它的时间映射换成素材时间。没有时 null。
 */
export function frameSourceAt(video: VideoSnapshot, seconds: number): FrameSource | null {
  const sequence = video.sequences[video.rootSequenceId];
  if (!sequence) return null;
  const { fps } = sequence;
  const frame = Math.floor((seconds * fps.num) / fps.den + 1e-9);
  const tracks = new Map(sequence.tracks.filter((t) => t.kind === 'visual' && t.visible).map((t) => [t.id, t.order]));
  let best: { item: VideoItem; order: number } | null = null;
  for (const item of sequence.items) {
    if (item.type !== 'video' || !item.enabled) continue;
    const order = tracks.get(item.trackId);
    if (order === undefined) continue;
    if (frame < item.span.fromFrame || frame >= item.span.fromFrame + item.span.durationFrames) continue;
    if (!video.assets[item.assetRef.id]?.revisions[item.assetRef.revision]?.video) continue;
    if (best && (best.order > order || (best.order === order && best.item.paintOrder >= item.paintOrder))) continue;
    best = { item, order };
  }
  if (!best) return null;
  const { item } = best;
  const record = video.assets[item.assetRef.id]!.revisions[item.assetRef.revision]!;
  const local = ((frame - item.span.fromFrame) * fps.den) / fps.num;
  const sourceSeconds =
    item.timeMap.kind === 'hold'
      ? mediaTimeToSeconds(item.timeMap.sourceAt)
      : mediaTimeToSeconds(item.timeMap.sourceIn) + (local * item.timeMap.rate.num) / item.timeMap.rate.den;
  return {
    item,
    asset: {
      contentHash: record.contentHash,
      mediaType: record.mediaType,
      durationSec: record.duration ? mediaTimeToSeconds(record.duration) : null,
    },
    assetId: item.assetRef.id,
    revision: item.assetRef.revision,
    sourceSeconds,
  };
}

/**
 * 帧的输出目录 `<root>/.baocut-out/frames/<videoId>`：不存在时建出来；按真实路径不能出 `root`（`confine` 给了时也不能出它），
 * 不能在视频目录或 `.bcut` 里。返回真实路径。
 */
export async function framesDirectory(root: string, videoId: Id, confine: string | null): Promise<string> {
  const refuse = () =>
    new ToolError('PATH_OUTSIDE_WORKSPACE', `帧的输出目录 ${FRAMES_DIR} 指到了写文件的目录以外（不经过指向别处的符号链接）`);
  await fs.mkdir(root, { recursive: true });
  const rootReal = await fs.realpath(root);
  if (confine !== null && !inside(rootReal, await fs.realpath(confine))) throw refuse();
  await refuseVideoDirectory(path.parse(rootReal).root, rootReal, []);
  const dir = path.join(rootReal, FRAMES_DIR, videoId);
  await fs.mkdir(dir, { recursive: true });
  const real = await fs.realpath(dir);
  if (!inside(real, rootReal)) throw refuse();
  return real;
}

/** 取一帧并写成文件 `at-<毫秒>ms.<png|jpg>`（同一时刻再取时覆盖）。返回文件的绝对路径与像素尺寸。 */
export async function writeFrame(
  analysis: MediaAnalysis,
  source: FrameSource,
  locate: () => Promise<{ root: string; file: string }>,
  options: { dir: string; at: string; format: 'png' | 'jpeg'; maxWidth: number | undefined },
): Promise<{ file: string; width: number; height: number }> {
  const box = options.maxWidth
    ? { width: options.maxWidth, height: options.maxWidth * 3 }
    : { width: DEFAULT_FRAME_EDGE, height: DEFAULT_FRAME_EDGE };
  const frame = await analysis.videoFrame(source.asset, source.sourceSeconds, { ...box, format: options.format }, locate);
  const millis = Math.round(Number(options.at) * 1000);
  const file = path.join(options.dir, `at-${millis}ms.${options.format === 'png' ? 'png' : 'jpg'}`);
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, frame.data);
  await fs.rename(tmp, file).catch(async (error: unknown) => {
    await fs.rm(tmp, { force: true });
    throw error;
  });
  return { file, width: frame.width, height: frame.height };
}

function decimal(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
