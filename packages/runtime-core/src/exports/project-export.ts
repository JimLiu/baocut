import {
  refOf,
  type AssetRevision,
  type CompositionItem,
  type Id,
  type ImageItem,
  type Localized,
  type MediaTime,
  type MessageRef,
  type Rate,
  type SequenceItem,
  type Track,
  type VersionRef,
  type VideoItem,
  type VideoSnapshot,
} from '@baocut/protocol';
import { RcExport } from '@baocut/protocol/messages/runtime-core';

/**
 * 工程导出（架构设计 §9.13）：把一条序列写成 Final Cut Pro 7 XML（xmeml v5），Premiere Pro 与 DaVinci Resolve 能导入。
 * 单向、有损的交换，不是渲染：
 *
 * - 写出的：视频、图片、音频实例的入出点与在序列上的位置，各在自己的轨道上（视觉轨按 `order` 从下到上）；视频实例的内嵌声音
 *   另起一条音轨；有预渲染替身的合成按替身的视频写出；停用的实例写成 `enabled` 为假；静音的轨道与实例同样。
 * - 表达不了的逐项写进报告（任务警告），不静默丢弃：文字、图形、字幕、生成类元素（贴纸、声波、进度条、手绘、占位框、彩纸、
 *   白板手绘）、没有替身的合成，转场、效果（`fx`）、裁剪、遮罩、圆角、元素动画与关键帧、不铺满画布的摆法（画中画、旋转、镜像、
 *   平铺）、不透明度、音量与淡入淡出、变速与定格、音频实例的亚帧偏移，以及读不到文件的素材。
 * - 素材按引用写出：本机的绝对路径（`file://` URL）。这是给本机或同样路径的机器用的交换文件，不是便携包。
 */

export interface ProjectAsset {
  path?: string;
  missing?: { reason: string };
}

export interface ProjectOmission {
  itemId?: Id;
  transitionId?: Id;
  /** 发出时当前语言的文字；`whatRef` 是它的引用（任务警告的 `detailRef`）。 */
  what: string;
  whatRef?: MessageRef;
}

function omission(what: Localized, ids: { itemId?: Id; transitionId?: Id } = {}): ProjectOmission {
  return { ...ids, what: what.text, whatRef: refOf(what) };
}

export interface ProjectRender {
  xml: string;
  clips: number;
  omitted: ProjectOmission[];
  durationSec: number;
}

function itemKindLabel(type: SequenceItem['type']): Localized {
  switch (type) {
    case 'video':
      return RcExport.itemKindVideo();
    case 'image':
      return RcExport.itemKindImage();
    case 'audio':
      return RcExport.itemKindAudio();
    case 'text':
      return RcExport.itemKindText();
    case 'shape':
      return RcExport.itemKindShape();
    case 'composition':
      return RcExport.itemKindComposition();
    case 'caption':
      return RcExport.itemKindCaption();
    case 'sticker':
      return RcExport.itemKindSticker();
    case 'visualizer':
      return RcExport.itemKindVisualizer();
    case 'progress':
      return RcExport.itemKindProgress();
    case 'draw':
      return RcExport.itemKindDraw();
    case 'placeholder':
      return RcExport.itemKindPlaceholder();
    case 'confetti':
      return RcExport.itemKindConfetti();
    case 'whiteboard':
      return RcExport.itemKindWhiteboard();
  }
}

/** xmeml 只认得下面这几种：视频、图片、音频与有替身的合成。其余种类整个跳过并报告。 */
const PROJECT_KINDS = new Set<SequenceItem['type']>(['video', 'image', 'audio', 'composition']);

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function seconds(time: MediaTime): number {
  return Number(time.ticks) / time.timescale;
}

/** xmeml 的帧率：整数的 timebase 加 NTSC 标记（x000/1001）。表达不了的帧率按最接近的整数写并报告。 */
export function xmemlRate(fps: Rate): { timebase: number; ntsc: boolean; exact: boolean } {
  if (fps.den === 1001 && fps.num % 1000 === 0) return { timebase: fps.num / 1000, ntsc: true, exact: true };
  const value = fps.num / fps.den;
  return { timebase: Math.round(value), ntsc: false, exact: Number.isInteger(value) };
}

function rateXml(rate: { timebase: number; ntsc: boolean }): string {
  return `<rate><timebase>${rate.timebase}</timebase><ntsc>${rate.ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`;
}

/** 本机路径的 `file://localhost/...` URL，每一段按 URL 编码。 */
export function pathUrl(file: string): string {
  return `file://localhost${file
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`;
}

/**
 * 实例是否铺满画布、不转不翻（与渲染的摆法一致）：视频与图片看 `mode`（铺满时 `place` 的位置、宽与缩放不参与，平铺的图片不算）；
 * 合成没有 `mode`，`place` 没写位置与宽时铺满。
 */
function isFullFrame(item: VideoItem | ImageItem | CompositionItem): boolean {
  const place = item.place;
  const fullscreen =
    item.type === 'composition'
      ? place.x === undefined && place.y === undefined && place.w === undefined
      : item.mode === 'fullscreen' && !(item.type === 'image' && item.tile?.on);
  return fullscreen && !place.rot && !place.flipX && !place.flipY;
}

function startOf(item: SequenceItem): number {
  return 'span' in item ? item.span.fromFrame : item.fromFrame;
}

interface Clip {
  itemId: Id;
  name: string;
  enabled: boolean;
  start: number;
  end: number;
  inFrame: number;
  outFrame: number;
  fileKey: string;
}

/** 把序列写成 xmeml。`assets` 是素材版本（`id@revision`）此刻的位置。 */
export function renderXmeml(video: VideoSnapshot, sequenceId: Id, assets: Map<string, ProjectAsset>): ProjectRender {
  const sequence = video.sequences[sequenceId];
  if (!sequence) throw new Error(RcExport.sequenceNotFound({ sequenceId }).text);
  const fps = sequence.fps;
  const fpsValue = fps.num / fps.den;
  const rate = xmemlRate(fps);
  const omitted: ProjectOmission[] = [];
  if (!rate.exact) omitted.push(omission(RcExport.projectFpsInexact({ fps: `${fps.num}/${fps.den}`, timebase: rate.timebase })));
  const canvas = sequence.canvas;
  const frames = (s: number) => Math.round(s * fpsValue);

  const files = new Map<string, { id: string; name: string; revision: AssetRevision; path?: string; frames: number }>();
  const fileFor = (ref: VersionRef, itemId: Id): string | null => {
    const key = `${ref.id}@${ref.revision}`;
    if (files.has(key)) return key;
    const record = video.assets[ref.id];
    const revision = record?.revisions[ref.revision];
    if (!record || !revision) return null;
    const location = assets.get(key);
    if (!location?.path)
      omitted.push(
        omission(RcExport.projectAssetOffline({ name: record.name, reason: location?.missing?.reason ?? 'missing' }), { itemId }),
      );
    files.set(key, {
      id: `file-${files.size + 1}`,
      name: record.name,
      revision,
      ...(location?.path ? { path: location.path } : {}),
      frames: revision.duration ? frames(seconds(revision.duration)) : 0,
    });
    return key;
  };

  const tracks = [...sequence.tracks].sort((a, b) => a.order - b.order);
  const animated = new Set(sequence.animationBindings.filter((b) => b.keyframes.length > 0).map((b) => b.targetId));
  const videoTracks: Array<{ track: Track; clips: Clip[] }> = [];
  const audioTracks: Array<{ track: Track | null; name: string; clips: Clip[] }> = [];
  const embedded: Clip[] = [];
  let durationFrames = 0;

  for (const track of tracks) {
    // 按在序列上的开始排好（有的软件要求轨道里的片段有序）。
    const items = sequence.items.filter((i) => i.trackId === track.id).sort((a, b) => startOf(a) - startOf(b));
    const clips: Clip[] = [];
    for (const item of items) {
      const kind = itemKindLabel(item.type);
      const omit = (reason: Localized) =>
        omitted.push(
          omission(RcExport.projectItemOmitted({ kind, itemId: item.id, name: item.name || null, reason }), { itemId: item.id }),
        );
      if (!PROJECT_KINDS.has(item.type)) {
        omit(item.type === 'caption' ? RcExport.omitCaption() : RcExport.omitUnsupportedKind());
        continue;
      }
      if (item.type === 'composition' && !item.prerender) {
        omit(RcExport.omitNoPrerender());
        continue;
      }
      if (item.type === 'audio') {
        const key = fileFor(item.assetRef, item.id);
        if (!key) {
          omit(RcExport.omitAssetMissing());
          continue;
        }
        if (item.timeMap.kind !== 'linear') {
          omit(RcExport.omitFreezeFrame());
          continue;
        }
        if (item.timeMap.rate.num !== item.timeMap.rate.den) omit(RcExport.omitSpeed());
        if (Number(item.subframeOffset.ticks) !== 0) omit(RcExport.omitSubframe());
        if (item.mix.volume !== 1 || item.mix.fadeIn || item.mix.fadeOut || item.mix.envelope?.length)
          omit(RcExport.omitAudioMix());
        const length = frames(seconds(item.playDuration));
        const inFrame = frames(seconds(item.timeMap.sourceIn));
        clips.push({
          itemId: item.id,
          name: item.name ?? video.assets[item.assetRef.id]!.name,
          enabled: item.enabled && !item.mix.muted,
          start: item.fromFrame,
          end: item.fromFrame + length,
          inFrame,
          outFrame: inFrame + length,
          fileKey: key,
        });
        durationFrames = Math.max(durationFrames, item.fromFrame + length);
        continue;
      }
      if (item.type !== 'video' && item.type !== 'image' && item.type !== 'composition') continue;
      // 视频、图片与有替身的合成。
      const ref = item.type === 'composition' ? item.prerender! : item.assetRef;
      const key = fileFor(ref, item.id);
      if (!key) {
        omit(RcExport.omitAssetMissing());
        continue;
      }
      const place = item.place;
      if (!isFullFrame(item)) omit(RcExport.omitPlacement());
      if (place.opacity !== undefined && place.opacity !== 1) omit(RcExport.omitOpacity());
      if (place.radius || place.cornerRadii) omit(RcExport.omitCornerRadius());
      if (item.fx && Object.keys(item.fx).length > 0) omit(RcExport.omitEffects());
      if (item.mask) omit(RcExport.omitMask());
      if (item.animate && Object.keys(item.animate).length > 0) omit(RcExport.omitAnimation());
      if (animated.has(item.id)) omit(RcExport.omitKeyframes());
      if (item.type !== 'composition' && item.crop) omit(RcExport.omitCrop());
      let inFrame = 0;
      if (item.type === 'video' || item.type === 'composition') {
        if (item.timeMap.kind !== 'linear') {
          omit(RcExport.omitFreezeFrame());
          continue;
        }
        if (item.timeMap.rate.num !== item.timeMap.rate.den) omit(RcExport.omitSpeed());
        inFrame = frames(seconds(item.timeMap.sourceIn));
      }
      const clip: Clip = {
        itemId: item.id,
        name: item.name ?? video.assets[ref.id]!.name,
        enabled: item.enabled && track.visible,
        start: item.span.fromFrame,
        end: item.span.fromFrame + item.span.durationFrames,
        inFrame,
        outFrame: inFrame + item.span.durationFrames,
        fileKey: key,
      };
      clips.push(clip);
      durationFrames = Math.max(durationFrames, clip.end);
      const audio = item.type === 'video' ? item.embeddedAudio : item.type === 'composition' ? item.audio : undefined;
      if (audio?.enabled && files.get(key)!.revision.audio) {
        if (audio.volume !== 1 || audio.fadeIn || audio.fadeOut || audio.envelope?.length)
          omit(RcExport.omitEmbeddedAudioMix());
        embedded.push({ ...clip, itemId: `${item.id}-audio`, enabled: clip.enabled && !track.muted });
      }
    }
    if (track.kind === 'visual') videoTracks.push({ track, clips });
    else if (track.kind === 'audio')
      audioTracks.push({ track, name: track.name ?? 'A', clips: clips.map((c) => ({ ...c, enabled: c.enabled && !track.muted })) });
  }
  if (embedded.length > 0) {
    // 内嵌声音放在单独的音轨上：同一时间可能有几个视频实例发声，各占一条不重叠的轨道。
    const lanes: Clip[][] = [];
    for (const clip of [...embedded].sort((a, b) => a.start - b.start)) {
      const lane = lanes.find((l) => l.at(-1)!.end <= clip.start);
      if (lane) lane.push(clip);
      else lanes.push([clip]);
    }
    lanes.forEach((clips, i) => audioTracks.unshift({ track: null, name: RcExport.embeddedAudioTrack({ n: i + 1 }).text, clips }));
  }
  for (const transition of sequence.transitions) {
    omitted.push(omission(RcExport.projectTransitionOmitted({ kind: transition.kind }), { transitionId: transition.id }));
  }

  let clipCounter = 0;
  const fileWritten = new Set<string>();
  const fileXml = (key: string, kind: 'video' | 'audio'): string => {
    const f = files.get(key)!;
    if (fileWritten.has(key)) return `<file id="${f.id}"/>`;
    fileWritten.add(key);
    const media = [
      f.revision.video
        ? `<video><samplecharacteristics><width>${f.revision.video.displayWidth}</width><height>${f.revision.video.displayHeight}</height></samplecharacteristics></video>`
        : '',
      f.revision.audio
        ? `<audio><samplecharacteristics><samplerate>${f.revision.audio.sampleRate}</samplerate></samplecharacteristics><channelcount>${f.revision.audio.channels}</channelcount></audio>`
        : '',
    ].join('');
    return [
      `<file id="${f.id}">`,
      `<name>${escapeXml(f.name)}</name>`,
      f.path ? `<pathurl>${escapeXml(pathUrl(f.path))}</pathurl>` : '',
      rateXml(rate),
      f.frames ? `<duration>${f.frames}</duration>` : '',
      `<media>${media || (kind === 'video' ? '<video/>' : '<audio/>')}</media>`,
      `</file>`,
    ].join('');
  };
  const clipXml = (clip: Clip, kind: 'video' | 'audio'): string => {
    clipCounter += 1;
    const f = files.get(clip.fileKey)!;
    return [
      `<clipitem id="clipitem-${clipCounter}">`,
      `<name>${escapeXml(clip.name)}</name>`,
      `<enabled>${clip.enabled ? 'TRUE' : 'FALSE'}</enabled>`,
      `<duration>${Math.max(f.frames, clip.outFrame)}</duration>`,
      rateXml(rate),
      `<start>${clip.start}</start><end>${clip.end}</end>`,
      `<in>${clip.inFrame}</in><out>${clip.outFrame}</out>`,
      fileXml(clip.fileKey, kind),
      kind === 'audio' ? '<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>' : '',
      `</clipitem>`,
    ].join('');
  };
  const videoXml = videoTracks
    .map(
      ({ track, clips }) =>
        `<track><enabled>${track.visible ? 'TRUE' : 'FALSE'}</enabled>${clips.map((c) => clipXml(c, 'video')).join('')}</track>`,
    )
    .join('');
  const audioXml = audioTracks.map(({ clips }) => `<track>${clips.map((c) => clipXml(c, 'audio')).join('')}</track>`).join('');
  const clips = clipCounter;
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE xmeml>',
    '<xmeml version="5">',
    `<sequence id="sequence-1">`,
    `<name>${escapeXml(`${video.name} · ${sequence.name}`)}</name>`,
    `<duration>${durationFrames}</duration>`,
    rateXml(rate),
    '<media>',
    `<video><format><samplecharacteristics>${rateXml(rate)}<width>${canvas.width}</width><height>${canvas.height}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>${videoXml}</video>`,
    `<audio>${audioXml}</audio>`,
    '</media>',
    '</sequence>',
    '</xmeml>',
    '',
  ].join('\n');
  return { xml, clips, omitted, durationSec: durationFrames / fpsValue };
}
